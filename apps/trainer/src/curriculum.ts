import * as C from '@sixam/source/fnaf2';

// A ladder of lessons. Each one adds exactly one new thing, hides every control
// it doesn't need, and will not let you move on until the motion is reliable.
//
// Deliberately NOT slowed down: the whole skill is absolute timing, so running
// at 0.8x would teach the wrong intervals. Difficulty is reduced by removing
// controls and threats instead, never by distorting the clock.

/**
 * One step of a lesson's pattern, `at` seconds after its anchor.
 */
export type Step = {id: string, at: number, label: string, action: string, want?: string, cam?: number, hold?: number, win?: {early: number, late: number}};
const S = (id: string, at: number, label: string, action: string, extra: Partial<Step> = {}): Step => ({ id, at, label, action, ...extra });

// the three-camera sweep, offset from wherever it starts
const sweep = (t0) => [
  S('cam-10', t0 + 0.00, 'CAM 10, then LIGHT', 'camflash', { cam: 10 }),
  S('cam-4', t0 + 0.20, 'CAM 04, then LIGHT', 'camflash', { cam: 4 }),
  S('cam-7', t0 + 0.40, 'CAM 07, then LIGHT', 'camflash', { cam: 7 }),
];

// The Minus 7 pass this trainer teaches, in seconds from the :X2 / :X7 anchor.
//
// Until 2026-09-30 the trainer taught Source's CYCLE_SCRIPT, whose mask-off
// came 9 frames after mask-on and whose hall flash 4 frames after that. Since
// 3d5c5f7 (2026-09-27) the Sim answers the mask only at rest and every other
// control only once the mask is fully off, so a player who hit both on time
// had both refused, the mask stayed on, and the rest of the pass was refused
// behind it (the same gap broke the Minus 7 policy baseline:
// docs/evidence/policy-baseline-mask-animation-20260927.json, MODEL_ONLY).
//
// So each gap the Sim gates on an animation is that animation's SOURCED length
// plus two frames (33 ms), the least margin test-seam-slack.ts lets a device
// plan clear a floor by: a cue on the floor itself is refused one frame early.
// The ungated gaps keep CYCLE_SCRIPT's spacing. apps/trainer/test/
// lessons.test.ts plays every lesson through the Sim and fails on a refusal.
//
// CYCLE_SCRIPT's per-step windows (C.STEP_WINDOWS) were measured on the old
// geometry, so no step here carries one: how late each step can be before the
// night is lost is UNKNOWN for this timing, and grading uses the lesson's own
// tolerance.
const frames = n => n / C.FPS;
const SLACK = 2;
const MASK_ON = 0.20;
const MASK_OFF = MASK_ON + frames(C.MASK_ANIM_ON + SLACK);   // the mask is fully on
const HALL = MASK_OFF + frames(C.MASK_ANIM_OFF + SLACK);     // the mask is fully off
const RAISE = HALL + frames(11);                              // CYCLE_SCRIPT's 0.18 s
const SWEEP = RAISE + frames(C.MONITOR_ANIM_UP + SLACK);     // the monitor is fully up
const HOME = SWEEP + 0.60;                                    // three cameras, 0.2 s apart
const WIND = HOME + 0.10;
const ms3 = x => Math.round(x * 1000) / 1000;

const F = (...args: Parameters<typeof S>) => Object.freeze(S(...args));
export const MINUS7_CYCLE = Object.freeze([
  F('monitor-down', 0, 'Cams down', 'monitor', { want: 'down' }),
  F('mask-on', ms3(MASK_ON), 'Mask on', 'mask', { want: 'on' }),
  F('mask-off', ms3(MASK_OFF), 'Mask off', 'mask', { want: 'off' }),
  F('flash-hall', ms3(HALL), 'Flash hall', 'light', { want: 'tap' }),
  F('monitor-up', ms3(RAISE), 'Cams up', 'monitor', { want: 'up' }),
  F('cam-10', ms3(SWEEP), 'CAM 10 + light', 'camflash', { cam: 10 }),
  F('cam-4', ms3(SWEEP + 0.2), 'CAM 04 + light', 'camflash', { cam: 4 }),
  F('cam-7', ms3(SWEEP + 0.4), 'CAM 07 + light', 'camflash', { cam: 7 }),
  F('cam-11', ms3(HOME), 'CAM 11', 'cam', { cam: 11 }),
  F('wind', ms3(WIND), 'Hold WIND', 'wind', { want: 'on', hold: ms3(5 - WIND) }),
]);

// Early lessons are graded loosely: you are learning where the buttons are,
// not shaving milliseconds. The last lessons use firmer tolerances.
const EASY = { tolGood: 0.30, tolOk: 0.55 };
const FIRM = { tolGood: 0.22, tolOk: 0.45 };

// Phase A is a different cycle, not the main one. The cams are DOWN across
// every 5s interval, which defers Balloon Boy's last move (g417 latches the
// passed roll until a raise completes) so he arrives when you are ready for
// him. It also means Golden Freddy never gets a roll, so there is no mask
// flick here.
const PHASE_A_SCRIPT = [
  S('monitor-down', 0.00, 'Cams down', 'monitor', { want: 'down' }),
  S('flash-hall', 0.15, 'Flash the hall', 'light'),
  S('monitor-up', 0.40, 'Cams up', 'monitor', { want: 'up' }),
  S('cam-10', 0.60, 'CAM 10, then LIGHT', 'camflash', { cam: 10 }),
  S('cam-4', 0.80, 'CAM 04, then LIGHT', 'camflash', { cam: 4 }),
  S('cam-7', 1.00, 'CAM 07, then LIGHT', 'camflash', { cam: 7 }),
  S('cam-11', 1.20, 'CAM 11', 'cam', { cam: 11 }),
  S('wind', 1.30, 'Hold WIND', 'wind', { hold: 1.2 }),
  S('drop-for-bb', 2.60, 'Cams DOWN for BB', 'monitor', { want: 'down' }),
  S('back-up', 3.30, 'Cams back up', 'monitor', { want: 'up' }),
];

// Long enough that a drill never ends by reaching 6 AM.
export const LESSON_FRAMES = C.NIGHT_FRAMES * 10;

const INERT = {
  bbEnabled: false, foxyEnabled: false, gfEnabled: false, boxEnabled: false,
  stalledEnabled: false, powerEnabled: false, lethal: false,
};

export const LESSONS = [
  {
    id: 'beat',
    when: 'Every :X2 and :X7 — the two seconds where the timer turns green.',
    title: 'The beat',
    goal: 'Tap LIGHT on every :X2 and :X7.',
    teach: 'Everything hangs off two moments in each 5 seconds: the times ending in 2 and in 7. ' +
           'The timer turns green on them. Nothing else is on screen yet — just find the pulse.',
    controls: ['light'],
    script: [S('beat', 0, 'Tap LIGHT', 'light')],
    sim: { ...INERT },
    tol: EASY, target: 8,
  },
  {
    id: 'sweep',
    when: 'Start the sweep on every :X2 and :X7, and get all three done inside about a second.',
    title: 'The sweep',
    goal: 'CAM 10, CAM 04, CAM 07 — each followed by LIGHT.',
    teach: 'This is the heart of the strategy and the motion that has to become automatic. ' +
           'A flash freezes everyone in that room for 6.66 seconds. Watch the three STUN bars refill. ' +
           'The cameras stay up for this lesson, so the light you are using here is the CAMERA light ' +
           '— a different button, in a different place, from the office flashlight.',
    controls: ['camlight', 'cams'],
    script: sweep(0),
    sim: { ...INERT, stalledEnabled: true },
    start: { monitor: 'up', cam: 10 },
    tol: EASY, target: 8,
  },
  {
    id: 'wind',
    when: 'Sweep on :X2 / :X7, then hold WIND until the next one — about 4 seconds.',
    title: 'Sweep, then wind',
    goal: 'Sweep the three cameras, then go to CAM 11 and hold WIND.',
    teach: 'After every sweep you go home to CAM 11 and wind the box until the next anchor. ' +
           'WIND is a HELD input, not a tap: the purple bar on the lane is how long your finger stays ' +
           'down. A tap scores nothing and the box drains — the box is one of the three things that ' +
           'kill you. Hold your finger down as you move from the CAM 11 button to WIND, too; that drag ' +
           'is the habit that stops you fat-fingering CAM 12 at 4 AM.',
    controls: ['camlight', 'cams', 'wind'],
    script: [...sweep(0), S('cam-11', 0.60, 'CAM 11', 'cam', { cam: 11 }),
             S('wind', 0.70, 'Hold WIND', 'wind', { hold: 4.0 })],
    sim: { ...INERT, stalledEnabled: true, boxEnabled: true },
    start: { monitor: 'up', cam: 10 },
    tol: EASY, target: 8,
  },
  {
    id: 'office',
    when: 'Start on :X2 / :X7. You have until the sweep would be due.',
    title: 'Down and back',
    goal: 'Cams down, mask flick, flash the hall, cams up.',
    teach: 'The other half of the cycle, and the OTHER light — the office flashlight. Golden Freddy ' +
           'gets a coin flip every 5 seconds while your cams are up, so the mask flick is not optional, ' +
           'and it must come BEFORE the flash: flashing the hall with him in the office kills you. ' +
           'The flash then resets Foxy. The mask answers only when it has stopped moving: take it off ' +
           'once it is fully on, and flash once it is fully off. A touch while it moves is refused.',
    controls: ['light', 'mask', 'monitor'],
    script: MINUS7_CYCLE.slice(0, 5),
    facts: ['mask-gate'],
    sim: { ...INERT, foxyEnabled: true, gfEnabled: true },
    start: { monitor: 'up' },
    tol: EASY, target: 8,
  },
  {
    id: 'cycle',
    when: 'The whole thing repeats on :X2 and :X7 — one pass every 5 seconds.',
    title: 'The whole cycle',
    goal: 'Both halves together, every 5 seconds.',
    teach: 'Now assemble it: down, mask, flash, up, sweep, home, wind. Ten inputs in under two seconds, ' +
           'then about three seconds of winding to breathe. Nothing here can kill you yet.',
    controls: ['light', 'camlight', 'mask', 'monitor', 'cams', 'wind'],
    script: MINUS7_CYCLE,
    sim: { bbEnabled: false, lethal: false },
    start: { monitor: 'up', cam: 11 },
    tol: FIRM, target: 10,
  },
  {
    id: 'survive',
    when: 'Same 5-second cycle, on :X2 and :X7.',
    title: 'The cycle, for real',
    goal: 'Same cycle — but now Foxy, Golden Freddy and the box can end it.',
    teach: 'Identical inputs, real consequences. If the STUN bars lapse the animatronics walk. ' +
           'If Foxy’s D climbs past 3 at a 5-second check he locks on. Still no Balloon Boy.',
    controls: ['light', 'camlight', 'mask', 'monitor', 'cams', 'wind'],
    script: MINUS7_CYCLE,
    sim: { bbEnabled: false },
    start: { monitor: 'up', cam: 11 },
    tol: FIRM, target: 12,
  },
  {
    id: 'phaseA',
    when: 'Cycle on :X2 / :X7, then cams down by :X4 / :X9 and back up after :X5 / :X0.',
    title: 'Hearing Balloon Boy',
    goal: 'On his third laugh, get the cams DOWN across every 5-second interval.',
    teach: 'BB is silent on his first move and calls out on the next three. The third call — with a vent ' +
           'bang — means he is in the vent camera, one move from your vent. That last move is the only ' +
           'one that needs your cams UP, so you drop them before every 5-second interval and raise them ' +
           'after. Careful: that defers the move, it does not cancel it. He banks the roll and takes it ' +
           'the moment your next raise finishes — the point is that you choose when, and you are ready. ' +
           'Note there is no mask flick in this cycle: with the cams down across every interval, Golden ' +
           'Freddy never gets a roll. You also get much less winding time, which is the real cost.',
    controls: ['light', 'camlight', 'mask', 'monitor', 'cams', 'wind'],
    script: PHASE_A_SCRIPT,
    sim: { lethal: false },
    drill: 'phaseA',
    start: { monitor: 'up', cam: 11 },
    tol: FIRM, target: 6,
  },
  {
    id: 'phaseB',
    when: 'React to his leaving bang — there is no clock to follow, only your hands.',
    title: 'The duel',
    goal: 'Un-mask, cams up, CAM 10, CAM 04 — as one motion, under 0.7s.',
    teach: 'His fourth laugh puts him in the opening. Flash all three cams, drop, mask up, and wait. ' +
           'When you hear him leave you have about seven tenths of a second before the stun lapses, by ' +
           'the strategy guide\'s count; this project has not measured it. ' +
           'Leave the monitor parked on CAM 07 with the light held and you get that third flash free.',
    controls: ['light', 'camlight', 'mask', 'monitor', 'cams', 'wind'],
    script: null,           // measured by the duel timer, not the cycle coach
    sim: { lethal: false },
    drill: 'phaseB',
    start: { monitor: 'up', cam: 11 },
    target: 6,
    duelTarget: 0.7,
  },
  {
    id: 'night',
    when: ':X2 and :X7, four hundred and twenty seconds.',
    title: 'Full night',
    goal: 'Seven minutes. Real RNG, real deaths.',
    teach: 'Everything you have drilled, for 420 seconds. The report afterwards shows exactly which ' +
           'camera lapsed and when.',
    controls: ['light', 'camlight', 'mask', 'monitor', 'cams', 'wind', 'vents'],
    script: MINUS7_CYCLE,
    facts: ['minus7-1020'],
    sim: {},
    start: { monitor: 'up', cam: 11 },
    target: 1,
    fullNight: true,
  },
  {
    id: 'worst',
    when: ':X2 and :X7, and he will never be kind.',
    title: 'Worst luck',
    goal: 'Every roll pinned to the worst case.',
    teach: 'BB moves every time and never leaves early. The strategy\'s claim is that no roll makes ' +
           'Minus 7 unwinnable; a clear here is one night in the model, not a proof of that.',
    controls: ['light', 'camlight', 'mask', 'monitor', 'cams', 'wind', 'vents'],
    script: MINUS7_CYCLE,
    facts: ['minus7-1020'],
    sim: { worst: true },
    start: { monitor: 'up', cam: 11 },
    target: 1,
    fullNight: true,
  },
];

export const byId = (id) => LESSONS.find(l => l.id === id);

/**
 * The Sim a lesson starts on: its options, and its opening state. The app and
 * the lesson tests both start lessons here.
 * @param options extra Sim options
 */
export function lessonSim(lesson: typeof LESSONS[number], options: any = {}) {
  const sim = new C.Sim({ android: true, record: true, ...lesson.sim,
    ...(lesson.fullNight ? {} : { durationFrames: LESSON_FRAMES }), ...options });
  if (lesson.start) {
    Object.assign(sim, lesson.start);
    // Lesson fixtures predate the sourced viewing/marker split. Their one
    // `cam` value describes a normal, synchronized cameras-up state.
    if (lesson.start.cam && lesson.start.monitor === 'up') {
      sim.viewing = sim.lastViewed = lesson.start.cam;
      sim.hasViewedCamera = true;
    }
  }
  return sim;
}

const KEY = 'm7.progress';

export function loadProgress() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
export function markPassed(id, bestCombo) {
  const p = loadProgress();
  p[id] = { passed: true, best: Math.max(bestCombo || 0, p[id]?.best || 0) };
  saveProgress(p);
  return p;
}

// Best combo counts even on a run you did not pass -- progress you can see is
// the point of a drill.
export function recordCombo(id, combo) {
  if (!combo) return;
  const p = loadProgress();
  const cur = p[id] || { passed: false, best: 0 };
  if (combo > (cur.best || 0)) { cur.best = combo; p[id] = cur; saveProgress(p); }
}
// A lesson opens once the one before it is done. Nothing is locked forever:
// the menu still lets you jump ahead if you want to.
export function unlockedIndex(p = loadProgress()) {
  let i = 0;
  while (i < LESSONS.length - 1 && p[LESSONS[i].id]?.passed) i++;
  return i;
}
