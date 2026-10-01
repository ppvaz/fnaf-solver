// The route units' and Puppet's value 1 (B), in global-value-5 units. g344-g360
// read B before g361-g372 drain it; moves, flashes and repels write B afterwards.
// The legacy lane keeps its update deadlines. Only one representation drives a lane.
import type { Sim } from './plant-model.ts';
type MovementClock = { stunUntil: number; stunRemaining: number };

export function unitStunLeft(sim: Sim, unit: MovementClock, frame = sim.frame) {
  return sim.opts.sourcedMovementClock ? unit.stunRemaining : Math.max(0, unit.stunUntil - frame);
}

export function unitStunReady(sim: Sim, unit: MovementClock, frame: number, beforeDrain = false) {
  if (sim.opts.sourcedMovementClock) return unit.stunRemaining === 0;
  return beforeDrain && sim.opts.sourcedBDrainOrder ? frame > unit.stunUntil : frame >= unit.stunUntil;
}

export function setUnitStun(sim: Sim, unit: MovementClock, duration: number, frame = sim.frame) {
  if (sim.opts.sourcedMovementClock) unit.stunRemaining = duration;
  else unit.stunUntil = frame + duration;
}

/** g361-g372, after every promotion test and before route moves. */
export function drainUnitStuns(sim: Sim, frame: number) {
  if (!sim.opts.sourcedMovementClock) return;
  const delta = sim.value5(frame);
  for (const unit of sim.units) unit.stunRemaining = Math.max(0, unit.stunRemaining - delta);
  sim.puppet.stunRemaining = Math.max(0, sim.puppet.stunRemaining - delta);
}
