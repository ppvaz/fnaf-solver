#!/usr/bin/env node
// A committed winner binding's own tap schedule as recompile-harness input.
//
//   node packages/propose/bin/recompile/schedule-to-input.ts --winner packages/propose/bindings/fnaf2/campaign-night1-minimal-winner.json
//        --night 1 --out FILE [--navigation packages/source/recompile/fixtures/night1-newgame.input]
//        [--profile packages/play/profiles/fnaf2/moto-g56/hid-mediaprojection.json] [--frame 3]
//
// The schedule is the one the binding's gate replays (bundle.ts STRATEGY_REGISTRY[s].emit(winner,
// night).replay(seed)): minus-toys-plan.ts build(knobs) rows at the winner's epoch (anchorEpochMs +
// phaseOffsetMs), expanded with schedule()'s arithmetic and quantized to the 60 Hz model frame
// (Math.round(ms * 60 / 1000)). The same expansion yields the Sim queue, and it must equal
// schedule()'s queue row for row, or the tool refuses: the harness and the model get one schedule.
//
// Office tick = queue frame. The model applies a press queued at frame F before its tick F -> F+1,
// and compare-draw-trace.mjs compares harness office update F with model frame F+1.
// A tap or hold is `down` at its press frame and `up` at its release frame (the row's own contact
// or hold length); a camdrop holds the camera-feed light and taps the monitor as a second contact,
// as packages/play/src/campaign/hid-schedule.ts sends it; a hall row is the hallLight control.
// Points: the device profile's controlMap (the phone's touch points, 2400 x 1080) mapped into the
// game's 1024 x 768 window by Display Mode FULL's stretch (x * 1024 / 2400, y * 768 / 1080;
// packages/source/recompile/native-frame.py), rounded to whole window pixels.
// Pointers: the lowest id free at each press (only overlapping contacts get a second one).
// Same-tick edges -- two presses, or a release and a press, on one update -- are listed: the
// harness raises one new-touch trigger per update, where Android dispatches every touch.
//
// Content-free: control names, times and window points only. MODEL_ONLY input; no device claim.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MODEL_CONTEXT_LIGHT } from '@sixam/source';
import { STRATEGY_REGISTRY, validateWinner } from '../plans/bundle.ts';
import { KNOBS0, build, schedule } from '../plans/minus-toys-plan.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const FPS = 60;
export const OFFICE_FRAME = 3;
export const DEFAULT_PROFILE = 'packages/play/profiles/fnaf2/moto-g56/hid-mediaprojection.json';
// Display Mode FULL fills the 2400 x 1080 native frame with the 1024 x 768 game frame.
export const NATIVE = Object.freeze([2400, 1080]);
export const WINDOW = Object.freeze([1024, 768]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const frameOf = (ms) => Math.round(ms * FPS / 1000);

/** The profile's control points in window pixels, one per control name the schedules use. */
export function controlPoints(profile) {
  if (!profile?.controlMap) throw new Error('profile has no controlMap');
  const scroll = profile.viewScroll ?? {};
  if (scroll.windowWidth !== WINDOW[0] || scroll.windowHeight !== WINDOW[1] || !String(profile.geometry).includes(`${NATIVE[0]}x${NATIVE[1]}`))
    throw new Error(`profile geometry is not a ${NATIVE.join('x')} native frame over a ${WINDOW.join('x')} window`);
  const points = {};
  for (const [control, point] of Object.entries(profile.controlMap)) {
    if (!Number.isFinite((point as any)?.x) || !Number.isFinite((point as any)?.y)) continue;
    points[control] = [Math.round((point as any).x * WINDOW[0] / NATIVE[0]), Math.round((point as any).y * WINDOW[1] / NATIVE[1])];
  }
  return points;
}

// A plan control's profile key (cam9 -> cam:9) and its Sim action (as minus-toys-plan.ts actionFor).
const profileKey = (control) => (/^cam\d+$/.test(control) ? `cam:${control.slice(3)}` : control);
export const simAction = (control) => (/^cam\d+$/.test(control) ? `cam:${control.slice(3)}`
  : control === 'cameraFeedLight' || control === 'hallLight' ? MODEL_CONTEXT_LIGHT : control);

/** The same measured intervals used by the harness, expressed in the source model's actions. */
export const modelContacts = (contacts) => contacts.map(({ control, downFrame, upFrame }) =>
  ({ action: simAction(control), downFrame, upFrame }));

/**
 * Contacts and the Sim queue from one expansion of opening/loop/finish rows (schedule()'s loop bounds
 * and arithmetic, shift 0). A contact is { control, downMs, upMs, downFrame, upFrame, cycle, index }.
 */
export function expandRows({ opening, loop, finish = [], periodMs, loopStartMs = 0, untilMs = 420000, epochMs = 0 }) {
  const contacts = [];
  const queue = [];
  const contact = (control, downMs, upMs, cycle, index) => {
    const downFrame = frameOf(downMs);
    const upFrame = frameOf(upMs);
    if (upFrame <= downFrame) throw new Error(`${cycle}[${index}] ${control}: a ${upMs - downMs} ms contact is shorter than one ${FPS} Hz update`);
    contacts.push({ control, downMs, upMs, downFrame, upFrame, cycle, index });
  };
  const add = (cycle, index, base, row) => {
    const [at, kind, a, b, cc] = row;
    const when = base + at + epochMs;
    if (kind === 'tap') {
      queue.push([frameOf(when), 'press', simAction(a)]);
      contact(a, when, when + b, cycle, index);
    } else if (kind === 'hold' || kind === 'hall') {
      const control = kind === 'hall' ? 'hallLight' : a;
      const duration = kind === 'hall' ? a : b;
      queue.push([frameOf(when), 'press', simAction(control)], [frameOf(when + duration), 'release', simAction(control)]);
      contact(control, when, when + duration, cycle, index);
    } else if (kind === 'camdrop') {
      queue.push([frameOf(when), 'press', MODEL_CONTEXT_LIGHT], [frameOf(when + a), 'press', 'monitor'],
        [frameOf(when + a + b + cc), 'release', MODEL_CONTEXT_LIGHT]);
      contact('cameraFeedLight', when, when + a + b + cc, cycle, index);
      contact('monitor', when + a, when + a + b, cycle, index);
    } else throw new Error(`${cycle}[${index}]: row kind ${kind} has no harness form`);
  };
  opening.forEach((row, i) => add('opening', i, 0, row));
  for (let base = loopStartMs; base < untilMs; base += periodMs) loop.forEach((row, i) => add('loop', i, base, row));
  finish.forEach((row, i) => add('finish', i, 0, row));
  return { contacts: contacts.sort((x, y) => x.downFrame - y.downFrame || x.upFrame - y.upFrame), queue: queue.sort((x, y) => x[0] - y[0]) };
}

/**
 * The schedule a winner's gate replays on `night`, as contacts and the Sim queue. Refuses a strategy
 * or knob whose replay presses anything the schedule does not (minus-toys only; reactiveBB off).
 */
export function winnerSchedule(winner, night) {
  const valid = validateWinner(winner);
  if (!valid.nights.includes(night)) throw new Error(`the binding does not name night ${night}`);
  if (valid.strategy !== 'minus-toys') throw new Error(`strategy ${valid.strategy}: only minus-toys schedules have a harness form yet`);
  const emitted = STRATEGY_REGISTRY[valid.strategy].emit(valid, night);
  const kk = { ...KNOBS0, ...emitted.knobs };
  if (kk.reactiveBB) throw new Error('reactiveBB adds presses the schedule does not hold; no harness form');
  const epochMs = (valid.anchorEpochMs ?? 0) + (valid.phaseOffsetMs ?? 0);
  const rows = build(emitted.knobs);
  const bounds = { periodMs: kk.minimal ? kk.minPeriodMs : kk.loopPeriodMs, loopStartMs: kk.minimal ? kk.minLoopStartMs : 0,
    untilMs: kk.minimal ? kk.minStopAtMs : 420000, epochMs };
  const expanded = expandRows({ ...rows, ...bounds });
  const replayQueue = schedule({ ...rows, ...bounds });
  if (JSON.stringify(replayQueue) !== JSON.stringify(expanded.queue)) throw new Error('the expansion does not reproduce the replay schedule');
  return { strategy: valid.strategy, night, epochMs, ...bounds, emitted, ...expanded };
}

/**
 * Harness rows on `frame` for the contacts: { rows: [{ tick, op, pointer, x, y, control }], sameTickEdges }.
 * Releases sort before presses on one tick, so a freed pointer can be taken again.
 */
export function harnessRows(contacts, points, { frame = OFFICE_FRAME } = {}) {
  const active = new Map();   // pointer -> release frame
  const edges = [];
  for (const c of contacts) {
    const point = points[profileKey(c.control)];
    if (!point) throw new Error(`control ${c.control} is absent from the profile's controlMap`);
    for (const [pointer, up] of active) if (up <= c.downFrame) active.delete(pointer);
    let pointer = 0;
    while (active.has(pointer)) pointer += 1;
    active.set(pointer, c.upFrame);
    edges.push({ tick: c.downFrame, op: 'down', pointer, x: point[0], y: point[1], control: c.control },
      { tick: c.upFrame, op: 'up', pointer, control: c.control });
  }
  const rank = { up: 0, down: 1 };
  edges.sort((a, b) => a.tick - b.tick || rank[a.op] - rank[b.op] || a.pointer - b.pointer);
  const byTick = new Map();
  for (const e of edges) byTick.set(e.tick, [...(byTick.get(e.tick) ?? []), e]);
  const sameTickEdges = [...byTick].filter(([, list]) => list.filter((e) => e.op === 'down').length > 1 ||
    (list.some((e) => e.op === 'down') && list.some((e) => e.op === 'up')))
    .map(([tick, list]) => ({ tick, edges: list.map((e) => `${e.op} ${e.control}`) }));
  return { frame, rows: edges, sameTickEdges };
}

export function formatRows({ frame, rows }) {
  return rows.map((r) => (r.op === 'down' ? `${frame} ${r.tick} down ${r.pointer} ${r.x} ${r.y}` : `${frame} ${r.tick} up ${r.pointer}`)).join('\n') + '\n';
}

/** Navigation text (unchanged, never on `frame`) followed by the schedule's office rows. */
export function harnessInput({ navigation = '', schedule: sched, points, frame = OFFICE_FRAME, header = [] }) {
  if (navigation.split('\n').some((line) => line.trim() && !line.trim().startsWith('#') && Number(line.trim().split(/\s+/)[0]) === frame))
    throw new Error(`navigation input already acts on frame ${frame}`);
  const office = harnessRows(sched.contacts, points, { frame });
  const body = formatRows(office);
  const nav = navigation && !navigation.endsWith('\n') ? `${navigation}\n` : navigation;
  return { text: `${nav}${header.map((h) => `# ${h}\n`).join('')}${body}`, office, officeSha256: sha256(body) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args: any = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!['--winner', '--night', '--out', '--navigation', '--profile', '--frame'].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error('see usage at top of file');
    args[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  if (!args.winner || !args.night || !args.out) throw new Error('--winner, --night and --out are required');
  const night = Number(args.night);
  const frame = Number(args.frame ?? OFFICE_FRAME);
  const profilePath = args.profile ?? join(ROOT, DEFAULT_PROFILE);
  const sched = winnerSchedule(JSON.parse(readFileSync(args.winner, 'utf8')), night);
  const points = controlPoints(JSON.parse(readFileSync(profilePath, 'utf8')));
  const navigation = args.navigation ? readFileSync(args.navigation, 'utf8') : '';
  const header = [`schedule-to-input: ${relative(ROOT, resolve(args.winner))} night ${night}, epoch ${sched.epochMs} ms, frame ${frame}`,
    `profile ${relative(ROOT, resolve(profilePath))} sha256 ${sha256(readFileSync(profilePath))}; FULL stretch ${NATIVE.join('x')} -> ${WINDOW.join('x')}`];
  const { text, office, officeSha256 } = harnessInput({ navigation, schedule: sched, points, frame, header });
  writeFileSync(args.out, text);
  console.log(`${args.out}: ${sched.contacts.length} contacts, ${office.rows.length} office rows (sha256 ${officeSha256.slice(0, 16)}), ` +
    `${office.sameTickEdges.length} same-tick edge sets, last office row tick ${office.rows.at(-1)?.tick ?? '-'}`);
}
