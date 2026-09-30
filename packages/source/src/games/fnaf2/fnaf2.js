// ---------------------------------------------------------------------------
// FNaF 2's night, expressed in the shared shape.
//
// This file holds **no numbers of its own**. FNaF 2's difficulty table is
// `config.js`'s `AI_BY_NIGHT`, which the live route, every survival figure
// and every graded bundle in this repository are computed against; a second
// copy of it here would be a second thing to keep true. What this adds is the
// clock, which `config.js` states as two derived constants (`NIGHT_FRAMES`,
// `HOUR_FRAMES`) without the groups that produce them, and the translation
// into the cross-game shape so all four games can be asked the same question.
//
// Regenerate the clock with
//   tools/dump/nightmap.py --game fnaf2 --clock
// ---------------------------------------------------------------------------

import {
  AI_BY_NIGHT, AI_DIALS, AI_IDS, aiCap, customNightRow, HOUR_FRAMES, FPS,
} from './config.js';

export const GAME = 'fnaf2';

// The clock [SOURCED: g627 adds 1 to the `AM` object's alterable 0 every
// 1000 ms with the fast-nights global clear and g628 every 500 ms with it
// set; g630 advances the hour at `AM >= 70` and zeroes `AM`; g631 starts the
// hour counter at **12**; g629 wraps 12 to 1; g672 leaves the frame at 6].
//
// The accumulator is an *alterable value* on an object, not a counter, which
// is why a counter-only search for FNaF 2's minute source comes back empty.
// It resets to 0 rather than to 1, so unlike FNaF 1 every hour here is the
// same length: 70 ticks of 1000 ms, and a 6 * 70 = 420 s night. That is
// `config.js`'s `NIGHT_FRAMES = s(420)` and `HOUR_FRAMES = s(70)`, now with
// the groups behind them.
export const CLOCK = {
  kind: 'accumulator',
  tickMs: 1000,        // g627
  fastTickMs: 500,     // g628
  threshold: 70,       // g630
  initialTick: 0,
  resetTick: 0,        // g630 zeroes AM, so no first-hour seam
  wrapAt: 12,          // g629
  winHour: 6,          // g672
  startsAt: 12,        // g631 -- the counter reads 12 AM, index 0
  source: 'g627,g628,g629,g630,g631,g672',
};

// The published per-hour table, translated into the shared row shape. The
// values are `AI_BY_NIGHT`'s; nothing is restated.
export const ROWS = Object.entries(AI_BY_NIGHT).flatMap(([night, rows]) =>
  rows.map((row) => ({
    night: { op: '=', value: Number(night) },
    hour: row.hour,
    set: row.set,
  })));

// FNaF 2 is the only game in the series that clamps its AI counters
// [SOURCED: g829 holds Foxy at 17, g830 Golden Freddy at 10, g856-g863 the
// rest at 15]. The same detector finds no cap group in FNaF 1, 3 or 4.
export const CAP = aiCap;

export const MODEL = {
  game: GAME,
  clock: CLOCK,
  rows: ROWS,
  cap: CAP,
  initialLevels: Object.fromEntries(AI_IDS.map((id) => [id, 0])),
  rolls: {},   // FNaF 2's per-character rules live in plant-model.js
};

export { AI_DIALS, AI_IDS, customNightRow, HOUR_FRAMES, FPS };
