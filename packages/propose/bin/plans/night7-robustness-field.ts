#!/usr/bin/env node
// The robustness field of a Night 7 (10/20) route: for every press and release
// it makes, how far that one event can move -- every other event held where
// the route puts it -- before a held-out seed loses. The roadmap's S5 names
// this field delta*(x) and asks for the route that maximises its worst case.
//
// night7-robustness.ts moved whole schedules (the phase) and drew lateness
// per press. It could say which route tolerates more, not which press decides
// it. This file answers the second question, on the two lanes that decide it:
//
//   field     each event class (one row of the opening, or one row of the loop
//             in every cycle at once) shifted by d frames, d in +-FIELD_FRAMES,
//             over the field seeds. `ALL` is the whole schedule, the phase.
//             An event's window is the fully won run of d around 0, and its
//             margin is the nearer edge. The route's worst case is the event
//             with the smallest margin.
//   jitter    each press moved independently by a draw from +-J (epoch - J and
//             lateness [0, 2J], the human gate's shape) for J in JITTER_MS, and
//   lateness  each press late by a draw from [0, L], for L in LATENESS_MS,
//             both over the lane seeds.
//
// Both lanes, and the field, carry the phone's mask floor: a mask-ON press that
// lands less than MASK_FLOOR_MS after a lowering monitor press is lost, as the
// phone loses it (actuator.ts maskFloorMs). The simulator alone accepts it, so
// without the floor the camdrop -> mask seam reads wider than the phone's.
//
//   node packages/propose/bin/plans/night7-robustness-field.ts --count 100 --lane-count 500 --jobs 11 --out FILE
//   node packages/propose/bin/plans/night7-robustness-field.ts --schedules preset-retimed,k3 --count 60 --jobs 11
//
// MODEL_ONLY. The field moves one event class at a time; two events that move
// together can fail inside both of their windows. The jitter lane is where
// they move together.
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FPS, Sim } from '@sixam/source/fnaf2';
import { FNAF2_CONTROL_VOCABULARY as V, MODEL_CONTEXT_LIGHT } from '@sixam/source';
import { DeviceActuator } from '../../../play/bin/phone/actuator.ts';
import { SEAM_FLOORS } from './artifact-commands.ts';
import { build } from './minus-toys-plan.ts';
import { loadPresets, PRESET_KNOBS } from './night7-presets.ts';
import { forkBlocks, gitState } from '../census/winner-census.ts';
import { heldOutSeeds, nightBindings } from '../../../../packages/propose/bin/census/winner-phase-census.ts';
import { winnerTag } from '@sixam/kernel';

export const FIELD_KIND = 'night7-robustness-field-v1';
export const FIELD_FRAMES = 20;
export const MASK_FLOOR_MS = SEAM_FLOORS.maskButtonFullyVisibleAfterMonitorDownMs;
export const JITTER_MS = Object.freeze([0, 10, 20, 30, 40, 50, 60]);
export const LATENESS_MS = Object.freeze([0, 30, 50, 60, 70, 80, 90, 100]);
const STEP_MS = 1000 / FPS;
const frame = (ms) => Math.round(ms * FPS / 1000);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const actionFor = (a) => (/^cam\d+$/.test(a) ? `cam:${a.slice(3)}`
  : a === V.cameraFeedLight || a === 'ventl' ? MODEL_CONTEXT_LIGHT : a);

// The preset schedule re-timed to a deliverable epoch. PRESET_KNOBS is timed
// from epoch 0, the night's first frame, which no anchor can deliver (it
// latches the office onset first; night7-robustness.ts `reach`). Moving its
// epoch to E and every loop offset back by E keeps each loop press on the same
// frame of the game's clock -- the 5 s interval grid is the game's, not the
// schedule's -- and shortening the opening wind by E keeps the opening
// camdrop and mask where they were. What moves is the opening's arm, which
// then lands E later; its sample grid is 12 frames, so the re-timed copy wins
// in 133 ms bands repeating every 200 ms up to E = 1700 ms, where the
// opening wind reaches its 50 ms floor. RETIME_EPOCH_MS is the centre of the
// first such band at or past the anchor's earliest epoch (566.67-700 ms).
export const RETIME_LOOP_KNOBS = Object.freeze(['maskOffMs', 'maskOnMs', 'hallOffsetMs', 'raiseMs',
  'stunRefreshMs', 'windLeadMs', 'camdropMs']);
export const RETIME_EPOCH_MS = 633.33;
export function retimedPreset(epochMs = RETIME_EPOCH_MS) {
  const knobs = { ...PRESET_KNOBS };
  for (const key of RETIME_LOOP_KNOBS) knobs[key] = +(PRESET_KNOBS[key] - epochMs).toFixed(2);
  knobs.openWindMs = +(PRESET_KNOBS.openWindMs - epochMs).toFixed(2);
  if (knobs.openWindMs < 50) throw new Error(`retimedPreset: epoch ${epochMs} ms leaves the opening wind under 50 ms`);
  return knobs;
}

const tag = (path) => winnerTag(path).replace(/^campaign-night7-/, '');
export function fieldSchedules() {
  return [
    { id: 'preset', knobs: PRESET_KNOBS, epochMs: 0 },
    { id: 'preset-retimed', knobs: retimedPreset(), epochMs: RETIME_EPOCH_MS },
    ...nightBindings(7).map((b) => ({ id: tag(b.path), path: b.path, knobs: b.knobs, epochMs: b.epochMs,
      winnerSha256: b.winnerSha256 })),
  ];
}

/**
 * Every event of a Minus Toys schedule -- the queue schedule() builds -- each
 * carrying the axes that move it. A row is one unit: a tap, a hold (press and
 * release), or a camdrop (light, monitor, release), and shifting the row moves
 * the whole unit, as the actuator does (one lateness draw per hold). A hold's
 * `/end` axis moves its release alone, which is its duration; a camdrop's
 * `/monitor` axis moves the monitor press inside the held light. Moving a
 * hold's press alone would only shorten its contact: the hall contact is two
 * frames, and one frame of it is not a light the model sees.
 */
export function fieldEvents(knobs, epochMs) {
  const { opening, loop, finish } = build(knobs);
  const out = [];
  const add = (scope, cycle, base, row, index) => {
    const [at, kind, a, b, cc] = row;
    const t = base + at + epochMs;
    const unit = `${scope}#${index}:${kind === 'hold' || kind === 'tap' ? a : kind}`;
    const ev = (ms, op, action, part = null) => ({ unit, axes: part ? [unit, `${unit}/${part}`] : [unit], cycle, ms, op, action });
    if (kind === 'tap') out.push(ev(t, 'press', actionFor(a)));
    else if (kind === 'hold' || kind === 'hall') {
      const action = kind === 'hall' ? MODEL_CONTEXT_LIGHT : actionFor(a);
      out.push(ev(t, 'press', action), ev(t + (kind === 'hall' ? a : b), 'release', action, 'end'));
    } else if (kind === 'camdrop') {
      out.push(ev(t, 'press', MODEL_CONTEXT_LIGHT), ev(t + a, 'press', 'monitor', 'monitor'),
        ev(t + a + b + cc, 'release', MODEL_CONTEXT_LIGHT, 'end'));
    } else throw new Error(`fieldEvents: row kind ${kind} is not one schedule() emits`);
  };
  opening.forEach((row, i) => add('open', -1, 0, row, i));
  for (let base = 0, c = 0; base < 420000; base += knobs.loopPeriodMs, c += 1) loop.forEach((row, i) => add('loop', c, base, row, i));
  finish.forEach((row, i) => add('finish', -1, 0, row, i));
  return out;
}

/** The frame-stamped queue of `events` with `shifts` (axis -> ms, or ALL) applied, in schedule() order. */
export function fieldQueue(events, shifts: any = {}) {
  const all = shifts.ALL ?? 0;
  return events.map((e) => [frame(e.ms + all + e.axes.reduce((sum, axis) => sum + (shifts[axis] ?? 0), 0)), e.op, e.action])
    .sort((x, y) => x[0] - y[0]);
}

/**
 * One night of `events` through the device actuator with the phone's mask
 * floor: exact (band null), or with the presses drawn late from band.
 */
export function playField({ seed, events, shifts = {}, band = null, preset }) {
  const sim = new Sim({ night: 7, seed, customNight: preset.dials });
  const queue = fieldQueue(events, shifts);
  const actuator = new DeviceActuator(sim, { seed, lateMinMs: band ? band[0] : 0, lateMaxMs: band ? band[1] : 0,
    maskFloorMs: MASK_FLOOR_MS });
  let i = 0, splitAt = -1;
  while (sim.alive && !sim.won) {
    while (i < queue.length && queue[i][0] <= sim.frame) { const [, op, action] = queue[i++]; actuator[op](action); }
    actuator.deliver();
    sim.tick();
    if (splitAt < 0 && sim.camsUp && sim.viewing === 11 && sim.cam === 9) splitAt = sim.frame;
  }
  const won = sim.won && splitAt >= 0;
  return { won, reason: won ? null : sim.won ? 'unarmed' : (sim.death?.reason ?? 'alive'), frame: sim.frame,
    maskFloorDrops: actuator.maskFloorDrops };
}

const tenTwenty = () => loadPresets().find((p) => p.id === 'golden-freddy');
const eventTags = (events) => ['ALL', ...new Set(events.flatMap((e) => e.axes))];

/** Every (schedule, axis) the field scans, in a fixed order. */
function fieldCells(only) {
  const cells = [];
  for (const s of fieldSchedules().filter((x) => !only || only.includes(x.id)))
    for (const t of eventTags(fieldEvents(s.knobs, s.epochMs))) cells.push([s.id, t]);
  return cells;
}

/** The field for every (schedule, axis) whose index is `part` mod `parts`, over all field seeds. */
function fieldPart(fieldCount, part, parts, only) {
  const preset = tenTwenty();
  const seeds = heldOutSeeds(fieldCount);
  const schedules = new Map(fieldSchedules().map((s) => [s.id, s]));
  const events = new Map();
  const rows = [];
  fieldCells(only).forEach(([id, t], index) => {
    if (index % parts !== part) return;
    const s = schedules.get(id);
    if (!events.has(id)) events.set(id, fieldEvents(s.knobs, s.epochMs));
    const ev = events.get(id);
    for (let d = -FIELD_FRAMES; d <= FIELD_FRAMES; d += 1) {
      const losses = [];
      for (const seed of seeds) {
        const r = playField({ seed, events: ev, shifts: { [t]: d * STEP_MS }, preset });
        if (!r.won) losses.push([seed, r.reason, r.frame]);
      }
      rows.push({ subject: `${id}|field|${t}|${d}`, n: seeds.length, losses });
    }
  });
  return rows;
}

/** The jitter and lateness lanes for the lane seeds from..to. */
function laneBlock(laneCount, from, to, only) {
  const preset = tenTwenty();
  const seeds = heldOutSeeds(laneCount).slice(from, to);
  const rows = [];
  const push = (subject, test) => {
    const losses = [];
    for (const seed of seeds) { const r = test(seed); if (!r.won) losses.push([seed, r.reason, r.frame]); }
    rows.push({ subject, n: seeds.length, losses });
  };
  for (const s of fieldSchedules().filter((x) => !only || only.includes(x.id))) {
    const events = fieldEvents(s.knobs, s.epochMs);
    for (const J of JITTER_MS)
      push(`${s.id}|jitter|${J}`, (seed) => playField({ seed, events, shifts: { ALL: -J }, band: J > 0 ? [0, 2 * J] : null, preset }));
    for (const L of LATENESS_MS)
      push(`${s.id}|late|${L}`, (seed) => playField({ seed, events, band: L > 0 ? [0, L] : null, preset }));
  }
  return rows;
}

/** Run `node <this> --field-child part parts ...` for every part and gather the rows. */
function fieldForks(fieldCount, jobs, only) {
  const script = fileURLToPath(import.meta.url);
  return Promise.all(Array.from({ length: jobs }, (_, part) => new Promise<any>((done, reject) => {
    const child = fork(script, ['--field-child', String(part), String(jobs), String(fieldCount), only ?? '-'],
      { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced' });
    let result = null;
    child.on('message', (message) => { result = message; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 && result ? done(result) : reject(new Error(`field part ${part} exited ${code}`))));
  }))).then((parts) => parts.flat());
}

/** The fully won run of offsets around 0 in a +-FIELD_FRAMES map, as early/late margins in ms. */
export function windowOf(map) {
  const zero = FIELD_FRAMES;
  if (map[zero] !== '#') return null;
  let lo = zero; let hi = zero;
  while (lo - 1 >= 0 && map[lo - 1] === '#') lo -= 1;
  while (hi + 1 < map.length && map[hi + 1] === '#') hi += 1;
  return { earlyMs: +((zero - lo) * STEP_MS).toFixed(2), lateMs: +((hi - zero) * STEP_MS).toFixed(2),
    capped: lo === 0 || hi === map.length - 1 };
}

export function buildFieldRecord({ rows, fieldCount, laneCount, only, git, date, command }) {
  const schedules = fieldSchedules().filter((x) => !only || only.includes(x.id)).map((s: any) => {
    const row = (...parts) => rows.find((r) => r.subject === `${s.id}|${parts.join('|')}`);
    const events = fieldEvents(s.knobs, s.epochMs);
    const field = {};
    for (const t of eventTags(events)) {
      // An /end axis moved past its own press is no longer a hold (the release
      // would come first and leave the control held): 'x', and no window crosses it.
      let minD = -Infinity;
      if ((t as any).endsWith('/end')) {
        const unit = (t as any).slice(0, -'/end'.length);
        const press = events.find((e) => e.axes.length === 1 && e.axes[0] === unit);
        const release = events.find((e) => e.axes.includes(t));
        minD = -(frame(release.ms) - frame(press.ms));
      }
      const cells = [];
      for (let d = -FIELD_FRAMES; d <= FIELD_FRAMES; d += 1) {
        const r = row('field', t, d);
        cells.push(d < minD ? 'x' : r.losses.length === 0 ? '#' : r.losses.length === r.n ? '.' : '+');
      }
      const map = cells.join('');
      // An axis is placed where the event it moves last sits (a hold's /end at its release).
      const first = [...events].reverse().find((e) => e.cycle <= 0 && e.axes[e.axes.length - 1] === t) ?? events.find((e) => e.axes.includes(t));
      const atMs = t === 'ALL' ? s.epochMs : +(first.ms - (first.cycle > 0 ? first.cycle * s.knobs.loopPeriodMs : 0)).toFixed(2);
      field[t] = { atMs, map, window: windowOf(map) };
    }
    // Timing axes move a whole unit, as the jitter lane does; an `/end` axis is a
    // hold's duration, which no lane here varies, so it is ranked on its own.
    const margin = (w) => (w ? Math.min(w.earlyMs, w.lateMs) : -Infinity);
    const rank = (keep) => Object.entries(field).filter(([t]) => t !== 'ALL' && keep(t))
      .sort(([, a], [, b]) => margin((a as any).window) - margin((b as any).window));
    const worst = rank((t) => !t.endsWith('/end'))[0];
    const shortestHold = rank((t) => t.endsWith('/end'))[0];
    // The camdrop -> mask seam, as the gap the mask-ON press may sit at after the camdrop's monitor press.
    const monitor: any = Object.entries(field).find(([t]) => /^loop#\d+:camdrop\/monitor$/.test(t))?.[1] ?? null;
    const maskOn = Object.entries(field).find(([t]) => /^loop#\d+:mask$/.test(t) && field[t].atMs > (monitor?.atMs ?? Infinity));
    // On the frame grid both presses actually land on, not the nominal ms.
    const gap = monitor && maskOn ? (frame((maskOn[1] as any).atMs) - frame(monitor.atMs)) * STEP_MS : null;
    const seam = gap !== null && (maskOn[1] as any).window
      ? { gapMs: +gap.toFixed(2), fromMs: +(gap - (maskOn[1] as any).window.earlyMs).toFixed(2),
          toMs: +(gap + (maskOn[1] as any).window.lateMs).toFixed(2) }
      : null;
    const lane = (axis, values) => Object.fromEntries(values.map((v) => { const r = row(axis, v); return [v, r.n - r.losses.length]; }));
    const jitter = lane('jitter', JITTER_MS);
    const lateness = lane('late', LATENESS_MS);
    const allUpTo = (wins, values) => { let best = null; for (const v of values) { if (wins[v] === laneCount) best = v; else break; } return best; };
    const firstLoss = (axis, values, wins) => {
      const v = values.find((x) => wins[x] < laneCount);
      return v === undefined ? null : { at: v, losses: row(axis, v).losses.slice(0, 12) };
    };
    return {
      id: s.id, binding: s.path ?? null, declaredEpochMs: s.epochMs,
      ...(s.path ? { winnerSha256: s.winnerSha256 } : { knobsSha256: sha256(JSON.stringify(s.knobs)) }),
      field, worst: worst ? { event: worst[0], window: (worst[1] as any).window, marginMs: margin((worst[1] as any).window) } : null,
      shortestHold: shortestHold ? { event: shortestHold[0], window: (shortestHold[1] as any).window } : null,
      camdropMaskSeam: seam,
      jitter: { wins: jitter, n: laneCount, maxAllWinMs: allUpTo(jitter, JITTER_MS), firstLoss: firstLoss('jitter', JITTER_MS, jitter) },
      lateness: { wins: lateness, n: laneCount, maxAllWinMs: allUpTo(lateness, LATENESS_MS), firstLoss: firstLoss('late', LATENESS_MS, lateness) },
    };
  });
  const answer = schedules.map((s) => `${s.id}: worst event ${s.worst?.event ?? 'none'} ` +
    `(${s.worst ? `${s.worst.window?.earlyMs ?? '-'}/${s.worst.window?.lateMs ?? '-'} ms` : '-'}), ` +
    `camdrop->mask seam ${s.camdropMaskSeam ? `${s.camdropMaskSeam.fromMs}-${s.camdropMaskSeam.toMs} ms at ${s.camdropMaskSeam.gapMs}` : 'n/a'}, ` +
    `+-J all-win to ${s.jitter.maxAllWinMs ?? 'none'} ms (+-60: ${s.jitter.wins[60]}/${laneCount}), ` +
    `lateness to ${s.lateness.maxAllWinMs ?? 'none'} ms`).join('; ') + '.';
  return {
    schema: 'evidence-record-v1', kind: FIELD_KIND, id: `night7-robustness-field-${date.replace(/-/g, '')}`,
    claimLevel: 'MODEL_ONLY', date,
    question: 'For each press and release of each Night 7 (10/20) route, how far can it move on its own before a ' +
      'held-out seed loses, with the phone\'s mask floor applied -- and which event, and which seam, bounds the route?',
    answer,
    whyItIsModelOnly: 'No device run. The mask floor is a phone measurement applied to the simulator; the field ' +
      'moves one event class at a time, and the jitter and lateness lanes are actuator.ts\'s independent draws.',
    method: {
      tool: 'packages/propose/bin/plans/night7-robustness-field.ts', command, git,
      seeds: {
        field: { definition: `the first ${fieldCount} held-out seeds (winner-phase-census.ts heldOutSeeds)`, n: fieldCount,
          sha256: sha256(JSON.stringify(heldOutSeeds(fieldCount))) },
        lanes: { definition: `the first ${laneCount} held-out seeds`, n: laneCount, sha256: sha256(JSON.stringify(heldOutSeeds(laneCount))) },
      },
      night: '10/20 (golden-freddy: every dial at 20, clamped)',
      field: { frames: 2 * FIELD_FRAMES + 1, stepMs: STEP_MS, eventClass: 'one opening row, or one loop row in every cycle; ALL is the whole schedule',
        map: "index i is offset i - FIELD_FRAMES frames; '#' every seed wins, '+' some, '.' none, 'x' an /end moved before its press (not a hold)" },
      maskFloorMs: MASK_FLOOR_MS,
      maskFloorSource: 'artifact-commands.ts SEAM_FLOORS.maskButtonFullyVisibleAfterMonitorDownMs (native frame trace: ' +
        'absent through 322 ms, faint ~337 ms, fully visible ~382.5 ms). The conservative end: the first frame a touch ' +
        'registers lies in (322, 382.5] and is not measured.',
      jitter: `each press +-J: epoch - J and lateness [0, 2J] (actuator.ts, per press, queue serialized, mask floor on) for J in ${JITTER_MS.join(', ')}`,
      lateness: `each press late by [0, L] for L in ${LATENESS_MS.join(', ')}`,
      retime: { epochMs: RETIME_EPOCH_MS, loopKnobs: RETIME_LOOP_KNOBS, openWindMs: 'PRESET_KNOBS.openWindMs - epoch' },
      win: 'sim.won AND splitAt >= 0',
    },
    schedules,
  };
}

async function main(argv) {
  if (argv[0] === '--child') {
    const [, from, to, laneCount, only] = argv;
    process.send(laneBlock(Number(laneCount), Number(from), Number(to), only === '-' ? null : only.split(',')));
    return;
  }
  if (argv[0] === '--field-child') {
    const [, part, parts, fieldCount, only] = argv;
    process.send(fieldPart(Number(fieldCount), Number(part), Number(parts), only === '-' ? null : only.split(',')));
    return;
  }
  const flag = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i < 0 ? dflt : argv[i + 1]; };
  const fieldCount = Number(flag('count', '100'));
  const laneCount = Number(flag('lane-count', '500'));
  const jobs = Number(flag('jobs', '1'));
  const only = flag('schedules', null);
  for (const [k, v] of Object.entries({ fieldCount, laneCount, jobs }))
    if (!Number.isInteger(v) || v < 1) throw new Error(`night7-robustness-field: ${k} must be a positive integer`);
  const onlyList = only ? only.split(',') : null;
  if (onlyList) { const ids = fieldSchedules().map((s) => s.id); for (const id of onlyList) if (!ids.includes(id)) throw new Error(`unknown schedule ${id} (have ${ids.join(', ')})`); }
  const started = Date.now();
  // The field is split by (schedule, axis), the lanes by seed: either split
  // alone leaves most workers idle (all 100 field seeds sat in two of nine
  // seed blocks on the first run).
  const field = await fieldForks(fieldCount, jobs, only);
  const lanes = await forkBlocks({ script: fileURLToPath(import.meta.url), args: [String(laneCount), only ?? '-'],
    start: 0, count: laneCount, jobs });
  const rows = [...field, ...lanes];
  const record = buildFieldRecord({ rows, fieldCount, laneCount, only: onlyList, git: gitState(),
    date: flag('date', new Date().toISOString().slice(0, 10)),
    command: `node packages/propose/bin/plans/night7-robustness-field.ts --count ${fieldCount} --lane-count ${laneCount} --jobs ${jobs}${only ? ` --schedules ${only}` : ''}` });
  (record.method as any).wallSeconds = Math.round((Date.now() - started) / 1000);
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const out = flag('out', null);
  if (out) writeFileSync(out, text); else process.stdout.write(text);
  for (const s of record.schedules) {
    console.error(`== ${s.id}  worst ${s.worst?.event} ${JSON.stringify(s.worst?.window)}  seam ${JSON.stringify(s.camdropMaskSeam)}`);
    console.error(`   jitter ${JSON.stringify(s.jitter.wins)}  late ${JSON.stringify(s.lateness.wins)}`);
    for (const [t, f] of Object.entries(s.field)) console.error(`   ${t.padEnd(34)} @${String((f as any).atMs).padStart(8)} ${(f as any).map} ${(f as any).window ? `${(f as any).window.earlyMs}/${(f as any).window.lateMs}` : 'NOT WON AT 0'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
