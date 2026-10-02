// Gate for the device pilot's cycle recipes. No phone required.
//
// This exists because the same class of bug reached the phone three times: a
// duration that is correct as simulator frames and wrong as an Android
// contact. The simulator counts frames of light, so 83 ms is five frames and
// perfectly valid there; on the phone Fusion polls touch per frame and a
// graded run that scheduled ten 83 ms hall pulses produced zero visible beams.
// Nothing caught it, because nothing checked the stream the runner emits.
import { build, track, devicePlan, replay, MIN_CONTACT_MS, DEVICE_SPACING_MS,
         MODEL_SLOT_MS, FUSION_POLL_MS, MASK_RAISE_GAP_MS, SWEEP_SELECT_MS, LA_SELECT_MS, LA_SETTLE_MS,
         SWEEP_RELEASED_MS, sweepCamMs, sweepCams, sweepSpanMs } from '../bin/plans/recipe.ts';
import { MIN_RELEASED_MS } from './test-hid-trace.ts';

/** A device-plan line split into its offset, its instruction and the instruction's fields. */
interface PlanInstruction { at: number, kind: string, rest: string[] }

const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// These are the options `tools/test.ts --engine` pins as `hidpilot n6 target`
// (3000/3000 ordinary, 3000/3000 pinned-worst). The recipe must be built from
// the policy that was actually verified, not a neighbouring one.
const PINNED = { night: 6, sweepSlotMs: MODEL_SLOT_MS, maskMarginMs: 900, pilotOffset: 10 };
const recipe = build({ ...PINNED, readLatencyMs: 550, hallPulseMs: 130 });
// Object.entries(PINNED) yields PINNED's own keys.
for (const [key, want] of Object.entries(PINNED))
  check(recipe.options[key as keyof typeof PINNED] === want,
    `recipe option ${key} is ${recipe.options[key as keyof typeof PINNED]}, but the verified contract pins ${want}`);
check(recipe.options.deviceSweep && recipe.options.pulseLight,
  'the device recipe must use the device sweep and the pulsed light');
check(recipe.options.prophylacticMask,
  'the device recipe must clear Golden Freddy with the prophylactic mask');

for (const [name, cycle] of Object.entries(recipe.cycles)) {
  const b = cycle.budget;

  // The regression that motivated this file.
  check(b.minContactMs >= MIN_CONTACT_MS,
    `${name}: shortest contact is ${b.minContactMs} ms, below the phone's ` +
    `${MIN_CONTACT_MS} ms floor -- Fusion polls touch per frame and drops it`);
  for (const e of cycle.events)
    check(e.dur >= MIN_CONTACT_MS,
      `${name}: ${e.act} at +${e.at} ms is a ${e.dur} ms contact`);

  // This is the model recipe, before devicePlan widens its actuator slots while
  // preserving the sweep end. It must remain the policy the model gate priced.
  check(b.maxSpacingMs <= MODEL_SLOT_MS,
    `${name}: ${b.maxSpacingMs} ms model spacing exceeds the ${MODEL_SLOT_MS} ms policy slot`);

  // Every cycle must reach the hall, or Foxy's D never resets. The run that
  // motivated this gate flashed the hall zero times in 71 seconds.
  const hall = cycle.events.filter(e => e.act === 'hall');
  if (name !== 'opening')
    check(hall.length >= 1, `${name}: no hall flash, so nothing resets Foxy`);
  for (const e of hall)
    check(e.dur >= MIN_CONTACT_MS, `${name}: ${e.dur} ms hall flash will be dropped`);
}

// The monitor/mask polarity invariants. These are asserted rather than
// re-derived because getting them wrong is this project's most repeated bug:
// the pilot's whole `--sync` branch exists because a bare monitor toggle
// raised the cams into a waiting Golden Freddy instead of lowering them.
// Recipes now carry the state the engine reached, so the check is real.
for (const [name, cycle] of Object.entries(recipe.cycles)) {
  const monitors = cycle.events.filter(e => e.act === 'monitor');
  const masks = cycle.events.filter(e => e.act === 'mask');
  for (const e of [...monitors, ...masks])
    check(e.want, `${name}: ${e.act} at +${e.at} ms carries no intended state`);

  // The night opens in the office, so the opening raises first. Every steady
  // cycle is entered cams-up from the previous cycle's late sweep, so it
  // lowers first. Stating both is the point: the two differ, and assuming one
  // shape for both is exactly how the polarity gets inverted.
  const entersCamsUp = name !== 'opening';
  check(monitors[0]?.want === (entersCamsUp ? 'down' : 'up'),
    `${name}: the first monitor press wants ${monitors[0]?.want}, but this ` +
    `cycle is entered cams-${entersCamsUp ? 'up' : 'down'}`);
  check(cycle.events[cycle.events.length - 1].camsUp,
    `${name}: does not end cams-up, so the next cycle's first press will invert`);
  for (let i = 1; i < monitors.length; i++)
    check(monitors[i].want !== monitors[i - 1].want,
      `${name}: two consecutive monitor presses both want ${monitors[i].want}`);
  for (let i = 1; i < masks.length; i++)
    check(masks[i].want !== masks[i - 1].want,
      `${name}: two consecutive mask presses both want ${masks[i].want}`);

  // States the game cannot reach, and the reads that depend on the monitor.
  for (const e of masks)
    check(!e.camsUp, `${name}: mask pressed at +${e.at} ms with the cams up, ` +
      'which g75/g84 make unreachable');
  for (const e of cycle.events.filter(e => e.act === 'ventl' || e.act === 'hall'))
    check(!e.camsUp,
      `${name}: ${e.act} at +${e.at} ms needs the cams down to be the office light`);
  for (const e of cycle.events.filter(e => /^cam\d/.test(e.act) || e.act === 'camlight'))
    check(e.camsUp, `${name}: ${e.act} at +${e.at} ms needs the cams up`);
}

// The box: a clear cycle has to wind more than it drains, and a BB response is
// allowed to run a deficit because it is rare and bounded.
check(recipe.cycles.clear.budget.windMarginMs > 0,
  `a clear cycle winds ${recipe.cycles.clear.budget.windMs} ms against a ` +
  `${recipe.cycles.clear.budget.windBreakEvenMs} ms break-even`);
check(recipe.cycles.attack.budget.windMarginMs > -600,
  'a BB response drains more box than one clear cycle can recover');

// The flashlight: night 6 is 3000 frames and a held sweep alone outspends it.
check(recipe.powerFramesSpentIfAllClear < recipe.powerFramesAvailable,
  `a night of clear cycles spends ${recipe.powerFramesSpentIfAllClear} of ` +
  `${recipe.powerFramesAvailable} flashlight frames`);

// The track is how a human reads the same recipe, so it must not silently
// drop actions the phone performs.
for (const [name, cycle] of Object.entries(recipe.cycles)) {
  const steps = track(cycle);
  const nonLight = cycle.events.filter(e => e.act !== 'camlight').length;
  check(steps.length === nonLight,
    `${name}: track renders ${steps.length} steps for ${nonLight} actions`);
  // Round-trip, not re-derivation: the track must carry the same intended
  // states the engine reported, in the same order.
  for (const act of ['monitor', 'mask']) {
    const want = cycle.events.filter(e => e.act === act).map(e => e.want).join(',');
    const got = steps.filter(s => s.action === act).map(s => s.want).join(',');
    check(want === got, `${name}: track ${act} states are ${got}, recipe says ${want}`);
  }
}

// The device plan is what the phone executes, so it gets the same scrutiny as
// the recipe it comes from -- including every sweep, not just the first.
const plan = devicePlan(recipe);
check(SWEEP_SELECT_MS === MIN_CONTACT_MS,
  `the sweep select is ${SWEEP_SELECT_MS} ms, not the ${MIN_CONTACT_MS} ms contact floor`);
check(SWEEP_RELEASED_MS >= FUSION_POLL_MS,
  `the sweep releases for ${SWEEP_RELEASED_MS} ms, below one ${FUSION_POLL_MS} ms Fusion poll`);
const clearMaskRaise = plan.clear.find(line => line.includes(' maskraise '));
check(clearMaskRaise?.split(' ')[3] === 'hall',
  `the post-read clear raise must carry its first Foxy reset, got "${clearMaskRaise}"`);
check(+(clearMaskRaise as string).split(' ')[4] >= MIN_CONTACT_MS, // the check above found it
  `the post-read Foxy reset is under the ${MIN_CONTACT_MS} ms contact floor`);

for (const [name, lines] of Object.entries(plan)) {
  let sweeps = 0;
  for (const line of lines) {
    const [at, kind, ...rest] = line.split(' ');
    check(Number.isInteger(+at) && +at >= 0, `${name}: bad offset in "${line}"`);
    if (kind === 'sweep') {
      sweeps++;
      const [spacing, contact, cams] = rest;
      check(+spacing === DEVICE_SPACING_MS,
        `${name}: sweep spacing ${spacing} ms is not the ${DEVICE_SPACING_MS} ms device geometry`);
      check(+contact === SWEEP_SELECT_MS,
        `${name}: sweep contact ${contact} ms is not the ${SWEEP_SELECT_MS} ms device geometry`);
      check(+spacing - +contact >= FUSION_POLL_MS,
        `${name}: sweep releases for ${+spacing - +contact} ms, below one Fusion poll`);
      check(cams === '10,4,7', `${name}: sweep covers ${cams}, not Minus 7's 10,4,7`);
    } else if (kind === 'tap' || kind === 'hold') {
      check(+rest[1] >= MIN_CONTACT_MS, `${name}: "${line}" is under the contact floor`);
    } else if (kind === 'hall' || kind === 'hallraise') {
      check(+rest[0] >= MIN_CONTACT_MS, `${name}: "${line}" is under the contact floor`);
    } else if (kind === 'maskraise') {
      const [gap, mode, duration] = rest;
      check(+gap >= MASK_RAISE_GAP_MS,
        `${name}: maskraise puts the monitor ${gap} ms after the mask; sourced ` +
        `mask-off completion plus one Fusion poll requires ${MASK_RAISE_GAP_MS} ms`);
      check(mode === 'up' || mode === 'hall', `${name}: unknown maskraise mode "${mode}"`);
      if (mode === 'hall')
        check(+duration >= MIN_CONTACT_MS, `${name}: maskraise hall contact is under the floor`);
    } else {
      check(kind === 'read', `${name}: unknown device instruction "${kind}"`);
      check(+rest[1] >= 33,
        `${name}: the read leaves ${rest[1]} ms between the vent light and the ` +
        'mask; one 30 Hz Fusion poll is 33 ms and a lost mask press sticks the ' +
        'mask on, which blinds every later read');
      if (rest.length > 2) {
        check(rest.length === 4 || rest.length === 6,
          `${name}: read compound must carry hall offset/duration and optional condition together`);
        check(+rest[2] > 0 && +rest[2] < +rest[0],
          `${name}: read hall offset ${rest[2]} is outside the held vent-light window`);
        check(+rest[3] >= MIN_CONTACT_MS,
          `${name}: read hall contact ${rest[3]} is under the contact floor`);
        if (rest.length === 6)
          check(rest[4] === 'bangage' && Number.isInteger(+rest[5]) && +rest[5] > 0,
            `${name}: read's cross-cycle condition is malformed`);
      }
    }
  }
  check(sweeps >= 1, `${name}: no camera sweep, so nothing refreshes the stalls`);

  // No two contacts at different controls may abut. Fusion polls touch once
  // per frame, so a release and a press inside one 33 ms poll can read as a
  // single finger moving between two buttons, and the second button never
  // fires. A recorded run measured 0 ms between the WIND release and the
  // CAM 10 press, and 0 ms between the hall pulse and the monitor raise it
  // was supposed to precede.
  const span = (e: PlanInstruction) => {
    if (e.kind === 'sweep') return [e.at, e.at + sweepSpanMs(e.rest)];
    // A read owns its prophylactic mask: light, released gap, mask contact.
    if (e.kind === 'read') return [e.at, e.at + +e.rest[0] + +e.rest[1] + MIN_CONTACT_MS];
    if (e.kind === 'maskraise')
      return [e.at, e.at + +e.rest[0] + (e.rest[1] === 'hall' ? +e.rest[2] : MIN_CONTACT_MS)];
    if (e.kind === 'hold') return [e.at, e.at + +e.rest[1]];
    return [e.at, e.at + +e.rest[e.rest.length - 1]];
  };
  const control = (e: PlanInstruction) => e.kind === 'tap' || e.kind === 'hold' ? e.rest[0] : e.kind;
  const acts = lines.map(l => l.split(' '))
    .map(([at, kind, ...rest]) => ({ at: +at, kind, rest }))
    .sort((a, b) => a.at - b.at);
  for (let i = 1; i < acts.length; i++) {
    // hallraise deliberately taps the monitor on a second contact while the
    // hall light is held; that is one gesture, not two buttons in sequence.
    if (acts[i - 1].kind === 'hallraise' || acts[i].kind === 'hallraise') continue;
    if (control(acts[i - 1]) === control(acts[i])) continue;
    const released = acts[i].at - span(acts[i - 1])[1];
    check(released >= 33,
      `${name}: only ${released} ms between ${control(acts[i - 1])} ending ` +
      `+${span(acts[i - 1])[1]} ms and ${control(acts[i])} at +${acts[i].at} ms; ` +
      'one 30 Hz Fusion poll is 33 ms');
  }

  // Sweeps follow a wind hold, and the phone needs released time between the
  // two. A recorded run's own HID trace measured 0 ms between the WIND release
  // and the CAM 10 press: Fusion polls touch per frame, so that reads as one
  // finger dragging from the wind button onto the camera, and the sweep's
  // first select is the one that disappears.
  const timed = lines.map(l => l.split(' ')).map(([at, kind, ...rest]) => ({ at: +at, kind, rest }));
  for (const sweep of timed.filter(e => e.kind === 'sweep')) {
    const wind = timed.filter(e => e.kind === 'hold' && e.rest[0] === 'wind' && e.at < sweep.at).pop();
    if (!wind) continue;
    const released = sweep.at - (wind.at + +wind.rest[1]);
    check(released >= 33,
      `${name}: only ${released} ms between the wind release and the sweep at ` +
      `+${sweep.at} ms; one 30 Hz Fusion poll is 33 ms`);
  }
}

// The cycle seam.
//
// Every released-time check above measures *within* one cycle. This pair
// straddles two: both steady cycles' sweeps finish exactly on their nominal
// boundary, so the plan alone has no released time before the next anchor.
// The runner deliberately waits one Fusion poll after the macro's derived end
// before it writes that anchor (asserted in test-runner-plan.mjs and exercised
// in test-plan-interpreter.sh). The wait is relative to `rm_shift`, so a late
// macro moves the boundary with it instead of accumulating compression.
//
// Before that runner compensation existed, one lost press cost nights 6-22 to
// 6-24: the cams stayed up, the monitor toggle desynced permanently, and the
// box emptied. Cycle 1 stayed clean because the opening ends 200 ms clear of
// its anchor. Keep checking the delivered seam here, but do not mistake the
// nominal plan clock for the runner's later wall-clock delivery; the trace
// auditor made exactly that mistake and its zero-gap finding was retracted.
//
// The sweep is deliberately not moved earlier: HID-MULTITOUCH.md records that
// one frame of tail costs 272 of 400 nights, because that stun has to bridge
// the five-tick mask with nothing to spare. The runner instead delays the next
// anchor, spending phase-window slack. This asserts both that the overrun stays
// small enough for that to be a compensation rather than a reschedule and that
// the delivered boundary (not the trace auditor's plan clock) has a legal gap.
const needsSeamDelay = [];
const instrSpan = (kind: string, rest: string[]) =>
  kind === 'sweep' ? sweepSpanMs(rest)
  : kind === 'tap' || kind === 'hold' ? +rest[1]
  : kind === 'hall' || kind === 'hallraise' ? +rest[0]
  : kind === 'maskraise' ? +rest[0] + (rest[1] === 'hall' ? +rest[2] : MIN_CONTACT_MS)
  : +rest[0] + +rest[1] + MIN_CONTACT_MS;

for (const [name, lines] of Object.entries(plan)) {
  const [at, kind, ...rest] = lines[lines.length - 1].split(' ');
  const end = +at + instrSpan(kind, rest);
  // devicePlan emits one plan per recipe cycle, under the cycle's name.
  const overrun = end - recipe.cycles[name as keyof typeof recipe.cycles].lengthMs;
  check(overrun <= FUSION_POLL_MS,
    `${name}: the last instruction ends ${overrun} ms past the cycle's own ` +
    `${recipe.cycles[name as keyof typeof recipe.cycles].lengthMs} ms length. Past one Fusion poll the next ` +
    "anchor cannot be delayed into a released gap -- that is a reschedule, not " +
    'a compensation, and the route has to change instead.');
  const nominalReleased = -overrun;
  const deliveredReleased = name === 'opening'
    ? nominalReleased : Math.max(nominalReleased, FUSION_POLL_MS);
  check(deliveredReleased >= MIN_RELEASED_MS,
    `${name}: the runner delivers only ${deliveredReleased} ms before the next ` +
    `cycle's monitor press, under the HID auditor's ${MIN_RELEASED_MS} ms floor`);
  // Report which cycles depend on the runner's seam delay. This is the link
  // between the two halves of the check: test-runner-plan.mjs asserts the
  // runner leaves that gap, and this names the cycles that would be broken
  // without it rather than asserting something vacuous here.
  if (overrun > -FUSION_POLL_MS)
    needsSeamDelay.push(`${name} (${overrun >= 0 ? '+' : ''}${overrun} ms)`);
}

// The branch is only known after the read, so both steady cycles must begin
// with the identical prefix: lower, read, mask.
const prefix = (lines: string[]) => lines.slice(0, 2).join('|');
check(prefix(plan.clear) === prefix(plan.attack),
  `clear and attack disagree before the classifier answers:\n  ${prefix(plan.clear)}\n  ${prefix(plan.attack)}`);

// The perfect-experiment spacing override (plans/17). It only widens the
// SELECT spacing, anchors the sweep END, and refuses to go below the model.
{
  const exp = devicePlan(build({ night: 6, sweepSlotMs: 100 }), { deviceSpacingMs: 113 });
  const shipped = devicePlan(build({ night: 6 }));
  // Every cycle of these plans carries a sweep.
  const sweepEnd = (lines: string[]) => {
    const s = lines.find(l => l.split(' ')[1] === 'sweep') as string;
    const [at, , ...rest] = s.split(' ');
    return +at + sweepSpanMs(rest);
  };
  const sweepSpacing = (lines: string[]) =>
    +(lines.find(l => l.split(' ')[1] === 'sweep') as string).split(' ')[2];
  check(sweepSpacing(exp.clear) === 113,
    `the experiment plan emits ${sweepSpacing(exp.clear)} ms spacing, not the requested 113`);
  check(sweepSpacing(shipped.clear) === DEVICE_SPACING_MS,
    'the default device plan must still emit the measured-safe spacing');
  check(sweepEnd(exp.clear) === sweepEnd(shipped.clear),
    `the experiment sweep ends at ${sweepEnd(exp.clear)} ms, the shipped one at ` +
    `${sweepEnd(shipped.clear)}; the stun bridge depends on the end not moving`);
  // Since the LIGHT_AFTER breakthrough (plans/17) the emitter may NARROW the
  // sweep too, not only widen it -- a shorter sweep that ends at the same
  // place is strictly more free time before it. The end anchor (checked above)
  // is the invariant; the spacing floor is gone.
  const narrow = devicePlan(build({ night: 6, sweepSlotMs: 120 }), { deviceSpacingMs: 67, sweepContactMs: 33 });
  check(narrow.clear.find(l => l.split(' ')[1] === 'sweep')?.split(' ')[2] === '67',
    'devicePlan must now accept a device spacing narrower than the model spacing');
  check(sweepEnd(narrow.clear) === sweepEnd(shipped.clear),
    'a narrowed sweep must still end where the model does -- it just starts later');

  // The emitter carries the contact length and refuses one that leaves no
  // released gap.
  const short = devicePlan(build({ night: 7, sweepSlotMs: 50 }),
    { deviceSpacingMs: 66, sweepContactMs: 33 });
  const shortSweep = (short.clear.find(l => l.split(' ')[1] === 'sweep') as string).split(' ');
  check(shortSweep[2] === '66' && shortSweep[3] === '33',
    `the short-contact sweep should emit "66 33", got "${shortSweep[2]} ${shortSweep[3]}"`);
  let threw2 = false;
  try { devicePlan(build({ night: 7, sweepSlotMs: 50 }), { deviceSpacingMs: 66, sweepContactMs: 66 }); }
  catch { threw2 = true; }
  check(threw2, 'devicePlan must refuse a contact length that leaves no released gap');

  // Machine-experiment contact override. It changes every emitted tap row,
  // while semantic holds (wind, vent and hall light) keep their policy-sized
  // durations. The sweep has its own contact axis above.
  const all17 = devicePlan(build({ night: 6, sweepSlotMs: 50 }),
    { deviceSpacingMs: 66, sweepContactMs: 17, tapContactMs: 17 });
  const tapRows = Object.values(all17).flat()
    .filter(line => line.split(' ')[1] === 'tap');
  check(tapRows.length > 0 && tapRows.every(line => line.endsWith(' 17')),
    'tapContactMs=17 must reach every emitted tap row');
  check(Object.values(all17).flat().some(line => / hold wind (?!17$)/.test(line)),
    'tapContactMs must not shorten semantic wind holds');
}

// The localized last-slot light contact (ON-DEVICE-VALIDATION.md, the Toy Chica
// / CAM 07 last-slot leak). Only the final slot's hold lengthens; the geometry
// stays LIGHT_AFTER, decided by the base contact; the sweep END does not move.
{
  const shipped = devicePlan(build({ night: 6 }));
  // Every cycle of these plans carries a sweep.
  const sweepEnd = (lines: string[]) => {
    const [at, , ...rest] = (lines.find(l => l.split(' ')[1] === 'sweep') as string).split(' ');
    return +at + sweepSpanMs(rest);
  };
  const sweepRest = (lines: string[]) =>
    (lines.find(l => l.split(' ')[1] === 'sweep') as string).split(' ').slice(2);

  const loc = devicePlan(build({ night: 6, sweepSlotMs: 120 }),
    { deviceSpacingMs: 100, sweepContactMs: 33, sweepLastContactMs: 67 });
  const [spacing, contact, cams] = sweepRest(loc.clear);
  check(spacing === '100' && contact === '33' && cams === '10,4,7:67',
    `the localized sweep should emit "100 33 10,4,7:67", got "${spacing} ${contact} ${cams}"`);
  check(sweepEnd(loc.clear) === sweepEnd(shipped.clear),
    `the localized sweep ends at ${sweepEnd(loc.clear)} ms, the shipped one at ` +
    `${sweepEnd(shipped.clear)}; the stun bridge depends on the end not moving`);
  check(sweepSpanMs(['100', '33', '10,4,7:67']) === 2 * 100 + LA_SELECT_MS + LA_SETTLE_MS + 67,
    'the last slot must cost select + settle + its own longer hold, not the base contact');
  check(sweepSpanMs(['100', '33', '10,4,7']) === 2 * 100 + LA_SELECT_MS + LA_SETTLE_MS + 33,
    'an unsuffixed sweep costs the base contact on every slot');

  // A last contact equal to the base emits no suffix -- byte-identical to
  // omitting the option.
  const noop = devicePlan(build({ night: 6, sweepSlotMs: 120 }),
    { deviceSpacingMs: 100, sweepContactMs: 33, sweepLastContactMs: 33 });
  const plain = devicePlan(build({ night: 6, sweepSlotMs: 120 }),
    { deviceSpacingMs: 100, sweepContactMs: 33 });
  check(JSON.stringify(noop) === JSON.stringify(plain),
    'sweepLastContactMs equal to the base contact must change nothing');

  // A last slot may run longer than the spacing -- nothing follows it -- but it
  // may not be SHORTER than the base contact (that is not a localized fix) or
  // non-positive.
  const longer = devicePlan(build({ night: 6, sweepSlotMs: 120 }),
    { deviceSpacingMs: 66, sweepContactMs: 33, sweepLastContactMs: 67 });
  check(sweepRest(longer.clear)[2] === '10,4,7:67',
    'a last contact above the spacing is allowed -- the last slot has no successor');
  for (const bad of [0, -5, 20]) {
    let threwLast = false;
    try {
      devicePlan(build({ night: 7, sweepSlotMs: 50 }),
        { deviceSpacingMs: 100, sweepContactMs: 33, sweepLastContactMs: bad });
    } catch { threwLast = true; }
    check(threwLast, `devicePlan must refuse a last-slot contact of ${bad} ms`);
  }

  // The token round-trips: the parser reads the last slot's override and leaves
  // the others on the base.
  const parsed = sweepCams('10,4,7:67', 33);
  check(parsed.cams.join(',') === '10,4,7' &&
        parsed.contacts.join(',') === '33,33,67',
    `sweepCams misread the localized token: ${JSON.stringify(parsed)}`);

  // The plan replays -- the sweep parser accepts the `:N` token end to end.
  const r = replay(loc, { night: 6, seed: 1 });
  check(r && r.sim, 'a localized plan must replay through the engine without error');
}

console.log(`  seam: ${needsSeamDelay.length ? needsSeamDelay.join(', ') + ' rely on the runner delaying the next anchor' : 'every cycle clears its own boundary'}`);
console.log('recipe checks passed: ' + Object.entries(recipe.cycles)
  .map(([n, c]) => `${n} ${c.budget.windMarginMs >= 0 ? '+' : ''}${c.budget.windMarginMs} ms wind`)
  .join(', ') + `; ${recipe.powerFramesSpentIfAllClear}/${recipe.powerFramesAvailable} power`);
