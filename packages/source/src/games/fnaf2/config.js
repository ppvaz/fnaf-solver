// ---------------------------------------------------------------------------
// FNaF 2 "Minus 7" trainer — tuning constants.
//
// Values marked [SOURCED] come from either attributed community PC reverse
// engineering or the owned Android event-sheet extraction; the nearby comment
// must say which. Android is canonical; gaps are tracked in
// docs/android/ANDROID-SOURCE-STATUS.md. PC parity work is deferred.
// Values marked [MODEL] retain a useful community behavior that the Android
// extraction has not confirmed (or currently contradicts).
// Values marked [CALIBRATED] are not published numbers;
// they are chosen so the simulation behaves the way the documented gameplay
// behaves, and are safe to tune.
//
// [MAPPING AUDIT 2026-08-20] The Android runtime XOR-scrambles object handles
// (^28); every pre-2026-08-20 event dump therefore carried systematically
// swapped object NAMES (Toy<->Withered pairs included). Numeric values below
// came from event constants and are unaffected. Identity-derived rules
// (which character owns which route/gate/endgame branch) are being re-audited
// against the corrected dump; entries verified post-XOR say so in their
// comment. See docs/android/ANDROID-CAMERA-STALL.md.
// ---------------------------------------------------------------------------

export const FPS = 60;
export const s = (sec) => Math.round(sec * FPS); // seconds -> frames

export const NIGHT_FRAMES = s(420);   // 7:00 [SOURCED]
export const HOUR_FRAMES = s(70);     // 1:10 per in-game hour [SOURCED]

// [SOURCED: Android decompile — Office groups 450-457.] With the monitor up
// (`viewing` > 0) and the camera light on (`lit?` = 1), the selected-camera
// marker (`your view`) overlapping a character sets its alterable B from the
// `stun time` counter: initial 400, and no event in the entire program ever
// writes it. B drains ~1 per 60 FPS frame (group 1236 delta scale) and the
// movement pipeline requires B = 0, so one flash = 400 frames = 6.67 s. The
// community's 6.66 s figure is exact on Android. Per-group exclusions: no
// stun while `viewing` = 8 (Withereds), 9 (Toys), or 11 (Mangle, group 456);
// Paper Pals gets 400 - 50*night (group 457).
// An earlier audit declared this subsystem dormant ("Counter 152 `time
// allowed` = 0"). That was the pre-XOR handle scramble: the runtime XORs
// every object handle with 28 (COI.loadHeader), so expression handle 152 is
// really the counter stored as 132 — `stun time` = 400. See
// docs/android/ANDROID-CAMERA-STALL.md.
export const STUN_FRAMES = 400;
export const MO_FRAMES = s(5);        // movement opportunity every 5s [SOURCED]
export const BLACKOUT_FRAMES = s(5);  // [SOURCED]
// Endpoint resolution order [SOURCED: g537 raises `check and move` when the
// 300-frame office sequence ends, then g538-555 are evaluated in group order
// and the FIRST match sets it back to 0]. So exactly one occupant of marker
// 122 resolves per encounter no matter how many are queued there, and which
// one is fixed by group index rather than by who triggered it. The global
// `got you stage` decides which half of the table runs: 0 is a defended
// encounter (g533, mask fully on before the fuse expired), 2 is a failed one
// (g532). Mangle is absent from the whole table -- her 122 edge is g402/403.
export const RESOLVE_ORDER_DEFENDED =
  ['withfreddy', 'withbonnie', 'withchica', 'toyfreddy', 'toybonnie', 'toychica'];
export const RESOLVE_ORDER_FAILED =
  ['withfreddy', 'withbonnie', 'withchica', 'toybonnie', 'toychica', 'toyfreddy'];

// Mask grace before an office attack arms, in frames, indexed by night
// [SOURCED: decompile — the `time allowed` -> `time left` fuse (post-XOR
// names; the pre-XOR dump called these `stun time` -> `mute call`). It
// starts when an attacker engages at the office entry; masking while it
// burns defuses the attack, expiry arms it and the mask stops repelling. The
// old flat 45 was only ever the night-7 value; night 1 gives more than
// double.]
export const MASK_GRACE_BY_NIGHT = { 1: 100, 2: 80, 3: 60, 4: 55, 5: 50, 6: 50, 7: 45 };
export const maskGraceFrames = (night) => MASK_GRACE_BY_NIGHT[night] ?? MASK_GRACE_BY_NIGHT[7];
export const BLACKOUT_MASK_GRACE = MASK_GRACE_BY_NIGHT[7]; // night-7 value; UI copy uses this

// Foxy [SOURCED: post-XOR decode 2026-08-20, groups 337/389-390/745/824-825/
// 846/855/864/872-874]. Roll every 5 s: (21+Random(5)) - D <= `old Foxy AI`
// (his AI caps at 17, group 829, unlike the shared 15). D (+1/s unengaged,
// +1/s MORE while masked with the threshold clear) is zeroed all night 1 and
// until 2AM night 2. Exposure is per-frame (v9 vs 100*night) with a B=50
// hall pin while lit; retreat writes B = 500+Random(500). GOT-YOU: 10 s
// clock in either monitor state, or instant on a monitor-down hall flash.
// Fully modeled as of 2026-08-20 (second pass): dormancy, the masked +1/s
// acceleration, per-frame exposure vs 100*night, and the B = 50 hall pin
// that holds both his eviction and his rolls until 50 frames after the
// light comes off.
export const FOXY_AI = 17;
export const foxyExposureFrames = night => 100 * night;
export const FOXY_HALL_PIN_FRAMES = 50;
export const FOXY_RETURN_MIN = 500;
export const FOXY_RETURN_MAX = 999;
export const FOXY_ENTER_MIN = s(5);
export const FOXY_ENTER_MAX = s(10);

// Retained BB mask-storage abstraction. The seven marker-122 attackers now use
// their character-specific Android endgames instead of this generic counter.
// [SOURCED: g294 (BB), g401 (Mangle), and Toy Chica's twin] five one-second
// ticks with the mask fully on force a vent occupant back to their route.
// g907 counts them and g293 zeroes the counter on every entry into the fully-on
// state, so this is a continuous hold: there is no mask storage on this build.
export const VENT_MASK_TICKS = 5;
export const MASK_STORAGE_CAP = 59;        // storable sub-second mask time
export const VENT_EARLY_LEAVE_CHANCE = 0.1; // per cumulative second

// The Withereds and Toy Freddy (the four `office occupied` mutex holders)
// walk in once the CURRENT continuous cams-up session reaches 20 - 2*night
// seconds; the counter resets the moment the monitor starts coming down.
// Replaces the old flat "5s in the opening with cams up" (VENT_KILL_FRAMES)
// model. [SOURCED: decompile — the `value25` cams-up-session second counter
// against the 20 - 2*night threshold. Identity re-bound 2026-08-20 after the
// XOR fix: pre-fix notes attributed this to "the Toys and W. Freddy".]
export const entryStreakFrames = (night) => s(20 - 2 * night);
// The shared value25 streak applies to the four mutex holders, not every
// occupant of marker 122. Toy Bonnie instead gets a per-unit cooldown of
// 1000-100*night frames and Toy Chica arms after six scheduler ticks.
// Both must be masked before a later cams-up trip. Mangle's 122->123 edge is
// the same shape as Balloon Boy's [SOURCED: g402 flags her when the raise
// starts, g403 moves her to 123 when it finishes], so an unchecked Mangle
// does not sit at 122 -- the next completed raise takes her in. The
// Chica counter increments on the global one-second event (g904) and g905
// advances her only above five: exactly six phase-aligned scheduler ticks.
// (Pre-XOR these were labeled Withered Bonnie / Withered Chica.)
export const toyBonnieOpeningFrames = night => 1000 - 100 * night;
export const TOY_CHICA_OPENING_TICKS = 6;
// Endpoint resolution (groups 538-555) repels a defended marker-122 occupant
// to a sourced mid-route room — W. Bonnie to CAM 07, W. Chica to CAM 04,
// Toy Bonnie to CAM 03 — with a fresh approach cooldown written into their B:
// Random(500)/night. A marker-123 leave (groups 747-750) writes B = 500 flat.
// Toy Chica's five-tick mask leave returns her to CAM 07 (no sourced
// cooldown). Destinations the dump does not name stay at the route start.
export const REPEL_COOLDOWN_ROLL = 500;
export const INSIDE_LEAVE_COOLDOWN = 500;
// At marker 122, Toy Bonnie does not accept a generic direct mask repel.
// While the mask is fully on he rolls Random(2)=1 every 500 ms to create his
// office overlay (the iconic Toy Bonnie mask slide, `Active 19`). That
// overlay starts the shared defence fuse and 300-frame office sequence
// (Android groups 436-441, 530-553).
export const TOY_BONNIE_CUE_FRAMES = s(0.5);
export const TOY_BONNIE_CUE_CHANCE = 0.5;

// Marker 123 / inside-office branches [SOURCED: Android groups 556-569,
// 729-731, 747-750]. `danger 2` starts a 40-frame attack transition. Mangle
// arms on a 1-in-20 cameras-up second and attacks on a later cameras-down edge.
export const INSIDE_ATTACK_FRAMES = 40;

// The reaction window: how long you have to get the mask on once an attacker
// has raised danger in the office. [SOURCED: Android frame 3 groups 523-529
// set `time allowed` (object 132) by night; g530 copies it into `time left`
// (133) and sets `got you stage` (134) = 1; g531 decrements `time left` once
// per frame with no timer condition; g532 turns stage 1 into stage 2 (the
// attack) when it reaches 0; **g533 turns stage 1 back into stage 0 when
// `mask` (89) == 2**, which is the fully-on state g9 sets after the 12-frame
// put-on animation.]
//
// Corrected 2026-08-26. This project modelled the window as a flat
// INSIDE_ATTACK_FRAMES = 40 for every night, cited to g556-569 -- which is a
// DIFFERENT mechanic (the got-you-box roll while already masked, groups
// 556-559/747-750). The real window is per-night and 2.2x wider on Night 1
// than the constant it replaced, and it TIGHTENS as the nights go on, which is
// the part the flat constant erased entirely.
//
//   night  1: 100 frames   2: 80   3: 60   4: 55   5: 50   6: 50   7+: 45
//
// At 60 fps that is 1.67 s on Night 1 and 0.75 s from Night 7 -- and 0.75 s is
// the figure the community's transcribed FNaF 2 AI breakdowns quote, which is
// an independent check on both the table and the frame rate.
// The seven groups are mutually exclusive and nothing else writes object 132,
// so there is no ordering question: 523 is `night <= 1`, 524-528 are `night ==
// 2..6`, and 529 is the tail `night >= 7`. Night 6 is 50 and night 7 is 45 --
// they are NOT the same, which is a common recollection and the dump refutes it.
//
// UNKNOWN(what object 108 `night` holds during Custom Night). The 45 applies to
// anything the game calls night >= 7, and Custom Night is night 7 in the menus,
// but that variable has not been read on a Custom Night run here. Do not price
// a 10/20 route against 0.75 s until it has been.
export const TIME_ALLOWED_BY_NIGHT = { 1: 100, 2: 80, 3: 60, 4: 55, 5: 50, 6: 50 };
export const TIME_ALLOWED_NIGHT7 = 45;
export const timeAllowedFrames = (night) =>
  night >= 7 ? TIME_ALLOWED_NIGHT7
             : (TIME_ALLOWED_BY_NIGHT[Math.max(1, night)] ?? TIME_ALLOWED_BY_NIGHT[1]);
export const INSIDE_MASK_ATTACK_CHANCE = 0.5;
export const INSIDE_MASK_LEAVE_CHANCE = 0.1;
export const MANGLE_INSIDE_ARM_CHANCE = 0.05;

// Balloon Boy [SOURCED: Android groups 342 (roll), 359 (look-hold), 413-418
// (route hops), 417 (the hop into the opening)]. His route is
// CAM 10 -> 07 -> 03 -> 01 -> 05 -> vent opening: five moves, not four. Only
// the last one is monitor-gated, and only the middle three play his laugh
// (g414-416 write the laugh sample bank read by g608-611), so the community's
// "third laugh, he is in the vent camera" is move 4 arriving on CAM 05.
export const BB_MOVE_CHANCE = 0.75;
export const BB_STAGES = 5;
// Hops 1..BB_SILENT_HOPS make no sound; the first one (CAM 10 -> 07) is silent.
export const BB_SILENT_HOPS = 1;

// Sample handles, so a controller can be held to what a microphone could
// actually recover. Sounds are dispatched through registers on `cam 01`, not
// played inline: v6 -> g608-611, v21 -> g691-694.
// [SOURCED: Android decompile — Office frame.]
// THUD is the movement sample 18 edges across 7 characters share, including
// BB's two mask-clears (g292/294) and every other character's (g400/401,
// g439/440, g748/749). Nothing in the audio distinguishes them, which is why
// plan 08 removed early unmasking from scope.
export const THUD_SAMPLE = 17;
// The three vocals g414-416 select at random. Every vocal hop sets channel 14
// to the same volume, so amplitude carries no range information.
export const BB_VOCAL_SAMPLES = [21, 24, 23];
// g607 adds this on arrival at marker 122, so reaching the opening is a pair
// (thud + 21) rather than a bare thud. Sample 21 is also one of the vocals.
export const BB_ARRIVAL_SAMPLE = 21;

// Mangle's proximity static loop. [SOURCED: Android audio groups g732/733,
// sample s0020 on channel 16, proximity-gated by the CAM 11 and right-vent
// markers.] It is a sustained audio occupancy cue; there is intentionally no
// visual fact here yet. The observer models its context through
// `mangle-static`.
export const MANGLE_STATIC_SAMPLE = 20;
// Mangle's private movement bank. [SOURCED: g703 writes cam 01.v12 when the
// new-foxy/Mangle route overlaps `hear footsteps`; g709-711 dispatch IDs
// 30-32 on channel 19. These are separate from the shared thud 17 and the
// proximity static 20.]
export const MANGLE_MOVEMENT_SAMPLES = [30, 31, 32];

// The music-box winding tick. [SOURCED: g637 (mouse-hold twin, conds
// `Every 500 ms` + Key + `music button` overlap + `viewing == 11`) and g644
// (touch-hold twin, reached via g642/g643's `Multiple Touch` over
// `musicButtonHitbox`) both play `Sample 'WinD'`, handle 33 — a ~0.28 s
// ratchet — on a global `Every 500 ms` timer while the wind button is held on
// CAM 11.] Modelled frame-locked like every other Fusion `Time:` condition in
// this file (g263's 200 ms sampler, the 5 s movement interval). The timer is
// global: its edges sit on a fixed frame grid (multiples of WIND_TICK_FRAMES),
// not relative to when winding began — which is what makes the audible tick a
// candidate game-phase reference. Whether the device honours it frame-locked
// or wall-locked is unmeasured; see `MINUS-3-STRATEGY.md` §9.
export const WIND_TICK_SAMPLE = 33;
export const WIND_TICK_FRAMES = s(0.5);
// Channel 14 volume. The same three samples mean two different things and the
// level is what separates them: g60 defaults the channel to 50, g414-416 play
// a route hop at 25, and g906 plays at 60 when he is on the camera you are
// watching. A detector that normalises level away cannot tell them apart.
export const BB_VOCAL_VOLUME = 25;
export const BB_VIEW_VOCAL_VOLUME = 60;
export const BB_VOCAL_CHANNEL_DEFAULT = 50;

// Golden Freddy — office [SOURCED: g336 spawn, g776 mask clear, g777 kill on
// a monitor raise, g778 kill on a hall flash]. g336 rolls `Random(20) <
// Golden Freddy AI` on a 5 s interval with the monitor fully up and no
// `yellowbear` already present; g830 caps his AI at 10 (the others cap at 15),
// so 10/20 is exactly one in two. g804 zeroes his AI below night 6.
export const GF_SPAWN_CHANCE = 0.5;
// Golden Freddy — hallway [SOURCED: g781 roll, g779 exposure, g780 kill,
// g865 reset]. g781 re-rolls `golden` v1 = Random(10) every one-second event
// while the hall light is OFF; v1 = 1 is the frame that draws him (g204). So
// his presence is re-decided each second, and holding the light freezes it.
export const GF_HALL_ROLL = 10;
// g779 adds one per frame while the light is on him and the hall is otherwise
// empty; g780 kills above 100, so 101 frames.
export const GF_HALL_KILL_FRAMES = 100;
// `hall movement` [SOURCED: g875-880 set it to 300 when W. Freddy, W. Bonnie,
// T. Freddy, T. Chica, Mangle or W. Foxy overlaps the `hall movement` hitbox
// (669, 503; 16x125, X-scaled to 14 px by g989), which only `hall stage 1`
// (668, 481) and `hall stage 2` (668, 550) overlap -- no camera marker does;
// g881 drains it]. Each group carries Fusion's "only one action when event
// loops" flag (C -7), so the 300 is written once per *entry* into the hall
// column, not refreshed while the character stands there. g779 needs it at
// zero (and the column empty), and g202/g1035 draw the hall's "movement"
// frame while it is above zero. Ledger: ANDROID-SOURCE-STATUS.md 2026-09-15.
export const HALL_MOVEMENT_FRAMES = 300;
// [SOURCED: g848-854.] The office-light latch rewrites movement countdown B
// to 40 every frame for these hall occupants. After g488 clears the latch on
// the next one-second event, that final 40-frame countdown still must drain.
// W. Chica and Toy Bonnie are the explicit exceptions.
export const HALL_LIGHT_PIN_FRAMES = 40;
export const HALL_LIGHT_PIN_IDS = new Set([
  'withfreddy', 'withbonnie', 'toyfreddy', 'toychica', 'mangle',
]);

// Stalled animatronics: everyone is capped at 15 AI in 10/20 [SOURCED]
export const STALLED_AI = 15;
// random(1..20) <= AI. At the 15 cap this is 75%, which matches BB's documented
// 3/4 rate. (One written guide states (AI+1)/20; TheBones5 and jerakaigamez both
// state 75% at 15 AI, so this is the formula used here.)
export const MO_CHANCE = (ai) => ai / 20;
// The Puppet is the exception [SOURCED: g494-497]. The shared rolls use
// Random(20)+1 <= AI or Random(20) < AI, both AI/20. `Sockpuppet AI` uses
// bare Random(20) <= AI, which succeeds for 0..AI: (AI+1)/20. At AI 15 his
// roll is therefore 16/20, not 15/20.
export const PUPPET_MO_CHANCE = (ai) => (ai + 1) / 20;

// AI levels, by night and hour [SOURCED: g673 zeroes every counter at the
// start of any night but Custom; g674-684 are the per-night table, each row
// naming only the characters it changes; g787 copies the ten Custom Night
// dials on night 7; g804 zeroes Golden Freddy below night 6; g815-821 set the
// Puppet, who has no dial and no cap group]. `time of the night` is the hour
// counter and hour 0 is 12 AM, so a row with no hour fires at night start and
// a later row overwrites only what it names. Rebuild the whole table from the
// dump with `tools/dump/aimap.py`.
//
// The caps run every frame: g829 holds Foxy at 17, g830 holds Golden Freddy
// at 10 (which is what makes his 10/20 office roll exactly one in two), and
// g856-863 hold everyone else at 15.
export const AI_10_20 = 20;                 // every dial at 20
export const AI_CAPS = { foxy: FOXY_AI, golden: 10 };
export const AI_CAP_DEFAULT = STALLED_AI;
export const aiCap = (id) =>
  id === 'puppet' ? Infinity : (AI_CAPS[id] ?? AI_CAP_DEFAULT);

// Every counter g673 zeroes at night start. The Puppet is not among the ten
// Custom Night dials, which is why he is listed apart from them.
export const AI_DIALS = ['withfreddy', 'withbonnie', 'withchica', 'foxy',
  'toyfreddy', 'toybonnie', 'toychica', 'mangle', 'bb', 'golden'];
export const AI_IDS = [...AI_DIALS, 'puppet'];
const TEN_TWENTY = Object.fromEntries(AI_DIALS.map(id => [id, AI_10_20]));

// `{ oneIn: N }` is the source's `(Random(N) + 1) / N` under integer division:
// 1 with probability 1/N and 0 otherwise, rolled when the row fires. Golden
// Freddy is the only character written that way. g804 zeroes him below night
// 6, but it runs once, at night start, so it only cancels the rows that share
// that instant: nights 3, 4 and 5 write him at 12 AM and lose it, while night
// 2 writes him at 1 AM and keeps it. Night 2 is therefore the one night below
// 6 where he can appear at all, at one in a thousand.
export const AI_BY_NIGHT = {
  1: [{ hour: 0, set: { puppet: 1 } },                                    // g815
      { hour: 2, set: { toybonnie: 2, toychica: 2 } },                    // g674
      { hour: 3, set: { toybonnie: 3, toyfreddy: 2 } }],                  // g675
  2: [{ hour: 0, set: { puppet: 5 } },                                    // g816
      { hour: 1, set: { toyfreddy: 2, toybonnie: 3, toychica: 3,          // g676
                        mangle: 3, bb: 3, foxy: 1,
                        golden: { oneIn: 1000 } } }],
  3: [{ hour: 0, set: { withbonnie: 1, withchica: 1, foxy: 2, bb: 1,      // g677
                        puppet: 8 } },                                    // g817
      { hour: 1, set: { withfreddy: 2, withbonnie: 3, withchica: 2,       // g678
                        foxy: 3, toybonnie: 1, toychica: 1, bb: 2 } }],
  4: [{ hour: 0, set: { withbonnie: 1, foxy: 7, mangle: 5, bb: 3,         // g679
                        puppet: 9 } },                                    // g818
      { hour: 2, set: { withfreddy: 3, withbonnie: 4, withchica: 4,       // g680
                        toybonnie: 1 } }],
  5: [{ hour: 0, set: { withfreddy: 2, withbonnie: 2, withchica: 2,       // g681
                        foxy: 5, toyfreddy: 5, toybonnie: 2, toychica: 2,
                        mangle: 1, bb: 5, puppet: 10 } },                 // g819
      { hour: 1, set: { withfreddy: 5, withbonnie: 5, withchica: 5,       // g682
                        foxy: 7, toyfreddy: 1, mangle: 10 } }],
  // Night 6 is two rows, and the second is the 2 AM cliff: the three Toys
  // switch on there, Balloon Boy goes 5 -> 9, and Golden Freddy stops being a
  // one-in-ten coin flip and becomes a real 3.
  6: [{ hour: 0, set: { withfreddy: 5, withbonnie: 5, withchica: 5,       // g683
                        foxy: 10, mangle: 3, bb: 5, golden: { oneIn: 10 },
                        puppet: 15 } },                                   // g820
      { hour: 2, set: { withfreddy: 10, withbonnie: 10, withchica: 10,    // g684
                        foxy: 15, toyfreddy: 5, toybonnie: 5, toychica: 5,
                        mangle: 10, bb: 9, golden: 3 } }],
  7: [{ hour: 0, set: { ...TEN_TWENTY, puppet: 15 } }],                   // g787, g821
};

// A Custom Night AI vector: the ten adjustable dials (`AI_DIALS`) at whatever
// the player set them to. The menu has no Puppet dial and no per-hour rows, so
// a custom night is a single 12 AM row with the Puppet pinned at 15 (g821).
// `night` stays 7, so every sourced `night >= 7` rule still applies (the
// 45-frame office fuse, the CAM 10 parked marker). A dial the caller omits
// stays 0; the per-frame caps (g829/g830/g856-863) still clamp on apply, so a
// search that dials Foxy to 20 gets 17, Golden Freddy 10, the rest 15.
export const customNightRow = (dials) => ({
  hour: 0,
  set: { ...dials, puppet: dials.puppet ?? PUPPET_AI },
});

// The rows that fire as this hour begins. `customNight` (an `AI_DIALS` vector)
// replaces the whole night table with one 12 AM row.
export const aiUpdates = (night, hour, customNight = null) =>
  customNight
    ? (hour === 0 ? [customNightRow(customNight)] : [])
    : (AI_BY_NIGHT[night] ?? AI_BY_NIGHT[7]).filter(row => row.hour === hour);

// The highest AI a character can hold at any point of a night, read off the
// same rows the engine applies. A `{ oneIn: N }` row is 1 on its top draw, so
// its peak is 1 -- rare is not impossible and must not read as zero.
//
// This exists so a *policy* can ask the source whether a threat exists on a
// night instead of inferring it from whether one sampled seed happened to
// show it. g673 zeroes every counter at night start, so a character no row
// ever names stays at 0 for the whole night: Balloon Boy on Night 1 cannot
// act, while Night 3 sets him to 1 and then 2 and merely makes him rare.
export const peakAi = (night, id, customNight = null) => {
  const rows = customNight ? [customNightRow(customNight)] : (AI_BY_NIGHT[night] ?? AI_BY_NIGHT[7]);
  let peak = 0;
  for (const row of rows) {
    const level = row.set[id];
    if (level === undefined) continue;
    peak = Math.max(peak, Math.min(typeof level === 'number' ? level : 1, aiCap(id)));
  }
  return peak;
};

// Whether the sourced table lets this character act at all on this night (or,
// with `customNight`, whether that vector arms it).
export const canAct = (night, id, customNight = null) => peakAi(night, id, customNight) > 0;

// Power [SOURCED]
// [SOURCED: decompile — the battery counter (true name `battery life`; the
// pre-XOR dump called it `cam 9`) is set per night at night start and drains
// 1 per frame while the light is on, office or cams. Night 5+ is 3000 frames
// = 50s of light, which both Markiplier's on-camera measurement and this
// file's old calibrated value already had exactly right; earlier nights get
// more.]
export const POWER_BY_NIGHT = { 1: 7000, 2: 6000, 3: 5000, 4: 4000, 5: 3000, 6: 3000, 7: 3000 };
export const powerFrames = (night) => POWER_BY_NIGHT[night] ?? POWER_BY_NIGHT[7];
export const POWER_FRAMES = POWER_BY_NIGHT[7]; // night-7 value; tools report against this
export const POWER_PER_BAR = POWER_FRAMES / 5;
export const POWER_BLINK = 500;   // indicator starts blinking [SOURCED]

// Music box [SOURCED for the counter and the wind; the DRAIN RATE IS DISPUTED]
//
// The counter is sourced: g652 sets `music button` AlterableValue0 to 2000 at
// frame start, g638/g643 add +5 per tick while the button is held, and g645
// snaps anything below 300 up to 300.
//
// The drain is not, and 2026-08-26 device measurement contradicts this
// constant. 16.67 s is 2000 units at 120 units/s, and `recipe.mjs` states that
// 120/s figure as **"Nights 6-7"** -- yet it is applied here to every night.
//
// Measured on the phone, Night 1, never winding, sampling the CAM 11 pie every
// ~9 s (captures are local-only; the pie is the white ellipse right of the wind
// button, roughly x 640-850, y 770-900 at 2400x1080):
//
//     t+114s  0.626   t+142s  0.551   t+170s  0.180
//     t+123s  0.625   t+151s  0.427   t+179s  0.054
//     t+133s  0.628   t+160s  0.304   t+188s  0.000
//
// Two disagreements with this file, both mattering to the campaign nights:
//
//   1. The box does not start draining at night start. It held flat for the
//      first ~133 s of Night 1 and only then began falling. The engine has no
//      activation term at all -- `tickBox` drains whenever `opts.boxEnabled`,
//      which is a global option and not a per-night rule.
//   2. Full -> empty took about **55 s**, not 16.67 s -- roughly 36 units/s,
//      a factor of 3.3 slower than this constant.
//
// So Night 1 (and plausibly 2-5) is priced here with a night-6/7 drain running
// from a night-6/7 start time. The direction is pessimistic -- the simulator
// demands more winding than the game does -- which is the safer direction but
// still wrong, and it makes any wind-budget claim below Night 6 unsound.
//
// Caveats on the measurement, so it is not over-read: the pie fraction is not
// known to be linear in counter units, 0.626 may be a saturated "full" rather
// than the true maximum, and the activation time is bracketed only to
// 133-142 s at a 9 s sampling interval. What is not in doubt is the sign and
// the rough magnitude of both disagreements.
//
// ~~NOT YET FIXED. The per-night drain groups have not been located in the dump~~
// **FOUND AND FIXED 2026-08-26. The groups are g653-660**, and they confirm
// both device disagreements above, from source.
//
// Each is `music button` AlterableValue0 minus a per-night constant every
// 50 ms, gated on not winding (AlterableValue1 == 0) and not already empty:
//
//   | group | night | per 50 ms | units/s | full -> empty |
//   |-------|-------|-----------|---------|---------------|
//   | 653   | 1     | 2         | 40      | 50 s          |
//   | 654   | 2     | 2         | 40      | 50 s          |
//   | 655   | 3     | 3         | 60      | 33.3 s        |
//   | 656   | 3     | 4         | 80      | 25 s   (DEMO) |
//   | 657   | 4     | 4         | 80      | 25 s          |
//   | 658   | 5     | 5         | 100     | 20 s          |
//   | 659   | 6     | 6         | 120     | 16.67 s       |
//   | 660   | 7     | 6         | 120     | 16.67 s       |
//
// g655/g656 split on object 33 `DEMO?`: 3 when it is 0, 4 when above. The
// shipped game runs the 0 arm, so Night 3 is 60 units/s.
//
// **g653 also carries `time of the night != 12` and `!= 1`.** Night 1's box
// does not drain during 12 AM or 1 AM -- it starts at 2 AM. No other night's
// group has an hour condition. That is the sourced form of the "held flat for
// the first ~133 s" measurement above: 2 AM lands at ~150 s on a 69.7 s/hour
// night, and the drain was bracketed to 133-142 s.
//
// Three controls, because a favourable number is not a result until something
// that should not produce it has been checked:
//   1. The night 6 row independently reproduces the 16.67 s already in this
//      file, which came from recipe.mjs's "120 units/s, Nights 6-7".
//   2. The values rise monotonically with difficulty (2,2,3,4,4,5,6,6) --
//      meaningful as a drain and meaningless as an increment.
//   3. The device measured Night 1 at ~36 units/s against a sourced 40, inside
//      the stated pie-linearity caveat.
// Read as an ADD rather than a subtract, the box could never empty and g662's
// `AlterableValue0 == 0` branch would be unreachable.
export const BOX_UNITS = 2000;                      // g652
export const BOX_DRAIN_PER_TICK = { 1: 2, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 6 };
export const BOX_DRAIN_TICK_MS = 50;                // g653-660 `Time: 50`

// Full -> empty for one night, in frames.
export const boxDrainFrames = (night) =>
  s(BOX_UNITS / ((BOX_DRAIN_PER_TICK[night] ?? BOX_DRAIN_PER_TICK[7])
                 * (1000 / BOX_DRAIN_TICK_MS)));

// Whether the box drains at all in this hour. Only g653 (night 1) is gated,
// and it excludes 12 AM (hour 0) and 1 AM (hour 1).
export const boxDrainsAtHour = (night, hour) => night !== 1 || hour >= 2;

// Retained: the night 6/7 rate this file applied to every night. Callers that
// still want one number get the hardest one, which is the safe direction.
export const BOX_DRAIN_FRAMES = s(16.67);  // full -> empty; night 6/7 rate
// [SOURCED: decompile + Markiplier agree — winding below 300 snaps to 300
// (groups 639/645), then +5/frame (+300/s, groups 638/643); empty -> full is
// (2000-300)/300 = 5.67 s. The old "6.67 s gross" note forgot the snap-up.]
export const BOX_WIND_FRAMES = s(5.66);    // 300 -> full while winding
// [SOURCED: g639/g645 — a wind on a counter below 300 sets it TO 300 before
// the +5/frame climb begins.] As a fraction of the 2000-unit counter (g652).
//
// The note above BOX_WIND_FRAMES has recorded this snap since the constant was
// derived — 5.66 s is (2000-300)/300, not 2000/300 — but the ENGINE never
// implemented it, winding linearly from wherever the box sat. The two differ
// only at the bottom, which is exactly where it decides a night: with the box
// at zero the Puppet rolls every second (g494/g495), and the engine spent
// ~0.85 s climbing to a level the game reaches on the first wind frame.
export const BOX_SNAP = 300 / 2000;
export const PUPPET_AI = 15;
// [SOURCED: g494-497, g623, g774.] Three successful one-second rolls free
// him from CAM 11. Later route hops use the same one-second roll, camera light
// writes B=10 outside CAM 11, and marker 122 gets a 1-in-10 roll each second
// before marker 123 starts the shared 40-frame attack (g574/g587-588).
export const PUPPET_ESCAPE_STAGES = 3;
export const PUPPET_CAMERA_PIN_FRAMES = 10;
export const PUPPET_OFFICE_ROLL = 10;
// Once he is off CAM 11 he walks a real route like everyone else
// [SOURCED: g404-411]. CAM 11 -> 10 -> 07, then his own `decide path` value
// picks a side: 1 sends him 03 -> 01, 2 sends him 04 -> 02. Both arrive at
// marker 122. Five hops use the one-second roll in g496; g623 then controls
// the separate 122 -> 123 edge.
export const PUPPET_ROUTE = {
  left:  [10, 7, 3, 1, 'office'],
  right: [10, 7, 4, 2, 'office'],
};

// Animation lengths [SOURCED: decompiled Android build 296 animation bank —
// mmonitorUp 11fr@speed90, mmonitorDown 11fr@speed50, mmaskOn 9fr@speed75,
// mmaskOff 11fr@speed75; duration = frames*100/(speed*60fps). The flips are
// asymmetric: lowering the monitor is ~1.8x slower than raising it.]
export const MONITOR_ANIM_UP = 12;    // 0.204s
export const MONITOR_ANIM_DOWN = 22;  // 0.367s
export const MASK_ANIM_ON = 12;       // 0.200s
export const MASK_ANIM_OFF = 15;      // 0.244s

// --- Cameras ---------------------------------------------------------------
export const CAMS = {
  1:  { name: 'Party Room 1' },
  2:  { name: 'Party Room 2' },
  3:  { name: 'Party Room 3' },
  4:  { name: 'Party Room 4' },
  5:  { name: 'Left Air Vent' },
  6:  { name: 'Right Air Vent' },
  7:  { name: 'Main Hall' },
  8:  { name: 'Parts/Service' },
  9:  { name: 'Show Stage' },
  10: { name: 'Game Area' },
  11: { name: 'Prize Corner' },
  12: { name: "Kid's Cove" },
};

export const TARGET_CAMS = [10, 4, 7];
export const BOX_CAM = 11;
// [SOURCED: g2-4, g486-487.] Before the first raise the hidden `your view`
// marker is parked on CAM 09 in story nights and CAM 10 in Custom Night. A
// completed raise restores `last viewed`; with none yet, nights 1-6 open
// CAM 09 and night 7 opens CAM 07.
export const parkedCamera = night => night === 7 ? 10 : 9;
export const initialCamera = night => night === 7 ? 7 : 9;

// Map button geometry, normalised 0..1 inside the map panel.
// Traced from a screenshot of the real FNaF 2 map, so the thumb path between
// 11 / 10 / 4 / 7 matches the game. CAM 05 and CAM 06 flank the office: they are
// the air-vent cameras, where a vent animatronic is visible on approach before
// it reaches the blind spot. Read off a low-resolution image by eye, so
// treat it as close-but-not-exact: Settings -> Calibrate layout lets you drag
// anything that looks off and save it straight back into this file.
// Aspect ratio of the source map image the coordinates below were traced from.
// The map box is sized to this so the traced proportions survive.
export const MAP_AR = 268 / 199;

export const DEFAULT_MAP = {
  1:  { x: 0.030, y: 0.485, w: 0.160, h: 0.145 },
  2:  { x: 0.385, y: 0.555, w: 0.160, h: 0.145 },
  3:  { x: 0.030, y: 0.310, w: 0.160, h: 0.145 },
  4:  { x: 0.385, y: 0.355, w: 0.160, h: 0.145 },
  5:  { x: 0.100, y: 0.845, w: 0.160, h: 0.145 },
  6:  { x: 0.340, y: 0.845, w: 0.160, h: 0.145 },
  7:  { x: 0.385, y: 0.165, w: 0.160, h: 0.145 },
  8:  { x: 0.030, y: 0.140, w: 0.160, h: 0.145 },
  9:  { x: 0.775, y: 0.060, w: 0.160, h: 0.145 },
  10: { x: 0.680, y: 0.420, w: 0.160, h: 0.145 },
  11: { x: 0.820, y: 0.285, w: 0.160, h: 0.145 },
  12: { x: 0.795, y: 0.585, w: 0.160, h: 0.145 },
};



// Every control the player actually touches, so thumb positions can be matched
// to the real game. `space` is the box the fractions are relative to: the whole
// stage, or the camera feed panel.
export const DEFAULT_WIDGETS = {
  camlight: { space: 'stage', x: 0.112, y: 0.200, w: 0.252, h: 0.425 },
  light:    { space: 'stage', x: 0.378, y: 0.285, w: 0.235, h: 0.359 },
  mask:     { space: 'stage', x: 0.051, y: 0.934, w: 0.399, h: 0.065 },
  monitor:  { space: 'stage', x: 0.525, y: 0.932, w: 0.400, h: 0.068 },
  ventL:    { space: 'stage', x: 0.013, y: 0.524, w: 0.044, h: 0.093 },
  ventR:    { space: 'stage', x: 0.946, y: 0.544, w: 0.042, h: 0.093 },
  wind:     { space: 'feed',  x: 0.402, y: 0.704, w: 0.311, h: 0.157 },
};



// --- Animatronic routes ----------------------------------------------------
// [SOURCED: decompiled Android build 296 Office-frame events, RE-DERIVED
// 2026-08-20 from the post-XOR true-name dump (movement groups 374-435,
// 389-418; per-hop conditions in the regenerated route-graph export).
// Internal camera ids equal the display CAM labels 1:1 — anchored by five
// independent identities (Withereds start CAM 08 Parts/Service, Toys CAM 09
// Show Stage, Mangle CAM 12 Kid's Cove, BB CAM 10 Game Area, Puppet CAM 11
// Prize Corner) and by every vent assignment matching the known game (TB/WC/
// Mangle right vent via CAM 06, TC/WB/BB left vent via CAM 05). The previous
// fitted bijection (8<->9 etc.) was an artifact of the scrambled names.]
//
// 'blindA'/'blindB' are the off-camera transit rooms `hall stage 1`/`hall
// stage 2` (markers 120/121): no camera shows them, so no flash can reach a
// unit standing there. `choke` is the index in `path` of the room the
// Minus 7 flash loop holds them in ({4,7,10} is a cut set: every route
// crosses it within two hops, so the 4-7-10 cover re-derives from the
// corrected graph).
//
// Sourced gate semantics (post-XOR names):
//   entryGate 'camsUp'  — the final hop (`in office`, marker 122) fires only
//                          while the monitor is UP (`viewing` > 0),
//   entryGate 'camsDown' — Toy Bonnie inverts it: his vent hop needs the
//                          monitor DOWN plus the `right light` state,
//   entryGate null       — Toy Chica's final hop carries no monitor condition,
//   lightStallAt [...]   — indices whose outgoing hop requires the office
//                          hall-light latch (`viewing hall light`) to be zero.
//                          The latch clears on the global one-second tick, not
//                          when the player releases the light. Withered Chica
//                          and Toy Bonnie have no such gated edge.
//   mutex true           — shares the `office occupied` one-attacker lock on
//                          the final hop (W. Freddy, W. Bonnie, W. Chica,
//                          Toy Freddy).
//   repelIdx             — path index a marker-122 repel lands on (endpoint
//                          resolution groups 538-555 / Toy Chica's mask
//                          leave). Sourced: WB CAM 07, WC CAM 04, TB CAM 03,
//                          TC CAM 07. 0 where the dump names no destination.
// The W. Bonnie / W. Chica final hops also require the `in danger`
// attacker-engaged latch to be clear. The Puppet roams on mobile
// (rare-event tier) and Paper Pals has its own single office hop; neither is
// in this table.
export const STALLED = [
  { id: 'withfreddy', name: 'Withered Freddy', short: 'WF',  path: [8, 7, 3, 'blindB', 'office'],   choke: 1, entryGate: 'camsUp',   openingRule: 'streak', lightStallAt: [2, 3], mutex: true,  repelIdx: 0 },
  { id: 'withbonnie', name: 'Withered Bonnie', short: 'WB',  path: [8, 7, 'blindA', 1, 5, 'ventL'], choke: 1, entryGate: 'camsUp',   openingRule: 'streak', lightStallAt: [1, 2], mutex: true,  repelIdx: 1 },
  { id: 'withchica',  name: 'Withered Chica',  short: 'WC',  path: [8, 4, 2, 6, 'ventR'],           choke: 1, entryGate: 'camsUp',   openingRule: 'streak', lightStallAt: [],     mutex: true,  repelIdx: 1 },
  { id: 'toyfreddy',  name: 'Toy Freddy',      short: 'TF',  path: [9, 10, 'blindA', 'blindB', 'office'], choke: 1, entryGate: 'camsUp', openingRule: 'streak', lightStallAt: [1, 2], mutex: true, repelIdx: 0 },
  { id: 'toybonnie',  name: 'Toy Bonnie',      short: 'TB',  path: [9, 3, 4, 2, 6, 'ventR'],        choke: 2, entryGate: 'camsDown', openingRule: 'mask',   lightStallAt: [],     mutex: false, repelIdx: 1 },
  { id: 'toychica',   name: 'Toy Chica',       short: 'TC',  path: [9, 7, 'blindA', 1, 5, 'ventL'], choke: 1, entryGate: null,       openingRule: 'mask',   lightStallAt: [1, 2], mutex: false, repelIdx: 1 },
  { id: 'mangle',     name: 'The Mangle',      short: 'MG',  path: [12, 11, 10, 7, 'blindA', 2, 6, 'ventR'], choke: 2, entryGate: 'camsUp', openingRule: 'raise', lightStallAt: [3, 4], mutex: false, repelIdx: 0 },
];
// The blind transit rooms break the old "nobody passes through an unflashed
// room" property: several routes now contain a stretch no camera can touch.
// Mangle additionally transits CAM 11 (Prize Corner), where the flash stun is
// source-excluded (group 456, `viewing <> 11`); her pin room is CAM 10.

export const WITHEREDS = new Set(['withchica', 'withbonnie', 'withfreddy']);
export const TOYS = new Set(['toyfreddy', 'toybonnie', 'toychica']);
// [SOURCED: g263] `last viewed` samples the live `viewing` counter on the
// runtime's 200 ms timer. A camera touch followed by monitor-down before this
// tick is the Android double-camera-glitch arming window.
export const LAST_VIEW_SAMPLE_FRAMES = s(0.2);
// [SOURCED: Android decompile, post-XOR names — Office groups 344-348 & 357.]
// The look-hold: while the selected-camera marker (`your view`) overlaps the
// character, their pending movement roll (A=1) cannot resolve to A=2. It
// applies to the three Withereds (344-348) and, monitor-up only, to Mangle
// (357); Mangle's monitor-down resolution is instead blocked by the office
// hall light (358, `viewing hall light` = 0 required). Toys have no look
// gate at all — their resolutions are ordered by Show Stage co-occupancy
// (350-356: Bonnie leaves before Chica before Freddy). The Withered groups
// carry NO monitor condition, and lowering the monitor zeroes `viewing`
// without moving the marker (group 262), so the Withered hold persists
// monitor-down on the last-selected camera ("parking").
// (The pre-XOR audit had this set exactly inverted: Toys instead of
// Withereds. See docs/android/ANDROID-CAMERA-STALL.md.)
export const SELECTED_CAMERA_GATED = new Set(['withfreddy', 'withbonnie', 'withchica', 'mangle']);

// --- The routine the trainer teaches ---------------------------------------
// Offsets in seconds from the cycle anchor (:X2 / :X7).
export const CYCLE_SCRIPT = [
  { id: 'monitor-down', at: 0.00, label: 'Cams down',       action: 'monitor', want: 'down' },
  { id: 'mask-on',      at: 0.20, label: 'Mask on',         action: 'mask',    want: 'on'   },
  { id: 'mask-off',     at: 0.35, label: 'Mask off',        action: 'mask',    want: 'off'  },
  { id: 'flash-hall',   at: 0.42, label: 'Flash hall',      action: 'light',   want: 'tap'  },
  { id: 'monitor-up',   at: 0.60, label: 'Cams up',         action: 'monitor', want: 'up'   },
  { id: 'cam-10',       at: 0.80, label: 'CAM 10 + light',  action: 'camflash', cam: 10     },
  { id: 'cam-4',        at: 1.00, label: 'CAM 04 + light',  action: 'camflash', cam: 4      },
  { id: 'cam-7',        at: 1.20, label: 'CAM 07 + light',  action: 'camflash', cam: 7      },
  { id: 'cam-11',       at: 1.40, label: 'CAM 11',          action: 'cam',     cam: 11      },
  { id: 'wind',         at: 1.50, label: 'Hold WIND',       action: 'wind',    want: 'on', hold: 3.5 },
];

export const TOL_GOOD = 0.15;  // seconds
export const TOL_OK   = 0.35;

// How far each step of the cycle can be moved on its own, in seconds, as a
// magnitude either side of its scheduled time.
//
// [CALIBRATED 2026-08-23 — `node tools/cyclesearch.mjs --steps`: each step was
// shifted alone, with the rest of the pass played perfectly, until one of 200
// seeds died. WIND's early edge hit the sweep's 0.75 s cap without a death, so
// that entry is a lower bound.]
//
// They are lopsided, and two of them are cliffs rather than slopes. On Android
// every office light is gated on `mask = 0` (g75/g84), so a mask still on when
// the hall flash is due swallows the flash and Foxy is never reset. Only about
// three frames separate the two steps, which is the whole reason `mask-off`
// cannot be late and `flash-hall` cannot be early. Both search winners in
// plan 04 widened exactly that gap.
//
// A window is what the game tolerates on ONE input while everything else is
// perfect. Real play is wrong on every step at once, so grading takes a
// fraction of it rather than the edge.
export const STEP_WINDOWS = {
  'monitor-down': { early: 0.450, late: 0.300 },
  'mask-on':      { early: 0.300, late: 0.200 },
  'mask-off':     { early: 0.450, late: 0.050 },
  'flash-hall':   { early: 0.050, late: 0.267 },
  'monitor-up':   { early: 0.150, late: 0.117 },
  'cam-10':       { early: 0.117, late: 0.150 },
  'cam-4':        { early: 0.150, late: 0.150 },
  'cam-7':        { early: 0.150, late: 0.133 },
  'cam-11':       { early: 0.133, late: 0.517 },
  'wind':         { early: 0.750, late: 0.467 },
};

// GOOD takes half a step's window, OK four fifths. Both are judgement calls,
// and both can only tighten a lesson's own tolerance, never loosen it: a drill
// may be more forgiving than the routine, but it must never call an input safe
// when the model says it ends the night.
export const TOL_GOOD_FRAC = 0.5;
export const TOL_OK_FRAC   = 0.8;

// Steps carry their window on the step itself rather than being looked up by
// id, because a window belongs to a *geometry*, not to a name: Phase A reuses
// `flash-hall` with no mask before it, so the cliff that caps it here does not
// exist there. A step with no window is graded on the lesson's tolerance.
for (const st of CYCLE_SCRIPT) {
  if (STEP_WINDOWS[st.id]) st.win = STEP_WINDOWS[st.id];
}

export function stepTol(step, tolGood = TOL_GOOD, tolOk = TOL_OK) {
  const w = step?.win;
  if (!w) return { goodEarly: tolGood, goodLate: tolGood, okEarly: tolOk, okLate: tolOk };
  return {
    goodEarly: Math.min(tolGood, w.early * TOL_GOOD_FRAC),
    goodLate:  Math.min(tolGood, w.late  * TOL_GOOD_FRAC),
    okEarly:   Math.min(tolOk,   w.early * TOL_OK_FRAC),
    okLate:    Math.min(tolOk,   w.late  * TOL_OK_FRAC),
  };
}
