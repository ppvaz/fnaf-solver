#!/usr/bin/env node
/**
 * Derived numbers of one FNaF 4 run for an evidence record: what the Fredbear
 * hearing model (fnaf4-fredbear.ts) accepts on the level's grid from a cue
 * stream, and -- with the run's native region frames and a view-template file
 * -- what the held doors and the walks looked like. Game audio and frames stay
 * outside the repository; only the numbers go into the record.
 *
 *   node packages/play/games/fnaf4/fnaf4-hearing-evidence.ts --run RUN [--artifacts DIR] [--cues FILE]
 *        [--detectors cal0.json] [--label KEY] --out docs/evidence/RECORD.json
 *
 * --cues defaults to the run's live cues.jsonl; a replay of its audio.raw
 * through packages/play/bin/audio/fnaf4-cues.py --wav (--start-wall-ms = the live stop row's
 * originMs) reproduces the live clock. The record at --out must exist; its
 * `derived[KEY]` (KEY defaults to the run id) is replaced, nothing else.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEARING_PATH, loadHearing, sideGrid, laughGrid, landings, laughs, shadowOf } from './fnaf4-fredbear.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const LEVEL_ORIGIN_MS = -520;       // fnaf4-run.ts LEVEL_ORIGIN_MS (runs before it was recorded in run.json)

function args(argv) {
  const o = { run: null, artifacts: join(ROOT, 'artifacts', 'runs'), cues: null, detectors: null, label: null, out: null, night: null, untilNightS: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run') o.run = argv[++i];
    else if (a === '--artifacts') o.artifacts = argv[++i];
    else if (a === '--cues') o.cues = argv[++i];
    else if (a === '--detectors') o.detectors = argv[++i];
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--night') o.night = Number(argv[++i]);
    else if (a === '--until-night-s') o.untilNightS = Number(argv[++i]);
    else throw new Error(`fnaf4-hearing-evidence: unknown argument ${a}`);
  }
  if (!o.run || !o.out) throw new Error('fnaf4-hearing-evidence: --run and --out are required');
  return o;
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const r3 = (x) => Math.round(x * 1000) / 1000;
const jsonl = (path) => readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** The run's clocks: wall ms of the level's own t = 0, and of the night epoch (first room frame). */
export function runClock(runJson, events) {
  const rows = events.filter((e) => Number.isFinite(e.hostMs) && e.type.startsWith('input'));
  const timeOrigin = rows.reduce((s, e) => s + (e.atWallMs - e.hostMs), 0) / rows.length;
  const epochWall = timeOrigin + runJson.night.epochHostMs;
  const levelOriginWall = runJson.night.levelOriginWallMs ?? epochWall + LEVEL_ORIGIN_MS;
  return { timeOrigin, epochWall, levelOriginWall, endNightMs: runJson.night.endedAtNightMs ?? null };
}

/** Fredbear's candidates, ticks and laughs on the grid, as derived numbers. */
export function hearingBlock(cueEvents, clock, night, hearing) {
  const sGrid: any = sideGrid(clock.levelOriginWall, night, hearing);
  const lGrid: any = laughGrid(clock.levelOriginWall, hearing);
  const roomPeriodMs = hearing.laughGrid.roomPeriodMs[shadowOf(night) ? 'shadow1' : 'shadow0'];
  const endWall = clock.endNightMs === null ? Infinity : clock.epochWall + clock.endNightMs;
  const inNight = cueEvents.filter((e) => Number.isFinite(e.onsetMs) && e.onsetMs >= clock.levelOriginWall && e.onsetMs <= endWall);
  const lastSideK = sGrid.lastK(endWall === Infinity ? Math.max(...inNight.map((e) => e.onsetMs)) : endWall - sGrid.decideAfterMs);
  const lastLaughK = lGrid.lastK(endWall === Infinity ? Math.max(...inNight.map((e) => e.onsetMs)) : endWall - lGrid.decideAfterMs);
  const side = new Map(landings(inNight, sGrid, hearing.sideGrid).map((r) => [r.k, r]));
  const sideTicks = [];
  for (let k = 1; k <= lastSideK; k += 1) {
    const r = side.get(k);
    sideTicks.push([k, r3(k * sGrid.periodMs / 1000), r ? r3(r.L) : 0, r ? r3(r.R) : 0, r?.side ?? null]);
  }
  const laughRows = new Map(laughs(inNight, lGrid, hearing.laughGrid, roomPeriodMs).map((l) => [l.k, l]));
  const laughTicks = [];
  for (let k = 1; k <= lastLaughK; k += 1) {
    const l = laughRows.get(k);
    laughTicks.push([k, k * lGrid.periodMs / 1000, l ? r3(l.ncc) : 0, (k * lGrid.periodMs) % roomPeriodMs === 0, !!l?.accepted]);
  }
  // Every Fredbear-family candidate within 400 ms of a grid instant, relative to the level origin.
  const near = (e, g) => { const k = Math.round((e.onsetMs - g.originWall - g.offsetMs) / g.periodMs); return Math.abs(e.onsetMs - g.at(k)) <= 400; };
  const candidates = inNight
    .filter((e) => ((e.cue === 'fb-left' || e.cue === 'fb-right') && near(e, sGrid)) || (e.cue === 'laugh' && near(e, lGrid)))
    .map((e) => [e.cue, e.handle, r3(e.ncc), Math.round((e.onsetMs - clock.levelOriginWall) * 10) / 10]);
  const events = sideTicks.filter((t) => t[4]);
  const silent = sideTicks.filter((t) => !t[4]);
  const laughed = laughTicks.filter((t) => t[4]);
  const quiet = laughTicks.filter((t) => !t[4]);
  return {
    grid: { levelOriginWallMs: Math.round(clock.levelOriginWall), sidePeriodMs: sGrid.periodMs, laughPeriodMs: lGrid.periodMs, roomPeriodMs },
    sideTicksColumns: ['k', 'levelS', 'fbLeftNcc', 'fbRightNcc', 'acceptedSide'],
    sideTicks,
    laughTicksColumns: ['k', 'levelS', 'bestNcc', 'roomTick', 'accepted'],
    laughTicks,
    candidatesColumns: ['cue', 'handle', 'ncc', 'onsetFromLevelOriginMs'],
    candidates,
    summary: {
      sideTicks: sideTicks.length,
      landingsAccepted: events.map((t) => `${t[4]}@${t[1]}s`),
      landingMinNcc: events.length ? Math.min(...events.map((t) => Math.max(t[2], t[3]))) : null,
      silentTickMaxNcc: silent.length ? Math.max(...silent.map((t) => Math.max(t[2], t[3]))) : null,
      laughsAccepted: laughed.map((t) => `${t[3] ? 'room' : 'fake'}@${t[1]}s ${t[2]}`),
      laughMinNcc: laughed.length ? Math.min(...laughed.map((t) => t[2])) : null,
      quietLaughTickMaxNcc: quiet.length ? Math.max(...quiet.map((t) => t[2])) : null,
    },
  };
}

/** When our own carpet run's sound (the `run` family, s0004) starts after each walk is issued. */
export function runOnsets(cueEvents, events, clock) {
  const gesture = { leftDoor: 'double', rightDoor: 'double', closet: 'double', back: 'press' };
  const runs = cueEvents.filter((e) => e.cue === 'run' && Number.isFinite(e.onsetMs));
  const req = events.filter((e) => e.type === 'input.requested');
  return req.map((e, i) => {
    if (!gesture[e.control]) return null;
    // A back is a run only from a door or the closet; from the bed it is a turn.
    const from = e.control === 'back'
      ? req.slice(0, i).reverse().find((x) => ['leftDoor', 'rightDoor', 'closet', 'bed'].includes(x.control))?.control ?? null
      : null;
    const issue = clock.timeOrigin + e.hostMs;
    const hit = runs.filter((r) => r.onsetMs > issue && r.onsetMs <= issue + 1500).sort((a, b) => b.ncc - a.ncc)[0];
    return [e.control, gesture[e.control], from, r3((issue - clock.epochWall) / 1000), hit ? Math.round(hit.onsetMs - issue) : null, hit ? r3(hit.ncc) : null];
  }).filter(Boolean);
}

/** Nearest view per native region frame, against a fnaf4-detectors-v1 file. */
function viewsOf(regionsPath, det) {
  const names = Object.keys(det.templates);
  const T = names.map((n) => Float32Array.from(det.templates[n]));
  const rows = [];
  for (const line of gunzipSync(readFileSync(regionsPath)).toString('utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    const parts = det.regions.map((k) => { const b = Buffer.from(r.regions[k], 'base64'); return new Int32Array(b.buffer, b.byteOffset, b.length / 4); });
    const n = parts.reduce((s, p) => s + p.length * 3, 0);
    const v = new Float32Array(n);
    let o = 0;
    for (const p of parts) for (const px of p) { v[o++] = (px >> 16) & 255; v[o++] = (px >> 8) & 255; v[o++] = px & 255; }
    let best = -1; let bd = Infinity; let sum = 0;
    for (let i = 0; i < T.length; i += 1) {
      let d = 0; const t = T[i];
      for (let k = 0; k < n; k += 1) d += Math.abs(v[k] - t[k]);
      d /= n;
      if (d < bd) { bd = d; best = i; }
    }
    for (let k = 0; k < n; k += 1) sum += v[k];
    rows.push({ hostMs: r.imageHostMs, view: names[best], dist: bd, mean: sum / n });
  }
  return rows;
}

/** Held doors, releases and backs, read off the frames (night seconds). */
export function viewsBlock(rows, events, clock) {
  const night = (hostMs) => r3((clock.timeOrigin + hostMs - clock.epochWall) / 1000);
  const holds = [];
  const reqs = events.filter((e) => e.type === 'input.requested');
  const rels = events.filter((e) => e.type === 'input.released');
  for (const q of reqs.filter((e) => e.control === 'closeDoor')) {
    const end = rels.find((e) => e.control === 'closeDoor' && e.hostMs >= q.hostMs);
    if (!end) continue;
    const door = reqs.filter((e) => (e.control === 'leftDoor' || e.control === 'rightDoor') && e.hostMs <= q.hostMs).pop();
    const shut = door?.control === 'rightDoor' ? 'doorR-shut' : 'doorL-shut';
    const open = door?.control === 'rightDoor' ? 'doorR' : 'doorL';
    const inHold = rows.filter((f) => f.hostMs >= q.hostMs && f.hostMs <= end.hostMs);
    const first = inHold.find((f) => f.view === shut && f.dist <= 0.5);
    const lapses = []; let cur = null;
    for (const f of inHold) {
      if (!first || f.hostMs < first.hostMs) continue;
      const bad = !(f.view === shut && f.dist <= 2);
      if (bad && !cur) cur = [f.hostMs, f.hostMs, f.view === open];
      else if (bad) cur[1] = f.hostMs;
      else if (cur) { lapses.push(cur); cur = null; }
    }
    const tail = cur;
    const openAfter = rows.find((f) => f.hostMs > end.hostMs && f.view === open && f.dist <= 0.8);
    holds.push({
      fromNightS: night(q.hostMs), toNightS: night(end.hostMs), why: end.why ?? null,
      shutExactAfterMs: first ? Math.round(first.hostMs - door.hostMs) : null,
      lapses: lapses.map(([a, b]) => [night(a), night(b), r3((b - a) / 1000)]),
      endsNotShut: tail ? night(tail[0]) : null,
      openAfterReleaseMs: openAfter ? Math.round(openAfter.hostMs - end.hostMs) : null,
    });
  }
  const backs = reqs.filter((e) => e.control === 'back').map((b) => {
    const after = rows.filter((f) => f.hostMs > b.hostMs && f.hostMs <= b.hostMs + 3000);
    const before = rows.filter((f) => f.hostMs <= b.hostMs).pop();
    const released = rels.filter((e) => e.control === 'closeDoor' && e.hostMs <= b.hostMs).pop();
    const moved = after.some((f) => f.view !== before?.view && f.dist <= 0.8 && ['hub', 'roomL', 'roomR'].includes(f.view));
    return { atNightS: night(b.hostMs), sinceDoorReleaseMs: released ? Math.round(b.hostMs - released.hostMs) : null,
      viewBefore: before?.view ?? null, reachedRoomWithin3s: moved };
  });
  // The death: the first run of all-black frames lasting 400 ms (a jumpscare
  // destroys every view, g469/g558); a walk's single black frame is not one.
  let blackRun = null;
  for (const f of rows.filter((x) => x.hostMs > clock.epochWall - clock.timeOrigin)) {
    if (f.mean !== 0) { if (blackRun && blackRun[1] - blackRun[0] >= 400) break; blackRun = null; continue; }
    blackRun = blackRun ? [blackRun[0], f.hostMs] : [f.hostMs, f.hostMs];
  }
  const dead = blackRun && blackRun[1] - blackRun[0] >= 400 ? night(blackRun[0]) : null;
  return { frames: rows.length, holds, backs, blackRunNightS: dead };
}

/** JSON with every array of plain values on one line. */
export function compactJson(value) {
  return JSON.stringify(value, null, 2).replace(/\[\s+([^\[\]{}]*?)\s+\]/g, (m, inner) => `[${inner.split(/,\s+/).join(', ')}]`);
}

function main(argv) {
  const o = args(argv);
  const runDir = join(o.artifacts, o.run);
  const runJson = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  const events = jsonl(join(runDir, 'events.jsonl'));
  const cap = runJson.capture?.directory ?? join(homedir(), 'fnaf-apks', 'fnaf4-device-runs', o.run);
  const cuesPath = o.cues ?? join(cap, 'cues.jsonl');
  const cueEvents = jsonl(cuesPath);
  const hearing = loadHearing();
  const night = o.night ?? runJson.options?.night;
  if (!Number.isInteger(night)) throw new Error('fnaf4-hearing-evidence: the run names no night; pass --night');
  const clock = runClock(runJson, events);
  // A night that ended in a death is heard only up to it (--until-night-s):
  // the jumpscare and the title music after it are not his grid.
  if (Number.isFinite(o.untilNightS)) clock.endNightMs = Math.min(clock.endNightMs ?? Infinity, o.untilNightS * 1000);
  const block: any = {
    run: o.run,
    night,
    heardUntilNightS: clock.endNightMs === null ? null : r3(clock.endNightMs / 1000),
    cues: { source: o.cues ? 'replay of audio.raw through packages/play/bin/audio/fnaf4-cues.py --wav' : 'live cues.jsonl', sha256: sha(readFileSync(cuesPath)) },
    hearingModel: { path: fileURLToPath(HEARING_PATH).slice(ROOT.length + 1), sha256: sha(readFileSync(HEARING_PATH)) },
    hearing: hearingBlock(cueEvents, clock, night, hearing),
    runOnsetsColumns: ['control', 'gesture', 'backFrom', 'issuedNightS', 'runOnsetAfterIssueMs', 'ncc'],
    runOnsets: runOnsets(cueEvents, events, clock).filter((r) => clock.endNightMs === null || r[3] * 1000 <= clock.endNightMs),
  };
  if (o.detectors && existsSync(join(cap, 'regions.ndjson.gz'))) {
    const det = JSON.parse(readFileSync(o.detectors, 'utf8'));
    block.views = { detectors: { source: det.source, sha256: sha(readFileSync(o.detectors)) },
      ...viewsBlock(viewsOf(join(cap, 'regions.ndjson.gz'), det), events, clock) };
  }
  const record = JSON.parse(readFileSync(o.out, 'utf8'));
  record.derived ??= {};
  record.derived[o.label ?? o.run] = block;
  writeFileSync(o.out, `${compactJson(record)}\n`);
  console.log(JSON.stringify({ label: o.label ?? o.run, summary: block.hearing.summary, holds: block.views?.holds?.length ?? null }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
