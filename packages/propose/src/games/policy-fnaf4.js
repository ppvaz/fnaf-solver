// ---------------------------------------------------------------------------
// FNaF 4 policies, from the published community lines.
//
// Two are documented here already:
//
//   - `plans/26-second-target-fnaf-1-3-4.md`, the 20/20/20/20 rotation:
//     `Left Door -> check Freddles -> Right Door`, driven by an audio rule --
//     breathing means hold the door until footsteps, silence means flash.
//   - `docs/research/FNAF4-AUDIO-INDEPENDENCE.md`, the no-audio clear, whose
//     central trick is that **closing a door forces a known state**: g341
//     teleports the character to the hall when the door shuts, and g342
//     pushes them back on a 3000 ms hold. The published strategy recommends
//     ~5 s, which over-holds by about 2 s per visit against the source.
//
// The 2026-09-20 trace closed the loop that made `community-loop` writable:
// the audio rule is now the source's own. Listening hears breathing whenever
// someone is in that hall (the peek animations differ by occupant, g64-g66),
// a held door repels Fredbear (g502/g503, 3000 ms) and dismisses Bonnie or
// Chica through the two-close cycle (g341/g342), a flash down a silent hall
// resets that side's bedroom dwell (g485/g481) and pushes a hall-far
// occupant home (g68/g84), the closet visit decays Foxy (g273) and walks
// Fredbear back out (g522/g523), and one look at the bed drains Freddles at
// 20/s (g401) and flashes Fredbear off it (g526/g527). Every leg of the
// published loop now has a group.
//
// The tour is also the idle defence: standing still arms the black flash at
// 25 s on a Fredbear night (g566/g564) and pumps the Freddle meter at 30 s
// on any night from 2 up (g592/g593), so the loop keeps moving by design.
//
// The no-audio line is the one the device can run today: the operator
// confirmed this handset's on-device capture path misses the audio cues, so
// detection -- not transport -- is the open problem (`docs/research/
// FNAF4-AUDIO-INDEPENDENCE.md`). Its census row is the model's statement of
// what the route is worth once a detector exists.
// ---------------------------------------------------------------------------

import { FOLLOW } from '@sixam/source/games/fnaf4/fnaf4.ts';

const S = FOLLOW.stations;
const FRAME_MS = 1000 / 60;

/**
 * The published audio line: listen at each door, hold on breathing, flash on
 * silence, then the closet, then the bed.
 *
 * @param {object} [knobs]
 * @param {number} [knobs.listenMs]   dwell listening at each door
 * @param {number} [knobs.holdMs]     each close of the two-close cycle; the
 *                                    dismiss tick is 3000 ms (g342) and the
 *                                    repel tick is 3000 ms (g502/g503)
 * @param {number} [knobs.rearmMs]    both doors open between the closes,
 *                                    which is the only re-arm (g352)
 * @param {number} [knobs.flashMs]    the silence flash, which resets the
 *                                    bedroom dwell (g485/g481)
 * @param {number} [knobs.closetMs]   holding the closet shut, which decays
 *                                    Foxy (g273) and ejects Fredbear
 *                                    (g522/g523, both 3000 ms ticks)
 * @param {number} [knobs.bedMs]      viewing the bed, which drains at 20/s
 *                                    (g401) and must stay under the 15 s
 *                                    bed-watch (g594/g595)
 * @param {number} [knobs.doorCycles] number of left/right passes per detour
 */
export function communityLoop({ listenMs = 600, holdMs = 3400, rearmMs = 200,
                                flashMs = 120, closetMs = 12000, bedMs = 1500,
                                doorCycles = 1 } = {}) {
  // Doors, then the closet, then the bed -- with `doorCycles` L/R passes per
  // detour on the Fredbear nights, where the halls' 15 s unattended fuse
  // (g644/g646) is the binding constraint and a four-station tour cannot
  // stay under it.
  //
  // The order pays for itself twice: the closet hold walks Fredbear back
  // out of the closet (g522/g523) and zeroes his AV6, which is **one
  // counter shared by the bed and the closet** (g556/g557), and the bed
  // turn that follows is what g558's fredcheck reads -- so the eject has to
  // sit immediately before the turn. The bed view then clears any Fredbear
  // that dropped onto the bed meanwhile (g526/g527) and drains the Freddle
  // meter (g401).
  const TOUR = [];
  for (let i = 0; i < doorCycles; i += 1) TOUR.push(S.leftDoor, S.rightDoor);
  TOUR.push(S.closet, S.bed);
  let leg = 0;
  let dwell = 0;
  let phase = 'approach';
  let heard = false;
  let rounds = 0;

  const clearActions = (sim) => {
    sim.listening = 0; sim.flashing = 0; sim.peek = 0;
    sim.leftDoorShut = 0; sim.rightDoorShut = 0;
    sim.closetShut = 0; sim.viewingBed = 0;
  };
  const nextLeg = () => { leg = (leg + 1) % TOUR.length; dwell = 0; phase = 'approach'; heard = false; rounds = 0; };

  return (sim) => {
    if (sim.over) return;
    if (sim.walking) { clearActions(sim); return; }

    const want = TOUR[leg];
    if (sim.follow !== want) {
      clearActions(sim);
      if (sim.goTo(want)) { dwell = 0; phase = 'approach'; }
      return;
    }

    dwell += 1;
    const ms = dwell * FRAME_MS;

    if (want === S.leftDoor || want === S.rightDoor) {
      const side = want === S.leftDoor ? 1 : 2;
      const shutKey = side === 1 ? 'leftDoorShut' : 'rightDoorShut';
      sim.viewingBed = 0; sim.closetShut = 0;
      sim[side === 1 ? 'rightDoorShut' : 'leftDoorShut'] = 0;
      if (phase === 'approach') { phase = 'listen'; rounds = 0; }
      if (phase === 'listen') {
        // One listen to hear the hall. Breathing means hold; silence means
        // the hall is empty and a flash is safe (g345/g346 punish a flash
        // into an occupied near, which is what the listen rules out).
        sim.listening = side;
        heard = heard || sim.breathAt(side);
        if (ms >= listenMs) {
          sim.listening = 0;
          phase = heard ? 'close' : 'flash';
          dwell = 0;
        }
      } else if (phase === 'close') {
        // Hold the door **while the breathing lasts** -- the published "hold
        // until the footsteps fade". The hold dismisses a hall-near occupant
        // through the two-close cycle (g341 summons a hall-far occupant to
        // near and latches the interlock; only both-open re-arms, g352; the
        // next close dismisses, g342/g344) and repels Fredbear on the
        // 3000 ms tick (g502/g503). If the rounds run out with the hall
        // still breathing -- a summon whose retreat kept re-arming -- the
        // visit is abandoned **without** the flash: g345/g346 make flashing
        // into a hall-near occupant the one certain death.
        sim[shutKey] = 1;
        const silent = !sim.breathAt(side);
        if (silent || ms >= holdMs) {
          sim[shutKey] = 0;
          if (silent) { phase = 'flash'; dwell = 0; }
          else {
            rounds += 1;
            if (rounds >= 3) { nextLeg(); }
            else { phase = 'rearm'; dwell = 0; }
          }
        }
      } else if (phase === 'rearm') {
        if (ms >= rearmMs) { phase = 'close'; dwell = 0; }
      } else if (phase === 'flash') {
        // The hall reads empty, so the flash is the safe reset of that
        // side's bedroom dwell (g485/g481) and the push of a hall-far
        // occupant home (g68/g84).
        sim.listening = 0; sim.flashing = side;
        if (ms >= flashMs) { sim.flashing = 0; nextLeg(); }
      } else {
        nextLeg();
      }
    } else if (want === S.closet) {
      sim.leftDoorShut = 0; sim.rightDoorShut = 0; sim.viewingBed = 0;
      // Foxy's pose is visible from the closet peek (g188-g191 differ by it),
      // and so is Fredbear (g192/g193). Hold the door shut while either is
      // there -- Foxy drains 1/s (g273), Fredbear walks out on the 3000 ms
      // tick (g522/g523) -- and leave as soon as the closet reads empty.
      const loaded = sim.foxyStage >= 1 || sim.fredbear === 'closet';
      sim.closetShut = loaded && ms < closetMs ? 1 : 0;
      if ((!loaded && ms >= 400) || ms >= closetMs) {
        sim.closetShut = 0;
        nextLeg();
      }
    } else {
      // The bed: one look drains Freddles and flashes Fredbear off the bed
      // (g526/g527), and the turn away resolves the bedroom and fredcheck.
      sim.leftDoorShut = 0; sim.rightDoorShut = 0; sim.closetShut = 0;
      sim.viewingBed = 1;
      if (ms >= bedMs) { sim.viewingBed = 0; nextLeg(); }
    }
  };
}

/**
 * The no-audio rotation: force each door, then pay the bed and the closet.
 *
 * @param {object} [knobs]
 * @param {number} [knobs.holdMs]   each of the two closes; g342's dismiss
 *                                  tick is every 3000 ms
 * @param {number} [knobs.rearmMs]  both doors open between them, which is the
 *                                  only thing that clears the interlock (g352)
 * @param {number} [knobs.bedMs]    dwell at the bed, which drains Freddy at
 *                                  20/s against a fill of `AI / 4` per second
 * @param {number} [knobs.closetMs] dwell at the closet, which resets Foxy
 */
export function noAudioRotation({ holdMs = 3200, rearmMs = 200, bedMs = 700,
                                  closetMs = 400 } = {}) {
  const TOUR = [S.leftDoor, S.rightDoor, S.bed, S.closet];
  let leg = 0;
  let dwell = 0;

  return (sim) => {
    if (sim.over) return;
    sim.flashing = 0;              // never flash: g345/g346 make it lethal
    sim.listening = 0;             // the no-audio line uses no cue at all
    sim.peek = 0;

    if (sim.walking) { sim.leftDoorShut = 0; sim.rightDoorShut = 0; sim.viewingBed = 0; sim.closetShut = 0; return; }

    const want = TOUR[leg];
    if (sim.follow !== want) {
      sim.leftDoorShut = 0; sim.rightDoorShut = 0; sim.viewingBed = 0; sim.closetShut = 0;
      sim.goTo(want);
      dwell = 0;
      return;
    }

    dwell += 1;
    const ms = dwell * FRAME_MS;
    if (want === S.leftDoor || want === S.rightDoor) {
      // The two-close cycle [g341 / g352 / g342]. The first close summons
      // them to the hall and latches the shared interlock; the interlock only
      // re-arms while **both** doors are open; the second close is the one
      // that dismisses. Holding a single close forever does nothing after the
      // summon, which is what an earlier version of this policy did.
      const side = want === S.leftDoor ? 'leftDoorShut' : 'rightDoorShut';
      const other = want === S.leftDoor ? 'rightDoorShut' : 'leftDoorShut';
      sim.viewingBed = 0;
      sim[other] = 0;
      if (ms < holdMs) sim[side] = 1;                       // close 1: summon
      else if (ms < holdMs + rearmMs) sim[side] = 0;        // open both: re-arm
      else if (ms < holdMs * 2 + rearmMs) sim[side] = 1;    // close 2: dismiss
      else { sim[side] = 0; leg = (leg + 1) % TOUR.length; dwell = 0; }
    } else if (want === S.bed) {
      sim.viewingBed = 1; sim.leftDoorShut = 0; sim.rightDoorShut = 0;
      if (ms >= bedMs) { sim.viewingBed = 0; leg = (leg + 1) % TOUR.length; dwell = 0; }
    } else {
      sim.viewingBed = 0; sim.leftDoorShut = 0; sim.rightDoorShut = 0;
      sim.closetShut = ms < closetMs ? 1 : 0;
      if (ms >= closetMs) { sim.closetShut = 0; leg = (leg + 1) % TOUR.length; dwell = 0; }
    }
  };
}

/** The null control: never move, never act. */
export const doNothing = () => () => {};

/**
 * The control that must die of the rule the audio cue exists to prevent:
 * flash the hall on every visit, with no idea whether they are near.
 */
/** @param {{ holdMs?: number }} [knobs] */
export function flashBlind({ holdMs = 600 } = {}) {
  const TOUR = [S.leftDoor, S.rightDoor];
  let leg = 0; let dwell = 0;
  return (sim) => {
    if (sim.over || sim.walking) return;
    const want = TOUR[leg];
    if (sim.follow !== want) { sim.goTo(want); dwell = 0; return; }
    dwell += 1;
    sim.flashing = want === S.leftDoor ? 1 : 2;
    if (dwell * FRAME_MS >= holdMs) { sim.flashing = 0; leg = (leg + 1) % TOUR.length; dwell = 0; }
  };
}

/**
 * The control for the meter cap: watch the bed and never move. It must die
 * to the 15 s bed-watch (g594/g595) or to the Freddle fill's 80 cap
 * (g464/g468) -- never to a door or a flash.
 */
export const bedStare = () => (sim) => {
  if (sim.over || sim.walking) return;
  if (sim.follow !== S.bed) { sim.goTo(S.bed); return; }
  sim.viewingBed = 1;
};

export const POLICIES = {
  'community-loop': communityLoop,
  'no-audio': noAudioRotation,
  'do-nothing': () => doNothing(),
  'flash-blind': flashBlind,
  'bed-stare': () => bedStare(),
};
