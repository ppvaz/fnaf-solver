/** Exact Android-model evaluator for the glitchless Minus Two family. */
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { stableHash } from '@sixam/kernel/contracts';
import type { SimOptions } from '@sixam/source/games/fnaf2/plant-options.ts';

/** The Sim's own options, plus the family's box floor and stall-flash cameras. */
type MinusTwoOptions = Partial<SimOptions> & { readonly boxFloor?: number, readonly flashCams?: readonly number[] };

const PH = {
  maskOff: 1, raise: 17, camBox: 31, windOn: 33, windOff: 174,
  stallLightOn: 178, drop: 204, lightOff: 212, maskOn: 214,
  holdUnmask: 274, holdLight: 290, holdLightOff: 298, holdRemask: 299,
};

export function runMinusTwo(opts: MinusTwoOptions = {}) {
  const boxFloor = opts.boxFloor ?? 0.35;
  const cams = opts.flashCams ?? [3];
  const sim = new Sim(Object.assign({ seed: 1 }, opts));
  let eventIndex = 0, threats = 0, raised = false, minBox = 1;
  let holds = 0, maxD = 0, consecutiveHolds = 0, maxConsecutiveHolds = 0;
  while (sim.alive && !sim.won) {
    for (; eventIndex < sim.events.length; eventIndex++) {
      const event = sim.events[eventIndex];
      if (event.type === 'vent-bang' && !event.data?.cam)
        threats = Math.max(0, threats + (event.data.leaving ? -1 : 1));
    }
    const phase = sim.frame % C.MO_FRAMES;
    if (phase === PH.maskOff && sim.maskOn && !(threats > 0 || sim.blackout.active)) sim.press('mask');
    if (phase === PH.raise) {
      const mustWind = sim.box < boxFloor;
      const wantHold = (threats > 0 || sim.blackout.active) &&
        (consecutiveHolds < 2 || sim.blackout.active) && !mustWind;
      if (wantHold || sim.bb.inOpening) {
        holds++; consecutiveHolds++;
        maxConsecutiveHolds = Math.max(maxConsecutiveHolds, consecutiveHolds);
        raised = false;
        if (!sim.maskOn) sim.press('mask');
      } else {
        consecutiveHolds = 0;
        if (sim.maskOn) sim.press('mask');
        sim.press('monitor'); raised = true;
      }
    }
    if (phase === PH.drop || (!raised && phase === PH.raise + 1)) sim.press('ventR');
    if (!raised && sim.foxy.loc === 'hall' && !sim.blackout.active && !sim.foxy.gotYou) {
      if (phase === PH.holdUnmask && sim.maskOn) sim.press('mask');
      if (phase === PH.holdLight) sim.press('light');
      if (phase === PH.holdLightOff) sim.release('light');
    }
    if (!raised && phase === PH.holdRemask && !sim.maskOn) sim.press('mask');
    if (raised) {
      if (phase === PH.camBox) { sim.release('ventR'); sim.press('cam:11'); }
      if (phase === PH.windOn) sim.press('wind');
      if (phase === PH.windOff) { sim.release('wind'); sim.press(`cam:${cams[0]}`); }
      if (phase === PH.stallLightOn) sim.press('light');
      for (let i = 1; i < cams.length; i++)
        if (phase === PH.stallLightOn + 9 * i) sim.press(`cam:${cams[i]}`);
      if (phase === PH.drop) sim.press('monitor');
      if (phase === PH.lightOff) sim.release('light');
      if (phase === PH.maskOn && !sim.maskOn) sim.press('mask');
    }
    sim.tick();
    minBox = Math.min(minBox, sim.box);
    maxD = Math.max(maxD, sim.foxy.D);
  }
  return { sim, minBox, holds, maxConsecutiveHolds, maxD };
}

export function summarizeMinusTwo(opts: MinusTwoOptions = {}) {
  const result = runMinusTwo(opts);
  return {
    family: 'minus-two', seed: opts.seed ?? 1, won: result.sim.won,
    reason: result.sim.death?.reason ?? null, minBox: result.minBox,
    minPower: result.sim.power, holds: result.holds,
    maxConsecutiveHolds: result.maxConsecutiveHolds, maxD: result.maxD,
    flashCams: opts.flashCams ?? [3],
    terminal: { alive: result.sim.alive, won: result.sim.won,
      death: result.sim.death ?? null, frame: result.sim.frame },
    traceHash: stableHash(result.sim.events),
    eventCount: result.sim.events.length,
  };
}
