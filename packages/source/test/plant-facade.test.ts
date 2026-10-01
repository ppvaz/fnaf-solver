// The PlantModel facade (plant-model-v1) plays the same night as the Sim it extends. Its
// `advance(targetFrame)` is the port's clock; the Sim's own unit move was also called `advance`,
// so the facade's method shadowed it and the first animatronic move of any PlantModel night threw
// a RangeError ("target frame must not move backwards") at frame 300 (found 2026-09-30 while
// splitting plant-model.js). The unit move is `advanceUnit` inside the Sim now.
import assert from 'node:assert/strict';
import { PlantModel } from '../src/games/fnaf2/plant.ts';
import { Sim } from '../src/games/fnaf2/plant-model.ts';

const OPTS = { seed: 41, night: 7 };
const plant = new PlantModel(OPTS);
const sim = new Sim(OPTS);
assert.doesNotThrow(() => plant.advance(60 * 60), 'a PlantModel night survives its first unit move');
while (sim.frame < plant.frame && sim.alive) sim.tick();
assert.equal(plant.frame, sim.frame, 'the facade and the Sim reach the same frame');
assert.deepEqual(plant.terminalState(), Object.freeze({ alive: sim.alive, won: sim.won, death: sim.death, frame: sim.frame }),
  'the facade plays the Sim\'s night, not another one');
assert.equal(plant.rng.state, sim.rng.state, 'the same draws were taken');
assert.throws(() => plant.advance(plant.frame - 1), /must not move backwards/, 'the port clock still refuses to go back');
assert.equal(typeof Sim.prototype.advanceUnit, 'function');
console.log(`plant facade: a PlantModel night matches the Sim to frame ${plant.frame} and keeps its clock's refusal`);
