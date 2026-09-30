#!/usr/bin/env node
// The simulator's Random(N) draws, frame by frame, in the shape the recompile
// harness traces (base/harness.cpp): one line per frame with the draws spent
// so far and the LCG state after the frame. Two runs of the same night and
// seed that spend the same number of draws on every frame read the same
// stream; the first frame where the counts part is where to look.
//
//   node tools/recompile/model-draw-trace.mjs --night 1 --seed 24850 [--frames 600] [--inputs FILE] [--model-options FILE]
//
// --inputs replays `frame press|release action` rows (the simulator's own
// action names). MODEL_ONLY: this reads the model, never the game.
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rng, Sim } from '@sixam/core/mechanics';

// The Sim measured here must be this checkout's. A git worktree without its own node_modules resolves
// @sixam/core up the tree to the parent checkout's package, and a record would then describe a model
// other than the one beside the tool (2026-09-27: a drop-flag replay ran the parent's model, unchanged).
const MECHANICS = fileURLToPath(import.meta.resolve('@sixam/core/mechanics'));
/** The files that define the Sim this tool loaded, for a record's provenance. */
export const MODEL_SOURCES = Object.freeze(['plant-model.js', 'config.js', 'rng.js'].map((name) => join(dirname(MECHANICS), name)));
if (relative(join(dirname(fileURLToPath(import.meta.url)), '../..'), MECHANICS).startsWith('..'))
  throw new Error(`@sixam/core resolves outside this checkout (${MECHANICS}): run npm ci here`);

const flag = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : process.argv[i + 1]; };
const night = Number(flag('night', '1'));
const seed = Number(flag('seed', '0'));
const frames = Number(flag('frames', '600'));
const inputs = flag('inputs', null);
const optionsFile = flag('model-options', null);

// A model option is a sourced* boolean, or a constant for the frame-time hook
// (frameMs, frameValue5): JSON cannot carry the hook's per-frame functions.
// The model's named research knobs are booleans too.
const HOOK_CONSTANTS = ['frameMs', 'frameValue5'];
const RESEARCH_KNOBS = ['footstepFoxy', 'footstepCamMarkers'];
const validOption = ([key, value]) => ((/^sourced[A-Z]/.test(key) || RESEARCH_KNOBS.includes(key)) && typeof value === 'boolean') ||
  (HOOK_CONSTANTS.includes(key) && Number.isFinite(value) && value > 0);

/** A model-options JSON object as Sim options: each hook constant becomes its per-frame function. */
export function simOptionsFrom(modelOptions) {
  if (!modelOptions || Array.isArray(modelOptions) || typeof modelOptions !== 'object' || !Object.entries(modelOptions).every(validOption)) {
    throw new Error('model options must be sourced* or research-knob booleans, or positive frameMs/frameValue5 constants');
  }
  return Object.fromEntries(Object.entries(modelOptions)
    .map(([key, value]) => [key, HOOK_CONSTANTS.includes(key) ? () => value : value]));
}

/**
 * A measured clock for the frame-time hook: `frameTimes[f - 1]` is frame f's timer delta in ms (the
 * harness's office update f - 1 under CHOWDREN_FRAME_TIMES), 50/3 past the list; global value 5 is the
 * sheet's min(4, delta / (1000 / 60)). Requires the options to carry the hook already (frameMs).
 * @param {number[]} frameTimes
 */
export function measuredClock(frameTimes) {
  if (!Array.isArray(frameTimes) || !frameTimes.length || !frameTimes.every((ms) => Number.isFinite(ms) && ms > 0))
    throw new Error('frameTimes must be a non-empty list of positive ms');
  const frameMs = (/** @type {number} */ f) => frameTimes[f - 1] ?? 1000 / 60;
  return { frameMs, frameValue5: (/** @type {number} */ f) => Math.min(4, frameMs(f) / (1000 / 60)) };
}

/**
 * `rows` are `[frame, press|release, action]` applied before the tick from `frame` (as a gate replay
 * applies its queue); `observe(sim)`, if given, is read at frame 0 and after every tick into `observed`.
 * `frameTimes` (optional) replaces the hook constants with a measured per-frame clock (measuredClock).
 */
export function drawTrace({ night, seed, frames, rows = [], customNight = undefined, modelOptions = {}, observe = null,
  frameTimes = null }) {
  const simOptions = simOptionsFrom(modelOptions);
  if (frameTimes) {
    if (!modelOptions.frameMs) throw new Error('a measured clock replaces the frame-time hook: the options must carry frameMs');
    const clock = measuredClock(frameTimes);
    // sourcedValue5 derives global value 5 from frameMs as g1236 writes it (the previous loop's delta over its
    // 32.32 divisor), and refuses a frameValue5 beside it: the measured clock then supplies frameMs alone.
    Object.assign(simOptions, modelOptions.sourcedValue5 ? { frameMs: clock.frameMs } : clock);
  }
  let draws = 0;
  // Sim's constructor spends draws too (for example Foxy's initial readyAt).
  // Instrument its synchronous construction, restoring the shared prototype
  // even on failure, then keep instrumentation local to this one instance.
  const originalNext = Rng.prototype.next;
  let sim;
  try {
    Rng.prototype.next = function () { draws += 1; return originalNext.call(this); };
    sim = new Sim({ ...simOptions, night, seed, ...(customNight ? { customNight } : {}) });
  } finally {
    Rng.prototype.next = originalNext;
  }
  const next = sim.rng.next.bind(sim.rng);
  sim.rng.next = () => { draws += 1; return next(); };
  const out = [{ frame: 0, draws, state: sim.rng.state }];
  const observed = observe ? [observe(sim)] : null;
  let i = 0;
  while (sim.frame < frames && sim.alive && !sim.won) {
    while (i < rows.length && rows[i][0] <= sim.frame) { const [, op, action] = rows[i++]; sim[op](action); }
    sim.tick();
    out.push({ frame: sim.frame, draws, state: sim.rng.state });
    if (observed) observed.push(observe(sim));
  }
  return { out, death: sim.death ?? null, won: !!sim.won, ...(observed ? { observed } : {}) };
}

if (process.argv[1] && process.argv[1].endsWith('model-draw-trace.mjs')) {
  const rows = inputs ? readFileSync(inputs, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const [f, op, action] = l.trim().split(/\s+/); return [Number(f), op, action]; }) : [];
  const modelOptions = optionsFile ? JSON.parse(readFileSync(optionsFile, 'utf8')) : {};
  const { out, death, won } = drawTrace({ night, seed, frames, rows, modelOptions });
  console.log(`# model night ${night} seed ${seed}: frame draws state`);
  console.log(`# options ${JSON.stringify(modelOptions)}`);
  for (const r of out) console.log(`${r.frame} ${r.draws} ${r.state}`);
  console.log(`# ${won ? 'won' : death ? `death ${death.reason} at ${out[out.length - 1].frame}` : 'alive'}`);
}
