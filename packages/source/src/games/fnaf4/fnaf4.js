// ---------------------------------------------------------------------------
// FNaF 4's night, from `03-04-level.txt` (937 groups, 0 unclassified).
//
// Regenerate with
//   tools/dump/nightmap.py --game fnaf4 --table --clock --rolls
//
// The night counter here is `Night`, capitalised, where FNaF 1 and 3 use
// `night number` and FNaF 2 uses `night`. A lowercase-only sweep finds
// nothing in this sheet and is indistinguishable from the mechanic being
// absent -- which is how the table below was nearly reported as missing.
// ---------------------------------------------------------------------------

export const GAME = 'fnaf4';

// The clock [SOURCED: g568 advances the hour every 60000 ms, g569 every
// 30000 ms with the fast-nights checkmark set; g570 wraps above 12; g573
// leaves the frame at hour 6]. Six hours of 60 s is a 360 s night.
//
// The hour has no start-of-frame initialiser, so it begins at the counter's
// default of 0, which reads 12 AM. Two rewards move it before the night
// begins: g596 sets it to **2** when the Plushtrap minigame was won and
// `Night < 6`, and g597 sets it to **1** after the BB minigame. A route timed
// from night start is wrong by two in-game hours when the Plushtrap reward is
// set, and nothing on the night screen says so.
export const CLOCK = {
  kind: 'wallclock',
  hourMs: 60000,        // g568
  fastHourMs: 30000,    // g569
  wrapAt: 12,           // g570
  winHour: 6,           // g573
  source: 'g568,g569,g570,g573',
};

export const CHARACTERS = ['freddy', 'bonnie', 'chica', 'foxy', 'fredbear'];

// Rewards that shorten the night before it starts [SOURCED: g596, g597].
export const REWARDS = {
  plushtrap: { group: 596, setsHour: 2, requires: 'Night < 6' },
  balloonBoy: { group: 597, setsHour: 1 },
};

// Difficulty by night [SOURCED: g581-g588 for Nights 1-4, g228 for Night 5's
// Fredbear, g598/g599 for Night 6, g600 for the Nightmare night].
//
// Two shapes worth naming, because they are not the same mechanism:
//
//   - Nights 1-4 **escalate mid-night**: a second row at 3 AM (2 and 3 AM on
//     Night 1) `add`s to the levels the first row set. Levels accumulate.
//   - Night 6 **switches antagonist**: at 4 AM every one of the four goes to
//     0 and Fredbear goes to 15. That is a set, not an add, and it means the
//     second half of Night 6 is a different game from the first.
//
// Night 5 has no row for Bonnie, Chica, Foxy or Freddy at all. Only g228
// fires, setting Fredbear to 12 -- so Night 5 is a Fredbear-only night, and
// the four regular rolls can never pass on it.
export const ROWS = [
  { group: 581, night: { op: '=', value: 1 }, hour: 2, set: { bonnie: 1, chica: 1, freddy: 1 } },
  { group: 582, night: { op: '=', value: 1 }, hour: 3, add: { bonnie: 2, chica: 1, freddy: 1 } },

  { group: 583, night: { op: '=', value: 2 }, set: { bonnie: 5, chica: 5, freddy: 2, foxy: 1 } },
  { group: 584, night: { op: '=', value: 2 }, hour: 3, add: { freddy: 1, bonnie: 2, chica: 2, foxy: 3 } },

  { group: 585, night: { op: '=', value: 3 }, set: { foxy: 10, freddy: 3, bonnie: 7, chica: 7 } },
  { group: 586, night: { op: '=', value: 3 }, hour: 3, add: { bonnie: 3, chica: 3 } },

  { group: 587, night: { op: '=', value: 4 }, set: { freddy: 4, bonnie: 10, foxy: 5, chica: 10 } },
  { group: 588, night: { op: '=', value: 4 }, hour: 3, add: { chica: 2, bonnie: 2, foxy: 5 } },

  { group: 228, night: { op: '=', value: 5 }, set: { fredbear: 12 } },

  { group: 598, night: { op: '=', value: 6 }, set: { bonnie: 12, foxy: 10, freddy: 5, chica: 12 } },
  { group: 599, night: { op: '=', value: 6 }, hour: 4, set: { bonnie: 0, chica: 0, foxy: 0, freddy: 0, fredbear: 15 } },

  // g600 is gated on `shadow = 1`, not on a night comparison -- it is the
  // Nightmare night, and it *sets* `Night` to 7 itself. Recorded as night 7
  // so the table can be asked about it, with the real trigger named.
  { group: 600, night: { op: '=', value: 7 }, set: { bonnie: 15, fredbear: 0, chica: 15, foxy: 15, freddy: 6 }, trigger: 'shadow = 1' },
  { group: 601, night: { op: '=', value: 7 }, hour: 4, set: { bonnie: 0, chica: 0, foxy: 0, freddy: 0, fredbear: 20 }, trigger: 'shadow = 1' },

  // g602 is `shadow = 2`: the 20/20/20/20 night, which also sets `Night` to
  // 8. Both shadow nights end the way Night 6 does -- at 4 AM the four go to
  // 0 and **Fredbear alone remains, at 20** (g601/g603), so the last two
  // hours of every night from 6 up are the same antagonist.
  { group: 602, night: { op: '=', value: 8 }, set: { bonnie: 20, fredbear: 0, chica: 20, foxy: 20, freddy: 6 }, trigger: 'shadow = 2' },
  { group: 603, night: { op: '=', value: 8 }, hour: 4, set: { bonnie: 0, chica: 0, foxy: 0, freddy: 0, fredbear: 20 }, trigger: 'shadow = 2' },
];

export const CAP = null;  // no cap group; see fnaf1.js CAP for the detector check

// The rolls [SOURCED: g236 Foxy, g284 Bonnie, g285 Chica, g286/g287
// Fredbear].
//
// **The bounds are not uniform.** Foxy rolls against `Random(10)` while
// Bonnie, Chica and Fredbear roll against `Random(20)`, so the same number on
// two dials is not the same threat: Foxy at 10 passes every roll, Bonnie at
// 10 passes half. Night 3 sets Foxy to exactly 10, which under this bound is
// a guaranteed advance every 5 s.
//
// Bonnie and Chica are each suspended outright by two of the player's own
// states: holding that side's door, and listening at it. No observation is
// required for either -- the gate is on the control, not on where the
// character is. Fredbear's timer halves from 3000 ms to 2000 ms once
// `shadow` is set.
export const ROLLS = {
  foxy: { group: 236, everyMs: 5000, bound: 10, gates: [] },
  bonnie: {
    group: 284, everyMs: 5000, bound: 20,
    gates: ['listening mode <> 1', 'in closet AV5 <> 2', 'left door shut = 0'],
  },
  chica: {
    group: 285, everyMs: 5000, bound: 20,
    gates: ['listening mode <> 2', 'in closet AV5 <> 2', 'right door shut = 0'],
  },
  fredbear: {
    group: 286, everyMs: 3000, bound: 20,
    shadowGroup: 287, shadowEveryMs: 2000,
    gates: ['not in closet', 'not on bed', 'not left hall far', 'not right hall far'],
  },
};

// Freddy is a meter, not a roll [SOURCED: g397 adds `Freddy AI` every 4000 ms
// **while the bed is not being viewed**; g398 replaces that with a flat +5
// every 2000 ms under the MadFreddy challenge; g593 adds a further +1 every
// 200 ms while `Fredbear` AV13 >= 30, the bed is unwatched and `Night > 1`;
// g401 drains 1 every 50 ms while the bed *is* viewed; g399 floors it at 0;
// g427 and g428 kill at **>= 60** while the player is at the bed
// (`follow = 43`) -- immediately if viewing it, otherwise on a 3000 ms tick].
//
// The drain is 20/s against a fill of `AI/4` per second, so it is 16x the
// fill at AI 5. A short look at the bed clears a lot of meter; the cost is
// that looking is also the only state in which the >= 60 kill is instant.
//
// g593's accelerant has no counterpart in the public description of Freddles
// and is gated on Fredbear's own timer, which couples two characters that are
// usually described as independent.
export const FREDDY = {
  fill: { group: 397, everyMs: 4000, amount: 'Freddy AI', whileViewingBed: false },
  madChallenge: { group: 398, everyMs: 2000, amount: 5 },
  accelerant: { group: 593, everyMs: 200, amount: 1, requires: 'Fredbear AV13 >= 30, bed unwatched, Night > 1' },
  drain: { group: 401, everyMs: 50, amount: 1, whileViewingBed: true },
  floor: { group: 399, value: 0 },
  killAt: 60,
  killGroups: 'g427 (viewing bed, instant), g428 (at bed, every 3000 ms)',
  blackFlashCap: 80,  // g464; see BLACK_FLASH below
  dangerBands: [10, 20, 30, 50, 60, 80],
  source: 'g397,g398,g399,g401,g427,g428,g593',
};

// The forced-door trick, traced in full [SOURCED: g341, g342, g352, and the
// position tags g631/g632]. This is what makes a no-audio route possible, and
// it is a **two-close cycle**, not a single hold.
//
// `AV5` is a position tag rather than a hold counter: g631 sets it to 1 when
// the character overlaps the hall's *far* marker and g632 to 2 at *near*. The
// tag persists after they leave, which is the whole point of the anti-cheat.
//
//   g341 SUMMON   tag = far + that door shut + interlock clear
//                 -> teleport to `<side> hall near`, interlock := 1.
//                 It never checks they are really at far, so a stale tag
//                 summons them from anywhere.
//   g342 DISMISS  every 3000 ms + tag = near + door shut + interlock clear
//                 + genuinely overlapping near -> back to the living room.
//   g352 RE-ARM   the interlock returns to 0 only while **both** doors are
//                 open.
//
// So **one close cannot both summon and dismiss**: g341 sets the very
// interlock g342 requires clear. The cycle is close -> open both -> close.
//
// And `in closet` AV5 is **one interlock shared by both sides** (g343/g344
// are Chica's and use the same object and slot), so only one character can be
// resolved per arming. A rotation cannot push both home without re-arming in
// between. No public account of this game states either property.
export const FORCED_DOOR = {
  summon: { group: 341, chicaGroup: 343, setsInterlock: 1 },
  dismiss: { group: 342, chicaGroup: 344, everyMs: 3000, requiresInterlock: 0 },
  rearm: { group: 352, requires: 'both doors open' },
  tags: { far: 1, near: 2, groups: '631/632' },
  interlockIsShared: true,
  source: 'g341,g342,g343,g344,g352,g631,g632',
};

// The black flash: the frame's one kill that needs no player state at all.
// [SOURCED: g464 arms it when `Freddy counter >= 80` -- `50 + Random(100)`
// frames; g467 decrements it every frame to a floor of 1; g468/g469 set
// `gameover = 1` at AV3 = 1 from anywhere, the only difference between them
// being which scare object spawns. g465 defuses it, but only when the counter
// is back under 80 **and Fredbear AI = 0** -- on a Fredbear night the fuse
// cannot be cut.]
//
// This group is what was missing from the first step function: it is the
// answer to "what kills a player who faces centre and never acts". The meter
// fills out of reach of every player-triggered group, and at 80 the countdown
// starts wherever the player happens to be standing.
export const BLACK_FLASH = {
  armAt: 80,
  armGroup: 464,
  framesMin: 50, framesRandom: 100,
  decrementGroup: 467, killGroups: 'g468 (Fredbear AI = 0), g469 (Fredbear AI > 0)',
  defuse: { group: 465, requires: 'Freddy counter < 80 AND Fredbear AI = 0' },
};

// Bonnie and Chica's bedroom entry [SOURCED: g484/g479 add 1 to AV6 every
// 1000 ms at `left hall near` / `right hall near`; g486/g480 set AV7 -- the
// bedroom flag g375/g376 kill on -- while the bed is viewed, when AV6 passes
// `20 - Night` (Bonnie strictly greater, Chica at least). g375/g376 fire when
// the bed-view turn animation finishes with AV7 set; g374 is the same turn
// with neither flag set and is the clean exit, which also arms `fredcheck`
// (g558's Fredbear kill). g590/g591 raise `force turn` every 4000 ms at the
// bed with a flag set -- the player is not free to stand at a contaminated
// bed.]
//
// No group decays AV6 while the character stands at hall-near, but three
// reset it outright: leaving the halls clears Bonnie's AV6 and AV7 (g447,
// unconditional) and Chica's AV6 below 20 (g478 -- an asymmetry in the
// source), and **viewing that hall clears the dwell** (g485 Bonnie, AV6 and
// AV7; g481 Chica, AV6 only -- her AV7 has no view reset). The view resets
// are the community line's own "check the hall to reset them" rule, in the
// source; the flash that carries the view is what g345/g346 punish when the
// character is already at hall-near, which is exactly what the audio rule
// exists to prevent.
export const BEDROOM = {
  av6EveryMs: 1000,
  threshold: '20 - Night',
  bonnieOp: '>', chicaOp: '>=',
  setGroups: 'g486/g480', dwellGroups: 'g484/g479',
  resets: 'g447 (Bonnie leaves halls), g478 (Chica leaves halls, AV6 < 20 only), g485/g481 (hall viewed)',
  killGroups: 'g375/g376', cleanExitGroup: 374,
  forcedTurn: { groups: 'g590/g591', everyMs: 4000 },
};

// Foxy's closet, in full [SOURCED: g236 pulses every 5000 ms on
// `Random(10) + 1 <= Foxy AI`; g230-g235 walk him living-centre ->
// living-left/right -> hall-far, and g233/g234 are blocked while that hall is
// viewed; g261/g262 take him hall-far -> in closet; g264 turns a pulse into
// +1 AV2 while he is in the closet and it is not being viewed; g273 removes
// 1 AV2 per second while the player is in the closet's close animation
// (follow = 33); g282/g283 set and clear `foxy got you` at AV2 >= 10 and
// < 10; g279 sets the attack pose (AV3 = 3) at AV2 >= 6, and g430/g433 spawn
// the non-lethal `foxy bite` if the closet is flashed in that pose; g595 puts
// him in the closet outright after 15 s of bed-watching.]
//
// `foxy got you` is lethal only through player positions: arriving anywhere
// with it (g101-g103), turning from the bed with it (g438), or standing at
// the bed (g439 -> g589 -> g438).
//
// UNKNOWN(walk-cadence): g230-g235 are gated on a walk flag no group in this
// frame manages, so the cadence of the zone legs is not stated by the sheet.
// Modelled as one leg per passed roll; the InstaFoxy challenge (g671) is the
// sheet's own proof that skipping the walk straight to the closet is a thing
// the frame supports.
export const FOXY_CLOSET = {
  roll: ROLLS.foxy,
  av2GotYou: 10, av2AttackPose: 6,
  decayPerSecAtCloset: 1,
  zones: ['away', 'centre', 'livingL', 'hallL', 'closet'],
  killGroups: 'g101-g103, g438, g439',
};

// The `Fredbear` object's dwell counters, which are what actually run nights
// 5 and up. [SOURCED: g490 spawns him at living-centre when Fredbear AI > 0;
// g286/g287 pulse a walk every 3000 ms (shadow 0) or 2000 ms (shadow >= 1) on
// `Random(20) + 1 <= AI`, drawn whenever the timer fires while he is not
// already at the closet, bed or a hall-far; g491-g496 walk him
// living-centre -> left/right -> hall-far, and g493/g496 are **blocked while
// that hall is viewed**; g502/g503 push him off a hall-far every 3000 ms
// while that door is shut; g508-g511 drop him on the bed or in the closet
// when the player listens while he is in a living zone; g639-g642 teleport
// him into the closet every 30000 ms (shadow 0) or 20000 ms (shadow >= 1) on
// a `Random(2) = 1` coin; g522/g523 walk him back out while the player stands
// in the closet with him.]
//
// The counters, each of which ends the night through the black flash unless
// its group citation says otherwise:
//
//   AV6   seconds on the bed or in the closet (g556/g557, reset by g554/g555
//         on leaving). >= 20 (shadow 0) / >= 11 (shadow >= 1) arms the flash
//         (g561-g563); >= 10 at a bed-turn's `fredcheck` kills outright
//         (g558).
//   AV8/9 frames spent **viewing** him in the left/right hall (g514/g515,
//         per frame, reset on losing the overlap g512/g513). > 30 / 25 / 20 on
//         Night 5 / 6 / 7+ arms the flash (g516-g521). This is the
//         "don't stare" rule, in frames.
//   AV19  seconds at a hall-far (g644/g645, reset at neither g643). >= 15 /
//         10 / 8 by shadow arms the flash (g646-g648).
//   AV12  seconds idle on a Fredbear night (g566), >= 25 arms the flash
//         (g564). See IDLE.
//
// UNKNOWN(listen-pair): g508/g509 (and g510/g511) carry identical conditions
// to different destinations -- closet and bed -- so the sheet as rendered
// does not say which listening drop is which; modelled as a coin.
export const FREDBEAR = {
  spawn: { group: 490, at: 'living room centre' },
  walkRoll: ROLLS.fredbear,
  doorRepel: { groups: 'g502/g503', everyMs: 3000 },
  teleport: { groups: 'g639-g642', everyMs: 30000, shadowEveryMs: 20000, coin: 'Random(2) = 1' },
  av6: { everyMs: 1000, flashAt: { shadow0: 20, shadow1: 20, shadow2: 11 }, fredcheckAt: 10 },
  av8av9: { perFrame: true, flashAbove: { night5: 30, night6: 25, night7: 20 } },
  av19: { everyMs: 1000, flashAt: { shadow0: 15, shadow1: 10, shadow2: 8 } },
  av12Idle: { everyMs: 1000, flashAt: 25 },
};

// The idle counters [SOURCED: g592 adds 1 to AV13 every 1000 ms
// unconditionally; g566 adds 1 to AV12 every 1000 ms while Fredbear AI > 0;
// g594 adds 1 to AV14 every 1000 ms while the bed is viewed; g567 zeroes
// AV12, AV13 and AV14 whenever a `carpet run` exists -- **walking**, and only
// walking, resets them**.]
//
// AV13 is the do-nothing killer on nights 2-4: g593 adds 1 to the Freddy
// counter every 200 ms while AV13 >= 30, the bed is unwatched and Night > 1,
// which is +5/s on top of the Freddle fill and drives the meter to the
// black-flash cap without the player touching anything. AV14 is the
// bed-watcher's: at >= 15 it fires g595, which puts Foxy in the closet with
// `foxy got you` already set and force-turns the player off the bed into it.
export const IDLE = {
  av13EveryMs: 1000, av13Accelerant: { group: 593, everyMs: 200, requiresIdle: 30, nightAbove: 1 },
  av14EveryMs: 1000, av14BedWatchAt: 15, av14Group: 595,
  reset: 'carpet run exists (g567)',
};

// The forced appearances, resolved [SOURCED: g626-g628 draw the hour at night
// start on Nights 2-4 -- `force Bonnie = 2 + Random(4)`, `force Chica =
// 3 + Random(3)` -- and g629/g630 teleport the character **straight to
// hall-near**, once, in the hour that passes, while the player is at the hub
// and nobody has `got you`.]
export const FORCED_APPEARANCES = {
  nights: [2, 3, 4],
  bonnie: { min: 2, max: 5 }, chica: { min: 3, max: 5 },
  teleport: 'g629/g630: straight to hall-near, once, while the player is at the hub',
  source: 'g626,g627,g628,g629,g630',
};

export const MODEL = {
  game: GAME,
  clock: CLOCK,
  rows: ROWS,
  cap: CAP,
  initialLevels: { freddy: 0, bonnie: 0, chica: 0, foxy: 0, fredbear: 0 },
  rolls: ROLLS,
};

// ---------------------------------------------------------------------------
// The `follow` state machine.
//
// This was Plan 26's blocker for FNaF 4: "the `follow` player-state map is
// unmapped, and every control is gated on it." Traced 2026-09-20 from the 46
// distinct values the Office frame writes to `follow` AV0 and the groups that
// write them.
//
// It is not an abstract state -- it is a **walk animation**. The player object
// physically slides across the room and the transitions are driven by
// `AnimationFinished` and by `follow`'s own X position (g30 tests
// `CompareX = 512`, g32 tests `> 530`). Four of the 46 values are places the
// player can *be* and act; the rest are frames of getting there.
//
// The four stations, and the hub:
//
//   0   the middle of the room -- the hub, and the only state with four exits
//   10  at the left door        [entered 9 -> 10, g60]
//   17  at the right door       [entered 16 -> 17, g116]
//   29  in the closet           [entered 28 -> 29, g185]
//   43  at the bed              [entered 42 -> 43, g373]
//
// Those five are exactly the values the sheet compares most: 29, 17, 10, 43
// and 0 account for 114 of the `follow` comparisons in the frame. And 43 is
// the one Freddy's kill is gated on (g427/g428 need `follow = 43`), which is
// why the meter and the walk are the same problem.
//
// At a station, each control is a sub-cycle that **returns to the same
// station**, so an action costs animation time but not position:
//
//   left door (10):  close 20 -> 21 -> 22 -> 10   flashlight 35 / 40 -> 10
//   right door (17): close 23 -> 24 -> 25 -> 17   flashlight 36 / 41 -> 17
//   closet (29):     close 32 -> 33 -> 34 -> 29
//
// Leaving a station runs a separate walk back to the hub: 10 -> 11 -> 12 -> 13
// -> 0, 17 -> 18 -> 19 -> 13/37 -> 0, 29 -> 30 -> 31 -> 0/39, 43 -> 44 -> 45
// -> 0. Reaching one runs the outbound walk: 0 -> 1 -> 2 (-> 7 -> 8 -> 9 -> 10
// via `HUDDoorLeftHitzone`), 0 -> 4 -> 5 (-> 14 -> 15 -> 16 -> 17 via
// `HUDDoorRightHitzone`), 0 -> 26 -> 27 -> 28 -> 29, 0 -> 41 -> 42 -> 43.
//
// **The consequence for a schedule**, which is what made this a blocker: the
// two doors are never both reachable, and every transition between stations
// costs a walk. FNaF 4's rotation is not a sequence of presses, it is a tour
// with travel time between stops -- the same shape as FNaF 1's "pan, then
// press", arriving from a different mechanism.
//
// **The walk durations, caught 2026-09-20** from the animation bank rather
// than from the phone: `dump_animations.py` over the owned CCN, at build 296
// and the app's own 60 fps, under the Fusion duration model the tool
// documents -- the counter advances by `speed` each tick and the frame flips
// at 100, so a sequence lasts `frames * 100 / (speed * rate)`.
//
// That is the same route `config.js:528-535` used for FNaF 2's mask and
// monitor flips, and a fresh dump reproduces all four of those to the
// millisecond -- so this is an established method here, not a new one.
//
// **These are animation lengths, and an animation length is not readiness.**
// FNaF 2 is the worked example and the warning: `mmonitorDown` runs 0.367 s,
// but the native frame trace has the mask button absent through 322 ms, faint
// at ~337 ms and fully visible only at **382.5 ms**, and
// `tools/device/artifact-commands.mjs` uses the measured figure because the
// derived one sat 66.5 ms above the real visibility point. Treat every number
// below as a **lower bound** on the leg, to be replaced per leg by a device
// measurement before any FNaF 4 schedule is bound to it.
export const WALK_MS = {
  // Hub <-> station. The approach is longer than the return in every case.
  toLeftDoor: 2366, fromLeftDoor: 1533,
  toRightDoor: 2366, fromRightDoor: 1566,
  toCloset: 1733, fromCloset: 1366,
  toBed: 633, fromBed: 667,
  // Station actions, which return to the station they started at.
  closeLeftDoor: 733, closeRightDoor: 600, closeCloset: 334,
  flashLeft: 300, flashRight: 300,
  // The two reveal branches cost more than a plain flash.
  bonnieHide: 533, chicaHide: 667,
  // `carpet run` is 1033 ms and appears in every long leg -- one animation
  // carries the travel in all four directions.
  carpetRun: 1033,
  source: 'dump_animations.py over build 296 at 60 fps; legs joined to the '
        + '`follow` transitions by their AnimationFinished conditions',
  bound: 'LOWER -- animation length, not control readiness',
};

// What the numbers say about a rotation, which is the reason the map mattered.
//
// Left door to right door by way of the hub is 1533 + 2366 = **3899 ms**
// against a **5000 ms** roll grid [g284, g285, g236] -- 78% of one roll
// period spent walking. A tour of both doors and back is 7831 ms, **longer
// than a whole roll cycle**, so a rotation cannot cover both doors within one
// grid period and a schedule has to choose which door a given roll protects.
//
// The bed is the cheap station: 1300 ms round trip, against a meter that
// drains 20/s while it is viewed and fills at `Freddy AI / 4` per second.
export const ROTATION_MS = {
  leftToRight: 3899,
  rightToLeft: 3899,
  bothDoorsTour: 7831,
  bedRoundTrip: 1300,
  closetRoundTrip: 3099,
  rollGridMs: 5000,
};

// `UNKNOWN(not-measured)`: four legs on the two door approaches advance on a
// test of `follow`'s X position (g30 `CompareX = 512`, g32 `> 530`) rather
// than on an animation, so they are not in the totals above. Nothing in the
// event sheet moves `follow` in X, which would make those tests constant --
// but the movement-block reader used to check that found **no movement block
// on any of the 485 objects**, so it cannot tell a real absence from its own
// blindness and the question stays open. The totals are lower bounds for this
// reason as well as for the readiness one.
export const FOLLOW = {
  hub: 0,
  // The look direction that selects the auto-walk out of the hub [g30 at
  // X = 512 to the left door, g34 at X = 788 to the right]. 750 matches
  // neither, so facing centre rests. X is written explicitly (g105, g107-g110)
  // and by the drag through g25 -- it is a facing, not a position.
  facing: { leftDoor: 512, rightDoor: 788, centre: 750 },
  stations: { leftDoor: 10, rightDoor: 17, closet: 29, bed: 43 },
  // Entry walks, hub -> station, in the order the states are written.
  approaches: {
    leftDoor: { via: [1, 2, 7, 8, 9], hitzone: 'HUDDoorLeftHitzone', groups: [30, 31, 39, 52, 54, 60] },
    rightDoor: { via: [4, 5, 14, 15, 16], hitzone: 'HUDDoorRightHitzone', groups: [34, 35, 40, 53, 55, 116] },
    closet: { via: [26, 27, 28], hitzone: 'HUDDoorClosetHitzone', groups: [157, 182, 183, 185] },
    bed: { via: [41, 42], hitzone: null, groups: [361, 372, 373] },
  },
  // Return walks, station -> hub.
  returns: {
    leftDoor: { via: [11, 12, 13], hitzone: 'HUDGoBackHitzone', groups: [72, 96, 97, 105] },
    rightDoor: { via: [18, 19, 13, 37], hitzone: 'HUDGoBackHitzone', groups: [125, 142, 99, 111] },
    closet: { via: [30, 31, 39], hitzone: 'HUDGoBackHitzone', groups: [197, 222, 104] },
    bed: { via: [44, 45], hitzone: 'HUDGoBackHitzone', groups: [357, 374, 377] },
  },
  // Actions available at a station, each returning to it.
  actions: {
    leftDoor: { close: { via: [20, 21, 22], groups: [163, 178, 154] },
                flashlight: { via: [35, 40], groups: [83, 84] } },
    rightDoor: { close: { via: [23, 24, 25], groups: [167, 180, 156] },
                 flashlight: { via: [36, 41], groups: [134, 135] } },
    closet: { close: { via: [32, 33, 34], groups: [215, 223, 218] } },
    bed: {},
  },
  // Only these states can act; everything else is a frame of travel.
  actionable: [0, 10, 17, 29, 43],
  source: 'g30-g37,g39-g60,g72-g116,g125-g185,g197-g224,g251,g280,g316-g318,g347,g354-g377,g438,g589',
};
