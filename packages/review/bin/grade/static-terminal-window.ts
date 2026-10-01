#!/usr/bin/env node
// How long a death's static lasts before the lifecycle observer reads the
// terminal screen, measured from the committed run packs.
//
// The device-local executor ended a night after EXIT_CONFIRM_SAMPLES (3)
// consecutive non-night reads once a night had been observed, and the
// post-jumpscare static counted toward that, so a death could end before its
// Game Over screen was read: night7-corner-bbfoxy-r01-20260927T072310Z became
// UNKNOWN that way while its video shows a Withered Foxy jumpscare. The
// executor now withholds a static read's exit vote for STATIC_TERMINAL_WAIT_MS
// from the first static of a run, and that constant is this record's measured
// maximum plus one observer interval (CLAUDE.md register items 7 and 9: a floor
// is a measurement plus a named margin, and the measurement lives where a check
// reads it).
//
// Source, per pack (docs/evidence/runs/<run>/):
//   events.jsonl   `observation` rows, which the campaign writes only when the
//                  label CHANGES (modern-campaign-ports.js recordObservation),
//                  stamped on the host clock after the classifier returned;
//                  `campaign.abort.restart` rows, whose reason names the exit.
//   observations.jsonl  every lifecycle read (25-odd packs keep it); used only
//                  to measure read-to-read gaps directly, as a cross-check.
// The record is content-free: run ids and milliseconds, no frames or labels
// beyond the lifecycle state names.
//
//   node packages/review/bin/grade/static-terminal-window.ts           # print the record
//   node packages/review/bin/grade/static-terminal-window.ts --write   # write RECORD_PATH
//   node packages/review/bin/grade/static-terminal-window.ts --check   # the committed record
//       reproduces from the runs it lists, and no pack committed since reads a
//       terminal later than its measured maximum (which would eat the margin)
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const RUNS_DIR = 'docs/evidence/runs';
export const RECORD_PATH = 'docs/evidence/static-terminal-window-20260927.json';
export const RECORD_ID = 'static-terminal-window-20260927';
export const STATIC_EXIT_REASON = 'device: lifecycle left night state (static)';
// The executor's exit rule when every measured pack ran: the abort row follows
// the third consecutive static read, so two observer intervals separate the
// first static from the third.
export const EXIT_CONFIRM_SAMPLES_AT_MEASUREMENT = 3;

const TERMINAL = new Set(['state=gameover', 'state=sixam']);
// After a static abort the campaign restarts the game; the relaunch shows its
// intro card and then the title. Reads before that are still the dying game's.
const RELAUNCH = new Set(['state=intro', 'state=title']);

const readJsonl = path => readFileSync(path, 'utf8').split('\n').filter(line => line.trim())
  .map(line => JSON.parse(line));

/**
 * Walk one pack's event rows and name every static episode that follows a
 * night. An episode starts at the first `state=static` row after a
 * `state=night` row; an UNKNOWN read inside it does not end it.
 */
export function staticEpisodes(run: string, rows: any[]) {
  const episodes = [];
  let night = false;
  let first = null;
  let aborted = null;
  for (const row of rows) {
    const at = Date.parse(row.at);
    const label = row.type === 'observation' && typeof row.label === 'string' ? row.label : null;
    if (aborted) {
      // Between the static abort and the relaunch: did the dying game still
      // show its terminal screen?
      if (label && TERMINAL.has(label)) {
        aborted.terminalAfterAbort = { state: label.slice('state='.length), delayMs: at - first };
        episodes.push(aborted); aborted = null; first = null; night = false;
      } else if ((label && RELAUNCH.has(label)) || row.type === 'campaign.abort.restarted' ||
          row.type === 'campaign.abort.restart-failed') {
        episodes.push(aborted); aborted = null; first = null; night = false;
      }
      continue;
    }
    if (label === 'state=night') {
      if (first !== null) episodes.push({ run, kind: 'night-resumed', delayMs: at - first });
      night = true; first = null;
      continue;
    }
    if (!night) continue;
    if (label === 'state=static') { if (first === null) first = at; continue; }
    if (first === null) {
      if (label && (TERMINAL.has(label) || label === 'state=title')) night = false;
      if (row.type === 'campaign.abort.restart') night = false;
      continue;
    }
    if (label && TERMINAL.has(label)) {
      episodes.push({ run, kind: 'terminal', state: label.slice('state='.length), delayMs: at - first });
      night = false; first = null;
    } else if (label === 'state=title') {
      episodes.push({ run, kind: 'title', delayMs: at - first });
      night = false; first = null;
    } else if (row.type === 'campaign.abort.restart') {
      if (row.reason === STATIC_EXIT_REASON) aborted = { run, kind: 'static-abort', abortMs: at - first };
      else { episodes.push({ run, kind: 'other-abort', abortMs: at - first }); night = false; first = null; }
    }
  }
  if (aborted) episodes.push(aborted);
  else if (first !== null) episodes.push({ run, kind: 'open' });
  return episodes;
}

/**
 * Read-to-read gaps of the lifecycle observer inside static episodes, from
 * the gap that ends at the first static read through the terminal read or the
 * last read before the abort row. Reads after an abort belong to the restart's
 * own waiter, not to the night's observer, and are left out.
 */
export function staticReadGaps(observations: any[], abortAt: number | null = null) {
  const reads = observations.filter(item => item.script === 'lifecycle-observe.py' &&
    Number.isFinite(item.at) && (abortAt === null || item.at <= abortAt));
  const gaps = [];
  let night = false; let inStatic = false; let prev = null;
  for (const read of reads) {
    if (read.label === 'state=night') { night = true; inStatic = false; prev = read.at; continue; }
    if (night && read.label === 'state=static' && !inStatic) inStatic = true;
    if (inStatic && prev !== null) gaps.push(read.at - prev);
    if (inStatic && (TERMINAL.has(read.label) || RELAUNCH.has(read.label))) { inStatic = false; night = false; }
    prev = read.at;
  }
  return gaps;
}

const summary = values => values.length === 0 ? { n: 0, minMs: null, maxMs: null }
  : { n: values.length, minMs: Math.min(...values), maxMs: Math.max(...values) };

export function measureStaticTerminalWindow({ root = ROOT, runs }: { root?: string, runs?: string[] } = {}) {
  const runsDir = join(root, RUNS_DIR);
  const scanned = (runs ?? readdirSync(runsDir).filter(name => existsSync(join(runsDir, name, 'events.jsonl'))))
    .slice().sort();
  const terminal = [];
  const aborts = [];
  const other = [];
  const directGaps = [];
  let directPacks = 0;
  for (const run of scanned) {
    const rows = readJsonl(join(runsDir, run, 'events.jsonl'));
    const episodes = staticEpisodes(run, rows);
    for (const episode of episodes) {
      if (episode.kind === 'terminal') terminal.push(episode);
      else if (episode.kind === 'static-abort') aborts.push(episode);
      else other.push(episode);
    }
    const observationsPath = join(runsDir, run, 'observations.jsonl');
    if (episodes.length > 0 && existsSync(observationsPath)) {
      const abortRow = rows.find(row => row.type === 'campaign.abort.restart' && row.reason === STATIC_EXIT_REASON);
      const gaps = staticReadGaps(readJsonl(observationsPath), abortRow ? Date.parse(abortRow.at) : null);
      if (gaps.length > 0) { directPacks += 1; directGaps.push(...gaps); }
    }
  }
  const afterAbort = aborts.filter(item => item.terminalAfterAbort);
  const staticToTerminal = [...terminal.map(item => item.delayMs),
    ...afterAbort.map(item => item.terminalAfterAbort.delayMs)];
  const gameover = terminal.filter(item => item.state === 'gameover');
  const abortSummary = summary(aborts.map(item => item.abortMs));
  const intervals = EXIT_CONFIRM_SAMPLES_AT_MEASUREMENT - 1;
  const observerIntervalBoundMs = abortSummary.maxMs === null ? null : Math.ceil(abortSummary.maxMs / intervals);
  const measuredMaxMs = staticToTerminal.length ? Math.max(...staticToTerminal) : null;
  const body = {
    schema: 'static-terminal-window-v1',
    id: RECORD_ID,
    date: '2026-09-27',
    claimLevel: 'DEVICE_MEASURED',
    scope: 'Host-clock timing of lifecycle observation rows in committed run packs. It grades no run, promotes nothing, and changes no pack\'s outcome.',
    question: 'After the first static read that follows a night, how long until the lifecycle observer reads the terminal screen, and how long did the old three-read static exit take?',
    method: {
      // The committed record's own words, hashed into its evidenceId: where it was written from.
      tool: 'tools/device/static-terminal-window.mjs',
      command: 'node tools/device/static-terminal-window.mjs --write',
      source: `${RUNS_DIR}/*/events.jsonl: observation rows (written on label change, host clock, after the classifier returned) and campaign.abort.restart rows; observations.jsonl, where retained, for direct read gaps`,
      episode: 'starts at the first state=static observation after a state=night observation; an UNKNOWN read does not end it; it ends at state=gameover or state=sixam (terminal), state=night (night-resumed), state=title, or a campaign.abort.restart row',
      terminalAfterAbort: 'after a static abort, a state=gameover or state=sixam row before the relaunch (state=intro or state=title, or campaign.abort.restarted) is the dying game\'s own terminal read',
      observerIntervalBound: `ceil(max(abort - first static) / (${EXIT_CONFIRM_SAMPLES_AT_MEASUREMENT} - 1)): the abort row follows the third consecutive static read, so it bounds the mean of the two intervals between them`,
    },
    packs: { scanned: scanned.length, withStaticEpisode: new Set([...terminal, ...aborts, ...other].map(item => item.run)).size },
    staticToGameover: { packs: new Set(gameover.map(item => item.run)).size, ...summary(gameover.map(item => item.delayMs)) },
    staticToSixam: { packs: new Set(terminal.filter(item => item.state === 'sixam').map(item => item.run)).size,
      ...summary(terminal.filter(item => item.state === 'sixam').map(item => item.delayMs)) },
    staticAbort: { packs: new Set(aborts.map(item => item.run)).size, ...abortSummary,
      exitConfirmSamples: EXIT_CONFIRM_SAMPLES_AT_MEASUREMENT, observerIntervalBoundMs,
      terminalAfterAbort: afterAbort.map(item => ({ run: item.run, state: item.terminalAfterAbort.state,
        delayMs: item.terminalAfterAbort.delayMs, abortMs: item.abortMs })) },
    observerIntervalDirect: { packs: directPacks, ...summary(directGaps) },
    window: {
      measuredMaxMs,
      measuredMaxIs: 'the latest terminal read after a first static, over terminal episodes and terminal reads after a static abort',
      marginMs: observerIntervalBoundMs,
      marginName: 'one observer interval (staticAbort.observerIntervalBoundMs)',
      waitMs: measuredMaxMs === null || observerIntervalBoundMs === null ? null : measuredMaxMs + observerIntervalBoundMs,
      executorConstant: 'STATIC_TERMINAL_WAIT_MS, apps/device/src/adb-device-local-executor.js',
    },
    runs: {
      staticToTerminal: terminal.map(({ run, state, delayMs }) => ({ run, state, delayMs })),
      staticAbort: aborts.map(({ run, abortMs, terminalAfterAbort }) => ({ run, abortMs,
        ...(terminalAfterAbort ? { terminalAfterAbort } : {}) })),
      other: other.map(({ run, kind, delayMs, abortMs }) => ({ run, kind,
        ...(delayMs === undefined ? {} : { delayMs }), ...(abortMs === undefined ? {} : { abortMs }) })),
      scanned,
    },
    limits: [
      'Observation rows are written on label change, so a static episode is timed from the first static read to the first terminal read; the game drew static before the first static read and drew the terminal screen before it was read, by up to one observer interval each.',
      'The observer-interval bound is a mean over two intervals, not a maximum of one; observerIntervalDirect measures single gaps where observations.jsonl was retained.',
      'Every measured pack ran the old rule (three static reads end the night), so no pack shows a static longer than its abort; a death whose static outlasts waitMs is not in this sample.',
      'A static read is also a possible misread inside a live night (night5-perfetto1 read static and then 6 AM): this window governs when the executor ends a night on static, never whether actuation continues during it.',
    ],
  };
  const evidenceId = `static-terminal-window-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
  return { ...body, evidenceId };
}

/** Episodes in packs the record did not scan that read a terminal later than its maximum. */
export function newerPacksBeyondMaximum(record, { root = ROOT } = {}) {
  const runsDir = join(root, RUNS_DIR);
  const known = new Set(record.runs.scanned);
  const offenders = [];
  for (const run of readdirSync(runsDir).sort()) {
    if (known.has(run) || !existsSync(join(runsDir, run, 'events.jsonl'))) continue;
    for (const episode of staticEpisodes(run, readJsonl(join(runsDir, run, 'events.jsonl')))) {
      const delayMs = episode.kind === 'terminal' ? episode.delayMs : episode.terminalAfterAbort?.delayMs;
      if (Number.isFinite(delayMs) && delayMs > record.window.measuredMaxMs) offenders.push({ run, delayMs });
    }
  }
  return offenders;
}

export const serialize = record => `${JSON.stringify(record, null, 2)}\n`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Set(process.argv.slice(2));
  const target = join(ROOT, RECORD_PATH);
  if (args.has('--check')) {
    const committed = JSON.parse(readFileSync(target, 'utf8'));
    const again = measureStaticTerminalWindow({ runs: committed.runs.scanned });
    if (serialize(again) !== serialize(committed)) {
      console.error(`${RECORD_PATH} does not reproduce from the ${committed.runs.scanned.length} runs it lists ` +
        `(committed ${committed.evidenceId}, recomputed ${again.evidenceId})`);
      process.exit(1);
    }
    const offenders = newerPacksBeyondMaximum(committed);
    if (offenders.length) {
      console.error(`packs newer than ${committed.evidenceId} read a terminal later than its measured maximum ` +
        `${committed.window.measuredMaxMs} ms, eating the margin: ${JSON.stringify(offenders)}. ` +
        'Write a new dated record and re-derive STATIC_TERMINAL_WAIT_MS from it.');
      process.exit(1);
    }
    console.log(`${committed.evidenceId}: reproduces; waitMs=${committed.window.waitMs} ` +
      `(max ${committed.window.measuredMaxMs} + margin ${committed.window.marginMs})`);
  } else {
    const record = measureStaticTerminalWindow();
    if (args.has('--write')) {
      writeFileSync(target, serialize(record));
      console.log(`${record.evidenceId}: wrote ${RECORD_PATH}`);
    } else process.stdout.write(serialize(record));
  }
}
