// Emit the device pilot's cycle recipes from the exact simulator, with their
// budgets, as one artifact both the runner and its checks read.
//
// Why this exists: the cycle table used to live twice -- as JS here and as
// hand-typed millisecond literals inside trial.sh -- with nothing
// checking that they agreed and nothing tracking what a cycle spends. A hall
// pulse transcribed as the simulator's 83 ms reached the phone three times and
// `grade-minus7.py` found zero visible beams, because 83 ms is under the
// contact length Fusion's per-frame touch poll reliably sees.
//
// Usage: node packages/propose/bin/plans/recipe.ts [--night=6] [--slot-ms=120] ... [--json]
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { run, DEFAULT_SEARCH_KNOBS, makeSearchKnobs, MASK_OFF_INPUT_FRAMES } from '../../parked/minus7/hid-device-pilot.ts';

// The phone's measured contact floor. The Moto g56 accepted 33 ms contacts
// on camera-select, monitor, mask and hall controls; 100 ms was margin from
// the swipe-era probe, not a Fusion requirement. See
// docs/device/HID-MULTITOUCH.md, "every touch control registers at 33 ms".
export const MIN_CONTACT_MS = 33;
// Fusion's event loop polls touch at 30 Hz. Distinct controls need one whole
// poll with neither contact down or they can look like one finger moving.
export const FUSION_POLL_MS = 33;
// Perfetto + camtrace delivered every camera selection at 100 ms spacing with
// 33 ms contacts; it was the cleanest of the tested 100/120/160/240 ms runs.
// This is the active device geometry. It is intentionally independent from
// FUSION_POLL_MS: 33 ms is the proven contact duration, while 100 ms is the
// tightest end-to-end sweep spacing currently measured on the phone.
export const DEVICE_SPACING_MS = 100;
// The slot the POLICY is validated at. It is deliberately not the device
// spacing: widening the actuator is a device compensation applied by the
// emitter, not a new route. Rebuilding the policy at 140 moves its sweeps
// 50 ms earlier and the plan then replays 11/300 -- that is the tail this
// route cannot give up, not a rounding difference.
export const MODEL_SLOT_MS = 120;
export const NIGHT_MS = 420_000;
export const CYCLE_MS = 5_000;

// Frame<->ms conversion reads the engine's rate, never a literal. This file
// imports C and still hardcoded 60 in five places while actuator.ts used
// C.FPS -- the exact shape of "defined once, re-derived per context" that
// the tick rate is already ambiguous about (30 Hz Fusion poll vs 60 FPS
// render). Only one of those two is C.FPS, and now only one is spelled here.
const ms = f => Math.round(f * 1000 / C.FPS);

// Which physical control a press means depends on the monitor: `light` is the
// camera light with the cams up and the hallway light with them down.
function controlFor(act, camsUp) {
  if (act === 'light') return camsUp ? 'camlight' : 'hall';
  if (act === 'ventL') return 'ventl';
  if (act.startsWith('cam:')) return 'cam' + act.slice(4);
  return act;
}

export function capture(opts) {
  const log = [];
  const patched = [];
  for (const m of ['press', 'release']) {
    const orig = Sim.prototype[m];
    patched.push([m, orig]);
    Sim.prototype[m] = function (act) {
      const camsUp = this.camsUp;
      const result = orig.call(this, act);
      // Record the state the engine actually reached, never a toggle count.
      // Monitor and mask are toggles at the button and states everywhere else,
      // and every time a schedule has inferred the state by counting presses
      // it has eventually counted wrong -- that is what `pilottest --sync`
      // exists to repair. A recipe carries the state the engine reports.
      log.push({ f: this.frame, kind: m, act, camsUp,
                 monitor: this.monitor, maskOn: this.maskOn });
      return result;
    };
  }
  try {
    run({ ...opts, sim: { seed: opts.seed ?? 7, night: opts.night ?? 6 } });
  } finally {
    for (const [m, orig] of patched) Sim.prototype[m] = orig;
  }
  return log;
}

// Pair each press with its release; a bare press is a tap the device must
// still hold for MIN_CONTACT_MS.
function events(log, from, to) {
  const open = new Map();
  const out = [];
  for (const e of log) {
    if (e.f < from || e.f >= to) continue;
    if (e.kind === 'press') {
      const rec: any = { at: ms(e.f - from), act: controlFor(e.act, e.camsUp),
                    dur: MIN_CONTACT_MS, tap: true };
      // MON_RAISING/MON_LOWERING are the animation; the intent is the endpoint.
      rec.camsUp = e.camsUp;
      if (e.act === 'monitor') rec.want = e.monitor === 'up' || e.monitor === 'raising' ? 'up' : 'down';
      if (e.act === 'mask') rec.want = e.maskOn ? 'on' : 'off';
      open.set(e.act, rec);
      out.push(rec);
    } else {
      const rec = open.get(e.act);
      if (!rec) continue;            // release of a press from the prior slice
      rec.dur = ms(e.f - from) - rec.at;
      rec.tap = false;
      open.delete(e.act);
    }
  }
  return out;
}

// A budget is what the cycle spends, not what it intends: light-on time is the
// flashlight, wind time is the box, cams-down time is everything the schedule
// cannot do while it is reading.
export function budget(cycle, lengthMs) {
  const lit = cycle.filter(e => e.act === 'camlight' || e.act === 'hall')
    .reduce((sum, e) => sum + e.dur, 0);
  const wind = cycle.filter(e => e.act === 'wind').reduce((sum, e) => sum + e.dur, 0);
  const cams = cycle.filter(e => e.act.startsWith('cam') && e.act !== 'camlight');
  const sweeps = [];
  for (const e of cams) {
    if (e.act === 'cam11') continue;
    const last = sweeps[sweeps.length - 1];
    if (last && e.at - last[last.length - 1].at <= 400) last.push(e);
    else sweeps.push([e]);
  }
  const spacings = sweeps.flatMap(s => s.slice(1).map((e, i) => e.at - s[i].at));
  // Nights 6-7 drain 120 box units/s and add 300/s while winding, so a cycle
  // is net-neutral at 120/(300+120) of its length.
  const windBreakEven = Math.round(lengthMs * 120 / 420);
  return {
    lengthMs,
    litMs: lit,
    windMs: wind,
    windBreakEvenMs: windBreakEven,
    windMarginMs: wind - windBreakEven,
    sweepSpanMs: sweeps.length ? sweeps[0][sweeps[0].length - 1].at - sweeps[0][0].at : 0,
    maxSpacingMs: spacings.length ? Math.max(...spacings) : 0,
    minContactMs: Math.min(...cycle.map(e => e.dur)),
  };
}

// Where the attack cycle's template comes from when the night being evaluated
// cannot supply one. Night 6 seed 7 is the pinned configuration every device
// route is built from; borrowing its shape keeps a branch in the plan for a
// threat the source says cannot happen, which is what makes an unexpected
// classifier read survivable rather than unhandled.
export const TEMPLATE_NIGHT = 6;
export const TEMPLATE_SEED = 7;
// Alternate samples tried before giving up on a night whose threat IS
// reachable. A rare character (Balloon Boy is AI 1 then 2 on Night 3) can be
// absent from one seed and present in the next; that is a sampling accident,
// not a property of the night, and it must not be answered by borrowing.
export const ATTACK_SEEDS = [7, 1, 2, 3, 4, 5, 6, 8, 9, 10];

// The attack cycle is 10 s long, and `build()` cuts exactly that much log
// from the anchor. A sample that does not RUN for that long cannot supply one.
export const ATTACK_WINDOW_FRAMES = 600;

// The attack is the only cycle with no monitor press for seconds after the
// prophylactic mask: the mask blocks every other control while it is held.
// Returns the monitor press that anchors it, or null when this sample has no
// attack cycle at all.
//
// "No monitor press within 180 frames" is also true of the LAST mask flick of
// a night that simply ended, and that false positive shipped: on 2026-08-26 the
// sourced Puppet rework (g494-497/g623/g774) shifted the shared LCG enough that
// night 3 seed 7 stopped rolling a Balloon Boy attack, `resolveAttack` reseeded
// to seed 1, and seed 1's final prophylactic flick at frame 25089 -- 111 frames
// before the 25200-frame end of the night -- was read as an attack. The cut was
// 59 frames of log, so the plan's attack branch became `tap monitor` + `read`
// and nothing else: on every Balloon Boy detection the pilot masked and then
// sat still for ten seconds. Foxy's D climbs 2/s there (1/s in tickFoxy, 1/s
// more in tickMask), which clears night 3's lock equation inside one cycle, and
// the replay fell to 13/100 with all 87 losses `foxy`.
//
// So a candidate is only an attack cycle if the sample kept running long enough
// to contain one. Scan every candidate rather than taking the first: an early
// end-of-night false positive must not hide a real attack later in the log.
export function attackAnchor(log, windowFrames = ATTACK_WINDOW_FRAMES) {
  const masks = log.filter(e => e.kind === 'press' && e.act === 'mask').map(e => e.f);
  const monitors = log.filter(e => e.kind === 'press' && e.act === 'monitor').map(e => e.f);
  const end = log.length ? log[log.length - 1].f : -1;
  for (const f of masks) {
    if (monitors.some(g => g > f && g < f + 180)) continue;
    const anchor = monitors.filter(g => g < f).pop();
    if (anchor === undefined) continue;
    if (end - anchor < windowFrames) continue;   // the night ended, not an attack
    return anchor;
  }
  return null;
}

// Which sample the attack branch is cut from, and whether the branch is
// reachable on the night being built.
//
// Before 2026-08-26 this was one line -- `throw new Error('no attack cycle in
// the sampled night')` -- which conflated "this night's fixed seed showed no
// Balloon Boy" with "this recipe cannot be built". It cannot be: Nights 1 and
// 3 both failed there, for opposite reasons. Night 1 never arms him at all,
// so a missing branch is correct; Night 3 arms him at AI 1 and seed 7 simply
// did not roll him, so a missing branch is a sampling accident. Only the
// source table can tell those apart, so this asks it.
//
// It stays fail-closed in the other direction: a sample that DOES show an
// attack on a night whose sourced AI never arms Balloon Boy is an
// observation/config mismatch, and building a plan against it would mean the
// engine and the AI table disagree about the night being played.
export function resolveAttack(o, log, capfn = capture) {
  const night = o.night ?? 6;
  const seed = o.seed ?? 7;
  const possible = C.canAct(night, 'bb');
  const wf = Math.round((o.attackWindowMs ?? 10000) * C.FPS / 1000);
  const own = attackAnchor(log, wf);
  if (own !== null) {
    if (!possible)
      throw new Error(`night ${night} sampled a Balloon Boy attack cycle, but the ` +
        `sourced AI table never arms him on this night (peak AI ${C.peakAi(night, 'bb')}); ` +
        'refusing to build a plan against an observation/config mismatch');
    return { anchor: own, log, from: { night, seed }, source: 'sampled', reachable: true };
  }
  if (possible) {
    for (const alt of ATTACK_SEEDS) {
      if (alt === seed) continue;
      const sample = capfn({ ...o, seed: alt });
      const anchor = attackAnchor(sample, wf);
      if (anchor !== null)
        return { anchor, log: sample, from: { night, seed: alt },
                 source: 'reseeded', reachable: true };
    }
    throw new Error(`night ${night} arms Balloon Boy (peak AI ${C.peakAi(night, 'bb')}) but ` +
      `none of ${ATTACK_SEEDS.length} sampled seeds produced an attack cycle to cut the ` +
      'branch from; widen ATTACK_SEEDS rather than shipping a plan with no attack branch');
  }
  const sample = capfn({ ...o, night: TEMPLATE_NIGHT, seed: TEMPLATE_SEED });
  const anchor = attackAnchor(sample, wf);
  if (anchor === null)
    throw new Error(`the canonical attack template (night ${TEMPLATE_NIGHT} seed ` +
      `${TEMPLATE_SEED}) no longer samples an attack cycle`);
  return { anchor, log: sample, from: { night: TEMPLATE_NIGHT, seed: TEMPLATE_SEED },
           source: 'template', reachable: false };
}

export function build(opts = {}) {
  // Golden Freddy is cleared on every cycle by the canonical prophylactic
  // mask flick.
  //
  // The always-taken mask flick is not a Balloon Boy precaution -- it is the
  // Golden Freddy clear that MINUS-7-STRATEGY.md's order rule demands before
  // the hall flash ("Golden Freddy must be cleared *before* you press CTRL, or
  // the flash kills you"). It was dropped temporarily because nights 6-30 and
  // 6-31 stayed masked and every later left read came back dark.
  //
  // Priced in the exact simulator over 1000 night-6 runs, after the simulator's
  // invented xorshift stream was replaced by the APK runtime's sourced LCG:
  //     with the flick           1000/1000 clears
  //     ignoring Golden Freddy    465/1000 clears
  // Every one of those 535 deaths is "raised the monitor with Golden Freddy in
  // the office". Correction 2026-08-25: the old xorshift sample put the first
  // loss at 149 s and made ignoring him look free until 2 AM. The real stream
  // produces a loss at 8.55 s in the same 1000-seed census. The causal claim
  // (all losses are Golden Freddy) survived; the timing rationale did not.
  //
  // That retraction exposed the actual phone failure. The HID/recording census
  // found that the lost input was the MONITOR press after the mask, not the
  // mask toggle: 9/14 desyncs were that seam, with 9/15 monitor presses lost
  // below 180 ms and 0/17 lost at or above it. The device plan now restores
  // the flick and folds mask-off + raise into one HID macro whose internal
  // press-to-press gap is 180 ms. See foldMaskRaise() and
  // ON-DEVICE-VALIDATION.md, "Which press desyncs, and why".
  // `captureFn` is a test seam, not a recipe option: it must not land in
  // `recipe.options`, which is what the pinning checks compare.
  const { captureFn = capture, ...rest } = (opts as any);
  const o: any = { bbMode: 'left', deviceSweep: true, pulseLight: true,
              sweepSlotMs: MODEL_SLOT_MS, maskMarginMs: 900, readLatencyMs: 550,
              hallPulseMs: 130, pilotOffset: 10, prophylacticMask: true,
              attackWindowMs: 10000, ...rest,
              knobs: makeSearchKnobs((rest as any).knobs) };
  const night = o.night ?? 6;
  const log = captureFn(o);
  const epoch = o.pilotOffset;
  const s = sec => epoch + Math.round(sec * C.FPS);

  // The steady and opening cycles are cut from the night being evaluated; the
  // attack branch is cut from whichever sample can supply one. Those are
  // different questions and used to be the same line.
  const bb = resolveAttack(o, log, captureFn);

  const attackFrames = Math.round(o.attackWindowMs * C.FPS / 1000);
  const opening = events(log, epoch, s(7));
  const clear = events(log, s(7) + 300, s(7) + 600);
  const attack = events(bb.log, bb.anchor, bb.anchor + attackFrames);
  // Fail closed on a branch that is present but empty. An attack cycle that
  // never raises the monitor again is not a cycle, it is a hole, and the
  // pilot spends it masked and blind. Nothing checked this before.
  if (!attack.some(e => e.act === 'monitor' && e.at > 0))
    throw new Error(`the attack branch cut from night ${bb.from.night} seed ${bb.from.seed} ` +
      `(${bb.source}) has no monitor press after the read: it is ${attack.length} events of ` +
      `a ${o.attackWindowMs / 1000} s cycle, which would leave the pilot masked and idle on every Balloon Boy read`);

  const cycles = {
    opening: { lengthMs: 7000, events: opening },
    clear: { lengthMs: 5000, events: clear },
    attack: { lengthMs: o.attackWindowMs, events: attack },
  };
  for (const [, c] of Object.entries(cycles)) (c as any).budget = budget(c.events, c.lengthMs);

  // A night is mostly clear cycles; price the flashlight against the sourced
  // per-night budget rather than against a single cycle.
  const clearCycles = Math.floor((NIGHT_MS - 7000) / CYCLE_MS);
  const nightLitMs = (cycles.opening as any).budget.litMs + clearCycles * (cycles.clear as any).budget.litMs;
  const available = C.powerFrames(night);
  const spent = Math.round(nightLitMs * C.FPS / 1000);
  return {
    night,
    options: o,
    powerFramesAvailable: available,
    powerFramesSpentIfAllClear: spent,
    powerFramesHeadroom: available - spent,
    // What the plan's Balloon Boy branch is, and whether the night can reach
    // it. `reachable: false` means the branch is carried as a fail-safe for an
    // unexpected classifier read, not as a cycle the night will run.
    branches: {
      attack: {
        reachable: bb.reachable,
        source: bb.source,
        cutFrom: bb.from,
        peakAi: C.peakAi(night, 'bb'),
      },
    },
    minContactMs: MIN_CONTACT_MS,
    deviceSpacingMs: DEVICE_SPACING_MS,
    cycles,
  };
}

// The same recipe as a trainer track. `src/config.js`'s CYCLE_SCRIPT is the
// canonical Minus 7 cycle a human drills against; a device recipe is a
// derivative of it, and rendering both in one shape is what makes the
// differences reviewable instead of buried in two unrelated files.
// `ventlight` is the one action canonical Minus 7 has no step for -- the BB
// read is exactly what this variant adds -- so a trainer that wants to drill
// this track has to grow that step type first.
export function track(cycle) {
  const steps = [];
  for (const e of cycle.events) {
    const at = +(e.at / 1000).toFixed(3);
    if (e.act === 'camlight') {
      const prev = steps[steps.length - 1];
      if (prev && prev.action === 'cam') { prev.action = 'camflash'; prev.label += ' + light'; }
      continue;
    }
    if (e.act === 'monitor') {
      steps.push({ id: `monitor-${e.want}`, at,
                   label: e.want === 'up' ? 'Cams up' : 'Cams down',
                   action: 'monitor', want: e.want });
    } else if (e.act === 'mask') {
      steps.push({ id: `mask-${e.want}`, at, label: `Mask ${e.want}`,
                   action: 'mask', want: e.want });
    } else if (e.act === 'hall') {
      steps.push({ id: 'flash-hall', at, label: 'Flash hall', action: 'light',
                   want: 'tap', hold: +(e.dur / 1000).toFixed(3) });
    } else if (e.act === 'ventl') {
      steps.push({ id: 'vent-read', at, label: 'Left vent light + read',
                   action: 'ventlight', want: 'tap', hold: +(e.dur / 1000).toFixed(3) });
    } else if (e.act === 'wind') {
      steps.push({ id: 'wind', at, label: 'Hold WIND', action: 'wind', want: 'on',
                   hold: +(e.dur / 1000).toFixed(3) });
    } else if (e.act.startsWith('cam')) {
      const n = +e.act.slice(3);
      steps.push({ id: `cam-${n}`, at, label: `CAM ${String(n).padStart(2, '0')}`,
                   action: 'cam', cam: n });
    }
  }
  return steps;
}

// The recipe as device instructions. The runner used to carry these as
// hand-typed millisecond literals; emitting them merges the pairs the phone
// performs as one gesture (a camera select and its light pulse; a hall pulse
// under a simultaneous monitor raise) so the shell executes a table instead of
// re-deriving one. Contact lengths are device lengths, never simulator frames.
// The released time the runner leaves between the vent light and the mask.
export const MASK_GAP_MS = 40;

// The mask is not interactive merely because the off press was accepted. The
// Android source state stays in its lowering animation for MASK_ANIM_OFF
// (15 frames = 250 ms at the sourced 60 FPS), and a control touch before that
// completion can be drawn on the mask and ignored. Leave one released Fusion
// poll after completion before the monitor/hall compound begins. This is a
// stronger invariant than the old 180 ms empirical seam: the phone may still
// vary in visual presentation, but the schedule never intentionally places a
// later control in the masked animation window.
export const MASK_ANIM_OFF_MS = Math.round(C.MASK_ANIM_OFF * 1000 / C.FPS);
// The engine drops input during the mask-ON animation exactly as it does during
// the mask-off one. Exported here (artifact-commands.mjs imports its floors
// from this module) so the emitter can respect the same window the compiler
// enforces, instead of authoring a plan the compiler will refuse.
export const MASK_ANIM_ON_MS = Math.round(C.MASK_ANIM_ON * 1000 / C.FPS);
// "One released Fusion poll after completion" was ONE RENDER FRAME, not one
// poll: MASK_OFF_INPUT_FRAMES is MASK_ANIM_OFF + 1, so the gap stood 16.7 ms
// above the 250 ms animation while every floor the seam gate audits must stand
// 33 ms above its measurement. The first minus7 device run graded this
// compound's own mask-off MISSING on 48 of 55 cycles and its monitor raise on
// 54 of 55 (night1-minus7-n1-first-20260919T215533Z); the rule read both states
// hundreds of times elsewhere in the same run, so those are lost presses, not a
// blind detector.
//
// Three frames, not the two that would make the gap exactly 283 ms: a constant
// set precisely to its own floor is the tautology mistake-register item 7 was
// written about (`400 < 400` is false, so the check passed in silence). 18
// frames is 300 ms, clearing the animation by 50 ms.
export const MASK_RAISE_GAP_MS = Math.round((C.MASK_ANIM_OFF + 3) * 1000 / C.FPS);
export const MASK_RAISE_SHIFT_MS = 60;

// The sweep is the one instruction whose numbers are the *actuator's*, not the
// simulator's. Each select/light pulse uses the phone-proven 33 ms contact;
// the active 100 ms inter-selection spacing leaves 67 ms released. Emit these
// measured device numbers and let `replay` ask the engine whether the night
// still survives at the actuator the phone actually has.
export const SWEEP_SELECT_MS = MIN_CONTACT_MS;
export const SWEEP_RELEASED_MS = DEVICE_SPACING_MS - SWEEP_SELECT_MS;

// LIGHT_AFTER geometry (plans/17, trial/09-constants.sh): when the emitted
// sweep contact is under 50 ms the map button is a Click and the light a
// separate press, so each camera costs a 17 ms select + a 17 ms settle frame
// + the emitted contact (the light hold). Kept in step with the runner by
// trial/test-plan-interpreter.sh, which reads both.
export const LA_SELECT_MS = 17;
export const LA_SETTLE_MS = 17;
// `lightAfter` defaults to the historical `contact < 50` inference, but the
// caller may force it: a sweep whose base contact is short is LIGHT_AFTER for
// *every* slot, so a lengthened last slot (sweepLastContactMs, below) still
// costs the select + settle even at 67 ms, where the bare threshold would
// misprice it as the legacy same-report geometry.
export const sweepCamMs = (contactMs, lightAfter = contactMs < 50) =>
  lightAfter ? LA_SELECT_MS + LA_SETTLE_MS + contactMs : contactMs;

// A sweep's cams token is `10,4,7`, or `10,4,7:67` when the drift-exposed last
// slot needs a longer light hold than the rest -- the `:N` suffix overrides
// that one slot's light contact (ON-DEVICE-VALIDATION.md, the last-slot leak).
// Returns the camera list and the parallel per-slot light-contact list.
export function sweepCams(camsToken, baseContactMs) {
  const cams = [], contacts = [];
  for (const tok of String(camsToken).split(',')) {
    const [n, c] = tok.split(':');
    cams.push(n);
    contacts.push(c === undefined ? baseContactMs : +c);
  }
  return { cams, contacts };
}

// The device-time span of a `sweep` instruction from its rest tokens
// [spacing, contact, cams]. The geometry is set by the base contact; only the
// last slot's own contact changes its per-slot cost.
export function sweepSpanMs([spacing, contact, cams]) {
  const base = +contact;
  const { contacts } = sweepCams(cams, base);
  const last = contacts[contacts.length - 1];
  return (contacts.length - 1) * +spacing + sweepCamMs(last, base < 50);
}

// MONITOR_ANIM_UP is 12 sourced frames and `engine.js` drops a camera select
// outright until the raise finishes:
//
//     if (this.monitor === MON_UP && C.CAMS[n]) this.cam = n;
//
// The policy emits selects that clear that animation by 0-30 ms. In the engine
// that is fine, because the select lands exactly on the frame the animation
// completes. On the phone the macro's anchor is wall-timed and lands 49-93 ms
// late, so the same instruction arrives *inside* the animation and sets
// nothing -- the feed stays where it was, the pilot winds on the wrong camera,
// and the sweep that bridges the five-tick mask never happens. Nights 6-22 to 6-25
// died that way and the rendered classifier frame is CAM 11, unchanged.
//
// Move the RAISE earlier rather than the select later: HID-MULTITOUCH.md
// records that one frame of sweep tail costs 272 of 400 nights, so the sweep's
// end is the one thing in this cycle that must not move. Each instruction may
// slide back to one Fusion poll after the one before it, and the relaxation
// runs backwards so freeing a raise can free the hall pulse ahead of it.
export const MONITOR_ANIM_UP_MS = Math.round(C.MONITOR_ANIM_UP * 1000 / C.FPS);
export const RAISE_MARGIN_MS = 33;
// The margin an EMITTER must leave above a device floor, as distinct from the
// floor itself. Two Fusion polls, because one poll is the smallest error the
// device can make: a schedule that clears a floor by exactly one poll is one
// dropped poll away from landing on the boundary, which is not a margin at all.
// Every shipped plan sat at exactly 33 ms on its once-per-cycle mask press
// until 2026-09-19; see test-seam-slack.mjs for what that cost.
export const SEAM_MARGIN_MS = 2 * FUSION_POLL_MS;

// The same clearance, sized for the MODEL rather than the phone.
//
// 33 ms answers the actuator's 49-93 ms lateness. It does not answer the model
// gate, which shifts every row by an iid +/-60 ms draw -- so the gap between a
// raise and the select after it can lose 120 ms, four times the margin. On
// night 1 that cost two seeds in 200: their cam11 select landed inside
// MON_RAISING every cycle, the camera stayed where the sweep left it, and the
// pilot wound CAM 07 all night. windtrace.mjs credits 12% of their wind frames.
//
// This margin is applied by moving the SELECT later, which is only safe when
// the select is a wind park rather than the sweep -- HID-MULTITOUCH.md records
// that one frame of sweep tail costs 272 of 400 nights, so the sweep's end may
// not move and its raise is still pulled earlier instead. A wind park has
// slack: a later select shortens the hold, and the hold is far longer than the
// drain needs.
export const RAISE_JITTER_MARGIN_MS = 120;

// The lowest observed WORKING gap between a monitor raise and a wind contact.
// raise+100 ms and raise+200 ms both MISSED on the phone; +434 ms (the
// minus-toys opening that armed all four story-night wins), +450 ms and
// +500 ms worked. It is a refusal of the failing region, not a measurement --
// the true readiness lies somewhere in (200, 434].
//
// It lives here, beside the other device floors, because artifact-commands.mjs
// already imports its floors from this module; the reverse direction would be
// a cycle. `clearTheRaise` needs it to place the wind park, and until
// 2026-09-19 only the compiled-plan gate knew the number, so the emitter could
// author a wind the gate would later refuse -- which is exactly what minus7
// did, at raise+414 ms.
export const MONITOR_READY_WIND_MS = 434;

function clearTheRaise(name, lines) {
  const ins = lines.map(line => {
    const [at, kind, ...rest] = line.split(' ');
    return { at: +at, kind, rest };
  });
  const spanOf = e =>
    e.kind === 'tap' || e.kind === 'hold' ? +e.rest[1] :
    e.kind === 'hall' ? +e.rest[0] :
    e.kind === 'hallraise' ? +e.rest[0] :
    e.kind === 'sweep' ? sweepSpanMs(e.rest) :
    e.kind === 'read' ? +e.rest[0] : MIN_CONTACT_MS;
  const isCamera = e => e.kind === 'sweep' ||
    (e.kind === 'tap' && /^cam\d+$/.test(e.rest[0]));
  const isRaise = (e, up) => !up &&
    (e.kind === 'hallraise' || (e.kind === 'tap' && e.rest[0] === 'monitor'));

  // Which monitor presses are raises depends on where the cycle starts: a
  // steady cycle is entered with the cams up and its anchor lowers them.
  let up = name !== 'opening';
  const raises = [];
  for (const e of ins) {
    if (e.kind === 'hallraise' || (e.kind === 'tap' && e.rest[0] === 'monitor')) {
      if (isRaise(e, up)) raises.push(e);
      up = !up;
    }
  }

  for (const raise of raises) {
    const i = ins.indexOf(raise);
    const select = ins.slice(i + 1).find(isCamera);
    if (!select) continue;
    // A wind park can move; the sweep cannot. Push the park late enough that
    // the gate's own jitter cannot land it inside the raise animation.
    const isSweep = select.kind === 'sweep';
    if (!isSweep) {
      const earliest = raise.at + MONITOR_ANIM_UP_MS + RAISE_JITTER_MARGIN_MS;
      if (select.at < earliest) {
        const shift = earliest - select.at;
        select.at = earliest;
        // The hold that follows the park is what pays for it.
        const hold = ins[ins.indexOf(select) + 1];
        if (hold && hold.kind === 'hold') {
          // Moving a tap later must also preserve the released Fusion poll
          // after that tap. Merely shifting the hold by the same amount can
          // leave the original 17 ms seam intact, which makes the runner
          // treat the wind contact as a continuation of the camera tap.
          const oldAt = hold.at;
          const oldDuration = +hold.rest[1];
          const minAt = select.at + MIN_CONTACT_MS + FUSION_POLL_MS;
          hold.at = Math.max(oldAt + shift, minAt);
          const consumed = hold.at - oldAt;
          if (oldDuration <= consumed)
            throw new Error(`${name}: moving the camera select to +${select.at} ms leaves no ` +
              `wind contact before the next action`);
          hold.rest[1] = String(oldDuration - consumed);
        }
      }
    }
    // The wind has a LATER floor than the camera select, and the emitter did
    // not know it. A camera select works from raise+300 ms; a wind contact is
    // only observed to land from raise+434 ms, and raise+100/+200 both missed
    // outright. Until 2026-09-19 that number lived only in the compiled-plan
    // gate, so this pass could author -- and did author -- a wind the gate
    // would later refuse: minus7's clear cycle wound at raise+414 ms, and the
    // phone graded that raise MISSING on 54 of 55 cycles and the mask-off on
    // 48 of 55 (night1-minus7-n1-first-20260919T215533Z). The park above pays
    // for its own shift out of the hold; so does this one.
    const windFloor = raise.at + MONITOR_READY_WIND_MS + SEAM_MARGIN_MS;
    const wind = ins.slice(i + 1).find(e => e.kind === 'hold' && e.rest[0] === 'wind');
    if (wind && wind.at < windFloor) {
      const oldDuration = +wind.rest[1];
      const consumed = windFloor - wind.at;
      if (oldDuration <= consumed)
        throw new Error(`${name}: the wind at +${wind.at} ms must start at +${windFloor} ms to ` +
          `clear the monitor raise at +${raise.at} ms, which leaves no wind contact`);
      wind.at = windFloor;
      wind.rest[1] = String(oldDuration - consumed);
    }

    const want = select.at - (MONITOR_ANIM_UP_MS + RAISE_MARGIN_MS);
    if (raise.at <= want) continue;
    // Slide the raise and, if it runs into what precedes it, that too.
    let moving = i, target = want;
    while (moving >= 0) {
      const e = ins[moving];
      if (e.at <= target) break;
      e.at = target;
      const prev = ins[moving - 1];
      if (!prev) break;
      target = e.at - RAISE_MARGIN_MS - spanOf(prev);
      moving -= 1;
    }
    if (raise.at > want)
      throw new Error(`${name}: the raise at +${raise.at} ms cannot clear ` +
        `MONITOR_ANIM_UP before the select at +${select.at} ms without moving the ` +
        'select, and the sweep\'s end is what bridges the five-tick mask');
    if (ins.some((e, k) => k > 0 && e.at < ins[k - 1].at))
      throw new Error(`${name}: relaxing the raise reordered the cycle`);
  }
  return ins.map(e => [e.at, e.kind, ...e.rest].join(' '));
}

// Widening the sweep moves its START earlier, which eats the released time the
// instruction before it was given. Pay for that out of the wind, which is the
// only elastic thing in the cycle: the clear cycle runs a +471 ms wind margin,
// so 30-50 ms is free, while every other gap here is a device constraint.
//
// Fusion polls touch once per frame, so two different controls closer than one
// poll can read as a single finger moving between them and the second never
// fires. That is the same FUSION_POLL_MS rule test-recipe.mjs enforces; this
// keeps it true after the emitter has retimed anything.

function makeRoom(name, lines) {
  const ins = lines.map(line => {
    const [at, kind, ...rest] = line.split(' ');
    return { at: +at, kind, rest };
  });
  const endOf = e =>
    e.kind === 'tap' ? e.at + +e.rest[1] :
    e.kind === 'hold' ? e.at + +e.rest[1] :
    e.kind === 'hall' || e.kind === 'hallraise' ? e.at + +e.rest[0] :
    e.kind === 'sweep' ? e.at + sweepSpanMs(e.rest) :
    e.kind === 'read' ? e.at + +e.rest[0] + +e.rest[1] + MIN_CONTACT_MS :
    e.at + MIN_CONTACT_MS;
  for (let i = 0; i + 1 < ins.length; i++) {
    const a = ins[i], b = ins[i + 1];
    const gap = b.at - endOf(a);
    if (gap >= FUSION_POLL_MS) continue;
    if (a.kind !== 'hold')
      throw new Error(`${name}: only ${gap} ms between ${a.kind} at +${a.at} ms and ` +
        `${b.kind} at +${b.at} ms, and the earlier one is not a wind to shorten`);
    const want = +a.rest[1] - (FUSION_POLL_MS - gap);
    if (want < MIN_CONTACT_MS)
      throw new Error(`${name}: shortening the wind at +${a.at} ms to clear ${b.kind} ` +
        `at +${b.at} ms would leave ${want} ms, under the ${MIN_CONTACT_MS} ms contact floor`);
    a.rest[1] = String(want);
  }
  return ins.map(e => [e.at, e.kind, ...e.rest].join(' '));
}

// Merge the mask-off tap with the immediately following monitor raise. This
// is an actuator instruction, like `sweep`: the policy still contains the two
// sourced game inputs, while the phone receives one report stream with the
// measured-safe gap held inside it.
function foldMaskRaise(name, lines, knobs = DEFAULT_SEARCH_KNOBS) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i].split(' ');
    const next = lines[i + 1]?.split(' ');
    const isMask = cur[1] === 'tap' && cur[2] === 'mask';
    const isPlainRaise = next?.[1] === 'tap' && next[2] === 'monitor';
    const isHallRaise = next?.[1] === 'hallraise';
    if (!isMask || (!isPlainRaise && !isHallRaise)) {
      out.push(lines[i]);
      continue;
    }
    const at = +cur[0] - MASK_RAISE_SHIFT_MS;
    if (at < 0) throw new Error(`${name}: folding mask + raise starts before the cycle`);
    // Item 10: the attack cycle's mask-off + hall reset + raise sits blind
    // behind a 900 ms phase pad because the policy cannot see the game's tick
    // phase, so under jitter it can land BEFORE BB's 5th mask-tick (the
    // `onCamsUp` walk-in that PROGRESS item 10 traced) or waste the pad when he
    // left early. `bbLeave()` emits a real departure bang the instant he goes.
    // Gating the group on that bang fires it `gateMs` after the observed bang,
    // clamped near the nominal time, and drags the recovery sweep with it so
    // the toy stun-refresh stays a fixed offset behind the raise instead of
    // colliding with MONITOR_ANIM_UP (the "Withered inside-office rose"
    // regression the item-11 scratch prototype hit). Default off.
    const sweepNext = lines[i + 2]?.split(' ');
    const canBang = name === 'attack' && isHallRaise &&
      knobs.attackBangGateMs > 0 && sweepNext?.[1] === 'sweep';
    if (canBang) {
      const lateSweepOff = lines[lines.length - 1].split(' ')[0];
      out.push(`${at} maskraise ${MASK_RAISE_GAP_MS} hall ${next[2]} bang ` +
        `${knobs.attackBangGateMs} ${sweepNext[0]} ${sweepNext.slice(2).join(' ')} ${lateSweepOff}`);
      i += 2;
    } else {
      out.push(isHallRaise
        ? `${at} maskraise ${MASK_RAISE_GAP_MS} hall ${next[2]}`
        : `${at} maskraise ${MASK_RAISE_GAP_MS} up 0`);
      i++;
    }
  }
  return out;
}

// The first in-game hour on this night that needs the pilot awake at all.
//
// Two independent reasons to act, both sourced, and a night needs the earlier
// of them:
//   - a threat can act: some character's AI row has fired by this hour
//     (AI_BY_NIGHT, g673-684). A character no row ever names stays at 0.
//     The PUPPET is excluded from this test and covered by the box test
//     instead: his escape roll is gated on an EMPTY box (g494/g495, and
//     engine.js tickPuppet's `this.box <= 0`), and the box starts full at 2000
//     (g652). While it is not draining he cannot roll, however high his AI. He
//     is AI 1 from hour 0 on night 1, so testing him directly would report
//     that hour as busy and hide the whole finding.
//   - the music box is draining: g653-660. Only night 1's group is hour-gated,
//     carrying `time of the night != 12` and `!= 1`, so night 1's box does not
//     drain until 2 AM.
//
// On night 1 those coincide: the Toys arm at 2 AM (g674) and the box starts at
// 2 AM, while Foxy, BB, Mangle, the Withereds and Golden Freddy never act at
// all. So its first two in-game hours need nothing -- no sweep, no wind, no
// read. Every other night needs hour 0, because its box drains from the start.
//
// Returned in ms of night time, which is what the runner's `base` counts.
// The first hour a NON-PUPPET threat can act. This is deliberately not
// `idleUntilMs`: that one returns the EARLIER of "the box drains" and "a threat
// can act", which is the right answer to "when must the pilot be awake at all"
// and the wrong answer to "when must the full cycle start". The two coincide on
// Night 1 and diverge everywhere else, and the divergence is invisible because
// the box drains from hour 0 on every night from 2 up -- so `idleUntilMs`
// collapses to 0 and the schedule opens its full cycle against an empty
// building.
//
// Measured 2026-09-19 on the shipped Night 2 minus-toys plan: 53 contacts fall
// inside the first in-game hour, 7 of them wind, and `aiUpdates(2, 0)` arms
// nobody at all -- 46 contacts answering no one, including 14 mask presses, 7
// held camera-light flashes charged to a 3000-frame flashlight budget, and 7
// hall pulses for a Foxy who arms an hour later. Every one of them is also a
// press the phone can lose.
//
// A night's prefix is therefore `[0, threatIdleUntilMs)`, where the box still
// needs winding and nothing else needs answering.
export function threatIdleUntilMs(night) {
  for (let hour = 0; hour < 6; hour++) {
    const armed = new Set();
    for (let h = 0; h <= hour; h++)
      for (const row of C.aiUpdates(night, h))
        for (const [id, value] of Object.entries(row.set)) if (value > 0) armed.add(id);
    if ([...armed].some(id => id !== 'puppet'))
      return hour * (C.HOUR_FRAMES / C.FPS) * 1000;
  }
  return 0;
}

// How long a FULL box takes to empty, from the sourced drain table:
// BOX_UNITS units at BOX_DRAIN_PER_TICK[night] per BOX_DRAIN_TICK_MS.
export function boxEmptyFromFullMs(night) {
  const perTick = C.BOX_DRAIN_PER_TICK[String(night)];
  if (!perTick) throw new Error(`no box drain rate for night ${night}`);
  return (C.BOX_UNITS / perTick) * C.BOX_DRAIN_TICK_MS;
}

// The latest a schedule may stop winding on a full box and still not hand the
// Puppet an empty box before 6 AM.
//
// This is a BOX bound only, and it is strictly weaker than the real question.
// After the box empties the Puppet still has PUPPET_ESCAPE_STAGES stages and a
// five-position route to walk, so the true safe stop is LATER than this; and it
// says nothing about Foxy, Balloon Boy or the Withereds, whose own last-moment
// is UNKNOWN(not-derived) here. It exists because `minStopAtMs = 360000` has
// only ever been justified in a comment -- "~5:08 AM: no route can reach the
// office before 6" -- and a measurement in a comment is not a gate
// (mistake-register item 9). This turns the box half of that claim into
// something a check can read.
export function boxSafeStopMs(night) {
  return NIGHT_MS - boxEmptyFromFullMs(night);
}

export function idleUntilMs(night) {
  for (let hour = 0; hour < 6; hour++) {
    if (C.boxDrainsAtHour(night, hour)) return hour * (C.HOUR_FRAMES / C.FPS) * 1000;
    const armed = new Set();
    for (let h = 0; h <= hour; h++)
      for (const row of C.aiUpdates(night, h))
        for (const id of Object.keys(row.set)) armed.add(id);
    if ([...armed].some(id => id !== 'puppet' && C.peakAi(night, id) > 0))
      return hour * (C.HOUR_FRAMES / C.FPS) * 1000;
  }
  return 0;
}

// Push a mask-off press out of the read's mask-ON animation.
//
// `read` owns a prophylactic mask-on press that lands at at+duration+gap, and
// the maskraise that follows takes the mask off again. The engine drops input
// during the mask-on animation exactly as it does during the mask-off one, but
// only the mask-off window was ever enforced -- so this emitter authored a
// clear cycle whose mask-on press landed at +1007 ms and whose maskraise took
// it off at +1140 ms, 133 ms inside a 200 ms animation. The press was dropped,
// the mask stayed up, and every later contact in the cycle hit the mask instead
// of the office: the first minus7 device run graded maskOn->false MISSING on 48
// of 55 cycles and the raise on 54 of 55, then reached 6 AM anyway because
// nothing on Night 1 can punish a blind pilot.
function clearTheMaskOn(name, lines) {
  const ins = lines.map(line => {
    const [at, kind, ...rest] = line.split(' ');
    return { at: +at, kind, rest };
  });
  let maskOnAt = -Infinity;
  for (const e of ins) {
    if (e.kind === 'read') { maskOnAt = e.at + (+e.rest[0]) + (+e.rest[1]); continue; }
    if (e.kind !== 'maskraise') continue;
    const earliest = maskOnAt + MASK_ANIM_ON_MS + SEAM_MARGIN_MS;
    if (e.at >= earliest) continue;
    const next = ins[ins.indexOf(e) + 1];
    if (next && next.at < earliest + MIN_CONTACT_MS + FUSION_POLL_MS)
      throw new Error(`${name}: the maskraise at +${e.at} ms must wait until +${earliest} ms to ` +
        `clear the read's mask-on animation, which collides with the next row at +${next.at} ms`);
    e.at = earliest;

    // Moving the maskraise moves the raise inside it, which invalidates the
    // wind that clearTheRaise() already placed against the OLD raise. That
    // pass cannot be re-run here -- after folding, the raise lives inside a
    // maskraise compound and its `tap monitor` row no longer exists -- so this
    // one re-pays the same floor, out of the hold, exactly as clearTheRaise
    // does for the park it moves.
    const raiseAt = e.at + (+e.rest[0]);
    // The camera park first, on the same floor clearTheRaise() uses, then the
    // wind on its own later one. Both are paid for out of the wind hold.
    const park = ins.slice(ins.indexOf(e) + 1)
      .find(row => row.kind === 'tap' && /^cam\d+$/.test(row.rest[0]));
    if (park) park.at = Math.max(park.at, raiseAt + MONITOR_ANIM_UP_MS + RAISE_JITTER_MARGIN_MS);
    const windFloor = Math.max(raiseAt + MONITOR_READY_WIND_MS + SEAM_MARGIN_MS,
      park ? park.at + MIN_CONTACT_MS + FUSION_POLL_MS : 0);
    const wind = ins.slice(ins.indexOf(e) + 1)
      .find(row => row.kind === 'hold' && row.rest[0] === 'wind');
    if (wind && wind.at < windFloor) {
      const oldDuration = +wind.rest[1];
      const consumed = windFloor - wind.at;
      if (oldDuration <= consumed)
        throw new Error(`${name}: moving the maskraise to +${e.at} ms pushes the wind to ` +
          `+${windFloor} ms, which leaves no wind contact`);
      wind.at = windFloor;
      wind.rest[1] = String(oldDuration - consumed);
    }
  }
  return ins.map(e => `${e.at} ${e.kind} ${e.rest.join(' ')}`);
}

export function devicePlan(recipe, {
  deviceSpacingMs = DEVICE_SPACING_MS,
  sweepContactMs = SWEEP_SELECT_MS,
  sweepLastContactMs = null,
  tapContactMs = MIN_CONTACT_MS,
  knobs = recipe.options?.knobs,
} = {}) {
  const resolvedKnobs = makeSearchKnobs(knobs);
  // The actuator's inter-contact spacing. DEVICE_SPACING_MS (100) is the
  // tightest spacing accepted cleanly in the current Perfetto/camtrace probe;
  // plan 16's simulator search below it remains exploratory, not a device
  // qualification.
  //
  // `sweepContactMs` is the select's own contact length. It defaults to
  // SWEEP_SELECT_MS (33), measured on every touch control. A base contact below
  // 50 ms selects the LIGHT_AFTER path, which decouples camera Click from the
  // light press and is required for the 33 ms camera geometry.
  //
  // `sweepLastContactMs`, when set, lengthens only the final slot's light hold.
  // The sweep's last camera lands most drift-delayed (its start floats while
  // its end is anchored), so a short light there arrives after its target has
  // taken the 5 s move -- the Toy Chica escape traced in ON-DEVICE-VALIDATION.md
  // "The LIGHT_AFTER geometry's CAM 07, traced". 67 ms closes it in the model.
  const spacing = deviceSpacingMs;
  if (!(tapContactMs > 0))
    throw new Error(`tap contact ${tapContactMs} ms must be > 0`);
  if (!(sweepContactMs > 0) || sweepContactMs >= spacing)
    throw new Error(`sweep contact ${sweepContactMs} ms must be > 0 and < the ${spacing} ms spacing`);
  // The last slot has no select after it, so its light hold is not bound by the
  // spacing the way the others are -- only by staying positive and not pushing
  // the anchored sweep start before the cycle (checked below). It must not,
  // though, be *shorter* than the base: the point is a longer last flash.
  if (sweepLastContactMs != null &&
      (!(sweepLastContactMs > 0) || sweepLastContactMs < sweepContactMs))
    throw new Error(`sweep last-slot contact ${sweepLastContactMs} ms must be > 0 and ` +
      `>= the ${sweepContactMs} ms base contact`);
  const lastContact = sweepLastContactMs == null ? sweepContactMs : sweepLastContactMs;
  const out = {};
  for (const [name, cycle] of Object.entries(recipe.cycles)) {
    const lines = [];
    const ev = (cycle as any).events;
    const skip = new Set();
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (skip.has(e)) continue;
      if (e.act === 'camlight') continue;            // merged into its select
      if (/^cam(10|4|7)$/.test(e.act)) {
        const cams = [];
        const ats = [];
        let j = i;
        while (j < ev.length && /^cam(10|4|7)$/.test(ev[j].act)) {
          cams.push(ev[j].act.slice(3));
          ats.push(ev[j].at);
          j += ev[j + 1] && ev[j + 1].act === 'camlight' ? 2 : 1;
        }
        // Spacing comes from this sweep's own selects. Looking the camera up
        // by name found the first one in the cycle instead, which produced a
        // negative spacing on a second sweep.
        const modelled = ats.length > 1 ? ats[1] - ats[0] : spacing;
        // The emitted spacing is the ACTUATOR's, and either end could move:
        // the model quantises to MODEL_SLOT_MS and the phone may need wider
        // (the withdrawn 133 ms geometry) or -- since the LIGHT_AFTER
        // breakthrough (plans/17) -- much NARROWER. Either way the sweep END
        // is anchored to the model's, because that end is the stun bridge
        // across the five-tick mask and HID-MULTITOUCH.md records one frame of
        // tail costing 272 of 400 nights. A narrower sweep just starts LATER,
        // which is strictly more free time before it -- the guard is only that
        // the start stays inside the cycle.
        void modelled;
        const modelledEnd = ats[ats.length - 1] + MIN_CONTACT_MS;
        // The last camera costs its full per-camera time, not just the emitted
        // contact -- a LIGHT_AFTER select+settle+light is 67 ms where `contact`
        // alone is 33, and a lengthened last slot costs still more. Its
        // geometry follows the base contact, not its own length. Anchor the END
        // to the model's using the real span.
        const la = sweepContactMs < 50;
        const deviceSpan = (cams.length - 1) * spacing + sweepCamMs(lastContact, la);
        const start = modelledEnd - deviceSpan;
        if (start < 0)
          throw new Error(`widening the sweep to ${spacing} ms starts it ` +
            `at ${start} ms, before the cycle begins`);
        const camsToken = lastContact === sweepContactMs
          ? cams.join(',')
          : [...cams.slice(0, -1), `${cams[cams.length - 1]}:${lastContact}`].join(',');
        lines.push(`${start} sweep ${spacing} ${sweepContactMs} ${camsToken}`);
        i = j - 1;
        continue;
      }
      if (e.act === 'hall') {
        const twin = ev.find(x => x.act === 'monitor' && x.at === e.at);
        lines.push(`${e.at} ${twin ? 'hallraise' : 'hall'} ${e.dur}`);
        continue;
      }
      if (e.act === 'monitor' && ev.some(x => x.act === 'hall' && x.at === e.at)) continue;
      if (e.act === 'ventl') {
        // The runner performs the read and the prophylactic mask as one step:
        // it releases the vent light the instant the capture latches and
        // presses the mask 40 ms later, one Fusion poll, so the game sees an
        // unpressed frame between two different buttons. The plan says so,
        // rather than listing a mask the schedule does not separately time.
        const mask = ev.find(x => x.act === 'mask' && x.at >= e.at);
        if (mask) skip.add(mask);
        // Package 4's permitted decoupling geometry puts one hall pulse while
        // the left-opening light is held.  The two controls are independent
        // contacts, so make it an explicit compound read row instead of
        // letting makeRoom incorrectly serialize it behind the read.  This
        // is analogous to hallraise: one measured gesture with two contacts.
        const hall = ev.find(x => x.act === 'hall' && x.at > e.at &&
          x.at < e.at + e.dur);
        if (hall) {
          skip.add(hall);
          const condition = resolvedKnobs.bangAgeFrames > 0
            ? ` bangage ${resolvedKnobs.bangAgeFrames}` : '';
          lines.push(`${e.at} read ${e.dur} ${MASK_GAP_MS} ${hall.at - e.at} ${hall.dur}${condition}`);
        } else lines.push(`${e.at} read ${e.dur} ${MASK_GAP_MS}`);
        continue;
      }
      if (e.act === 'wind') { lines.push(`${e.at} hold wind ${e.dur}`); continue; }
      lines.push(`${e.at} tap ${e.act} ${tapContactMs}`);
    }
    out[name] = clearTheMaskOn(name,
      foldMaskRaise(name, makeRoom(name, clearTheRaise(name, lines)), resolvedKnobs));
  }
  return out;
}

// Feed the device plan back through the engine.
//
// The plan is generated from the simulator, so it is tempting to trust it --
// but "generated" only means the emitter ran, not that it emitted the policy.
// An emitter bug (a sweep whose spacing was looked up by camera name and found
// the wrong one) or a hand edit to the plan would both survive every check
// that reads the recipe, because they all read the same side of the loop.
// This runs the plan itself, instruction by instruction, and asks the engine
// whether the night still survives.
// `night` is required. It defaulted to 6 while Night 6 was the only route the
// device could run; a default here silently prices a Night 3 plan against
// Night 6's AI table, which is the exact substitution plans/13's identity
// contract forbids.
export function replay(plan, { night, seed = 1, worst = false,
                               pilotOffset = 10, readLatencyMs = 550,
                               classifyMs = 250, idleUntilMs = 0,
                               attackWindowMs = 10000,
                               // Item 10 control: how long after the game emits
                               // a departure thud before the pilot can act on
                               // it. 0 = a perfect instant oracle (not a
                               // phone). `bbOnlyBang` = ignore non-BB vent
                               // departures (a phone's mic cannot tell them
                               // apart -- all use THUD_SAMPLE).
                               bangLatencyMs = 0, bbOnlyBang = false }: any = {}) {
  if (night === undefined) throw new Error('replay() needs the night the plan was built for');
  const sim = new Sim({ seed, night, worst });
  const f = msv => Math.round(msv * C.FPS / 1000);
  const queue = [];
  const at = (frame, kind, act) => queue.push([frame, queue.length, kind, act]);

  const parse = (lines, base, floor = -Infinity) => {
    // A classifier-selected branch is emitted after the read has completed.
    // If its nominal first row is already due, the device runner floors the
    // whole macro to the result plus one released Fusion poll. Applying that
    // same shift here preserves the internal mask-off/raise gap; queueing only
    // the overdue first press would compress the gap and drop the raise on the
    // still-visible mask animation.
    const firstAt = lines.length ? base + f(+lines[0].split(' ')[0]) : base;
    const shift = Math.max(0, floor - firstAt);
    for (const line of lines) {
      const [offs, kind, ...rest] = line.split(' ');
      const t = base + f(+offs) + shift;
      if (kind === 'tap') {
        at(t, 'press', rest[0] === 'monitor' ? 'monitor' : rest[0] === 'mask' ? 'mask'
          : 'cam:' + rest[0].slice(3));
      } else if (kind === 'hold') {
        at(t, 'press', 'wind'); at(t + f(+rest[1]), 'release', 'wind');
      } else if (kind === 'hall' || kind === 'hallraise') {
        at(t, 'press', 'light'); at(t + f(+rest[0]), 'release', 'light');
        if (kind === 'hallraise') at(t, 'press', 'monitor');
      } else if (kind === 'maskraise') {
        const [gap, mode, duration] = rest;
        if (rest[3] === 'bang') {
          // Item 10: fire the attack cycle's mask-off/reset/raise group
          // `gateMs` after the observed BB departure bang -- earlier than the
          // blind nominal time when he left early, later when jitter pushed the
          // 5th tick past it (the walk-in PROGRESS item 10 traced). A hard cap
          // (maxDelay) past nominal is the fallback if no qualifying bang ever
          // arrives. `base` is this branch's own anchor so a stale bang from
          // the previous cycle does not count.
          //
          // rest = [gap, hall, dur, 'bang', gateMs, sweepOff, spacing, contact,
          //         cams, lateSweepOff]  (the recovery sweep folded in so it
          //         can be dragged with the raise). One 'bangraise' entry that
          //         re-pushes itself every 2 frames until it fires -- safe
          //         because the queue drain sorts before testing its head.
          const d = { nominalT: t, gap: f(+gap),
            dur: mode === 'hall' ? f(+duration) : 0, hall: mode === 'hall',
            gateFrames: f(+rest[4]), base, fired: false, maxDelay: f(400),
            sweepRel: f(+rest[5]) - f(+offs), spacing: +rest[6],
            contact: +rest[7], cams: rest[8],
            sweepCap: base + f(+rest[9]) - f(500) };
          at(t - f(1400), 'bangraise', d);
        } else {
          at(t, 'press', 'mask');
          if (mode === 'hall') {
            at(t + f(+gap), 'press', 'light');
            at(t + f(+gap) + f(+duration), 'release', 'light');
          }
          at(t + f(+gap), 'press', 'monitor');
        }
      } else if (kind === 'sweep') {
        const [spacing, contact, cams] = rest;
        // LIGHT_AFTER: the select's Click writes `viewing` on release, then the
        // light presses on the settled feed. In the engine that is press cam:N,
        // then press light one select+settle later, held the emitted contact.
        // The geometry follows the base contact; `10,4,7:67` lengthens only the
        // last slot's light hold (the drift-exposed slot).
        const la = +contact < 50;
        const lightGap = la ? f(LA_SELECT_MS + LA_SETTLE_MS) : 1;
        const { cams: camList, contacts } = sweepCams(cams, +contact);
        camList.forEach((n, i) => {
          const st = t + f(i * +spacing);
          const lightHold = la ? f(contacts[i]) : f(MIN_CONTACT_MS);
          at(st, 'press', 'cam:' + n);
          at(st + lightGap, 'press', 'light');
          at(st + lightGap + lightHold, 'release', 'light');
        });
      } else if (kind === 'read') {
        const [duration, gap, hallAt, hallDuration, hallMode, hallAge] = rest;
        at(t, 'press', 'ventL');
        at(t + f(+duration), 'release', 'ventL');
        // The read owns the prophylactic mask-on press. Its release-to-press
        // gap is the phone's measured one-frame acceptance boundary.
        at(t + f(+duration) + f(+gap), 'press', 'mask');
        if (hallAt !== undefined) {
          if (hallMode === 'bangage')
            at(t + f(+hallAt), 'recent-hall', { age: +hallAge, duration: +hallDuration });
          else {
            at(t + f(+hallAt), 'press', 'light');
            at(t + f(+hallAt) + f(+hallDuration), 'release', 'light');
          }
        }
        at(t + f(readLatencyMs), 'snapshot', base);
      } else throw new Error(`unknown instruction ${kind}`);
    }
  };

  // The opening, then a steady cycle whose kind the read chooses -- exactly
  // the branch the phone makes.
  // Nothing is scheduled before idleUntilMs: on a night whose threats are not
  // armed and whose box is not draining, the pilot has nothing to answer, so
  // the engine simply runs the game. See idleUntilMs() for how it is derived.
  // The sim still ticks through it, so the box, the AI table and every roll
  // advance exactly as they would have -- the idle is priced, not skipped.
  const start = pilotOffset + f(idleUntilMs);
  parse(plan.opening, start);
  let base = start + f(7000);
  let pending = null;
  parse(plan.clear.slice(0, 2), base);      // the shared prefix, up to the read
  let missed = 0, detections = 0;
  let eventCursor = 0, lastDepartureBang = -Infinity;

  while (sim.alive && !sim.won) {
    while (eventCursor < sim.events.length) {
      const event = sim.events[eventCursor++];
      if (event.type === 'vent-bang' && event.data?.leaving &&
          (!bbOnlyBang || event.data.who === 'bb'))
        lastDepartureBang = event.f + f(bangLatencyMs);
    }
    // Sort BEFORE testing the head: entries pushed at runtime (recent-hall's
    // release, item 10's bangraise group) land at the array tail, and a raw
    // `queue[0][0]` test can be a far-future entry that keeps the loop from
    // ever draining them -- they then fire whenever some later entry happens
    // to re-enter this loop, tens of frames late. Nothing pushed at parse time
    // is affected (it is all sorted together on the first drain).
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (queue[0][0] > sim.frame) break;
      const [, , kind, act] = queue.shift();
      if (kind === 'press') sim.press(act);
      else if (kind === 'release') sim.release(act);
      else if (kind === 'recent-hall') {
        // This is the permitted policy state, not an optimizer-invented
        // history rule: only the age of an observed departure bang chooses
        // whether the pre-read reset fires.
        if (sim.frame - lastDepartureBang < act.age) {
          sim.press('light');
          at(sim.frame + f(act.duration), 'release', 'light');
        }
      }
      else if (kind === 'bangraise') {
        const d = act;
        if (!d.fired) {
          const bangReady = lastDepartureBang > d.base &&
            sim.frame >= lastDepartureBang + d.gateFrames;
          // Fire on the bang (+gate), earlier or later than nominal; a hard cap
          // past nominal is the fallback if no qualifying bang ever arrives.
          if (bangReady || sim.frame >= d.nominalT + d.maxDelay) {
            d.fired = true;
            const ft = sim.frame;
            at(ft, 'press', 'mask');
            if (d.hall) {
              at(ft + d.gap, 'press', 'light');
              at(ft + d.gap + d.dur, 'release', 'light');
            }
            at(ft + d.gap, 'press', 'monitor');
            // Drag the recovery sweep with the raise (fixed offset behind it),
            // but never past its cycle-end stun-bridge pin.
            const sweepAt = Math.min(d.sweepCap, ft + d.sweepRel);
            const la = d.contact < 50;
            const lightGap = la ? f(LA_SELECT_MS + LA_SETTLE_MS) : 1;
            const { cams: camList, contacts } = sweepCams(d.cams, d.contact);
            camList.forEach((n, i) => {
              const st = sweepAt + f(i * d.spacing);
              const lightHold = la ? f(contacts[i]) : f(MIN_CONTACT_MS);
              at(st, 'press', 'cam:' + n);
              at(st + lightGap, 'press', 'light');
              at(st + lightGap + lightHold, 'release', 'light');
            });
          } else {
            at(sim.frame + 2, 'bangraise', d);   // check again in ~33 ms
          }
        }
      }
      else if (kind === 'snapshot') {
        pending = { base: act, bb: sim.bb.inOpening, inside: sim.bb.inside,
                    resolveAt: sim.frame + f(classifyMs) };
      }
    }
    if (pending && sim.frame >= pending.resolveAt) {
      const { base: b, bb, inside } = pending;
      pending = null;
      if (!bb && inside) missed++;
      if (bb) detections++;
      const lines = bb ? plan.attack : plan.clear;
      parse(lines.slice(2), b, sim.frame + f(FUSION_POLL_MS)); // branch after the read
      base = b + f(bb ? attackWindowMs : 5000);
      parse(plan.clear.slice(0, 2), base);
    }
    sim.tick();
  }
  return { sim, missed, detections };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name, def) => {
    const v = (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
    return v === undefined ? def : +v;
  };
  const argOpt = (name) => {
    const v = (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
    return v === undefined ? null : +v;
  };
  const recipe = build({
    night: arg('night', 6), sweepSlotMs: arg('slot-ms', MODEL_SLOT_MS),
    maskMarginMs: arg('mask-margin-ms', 900), readLatencyMs: arg('read-latency-ms', 550),
    hallPulseMs: arg('hall-pulse-ms', 130), pilotOffset: arg('offset-frames', 10),
  });
  if (process.argv.includes('--device-plan')) {
    // `--device-spacing-ms` emits the three-camera sweep at a spacing other
    // than the active DEVICE_SPACING_MS (100). It exists for the
    // perfect-experiment path (`plans/17`) and simulator geometry searches.
    // Unset = the current 100 ms device geometry.
    //
    // `--sweep-last-contact-ms` lengthens only the final slot's light hold --
    // the drift-exposed slot where Toy Chica leaks (ON-DEVICE-VALIDATION.md).
    // Unset = uniform.
    const plan = devicePlan(recipe, {
      deviceSpacingMs: arg('device-spacing-ms', DEVICE_SPACING_MS),
      sweepContactMs: arg('sweep-contact-ms', SWEEP_SELECT_MS),
      sweepLastContactMs: argOpt('sweep-last-contact-ms'),
      tapContactMs: arg('tap-contact-ms', MIN_CONTACT_MS),
    });
    // The plan names its own night, so the model gate prices it against the
    // AI table it was built for instead of assuming 6. The header precedes
    // every `#cycle`, which is why the runner's parsers skip it: they only
    // read rows once a matching `#cycle` has opened.
    console.log(`#night ${recipe.night}`);
    // Emitted even when zero, so a plan always states its answer rather than
    // leaving the runner to infer one. A missing header would be
    // indistinguishable from a night nobody priced.
    console.log(`#idle-until ${idleUntilMs(recipe.night)}`);
    for (const [name, lines] of Object.entries(plan)) {
      console.log(`#cycle ${name} ${recipe.cycles[name].lengthMs}`);
      for (const line of lines) console.log(line);
    }
  } else if (process.argv.includes('--track')) {
    for (const [name, c] of Object.entries(recipe.cycles)) {
      console.log(`// ${name}`);
      for (const step of track(c)) console.log('  ' + JSON.stringify(step) + ',');
    }
  } else if (process.argv.includes('--json')) {
    console.log(JSON.stringify(recipe, null, 2));
  } else {
    console.log(`power ${recipe.powerFramesSpentIfAllClear}/${recipe.powerFramesAvailable} frames if every cycle is a clear`);
    for (const [name, c] of Object.entries(recipe.cycles)) {
      const b = (c as any).budget;
      console.log(`\n${name}  ${b.lengthMs} ms` +
        `  lit ${b.litMs} ms  wind ${b.windMs}/${b.windBreakEvenMs} ms (${b.windMarginMs >= 0 ? '+' : ''}${b.windMarginMs})` +
        `  sweep span ${b.sweepSpanMs} ms  spacing ${b.maxSpacingMs} ms  shortest contact ${b.minContactMs} ms`);
      for (const e of c.events)
        console.log(`  +${String(e.at).padStart(6)} ms  ${e.act.padEnd(9)} ${e.dur} ms${e.tap ? ' (tap)' : ''}`);
    }
  }
}
