// Assertions for the engine's load-bearing SOURCED rules.
//
// Every other engine check is a population statistic: bbtest says the Minus 7
// bot survives 200/200, simtest sweeps seeds. Those pass or fail on aggregate
// behaviour, which means a wrong *rule* can hide behind a right *outcome* --
// a rule can be inverted, deleted, or invented and the survival rate barely
// moves, because the bot is not stressing that rule on most seeds.
//
// That is not hypothetical. An unsourced "masking with the monitor up lowers
// the cams" rule was added to setMask and removed again, and simtest, bbtest
// and bbtest --worst all passed identically in both directions. Nothing in
// the suite could see it.
//
// So this file asserts the mechanisms directly, one case per group citation,
// against a hand-driven Sim. A failure here names the group that broke.
//
//   node packages/source/test/sourcetest.ts
import { pathToFileURL } from 'node:url';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Rng } from '@sixam/source/fnaf2';

let pass = 0;
const fails = [];
const ok = (group, what, cond) => {
  if (cond) { pass++; return; }
  fails.push(`${group}: ${what}`);
};

// A sim with only the mechanism under test alive, so unrelated characters
// cannot end the night mid-assertion.
const bare = (opts = {}) => new Sim(Object.assign({
  seed: 12345, bbEnabled: false, foxyEnabled: false, gfEnabled: false,
  boxEnabled: false, powerEnabled: false, stalledEnabled: false,
}, opts));
const step = (s, n) => { for (let i = 0; i < n; i++) s.tick(); };
// Settle a monitor/mask animation.
const settle = (s) => step(s, Math.max(C.MONITOR_ANIM_UP, C.MASK_ANIM_ON) + 2);

// ---------------------------------------------------------------- input gates
{
  // The mask cannot go on with the monitor up: there is no state with both
  // raised, so the press is unreachable rather than a toggle.
  const s = bare();
  s.press('monitor'); settle(s);
  ok('input', 'monitor is up before the mask press', s.camsUp);
  s.press('mask'); settle(s);
  ok('input', 'a mask press with the cams up does nothing', !s.maskOn);
}
{
  // g75/g84 input half: while the mask is on, only the mask answers.
  const s = bare();
  s.press('mask'); settle(s);
  ok('input', 'mask goes on with the cams down', s.maskOn);
  s.press('monitor'); settle(s);
  ok('g75/g84', 'a monitor press while masked does nothing', !s.camsUp);
  s.press('mask'); settle(s);
  ok('g75/g84', 'the mask itself still answers', !s.maskOn);
}
{
  // g10/g11 plus the input surface: the off press clears the logical endpoint
  // immediately, but the lowering animation still owns the screen. A schedule
  // must not be allowed to raise the monitor or touch another control during
  // that interval; the phone presents the mask and drops those touches.
  const s = bare();
  s.press('mask'); settle(s);
  s.press('mask');
  ok('g10/g11', 'mask-off enters the lowering animation', !s.maskOn && s.maskAnim > 0);
  const frame = s.frame;
  for (const action of ['monitor', 'cam:10', 'wind', 'light', 'ventL', 'ventR']) {
    s.press(action);
    ok('g10/g11 input lock', `${action} is rejected while the mask is lowering`,
      s.frame === frame && !s.camsUp && !s.winding && !s.lightHeld &&
      !s.ventLightL && !s.ventLightR);
  }
  step(s, C.MASK_ANIM_OFF);
  s.press('monitor');
  ok('g10/g11 input lock', 'monitor is accepted after the mask is fully off', s.monAnim > 0);
}
{
  // g75/g84 effect half: a masked player lights nothing.
  const s = bare();
  s.press('mask'); settle(s);
  s.lightHeld = true;
  ok('g75/g84', 'the hall light is dead while masked', !s.hallLightOn);
  ok('g302/304', 'no office light reads as held while masked', !s.anyOfficeLightHeld);
}

// ------------------------------------------------------- the office light gate
// Every light in the office resolves through `lit?` (g75 hall, g76/g77 camera)
// and the vent pair (g301/g303/g320), and all of them carry the same two
// conditions: `mask` = 0 and `in danger` = 0.
{
  // g10/g11: `mask` returns to 0 only when the mmaskOff animation completes,
  // so the post-mask flash lockout IS that animation. Taking the mask off does
  // not restore the light -- finishing the animation does.
  const s = bare();
  s.press('mask'); settle(s);
  s.press('mask');                       // mask off: `mask` enters state 3
  s.lightHeld = true;
  ok('g10/g11', 'the mask-off press alone does not restore the light', !s.hallLightOn);
  step(s, C.MASK_ANIM_OFF - 1);
  ok('g10/g11', 'still dark one frame short of the animation', !s.hallLightOn);
  step(s, 2);
  ok('g75', 'the hall light returns the frame `mask` reaches 0', s.hallLightOn);
}
{
  // g489 -> g745: the reset Foxy actually depends on runs through `lit?`, so
  // the lockout gates it too. This is the rule that retimed the Minus 7 cycle:
  // a hall flash inside the mask-off animation resets nothing.
  const s = bare({ foxyEnabled: true });
  s.foxy.loc = 'hall'; s.foxy.D = 9;
  s.press('mask'); settle(s);
  s.press('mask'); s.lightHeld = true;
  step(s, C.MASK_ANIM_OFF - 1);
  ok('g489/g745', 'a flash inside the lockout does not zero Foxy D', s.foxy.D >= 9);
  step(s, 3);
  ok('g489/g745', 'the flash zeroes Foxy D once the mask clears', s.foxy.D === 0);
}
{
  // g75/g76/g77 and g83/g88: `in danger` -- the office-encounter latch raised
  // by g443-447/g490 and cleared by the endpoint resolutions g538-555 -- kills
  // every light, and the flashlight hitbox does not even register the touch.
  const s = bare();
  s.lightHeld = true;
  ok('g75', 'the hall light works with no encounter running', s.hallLightOn);
  s.startBlackout('test', null);
  ok('g75', 'no hall light while `in danger` is set', !s.hallLightOn);
  s.press('monitor'); settle(s);
  ok('g76/g77', 'no camera light while `in danger` is set', !s.camLightOn);
}
{
  // g299 clears both vent lights on a 200 ms timer and only g301/g303/g320
  // re-assert them, each requiring `mask` = 0 -- so a vent light already held
  // goes out the moment the mask starts going on. Toy Bonnie's g428 stall
  // reads the light, not the finger.
  const s = bare();
  s.press('ventR');
  ok('g303/g320', 'the right vent light is live with the mask off', s.ventLightROn);
  s.press('mask');
  ok('g299/g303', 'a held vent light dies the instant the mask goes on', !s.ventLightROn);
  ok('g284', 'the finger is still down -- it is the light that went out', s.ventLightR);
}
{
  // g530-533: the reaction window, and the fact that the mask CANCELS it.
  //
  // Corrected 2026-08-26. This block asserted the opposite -- that the mask
  // will not go on once an attack is executing -- citing g267/g270. Those
  // groups gate on `being attacked by` (object 136), which the got-you-box roll
  // in g556-559 sets, i.e. the COMMITTED attack. The engine was applying that
  // gate to `got you stage` == 1, the reaction COUNTDOWN, and so forbade for
  // the whole window the one action g533 says ends it. The old assertion is
  // kept here as the reason the bug survived: a test asserted it.
  const s = bare({ stalledEnabled: true, night: 3 });
  const u = s.units.find(x => x.id === 'withfreddy');
  u.inside = true;
  s.armInsideAttack(u, 'test');
  ok('g530', 'danger raises a countdown rather than killing outright',
    u.insideDangerAt === s.frame + C.timeAllowedFrames(3));
  s.press('mask');
  ok('g267/g270', 'the mask still goes on during the reaction window', s.maskOn);
  step(s, C.MASK_ANIM_ON + 2);
  ok('g533', 'a fully-on mask cancels the countdown', u.insideDangerAt === -1);
}
{
  // g532: and if the mask is NOT on in time, the window expires and kills.
  const s = bare({ stalledEnabled: true, night: 6 });
  const u = s.units.find(x => x.id === 'withfreddy');
  u.inside = true;
  s.armInsideAttack(u, 'test');
  step(s, C.timeAllowedFrames(6) + C.INSIDE_ATTACK_FRAMES + 2);
  ok('g532', 'an unanswered reaction window is fatal',
    s.death && s.death.reason === 'inside-office');
}
{
  // g523-529: `time allowed` by night, and that it TIGHTENS. Night 6 is 50 and
  // night 7 is 45 -- they are not the same, which is a common recollection.
  const want = { 1: 100, 2: 80, 3: 60, 4: 55, 5: 50, 6: 50, 7: 45 };
  for (const [night, frames] of Object.entries(want))
    ok('g523-529', `night ${night} allows ${frames} frames to react`,
      C.timeAllowedFrames(+night) === frames);
  ok('g529', 'the night-7 window is tighter than night 6',
    C.timeAllowedFrames(7) < C.timeAllowedFrames(6));
}

// ------------------------------------------------------------- Golden Freddy
{
  // g336: he spawns only on a 5 s interval with the monitor fully up.
  const s = bare({ gfEnabled: true, seed: 7 });
  step(s, C.FPS * 30);
  ok('g336', 'never spawns while the cams are down', !s.gf.present);
}
{
  // g776 mask clear, g777 kill on a raise.
  const s = bare({ gfEnabled: true });
  s.gf.present = true;
  s.press('mask'); settle(s);
  ok('g776', 'the mask clears him', !s.gf.present);

  const t = bare({ gfEnabled: true });
  t.gf.present = true;
  t.press('monitor');
  ok('g777', 'raising the monitor with him present kills', !t.alive &&
    t.death.reason === 'golden-freddy');
}
{
  // g778: kill on a hall flash, which is the cams-down light.
  const s = bare({ gfEnabled: true });
  s.gf.present = true;
  ok('g778', 'the hall view is the cams-down state', s.hallView);
  s.press('light');
  ok('g778', 'flashing the hall with him present kills', !s.alive &&
    s.death.reason === 'golden-freddy');
}
{
  // g573 before g778. Both hazards read the same hall flash and neither gates
  // the other, so with Foxy locked on AND Golden Freddy present the earlier
  // group is the one that fires. Checking Golden Freddy first and returning --
  // which the engine did until 2026-09-04 -- swallowed Foxy's kill entirely
  // and misattributed the death.
  const s = bare({ gfEnabled: true, foxyEnabled: true });
  s.gf.present = true;
  s.foxy.gotYou = true;
  s.press('light');
  ok('g573', 'a locked-on Foxy kills through Golden Freddy on the same flash',
    !s.alive && s.death.reason === 'foxy');
}
{
  // g780: the hallway figure kills above 100 frames of held light, not at 100.
  ok('g780', 'the hall kill threshold is 100 frames', C.GF_HALL_KILL_FRAMES === 100);
  ok('g781', 'his hall presence is a 1-in-10 roll', C.GF_HALL_ROLL === 10);
}

// --------------------------------------------------------------- Balloon Boy
{
  // g907 counts one per one-second event while fully masked; g294 sends him
  // back at five. Five ticks span four boundaries, so a hold that becomes
  // fully-on just after a boundary pays the full 5.000 s.
  const s = bare({ bbEnabled: true });
  s.bb.inOpening = true;
  // Align to a boundary, then mask.
  while ((s.frame + 1) % C.FPS !== 0) s.tick();
  s.tick();
  s.press('mask');
  step(s, C.MASK_ANIM_ON + 1);
  ok('g907', 'the mask is fully on', s.maskFullyOn);
  const start = s.frame;
  while (s.bb.inOpening && s.frame - start < C.FPS * 8) s.tick();
  const held = (s.frame - start) / C.FPS;
  ok('g294', `five ticks clear him in 4.0-5.0 s (measured ${held.toFixed(3)})`,
    !s.bb.inOpening && held > 3.9 && held <= 5.05);
}
{
  // g293: the counter is zeroed on every entry into the fully-on state, so
  // nothing banks between flicks. Four ticks, unmask, re-mask -> not cleared.
  const s = bare({ bbEnabled: true });
  s.bb.inOpening = true;
  s.press('mask'); step(s, C.MASK_ANIM_ON + 1);
  step(s, C.FPS * 3 + 30);            // some ticks, short of five
  const banked = s.bb.maskTicks;
  ok('g907', 'ticks accumulate while held', banked > 0);
  s.press('mask'); step(s, C.MASK_ANIM_OFF + 1);
  s.press('mask'); step(s, C.MASK_ANIM_ON + 1);
  ok('g293', 're-entering the mask zeroes the counter', s.bb.maskTicks === 0);
  ok('g294', 'he is still at the opening after the flick', s.bb.inOpening);
}
{
  // The counter is a per-tick count, not a cumulative frame budget: BB must
  // still be at the opening for it to run at all.
  ok('g294', 'the leave threshold is five ticks', C.VENT_MASK_TICKS === 5);
  ok('g292', 'the early leave is a 10%/s roll', C.VENT_EARLY_LEAVE_CHANCE === 0.1);
}
{
  // g691-694: sounds are dispatched through `cam 01` v21, and 18 edges across
  // seven characters write it. So BB's departure and a Toy's departure are the
  // same sample, and no detector can tell them apart. Plan 08 removed early
  // unmasking from scope on exactly this fact; the assertion exists so a
  // future controller cannot quietly start trusting the `who` field again.
  const leaveSample = (id) => {
    const s = bare({ bbEnabled: true, stalledEnabled: true });
    if (id === 'bb') {
      s.bb.inOpening = true;
    } else {
      const u = s.units.find(x => x.id === id);
      u.atOpening = true; u.openingSince = s.frame;
    }
    s.press('mask'); step(s, C.MASK_ANIM_ON + 1);
    for (let i = 0; i < C.FPS * 8 && !s.events.some(
      e => e.type === 'vent-bang' && e.data?.leaving); i++) s.tick();
    return s.events.find(
      e => e.type === 'vent-bang' && e.data?.leaving)?.data?.sample;
  };
  const fromBb = leaveSample('bb');
  const fromToy = leaveSample('toychica');
  ok('g292/294', 'BB leaving the opening plays the shared thud',
    fromBb === C.THUD_SAMPLE);
  ok('g439/440', 'Toy Chica leaving plays the same handle',
    fromToy === C.THUD_SAMPLE);
  // True of the sample in isolation. Minus 7 stun-locks every other writer and
  // a wound box holds the Puppet, so a controller that can assert those states
  // may still read the bang as BB -- see ANDROID-SOURCE-STATUS.md. What must
  // never come back is identity inferred from the *audio alone*.
  ok('g691-694', 'the audio alone cannot separate the two departures',
    fromBb !== undefined && fromBb === fromToy);
  ok('g608-611', 'the vocal bank is the three sourced handles',
    C.BB_VOCAL_SAMPLES.join(',') === '21,24,23');
  ok('g607', 'arrival at 122 adds a sample the departure never has',
    C.BB_ARRIVAL_SAMPLE === 21 && C.BB_ARRIVAL_SAMPLE !== C.THUD_SAMPLE);
  // g60 defaults channel 14 to 50; g414-416 play a route hop at 25; g906 plays
  // at 60 when he is on the viewed camera. Level, not sample identity, is what
  // separates those two meanings, and a 285 s device recording found no vocal
  // above threshold precisely because the approach cue is the quiet one.
  ok('g414-416', 'a route-hop vocal is played below the channel default',
    C.BB_VOCAL_VOLUME === 25 && C.BB_VOCAL_VOLUME < C.BB_VOCAL_CHANNEL_DEFAULT);
  ok('g906', 'a vocal on the viewed camera is played above it',
    C.BB_VIEW_VOCAL_VOLUME === 60
      && C.BB_VIEW_VOCAL_VOLUME > C.BB_VOCAL_CHANNEL_DEFAULT);
}
{
  // e8fcf2f / g96 / g301 / g303: BB inside the office is permanent and takes
  // the lights away -- he is not a death, and nothing moves him back out.
  const s = bare({ bbEnabled: true });
  s.bb.inside = true;
  s.lightHeld = true;
  ok('g96', 'BB inside kills the hall light', !s.hallLightOn);
  ok('g301/303', 'BB inside kills every office light', !s.anyOfficeLightHeld);
  step(s, C.FPS * 20);
  ok('e8fcf2f', 'BB inside is not itself a death', s.alive);
  ok('e8fcf2f', 'and nothing moves him back out', s.bb.inside);
  // g77/g86: the `viewing = 10` pair has no BB exclusion, so CAM 10 keeps its
  // camera light even with him inside.
  const t = bare({ bbEnabled: true });
  t.bb.inside = true;
  t.press('monitor'); settle(t);
  t.press('cam:10'); t.press('light');
  ok('g77/g86', 'CAM 10 keeps its camera light with BB inside', t.camLightOn);
  t.press('cam:4');
  ok('g76/g85', 'other cameras do not', !t.camLightOn);
}

// ------------------------------------------------------------------ forcedown
{
  // g141 set, g262 monitor, g274 mask, g612 clear -- and it is spent one frame
  // after it is raised.
  const s = bare();
  s.press('monitor'); settle(s);
  s.press('mask');    // ignored, cams up -- so mask separately below
  ok('input', 'setup: cams up, no mask', s.camsUp && !s.maskOn);
  s.dropEverything = true;
  s.tick();
  ok('g262', 'the forcedown lowers the monitor', !s.camsUp);
  ok('g612', 'and clears its own flag', !s.dropEverything);

  const t = bare();
  t.press('mask'); settle(t);
  ok('input', 'setup: masked, cams down', t.maskOn);
  t.dropEverything = true;
  t.tick();
  ok('g274', 'the forcedown takes the mask off', !t.maskOn);
}

// ------------------------------------------------------------ marker parking
{
  // Lowering the monitor sets `viewing = 0` but never moves the marker, so the
  // selected camera survives the monitor-down stretch.
  const s = bare();
  s.press('monitor'); settle(s);
  s.press('cam:7');
  ok('g16-27', 'a camera touch writes viewing and the marker',
    s.cam === 7 && s.viewing === 7);
  s.press('monitor'); settle(s);
  ok('g262', 'lowering clears viewing but keeps the marker on CAM 07',
    s.viewing === 0 && s.cam === 7);
}

// ---------------------------------------------- split-camera state / stun
{
  const s = bare({ night: 7, stalledEnabled: true });
  s.press('monitor'); settle(s); // first raise: viewing + marker = CAM 07
  s.press('cam:11');
  while (s.frame % C.LAST_VIEW_SAMPLE_FRAMES !== 0) s.tick();
  ok('g263', 'the 200 ms sampler stores the displayed CAM 11', s.lastViewed === 11);

  // Start immediately after a sample, so CAM 09 cannot reach g263 before the
  // monitor-down write clears viewing.
  s.tick();
  s.press('cam:9');
  s.press('monitor'); settle(s);
  s.press('monitor'); settle(s);
  ok('g1/g2', 'raise restores stale viewing while leaving the marker on CAM 09',
    s.viewing === 11 && s.cam === 9);

  const toys = s.units.filter(u => C.TOYS.has(u.id));
  s.press('light'); s.tick();
  ok('g453-455', 'split CAM 09 marker + CAM 11 viewing stuns all three Toys',
    toys.every(u => u.stunUntil === s.frame + C.STUN_FRAMES));
}
{
  const s = bare({ stalledEnabled: true });
  s.monitor = 'up'; s.viewing = s.cam = 9; s.lightHeld = true;
  s.tick();
  ok('g453-455', 'synchronized CAM 09 keeps the Show Stage Toys immune',
    s.units.filter(u => C.TOYS.has(u.id)).every(u => u.stunUntil < 0));
}

// ------------------------------------------------------------- camera stun
{
  ok('stun time', 'a camera flash loads a 400-frame stun', C.STUN_FRAMES === 400);
}

// ------------------------------------------------- sourced constant values
//
// Cheap, and exactly the failure mode the population checks cannot see: a
// sourced number silently edited. Each line names the group or dump the value
// came from, so a failure points at the claim rather than at the symptom.
const eq = (group, what, got, want) =>
  ok(group, `${what} = ${want} (got ${got})`, got === want);

// clock
eq('decompile', 'the night is 420 s', C.NIGHT_FRAMES, C.s(420));
eq('decompile', 'an in-game hour is 70 s', C.HOUR_FRAMES, C.s(70));
eq('g450-457', 'one flash stuns for 400 frames', C.STUN_FRAMES, 400);
eq('decompile', 'movement opportunities are 5 s apart', C.MO_FRAMES, C.s(5));
eq('decompile', 'a blackout lasts 5 s', C.BLACKOUT_FRAMES, C.s(5));

// endpoint resolution order -- group index decides, not arrival
ok('g537/g538-555', 'the defended resolve order is by group index',
  C.RESOLVE_ORDER_DEFENDED.join() ===
  'withfreddy,withbonnie,withchica,toyfreddy,toybonnie,toychica');
ok('g532/g533', 'the failed order moves Toy Freddy last',
  C.RESOLVE_ORDER_FAILED.join() ===
  'withfreddy,withbonnie,withchica,toybonnie,toychica,toyfreddy');
ok('g402/403', 'Mangle is absent from the resolve table',
  !C.RESOLVE_ORDER_DEFENDED.includes('mangle') &&
  !C.RESOLVE_ORDER_FAILED.includes('mangle'));

// the `time allowed` -> `time left` fuse, by night
eq('time allowed', 'the night-7 mask fuse is 45 frames', C.maskGraceFrames(7), 45);
eq('time allowed', 'the night-1 fuse is 100 frames', C.maskGraceFrames(1), 100);
ok('time allowed', 'the fuse shortens every night up to 7', (() => {
  for (let n = 2; n <= 7; n++)
    if (C.maskGraceFrames(n) > C.maskGraceFrames(n - 1)) return false;
  return true;
})());

// Foxy
{
  // g389 explicitly zeroes D on arrival. A blackout starting on that same
  // boundary freezes the new hall timer, not the accumulated approach timer.
  const s = bare({ night: 3, foxyEnabled: true });
  s.frame = C.MO_FRAMES;
  s.foxy.readyAt = 0;
  s.foxy.D = 100; // guarantees the approach roll succeeds for every RNG draw
  s.startBlackout('arrival overlap');
  s.blackout.masked = true;
  s.onFiveSecond();
  ok('g389', 'Foxy enters the hall during the blackout', s.foxy.loc === 'hall');
  ok('g389', 'arrival starts a fresh hall timer without a flashlight', s.foxy.D === 0);
  step(s, C.MO_FRAMES);
  ok('g389/g745', 'the next boundary does not lock on using the old approach timer',
    s.alive && !s.foxy.gotYou);
}
eq('g829', "Foxy's AI caps at 17, not the shared 15", C.FOXY_AI, 17);
eq('g824/825', 'his exposure threshold is 100*night', C.foxyExposureFrames(7), 700);
eq('g872-874', 'the lit hall pins him for 50 frames', C.FOXY_HALL_PIN_FRAMES, 50);
eq('g846', 'a retreat writes B = 500 + Random(500), min', C.FOXY_RETURN_MIN, 500);
eq('g846', '...and max', C.FOXY_RETURN_MAX, 999);
ok('g337', 'he first enters between 5 s and 10 s',
  C.FOXY_ENTER_MIN === C.s(5) && C.FOXY_ENTER_MAX === C.s(10));

// Balloon Boy
eq('g294', 'five masked ticks send him back', C.VENT_MASK_TICKS, 5);
eq('g292', 'the early leave is 10%/s', C.VENT_EARLY_LEAVE_CHANCE, 0.1);
eq('g342', 'his move roll is 3/4', C.BB_MOVE_CHANCE, 0.75);
eq('g413-418', 'his route is five moves, not four', C.BB_STAGES, 5);
eq('g414-416', 'only the first hop is silent', C.BB_SILENT_HOPS, 1);

// the shared cams-up entry streak and the two per-unit timers
eq('value25', 'the night-7 entry streak is 6 s', C.entryStreakFrames(7), C.s(6));
eq('value25', 'the night-1 streak is 18 s', C.entryStreakFrames(1), C.s(18));
eq('decompile', "Toy Bonnie's night-7 cooldown is 300 frames",
  C.toyBonnieOpeningFrames(7), 300);
eq('g903-905', "Toy Chica's opening edge is six scheduler ticks",
  C.TOY_CHICA_OPENING_TICKS, 6);
eq('g436-441', "Toy Bonnie's overlay rolls every 500 ms", C.TOY_BONNIE_CUE_FRAMES, C.s(0.5));
eq('g436-441', '...at 1 in 2', C.TOY_BONNIE_CUE_CHANCE, 0.5);

// marker 123
// Retained, and its citation corrected: g556-569 is the got-you-box roll while
// already masked, NOT the reaction window. The 40 is no longer the window --
// g523-529 are -- and it is not currently used by the engine at all. Whether 40
// belongs to `attack animation` (object 137) is UNSOURCED.
eq('g556-569', 'the legacy flat 40 is still 40, and no longer the window',
  C.INSIDE_ATTACK_FRAMES, 40);
eq('g729-731', 'Mangle arms on a 1-in-20 cams-up second', C.MANGLE_INSIDE_ARM_CHANCE, 0.05);
eq('g747-750', 'a marker-123 leave writes B = 500 flat', C.INSIDE_LEAVE_COOLDOWN, 500);
eq('g538-555', 'a defended repel rolls Random(500)/night', C.REPEL_COOLDOWN_ROLL, 500);

// Golden Freddy
eq('g830', 'his office roll is 1 in 2 at the 10 cap', C.GF_SPAWN_CHANCE, 0.5);
eq('g875-880', '`hall movement` blocks him for 300 frames', C.HALL_MOVEMENT_FRAMES, 300);
{
  // g875-880 carry C -7 ("only one action when event loops"): the 300 is
  // written once per continuous overlap of the hitbox, i.e. on entry into the
  // hall column, and a hall-stage-1 -> hall-stage-2 hop keeps it continuous.
  const drive = (opts) => {
    const s = bare({ stalledEnabled: true, gfEnabled: true, ...opts });
    const tf = s.units.find(u => u.id === 'toyfreddy');
    for (const u of s.units) if (u !== tf) u.done = true;
    s.ai.toyfreddy = 0;          // no movement roll can move him off the stage
    tf.idx = 2;                  // hall stage 1 (`blindA`)
    s.tick();
    const armedAt = s.hallMovementUntil;
    step(s, 400);                // stands there longer than the 300
    const afterStay = s.hallMovementUntil;
    tf.idx = 3;                  // hall stage 2 (`blindB`): still overlapping
    s.tick();
    return { s, armedAt, afterStay, afterHop: s.hallMovementUntil };
  };
  const src = drive({ sourcedHallEntry: true });
  ok('g875-880', 'entering the hall column arms the 300',
    src.armedAt === src.s.frame - 401 + C.HALL_MOVEMENT_FRAMES);
  ok('g875-880', 'standing there does not refresh it', src.afterStay === src.armedAt);
  ok('g875-880', 'a stage-1 -> stage-2 hop does not re-arm it', src.afterHop === src.armedAt);
  const old = drive({});
  ok('g875-880', 'the legacy reading refreshed it every frame of the stay',
    old.afterStay > old.armedAt && old.afterHop > old.afterStay);
  // The latch is readable at any frame and ticks without Golden Freddy, so a
  // trace can score the phone's DIM hall flash (g202) against it.
  const t = bare({ stalledEnabled: true, gfEnabled: false, sourcedHallEntry: true });
  const tf = t.units.find(u => u.id === 'toyfreddy');
  for (const u of t.units) if (u !== tf) u.done = true;
  t.ai.toyfreddy = 0;
  tf.idx = 2; t.tick();
  const armed = t.events.filter(e => e.type === 'hall-movement').map(e => e.data.who);
  ok('g202', 'hallMovementFrames reads the 300 with Golden Freddy disabled',
    t.hallMovementFrames === C.HALL_MOVEMENT_FRAMES && armed.join() === 'toyfreddy');
  step(t, C.HALL_MOVEMENT_FRAMES);
  ok('g881', 'and it drains to zero while he stands there', t.hallMovementFrames === 0);
}

// the shared cap and the movement roll
eq('g830', 'everyone else caps at 15 AI', C.STALLED_AI, 15);
eq('MO', 'AI 15 is a 75% movement roll', C.MO_CHANCE(15), 0.75);
eq('g494-497', "the Puppet's bare <= roll is 16/20 at AI 15",
  C.PUPPET_MO_CHANCE(15), 0.8);

// the AI table, by night and hour
{
  // Night 6 is the on-device target, and it is the only night the pilot has
  // ever been run on: two rows, two in-game hours apart.
  const s = bare({ night: 6, stalledEnabled: true });
  ok('g683', 'night 6 opens the three Withereds at 5',
    s.ai.withfreddy === 5 && s.ai.withbonnie === 5 && s.ai.withchica === 5);
  eq('g683', '...W. Foxy at 10', s.ai.foxy, 10);
  eq('g683', '...Mangle at 3', s.ai.mangle, 3);
  eq('g683', '...and Balloon Boy at 5', s.ai.bb, 5);
  ok('g683', 'the three Toys are switched off until 2 AM',
    s.ai.toyfreddy === 0 && s.ai.toybonnie === 0 && s.ai.toychica === 0);
  eq('g820', 'the Puppet is at 15 from midnight', s.ai.puppet, 15);
  eq('g683', 'Golden Freddy opens on a one-in-ten roll',
    bare({ night: 6, worst: true }).ai.golden, 1);

  step(s, C.HOUR_FRAMES * 2 - 1);
  eq('g673-684', 'the midnight levels hold through the frame before 2 AM', s.ai.bb, 5);
  // g333-342 read the counters above g673-684, so the new hour reaches the
  // rolls on the following frame rather than on the boundary itself.
  step(s, 1);
  eq('g684', '2 AM takes Balloon Boy to 9', s.ai.bb, 9);
  ok('g684', '...switches all three Toys on at 5',
    s.ai.toyfreddy === 5 && s.ai.toybonnie === 5 && s.ai.toychica === 5);
  eq('g684', '...W. Foxy to 15', s.ai.foxy, 15);
  eq('g684', '...and Golden Freddy to a real 3', s.ai.golden, 3);
}
{
  // g804 zeroes Golden Freddy below night 6, but it runs once at night start,
  // so it only cancels the rows written in that same instant.
  eq('g804', 'night 3 writes him at midnight and loses it',
    bare({ night: 3, worst: true }).ai.golden, 0);
  const s = bare({ night: 2, worst: true });
  eq('g804', 'night 2 is also zero at midnight', s.ai.golden, 0);
  step(s, C.HOUR_FRAMES);
  eq('g676', "...but its 1 AM row lands after g804's one shot", s.ai.golden, 1);
}
{
  // 10/20 is the same table with the dials copied in, so the levels the rest
  // of this file asserts have to fall out of it.
  const s = bare({ night: 7 });
  eq('g787', 'every 10/20 dial is 20', (C.AI_BY_NIGHT[7][0].set as any).bb, C.AI_10_20);
  eq('g856-863', '...held at 15 for the seven', s.ai.toychica, C.STALLED_AI);
  eq('g829', '...at 17 for Foxy', s.ai.foxy, C.FOXY_AI);
  eq('g830', '...and at 10 for Golden Freddy',
    C.MO_CHANCE(s.ai.golden), C.GF_SPAWN_CHANCE);
  eq('g342', 'the capped Balloon Boy level is the 3/4 roll',
    C.MO_CHANCE(s.ai.bb), C.BB_MOVE_CHANCE);
  eq('g821', 'the Puppet has no dial and stays at 15', s.ai.puppet, C.PUPPET_AI);
}
{
  // Custom Night: `customNight` (an AI_DIALS vector) replaces the whole night
  // table with one 12 AM row. g787 copies the ten dials the player set; the
  // menu has no Puppet dial, so g821 still pins him at 15. `night` stays 7, so
  // every night>=7 rule keeps applying -- which is why customNight requires it.
  const only = (dials) => bare({ night: 7, customNight: dials });

  const tc = only({ toychica: 20 });
  eq('g787', 'a custom dial applies, capped at 15', tc.ai.toychica, C.STALLED_AI);
  eq('g673', 'a dial the vector omits stays at zero', tc.ai.toybonnie, 0);
  eq('g821', 'the Puppet is still armed on a custom night', tc.ai.puppet, C.PUPPET_AI);
  ok('canAct', 'canAct reads the custom vector, not the night-7 table',
    C.canAct(7, 'toychica', { toychica: 20 }) && !C.canAct(7, 'toybonnie', { toychica: 20 }));
  eq('peakAi', 'peakAi caps the custom dial like the engine does',
    C.peakAi(7, 'foxy', { foxy: 20 }), C.FOXY_AI);

  const max = only(Object.fromEntries(C.AI_DIALS.map(id => [id, 20])));
  ok('g829/g830/g856-863', 'an all-20 custom vector clamps to the per-frame caps',
    max.ai.foxy === C.FOXY_AI && max.ai.golden === 10 && max.ai.bb === C.STALLED_AI);

  // Only the armed characters can end the night: nothing but the Puppet is
  // dialed, so an unplayed run can only die to the Puppet.
  const idle = new Sim({ seed: 7, night: 7, customNight: {} });
  while (idle.alive && !idle.won) idle.tick();
  ok('customNight', 'with only the Puppet armed, only the Puppet kills',
    !idle.won && idle.death.reason === 'puppet');

  let threw = false;
  try { new Sim({ night: 3, customNight: { bb: 20 } }); } catch { threw = true; }
  ok('customNight', 'the vector refuses a night other than 7', threw);
}

// power and box
eq('g866-870', 'night 7 gives 3000 frames of light', C.powerFrames(7), 3000);
eq('g866-870', 'night 1 gives 7000', C.powerFrames(1), 7000);
eq('battery life', 'the indicator blinks at 500', C.POWER_BLINK, 500);
eq('decompile', 'a full box drains in 16.67 s', C.BOX_DRAIN_FRAMES, C.s(16.67));
eq('g638-645', 'empty to full takes 5.66 s', C.BOX_WIND_FRAMES, C.s(5.66));
eq('g494-496', 'three successful rolls free the Puppet', C.PUPPET_ESCAPE_STAGES, 3);
ok('g404-411', "the Puppet's two routes are the sourced ones",
  C.PUPPET_ROUTE.left.join() === '10,7,3,1,office' &&
  C.PUPPET_ROUTE.right.join() === '10,7,4,2,office');

eq('g3', 'a first raise on nights 1-6 opens CAM 09', C.initialCamera(1), 9);
eq('g4', 'a first raise on night 7 opens CAM 07', C.initialCamera(7), 7);
eq('g486-487', 'the Custom Night marker starts parked on CAM 10', C.parkedCamera(7), 10);
eq('g848-854', 'the hall-light B pin is 40 frames', C.HALL_LIGHT_PIN_FRAMES, 40);
eq('g774', 'the roaming Puppet camera pin is 10 frames', C.PUPPET_CAMERA_PIN_FRAMES, 10);
eq('g623', 'the Puppet office edge is a 1-in-10 roll', C.PUPPET_OFFICE_ROLL, 10);

{
  // g2-4 run when the raise animation completes: the first Custom Night
  // raise selects CAM 07, and later raises restore the player's last choice.
  const s = bare({ night: 7 });
  eq('g486-487', 'before the first raise the hidden marker is CAM 10', s.cam, 10);
  s.press('monitor'); settle(s);
  eq('g4', 'the first completed Custom Night raise selects CAM 07', s.cam, 7);
  s.press('cam:11');
  step(s, C.LAST_VIEW_SAMPLE_FRAMES);
  s.press('monitor'); settle(s);
  s.press('monitor'); settle(s);
  eq('g2', 'a later completed raise restores the sampled camera', s.viewing, 11);
  eq('g2', 'a normal sampled cycle leaves the marker synchronized', s.cam, 11);
}

{
  // g848-854 refresh B=40 only while the character is physically at a hall
  // marker. Once the one-second light latch clears, that tail still drains.
  const s = bare({ stalledEnabled: true });
  const wb = s.units.find(u => u.id === 'withbonnie');
  for (const u of s.units) if (u !== wb) u.done = true;
  wb.idx = 2;                 // hall stage 1 (`blindA`)
  wb.pending = true;
  s.frame = 58;
  s.lightLogicalUntil = 60;
  s.tick();                   // last latched frame refreshes B through frame 99
  while (s.frame < 60) s.tick();
  ok('g848-854', 'the hall occupant remains pinned after latch clear',
    wb.pending && wb.idx === 2);
  while (s.frame < 99) s.tick();
  ok('g848-854', 'the pending move resolves when the 40-frame B tail drains',
    !wb.pending && wb.idx === 3);
}

{
  // g903-905 use six global scheduler ticks, not arrival + 300 frames.
  const s = bare({ stalledEnabled: true });
  const tc = s.units.find(u => u.id === 'toychica');
  for (const u of s.units) if (u !== tc) u.done = true;
  tc.idx = tc.path.length - 1;
  tc.atOpening = true;
  s.press('monitor'); settle(s);
  for (let i = 0; i < 5; i++) step(s, C.FPS - (s.frame % C.FPS));
  ok('g903-905', 'Toy Chica is still at marker 122 after five ticks',
    tc.atOpening && !tc.inside);
  step(s, C.FPS);
  ok('g903-905', 'the sixth tick advances Toy Chica while cameras are up',
    !tc.atOpening && tc.inside);
}

{
  // g494-497 are one-second rolls. Reaching marker 122 is not the kill:
  // g623 rolls 1-in-10 for 123, then g574/g587-588 run a 40-frame attack.
  const s = bare({ boxEnabled: true, worst: true });
  s.box = 0;
  step(s, C.FPS * C.PUPPET_ESCAPE_STAGES);
  ok('g494-496', 'three successful seconds free and arm the Puppet',
    s.puppet.out && s.puppet.pending && s.puppet.stage === 3);
  s.tick();
  eq('g404', 'the armed move resolves to CAM 10 next frame', s.puppet.loc, 10);
  for (let hop = 0; hop < 4; hop++) {
    step(s, C.FPS - (s.frame % C.FPS));
    s.tick();
  }
  ok('g404-411', 'five route hops end at marker 122 without killing',
    s.alive && s.puppet.atOpening && !s.puppet.inside);
  step(s, C.FPS - (s.frame % C.FPS));
  ok('g623/g574', 'the office roll moves to 123 and starts forcedown',
    s.puppet.inside && s.puppet.attackAt === s.frame + C.INSIDE_ATTACK_FRAMES &&
    s.dropEverything);
  step(s, C.INSIDE_ATTACK_FRAMES - 1);
  ok('g587-588', 'the Puppet attack is not instant', s.alive);
  s.tick();
  ok('g587-588', 'the Puppet kills after 40 attack frames',
    s.death?.reason === 'puppet');
}

{
  // g774 excludes CAM 11 but pins B=10 on a later watched/lit route camera.
  const s = bare({ boxEnabled: true, worst: true });
  Object.assign(s.puppet, { stage: 3, out: true, loc: 10 });
  s.monitor = 'up'; s.viewing = s.cam = 10; s.lightHeld = true; s.frame = 58;
  s.tick(); s.tick();
  ok('g774', 'a lit roaming Puppet cannot arm the next one-second hop',
    !s.puppet.pending && s.puppet.stunUntil > s.frame);
  s.release('light');
  step(s, C.FPS);
  ok('g774/g496', 'the route roll resumes after the B=10 tail drains',
    s.puppet.pending || s.puppet.loc !== 10);
}

// animation bank -- the asymmetry is the load-bearing part
ok('build 296', 'lowering the monitor is slower than raising it',
  C.MONITOR_ANIM_DOWN > C.MONITOR_ANIM_UP);
ok('build 296', 'taking the mask off is slower than putting it on',
  C.MASK_ANIM_OFF > C.MASK_ANIM_ON);

// the seven's sourced routes and gates
{
  const by = Object.fromEntries(C.STALLED.map(u => [u.id, u]));
  ok('route graph', 'seven stalled characters', C.STALLED.length === 7);
  ok('g875-880', 'Toy Freddy owns the uncovered 9 -> 10 -> blind -> office route',
    by.toyfreddy.path.join() === '9,10,blindA,blindB,office');
  ok('route graph', 'Withered Freddy is held at CAM 07',
    by.withfreddy.path.includes(7));
  ok('value25', 'the four mutex holders are the streak users',
    C.STALLED.filter(u => u.mutex).map(u => u.id).join() ===
    'withfreddy,withbonnie,withchica,toyfreddy' &&
    C.STALLED.filter(u => u.mutex).every(u => u.openingRule === 'streak'));
  ok('g402/403', "Mangle's opening rule is the monitor raise",
    by.mangle.openingRule === 'raise');
  ok('g428', 'Toy Bonnie enters from the cams-down state',
    by.toybonnie.entryGate === 'camsDown');
  ok('g456', 'Mangle transits CAM 11, where the flash stun is excluded',
    by.mangle.path.includes(11));
}

// ------------------------------------------------------- driven behaviours
{
  // `battery life` drains 1 per frame while any light is on, and not
  // otherwise.
  const s = bare({ powerEnabled: true });
  const p0 = s.power;
  step(s, 60);
  ok('battery life', 'no drain with every light off', s.power === p0);
  s.press('light');
  step(s, 60);
  ok('battery life', 'the office light drains 1/frame', p0 - s.power === 60);
}
{
  // The box drains full -> empty in 16.67 s with nobody winding.
  const s = bare({ boxEnabled: true });
  ok('box', 'the box starts full', s.box === 1);
  step(s, C.BOX_DRAIN_FRAMES);
  ok('box', 'and is empty after the sourced drain', s.box <= 0.001);
}
{
  // Winding only counts on the box camera: a finger anywhere else does
  // nothing, which is what makes CAM 11 part of the cycle.
  const s = bare({ boxEnabled: true });
  step(s, C.FPS * 5);
  const low = s.box;
  s.press('monitor'); settle(s);
  s.press('cam:10');
  s.press('wind');
  step(s, C.FPS);
  ok('box', 'winding off CAM 11 does nothing', s.box < low);
  s.press('cam:11');
  const before = s.box;
  step(s, C.FPS);
  ok('g638-645', 'winding on CAM 11 refills', s.box > before);

  // g637/g644: the 'WinD' ratchet (sample 33) fires on a global 500 ms grid
  // while winding on CAM 11 -- the audible tick a human counts.
  s.events.length = 0;
  step(s, C.FPS); // one game-second of continuous winding
  const ticks = s.events.filter(e => e.type === 'wind-tick');
  ok('g637/g644', 'the winding ratchet fires twice a second',
    ticks.length === 2 && ticks.every(t => t.data.sample === C.WIND_TICK_SAMPLE));
  ok('g637/g644', 'its edges sit on the fixed frame grid, not since-wind-start',
    ticks.every(t => t.f % C.WIND_TICK_FRAMES === 0));
  s.release('wind');
  s.events.length = 0;
  step(s, C.FPS);
  ok('g637/g644', 'and it stops the moment winding stops',
    s.events.filter(e => e.type === 'wind-tick').length === 0);
}
{
  // The cams-up entry streak resets the moment the monitor starts down --
  // it is a *current session* counter, not a running total.
  const s = bare();
  s.press('monitor'); settle(s);
  step(s, C.FPS * 3);
  ok('value25', 'the cams-up session is running', s.camsUpSince >= 0);
  s.press('monitor'); settle(s);
  ok('value25', 'lowering the monitor ends the session', !s.camsUp);
  s.press('monitor'); settle(s);
  const restarted = s.frame - s.camsUpSince;
  ok('value25', 'and the next raise starts a fresh one',
    restarted < C.FPS * 3);
}

// ------------------------------------------------------------ the generator
// [SOURCED: RunLoop/CRun.java in base.apk classes.dex — see src/rng.js.]
// The stream itself, not just the rolls: graine = (graine*31415 + 1) & 0xFFFF,
// Random(N) = (graine*N) >> 16. The reference below is that Java, transcribed.
{
  const ref = { g: 0, random(n) { this.g = (this.g * 31415 + 1) & 0xffff; return (this.g * n) >>> 16; } };
  // First states and Random(20) draws from seed 0, precomputed from the
  // decompiled source. If either line drifts, the port is no longer the game.
  const r = new Rng(0);
  const states = [], draws = [];
  for (let i = 0; i < 8; i++) { draws.push(r.int(0, 19)); states.push(r.state); }
  ok('CRun.random', 'the LCG state sequence matches the decompile',
    states.join() === '1,31416,27017,47856,401,14504,36889,60384');
  ok('CRun.random', 'Random(20) scaling matches the decompile',
    draws.join() === '0,9,8,14,0,4,11,18');
  // int(0, N-1) stays bit-exact to CRun.random(N) across ranges the sheet
  // uses, for a full period from an arbitrary seed.
  let exact = true;
  for (const n of [2, 4, 5, 10, 20, 500]) {
    const a = new Rng(12345); ref.g = 12345;
    for (let i = 0; i < 20000; i++) if (a.int(0, n - 1) !== ref.random(n)) { exact = false; break; }
  }
  ok('CRun.random', 'int(0, N-1) is bit-exact to CRun.random(N)', exact);
  // chance(k/N) is bit-exact to the sheet's `Random(N) < k` comparison,
  // boundary states included.
  let cmp = true;
  {
    const a = new Rng(0); ref.g = 0;
    for (let i = 0; i < 20000; i++) if (a.chance(15 / 20) !== (ref.random(20) < 15)) { cmp = false; break; }
  }
  ok('CRun.random', 'chance(k/N) is bit-exact to Random(N) < k', cmp);
  // The map's complete structure: every one of the 65,536 seeds belongs to
  // one of four disjoint 16,384-state cycles.
  const unseen = new Set(Array.from({ length: 65536 }, (_, i) => i));
  const periods = [];
  while (unseen.size) {
    const start = unseen.values().next().value;
    const p = new Rng(start);
    let period = 0;
    do { unseen.delete(p.state); p.next(); period++; } while (p.state !== start);
    periods.push(period);
  }
  ok('CRun.random', 'the state space is four disjoint 16,384-state cycles',
    periods.length === 4 && periods.every(n => n === 16384));
  // Seeding truncates to 16 bits, as (short) System.currentTimeMillis() does.
  const a = new Rng(0x1beef), b = new Rng(0xbeef);
  ok('CRun.random', 'seeds collapse to their low 16 bits like the runtime',
    a.next() === b.next());
}

// ------------------------------------------------------------------- report
const total = pass + fails.length;
if (fails.length) {
  console.log(`sourced-rule checks: ${pass}/${total} pass`);
  for (const f of fails) console.log(`  FAIL  ${f}`);
} else {
  console.log(`sourced-rule checks: ${total}/${total} pass`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(fails.length ? 1 : 0);
}
