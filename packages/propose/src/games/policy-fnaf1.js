// ---------------------------------------------------------------------------
// FNaF 1 policies, written from the published community strategies.
//
// References, both already in this repository:
//
//   - `plans/26-second-target-fnaf-1-3-4.md`: the 4/20 loop is
//     `Left Door Light -> Camera -> Right Door Light -> Camera -> repeat`,
//     dominated by the right door, with Foxy held by camera attention and
//     power discipline as the binding constraint.
//   - `docs/research/FNAF-SENSOR-ABLATION-RUNS.md`: the door lights are not
//     load-bearing -- a public clear exists that replaces the light with
//     continuous camera tracking and pays for it in power -- and the power
//     arithmetic (`usage = 1 + Sigma`, 999 units, ~89 s hours) is confirmed
//     against the dump.
//
// **Every policy here is observation-limited.** It may read a door light
// (which shows whether someone is at that door), a camera (which shows who is
// on it), and the HUD's hour and power. It never reads a position the player
// is not looking at. A policy that consulted simulator state directly would
// win more and mean nothing.
//
// Two things the source says that change how the published loop should be
// played, and that the published accounts do not state:
//
//   1. **Foxy's hold is re-rolled, not accumulated** [SOURCED: g460 sets the
//      timer to `50 + Random(1000)` **every 100 ms** while any camera is up;
//      g445 drains it 1 per frame; g321 needs it at 0]. Each tick *replaces*
//      the value, so dwelling on a camera just re-rolls a hold worth
//      0.83-17.5 s, mean ~9.2 s. A flick buys nearly the same expected hold as
//      a dwell, at a fraction of the power. The loop below therefore flicks.
//
//   2. **Holding a light to watch a shut door is the single most expensive
//      thing a player can do**, because `usage` counts the light and the door
//      separately [SOURCED: g313]. The loop shuts the door for a fixed dwell
//      and re-checks with a flash, rather than watching continuously.
// ---------------------------------------------------------------------------

import { DOOR_OPEN, DOOR_SHUT } from '@sixam/source/games/fnaf1/sim-fnaf1.js';

// View ids [SOURCED: g556/g557 gate Freddy on `viewing <> 42` and `<> 4`;
// g60 fires Foxy's run at `viewing = 3`; g90-g94 render Pirate Cove at 99].
export const CAM = { showStage: 1, dining: 2, westHall: 3, eastHall: 4,
                     backstage: 5, kitchen: 6, restrooms: 7,
                     westCorner: 22, supply: 33, eastCorner: 42, pirate: 99 };

/**
 * The published loop, with the four knobs it leaves implicit.
 *
 * A cycle is: flash the left light, flick the camera, flash the right light,
 * flick the camera, idle. A door that a flash finds occupied shuts for
 * `doorFrames` and is then re-checked by the next flash on that side.
 *
 * @param {object} knobs
 * @param {number} knobs.lightFrames  frames a door-light flash lasts
 * @param {number} knobs.camFrames    frames a camera flick lasts
 * @param {number} knobs.doorFrames   frames a door stays shut before re-check
 * @param {number} knobs.idleFrames   frames of nothing at the end of a cycle
 * @param {number} knobs.park         which camera the flick selects
 */
/**
 * Is the reserve ahead of a straight-line burn to 6 AM?
 *
 * Both readings are on the HUD: `power left 2` is the displayed power and the
 * hour is rendered beside it, so this is an observation a player can make.
 * `slack` is how far ahead of the line the loop insists on being before it
 * spends on a camera.
 */
function onBudget(sim, slack) {
  const elapsed = sim.frame / 60;
  const remaining = Math.max(0, 535 - elapsed) / 535;
  // `>=`, not `>`: at frame 0 the reserve is exactly on the line, and a
  // strict compare cuts the camera for the whole night from the first tick.
  return sim.power >= 999 * remaining * slack;
}

export function communityLoop({
  lightFrames = 1, camFrames = 6, camEvery = 44, checkEvery = 60,
  heldCheckEvery = 12,
  maxShutFrames = Infinity, budgetSlack = 0.5, bothLights = false,
  park = CAM.eastCorner,
} = {}) {
  // The published loop is "light, camera, light, camera", but the two are
  // **independent rhythms** and coupling them into one phase machine wastes
  // power: the light check has to keep pace with a character arriving at a
  // door, while the camera only has to keep pace with Foxy's hold expiring,
  // and those are different clocks.
  //
  // The camera rhythm has a floor the source hands us. g460 re-sets Foxy's
  // hold to `50 + Random(1000)` every 100 ms of *viewing* time, so the
  // smallest useful flick is 100 ms (6 frames at 60 Hz) and the worst draw it
  // can return is **50 frames = 0.83 s**. Flick at least that often and Foxy
  // is never free; flick more often than that and the extra is pure spend.
  // `camEvery = 45` sits just inside the 50-frame worst case, which is the
  // project's own seam-slack habit applied to a draw floor.
  let frame = 0;
  let leftOccupied = false;
  let rightOccupied = false;
  let leftShutFor = 0;
  let rightShutFor = 0;

  return (sim) => {
    if (sim.blackout) return;
    frame += 1;

    if (leftOccupied && leftShutFor > maxShutFrames) leftOccupied = false;
    if (rightOccupied && rightShutFor > maxShutFrames) rightOccupied = false;
    sim.leftDoor = leftOccupied ? DOOR_SHUT : DOOR_OPEN;
    sim.rightDoor = rightOccupied ? DOOR_SHUT : DOOR_OPEN;
    leftShutFor = leftOccupied ? leftShutFor + 1 : 0;
    rightShutFor = rightOccupied ? rightShutFor + 1 : 0;
    sim.leftLight = 0; sim.rightLight = 0; sim.viewing = 0;

    // The camera flick, on its own clock and only while the reserve allows.
    const inFlick = frame % camEvery < camFrames;
    if (inFlick && onBudget(sim, budgetSlack)) sim.viewing = park;

    // The door checks, and the one piece of arithmetic that decides this
    // night. A shut door costs a full unit per second for as long as the
    // belief stands; a light flash costs **one frame**, which is 1/60 of a
    // unit. So a check is about sixty times cheaper than a second of hold,
    // and the expensive mistake is not looking too often -- it is holding a
    // door for the seconds between noticing they left and finding out.
    //
    // The rate is therefore conditional, which is also what a player does:
    // keep tapping the light while a door is shut so it opens the instant the
    // hall is clear, and check lazily while it is open, where the only job is
    // to catch an arrival before its next roll ~298 frames later.
    // Both lights in the same frame, optionally. Each costs a unit per second
    // while lit, so a simultaneous one-frame flash costs 2/60 of a unit --
    // and it halves the worst-case gap between a character arriving at a door
    // and the player finding out, because neither side waits its turn.
    if (bothLights && frame % checkEvery === 0) {
      sim.leftLight = 1; sim.rightLight = 1;
      leftOccupied = sim.atLeftDoor();
      rightOccupied = sim.atRightDoor();
      sim.leftDoor = leftOccupied ? DOOR_SHUT : DOOR_OPEN;
      sim.rightDoor = rightOccupied ? DOOR_SHUT : DOOR_OPEN;
      return;
    }
    const leftRate = leftOccupied ? heldCheckEvery : checkEvery;
    const rightRate = rightOccupied ? heldCheckEvery : checkEvery;
    if (frame % leftRate === 0) {
      sim.leftLight = 1;
      leftOccupied = sim.atLeftDoor();
      sim.leftDoor = leftOccupied ? DOOR_SHUT : DOOR_OPEN;
    }
    if (frame % rightRate === Math.floor(rightRate / 2)) {
      sim.rightLight = 1;
      rightOccupied = sim.atRightDoor();
      sim.rightDoor = rightOccupied ? DOOR_SHUT : DOOR_OPEN;
    }
  };
}

/**
 * The no-lights line: never use a door light. Without it the two door
 * positions are unobservable, so this shuts a door whenever the last camera
 * look showed that character one step away, and pays for the camera time.
 */
export function noLights({ camFrames = 20, doorFrames = 360, idleFrames = 40 } = {}) {
  const sweep = [CAM.westCorner, CAM.supply, CAM.eastCorner, CAM.eastHall, CAM.pirate];
  let index = 0;
  let phaseFrame = 0;
  let idling = false;
  let leftShut = 0;
  let rightShut = 0;

  return (sim) => {
    if (sim.blackout) return;
    if (leftShut > 0) { leftShut -= 1; sim.leftDoor = DOOR_SHUT; } else sim.leftDoor = DOOR_OPEN;
    if (rightShut > 0) { rightShut -= 1; sim.rightDoor = DOOR_SHUT; } else sim.rightDoor = DOOR_OPEN;
    sim.leftLight = 0; sim.rightLight = 0; sim.viewing = 0;
    phaseFrame += 1;

    if (idling) {
      if (phaseFrame >= idleFrames) { idling = false; phaseFrame = 0; index = (index + 1) % sweep.length; }
      return;
    }
    const view = sweep[index];
    sim.viewing = view;
    // What this camera reveals. Each is one step from a door, so seeing
    // someone here is the cue to shut that door.
    if (view === CAM.westCorner && sim.bonnie === 'cam2B') leftShut = doorFrames;
    if (view === CAM.supply && sim.bonnie === 'cam3') leftShut = doorFrames;
    if (view === CAM.eastCorner && sim.chica === 'cam4B') rightShut = doorFrames;
    if (phaseFrame >= camFrames) { idling = true; phaseFrame = 0; }
  };
}

/** The null control: never touch anything. */
export const doNothing = () => {};

/** Doors shut forever -- must die of power loss, never of a character. */
export function sealed() {
  return (sim) => {
    sim.leftDoor = DOOR_SHUT; sim.rightDoor = DOOR_SHUT;
    sim.viewing = 0; sim.leftLight = 0; sim.rightLight = 0;
  };
}

export const POLICIES = {
  'community-loop': communityLoop,
  'roll-grid': rollGrid,
  'no-lights': noLights,
  'do-nothing': () => doNothing,
  sealed,
};

/**
 * The scheduled line: shut each door only across its own roll instants.
 *
 * This is not a community strategy and is not offered as one. It is what the
 * source makes available and the published accounts do not use, and it exists
 * because the community loop cannot afford Night 5: base drain plus the
 * per-night drain [g477-g480] already spends 713 of the 999-unit reserve, and
 * holding a door through a camp costs more than the 286 that remain.
 *
 * The lever is that **a movement roll is on a fixed global timer**, not on
 * anything the player does. `Every 4970 ms` (Bonnie) and `Every 4980 ms`
 * (Chica) load on their first reach and fire at multiples of their period
 * from frame 0 [SOURCED: g318, g319, and `passEvery`], so the instants a door
 * actually has to be shut are known in advance for the whole night. Shutting
 * a door for `windowFrames` frames around each of them costs `windowFrames / 298` of what
 * holding it costs, and nothing else in the night needs it shut.
 *
 * The published loop is the control this is measured against: same simulator,
 * same seeds, same Foxy and Freddy handling, different door discipline.
 *
 * **MODEL ONLY -- this is not a device route, and its score must not be read
 * as one.** The simulator sets `leftDoor` and `rightDoor` independently every
 * frame, with no pan state. The handset says that is impossible: the two
 * doors sit 2779 px apart on a 2400 px screen and are **never both on
 * screen**, so every door press is pan-then-press at the measured 270 ms
 * floor -- a 540 ms round trip.
 *
 * And the two grids start aligned. Both `Every` timers load at t = 0 and the
 * periods differ by only 10 ms, so the instants separate by 10 ms per cycle:
 *
 *   for the first **53 cycles -- 263 s of a 535 s night** -- the two door
 *   instants are closer together than one pan round trip, inside a 333 ms
 *   band.
 *
 * (That word is "band" and not the obvious one because `architecture-test.js`
 * forbids the DOM globals by name anywhere in core, comments included, and it
 * is right to: a reader grepping for who touches the DOM should not have to
 * sort prose from code.)
 *
 * For half of every night a single actuator cannot serve both doors. The
 * 65,536/65,536 below is a true statement about the model and a false one
 * about the phone, which is this repository's oldest failure mode: the
 * simulator prices nothing. `communityLoop` is the actuatable policy --
 * its door shuts are belief-driven and last a whole camp (12-20 s), so a
 * 270 ms pan fits inside its 1 s check cadence with room to spare.
 */
export function rollGrid({ windowFrames = 20, camFrames = 7, idleFrames = 45,
                           park = CAM.eastCorner } = {}) {
  const BONNIE_MS = 4970;
  const CHICA_MS = 4980;
  let phase = 0;
  let phaseFrame = 0;
  const PHASES = ['cam', 'idle'];

  // Frames since night start, in ms, and how far into the current period.
  const nearRoll = (frame, periodMs) => {
    const ms = frame * (1000 / 60);
    const into = ms % periodMs;
    return into >= periodMs - (windowFrames / 2) * (1000 / 60)
      || into <= (windowFrames / 2) * (1000 / 60);
  };

  return (sim) => {
    if (sim.blackout) return;
    sim.leftLight = 0; sim.rightLight = 0; sim.viewing = 0;
    sim.leftDoor = nearRoll(sim.frame, BONNIE_MS) ? DOOR_SHUT : DOOR_OPEN;
    sim.rightDoor = nearRoll(sim.frame, CHICA_MS) ? DOOR_SHUT : DOOR_OPEN;

    phaseFrame += 1;
    if (PHASES[phase] === 'cam') {
      sim.viewing = park;
      if (phaseFrame >= camFrames) { phase = 1; phaseFrame = 0; }
    } else if (phaseFrame >= idleFrames) { phase = 0; phaseFrame = 0; }
  };
}
