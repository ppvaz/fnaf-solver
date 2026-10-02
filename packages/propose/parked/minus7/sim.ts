// A searchable wrapper over the authoritative transition model in
// packages/source/src/games/fnaf2/plant-model.ts.
//
// Nothing here is a new game rule. That module is the only authority; this
// file only (a) clones a Sim so a search can branch, (b) compiles a small set
// of SEMANTIC player actions into the exact button presses the engine already
// understands, and (c) exposes the sourced state a policy is allowed to read.
//
// The semantic action set is the compressed vocabulary a Minus 7 player
// actually uses -- lower/raise, mask on/off, select+flash a camera, hold the
// hall light, hold a vent light, wind. Physical touch coordinates never enter
// the search; they belong to the controller layer (packages/propose/bin/plans/recipe.ts).
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';

// ---------------------------------------------------------------- cloning
// Verified: a JSON round-trip plus a prototype/RNG fix-up reproduces the
// engine bit-for-bit across a further 600 ticks (see the tool's self-test).
export function cloneSim(sim: Sim): Sim {
  const c = Object.assign(Object.create(Sim.prototype), JSON.parse(JSON.stringify(sim)));
  c.rng = Object.assign(Object.create(Object.getPrototypeOf(sim.rng)),
    { seed: sim.rng.seed, state: sim.rng.state, worst: sim.rng.worst });
  return c;
}

// ---------------------------------------------------------------- state view
// Only variables that can affect a future transition. Office pan, render-only
// flicker, and object handles are deliberately absent.
export function view(sim: Sim) {
  const u = (id: string) => sim.units.find(x => x.id === id);
  return {
    frame: sim.frame,
    hour: Math.floor(sim.frame / C.HOUR_FRAMES),
    alive: sim.alive, won: sim.won,
    monitor: sim.monitor, maskOn: sim.maskOn, maskAnim: sim.maskAnim,
    maskFullyOn: sim.maskFullyOn, maskFullyOff: sim.maskFullyOff,
    markerCam: sim.cam, viewing: sim.viewing, lastViewed: sim.lastViewed,
    lightHeld: sim.lightHeld, winding: sim.isWinding,
    ventLightL: sim.ventLightL, ventLightR: sim.ventLightR,
    box: sim.box, power: sim.power,
    foxyD: sim.foxy.D, foxyLoc: sim.foxy.loc, foxyGotYou: sim.foxy.gotYou,
    foxyExposure: sim.foxy.exposure,
    bbOpening: sim.bb.inOpening, bbInside: sim.bb.inside, bbStage: sim.bb.stage,
    bbMaskTicks: sim.bb.maskTicks,
    gfPresent: sim.gf.present, gfInHall: sim.gf.inHall,
    blackout: sim.blackout.active,
    puppetStage: sim.puppet.stage, puppetInside: sim.puppet.inside,
    attackExecuting: sim.attackExecuting,
    atOpening: sim.units.filter(x => x.atOpening).map(x => x.id),
    inside: sim.units.filter(x => x.inside).map(x => x.id),
    committed: sim.units.filter(x => x.committedAt >= 0).map(x => x.id),
    // stun remaining on each target camera, and whether anyone stands there
    stun: C.TARGET_CAMS.map(camId => {
      let best = 0, here = false;
      for (const x of sim.units) {
        if (x.done || x.path[x.idx] !== camId) continue;
        here = true;
        best = Math.max(best, sim.unitStunLeft(x));
      }
      return { camId, stun: best, occupied: here };
    }),
  };
}

// ---------------------------------------------------------------- actions
// Each action is a *plan* of {at, press|release} offsets from now, plus the
// number of frames it occupies. `run()` applies it against the engine. The
// engine's own legality rules (a masked player cannot use lights, the mask is
// refused while the monitor is up, a raise with Golden Freddy present kills)
// are left to the engine -- an illegal action simply produces a bad outcome
// the search prunes, exactly as it would on the phone.
/** The sourced state a policy reads. */
export type View = ReturnType<typeof view>;
/** One step of an action: its frame offset from now, press or release, and the control. */
type ActionStep = [number, 'press' | 'release', string];
/** A compiled action: the frames it occupies and its steps. */
export interface ActionPlan { frames: number; steps: ActionStep[] }
const F = C.FPS;
const camAct = (n: number) => `cam:${n}`;

export const ACTIONS: Readonly<Record<string, (s: View) => ActionPlan>> = {
  // Do nothing for one decision window.
  WAIT: () => ({ frames: 15, steps: [] }),

  // Lower the monitor (no-op cost if already down/lowering).
  LOWER: (s) => s.monitor === 'up' || s.monitor === 'raising'
    ? { frames: 24, steps: [[0, 'press', 'monitor']] }
    : { frames: 6, steps: [] },

  // Raise the monitor.
  RAISE: (s) => s.monitor === 'down' || s.monitor === 'lowering'
    ? { frames: 14, steps: [[0, 'press', 'monitor']] }
    : { frames: 6, steps: [] },

  // Toggle the mask ON (Golden Freddy clear + Balloon Boy repel).
  MASK_ON: (s) => s.maskOn ? { frames: 6, steps: [] }
    : { frames: 14, steps: [[0, 'press', 'mask']] },
  MASK_OFF: (s) => !s.maskOn ? { frames: 6, steps: [] }
    : { frames: 16, steps: [[0, 'press', 'mask']] },

  // A prophylactic mask flick: on, then off. Clears Golden Freddy on the
  // press (g336) without committing to the five-tick Balloon Boy hold.
  FLICK: (s) => ({ frames: 22, steps: [[0, 'press', 'mask'], [12, 'press', 'mask']] }),

  // Hold the mask for the full window (Balloon Boy five-tick repel).
  HOLD_MASK: (s) => ({ frames: 62,
    steps: s.maskOn ? [] : [[0, 'press', 'mask']] }),

  // Flash the hall (monitor must be down, mask off): resets Foxy's D to 0
  // while he is in the hall, decays it by 1/30fr while he is in Parts.
  HALL_FLASH: (s) => ({ frames: 18,
    steps: [[0, 'press', 'light'], [8, 'release', 'light']] }),

  // Hold the hall light for the whole window (eviction: banks Foxy exposure
  // toward the 100*night retreat threshold, and pays D down in Parts).
  HALL_HOLD: (s) => ({ frames: 62,
    steps: [[0, 'press', 'light'], [60, 'release', 'light']] }),

  // Refresh the three stall cameras (10, 4, 7) with a pulsed flash each --
  // the camera-light stun is 400 frames and re-arms every lit frame while
  // the camera is selected (g450-457).
  SWEEP: (s) => ({ frames: 34, steps: [
    [0, 'press', camAct(10)], [1, 'press', 'light'], [7, 'release', 'light'],
    [12, 'press', camAct(4)], [13, 'press', 'light'], [19, 'release', 'light'],
    [24, 'press', camAct(7)], [25, 'press', 'light'], [31, 'release', 'light'],
  ] }),

  // Sit on the box camera and wind for the whole window.
  WIND: (s) => ({ frames: 40, steps: [
    [0, 'press', camAct(C.BOX_CAM)], [2, 'press', 'wind'], [38, 'release', 'wind'],
  ] }),
  WIND_LONG: (s) => ({ frames: 90, steps: [
    [0, 'press', camAct(C.BOX_CAM)], [2, 'press', 'wind'], [88, 'release', 'wind'],
  ] }),

  // Hold the left vent light (the sourced Balloon Boy read).
  VENTL: (s) => ({ frames: 34, steps: [
    [0, 'press', 'ventL'], [32, 'release', 'ventL'],
  ] }),
};

// Apply a compiled action against the engine, ticking frame by frame.
export function run(sim: Sim, plan: ActionPlan) {
  const { frames, steps } = plan;
  const byFrame = new Map<number, [ActionStep[1], string][]>();
  for (const [at, kind, act] of steps) {
    if (!byFrame.has(at)) byFrame.set(at, []);
    (byFrame.get(at) as [ActionStep[1], string][]).push([kind, act]); // set just above when missing
  }
  for (let i = 0; i < frames && sim.alive && !sim.won; i++) {
    for (const [kind, act] of byFrame.get(i) || [])
      kind === 'press' ? sim.press(act) : sim.release(act);
    sim.tick();
  }
  return sim;
}
