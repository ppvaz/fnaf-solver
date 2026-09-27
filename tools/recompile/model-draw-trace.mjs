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
import { Rng, Sim } from '@fnaf2-1020/core/mechanics';

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
 * `rows` are `[frame, press|release, action]` applied before the tick from `frame` (as a gate replay
 * applies its queue); `observe(sim)`, if given, is read at frame 0 and after every tick into `observed`.
 */
export function drawTrace({ night, seed, frames, rows = [], customNight = undefined, modelOptions = {}, observe = null }) {
  const simOptions = simOptionsFrom(modelOptions);
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
