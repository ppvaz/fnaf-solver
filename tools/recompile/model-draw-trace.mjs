#!/usr/bin/env node
// The simulator's Random(N) draws, frame by frame, in the shape the recompile
// harness traces (base/harness.cpp): one line per frame with the draws spent
// so far and the LCG state after the frame. Two runs of the same night and
// seed that spend the same number of draws on every frame read the same
// stream; the first frame where the counts part is where to look.
//
//   node tools/recompile/model-draw-trace.mjs --night 1 --seed 24850 [--frames 600] [--inputs FILE]
//
// --inputs replays `frame press|release action` rows (the simulator's own
// action names). MODEL_ONLY: this reads the model, never the game.
import { readFileSync } from 'node:fs';
import { Sim } from '@fnaf2-1020/core/mechanics';

const flag = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : process.argv[i + 1]; };
const night = Number(flag('night', '1'));
const seed = Number(flag('seed', '0'));
const frames = Number(flag('frames', '600'));
const inputs = flag('inputs', null);

export function drawTrace({ night, seed, frames, rows = [], customNight = undefined }) {
  const sim = new Sim({ night, seed, ...(customNight ? { customNight } : {}) });
  let draws = 0;
  const next = sim.rng.next.bind(sim.rng);
  sim.rng.next = () => { draws += 1; return next(); };
  const out = [{ frame: 0, draws, state: sim.rng.state }];
  let i = 0;
  while (sim.frame < frames && sim.alive && !sim.won) {
    while (i < rows.length && rows[i][0] <= sim.frame) { const [, op, action] = rows[i++]; sim[op](action); }
    sim.tick();
    out.push({ frame: sim.frame, draws, state: sim.rng.state });
  }
  return { out, death: sim.death ?? null, won: !!sim.won };
}

if (process.argv[1] && process.argv[1].endsWith('model-draw-trace.mjs')) {
  const rows = inputs ? readFileSync(inputs, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => { const [f, op, action] = l.trim().split(/\s+/); return [Number(f), op, action]; }) : [];
  const { out, death, won } = drawTrace({ night, seed, frames, rows });
  console.log(`# model night ${night} seed ${seed}: frame draws state`);
  for (const r of out) console.log(`${r.frame} ${r.draws} ${r.state}`);
  console.log(`# ${won ? 'won' : death ? `death ${death.reason} at ${out[out.length - 1].frame}` : 'alive'}`);
}
