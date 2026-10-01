#!/usr/bin/env node
// One verdict for one modern campaign run, read from the run's own events.
//
// `grade-run.sh` already runs every instrument this repository owns against a
// run's VIDEO. Nothing did the same for the modern campaign bundle, so the
// facts that only the executor knows -- when the night started, what the arm
// gate cost, which cycle gates had to correct the phone, how much phase the
// stream actually delivered, and why the run stopped -- had to be read out of
// raw `events.jsonl` by hand after every attempt. They were, twice, and both
// times the reading was the slow part of the iteration.
//
// This states them. It invents nothing: every number below is a timestamp the
// executor already recorded, and anything the bundle cannot pin is UNKNOWN.
// `phase-reconstruct.ts` remains the authority on delivered phase against the
// model band; this is the run-shaped summary around it.
//
//   node packages/review/bin/grade/run-report.ts --run artifacts/campaign-... [--json]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'device-run-report-v1';

const UNKNOWN = 'UNKNOWN';

const readJsonl = path => (existsSync(path)
  ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean)
  : []);

const ms = value => (Number.isFinite(value) ? `${Math.round(value)} ms` : UNKNOWN);

/** Summarize one run's events. Pure: takes the parsed rows, returns the report. */
export function report(events) {
  const first = type => events.find(event => event.type === type);
  const all = type => events.filter(event => event.type === type);

  const start = first('hid.schedule-start');
  const nightGo = first('hid.night-go');
  const released = first('hid.night-go-released');
  const armVerified = first('arm.verified');
  // `arm.failed` aborts the run. `arm.unresolved` does NOT: in observe-once
  // mode an unreadable camera frame leaves the one-shot observation unresolved
  // and the night keeps running, so it is an arm STATUS and never a stop
  // reason. Reporting it as one made a run that died of lifecycle static read
  // as an arm failure.
  const armAborted = first('arm.failed');
  const armUnresolved = first('arm.unresolved');
  const armFailed = armAborted ?? armUnresolved;
  const phaseInvalid = first('phase.invalid');
  const gates = all('control.gate');
  const gateAborts = all('control.gate.abort');
  const armRetries = all('arm.retry');
  const armSamples = all('arm.sample');
  // `device.anr` is emitted as a PROBE result, not as an occurrence: the
  // executor writes one with `count: 0, lines: []` when it looked and found
  // nothing. Reading its presence as an ANR reported a false device fault on
  // the first aborted run this reporter ever graded.
  // Did the GAME take the press, or was it only sent? The charter's rule --
  // a send is not game acceptance -- has no report behind it until this one.
  // The executor already samples each scheduled transition and grades it
  // PASS / MISSING / UNSTABLE / UNKNOWN; nothing read the tally, so a loop
  // that lost the same press every cycle looked like a healthy stream.
  const effects = all('control.effect.result');
  const effectTally = effects.reduce((into, event) => {
    into[event.status ?? 'UNKNOWN'] = (into[event.status ?? 'UNKNOWN'] ?? 0) + 1;
    return into;
  }, {});
  // Before any MISSING row is called an actuator gap, ask whether the rule
  // that graded it can see the state it was looking for AT ALL in this run.
  //
  // On the 2026-09-12 observe-once run the monitor rule read `monitorUp: true`
  // twice in 266 samples while the schedule raised the monitor six times and
  // the recording shows the camera feed up -- so its MISSING rows are the rule
  // being blind, not the press being lost. Reporting them as an actuator gap
  // is exactly the mistake the register warns about: an observation-based
  // claim has to cite the measured row that backs it. A miss is only called
  // systematic when the same rule positively read that target elsewhere.
  const positiveReads = new Map();
  for (const event of effects) {
    const samples = [...(event.samples ?? [])];
    for (const sample of samples) {
      for (const signal of ['monitorUp', 'maskOn']) {
        const value = sample?.[signal];
        if (value === true || value === false) {
          const key = `${signal}->${value}`;
          positiveReads.set(key, (positiveReads.get(key) ?? 0) + 1);
        }
      }
    }
  }

  // A press that is MISSING on most of its cycles is a systematic actuator
  // gap, not a bad frame. Group by the action and the state it asked for.
  const byAction = new Map();
  for (const event of effects) {
    const key = `${event.actionId} ${event.signal}->${event.target}`;
    const row = byAction.get(key) ?? { key, total: 0, missing: 0, pass: 0,
      signal: event.signal, target: event.target };
    row.total += 1;
    if (event.status === 'MISSING') row.missing += 1;
    if (event.status === 'PASS') row.pass += 1;
    byAction.set(key, row);
  }
  const MIN_POSITIVE_READS = 5;   // below this the rule has not shown it can see the state
  const systematicMisses = [...byAction.values()]
    .filter(row => row.total >= 2 && row.missing * 2 > row.total)
    .map(row => {
      const seen = positiveReads.get(`${row.signal}->${row.target}`) ?? 0;
      return { ...row, positiveReadsOfTarget: seen,
        verdict: seen >= MIN_POSITIVE_READS ? 'ACTUATOR-GAP' : 'UNPROVEN-OBSERVER-BLIND' };
    })
    .sort((a, b) => b.missing - a.missing);

  const anr = all('device.anr').find(event => (event.count ?? 0) > 0);
  const restarts = all('campaign.abort.restart');
  // The campaign's own reason for giving up. This is the terminal fact for a
  // run that died in-night, and it outranks every probe below.
  const abortReason = restarts.map(event => event.reason)
    .find(reason => reason && !/interrupted by SIG/i.test(reason));
  const interrupted = restarts.some(event => /interrupted by SIG/i.test(event.reason ?? ''));

  // The arm gate's cost is the wall time between the night's release and the
  // instant the remainder was let go, minus the plan time the parked prefix
  // was meant to consume. That excess is added to every later press.
  const nightAt = released?.at ?? nightGo?.at ?? null;
  const armGoAt = armVerified?.armGoAt ?? null;
  const armReadyAtMs = start?.armReadyAtMs ?? null;
  const phaseLagMs = (nightAt !== null && armGoAt !== null && Number.isFinite(armReadyAtMs))
    ? armGoAt - nightAt - armReadyAtMs
    : (phaseInvalid?.phaseLagMs ?? null);

  // The correction read-back moved OFF the gate's critical path on 2026-09-12:
  // waiting for it cost up to 1000 ms of release delay against a mask window
  // that tolerates +-185 ms, so the gate was killing the cycle it existed to
  // rescue. It now lands afterwards as its own event, which is the first time
  // "did the correction actually take?" can be answered without paying for the
  // answer with the cycle.
  const verifies = all('control.gate.verify');
  const corrected = gates.filter(gate => gate.status === 'CORRECTED');
  const agreed = gates.filter(gate => gate.status === 'AGREED');
  const gateLags = gates.map(gate => gate.gateLagMs).filter(Number.isFinite);
  const delivered = gates.map(gate => gate.deliveredOffsetMs).filter(Number.isFinite);

  // Why the run stopped, from the executor's own record and never from a
  // duration. A run whose end nothing recorded says so.
  let stop = UNKNOWN;
  let stopDetail = '';
  if (phaseInvalid) { stop = 'phase-invalid'; stopDetail = phaseInvalid.reason ?? ''; }
  else if (armAborted) { stop = 'arm-failed'; stopDetail = armAborted.reason ?? ''; }
  else if (gateAborts.length) { stop = 'gate-abort'; stopDetail = gateAborts[0].reason ?? ''; }
  else if (abortReason) { stop = 'campaign-abort'; stopDetail = abortReason; }
  else if (armUnresolved) { stop = 'arm-unresolved'; stopDetail = armUnresolved.reason ?? ''; }
  else if (anr) { stop = 'device-anr'; stopDetail = `${anr.count} traces`; }
  else if (interrupted) { stop = 'operator-interrupt'; stopDetail = 'SIGINT'; }
  else if (first('campaign.terminal.actuator-stopped')) stop = 'actuator-stopped';

  return {
    schema: SCHEMA,
    night: { startedAt: nightGo?.at ?? null, releasedAt: released?.at ?? null,
      reached: Boolean(nightGo) },
    arm: {
      mode: first('arm.mode')?.mode ?? UNKNOWN,
      attempts: armRetries.length + 1,
      retries: armRetries.length,
      samples: armSamples.length,
      verifiedAtMs: armVerified?.elapsedMs ?? null,
      armReadyAtMs, phaseLagMs,
      status: armVerified ? 'VERIFIED'
        : (armAborted ? 'FAILED' : (armUnresolved ? 'UNRESOLVED (non-fatal)' : UNKNOWN)),
      unresolvedReason: armUnresolved?.reason ?? null,
    },
    cycles: {
      gates: gates.length, agreed: agreed.length, corrected: corrected.length,
      aborts: gateAborts.length,
      gateLagMinMs: gateLags.length ? Math.min(...gateLags) : null,
      gateLagMaxMs: gateLags.length ? Math.max(...gateLags) : null,
      deliveredFirstMs: delivered.length ? delivered[0] : null,
      deliveredLastMs: delivered.length ? delivered[delivered.length - 1] : null,
      correctedAtMs: corrected.map(gate => gate.gateAtMs),
      correctionOutcomes: {
        confirmed: verifies.filter(v => v.outcome === 'CORRECTION-CONFIRMED').length,
        unconfirmed: verifies.filter(v => v.outcome === 'CORRECTION-UNCONFIRMED').length,
        unread: verifies.filter(v => v.outcome === 'CORRECTION-UNREAD').length,
        // A correction whose read-back never ran is not a failed correction:
        // the night can simply have ended first, and it is best-effort.
        notRead: Math.max(0, corrected.length - verifies.length),
      },
    },
    effects: { total: effects.length, tally: effectTally, systematicMisses },
    stop: { reason: stop, detail: stopDetail, restarts: restarts.length, interrupted },
    counts: events.reduce((into, event) => {
      into[event.type] = (into[event.type] ?? 0) + 1; return into;
    }, {}),
  };
}

/** Human-readable block. The pipeline prints this next to the video graders. */
export function render(value) {
  const lines = [];
  const row = (label, text) => lines.push(`  ${label.padEnd(28)}${text}`);
  lines.push('--- modern campaign bundle (executor-owned facts) ---');
  row('night reached', value.night.reached ? 'yes' : 'NO -- the run never entered a night');
  row('arm mode', value.arm.mode);
  row('arm', `${value.arm.status} on attempt ${value.arm.attempts} ` +
    `(${value.arm.retries} retr${value.arm.retries === 1 ? 'y' : 'ies'}, ` +
    `${value.arm.samples} samples)`);
  row('arm verified at', ms(value.arm.verifiedAtMs));
  row('parked prefix (plan)', ms(value.arm.armReadyAtMs));
  row('PHASE LAG (suffix shift)', value.arm.phaseLagMs !== null ? ms(value.arm.phaseLagMs)
    : (value.arm.mode === 'observe-once'
      ? 'none -- observe-once never parks the stream'
      : UNKNOWN));
  row('cycle gates', `${value.cycles.gates} (${value.cycles.agreed} agreed, ` +
    `${value.cycles.corrected} corrected, ${value.cycles.aborts} aborted)`);
  row('gate lag', value.cycles.gateLagMinMs === null ? UNKNOWN
    : `${value.cycles.gateLagMinMs}..${value.cycles.gateLagMaxMs} ms`);
  row('delivered offset', value.cycles.deliveredFirstMs === null ? UNKNOWN
    : `${value.cycles.deliveredFirstMs} -> ${value.cycles.deliveredLastMs} ms`);
  if (value.cycles.correctedAtMs.length)
    row('corrections at', value.cycles.correctedAtMs.map(at => `${at} ms`).join(', '));
    if (value.cycles.correctionOutcomes) {
      const o = value.cycles.correctionOutcomes;
      row('corrections landed', `${o.confirmed} confirmed, ${o.unconfirmed} unconfirmed, ` +
        `${o.unread} unread, ${o.notRead} never read back`);
    }
  const tally = Object.entries(value.effects.tally)
    .sort((a, b) => b[1] - a[1]).map(([status, count]) => `${count} ${status}`).join(', ');
  row('press acceptance', value.effects.total
    ? `${value.effects.total} graded -- ${tally}` : 'no transition was graded');
  for (const miss of value.effects.systematicMisses)
    row(miss.verdict === 'ACTUATOR-GAP' ? '  SYSTEMATIC MISS' : '  miss, but UNPROVEN',
      `${miss.key} missing on ${miss.missing} of ${miss.total} cycles` +
      (miss.verdict === 'ACTUATOR-GAP'
        ? ` (the rule read this state ${miss.positiveReadsOfTarget}x elsewhere, so it can see it)`
        : ` -- the rule read this state only ${miss.positiveReadsOfTarget}x in the whole run, ` +
          'so this is observer blindness until the rule is fixed'));
  row('stop reason', value.stop.reason + (value.stop.detail ? ` (${value.stop.detail})` : ''));
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flag = name => {
    const found = process.argv.find(value => value.startsWith(`--${name}=`));
    if (found) return found.slice(name.length + 3);
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')
      ? process.argv[index + 1] : undefined;
  };
  const run = flag('run');
  if (!run) {
    process.stderr.write('usage: run-report.mjs --run artifacts/campaign-... [--json]\n');
    process.exit(2);
  }
  const events = readJsonl(join(run, 'events.jsonl'));
  if (!events.length) {
    process.stderr.write(`run-report: ${run} has no readable events.jsonl\n`);
    process.exit(1);
  }
  const value = report(events);
  process.stdout.write(process.argv.includes('--json')
    ? `${JSON.stringify(value, null, 2)}\n` : `${render(value)}\n`);
}
