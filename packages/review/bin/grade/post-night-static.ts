#!/usr/bin/env node
// Is a static read after a night ever followed by a night that goes on? The
// answer decides when the device-local executor may stop pressing.
//
// On 2026-09-27 the executor kept its schedule running through a death's static
// window (static-terminal-window-20260927), and after two Night 7 deaths its
// presses went through the post-death screens: in
// night7-corner2-bbfoxy-r02-20260927T193022Z they skipped Game Over and entered
// Custom Night from the title, in night7-n7-420-minimal-m3-p1b-20260927T195732Z
// they opened the in-app store. The executor now halts actuation on the FIRST
// static read after a night (POST_NIGHT_STATIC_HALT) and keeps observing. That
// is safe only if a static read is not something a live night produces, and a
// confirmation read would be the alternative only if the reads after a static
// come soon enough. This measures both from the committed packs.
//
// Source, per pack (docs/evidence/runs/<run>/), the richest one kept:
//   observations.jsonl  every lifecycle-observe.py read (27-odd packs), stamped on
//                       the host clock after the classifier returned;
//   events.jsonl        otherwise, its `observation` rows, written only when the
//                       label changes -- so a label-change pack cannot show two
//                       consecutive reads of the same screen.
//   events.jsonl        always, for the old executor's stop (a
//                       `campaign.abort.restart` row) and its gate releases
//                       (`control.gate` releaseAt), used only for episodes that
//                       end in 6 AM.
// The record is content-free: run ids, lifecycle state names and milliseconds.
//
//   node packages/review/bin/grade/post-night-static.ts           # print the record
//   node packages/review/bin/grade/post-night-static.ts --write   # write RECORD_PATH
//   node packages/review/bin/grade/post-night-static.ts --check   # the committed record
//       reproduces from the runs it lists, and no pack committed since reads a
//       night that goes on after a post-night static
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
export const RUNS_DIR = 'docs/evidence/runs';
export const RECORD_PATH = 'docs/evidence/post-night-static-halt-20260927.json';
export const RECORD_ID = 'post-night-static-halt-20260927';
// The observer-interval bound the executor's window assumes
// (static-terminal-window-20260927, staticAbort.observerIntervalBoundMs).
export const OBSERVER_INTERVAL_BOUND_MS = 2418;
// The executor's window, which a 6 AM after a static must fall inside for the
// halted run to still read it (STATIC_TERMINAL_WAIT_MS).
export const STATIC_TERMINAL_WAIT_MS = 8724;

const LIFECYCLE_SCRIPT = 'lifecycle-observe.py';
const NIGHT = 'state=night';
const STATIC = 'state=static';
const TERMINAL = new Set(['state=gameover', 'state=sixam']);
// Screens that end an episode: the terminal, the title, or the relaunch's intro.
const EPISODE_END = new Set([...TERMINAL, 'state=title', 'state=intro']);
// Screens that end the executor's run before any static. An intro does not:
// the executor's `nightObserved` latches, so a static after night, intro is
// still a post-night static to it (night7-night7-k3-seedlog-01).
const RUN_END = new Set([...TERMINAL, 'state=title']);

const readJsonl = path => readFileSync(path, 'utf8').split('\n').filter(line => line.trim())
  .map(line => JSON.parse(line));
const stamp = value => typeof value === 'number' ? value : Date.parse(value);
const isLifecycle = label => typeof label === 'string' && (label.startsWith('state=') || label.startsWith('unknown='));
const isPositive = label => typeof label === 'string' && label.startsWith('state=');

/**
 * The lifecycle reads of one pack, from the richest source it kept.
 */
export function packReads(dir: string): { source: 'reads' | 'label-changes', reads: { at: number, label: string }[] } {
  const observations = join(dir, 'observations.jsonl');
  if (existsSync(observations)) {
    const reads = readJsonl(observations).filter(row => row.script === LIFECYCLE_SCRIPT && isLifecycle(row.label))
      .map(row => ({ at: stamp(row.at), label: row.label }));
    if (reads.length) return { source: 'reads', reads };
  }
  const reads = readJsonl(join(dir, 'events.jsonl'))
    .filter(row => row.type === 'observation' && isLifecycle(row.label))
    .map(row => ({ at: stamp(row.at), label: row.label }));
  return { source: 'label-changes', reads };
}

/**
 * Every static episode that follows a night. An episode starts at the first
 * static read after a night read and runs to the first terminal, title or
 * intro read (or the end of the reads). Inside it, a night read is recorded
 * rather than ending it: p1b read `state=night` once from inside its death
 * minigame, and whether the night went on is what is being asked.
 */
export function postNightStaticEpisodes(run: string, source: 'reads' | 'label-changes', reads: { at: number, label: string }[]) {
  const episodes = [];
  let night = false;
  let episode = null;
  let previousAt = null;
  const close = () => { episodes.push(episode); episode = null; night = false; };
  for (const read of reads) {
    if (episode) {
      const delayMs = read.at - episode.firstAt;
      if (episode.secondReadMs === null) {
        episode.secondReadMs = delayMs;
        episode.secondReadLabel = read.label;
      }
      if (read.label === STATIC) episode.staticReads += 1;
      if (read.label === NIGHT) episode.nightReadsAfterMs.push(delayMs);
      if (isPositive(read.label)) episode.positiveAfter.push(read.label);
      if (EPISODE_END.has(read.label)) {
        episode.end = { state: read.label.slice('state='.length), delayMs };
        close();
      }
    } else if (read.label === NIGHT) {
      night = true;
    } else if (night && read.label === STATIC) {
      episode = { run, source, firstAt: read.at, gapBeforeMs: previousAt === null ? null : read.at - previousAt,
        secondReadMs: null, secondReadLabel: null, staticReads: 1, nightReadsAfterMs: [], positiveAfter: [], end: null };
    } else if (night && RUN_END.has(read.label)) {
      night = false;
    }
    previousAt = read.at;
  }
  if (episode) close();
  return episodes.map(item => {
    // Two positive reads in a row that both name the office: the observer saw
    // the night again, and again. Only a pack that keeps every read can show it.
    let longestNightRun = 0;
    let current = 0;
    for (const label of item.positiveAfter) {
      current = label === NIGHT ? current + 1 : 0;
      longestNightRun = Math.max(longestNightRun, current);
    }
    const { positiveAfter, ...rest } = item;
    return { ...rest, consecutiveNightReadsAfter: longestNightRun };
  });
}

/**
 * Did the night go on after this episode's static? Either the office was read
 * twice in a row after it, or the episode ended at 6 AM.
 */
export const nightWentOn = (episode: ReturnType<typeof postNightStaticEpisodes>[number]) => episode.consecutiveNightReadsAfter >= 2 || episode.end?.state === 'sixam';

/**
 * Positive non-night reads inside a live night, in packs that keep every read:
 * a read after a night whose next two positive reads both name the office.
 */
export function liveNightMisreads(reads: { at: number, label: string }[]) {
  const counts = {};
  let night = false;
  for (const [index, read] of reads.entries()) {
    if (read.label === NIGHT) { night = true; continue; }
    if (!night || !isPositive(read.label)) continue;
    const next = reads.slice(index + 1).filter(item => isPositive(item.label)).slice(0, 2);
    counts[read.label] ??= { reads: 0, liveNight: 0 };
    counts[read.label].reads += 1;
    if (next.length === 2 && next.every(item => item.label === NIGHT)) counts[read.label].liveNight += 1;
    else if (RUN_END.has(read.label)) night = false;
  }
  return counts;
}

/**
 * Read-to-read gaps while a night runs (after a night read, up to the first
 * static, terminal, title or intro read).
 */
export function nightGaps(reads: { at: number, label: string }[]) {
  const gaps = [];
  let night = false;
  let previousAt = null;
  for (const read of reads) {
    if (night && previousAt !== null && read.label !== STATIC && !EPISODE_END.has(read.label))
      gaps.push(read.at - previousAt);
    if (read.label === NIGHT) night = true;
    else if (read.label === STATIC || EPISODE_END.has(read.label)) night = false;
    previousAt = read.at;
  }
  return gaps;
}

const summary = values => values.length === 0 ? { n: 0, minMs: null, maxMs: null }
  : { n: values.length, minMs: Math.min(...values), maxMs: Math.max(...values) };

/**
 * For an episode that ended at 6 AM: when the old executor stopped the
 * schedule, and which gate releases (new presses) fell between the static and
 * that stop -- what halting at the static would have withheld.
 */
function sixamActuation(dir: string, firstAt: number, endMs: number) {
  const rows = readJsonl(join(dir, 'events.jsonl'));
  const stop = rows.find(row => row.type === 'campaign.abort.restart' && stamp(row.at) >= firstAt);
  const stopMs = stop ? stamp(stop.at) - firstAt : null;
  const until = stopMs ?? endMs;
  const releasesAfterStaticMs = rows.filter(row => row.type === 'control.gate' && Number.isFinite(row.releaseAt))
    .map(row => row.releaseAt - firstAt).filter(delta => delta >= 0 && delta < until);
  const pressingMs = stopMs === null || releasesAfterStaticMs.length === 0 ? null
    : stopMs - Math.min(...releasesAfterStaticMs);
  return { oldStopMs: stopMs, oldStopReason: stop?.reason ?? null, gateReleasesAfterStaticMs: releasesAfterStaticMs,
    pressingBeforeOldStopMs: pressingMs };
}

export function measurePostNightStatic({ root = ROOT, runs }: { root?: string, runs?: string[] } = {}) {
  const runsDir = join(root, RUNS_DIR);
  const scanned = (runs ?? readdirSync(runsDir).filter(name => existsSync(join(runsDir, name, 'events.jsonl'))))
    .slice().sort();
  const episodes = [];
  const full = { packs: 0, nightReads: 0, postNightStaticReads: 0, misreads: {}, nightGaps: [] };
  for (const run of scanned) {
    const dir = join(runsDir, run);
    const { source, reads } = packReads(dir);
    const found = postNightStaticEpisodes(run, source, reads);
    episodes.push(...found.map(item => ({ ...item, dir })));
    if (source !== 'reads') continue;
    full.packs += 1;
    let night = false;
    for (const read of reads) {
      if (read.label === NIGHT) { full.nightReads += 1; night = true; }
      else if (night && read.label === STATIC) full.postNightStaticReads += 1;
      else if (RUN_END.has(read.label)) night = false;
    }
    for (const [label, count] of Object.entries(liveNightMisreads(reads))) {
      full.misreads[label] ??= { reads: 0, liveNight: 0 };
      full.misreads[label].reads += (count as any).reads;
      full.misreads[label].liveNight += (count as any).liveNight;
    }
    full.nightGaps.push(...nightGaps(reads));
  }
  const byEnd = {};
  for (const item of episodes) {
    const key = item.end?.state ?? 'open';
    byEnd[key] = (byEnd[key] ?? 0) + 1;
  }
  const fullEpisodes = episodes.filter(item => item.source === 'reads');
  const sixam = episodes.filter(item => item.end?.state === 'sixam').map(item => ({
    run: item.run, source: item.source, delayMs: item.end.delayMs, staticReads: item.staticReads,
    insideWindow: item.end.delayMs < STATIC_TERMINAL_WAIT_MS,
    ...sixamActuation(item.dir, item.firstAt, item.end.delayMs),
  }));
  const nightAfter = episodes.filter(item => item.nightReadsAfterMs.length > 0).map(item => ({
    run: item.run, source: item.source, nightReadsAfterMs: item.nightReadsAfterMs,
    consecutiveNightReadsAfter: item.consecutiveNightReadsAfter, end: item.end,
  }));
  const misreadRows = Object.fromEntries(Object.entries(full.misreads).sort(([a], [b]) => a.localeCompare(b)));
  const gapRows = fullEpisodes.map(item => ({ run: item.run, gapBeforeMs: item.gapBeforeMs,
    secondReadMs: item.secondReadMs, secondReadLabel: item.secondReadLabel, staticReads: item.staticReads,
    end: item.end }));
  const overBound = values => values.filter(value => value > OBSERVER_INTERVAL_BOUND_MS).length;
  const body = {
    schema: 'post-night-static-halt-v1',
    id: RECORD_ID,
    date: '2026-09-27',
    claimLevel: 'DEVICE_MEASURED',
    scope: 'Lifecycle reads in committed run packs, on the host clock. It grades no run, promotes nothing, and changes no pack\'s outcome.',
    question: 'Once a night has been observed, is a static read ever followed by a night that goes on, and how soon after a first static does the next read come?',
    method: {
      // The committed record's own words, hashed into its evidenceId: where it was written from.
      tool: 'tools/device/post-night-static.mjs',
      command: 'node tools/device/post-night-static.mjs --write',
      source: `${RUNS_DIR}/*/observations.jsonl lifecycle-observe.py rows where kept (every read), else events.jsonl observation rows (written on label change); events.jsonl campaign.abort.restart and control.gate rows for episodes that end at 6 AM`,
      episode: 'starts at the first state=static read after a state=night read; runs to the first state=gameover, state=sixam, state=title or state=intro read; night reads inside it are recorded, not ended on',
      nightWentOn: 'two consecutive positive reads naming the office after the static (only a pack that keeps every read can show this), or the episode ending at state=sixam',
      liveNightMisread: 'in packs that keep every read: a positive non-night read after a night whose next two positive reads both name the office',
    },
    packs: { scanned: scanned.length, everyRead: full.packs, labelChangesOnly: scanned.length - full.packs,
      withPostNightStatic: new Set(episodes.map(item => item.run)).size },
    episodes: {
      n: episodes.length,
      byEnd: Object.fromEntries(Object.entries(byEnd).sort(([a], [b]) => a.localeCompare(b))),
      nightWentOn: episodes.filter(nightWentOn).map(item => ({ run: item.run, end: item.end,
        consecutiveNightReadsAfter: item.consecutiveNightReadsAfter })),
      withNightReadAfter: nightAfter,
      endedAtSixam: sixam,
    },
    everyRead: {
      packs: full.packs,
      nightReads: full.nightReads,
      postNightStaticReads: full.postNightStaticReads,
      episodes: fullEpisodes.length,
      liveNightMisreads: misreadRows,
      secondReadAfterFirstStatic: { ...summary(fullEpisodes.map(item => item.secondReadMs).filter(Number.isFinite)),
        overBound: overBound(fullEpisodes.map(item => item.secondReadMs).filter(Number.isFinite)) },
      gapEndingAtFirstStatic: { ...summary(fullEpisodes.map(item => item.gapBeforeMs).filter(Number.isFinite)),
        overBound: overBound(fullEpisodes.map(item => item.gapBeforeMs).filter(Number.isFinite)) },
      nightGaps: { ...summary(full.nightGaps), overBound: overBound(full.nightGaps),
        boundMs: OBSERVER_INTERVAL_BOUND_MS },
      byEpisode: gapRows,
    },
    rule: {
      halt: 'first state=static read after a night',
      executorConstant: 'POST_NIGHT_STATIC_HALT, apps/device/src/adb-device-local-executor.js',
      because: [
        'no post-night static episode was followed by a night that went on, except those that ended at 6 AM inside the executor\'s window, which the observer still reads after a halt',
        'in the packs that keep every read, the classifier misread a live night as other positive screens but never as static',
        'a confirmation read after a first static can come later than the post-death screens last (see everyRead.secondReadAfterFirstStatic)',
      ],
    },
    runs: { scanned },
    limits: [
      'A label-change pack writes one row per change of label, so it cannot show two consecutive night reads; only packs that keep every read can refute "the night went on" by reads.',
      'The counterfactual is not measured: no pack ran with the halt. For an episode that ended at 6 AM, gateReleasesAfterStaticMs and pressingBeforeOldStopMs bound what a halt at the static would have withheld, not whether the night would still have reached 6 AM.',
      'A death whose post-death screens are never read as static (a death minigame read as unknown from its start) is not covered by this rule.',
      'Supersedes the last limit of static-terminal-window-20260927, which said the window never decides whether actuation continues.',
    ],
  };
  const evidenceId = `${RECORD_ID.replace(/-\d{8}$/, '')}-${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)}`;
  return { ...body, evidenceId };
}

/** Episodes in packs the record did not scan whose night went on after a post-night static. */
export function newerPacksContradicting(record, { root = ROOT } = {}) {
  const runsDir = join(root, RUNS_DIR);
  const known = new Set(record.runs.scanned);
  const offenders = [];
  for (const run of readdirSync(runsDir).sort()) {
    if (known.has(run) || !existsSync(join(runsDir, run, 'events.jsonl'))) continue;
    const { source, reads } = packReads(join(runsDir, run));
    for (const episode of postNightStaticEpisodes(run, source, reads)) {
      if (!nightWentOn(episode)) continue;
      // A 6 AM the halted observer still reads inside its window is not a
      // contradiction; a night read twice in a row after a static, or a 6 AM
      // past the window, is.
      if (episode.consecutiveNightReadsAfter < 2 && episode.end.delayMs < STATIC_TERMINAL_WAIT_MS) continue;
      offenders.push({ run, end: episode.end, consecutiveNightReadsAfter: episode.consecutiveNightReadsAfter });
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
    const again = measurePostNightStatic({ runs: committed.runs.scanned });
    if (serialize(again) !== serialize(committed)) {
      console.error(`${RECORD_PATH} does not reproduce from the ${committed.runs.scanned.length} runs it lists ` +
        `(committed ${committed.evidenceId}, recomputed ${again.evidenceId})`);
      process.exit(1);
    }
    const offenders = newerPacksContradicting(committed);
    if (offenders.length) {
      console.error(`packs newer than ${committed.evidenceId} read a night that went on after a post-night static: ` +
        `${JSON.stringify(offenders)}. Write a new dated record and re-derive POST_NIGHT_STATIC_HALT from it.`);
      process.exit(1);
    }
    console.log(`${committed.evidenceId}: reproduces; ${committed.episodes.n} post-night static episodes, ` +
      `${committed.episodes.nightWentOn.length} went on`);
  } else {
    const record = measurePostNightStatic();
    if (args.has('--write')) {
      writeFileSync(target, serialize(record));
      console.log(`${record.evidenceId}: wrote ${RECORD_PATH}`);
    } else process.stdout.write(serialize(record));
  }
}
