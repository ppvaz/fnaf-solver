// Office g514, g534-g537 and g845. The clock survives encounter resolution
// until the fade clears it; a new danger edge can restart that fade first.
// Qualified on the full-06 host replays, not the retail animation clock.
import type { Sim } from './plant-model.ts';

/** g445-g447/g490 must raise danger before g514 and g534. */
export function startStreakEncounters(sim: Sim) {
  if (!sim.opts.sourcedBlackoutClockEnd || !sim.opts.sourcedSheetOrder ||
      !sim.opts.stalledEnabled || sim.viewing !== 0) return;
  for (const id of ['withbonnie', 'withchica', 'withfreddy', 'toyfreddy']) {
    const u = sim.units.find(unit => unit.id === id);
    if (u && !u.done && u.atOpening && !u.inside && !u.officeCue) sim.startOfficeEncounter(u);
  }
}

/** g514 and g517/g518, before resolution. */
export function blackoutFlicker(sim: Sim, frame: number) {
  if (!sim.opts.sourcedBlackoutDraws) return;
  const persistent = sim.opts.sourcedBlackoutClockEnd;
  if (!sim.blackout.active && !persistent) return;
  let clock = frame - sim.blackoutStartFrame + 1;
  if (sim.hooked) {
    if (sim.blackout.active)
      while (sim.blackoutClockFrame < frame) sim.blackoutClock += sim.value5(++sim.blackoutClockFrame);
    sim.blackoutClockFrame = frame;
    clock = sim.blackoutClock;
  }
  if (clock > 20 && clock < 200) sim.rng.int(0, 49, 0);
}

/** g534-g537 run even after danger clears. */
export function blackoutResolveReady(sim: Sim, frame: number) {
  if (!sim.opts.sourcedBlackoutClockEnd) return frame >= sim.blackout.until;
  const p = sim.blackoutPhase;
  if (sim.blackout.active && !p.danger) p.fade = 1;
  p.danger = sim.blackout.active;
  if (sim.blackoutClock >= 300) p.fade += sim.value5(frame);
  if (p.fade >= 250) { sim.blackoutClock = 0; p.fade = 0; }
  const threshold = sim.blackoutClock >= 300;
  const ready = threshold && !p.threshold;
  p.threshold = threshold;
  return ready;
}

/** g845 requests completion; next loop's g534 can restart the fade first. */
export function blackoutLate(sim: Sim) {
  if (!sim.opts.sourcedBlackoutClockEnd) return;
  const p = sim.blackoutPhase;
  const viewing = sim.viewing > 0 && p.fade > 0;
  if (viewing && !p.viewing) p.fade = 250;
  p.viewing = viewing;
}
