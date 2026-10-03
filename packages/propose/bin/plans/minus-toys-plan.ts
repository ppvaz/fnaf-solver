// Emit and replay the measured-device port of the Minus Toys schedule.
// The modern bundle compiler turns these semantic rows into the device artifact
// consumed by the local executor; the deprecated legacy lane is historical only.
//
// The schedule is no longer two hand-typed arrays: `build(knobs)` derives the
// opening + steady loop from named knobs (KNOBS0 = the shipped values). This is
// so the loop can be *searched* rather than tuned by hand -- the first device
// run (n2-minustoys-0117, 2026-08-28) died to a BB walk-in the deterministic
// gate could not see, and the published strategy's own margin is only ~0.66 s
// per cycle (docs/strategy/MINUS-3-STRATEGY.md sec.3). `minus-toys-margin.mjs`
// maps where the slack is; a jitter/clock-error search sits on `schedule({shift})`.
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Observer } from '@sixam/play/sim';
import { CONTROL_VOCABULARY as V, MODEL_CONTEXT_LIGHT } from '@sixam/source';
import { VentThreatReactive, guardIntents, GUARD_FRAMES } from '@sixam/propose/fnaf2';
import { Rng } from '@sixam/source/fnaf2';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor } from '@sixam/propose/seeds';
import { DOUBLE_GLITCH_CAMERA_PAIRS, cameraPairHeader } from '../../../play/bin/probe/arm-verification.ts';

// Every tunable number in the schedule. build(KNOBS0) reproduces the shipped
// opening/loop byte-for-byte (asserted below). Each knob names one decision the
// published routine makes; a search perturbs a subset.
export const KNOBS0 = {
  // --- opening: arm the CAM 11-viewing / CAM 09-marker split before 0:05 ---
  openArm: true,           // false skips the CAM 09 tap -> the no-split control schedule
  openViewMs: 0,           // tap monitor: establish `viewing`
  openLastViewedMs: 300,   // tap CAM 11: it becomes g263's sampled `last viewed`
  openArmMs: 833,          // tap CAM 09: g40 writes `viewing` + the marker atomically
  armingGapMs: 50,         // CAM 09 tap -> monitor-down gap. Must stay inside g263's 200 ms
                           //   stale-sample window; 17 ms of it is released after the 33 ms contact.
                           //   The device run showed this collapse to 0 (drag, not two taps).
  openRaiseGapMs: 733,     // monitor-down -> monitor-up (the split is armed on this raise)
  openStunLeadMs: 300,     // first safe camera-feed flash after the split raise
  openStunHoldMs: 100,     // one Fusion poll window; contact taps remain 33 ms
  openWindLeadMs: 467,     // monitor-up -> opening wind start. 434 was EXACTLY the
                           //   compiler's raise-readiness floor, so the opening wind cleared
                           //   it by 0 ms; +33 is two engine frames of room.
  openWindMs: 1750,        // opening wind hold (shortened live by the epoch slip, up to its full length)
  openCamdropLeadMs: 200,  // opening camdrop: light-only lead before the monitor tap
  openMaskLeadMs: 182,     // opening camdrop end -> mask on. The mask button is absent through
                           //   322 ms after monitor-down and only fully visible at ~382.5 ms
                           //   (native frame trace); 300 put the press at exactly the +400 ms
                           //   floor, clearing it by 0 ms.

  // --- steady loop ---
  loopPeriodMs: 10000,     // 10 s cycle = 2x the 5 s GF interval. 5000 builds the faithful
                           //   per-interval routine (MINUS-3-STRATEGY sec.3) -- structurally it
                           //   cannot deliver a 5-tick mask window, see build() and cyclelengthsearch.
  maskOffMs: 9200,         // mask toggles OFF (~:X9), the cams-up / wind phase begins
  maskOnMs: 4449,          // mask toggles ON (~:X4). Used in the opening, and +loopPeriodMs in
                           //   the loop. 4400 put the loop press at exactly the +400 ms
                           //   monitor-down floor; see openMaskLeadMs.
  hallOffsetMs: 9500,      // Foxy-reset hall pulse offset
  hallMs: 33,              // hall contact. NOT raised on 2026-09-12, deliberately, after
                           //   it was proposed alongside camdropMonitorMs. Pedro retracted
                           //   the pan constraint that used to forbid lengthening, so the
                           //   knob is open -- but the model refuses it and the device
                           //   evidence does not ask for it:
                           //     night 1 worst: 33/50/67 clean, 100 and 133 -> 0/3000
                           //     night 2 worst: 33..133 clean, 200 -> 0/100
                           //   Two nights, two different ceilings, neither where a night-5
                           //   sweep would have looked. And unlike camdropMonitorMs, no
                           //   hall tap has been PROVEN lost: the four that sat on capture
                           //   stalls in contact200a were ungradable by strokes, not
                           //   graded as missing. Raising it would trade a measured risk
                           //   for an unmeasured one. It needs a hall-side reader first.
  loopContactMs: 200,      // steady-loop tap length for the parity toggles, separate
                           //   MASK SAFETY, checked in the dump 2026-09-12 after a peer
                           //   session warned that only the MONITOR flip had been shown
                           //   one-shot: both mask transitions are state-guarded too, so a
                           //   200 ms hold cannot double-toggle and does not shorten the
                           //   mask window.
                           //     g270  Multiple Touch on `red button` AND mask == 0
                           //             -> mask = 1   (start the ON animation)
                           //     g615  MouseOnObject(`drop button`)   AND mask == 2
                           //             -> drop everything = 1
                           //     g274  mask == 2 AND drop everything == 1
                           //             -> mask = 3   (start the OFF animation)
                           //   g274 is the ONLY path to mask = 3, so there is no side door,
                           //   and each touch condition is gated on the state its own
                           //   transition leaves, so it is false on the next frame. g9
                           //   confirms MASK_ANIM_ON: mmaskOn >= 12 frames -> mask = 2.
                           //   Pedro observed mask time too short to repel Mangle on
                           //   night5-final2; by this the cause is not the contact length.
                           //   RAISED 33 -> 200 on 2026-09-12. MIN_CONTACT_MS and
                           //   FUSION_POLL_MS are BOTH 33, so a 33 ms contact had zero
                           //   slack against the poll that has to see it, and the dump
                           //   says the monitor flip is level-triggered with a one-shot
                           //   latch (g257 raise / g258 re-arm / g614 lower): a contact
                           //   that fits between two event-loop ticks is invisible, and
                           //   a longer hold still flips exactly once.
                           //   On the night5-strokes3 frame trace both CORRECTED cycles
                           //   were lost 33 ms MONITOR taps inside capture stalls, not
                           //   lost mask taps -- 2 of the only 3 stall-overlapped
                           //   contacts out of ~75. Exposure per 420 s night: 33 ms ->
                           //   1.49 expected lost taps (P(zero) 22%); 100 ms -> 0.17;
                           //   200 ms -> 0. 100 would sit 3.2 ms above the longest
                           //   observed interval (96.8 ms), which is the same zero-slack
                           //   shape this session spent the day removing, so 200.
                           //   Free in the model: 33/100/200 all score 3000/3000.
                           //   (analysis: peer session fnaf2-1020-36)
                           //   from `contactMs` because the opening cannot take a
                           //   long one: its cam9/monitor pair is 50 ms apart and
                           //   would overlap. The loop's gaps are 300 ms, so this can
                           //   go to ~200. Defaulted to the qualified 33 ms: every
                           //   parity inversion the cycle gate repaired on 2026-09-09
                           //   was a 33 ms tap (~2 frames), so 200 is the experiment
                           //   worth running -- but a winner must opt in, because the
                           //   qualification artifact is bound to a policy hash and
                           //   only the operator can rebind it.
  raiseMs: 10100,          // monitor raise, just after the interval boundary
  stunRefreshMs: 10400,    // cameraFeedLight glitch-stun refresh, right after the raise
  stunRefreshHoldMs: 100,  // its hold
  windLeadMs: 10570,       // loop wind start. 10550 is raise+450 against a 434 ms floor:
                           //   16 ms of room, under the two-frame allowance.
  windMs: 3230,            // loop wind hold, shortened by the same 20 ms the start moved so the
                           //   hold still ends clear of the camdrop.
  camdropMs: 13850,        // camdrop exit (~:X4 of the next interval)
  camdropLeadMs: 150,      // loop camdrop: light-only lead before the monitor tap
  camdropMonitorMs: 200,   // camdrop: monitor contact. RAISED 33 -> 200 on 2026-09-12
                           //   for the same reason as loopContactMs: it is a MONITOR tap
                           //   at the 33 ms that equals FUSION_POLL_MS. On the
                           //   contact200a trace it was the one loop contact still at 33,
                           //   and two of attempt 2's three CORRECTED gates were exactly
                           //   this tap swallowed (toys-6@14000 and @144000 MISSING at
                           //   both ends of the clock bracket), after which the 200 ms
                           //   mask press arrived under a monitor that was still raised.
                           //   That is why attempt 1 was 0/37 and attempt 2 was 3/19 on
                           //   the identical bundle. (audit: peer session fnaf2-1020-36)
  camdropTailMs: 67,       // camdrop: light-only tail after the monitor tap

  contactMs: 33,           // tap/hall contact length. The engine ignores it; the emitted plan carries it.
  // Historical winner-field name; its device meaning is cameraFeedLight.
  preventiveVentLight: true, // regular cameraFeedLight refresh; false is an observation experiment
  reactiveBB: false,       // optional BB-only left-opening/audio reactive layer
                           //   (Mangle audio is a separate policy, not part of
                           //   this device schedule yet).

  // --- minimal Night 1 mode (`--minimal`, Night 1 ONLY) ---
  // The 10/20 loop bolted onto Night 1 is wasted motion: the monitor never has
  // to come down (the Toys are flash-pinned on the stage and every "seven" kill
  // path needs cams-up -- MINUS-3-STRATEGY.md sec.9), nothing reaches a vent,
  // Golden Freddy is AI 0. So `minimal` arms the split once, then does exactly
  // two things per 5 s cycle: re-flash CAM 09 and top the box. No mask, no hall,
  // no per-cycle camdrop re-arm. This is the "machine -> elegance" plan.
  // It is Night 1 ONLY -- Night 2 needs a mask (Mangle/BB), Nights 3-5 switch to
  // CAM 08 and need hall flashes; those shapes are not designed. The CLI refuses
  // `--minimal` for any other night.
  minimal: false,
  minArmAtMs: 115000,     // Night 1 is inert until ~1:38; do not churn early.
  minPeriodMs: 5000,       // re-flash on the game's 5 s grid, not the 10 s GF-interval cycle
  minLoopStartMs: 140000,  // first 2 AM interval: begin flash/wind work here.
  minStopAtMs: 360000,     // ~5:08 AM: no route can reach the office before 6.
  minObserveUntilMs: 420000, // stay hands-off but record through the 6 AM result.
  observeUntilMs: 420000,  // full-cadence plans: how far the executor's observation
                           //   envelope reaches. A loop shifted earlier in its cycle
                           //   (Night 7 binding i, rows -2500 ms) ends its last wind
                           //   hold past 420 s; the night still ends at 420 s.
  minFlashAtMs: 150,       // cameraFeedLight (CAM 09 feed flash) re-flash, early in each 5 s window
  minFlashHoldMs: 100,     // its hold -- >= one Fusion poll past the 33 ms contact floor
  minWindAtMs: 300,        // wind start, just after the flash
  minWindHoldMs: 4400,     // wind hold -- nearly the whole 5 s window; box stays full
  minProofCam09AtMs: 359700, // after the final wind releases: visible CAM 09 proof visit
};

/** The schedule's knobs; the reactive layer's tuning is read only where a caller sets it. */
type Knobs = typeof KNOBS0 & {
  camdropLight?: boolean,
  reactiveIntervalFrames?: number, reactiveDelayFrames?: number, reactiveDropRate?: number,
  reactiveAudioLatencyFrames?: number, reactiveAudioDropRate?: number,
  reactiveAudioFalseNegativeRate?: number, reactiveAudioFalsePositiveRate?: number,
};
/** One authored row: a contact, a hall pulse, or a camdrop's lead, monitor contact and tail. */
type PlanRow =
  | [number, 'tap' | 'hold', string, number]
  | [number, 'hall', number]
  | [number, 'camdrop', number, number, number];
/** A queued press or release, at its frame. */
type QueuedAction = [number, 'press' | 'release', string];

const clone = (k: Partial<Knobs> | null | undefined): Knobs => ({ ...KNOBS0, ...(k || {}) });

// Derive { opening, loop } from knobs. build() === the shipped schedule.
export function build(knobs?: Partial<Knobs> | null) {
  const k = clone(knobs);
  const c = k.contactMs;

  if (k.minimal) {
    // Arm-only opening: establish viewing, sample CAM 11 as last-viewed, tap
    // CAM 09 (marker), drop, raise -- the split is armed on that raise. Then
    // wind, held until the first loop cycle takes over. No camdrop, no mask.
    const arm = k.minArmAtMs;
    const open: PlanRow[] = [];
    open.push([arm + k.openViewMs, 'tap', 'monitor', c]);
    open.push([arm + k.openLastViewedMs, 'tap', 'cam11', c]);
    const drop = arm + k.openArmMs + k.armingGapMs;
    if (k.openArm) open.push([arm + k.openArmMs, 'tap', 'cam9', c]);
    open.push([drop, 'tap', 'monitor', c]);
    const raise = drop + k.openRaiseGapMs;
    open.push([raise, 'tap', 'monitor', c]);
    open.push([raise + k.openStunLeadMs, 'hold', V.cameraFeedLight, k.openStunHoldMs]);
    // Steady 5 s cycle: re-flash CAM 09, then wind. Nothing else.
    const loop: PlanRow[] = [
      [k.minFlashAtMs, 'hold', V.cameraFeedLight, k.minFlashHoldMs],
      [k.minWindAtMs, 'hold', 'wind', k.minWindHoldMs],
    ];
    // The final wind ends at 5:08.  Select CAM 09 once more and leave a 300 ms
    // visible dwell before lowering the monitor.  This is proof that the Toys
    // remain held at the terminal boundary, not another defensive cycle.
    const finish: PlanRow[] = [
      [k.minProofCam09AtMs, 'tap', 'cam9', 100],
      [k.minStopAtMs, 'tap', 'monitor', 100],
    ];
    return { opening: open, loop, finish };
  }

  const opening: PlanRow[] = [];
  opening.push([k.openViewMs, 'tap', 'monitor', c]);
  opening.push([k.openLastViewedMs, 'tap', 'cam11', c]);
  const drop = k.openArmMs + k.armingGapMs;
  if (k.openArm) opening.push([k.openArmMs, 'tap', 'cam9', c]);
  opening.push([drop, 'tap', 'monitor', c]);
  const raise = drop + k.openRaiseGapMs;
  opening.push([raise, 'tap', 'monitor', c]);
  // Once the raise restores CAM 11 as `viewing`, the parked CAM 09 marker
  // makes this the first valid Toy stun. The later camdrop remains the exit.
  opening.push([raise + k.openStunLeadMs, 'hold', V.cameraFeedLight, k.openStunHoldMs]);
  const windAt = raise + k.openWindLeadMs;
  opening.push([windAt, 'hold', 'wind', k.openWindMs]);
  const camdropAt = windAt + k.openWindMs;
  opening.push([camdropAt, 'camdrop', k.openCamdropLeadMs, k.camdropMonitorMs, k.camdropTailMs]);
  const camdropEnd = camdropAt + k.openCamdropLeadMs + k.camdropMonitorMs + k.camdropTailMs;
  opening.push([camdropEnd + k.openMaskLeadMs, 'tap', 'mask', c]);

  let loop: PlanRow[];
  if (k.loopPeriodMs === 10000) {
    loop = [
      [k.maskOffMs, 'tap', 'mask', k.loopContactMs],
      // hallMs 0 drops the post-mask flash entirely: a death-targeting knob.
      // In this model the row is inert on Nights 5 and 6 (3000 replays over 20
      // phases, identical outcomes seed for seed) because the camdrop's held
      // light already resets Foxy every cycle; the phone decides whether that
      // credit is real. Never a route setting.
      ...(k.hallMs > 0 ? [[k.hallOffsetMs, 'hall', k.hallMs] satisfies PlanRow] : []),
      [k.raiseMs, 'tap', 'monitor', k.loopContactMs],
      [k.windLeadMs, 'hold', 'wind', k.windMs],
      // camdropLight false drops the monitor WITHOUT the camera light held
      // through it: no Foxy reset at the drop, and no g778 Golden Freddy kill
      // when he was created during that cams-up (2026-09-13: two Night 6
      // deaths the second after a camdrop, after 2 AM). A search knob.
      ...(k.camdropLight === false
        ? [[k.camdropMs + k.camdropLeadMs, 'tap', 'monitor', k.camdropMonitorMs] satisfies PlanRow]
        : [[k.camdropMs, 'camdrop', k.camdropLeadMs, k.camdropMonitorMs, k.camdropTailMs] satisfies PlanRow]),
      [k.maskOnMs + k.loopPeriodMs, 'tap', 'mask', k.loopContactMs],
    ];
    // The stun refresh sits just before the wind row: by content, not by
    // index, so dropping the hall row (hallMs 0) cannot move it.
    if (k.preventiveVentLight)
      loop.splice(loop.findIndex(row => row[1] === 'hold' && row[2] === 'wind'), 0,
        [k.stunRefreshMs, 'hold', V.cameraFeedLight, k.stunRefreshHoldMs]);
  } else {
    // Faithful per-interval routine, MINUS-3-STRATEGY sec.3: enter the cameras
    // just after the interval, refresh the CAM 09 stun and wind, exit at :X4
    // holding the flashlight (which also flashes Foxy through the animation),
    // mask until the next interval. NOTE: a symmetric loop this short cannot
    // give Balloon Boy the sourced 5 consecutive mask ticks -- the published
    // routine covers that with its blackout / vent-guest branch (reactiveBB),
    // which this open-loop build does not have. Expect it to fail the gate;
    // that failure is the measurement (cf. cyclelengthsearch.mjs for Minus 7).
    const p = k.loopPeriodMs;
    const enter = Math.round(p * 0.02);              // just after the interval
    const windAt5 = enter + 300;
    const camdrop5 = Math.round(p * 0.80);           // exit near :X(0.8p)
    const camEnd5 = camdrop5 + k.camdropLeadMs + k.camdropMonitorMs + k.camdropTailMs;
    loop = [
      [enter, 'tap', 'monitor', c],
      [windAt5, 'hold', 'wind', Math.max(200, camdrop5 - windAt5 - 100)],
      [camdrop5, 'camdrop', k.camdropLeadMs, k.camdropMonitorMs, k.camdropTailMs],
      [camEnd5 + 50, 'hall', k.hallMs],
      [camEnd5 + 150, 'tap', 'mask', c],
    ];
    if (k.preventiveVentLight)
      loop.splice(1, 0, [enter + 50, 'hold', V.cameraFeedLight, k.stunRefreshHoldMs]);
  }
  return { opening, loop, finish: [] as PlanRow[] };
}

// The shipped schedule, frozen. schedule()/emitPlan() default to these; a
// non-default build is passed explicitly.
const _default = build();
export const OPENING = _default.opening;
export const LOOP = _default.loop;

// build(KNOBS0) must reproduce the schedule this file shipped with.
{
  const OPENING0 = [
    [0, 'tap', 'monitor', 33], [300, 'tap', 'cam11', 33], [833, 'tap', 'cam9', 33],
    [883, 'tap', 'monitor', 33], [1616, 'tap', 'monitor', 33],
    [1916, 'hold', V.cameraFeedLight, 100], [2083, 'hold', 'wind', 1750],
    [3833, 'camdrop', 200, 200, 67], [4482, 'tap', 'mask', 33],
  ];
  const LOOP0 = [
    [9200, 'tap', 'mask', 200], [9500, 'hall', 33], [10100, 'tap', 'monitor', 200],
    [10400, 'hold', V.cameraFeedLight, 100], [10570, 'hold', 'wind', 3230],
    [13850, 'camdrop', 150, 200, 67], [14449, 'tap', 'mask', 200],
  ];
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (!eq(OPENING, OPENING0) || !eq(LOOP, LOOP0))
    throw new Error('build(KNOBS0) does not reproduce the shipped schedule:\n' +
      `opening ${JSON.stringify(OPENING)}\nloop ${JSON.stringify(LOOP)}`);
}

const frame = (ms: number) => Math.round(ms * C.FPS / 1000);

// The interpreter's control vocabulary is not the engine's: a camera button is
// `camN`, while the physical cameraFeedLight maps to the simulator's shared
// context-dependent light action. The old `ventl` spelling is accepted only
// here for replaying historical inputs; new emitted plans never produce it.
const actionFor = (action: string) =>
  /^cam\d+$/.test(action) ? `cam:${action.slice(3)}`
  : action === V.cameraFeedLight || action === 'ventl' ? MODEL_CONTEXT_LIGHT
  : action;

// The frame-stamped sim queue for one night of the loop. `shift(cycle, index,
// whenMs)` returns a per-instruction millisecond offset -- 0 everywhere is the
// shipped schedule; a constant models an epoch/T0 phase error; a single nonzero
// row is the per-instruction margin probe (minus-toys-margin.mjs). `opening` /
// `loop` default to the shipped tables; pass build(knobs).opening/.loop to
// schedule a searched variant. `periodMs` is how often the loop table repeats.
// `epochMs` shifts the whole schedule against the game's frame grid -- the
// device reality: the plan is anchored to T0 wall clock while g263's 200 ms
// sampler (engine.js, `f % LAST_VIEW_SAMPLE_FRAMES`) is anchored to the
// night's own frame counter, and the run-to-run epoch error rotates one
// against the other. It is why the split arm is a coin flip on the phone and
// deterministic in this model at epochMs=0.
export function schedule({ splitCamera = true, shift = () => 0,
                           opening = OPENING, loop = LOOP,
                           finish = [], periodMs = KNOBS0.loopPeriodMs,
                           loopStartMs = 0, untilMs = 420000,
                           epochMs = 0 }: {
                             splitCamera?: boolean, shift?: (cycle: string, index: number, at: number) => number,
                             opening?: readonly PlanRow[], loop?: readonly PlanRow[], finish?: readonly PlanRow[],
                             periodMs?: number, loopStartMs?: number, untilMs?: number, epochMs?: number,
                           } = {}) {
  const queue: QueuedAction[] = [];
  const add = (cycle: string, index: number, base: number, row: PlanRow) => {
    const at = row[0];
    const when = base + at + epochMs + shift(cycle, index, base + at);
    if (row[1] === 'tap') queue.push([frame(when), 'press', actionFor(row[2])]);
    else if (row[1] === 'hold' || row[1] === 'hall') {
      const action = row[1] === 'hall' ? MODEL_CONTEXT_LIGHT : actionFor(row[2]);
      const duration = row[1] === 'hall' ? row[2] : row[3];
      queue.push([frame(when), 'press', action],
                 [frame(when + duration), 'release', action]);
    } else if (row[1] === 'camdrop') {
      const [, , a, b, cc] = row;
      queue.push([frame(when), 'press', MODEL_CONTEXT_LIGHT],
                 [frame(when + a), 'press', 'monitor'],
                 [frame(when + a + b + cc), 'release', MODEL_CONTEXT_LIGHT]);
    }
  };
  opening.forEach((row, i) => {
    if (!splitCamera && row[2] === 'cam9') return;
    add('opening', i, 0, row);
  });
  for (let base = loopStartMs; base < untilMs; base += periodMs)
    loop.forEach((row, i) => add('toys', i, base, row));
  finish.forEach((row, i) => add('finish', i, 0, row));
  return queue.sort((x, y) => x[0] - y[0]);
}

// Resolve the mask coverage endpoints from the emitted press rows. The two
// mask rows are shifted independently by the device-error model, so their
// nominal knob difference is not the available window. A mask tick can only
// accrue after the ON animation and stops when the OFF press begins.
export function maskWindows(queue: readonly QueuedAction[]) {
  const presses = queue.filter(([, kind, action]) => kind === 'press' && action === 'mask');
  const windows = [];
  for (let i = 0; i + 1 < presses.length; i += 2) {
    const onPressFrame = presses[i][0];
    const offPressFrame = presses[i + 1][0];
    windows.push({
      onPressFrame,
      offPressFrame,
      startFrame: onPressFrame + C.MASK_ANIM_ON,
      endFrame: offPressFrame,
    });
  }
  return windows;
}

// Explicit upper-bound control only. Production code must replace this with
// an estimator-backed provider; naming the oracle here keeps the exact engine
// phase from masquerading as the proposed Bluetooth phase clock.
export const ENGINE_PHASE_ORACLE = Object.freeze({
  kind: 'engine-phase-oracle',
  periodFrames: C.FPS,
  nextBoundaryFrame: (frame: number) => frame + ((C.FPS - (frame % C.FPS)) % C.FPS),
});

export function replay({ night = 7, seed = 1, worst = false, splitCamera = true,
                         shift, knobs, epochMs = 0,
                         phaseClock = ENGINE_PHASE_ORACLE }: {
                           night?: number, seed?: number, worst?: boolean, splitCamera?: boolean,
                           shift?: (cycle: string, index: number, at: number) => number, knobs?: Partial<Knobs> | null,
                           epochMs?: number, phaseClock?: typeof ENGINE_PHASE_ORACLE,
                         } = {}) {
  const sim = new Sim({ night, seed, worst });
  const { opening, loop, finish } = knobs ? build(knobs) : _default;
  const kk: Knobs = knobs ? clone(knobs) : KNOBS0;
  const periodMs = kk.minimal ? kk.minPeriodMs : kk.loopPeriodMs;
  const loopStartMs = kk.minimal ? kk.minLoopStartMs : 0;
  const untilMs = kk.minimal ? kk.minStopAtMs : 420000;
  const queue = schedule({ splitCamera, shift, opening, loop, finish, periodMs, loopStartMs, untilMs, epochMs });
  const scheduledMaskWindows = maskWindows(queue);

  // `reactiveBB` wires the reserved hook for real (2026-08-30 directive): a
  // VentThreatReactive layer rides the schedule -- the opening left-opening
  // video fact pre-empts it with a 5-tick mask hold (the continuous-hold tick
  // the ~4.8 s scheduled window cannot deliver), the harness suppresses the
  // base schedule while the controller is mid-response (a scheduled mask-off
  // or monitor raise during the hold is what walks BB inside), and press
  // collisions obey the night 6-38 guard. Observation models the stock video
  // loop: ~15 Hz cadence, optional round-trip delay and drop rate.
  const reactive = kk.reactiveBB ? {
    obs: new Observer({
      interval: kk.reactiveIntervalFrames ?? 4,
      readDelayFrames: kk.reactiveDelayFrames ?? 0,
      dropRate: kk.reactiveDropRate ?? 0,
      audioLatencyFrames: kk.reactiveAudioLatencyFrames ?? 12,
      audioDropRate: kk.reactiveAudioDropRate ?? 0,
      audioFalseNegativeRate: kk.reactiveAudioFalseNegativeRate ?? 0,
      audioFalsePositiveRate: kk.reactiveAudioFalsePositiveRate ?? 0,
      rng: new Rng((seed ^ 0x9e3779b9) >>> 0),
    }),
    ctrl: new VentThreatReactive({
      // The active window is supplied per decision from the actual emitted
      // press frames below. Do not substitute the nominal maskOff-maskOn knob
      // difference: animation, late observation, and independent row jitter
      // all change the remaining coverage.
    }),
    lightReleaseAt: -1,   // the pre-mask hall pulse: press now, release in hallMs
  } : null;
  const hallFrames = Math.max(1, Math.round(kk.hallMs / 1000 * C.FPS));
  const animated = reactive
    ? queue.filter(([, k, a]) => k === 'press' && (a === 'monitor' || a === 'mask'))
        .map(([at, , action]) => ({ at, action }))
    : null;

  let i = 0, splitAt = -1, minBox = 1, minPower = sim.power;
  while (sim.alive && !sim.won) {
    if (reactive && reactive.lightReleaseAt >= 0 && sim.frame >= reactive.lightReleaseAt) {
      sim.release(MODEL_CONTEXT_LIGHT);
      reactive.lightReleaseAt = -1;
    }
    // The schedule freezes only while the mask must be UP (securing/holding).
    // Verifying and restoring run it: the raise+wind rows after the drop are
    // the point, and suppressing them costs more than the threat on Night 2's
    // box margin (measured 2026-08-30: the first, blunter cut went 8/300).
    if (!reactive ||
        (!['securing', 'holding', 'banking'].includes(reactive.ctrl.state))) {
      while (i < queue.length && queue[i][0] <= sim.frame) {
        const [, kind, action] = queue[i++];
        sim[kind](action);
      }
    } else {
      while (i < queue.length && queue[i][0] <= sim.frame) i++;   // dropped, not deferred
    }
    if (reactive) {
      const facts = reactive.obs.read(sim);
      // Built whenever the reactive layer is.
      const window = (animated as NonNullable<typeof animated>).filter(x => Math.abs(sim.frame - x.at) < GUARD_FRAMES * 3);
      const maskWindow = scheduledMaskWindows.find(w =>
        sim.frame >= w.onPressFrame && sim.frame <= w.offPressFrame);
      // The controller reads the Observer's facts by name; the read's frame entry is not one it reads.
      const intents = reactive.ctrl.decide(facts as unknown as Parameters<VentThreatReactive['decide']>[0], {
        frame: sim.frame,
        scheduled: window,
        maskWindow,
        phaseClock,
      });
      const kept = guardIntents(intents, window);
      if (reactive.ctrl.settle(kept)) for (const it of kept) {
        if (it.at <= sim.frame) {
          // The pre-mask hall pulse: the schedule spells a hall as a held
          // light (press now, release after hallMs), so expand to that pair.
          // windRelease likewise closes a hold the controller opened.
          if (it.action === 'hall') {
            sim.press(MODEL_CONTEXT_LIGHT);
            reactive.lightReleaseAt = sim.frame + hallFrames;
          } else if (it.action === 'windRelease') {
            sim.release('wind');
          } else {
            sim.press(it.action);
          }
        }
      }
    }
    sim.tick();
    if (splitAt < 0 && sim.camsUp && sim.viewing === 11 && sim.cam === 9)
      splitAt = sim.frame;
    minBox = Math.min(minBox, sim.box);
    minPower = Math.min(minPower, sim.power);
  }
  return { sim, splitAt, minBox, minPower,
           reactiveLog: reactive ? reactive.ctrl.log : undefined };
}

// The arm's sensitivity to the schedule/game phase, measured. For each whole
// frame offset over one sampler period (g263 ticks every
// LAST_VIEW_SAMPLE_FRAMES), replay the night and report survival and
// arm-landing separately: on a minimal Night 1 a missed arm is a guaranteed
// Puppet death, so `wins` separates the two only via `armed`. This is the
// pricing instrument for any arm change -- it is the model finally seeing the
// miss branch the 200/200 deterministic gate is blind to.
export function phaseScan({ night = 1, seeds = 24, worst = false, knobs }: { night?: number, seeds?: number, worst?: boolean, knobs?: Partial<Knobs> } = {}) {
  const step = 1000 / C.FPS;               // one frame in ms
  const n = Math.round(C.LAST_VIEW_SAMPLE_FRAMES); // one sampler period in frames
  const population = randomSeedCohort({ count: seeds });
  const rows: { epochFrames: number, epochMs: number, wins: number, armed: number, seeds: number }[] = [];
  for (let k = 0; k < n; k++) {
    let wins = 0, armed = 0;
    for (const seed of population) {
      const r = replay({ night, worst, seed, knobs, epochMs: k * step });
      if (r.sim.won) wins++;
      if (r.splitAt >= 0) armed++;
    }
    rows.push({ epochFrames: k, epochMs: +(k * step).toFixed(2), wins, armed, seeds });
  }
  return rows;
}

export function emitPlan(night: number, knobs?: Partial<Knobs> | null) {
  const { opening, loop, finish } = knobs ? build(knobs) : _default;
  const kk: Knobs = knobs ? clone(knobs) : KNOBS0;
  const periodMs = kk.minimal ? kk.minPeriodMs : kk.loopPeriodMs;
  // `#period` names the loop cadence so trial.sh does not have to guess it
  // (POLICY_CYCLE_MS). The 10/20 plan is 10 s; `--minimal` is 5 s.
  const lines = [`#policy minus-toys`, `#night ${night}`, `#period ${periodMs}`];
  if (kk.minimal) lines.push(`#loop-start ${kk.minLoopStartMs}`, `#stop-at ${kk.minStopAtMs}`,
    `#observe-until ${kk.minObserveUntilMs}`,
    // Tells trial.sh's on-phone driver to open the arm-verify window after the
    // opening raise: the host classifies the raised monitor's declared camera
    // pair and re-arms or aborts on a miss. The 200/200 gate above
    // replays at a fixed sampler phase and cannot see the arm's 3-of-12 miss
    // branch (--phasegate), so the runner closes it.
    `#arm-verify 1`,
    // The singular CAM 11 classifier proves only that the monitor returned to
    // the viewed feed. The split verifier needs the marker as well.
    `#arm-verify-cameras ${cameraPairHeader(DOUBLE_GLITCH_CAMERA_PAIRS.minusToys)}`);
  else lines.push('#loop-start 0', '#stop-at 420000', '#observe-until 420000',
    '#arm-verify 1',
    `#arm-verify-cameras ${cameraPairHeader(DOUBLE_GLITCH_CAMERA_PAIRS.minusToys)}`);
  // Keep the first wind behind the visual arm gate. The native watch reaches
  // the stable double-highlight pair about 350 ms after the second raise on
  // the g56; the executor's readiness delay is added before these plan-relative
  // times, so the cutoff is deliberately expressed in the opening timeline
  // and leaves 50 ms before the first wind contact.
  const openingRaise = kk.minimal
    ? kk.minArmAtMs + kk.openArmMs + kk.armingGapMs + kk.openRaiseGapMs
    : kk.openArmMs + kk.armingGapMs + kk.openRaiseGapMs;
  const firstWind = kk.minimal
    ? kk.minLoopStartMs + kk.minWindAtMs
    : openingRaise + kk.openWindLeadMs;
  lines.push('#arm-verify-viewing cam:11', `#arm-verify-until ${firstWind - 50}`);
  lines.push('#cycle opening');
  for (const row of opening) lines.push(row.join(' '));
  lines.push('#cycle toys');
  for (const row of loop) lines.push(row.join(' '));
  if (finish.length) {
    lines.push('#cycle finish');
    for (const row of finish) lines.push(row.join(' '));
  }
  return lines.join('\n') + '\n';
}

// death.reason -> the AI id the sourced table gates it on (for canAct checks).
const REASON_AI: Readonly<Record<string, string>> = {
  'golden-freddy': 'golden', 'golden-freddy-hall': 'golden',
  foxy: 'foxy', puppet: 'puppet', 'balloon-boy': 'bb',
};
/**
 * The AI id of whoever killed a dead Sim, or null when the death names none.
 * An inside-office death is the committed unit's (its attack animation names
 * it), so the reason alone does not say who.
 */
export function killerOf(sim: Sim): string | null {
  const reason = sim.death?.reason;
  if (reason === 'inside-office')
    return sim.attackAnimation?.who ?? sim.units.find(unit => unit.committedAt >= 0)?.id ?? null;
  return reason !== undefined && Object.hasOwn(REASON_AI, reason) ? REASON_AI[reason] : null;
}
/**
 * Whether the sourced table has set any AI for `id` by the hour of `atFrame`.
 * g673 zeroes every counter at night start, so a character no row has named
 * yet is at 0 -- the hour matters, not the night's peak (Night 1's Toy Bonnie
 * is 0 until 2 AM and 3 after).
 */
export function armedBy(night: number, id: string, atFrame: number) {
  const hour = Math.floor(atFrame / C.HOUR_FRAMES);
  for (let h = 0; h <= hour; h += 1)
    if (C.aiUpdates(night, h).some(row => row.set[id] !== undefined && row.set[id] !== 0)) return true;
  return false;
}

function gate(night: number, knobs: Partial<Knobs> | undefined, runs = 3000) {
  const minimal = !!clone(knobs).minimal;
  const population = randomSeedCohort({ count: runs });
  const cohort = seedCohortDescriptor(population, { salt: GOLDEN_MODEL_SEED_SALT });
  for (const worst of [false, true]) {
    const n = population.length;
    let wins = 0;
    const lossReasons = new Set<string>();
    const losses: { killer: string | null, frame: number }[] = [];
    const lossFrames: number[] = [];
    for (const seed of population) {
      const r = replay({ night, worst, seed, knobs });
      if (r.sim.won && r.splitAt >= 0) wins++;
      else if (r.sim.death) {
        lossReasons.add(r.sim.death.reason);
        losses.push({ killer: killerOf(r.sim), frame: r.sim.death.frame });
        lossFrames.push(r.sim.death.frame);
      }
    }
    console.log(`Minus Toys device plan night ${night}${minimal ? ' minimal' : ''} ` +
      `${worst ? 'worst' : 'normal'}: ${wins}/${n} ` +
      `cohort=${cohort.sha256.slice(0, 12)}`);
    if (wins === n) continue;
    // The minimal plan carries no defensive mask/monitor churn, so worst-mode
    // pinning -- which forces AI-0 animatronics to advance and spawn -- reaches
    // states the sourced table forbids. Accept a worst-mode loss ONLY if every
    // loss is to an animatronic the table has not armed by the hour it struck.
    // A loss to any armed threat, or any loss on normal seeds, is a real failure.
    const artifactOnly = minimal && worst && lossFrames.length === n &&
      // Worst mode forces characters through their pre-2-AM routes even though
      // Night 1's sourced AI table cannot arm them yet.  The first real minimal
      // action is at 2 AM, so only a loss before that boundary is an artifact,
      // and only to a killer still at AI 0 at that hour.
      lossFrames.every(at => at < frame(KNOBS0.minLoopStartMs)) &&
      losses.every(({ killer, frame: at }) => killer !== null && !armedBy(night, killer, at));
    const killers = [...new Set(losses.map(loss => loss.killer ?? 'an unnamed killer'))];
    if (artifactOnly) {
      console.log(`  worst-mode losses are pinned-RNG artifacts (${[...lossReasons].join(', ')} by ` +
        `${killers.join(', ')} -- each at AI 0 at the hour it struck on night ${night}); ` +
        'the normal-seed gate is the proof');
      continue;
    }
    return false;
  }
  let controlWins = 0;
  for (const seed of population)
    if (replay({ night, splitCamera: false, seed, knobs }).sim.won) controlWins++;
  console.log(`Minus Toys device plan night ${night} no-split control: ${controlWins}/${population.length} ` +
    `cohort=${cohort.sha256.slice(0, 12)}`);
  // On early story nights the weak AI can let an unstalled control survive;
  // the load-bearing control is canonical 10/20, where it must clear none.
  return night === 7 ? controlWins === 0 : true;
}

// --knobs=loopPeriodMs=5000,windMs=3000 -- overrides on KNOBS0, for --gate and emission.
function parseKnobs() {
  const v = process.argv.find(a => a.startsWith('--knobs='));
  if (!v) return undefined;
  const k: Record<string, unknown> = {};
  for (const pair of v.slice(8).split(',')) {
    const [name, val] = pair.split('=');
    if (!(name in KNOBS0)) throw new Error(`unknown knob: ${name}`);
    k[name] = val === 'true' ? true : val === 'false' ? false : +val;
  }
  // Each name was checked against KNOBS0; a value of the wrong kind is passed as typed on the command line.
  return k as Partial<Knobs>;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nightArg = (process.argv.find(v => v.startsWith('--night=')) || '--night=7').slice(8);
  const night = +nightArg;
  if (!Number.isInteger(night) || night < 1 || night > 7)
    throw new Error('--night must be 1..7');
  let knobs: Partial<Knobs> | undefined = parseKnobs();
  if (process.argv.includes('--minimal')) {
    // The elegant story plan is NOT one shape for all nights: Night 1 alone
    // reduces to "arm + flash + wind" (MINUS-3-STRATEGY.md sec.9 -- monitor-down
    // disarms every Toy, nothing reaches a vent, GF is AI 0). Night 2 needs a
    // mask for Mangle/BB; Nights 3-5 switch to CAM 08 and need hall flashes.
    // Those shapes are not designed yet, so --minimal is Night 1 only.
    if (night !== 1)
      throw new Error('--minimal is Night 1 only (MINUS-3-STRATEGY.md sec.9); ' +
        'nights 2-5 need their own shapes and do not have them yet');
    knobs = { ...(knobs || {}), minimal: true };
  }
  if (process.argv.includes('--phasegate')) {
    // A measurement, not a contract: it prints the arm's phase sensitivity
    // and always exits 0. The suite (test-minus-toys-plan.mjs) pins what the
    // shipped arm must show; trial.sh's --gate stays the schedule contract.
    const seeds = +(process.argv.find(v => v.startsWith('--seeds=')) || '--seeds=24').slice(8);
    const rows = phaseScan({ night, seeds, knobs });
    console.log(`arm phase scan, night ${night}${knobs?.minimal ? ' minimal' : ''}, ` +
      `${seeds} seeds per epoch (epoch = schedule shifted against the game frame grid):`);
    for (const r of rows)
      console.log(`  +${String(r.epochFrames).padStart(2)}f (${String(r.epochMs).padStart(6)} ms): ` +
        `${r.wins}/${r.seeds} won, split armed ${r.armed}/${r.seeds}`);
    const landed = rows.filter(r => r.armed === r.seeds).length;
    const missed = rows.filter(r => r.armed === 0).length;
    console.log(`arm lands on ${landed}/${rows.length} epochs, never on ${missed}; ` +
      `device arm is a coin flip with P(miss) ~= ${missed}/${rows.length} per attempt`);
  } else if (process.argv.includes('--gate')) {
    // Golden rule (Pedro, 2026-09-07): every simulation gate runs 3000
    // seeds. Lower counts are for interactive probing only and are never
    // proof; winner records cite the exact run count they were proven with.
    const runsArg = process.argv.find(v => v.startsWith('--runs='));
    const runs = runsArg ? +(runsArg.slice(7)) : 3000;
    if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
    if (!gate(night, knobs, runs)) process.exitCode = 1;
  } else {
    process.stdout.write(emitPlan(night, knobs));
  }
}
