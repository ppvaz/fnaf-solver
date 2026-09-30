// ---------------------------------------------------------------------------
// FNaF 1's night, from `05-06-Main_Room.txt` (951 groups, 0 unclassified).
//
// Every constant here carries the group that states it. Regenerate with
//   tools/dump/nightmap.py --game fnaf1 --table --clock --rolls
//
// The published community figures for this game are unusually complete, which
// makes it the calibration target for the whole reader: the four movement
// periods (4.97 / 4.98 / 3.02 / 5.01 s), the difficulty table, and the 8:55
// night all fall out of the dump and match the public record exactly. Where
// this file departs from the public record it says so.
// ---------------------------------------------------------------------------

export const GAME = 'fnaf1';

// The clock [SOURCED: g397 ticks the minute counter +1 every 1000 ms with
// the fast-nights global clear, g398 every 500 ms with it set; g399 advances
// the hour at 90 and resets the minute counter to **1**, not 0; g400 wraps
// the hour at 13; g435 leaves the frame at hour 6].
//
// The reset to 1 is the whole reason the first hour is longer: hour 0 runs
// 0 -> 90 (ninety ticks) and every later hour runs 1 -> 90 (eighty-nine), so
// a night is 90 + 5*89 = 535 s = 8:55. That is the figure the community
// publishes, derived here rather than copied.
export const CLOCK = {
  kind: 'accumulator',
  tickMs: 1000,
  fastTickMs: 500,          // g398, gated on GlobalValue[3] == 1
  threshold: 90,            // g399
  initialTick: 0,           // the counter's frame default
  resetTick: 1,             // g399 sets 1, which is why hour 0 is one tick longer
  wrapAt: 13,               // g400
  winHour: 6,               // g435
  source: 'g397,g398,g399,g400,g435',
};

export const CHARACTERS = ['freddy', 'bonnie', 'chica', 'foxy'];

// The counter each character's level lives in, as the sheet names it.
export const COUNTERS = {
  freddy: 'freddy activity',
  bonnie: 'bonnie activity',
  chica: 'chica activity',
  foxy: 'fox activity',
};

// Difficulty by night [SOURCED: g437-g443]. Night 7 copies the four Custom
// Night dials out of globals 6-9, so its levels are whatever the player set.
//
// Night 4's Freddy is the one stochastic entry in the table: `1 + Random(2)`
// is 1 or 2, drawn once at night start.
export const ROWS = [
  { group: 437, night: { op: '=', value: 1 }, set: { bonnie: 0, chica: 0, foxy: 0, freddy: 0 } },
  { group: 438, night: { op: '=', value: 2 }, set: { bonnie: 3, foxy: 1, chica: 1, freddy: 0 } },
  { group: 439, night: { op: '=', value: 3 }, set: { bonnie: 0, chica: 5, foxy: 2, freddy: 1 } },
  { group: 440, night: { op: '=', value: 4 }, set: { bonnie: 2, foxy: 6, chica: 4, freddy: { min: 1, max: 2 } } },
  { group: 441, night: { op: '=', value: 5 }, set: { bonnie: 5, chica: 7, foxy: 5, freddy: 3 } },
  { group: 442, night: { op: '=', value: 6 }, set: { bonnie: 10, chica: 12, foxy: 6, freddy: 4 } },
  // g443: night 7 reads GlobalValue[6..9] -- the Custom Night dials.
  { group: 443, night: { op: '=', value: 7 }, set: {}, custom: ['freddy', 'bonnie', 'chica', 'foxy'] },

  // The hourly escalation [SOURCED: g470 at 2 AM, g471 at 3 AM, g472 at
  // 4 AM]. These groups carry **no night comparison** -- they fire on every
  // night including Custom Night, which is why they are rows with a night
  // condition that always holds rather than entries under each night.
  { group: 470, night: { op: '>=', value: 1 }, hour: 2, add: { bonnie: 1 } },
  { group: 471, night: { op: '>=', value: 1 }, hour: 3, add: { bonnie: 1, chica: 1, foxy: 1 } },
  { group: 472, night: { op: '>=', value: 1 }, hour: 4, add: { bonnie: 1, chica: 1, foxy: 1 } },
];

// No cap group exists [MEASURED 2026-09-20: the query that finds FNaF 2's six
// cap groups (g829, g830, g856-863) returns nothing here, on FNaF 3 or on
// FNaF 4. The detector was run against FNaF 2 first and read the positive, so
// this absence is evidence rather than a blind query].
export const CAP = null;

// The movement rolls [SOURCED: g318-g321]. Each is its own `Every` timer, so
// the four are on independent, mutually prime-ish periods and drift against
// each other through the night.
export const ROLLS = {
  bonnie: { group: 318, everyMs: 4970, bound: 20, gates: [] },
  chica: { group: 319, everyMs: 4980, bound: 20, gates: [] },
  // Freddy alone is gated on the monitor being **down** (`viewing = 0`), so
  // watching any camera freezes him -- the inverse of the Foxy rule below.
  freddy: { group: 320, everyMs: 3020, bound: 20, gates: ['viewing = 0'] },
  // Foxy needs all three: not watching Pirate Cove, not already out, and the
  // camera-attention timer expired. See FOXY below.
  foxy: {
    group: 321,
    everyMs: 5010,
    bound: 20,
    gates: ['viewing <> 99', 'fox progress < 3', 'attention timer = 0'],
  },
};

// Foxy's camera-attention hold [SOURCED: g460 sets the timer to
// `50 + Random(1000)` **every 100 ms while any camera is up** (`viewing > 0`);
// g445 drains it by 1 per frame with a `Max(0, ...)` floor; g321 requires it
// at 0 before Foxy may advance].
//
// Two things the public account flattens:
//
//   - The hold is refreshed by **any** camera, not a particular one. The
//     community's "check any camera, East Hall Corner recommended" is right
//     about the mechanic and the recommendation is about what else you see.
//   - `viewing <> 99` in g321 is a *separate* gate, and 99 is Pirate Cove:
//     g90-g94 select the Pirate Cove stage art by `fox progress` exactly when
//     `viewing = 99`. So watching Pirate Cove blocks Foxy through a different
//     condition than watching anything else does.
//
// The timer is 50..1049 frames, i.e. 0.83..17.5 s at 60 Hz, redrawn ten times
// a second while the monitor is up. UNKNOWN(not-measured): the distribution
// of the *effective* hold after a monitor session, which is the maximum of
// the draws taken during it and is not the same as one draw.
export const FOXY = {
  attentionTimer: { group: 460, refreshMs: 100, min: 50, bound: 1000, whileViewing: true },
  drain: { group: 445, perFrame: 1, floor: 0 },
  pirateCoveView: 99,
  // g60: viewing Pirate Cove's hall camera at `fox progress = 3` advances him
  // to 4 and starts the run. Looking is not always free.
  runTrigger: { group: 60, view: 3, fromProgress: 3, toProgress: 4 },
  source: 'g445,g460,g321,g60,g90-g94',
};

// The camera view ids [SOURCED: the sheet compares `viewing` against exactly
// these eleven values, and FNaF 1 has eleven cameras].
//
// Only three are pinned to a camera by the sheet itself: 99 is Pirate Cove
// (g90-g94 render its stage art), 42 is CAM 4B (g78-g83 test Chica against
// `cam4B.Active`), and 1 is the Show Stage (g44 tests Freddy against
// `cam1A.Active`). UNKNOWN(unmapped-view-ids): the remaining eight. The ids
// are carried in each button's alterable 0 (g1779/g1829 copy it into
// `last clicked`), which is instance data and not in the event sheet.
export const VIEWS = {
  office: 0,
  ids: [1, 2, 3, 4, 5, 6, 7, 22, 33, 42, 99],
  known: { 1: 'CAM 1A (Show Stage)', 3: 'CAM 2A (West Hall)', 42: 'CAM 4B', 99: 'CAM 1C (Pirate Cove)' },
  source: 'g44,g60,g78-g83,g90-g94',
};

// Power [SOURCED: g314 sets 999 at frame start; g315 subtracts the usage
// meter every 1000 ms; g313 computes `usage = 1 + Sigma(control room follow
// 0..4)`; g282/g283 put the camera in slot 0, g305-g312 the two doors and
// two lights in slots 1-4; g418 declares the blackout at <= 0].
//
// **The per-night drain is a second, separate subtraction** [SOURCED:
// g477-g480]: one extra unit every 6000 ms on Night 2, 5000 ms on Night 3,
// 4000 ms on Night 4 and 3000 ms on Night 5 and after. Night 1 has no entry
// and therefore no extra drain.
//
// This is not in the usual public description of the power system, which
// attributes the later nights' pressure entirely to higher AI. It was found
// by the table reader rather than by looking for it: a hand search for
// `power left` reads g314 and g315, finds a complete-looking model, and
// stops. UNKNOWN(not-verified-on-device).
//
// The base drain is on a 1000 ms wall clock with no fast-nights branch, while
// the hour is halved under fast nights -- so fast nights spend half as much
// power per in-game hour. That asymmetry is in the source, not a model choice.
export const POWER = {
  initial: 999,                                   // g314
  drainMs: 1000,                                  // g315
  usageBase: 1,                                   // g313
  usageSlots: ['camera', 'leftDoor', 'rightDoor', 'leftLight', 'rightLight'],
  extraDrainMs: { 1: null, 2: 6000, 3: 5000, 4: 4000, 5: 3000, 6: 3000, 7: 3000 },
  blackoutAt: 0,                                  // g418
  source: 'g282,g283,g305-g313,g314,g315,g418,g477-g480',
};

export const MODEL = {
  game: GAME,
  clock: CLOCK,
  rows: ROWS,
  cap: CAP,
  initialLevels: { freddy: 0, bonnie: 0, chica: 0, foxy: 0 },
  rolls: ROLLS,
};
