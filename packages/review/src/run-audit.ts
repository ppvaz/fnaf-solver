// Why a night was lost, attributed from what its committed pack recorded, or UNKNOWN and why.
//
// A loss is not evidence against the strategy until the execution is cleared, and a gate that
// aborts after the game has already left the night is a symptom, not a cause. On 2026-09-30 the
// committed deaths looked like sensor failures -- nearly every one stops on a gate abort -- but in
// the packs the abort comes seconds after the last night-state observation: the game was already
// on its jumpscare or its static when the mask went unreadable. So this orders every execution
// fault against the death's onset and counts only what came before it, in this order:
//
//   1. the onset: the last observation that still read the night (phase.json's terminal, or the
//      observations). With no onset nothing can be ordered, and the attribution is UNKNOWN.
//   2. execution, before the onset. A gate abort means the executor stopped acting because it
//      could not read the state: OBSERVATION. A press whose effect went missing counts only when
//      run-report.mjs graded the miss systematic -- five or more positive reads of that target in
//      the same run (mistake register #12) -- and then it is ACTUATION. A campaign abort is
//      SCHEDULING. The earliest of these is the first divergence.
//   3. with nothing before the onset, the strategy is judged only on a verified execution: an arm
//      that was VERIFIED and every graded effect PASS. Then phase-reconstruct.mjs's own verdict on
//      the delivered phase decides (its deliveredBand, read rather than re-derived: mistake
//      register #11), and only when it is conclusive: IN A LOSS BAND -> STRATEGY; outside every
//      loss band -> MODEL (the phone did what the model says cannot happen at that phase).
//   4. anything short of that is UNKNOWN, with each check that could not be decided named, so the
//      gaps in what the runs observe are counted rather than guessed across.
//
// Each verdict is a kernel Annotation (subject GameRun, class = the attribution) listing the
// sha256 of every file it read. The phase response is a model result (MODEL_ONLY); the run data
// are the device's; the attribution promotes neither.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from '@sixam/kernel/contracts';
import { validateAnnotation } from '@sixam/kernel';
import { PACKS_DIR } from './evidence-pack.ts';

export const RUN_AUDIT_INSTRUMENT = 'run-audit@1';
export const RUN_AUDIT_KIND = 'run-audit-v1';
/** The attributions, closed. UNKNOWN is a result, not a failure to finish. */
export const ATTRIBUTIONS = Object.freeze(['OBSERVATION', 'ACTUATION', 'SCHEDULING', 'STRATEGY', 'MODEL', 'UNKNOWN']);
/** The outcomes a loss audit explains. A WIN needs no attribution; a lost result is a custody gap, not an outcome. */
export const AUDITED_OUTCOMES = Object.freeze(['DEATH', 'ERROR']);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const epoch = (at) => (typeof at === 'number' ? at : Date.parse(at));

/**
 * The pack's own files, parsed, with the sha256 of each one read.
 */
function readInputs(dir: string) {
  const inputs: string[] = [];
  const read = (rel) => {
    const file = join(dir, rel);
    if (!existsSync(file)) return null;
    const bytes = readFileSync(file);
    inputs.push(sha256(bytes));
    return bytes.toString('utf8');
  };
  const json = (rel) => { const text = read(rel); return text === null ? null : JSON.parse(text); };
  const pack = json('pack.json');
  const eventsText = read('events.jsonl');
  const events = (eventsText ?? '').split('\n').filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  return { pack, events, report: json('run/run-report.json'), phase: json('run/phase.json'), inputs };
}

/**
 * The last moment the night was still observed, in epoch ms, or null.
 */
function deathOnset(phase: any, events: any[]) {
  const terminal = phase?.terminal;
  if (Number.isFinite(terminal?.lastNightAt))
    return { at: terminal.lastNightAt, from: 'phase.json terminal.lastNightAt', terminalAt: terminal.terminalAt ?? null,
      terminalLabel: terminal.terminalLabel ?? null };
  const nights = events.filter((event) => event.type === 'observation' && /(^|\b)state=night\b/.test(String(event.label)));
  if (!nights.length) return null;
  return { at: epoch(nights.at(-1).at), from: 'last observation labelled state=night', terminalAt: null, terminalLabel: null };
}

/**
 * Execution faults, each with its time and its stage, split by the onset.
 */
function executionFaults(events: any[], report: any, onset: number) {
  const systematic = new Set((report?.effects?.systematicMisses ?? [])
    .filter((miss) => miss.verdict === 'ACTUATOR-GAP').map((miss) => miss.key));
  const faults: {at: number, stage: string, kind: string, detail: string, decisive: boolean}[] = [];
  for (const event of events) {
    if (event.type === 'control.gate.abort')
      faults.push({ at: epoch(event.at), stage: 'OBSERVATION', kind: 'gate-abort', detail: String(event.reason ?? ''), decisive: true });
    else if (event.type === 'campaign.abort' || event.type === 'campaign.abort.restart')
      faults.push({ at: epoch(event.at), stage: 'SCHEDULING', kind: 'campaign-abort', detail: String(event.reason ?? event.detail ?? ''), decisive: true });
    else if (event.type === 'control.effect.result' && event.status === 'MISSING') {
      const key = `${event.actionId} ${event.signal}->${event.target}`;
      faults.push({ at: Number.isFinite(event.contactAt) ? event.contactAt : epoch(event.at), stage: 'ACTUATION', kind: 'effect-missing',
        detail: key, decisive: systematic.has(key) });
    }
  }
  faults.sort((a, b) => a.at - b.at);
  return { before: faults.filter((fault) => fault.at < onset), after: faults.filter((fault) => fault.at >= onset) };
}

/**
 * One run's verdict as a kernel Annotation.
 * @param dir the pack directory
 */
export function auditRun(dir: string) {
  const { pack, events, report, phase, inputs } = readInputs(dir);
  const outcome = typeof pack?.outcome === 'string' ? pack.outcome : 'UNKNOWN';
  const undecided: string[] = [];
  const onset = deathOnset(phase, events);
  let attribution = 'UNKNOWN';
  let firstDivergence = null;
  let because = '';
  const faults = onset ? executionFaults(events, report, onset.at) : { before: [], after: [] };
  const tally = report?.effects?.tally ?? {};
  const armStatus = String(report?.arm?.status ?? 'UNKNOWN');
  const execution = { arm: armStatus, effects: tally,
    unconfirmedMissesBeforeOnset: faults.before.filter((fault) => !fault.decisive).map((fault) => fault.detail),
    faultsAfterOnset: faults.after.map((fault) => ({ kind: fault.kind, detail: fault.detail, afterOnsetMs: Math.round(fault.at - onset.at) })) };
  let delivered = null;
  if (!onset) {
    undecided.push('death-onset-unknown');
    because = 'no observation dates the end of the night, so no fault can be ordered before it';
  } else {
    const decisive = faults.before.find((fault) => fault.decisive);
    if (decisive) {
      attribution = decisive.stage;
      firstDivergence = { kind: decisive.kind, detail: decisive.detail, beforeOnsetMs: Math.round(onset.at - decisive.at) };
      because = `${decisive.kind} (${decisive.detail}) ${firstDivergence.beforeOnsetMs} ms before the last night observation`;
    } else {
      const unread = Object.entries(tally).filter(([status]) => status !== 'PASS').map(([status, n]) => `${n} ${status}`);
      if (!armStatus.startsWith('VERIFIED')) undecided.push(`arm-${armStatus.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-$/, '')}`);
      if (unread.length) undecided.push(`effects-not-all-pass (${unread.join(', ')})`);
      if (execution.unconfirmedMissesBeforeOnset.length) undecided.push('misses-below-the-systematic-threshold');
      const band = phase?.deliveredBand;
      if (!band) undecided.push('delivered-phase-unmeasured');
      else {
        delivered = { epochMs: band.epochMs, uncertaintyMs: band.uncertaintyMs, verdict: band.verdict, band: band.band ?? null,
          conclusive: band.conclusive === true };
        if (!delivered.conclusive) undecided.push('delivered-phase-within-its-uncertainty-of-a-band-edge');
      }
      if (!undecided.length && delivered) {
        attribution = delivered.verdict === 'IN A LOSS BAND' ? 'STRATEGY' : 'MODEL';
        because = attribution === 'STRATEGY'
          ? `a verified execution delivered at ${delivered.epochMs} ms, inside a band where the model loses`
          : `a verified execution delivered at ${delivered.epochMs} ms, outside every band where the model loses`;
      } else {
        because = 'no execution fault before the onset, and the execution is not verified enough to judge the strategy';
      }
    }
  }
  return validateAnnotation({
    subject: { kind: 'GameRun', id: String(pack?.id ?? dir.split('/').pop()) },
    instrument: RUN_AUDIT_INSTRUMENT,
    class: attribution,
    value: { outcome, onset, firstDivergence, execution, deliveredPhase: delivered, undecided, because },
    inputs,
    by: 'instrument',
    status: 'standing',
  });
}

/**
 * Every committed pack whose outcome a loss audit explains, audited.
 */
export function auditRuns(root: string) {
  const dir = join(root, PACKS_DIR);
  const ids = existsSync(dir) ? readdirSync(dir).filter((id) => existsSync(join(dir, id, 'pack.json'))).sort() : [];
  const outcomes = {};
  const annotations = [];
  for (const id of ids) {
    const outcome = JSON.parse(readFileSync(join(dir, id, 'pack.json'), 'utf8')).outcome;
    const key = typeof outcome === 'string' ? outcome : 'OTHER';
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    if (AUDITED_OUTCOMES.includes(outcome)) annotations.push(auditRun(join(dir, id)));
  }
  const byAttribution = Object.fromEntries(ATTRIBUTIONS.map((name) => [name, annotations.filter((a) => a.class === name).length]));
  const undecided = {};
  for (const annotation of annotations) for (const reason of annotation.value.undecided)
    undecided[reason.replace(/ \(.*\)$/, '')] = (undecided[reason.replace(/ \(.*\)$/, '')] ?? 0) + 1;
  return { packs: ids.length, outcomes, audited: annotations.length, byAttribution, undecided, annotations };
}

/**
 * The committed record of an audit.
 */
export function runAuditRecord(result: ReturnType<typeof auditRuns>, { date, command, commit, dirtyInputs }: {date: string, command: string, commit: string, dirtyInputs: string[]}) {
  const decided = result.audited - result.byAttribution.UNKNOWN;
  const record = {
    schema: 'evidence-record-v1', kind: RUN_AUDIT_KIND, id: `run-audit-${date.replaceAll('-', '')}`, date,
    question: 'For each committed night that ended in a death or an error, what failed first -- the observation, the actuation, ' +
      'the scheduling, the strategy or the model -- and where the packs cannot say, what is missing?',
    answer: `${decided} of ${result.audited} audited runs attributed (` +
      `${ATTRIBUTIONS.filter((name) => name !== 'UNKNOWN' && result.byAttribution[name]).map((name) => `${name} ${result.byAttribution[name]}`).join(', ') || 'none'}); ` +
      `${result.byAttribution.UNKNOWN} UNKNOWN, undecided by ` +
      `${Object.entries(result.undecided as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([reason, n]) => `${reason} ${n}`).join(', ')}.`,
    labels: 'An instrument over committed packs: the run data are DEVICE_MEASURED as packed, the phase response it reads is ' +
      'MODEL_ONLY, and an attribution promotes nothing.',
    method: { tool: 'packages/review/src/cli.ts', command, instrument: RUN_AUDIT_INSTRUMENT,
      git: { commit, dirtyInputs, note: 'the audit code is in the commit that adds this record' } },
    audit: result,
  };
  return { ...record, evidenceId: `run-audit-sha256-${sha256(canonicalJson(record)).slice(0, 16)}` };
}
