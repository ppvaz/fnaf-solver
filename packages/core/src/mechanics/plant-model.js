import * as C from './config.js';
import { Rng } from './rng.js';

/** route nodes whose entry plays a footstep sound, by default the hall stages only. 8a7288b narrowed the set
 * to these because full-06's audio had no footstep sound (25-29) on a Withered hop onto cams 01-4
 * (docs/evidence/night7-k3-frametrace-nights-20260915.json); that negative is not evidence, since its
 * detector cannot hear samples 25-29 in that capture (docs/evidence/footstep-cam-markers-adjudication-20260927.json).
 * footstepCamMarkers adds the CAM 01-04 markers the CCN's geometry puts under `hear footsteps`. */
const FOOTSTEP_NODES = /** @type {Set<string | number>} */ (new Set(['blindA', 'blindB']));
// sourcedHourTable: Golden Freddy's `(Random(N) + 1) / N` in the first-loop hour row (g677, g679, g681).
const SOURCED_HOUR0_GOLDEN = /** @type {Record<number, number>} */ ({ 3: 1000, 4: 100, 5: 100 });
// footstepCamMarkers: the markers the CCN's own geometry puts under `hear footsteps`.
const FOOTSTEP_CAM_NODES = /** @type {Set<string | number>} */ (new Set([1, 2, 3, 4, 'blindA', 'blindB']));
const MON_DOWN = 'down', MON_RAISING = 'raising', MON_UP = 'up', MON_LOWERING = 'lowering';

export class Sim {
  constructor(opts = {}) {
    this.opts = Object.assign({
      seed: (Math.random() * 4294967295) >>> 0,
      worst: false,
      night: 7,             // sourced tables index by night; 7 = 10/20 mode
      // A Custom Night AI vector (an `AI_DIALS` map). Replaces the night-7 AI
      // table with the player's ten dials; requires `night: 7`, since Custom
      // Night is night 7 in the menus and every `night >= 7` rule must apply.
      customNight: null,
      android: true,        // canonical target; flag retained only for old test modes
      speed: 1.0,
      // Off by default: the per-frame report channels cost about half of a
      // headless night, and only the in-app report reads them. Callers that
      // want `sim.rec` opt in.
      record: false,
      bbEnabled: true,
      foxyEnabled: true,
      gfEnabled: true,
      boxEnabled: true,
      powerEnabled: true,
      stalledEnabled: true,
      lethal: true,
      durationFrames: C.NIGHT_FRAMES,
      // The two sourced Android camera mechanisms (post-XOR decode):
      // flashes load a 400-frame B countdown from `stun time`, and the
      // selected-camera marker holds Withered (and monitor-up Mangle)
      // pending rolls while it overlaps them. The old passive 400-frame
      // "look timer" on Withereds was a pre-XOR model of the hold; keep it
      // as a legacy diagnostic knob, default off.
      cameraLightStunFrames: C.STUN_FRAMES,
      passiveWitheredLookStunFrames: 0,
      selectedCameraGate: true,
      // Route forks and gates read from the post-scramble Android dump on
      // 2026-09-15 (docs/evidence/withered-freddy-route-night7-20260915.json).
      // Off by default while the censuses are compared; switching it on moves
      // every replay hash, so bundles must be re-emitted when the default flips.
      //   g744      every 1000 ms: decide path = Random(2) + 1 (a global draw)
      //   g376/g377 W. Freddy at CAM 03: decide path 1 -> hall stage 2, 2 -> CAM 07
      //   g378      W. Freddy at hall stage 2, mask fully on, hall light latch
      //             clear -> CAM 03 with B = 5000 - night * 500
      //   g396/g397/g399 Mangle at CAM 02: 1 -> CAM 06, 2 -> CAM 01 -> (hall
      //             light clear) CAM 02
      //   g384/g388 W. Bonnie / W. Chica final hop also needs `in danger` = 0
      //   g344/g347 off Night 7: W. Freddy waits for W. Chica and W. Bonnie to
      //             leave CAM 08; W. Chica waits for W. Bonnie
      //   g352/g356 off Night 7: Toy Freddy / Toy Chica's accepted roll is
      //             discarded while Toy Chica / Toy Bonnie is on CAM 09
      sourcedRouteForks: false,
      // g875-880 write `hall movement` = 300 once per entry into the hall
      // column (C -7), not every frame someone stands there. Read from the
      // dump on 2026-09-15 (docs/evidence/hall-movement-trigger-20260915.json).
      sourcedHallEntry: false,
      // Frame order at a monitor drop and the hall-light latch, read from the
      // dump on 2026-09-15 (docs/evidence/withered-freddy-route-night7-20260915.json):
      //   g614/g618 a drop press only sets `drop everything` (monitor fully up,
      //             mask off); g262 lowers and zeroes `viewing` next frame
      //   g75/g84   `lit?` needs viewing = 0 and mask = 0 as the frame starts
      //             (they run before g262), g94 clears it while in danger,
      //             g445-447/g490 raise in danger later in the frame
      //   g488/g489 the hall latch clears every 1000 ms, then latches from lit?
      //   g745/g855/g864/g846 Foxy's D reset, pin, CAM 08 decrement and retreat
      //             read the latch; g337 zeroes D on every successful roll;
      //             g389/g390 arrival and lock wait while the latch is set;
      //             g573 kills from the latch on any frame, not only on a press
      // So an encounter that starts at a camdrop never lets the hall light
      // latch, and D is not reset. Off by default until the censuses compare.
      sourcedDropLightOrder: false,
      // Where the drop button writes `drop everything` (requires sourcedDropLightOrder). The sheet
      // performs the flag at g262 (monitor v0 2 -> 3, viewing 0) and g274 (mask 2 -> 3), clears it at
      // g612, and only then sets it from a touch: g618 (monitor v0 == 2, v1 == 0, mask == 0) and g619
      // (mask == 2, v1 == 0, viewing == 0, in danger == 0), in the touch folder (group 33, which g0
      // activates on Android; the mouse twins g614/g615 sit in group 32, never activated). The drop
      // button spans the bottom strip under both bars (0-1024 x 678-768 in the pinned rebuild), so
      // a mask-off touch is g619's. So a drop or mask-off touched on update F is performed on F+1.
      // The model raised the flag at the press and tickForcedown spent it on F, one update early:
      // generated events 204_3/210_3/539_3/542_3/543_3 in the rebuilt runtime, whose monitor and
      // mask ledgers show `2>3 +1` on every cycle (tools/recompile, 2026-09-27). On: the press
      // records a touch, g618/g619 read it at their sheet position on that update (after the
      // blackout resolution and tickBox, before g623), and the next tick's forcedown performs it;
      // g619 refuses a mask-off while in danger. A tap carries no release in the Sim queue, so the
      // touch is read on its press update only, where the sheet re-reads a finger still down.
      sourcedDropFlagOrder: false,
      // Foxy as the dump's literal A/B chain (requires sourcedDropLightOrder):
      //   g337  every 5 s, no location/pin/state condition: the Random(5) draw
      //         is spent every time; success writes A=1 and D=0
      //   g349  A=1 -> 2 only once B=0;  g364 B decays one per frame
      //   g389/g390  A=2 moves CAM 08 -> hall, or hall -> marker 123, once the
      //         latch g489 left on the previous frame is clear
      //   g573  123 + viewing 0 + latch + not in danger kills (g571/572: 10 s)
      //   g745 then g824: the latch zeroes D before the 1 s tick adds to it;
      //   g825  the masked +1 runs on the same global 1 s timer
      //   g846  exposure over threshold + lit? 0 + latch 0 + B 0 retreats,
      //         with no position condition, B = 500+Random(500)
      //   g855  B=50 while latched in the hall;  g864 -1 per 500 ms on CAM 08
      // Foxy's B starts at 0 (no night-start writer, empty object values), so
      // the constructor's readyAt draw is not spent under this option.
      sourcedFoxyChain: false,
      // The Office frame's unconditional random draws (docs/evidence/
      // rng-draw-audit-office-20260915.json). Every Random( advances the one
      // global LCG, cosmetic or not, so without these the stream leaves the
      // phone's on the first frame:
      //   g58   every 100 ms  static AV0 = Random(50)+125
      //   g59   every 490 ms  static AV1 = Random(5)*10
      //   g192  every 100 ms  static AV2 = (Random(31)/30)*50   (all three before the g337 rolls)
      //   g822  StartOfFrame  Paper Pals AI = (Random(100)+1)/100, once before the loop
      // g822's condition is (OT=-3, NUM=-1), not Always (OT=-1, NUM=-1).
      // The regenerated CCN dump and on_frame_4_start_events both confirm it.
      // The countdowns (CND_EVERY2: minus the frame delta, fire at <= 0, add the
      // delay back) start from the same instant as the model's own f % N timers,
      // in exact units of 1/3 ms (a 60 fps frame is 50 units), so g58/g192 fire
      // every 6 frames and g59 alternates 29/30. Only the draws are emulated; the
      // values are cosmetic. g497 and g744 are already drawn (tickPuppet,
      // rollDecidePath), but in the opposite order to the sheet -- not fixed here.
      sourcedUnconditionalDraws: false,
      // One draw at events the model already simulates (docs/evidence/
      // rng-draw-audit-office-20260915.json, classification.onModelledEvents):
      //   e478/e484-e487/e489  the resolution that lets a unit inside also draws
      //                        its Random(500) cooldown, not only the defended one
      //   e479-e482  the cameras-up streak sending a unit inside: Random(500)
      //   e351/e352  Balloon Boy CAM 07->03, 03->01: cue Random(4)
      //   e353       CAM 01->05: cue Random(4), then a second Random(4)
      //   e548       after either, a cue of 4 is redrawn with Random(3)
      //   e354       into the opening: Random(4)
      //   e237/e338/e377  the five-tick mask sendback (BB, Mangle, Toy Chica): Random(4),
      //              and the early-leave roll is drawn on that tick too (no short-circuit)
      //   e324       Withered Chica CAM 02->06: Random(4)
      // Values only matter where the sheet branches on them (e548).
      sourcedEventDraws: false,
      // The blackout flicker's per-frame draws (dump g514/g517/g518): while an
      // encounter runs, g514 adds global value 5 -- the frame's elapsed time in
      // 60 fps frames, capped at 4 -- to the blackout clock (OI 131 value 0) from
      // the frame in danger rises; g517 draws Random(50) at clock 21-99 and g518
      // Random(50)+20 at 100-199, both before the g537/g538-555 resolution. At an
      // exact 60 fps that is 179 draws per encounter, on frames 20..198 after the
      // start; a dropped frame on the phone advances the clock by 2 and removes
      // a draw.
      sourcedBlackoutDraws: false,
      // Camera-view draws (dump g344-g360, g458-g477, g366/g368/g419, g498):
      //   an accepted move writes the unit's fade counter C = 10 (g344-g360,
      //   Foxy g349); g458-g467 then take one per frame before g468-g476 draw
      //   Random(100) each frame C > 0 while the your-view marker is on that
      //   unit and a camera is up -- up to 9 frames per accepted move;
      //   g366/g368/g419 draw Random(100) each frame Toy Bonnie / Toy Chica /
      //   Toy Freddy waits in state 2 under your-view with a camera up;
      //   g498 draws Random(100) every 200 ms (timer first, no camera-up
      //   condition) while your-view is on the Puppet (CAM 11 in the box).
      // your-view is `this.cam`, the last camera selected. Approximations: the
      // model marks C at the roll even when the source would hold A = 1 behind a
      // gate, and a toy that moves on its roll frame never waits in state 2.
      // Not emulated: the Puppet's static glitch chain (g500-g505, needs the
      // Puppet out and static value 5) and Paper Pals (g477, not in the model).
      sourcedViewDraws: false,
      // The eleven 5 s movement rolls as the sheet runs them (dump g333-g343):
      // each is a 5000 ms timer then its Random compare, before any state
      // condition, so every roll draws every 5 s whatever the character is doing,
      // in sheet order -- Withered Freddy, Withered Bonnie, Withered Chica, Golden
      // Freddy (g336), Foxy (g337, Random(5)), Toy Freddy, Toy Bonnie, Toy Chica,
      // Mangle, Balloon Boy, Paper Pals (g343). State only gates the outcome.
      // Paper Pals' AI is (Random(100)+1)/100 <= 1, so its roll is spent as a draw.
      sourcedRollDraws: false,
      // The monitor-down image's draw (generated source e7, e211, e720-e722,
      // e871-e872; dump g807): the drop shows the sprite; e720 draws
      // Random(1000000) on a frame it is visible with value 2 = 0 and e721 sets
      // value 2 = 1; e722 resets value 2 the first frame it is invisible; e871
      // zeroes value 0 the first visible frame, e872 adds global value 5 (~1) per
      // visible frame, and e7 hides it the first frame value 0 reaches 22. So one
      // draw per drop, none for a re-drop while the sprite is still showing.
      sourcedMonitorDownDraw: false,
      // The per-second draw groups as one pass in sheet order (dump g213, g292,
      // g294, g400, g401, g436, g437, g439, g440, g494-g497, g556-g559, g623, g730,
      // g739-g744, g747-g750, g781). Each conditional group has its own CND_EVERY2
      // countdown that starts the first frame its earlier conditions hold and only
      // runs on such frames; every roll compares Random(N) == 1 (the Puppet's
      // Random(20) <= AI), and the hits of g292/g400/g439/g748/g749 draw a
      // Random(4) cue, g739-g741 a Random(3). g496 and g497 draw every second
      // whatever the Puppet is doing; g497 and g744 keep the model's f % 60 origin.
      // Adds three groups the model lacked: g213 (Toy Freddy leaves from under the
      // table), g437 (Toy Bonnie leaves during another encounter), g739-g743
      // (Mangle's inside cues). Still not in sheet position relative to these: the
      // camera-view draws (g366-g498), the blackout flicker and the resolution run
      // earlier in the model's frame.
      sourcedSecondPass: false,
      // The Puppet's static glitch chain (dump g500-g506, g774): while your-view is
      // on the Puppet out of his box, away from CAM 11, with a camera up and the
      // light off and the glitch flag (static value 5) at 1, g500-g502 each draw
      // Random(50) (== 1 sets static value 4) and g503 does the same on a 1000 ms
      // countdown placed after the light test; g505 draws Random(150) for the
      // static alpha while value 4 > 0 and takes one off; g506 clears the flag
      // every 110 ms (timer only); g774, later in the sheet, sets the flag while
      // the light is on that Puppet. Placed after the camera-view draws (g498) and
      // before the monitor-down draw (g807).
      sourcedPuppetGlitchDraws: false,
      // The footstep cues (dump g695-g703, generated e620-e628): while a
      // hall-routed character's value 2 is above zero (the 5 s move groups
      // g344-g359 write 10, g458-g466 drain 1 per loop) and it overlaps
      // `hear footsteps` (149), one draw per continuous overlap (the "only one
      // action when event loops" flag): cam01 value 5 = Random(5)+1, or for
      // Mangle value 12 = Random(3)+1. With the instance layout read through
      // the runtime's XOR (docs/evidence/hall-movement-trigger-20260915.json)
      // the marker is overlapped from cam 01, cam 2, cam 3, cam 4, hall stage 1
      // and hall stage 2; `in office` only by some sprites and is left out.
      // So: one draw per roll hop onto one of those markers, in sheet order
      // g695-g703 (W. Freddy, W. Bonnie, W. Chica, W. Foxy, T. Freddy,
      // T. Bonnie, T. Chica, Balloon Boy, Mangle), between the hour table and
      // g730. Foxy's sprite moves at g389 when the hall latch clears, so his
      // draw needs the move within ten loops of g349's acceptance. Requires
      // sourcedSheetOrder.
      sourcedFootstepDraws: false,
      // Research knob under sourcedFootstepDraws: Foxy's hall-stage entry draw (g698 via g389), the least
      // sourced part of the trigger. Off leaves the other eight characters' draws in place.
      footstepFoxy: true,
      // Research knob under sourcedFootstepDraws: also draw on hops onto CAM 01, 02, 03 and 04. The
      // CCN puts them under `hear footsteps` (149): its 264 x 151 image is opaque at every pixel, every
      // character is an opaque 24 x 24 fine-collision sprite whose hotspot lands inside it on those
      // markers, and CSpriteGen.spriteCol_TestSprite_All tests hidden sprites (SF_RAMBO, no hidden
      // check). The rebuilt runtime draws there (Toy Bonnie onto CAM 03). 8a7288b narrowed the set to
      // the hall stages because full-06's audio had no footstep sample on a Withered CAM 01-04 hop;
      // that reading is not evidence: the detector found none of samples 25-29 in that capture, not
      // even on the hall-stage entries 8a7288b kept, and recovers 0 of 60 footsteps injected on the
      // roll phase at the capture's own channel gain (docs/evidence/footstep-cam-markers-adjudication-20260927.json).
      // Off by default until a comparison adopts it.
      footstepCamMarkers: false,
      // Research knob under sourcedFootstepDraws: the cue as g695-g703 test it for the route units (the
      // Withereds, the Toys and Mangle), in place of one draw per hop. Each carries value 2: 10 when its
      // move is promoted (g344-g358: the roll has passed, value 1 is 0, the your-view marker is off its
      // room, Mangle's monitor-down promotion needs the hall light off (g358), before Night 7 the CAM 08/09
      // holds), set again on every passed roll while the move still waits (the roll puts value 0 back to
      // 1), and drained by global 5 per loop (g458-g466). The cue fires on the first loop of value 2 > 0
      // AND on a `hear footsteps` marker ("only one action when event loops"). So a hop within nine loops
      // of its promotion draws; a hop delayed past value 2 (g378's return when the mask comes on later,
      // a light-held edge) is silent; a unit promoted while it stands on a marker draws where it stands;
      // and g378's return onto CAM 03 draws when it lands in the window. Foxy and Balloon Boy keep their
      // rules. (docs/evidence/footstep-cam-markers-adjudication-20260927.json)
      sourcedFootstepValue2: false,
      // g366/g368/g419 draw Random(100) each update a Toy's value 0 == 2 (its move promoted), `your view`
      // overlaps it and `viewing` > 0. A passed roll only sets value 0 = 1; g344-g358 promote it once
      // value 1 (B) is 0 and its route gates open, and g344-g360 write the fade counter C = 10 there, not
      // at the roll. Off: the view draws key on a pending roll, which also covers a roll held at
      // value 0 == 1 by the stun or a Show Stage gate, and the fade is marked at the roll. The schedule
      // replays split on exactly this on all three nights (tools/recompile/README.md, "Winner schedules
      // replayed"): Toy Bonnie held on Night 1, Toy Freddy on Night 5, all three on Night 7.
      sourcedPromotedViewDraws: false,
      // `viewing hall light` is cleared by g488 (Every 1000 ms) and set again by g489 while the light is lit,
      // both AFTER the route moves g380-g383 that test it (g381: W. Bonnie CAM 07 -> hall stage 1 needs it 0).
      // So a move whose second-boundary clears the latch waits one loop: it sees the latch still set. Off: the
      // hooked clock clears the model's latch (lightLogicalUntil) at the top of the tick, before the 5 s rolls
      // and moves, which moves such a unit one loop early (Night 7 k3's first replay mismatch, tick 600).
      sourcedHallLatchOrder: false,
      // g333-g343 roll every character before any promotion (g344-g358) or move (g380 on) runs, so a move's
      // own draw (e324: W. Chica CAM 02 -> 06, Random(4)) lands after the Paper Pals roll. Off: each passed roll
      // is promoted and moved at once, and that draw shifts every later roll of the same loop onto another
      // value (Night 7 k3 at tick 1200: Mangle's roll failed in the model and passed in the rebuild).
      sourcedRollsBeforeMoves: false,
      // A route move needs its unit promoted (value 0 == 2), and the promotion test gates only the promotion.
      // g344-g358 promote a passed roll (value 0 == 1, value 1 == 0) under their own conditions: the your-view
      // marker off a Withered's room (g344-g348), and for Mangle g357 (viewing > 0, marker off her) or g358
      // (viewing == 0 AND `viewing hall light` == 0) on every hop, not only the latch-gated ones. The moves
      // (g374-g435) then test value 0 == 2 and their own conditions (the latch on g376/g377/g381/g382/g394/
      // g395/g399/g421/g422/g431/g432, the final hops' viewing, in danger and office occupied), never value 1
      // or the marker. Off: canAdvance re-tests the stun and the marker at the move and has no g358 gate
      // outside Mangle's latch-gated hops, so a Mangle roll passed on a latched loop moved at once where the
      // sheet promotes her on the loop after g488 clears the latch (Night 7 k3 replay, tick 1800: Mangle
      // CAM 02 -> CAM 01 and her g703 footstep draw one update early).
      sourcedPromotedMoves: false,
      // Mangle's mask leaves (dump g400: the 10%/s roll under the mask; g401: five mask ticks) place her at
      // CAM 7 (marker 62), three hops from the vent, not at the route start the unit table's repelIdx 0 gives.
      // Every other unit's repelIdx matches its dump endpoint (g538-g555, g213, g437, g439/g440, g292/g294).
      // On full-06 the phone's Mangle returned 5-10 s faster than the model on every approach.
      sourcedMangleReturn: false,
      // The music box drain as the sheet writes it (g652-g661). g653-g660: the packed test (music
      // button value 1 == 0 and value 0 > 0), the night (and for night 1 not 12 AM or 1 AM), then a
      // gated Every 50 ms that subtracts 2-6 units of 2000. The countdown loads on its first reach,
      // counts only on loops it is reached and keeps its remainder while winding or empty; the model
      // drained 1/N of the box every frame from the hour frame on, which empties one loop early. Each
      // wind loop sets value 1 to 10 (g638/g643) and g661 drains it by Global(5) per loop after the
      // drain has run, so the drain resumes ten loops after a wind. Runs in the late pass, after the
      // hour update (g627-g630). Requires sourcedSheetOrder.
      sourcedBoxCountdown: false,
      // The Puppet's hop order: g496 arms a hop (sockpuppet value 0 = 2) and g403-g411, earlier in the
      // sheet, carry it out, so a hop lands on the loop after its roll. Under the sheet-ordered pass the
      // model armed in the early pass and moved in tickPuppet the same frame, one loop early; the
      // rebuilt runtime moves on the next loop (office tick 15841 after the tick-15840 roll), and g623's
      // gated Every 1000 loads on arrival, so the early hop moved its Random(10) by a loop. On: the
      // armed hop runs at the g403-g411 position of the next early pass. Requires sourcedSheetOrder.
      sourcedPuppetMoveOrder: false,
      // The hour table where the sheet runs it (g673-g684, story nights). Each row is `night == N`
      // [+ `time of the night == H`] + NotAlways, so hour 0's rows fire on the first loop, in the
      // always pass: after g822's StartOfFrame draw and before g811's. The model applied hour 0 in
      // its constructor, before any frame, so a row's Golden Freddy roll landed ahead of g822. The
      // dump also rolls Golden Freddy's AI on the first loop of nights 3 (g677, (Random(1000)+1)/1000),
      // 4 (g679) and 5 (g681, both (Random(100)+1)/100), which the model's table lacks; the rebuilt
      // runtime spends that draw on office tick 0 of nights 4 and 5. Under the frame-time hook a later
      // hour's rows follow its clock (g627-g630) ahead of g685-g703, as in the sheet. Night 7 keeps
      // the constructor. Requires sourcedSheetOrder.
      sourcedHourTable: false,
      // Where the frame start parks `your view` on Custom Night. g486 (`night <> 7` -> CAM 09) and g487
      // (`night == 7` -> CAM 10) run in the StartOfFrame list before g632 copies `night number` into
      // `night`, and `night` is a frame-local counter (no global flag in the CCN) whose initial value
      // is 0: g486 parks the marker on CAM 09 on every night, and g487 never fires. The rebuilt runtime
      // parks it inside CAM 09's box on Custom Night, and spends no g498 draw when the Puppet reaches
      // CAM 10. The model parked night 7 on CAM 10 (`parkedCamera`). g4's first raise (night 7 by
      // then) still opens CAM 07.
      sourcedParkedMarker: false,
      // Where Custom Night's dials reach the AI counters. g787 (`night == 7` + NotAlways) copies the ten
      // `cust_*` dials on the first loop, after g781, and g821 sets the Puppet's 15 after it. The AI
      // counters are global objects (initial 0, kept between office visits; only the office writes
      // them), so until g787 the first loop reads their value from before the night: 0 on a fresh
      // launch, which this option assumes. g781 is the one office group that tests an AI counter
      // (`Golden Freddy AI > 0`) ahead of its Every, so its 1000 ms countdown first loads on the second
      // loop; the model applied the row in its constructor and loaded it on the first. The rebuilt
      // runtime's first Golden Freddy hall roll at 20/20 is a loop after the model's. On: night 7's row
      // applies at the end of the late pass on frame 1. Requires sourcedSheetOrder.
      sourcedCustomDialOrder: false,
      // The Withereds' CAM 08 departures cancel the others' moves. g380 (W. Bonnie CAM 08 -> CAM 07) also
      // writes `old freddy` and `old chica` value 0 = 0, and g385 (W. Chica CAM 08 -> CAM 04) writes `old
      // freddy` value 0 = 0, wherever those two stand. Value 0 is 1 for an accepted roll and 2 for an armed
      // hop, and the hops run after every roll and arming (g333-g348, then g374-g388: Freddy, Bonnie, Chica),
      // so a Bonnie departure discards Chica's roll of the same loop even after it armed (C = 10 is
      // written), and any pending or gated Freddy or Chica hop. Story nights mostly avoid the case (g344
      // and g347 hold Freddy and Chica while the others stand on CAM 08); Custom Night (g345, g348) does
      // not: at 20/20 the rebuilt runtime armed W. Bonnie and W. Chica on one loop and kept Chica on
      // CAM 08. On: a departure clears the others' pending hops and discards their rolls later in the same
      // model frame. Not covered: a Bonnie departure from the pending path (tickUnits) after Chica's
      // five-second hop in the same frame, which needs the marker to leave CAM 08 on a roll frame.
      sourcedCam8Cancel: false,
      // The vent-camera sound selectors (dump g685-g690, generated e610-e615):
      // one Random(4) into cam01 value 21 the first loop a unit stands on CAM 05
      // (Toy Chica g685, Withered Bonnie g686) or CAM 06 (Toy Bonnie g687,
      // Withered Chica g688, Mangle g689, the Puppet g690), under the "only one
      // action when event loops" flag, which re-arms once the unit has left.
      // They sit between the hour table (g673-g684) and the footstep cues
      // (g695-g703). Requires sourcedSheetOrder.
      sourcedVentCamDraws: false,
      // The office's random image (dump g811, generated e724): Random(1000)
      // into the `random image` counter on the first loop `viewing` is 0
      // after it was above 0 -- once at night start and once per monitor
      // drop, not once per night. Sits after the monitor-down draw (g807) and
      // before g822.
      sourcedRandomImageDraw: false,
      // The monitor raise (dump g254 click / g257 touch on the white button)
      // needs the panel down and still (flip panel v0 = 0 and v1 = 0), the
      // mask fully off (mask v0 = 0), `in danger` = 0 and `being attacked by`
      // = 0. A raise pressed during an encounter's blackout, during a committed
      // attack, with the mask on or mid-animation, or while the panel moves is
      // refused outright. Without this the k3 loop's raise at cycle phase 7.6
      // goes up inside a Toy Bonnie overlay encounter and g546 walks him to
      // marker 123 (observed-press probe, full-06, 2026-09-15).
      sourcedMonitorRaiseGate: false,
      // Sheet order for the draws the model otherwise places by hand (requires
      // sourcedSecondPass). g213-g497 run where the view draws ran, with g366/g368
      // after g294, g419 after g401 and g468-g476 after g440, then g498, g500-g506
      // and g517/g518 -- all before the blackout resolution (g537-g555) and before
      // tickBox: every music box write (g638-g823) sits below g494/g495, so those
      // rolls read the previous frame's box. g556-g781 run after tickBox, with the
      // hour table (g673-g684) between g623 and g730 and g774 between g750 and g781.
      sourcedSheetOrder: false,
      // Frame-time hook (requires sourcedSheetOrder). frameMs(frame) is the loop's
      // rhTimerDelta in whole ms and frameValue5(frame) its global value 5; both
      // are measured inputs, UNKNOWN until the phone supplies them. Null keeps 50
      // timer units (1/3 ms) and 1 per frame, which is trace-identical to no hook.
      // With a hook, the CND_EVERY2 countdowns spend round(ms * 3) units: the
      // per-second pass, g58/g59/g192, g498, g500-g506, and -- as countdowns in
      // place of f % N -- g497, g744, the 5 s rolls (g333-g343, timer first) and
      // the hour clock (g627 adds 1 to AM value 0 each second, g629/g630 advance
      // the hour at 70, the table g673-g684 follows, six hours win). The g514
      // blackout clock adds global value 5 per frame. The model's shared state
      // cadences run on four more countdowns, each a CND_EVERY2 timer in the dump
      // at that period: 1000 ms (g488 latch reset, g570, g824/g825 Foxy D, g904,
      // g907 mask ticks), 500 ms (g864, the g637/g644 wind ticks), 200 ms (g263)
      // and 10000 ms (g571/g572, g718-g721, g722). Foxy's cadences need
      // sourcedFoxyChain. Still frame-counted: the monitor and mask animations,
      // the encounter and attack fuses, pins and stuns, and the entry streak
      // window. Under lethal: false a model kill returns early and
      // skips that frame's countdown reaches, so hooked cadences slip a frame per
      // non-lethal kill (frames the phone never plays).
      // g263 places its 200 ms countdown after `viewing > 0`, so the countdown only runs on
      // frames a camera is displayed and its phase follows the accumulated camera-up time,
      // not frame 0. Off keeps the model's global f % 12 sample (dump g263).
      sourcedLastViewPause: false,
      // The gated one-second countdowns (dump g907, g904, g786/g785, g824,
      // g825, g722, g570). Each is an `Every` placed AFTER other conditions,
      // and CND_EVERY2 only loads and counts down on frames it is reached
      // (Fusion stops at the first false condition), so its fires are spaced
      // in time spent with those conditions true, carrying the remainder
      // between stretches -- not on the global one-second grid the model
      // otherwise uses for them:
      //   g907  mask == 2, then Every 1000 -> Toy Chica, Mangle and Balloon
      //         Boy value 12 += 1 (g293 zeroes it entering mask == 2; g294,
      //         g401, g440 send the vent occupant back at >= 5). A fully-on
      //         window of 4551 ms therefore gets 4 or 5 ticks by the carried
      //         remainder at ANY phase, not 5 at every lucky phase. (Kept
      //         from the model: value 12 counts only while the unit is at
      //         122; the dump counts from the stretch start, which differs
      //         only for Toy Chica, whose g435 entry can land mid-stretch.)
      //   g904  Toy Chica at marker 122, then Every 1000 -> value 8 += 1
      //   g786  viewing > 0, then Every 1000 -> the cams-up streak (old freddy
      //         value 25) += 1; g785 zeroes it once viewing is 0; g542-g545
      //         read it (>= 20 - 2 * night, viewing > 0) for the streak entry
      //   g824  in danger == 0, then Every 1000 -> Foxy's D += 1
      //   g825  in danger 0, mask 2, nobody at 122, then Every 1000 -> D += 1
      //   g722  Toy Bonnie at marker 123, viewing > 0, then Every 10000
      //   g570  hallway Golden Freddy at 123, being attacked by 0, Every 1000
      // Default off: switching it on moves replays and the census.
      sourcedGatedEvery: false,
      // The countdowns' origin, from classes.dex (2026-09-27): CRun.initRunLoop
      // runs no events; the first f_GameLoop runs the StartOfFrame list once
      // (CEventProgram.compute_TimerEvents, then zeroes its pointer) and then
      // the first always pass, where every CND_EVERY2 is first reached and
      // loads (eva2 offsets 7..46, returns false). So the g822 draw and every
      // countdown's load share one loop, and Every 100 ms first fires on the
      // seventh. The model spends g822 on frame 1 but counts its countdowns as
      // loaded on a frame 0 it never plays (32e3cf6), one loop early; the
      // rebuilt runtime (tools/recompile) fires g58/g192 on its seventh update,
      // model frame 7, where the model fires them on frame 6. On: a countdown
      // first reached on frame 1 loads there, like any later first reach.
      // Requires the frame-time hook, whose countdowns replace the f % N
      // cadences (identical to them at 50/3 ms, frame-time-hook.test.js).
      sourcedEveryOrigin: false,
      frameMs: /** @type {null | ((frame: number) => number)} */ (null),
      frameValue5: /** @type {null | ((frame: number) => number)} */ (null),
    }, opts);

    if (this.opts.customNight && this.opts.night !== 7)
      throw new Error('customNight requires night: 7 (Custom Night is night 7 in the menus)');
    if (this.opts.sourcedFoxyChain && !this.opts.sourcedDropLightOrder)
      throw new Error('sourcedFoxyChain reads the hall latch: it requires sourcedDropLightOrder');
    if (this.opts.sourcedDropFlagOrder && !this.opts.sourcedDropLightOrder)
      throw new Error('sourcedDropFlagOrder moves the drop flag: it requires sourcedDropLightOrder');

    this.rng = new Rng(this.opts.seed, this.opts.worst);
    this.frame = 0;
    this.events = [];
    this.alive = true;
    this.won = false;
    this.death = null;

    // --- player-controlled state
    this.monitor = MON_DOWN;
    this.monAnim = 0;
    this.camsUpCount = 0;
    // frame the current cams-up session started (-1 = monitor down); the
    // sourced entry timer counts against this streak, not time-in-opening
    this.camsUpSince = -1;
    // Android carries camera selection in two fields. `cam` is the parked
    // `your view` marker (flash target / look-hold); `viewing` is counter 55
    // (picture, winding, flash immunity). Camera touches write both. A raise
    // restores only `viewing` from the sampled `lastViewed`, which is how the
    // double-camera glitch makes them disagree.
    // sourcedParkedMarker: g486/g487 read `night` at its initial 0, before g632 sets it.
    this.cam = C.parkedCamera(this.opts.sourcedParkedMarker ? 0 : this.opts.night);
    this.viewing = 0;
    this.lastViewed = 0;
    /** g685-g690 "only one action" flags per unit (sourcedVentCamDraws) */
    this.ventCamDrawn = {};
    /** @type {Record<string, number>} the frame g380/g385 last zeroed a Withered's value 0 (sourcedCam8Cancel) */
    this.cam8CancelAt = {};
    /** g811 "only one action" flag: armed until the draw, re-armed while viewing > 0 (sourcedRandomImageDraw) */
    this.randomImageArmed = true;
    this.hasViewedCamera = false;
    this.maskOn = false;
    this.maskAnim = 0;
    this.lightHeld = false;
    this.lightLogicalUntil = -1;
    this.hallLatchResetDue = false;   // g488's one-second reset, deferred past the moves (sourcedHallLatchOrder)
    this.winding = false;
    this.ventLightL = false;
    this.ventLightR = false;

    // --- resources
    this.power = C.powerFrames(this.opts.night);
    this.box = 1;
    this.boxHold = 0;   // music button value 1: 10 on a wind loop, -Global(5) per loop (sourcedBoxCountdown)

    // --- AI levels (g673-684 and the caps). Every roll below reads this map
    // rather than a 10/20 constant, because nights below 7 change level by the
    // hour: night 6 alone switches the three Toys on and takes Balloon Boy
    // from 5 to 9 at 2 AM. Starting from zero is g673, which clears every
    // counter on any night but Custom -- and Custom writes every dial anyway.
    this.ai = Object.fromEntries(C.AI_IDS.map(id => [id, 0]));
    // else g673-g684 (story nights) or g787/g821 (Custom Night) on frame 1
    if (!(this.opts.sourcedHourTable && this.opts.night !== 7) &&
        !(this.opts.sourcedCustomDialOrder && this.opts.night === 7)) this.applyAiHour(0);

    // --- Foxy
    this.foxy = { loc: 'parts', hallColumn: false, footstep: false, acceptedAt: -100, D: 0, exposure: 0, gotYou: false, pinUntil: -1, A: 0, B: 0,
                  readyAt: this.opts.sourcedFoxyChain ? 0
                    : this.rng.int(C.FOXY_ENTER_MIN, C.FOXY_ENTER_MAX, C.FOXY_ENTER_MIN) };
    this.maskDAccum = 0;

    // --- Golden Freddy (office) + the separate hallway version
    this.gf = {
      present: false, inHall: false, hallExposure: 0,
      hallInside: false, attackAt: -1,
    };
    // `hall movement`: refreshed to 300 frames whenever someone transits the
    // hall, and Golden Freddy's hall exposure is blocked while it runs.
    this.hallMovementUntil = -1;
    this.hallColumnOccupied = false;

    // --- Balloon Boy
    this.bb = { stage: 0, footstep: false, pending: false, inOpening: false, openingAtCamsUp: -1,
                maskTicks: 0, inside: false };
    // Mangle's s0020 static is raised in two proximity contexts: while she is
    // on CAM 11 (the winding/Prize Corner camera) and at the office/right-vent
    // edge. They use the same sample but are separate policy facts; only the
    // latter is actionable. Observer applies the audio transport/error model.
    this.mangleStatic = { office: false, cam11: false };


    // --- blackout
    this.blackout = { active: false, until: 0, by: null, unitId: null, masked: false, deadline: 0 };
    this.blackoutCount = 0;
    this.blackoutStartFrame = -1;   // the frame the running encounter began (sourcedBlackoutDraws)
    this.puppetStaticTimer = 600;   // g498 200 ms countdown in 1/3 ms units (sourcedViewDraws)
    /** @type {Record<string, number>} last frame each unit's fade counter is above 0 (sourcedViewDraws) */
    this.fadeUntil = {};
    // the monitor-down sprite (sourcedMonitorDownDraw)
    this.monDown = { visible: false, av0: 0, av2: 0, pendingDrop: false, hidePrev: false, invPrev: false, visPrev: false };
    /** @type {Record<string, {v: number, init: boolean}>} per-group CND_EVERY2 countdowns (sourcedSecondPass) */
    this.passTimers = {};
    // the Puppet static glitch chain (sourcedPuppetGlitchDraws); timer units are 1/3 ms
    this.glitch = { value4: 0, value5: 0, g503: { v: 0, init: false }, g506: { v: 0, init: false } };
    // the frame-time hook: this loop's timer units, the countdowns that replace f % N, the AM clock, the g514 clock
    this.hooked = !!(this.opts.frameMs || this.opts.frameValue5);
    this.frameUnits = 50;
    this.hookTimers = { five: { v: 0, init: false }, g497: { v: 0, init: false },
                        g744: { v: 0, init: false }, g627: { v: 0, init: false },
                        sec: { v: 0, init: false }, half: { v: 0, init: false },
                        sample: { v: 0, init: false }, ten: { v: 0, init: false } };
    // this loop's shared cadence events under the hook (1000 / 500 / 200 / 10000 ms)
    this.secTick = false; this.halfTick = false; this.sampleTick = false; this.tenTick = false;
    this.lastViewTimer = { v: 0, init: false };   // g263 under sourcedLastViewPause
    /** @type {Record<string, {v: number, init: boolean}>} the gated countdowns (sourcedGatedEvery) */
    this.gatedEvery = {};
    this.maskTick = false;     // g907 fired this frame (sourcedGatedEvery)
    this.streakTicks = 0;      // old freddy value 25, the cams-up streak (sourcedGatedEvery)
    this.am = 0;
    this.hour = 0;
    this.blackoutClock = 0;
    this.blackoutClockFrame = -1;
    // `drop everything` (g141): the forcedown flag. Set by g718-721, g624 and
    // g574; executed on the monitor by g262 and on the mask by g274, then
    // cleared by g612.
    this.dropEverything = false;
    // the update a drop-button touch landed on (frame before its tick), read there by g618/g619 (sourcedDropFlagOrder)
    if (this.opts.sourcedDropFlagOrder) this.dropTouch = -1;

    // --- the seven
    this.units = C.STALLED.map(u => ({
      ...u, idx: 0, stunUntil: -1, pending: false, atOpening: false,
      openingSince: -1, openingReadyAt: -1, officeCue: false,
      openingTicks: 0, maskExposureTicks: 0, raiseSeen: false, inside: false,
      insideArmed: false, insideDangerAt: -1, committedAt: -1, done: false,
      hallColumn: false,   // overlapping `hall movement` last frame (sourcedHallEntry)
      footstep: false,     // a roll hop onto a `hear footsteps` marker, drawn at g695-g703 (sourcedFootstepDraws)
      value2: 0,           // value 2: 10 at promotion, drained by global 5 per loop (sourcedFootstepValue2)
      promoted: false,     // value 0 == 2: the move is promoted and waits for its own conditions
      footstepOn: false,   // g695-g703's condition on the previous loop (only one action when event loops)
    }));
    // sourced `chicalookatyou` lock: one mutex-flagged attacker engages at a time
    this.engagedToy = null;
    // g744's `decide path` (1 or 2). Rolled at 1 s, before any unit can reach
    // a fork (first movement roll at 5 s), so the unread initial value is moot.
    this.decidePath = 0;
    this.hallLatch = false;   // `viewing hall light` under sourcedDropLightOrder
    this.hallLit = false;     // `lit?` (g75/g84/g94) from frame-start state, under sourcedFoxyChain
    // g58, g59, g192 countdowns in 1/3 ms units (sourcedUnconditionalDraws)
    if ((this.opts.frameMs || this.opts.frameValue5) && !this.opts.sourcedSheetOrder)
      throw new Error('the frame-time hook drives the sheet-ordered countdowns: it requires sourcedSheetOrder');
    if ((this.opts.frameMs || this.opts.frameValue5) && this.opts.foxyEnabled && !this.opts.sourcedFoxyChain)
      throw new Error('the frame-time hook times Foxy through g824/g825/g864: it requires sourcedFoxyChain');
    if (this.opts.sourcedEveryOrigin && !(this.opts.frameMs || this.opts.frameValue5))
      throw new Error('sourcedEveryOrigin moves the countdowns, and only the frame-time hook runs every cadence as one: it requires frameMs or frameValue5');
    if (this.opts.sourcedHourTable && !this.opts.sourcedSheetOrder)
      throw new Error('sourcedHourTable applies the table in the sheet-ordered pass: it requires sourcedSheetOrder');
    if (this.opts.sourcedCustomDialOrder && !this.opts.sourcedSheetOrder)
      throw new Error('sourcedCustomDialOrder applies the dials in the sheet-ordered pass: it requires sourcedSheetOrder');
    if (this.opts.sourcedPuppetMoveOrder && !this.opts.sourcedSheetOrder)
      throw new Error('sourcedPuppetMoveOrder moves the Puppet in the sheet-ordered pass: it requires sourcedSheetOrder');
    if (this.opts.sourcedBoxCountdown && !this.opts.sourcedSheetOrder)
      throw new Error('sourcedBoxCountdown drains in the sheet-ordered pass: it requires sourcedSheetOrder');
    if (this.opts.sourcedVentCamDraws && !this.opts.sourcedSheetOrder)
      throw new Error('sourcedVentCamDraws draws in the sheet-ordered pass: it requires sourcedSheetOrder');
    if (this.opts.sourcedFootstepDraws && !this.opts.sourcedSheetOrder)
      throw new Error('sourcedFootstepDraws draws in the sheet-ordered pass: it requires sourcedSheetOrder');
    if (this.opts.sourcedFootstepValue2 && !this.opts.sourcedFootstepDraws)
      throw new Error('sourcedFootstepValue2 changes when the footstep cue draws: it requires sourcedFootstepDraws');
    if (this.opts.sourcedHallLatchOrder && !this.opts.frameMs)
      throw new Error('sourcedHallLatchOrder moves the hooked one-second latch reset: it requires frameMs');
    if (this.opts.sourcedPromotedViewDraws && !this.opts.sourcedViewDraws)
      throw new Error('sourcedPromotedViewDraws changes which view draws fire: it requires sourcedViewDraws');
    if (this.opts.sourcedSheetOrder && !this.opts.sourcedSecondPass)
      throw new Error('sourcedSheetOrder orders the per-second pass: it requires sourcedSecondPass');
    if (this.opts.sourcedUnconditionalDraws && C.FPS !== 60)
      throw new Error('sourcedUnconditionalDraws assumes a 60 fps frame (50 timer units)');
    this.unconditionalTimers = [{ group: 58, delayUnits: 300, counter: 300 },
                                { group: 59, delayUnits: 1470, counter: 1470 },
                                { group: 192, delayUnits: 300, counter: 300 }];
    this.unconditionalDraws = 0;

    // --- puppet
    this.puppet = {
      stage: 0, out: false, route: null, idx: -1, loc: 11,
      pending: false, pathChoice: 'left', stunUntil: -1,
      atOpening: false, inside: false, attackAt: -1,
    };

    // --- recording for the post-run report
    if (this.opts.record) {
      const n = this.opts.durationFrames + 2;
      this.rec = {
        n: 0,
        stun: [new Uint16Array(n), new Uint16Array(n), new Uint16Array(n)], // cams 10,4,7
        occ: new Uint8Array(n),   // bit per target cam: is anyone standing there
        d: new Uint8Array(n),
        power: new Uint16Array(n),
        box: new Uint8Array(n),
        flags: new Uint8Array(n), // bit0 mask, bit1 camsUp, bit2 light, bit3 bbOpening, bit4 gf
      };
    }
    this.mistakes = [];
  }

  // ---------------------------------------------------------------- helpers
  // The rows that fire as `hour` begins, capped as g829/g830/g856-863 cap them.
  applyAiHour(hour) {
    for (const row of C.aiUpdates(this.opts.night, hour, this.opts.customNight)) {
      for (const [id, level] of Object.entries(row.set)) {
        const value = typeof level === 'number' ? level : this.rollAi(level.oneIn);
        this.ai[id] = Math.min(value, C.aiCap(id));
      }
    }
    // g677/g679/g681: Golden Freddy's first-loop roll on nights 3-5 (sourcedHourTable)
    const golden = this.opts.sourcedHourTable && hour === 0 ? SOURCED_HOUR0_GOLDEN[this.opts.night] : undefined;
    if (golden) this.ai.golden = Math.min(this.rollAi(golden), C.aiCap('golden'));
  }

  // `(Random(N) + 1) / N` under integer division: one only on the top draw.
  rollAi(oneIn) {
    return this.rng.int(0, oneIn - 1, oneIn - 1) === oneIn - 1 ? 1 : 0;
  }

  // A deep, restorable copy of every mutable field. Plan 16 package 1: a tree
  // search needs to branch a run without re-simulating from frame 0. All state
  // is plain data plus `this.rng` (a class instance restored by its own
  // state), so a JSON round-trip is exact -- verified bit-identical over a
  // 1500-tick continuation. `opts` is shared by reference: it is never
  // mutated after construction.
  snapshot() {
    const snap = JSON.parse(JSON.stringify(this, (k, v) => (k === 'opts' || k === 'rec') ? undefined : v));
    snap.rng = { seed: this.rng.seed, state: this.rng.state, worst: this.rng.worst };
    return snap;
  }
  restore(snap) {
    const rngProto = Object.getPrototypeOf(this.rng);
    for (const k of Object.keys(this)) if (k !== 'opts' && k !== 'rec' && k !== 'rng') delete this[k];
    Object.assign(this, JSON.parse(JSON.stringify(snap)));
    this.rng = Object.assign(Object.create(rngProto), snap.rng);
    return this;
  }
  static fromSnapshot(opts, snap) { return new Sim(opts).restore(snap); }

  get t() { return this.frame / C.FPS; }
  get camsUp() { return this.monitor === MON_UP; }
  get maskFullyOn() { return this.maskOn && this.maskAnim === 0; }
  // `being attacked by` (g560-562 set it per unit at marker 123).
  // `being attacked by` (object 136): the COMMITTED attack, which g267/g270
  // read to refuse the mask and g624 reads to force everything down. It is
  // NOT `got you stage` == 1 (the reaction countdown) -- conflating the two
  // is the 2026-08-26 defect recorded in config.js.
  get attackExecuting() { return this.units.some(u => u.committedAt >= 0); }
  get puppetAttackExecuting() { return this.puppet.attackAt >= 0; }
  get goldenHallAttackExecuting() { return this.gf.attackAt >= 0; }
  get hallView() { return this.monitor !== MON_UP; }
  // `white button` follows the physical hold. `new bonnie`, the office-light
  // movement latch, survives release until the next one-second scheduler tick.
  get lightLogical() { return this.lightHeld && !this.maskOn && !this.bb.inside; }
  // [SOURCED] g75/g84 (hall light) and g302/304 (vent lights) all require
  // `mask` = 0: wearing the mask turns every office light off outright. A
  // masked player can only take the mask off.
  get lightStallOn() { return this.frame < this.lightLogicalUntil; }
  get anyOfficeLightHeld() {
    // [SOURCED] g301/g303/g320 re-assert the vent lights every frame and each
    // requires `mask` = 0 AND `viewing` = 0, so a vent light cannot be held
    // while a camera is up. `lightHeld` keeps no view condition because
    // g76/g77 is the camera light, which does answer with the monitor up.
    // Correcting this on 2026-09-09: the vent terms were ungated, so the
    // simulator credited a vent press taken with the monitor up. A device plan
    // was built on that credit and scored 3000/3000 for a press the phone
    // spends on the camera flash instead.
    return this.maskFullyOff && !this.bb.inside && !this.blackout.active &&
      (this.lightHeld || ((this.ventLightL || this.ventLightR) && this.hallView));
  }
  // [SOURCED: g75 (hall), g76/g77 (camera), g301/g303/g320 (vent)] Every light
  // in the office is gated on `mask` = 0 and `in danger` = 0. The mask counter
  // is a four-state animation -- 0 off, 1 raising (g267/g270), 2 fully on (g9),
  // 3 lowering (g274) -- so "mask off" is not the press, it is the end of the
  // mask-off animation: the post-mask flash lockout IS that animation. And
  // `in danger` is the office-encounter latch, raised by g443-447/g490 and
  // cleared by the endpoint resolutions g538-555, so no light answers at all
  // while an encounter is running (g83/g88 do not even register the touch).
  get maskFullyOff() { return !this.maskOn && this.maskAnim === 0; }
  get hallLightOn() {
    return this.lightHeld && this.hallView && this.maskFullyOff &&
      !this.bb.inside && !this.blackout.active;
  }
  // The vent lights carry the same gate, re-tested every frame: g299 clears
  // both on a 200 ms timer and only g301/g303/g320 re-assert them, so a vent
  // light already held goes out the moment the mask starts going on.
  get ventLightLOn() {
    return this.ventLightL && this.hallView && this.maskFullyOff &&
      !this.bb.inside && !this.blackout.active;
  }
  get ventLightROn() {
    return this.ventLightR && this.hallView && this.maskFullyOff &&
      !this.bb.inside && !this.blackout.active;
  }
  // g76/g85 exclude a BB at 123, but g77/g86 -- the `viewing = 10` pair -- do
  // not, so CAM 10 is the one camera he leaves you.
  get camLightOn() {
    return this.lightHeld && this.monitor === MON_UP && !this.blackout.active &&
      this.viewing > 0 && (!this.bb.inside || this.viewing === 10);
  }
  get bars() { return Math.max(0, Math.min(4, Math.floor((this.power - C.POWER_PER_BAR) / C.POWER_PER_BAR))); }
  // Holding the wind button only winds when you are actually on the box camera.
  // Anything else -- cams down, wrong camera -- is a finger doing nothing.
  get isWinding() {
    return this.winding && this.monitor === MON_UP && this.viewing === C.BOX_CAM;
  }

  // Keep event objects JSON-stable: snapshot()/restore() deliberately uses a
  // JSON round-trip, which drops an own property whose value is undefined.
  // Omitting an absent payload at emission time preserves event identity on a
  // branch restore while callers can still read event.data as undefined.
  emit(type, data) {
    const event = { f: this.frame, type };
    if (data !== undefined) event.data = data;
    this.events.push(event);
  }
  flag(code, detail) { this.mistakes.push({ f: this.frame, t: this.t, code, detail }); }

  syncMangleStatic() {
    const mangle = this.units.find(u => u.id === 'mangle' && !u.done);
    const next = {
      office: !!mangle?.atOpening,
      cam11: !!mangle && !mangle.atOpening && mangle.path[mangle.idx] === C.BOX_CAM,
    };
    for (const context of ['office', 'cam11']) {
      if (next[context] === this.mangleStatic[context]) continue;
      this.mangleStatic[context] = next[context];
      this.emit('mangle-static', {
        context,
        present: next[context],
        sample: C.MANGLE_STATIC_SAMPLE,
      });
    }
  }

  kill(reason, detail) {
    if (!this.alive || !this.opts.lethal) { if (!this.opts.lethal) this.flag('would-die', reason); return; }
    this.alive = false;
    this.death = { reason, detail, frame: this.frame, t: this.t };
    this.emit('death', this.death);
  }

  // ------------------------------------------------------------------ input
  press(action) {
    if (!this.alive) return;
    // Two input gates the engine had never enforced, both about reachability
    // rather than effect:
    //
    // 1. The mask cannot go on with the monitor up. There is no state in which
    //    both are raised, so a mask press while the cams are up is not a
    //    toggle -- it is an input the player cannot make.
    // 2. While the mask is on, the only control that answers is the mask
    //    itself. This is the input-side half of the g75/g84 lockout the light
    //    getters already model: a masked player can only take the mask off.
    //
    // Both matter for an open-loop pilot, whose table presses buttons without
    // checking what state the game is actually in: presses that the device
    // silently drops must be dropped here too, or the simulation flatters a
    // schedule that the phone would not execute.
    // `maskOn` is the steady endpoint, while `maskAnim` also covers the
    // lowering interval after the off press. During that interval the mask is
    // still the visible/input-owning surface; clearing maskOn early must not
    // make the simulator accept monitor, camera, light, or wind touches that
    // the phone draws on the mask and drops.
    if ((this.maskOn || this.maskAnim > 0) && action !== 'mask') return;
    if (action === 'mask' && !this.maskOn &&
        (this.monitor === MON_UP || this.monitor === MON_RAISING)) return;
    // Puppet at marker 123 has already written `being attacked by` (g574),
    // so g267/g270 no longer accept a new mask press during his 40-frame
    // attack transition.
    if (action === 'mask' && !this.maskOn &&
        (this.puppetAttackExecuting || this.goldenHallAttackExecuting)) return;
    // g267/g270 require `being attacked by` (136) = 0, so a COMMITTED attack
    // refuses the mask. Corrected 2026-08-26: this used to read the reaction
    // countdown (`got you stage` == 1) instead, and so forbade for the whole
    // window the one action g533 says ends it. No withered that reached the
    // office was survivable in this simulator until that was split apart.
    if (action === 'mask' && !this.maskOn && this.attackExecuting) return;
    // sourcedDropFlagOrder: with the mask on, the touch lands on the drop button; g619 reads it at
    // its sheet position (mask == 2 by then, even if g9 finished the put-on at this update's top).
    if (action === 'mask' && this.maskOn && this.opts.sourcedDropFlagOrder) { this.dropTouch = this.frame; return; }
    // The mask answers only at rest. g270 puts it on from `mask` == 0 and g615
    // takes it off from `mask` == 2; states 1 and 3 are the put-on and
    // take-off animations (g9 moves 1 -> 2 after 12 frames), and no group
    // accepts a touch there. The simulator used to toggle mid-animation, so it
    // scored minus7's Night 1 clear cycle -- mask on inside its read, off 133
    // ms later in the maskraise -- as a winner while the phone dropped that
    // press on 48 of 55 cycles (night1-minus7-n1-first-20260919T215533Z) and
    // 23 of 45 (night1-ladder-n1a-20260927T053211Z, 2026-09-27).
    if (action === 'mask' && this.maskAnim > 0) return;
    if (action === 'light') {
      this.lightHeld = true;
      this.onLightPress();
    } else if (action === 'mask') {
      this.setMask(!this.maskOn);
    } else if (action === 'monitor') {
      const lower = this.monitor === MON_UP || this.monitor === MON_RAISING;
      if (!lower && this.opts.sourcedMonitorRaiseGate &&
          (this.monitor !== MON_DOWN || !this.maskFullyOff || this.blackout.active || this.attackExecuting)) {
        this.flag('invalid-input', 'g254/g257: monitor raise refused (panel moving, mask not fully off, in danger, or being attacked)');
        return;
      }
      if (lower && this.opts.sourcedDropLightOrder) {
        // g614/g618: the drop button only raises the flag, and only from a
        // fully-up monitor with the mask off; g262 performs it next frame.
        // sourcedDropFlagOrder: g618 reads the touch at its sheet position (readDropTouch).
        if (this.opts.sourcedDropFlagOrder) this.dropTouch = this.frame;
        else if (this.monitor === MON_UP && this.maskFullyOff) this.dropEverything = true;
        return;
      }
      this.setMonitor(!lower);
    } else if (action === 'wind') {
      this.winding = true;
    } else if (action === 'ventL' || action === 'ventR') {
      // Loud rejection: the press is recorded, but a vent light asserted with a
      // camera up lights nothing (g301/g303/g320 require `viewing` = 0). Flag it
      // so a plan search or gate sees a wasted contact instead of silently
      // banking an effect the phone cannot produce.
      if (!this.hallView) this.flag('invalid-input', `${action} pressed with a camera up: g301/g303/g320 require viewing = 0`);
      if (action === 'ventL') this.ventLightL = true; else this.ventLightR = true;
    }
    else if (action.startsWith('cam:')) {
      const n = +action.slice(4);
      if (this.monitor === MON_UP && C.CAMS[n]) {
        this.cam = n;
        this.viewing = n;
      }
    }
  }

  release(action) {
    if (action === 'light') this.lightHeld = false;
    else if (action === 'wind') this.winding = false;
    else if (action === 'ventL') this.ventLightL = false;
    else if (action === 'ventR') this.ventLightR = false;
  }

  /** g75/g84 -> g94 -> (g262, g445-447 later) -> g488 -> g489, from frame-start state. */
  updateHallLatch(f, lit = this.hallLitNow()) {
    if (this.hooked ? this.secTick : f % C.FPS === 0) this.hallLatch = false;   // g488
    if (lit) this.hallLatch = true;                // g489
  }

  /**
   * `lit?` as the persistent counter the touch events leave it before the drop
   * (Chowdren names, Office events 74-83): held light sets it with viewing 0 and
   * the mask off (74), on any camera but 10 (75) or on CAM 10 (76); release (79),
   * no battery (80), in danger (81), the mask reaching fully on (82) and Balloon
   * Boy inside (83) clear it. The drop (211) zeroes viewing later in the same
   * frame and in danger rises later still (382-384), so a camera light held
   * through the drop still latches the hall on the drop frame (426).
   */
  updateLitCounter() {
    if (!this.lightHeld) this.hallLit = false;                                    // 79
    else if ((this.viewing === 0 && this.maskFullyOff && !this.bb.inside) ||      // 74
             (this.viewing > 0 && this.viewing !== 10 && !this.bb.inside) ||      // 75
             this.viewing === 10) this.hallLit = true;                            // 76
    if (this.power <= 0 || this.blackout.active || this.maskFullyOn || this.bb.inside) this.hallLit = false; // 80-83
  }

  /** g75/g84 set lit? with viewing 0 and the mask off; g94 clears it in danger. */
  hallLitNow() {
    return this.lightHeld && this.viewing === 0 && this.maskFullyOff &&
      !this.blackout.active && !this.bb.inside && this.power > 0;
  }

  onLightPress() {
    if (this.opts.sourcedDropLightOrder) {
      // g573 reads the latch every frame (tickFoxy); only Golden Freddy's
      // press branch stays here.
      if (this.hallView && this.gf.present) { this.kill('golden-freddy', 'Flashed the hall with Golden Freddy in the office'); }
      return;
    }
    if (this.hallView) {
      // g573 (Foxy's instant kill on a monitor-down hall flash) precedes g778
      // (Golden Freddy's flash kill) in event-group order, and g573 "kills
      // through" Golden Freddy already being present -- his kill is not
      // suppressed or gated by Golden Freddy's presence. Foxy is checked
      // first so a simultaneous lock-on is never masked by the GF branch's
      // early return.
      if (this.foxy.gotYou) { this.kill('foxy', 'Flashed the hall after Foxy locked on (D exceeded 3 at a 5s check)'); return; }
      if (this.gf.present) { this.kill('golden-freddy', 'Flashed the hall with Golden Freddy in the office'); return; }
    }
  }

  setMask(on) {
    if (this.maskOn === on) return;
    this.maskOn = on;
    this.maskAnim = on ? C.MASK_ANIM_ON : C.MASK_ANIM_OFF;
    if (on) {
      // g776 dismisses him only once `mask` = 2 -- after the put-on animation
      // (see the maskAnim completion in tick()), not at the press.
    } else {
      // For the four shared office attackers, taking the mask back off after
      // they have reached marker 123 immediately raises `danger 2`
      // (Android groups 560-563).
      for (const u of this.units) {
        if (u.inside && u.openingRule === 'streak')
          this.commitAttack(u, 'mask was removed with an attacker inside the office');
      }
    }
  }

  setMonitor(up) {
    if (up && (this.monitor === MON_UP || this.monitor === MON_RAISING)) return;
    if (!up && (this.monitor === MON_DOWN || this.monitor === MON_LOWERING)) return;
    if (up) {
      if (this.gf.present) { this.kill('golden-freddy', 'Raised the monitor with Golden Freddy in the office'); return; }
      this.monitor = MON_RAISING; this.monAnim = C.MONITOR_ANIM_UP;
      // Mangle's marker-122 flag is set while the monitor-raise object is
      // visible (group 402), then consumed when that object disappears.
      for (const u of this.units) {
        if (u.id === 'mangle' && u.atOpening) u.raiseSeen = true;
      }
      this.camsUpSince = this.frame; // the source counter runs from the tap
    } else {
      this.monitor = MON_LOWERING; this.monAnim = C.MONITOR_ANIM_DOWN;
      if (this.opts.sourcedMonitorDownDraw) this.monDown.pendingDrop = true;   // e211 shows the sprite
      // g262 clears the displayed feed immediately but leaves the marker and
      // sampled last-viewed camera untouched.
      this.viewing = 0;
      this.winding = false;
      this.camsUpSince = -1; // the source resets the streak on lowering
      // The monitor-lowering object (`blip`) raises `danger 2` for the six
      // regular marker-123 occupants (groups 564-569). Mangle instead needs
      // her separate cameras-up random arm from groups 730-731.
      for (const u of this.units) {
        if (!u.inside) continue;
        if (u.id === 'mangle') {
          if (u.insideArmed) this.commitAttack(u, 'Mangle armed while the cameras were up');
        } else {
          this.commitAttack(u, 'lowered the monitor with an attacker inside the office');
        }
      }
    }
  }

  /**
   * Camera-view draws in sheet order (sourcedViewDraws); `this.cam` is the
   * your-view marker, the last camera selected.
   * @param {number} f
   */
  drawViewed(f, part = 'all') {
    const up = this.viewing > 0, all = part === 'all';
    /** @type {Record<string, string>} */
    const toyGroup = { toybonnie: 'g366', toychica: 'g368', toyfreddy: 'g419' };
    /** @param {string} id */
    const nodeOf = id => {
      if (id === 'bb') return this.bb.inOpening || this.bb.inside ? null : ([10, 7, 3, 1, 5][this.bb.stage] ?? null);
      if (id === 'foxy') return this.opts.foxyEnabled && this.foxy.loc === 'parts' ? 8 : null;
      const u = this.units.find(x => x.id === id);
      return !u || u.done || u.atOpening || u.inside ? null : u.path[u.idx];
    };
    if (up) for (const id of ['toybonnie', 'toychica', 'toyfreddy']) {                       // g366, g368, g419
      const u = this.units.find(x => x.id === id);
      const armed = u?.pending && (!this.opts.sourcedPromotedViewDraws || u.promoted);   // value 0 == 2
      if ((all || part === toyGroup[id]) && armed && nodeOf(id) === this.cam) this.rng.int(0, 99, 0);
    }
    if (up && (all || part === 'fades')) for (const id of ['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy',
                              'toybonnie', 'toychica', 'mangle', 'bb']) {                      // g468-g476
      if (f <= (this.fadeUntil[id] ?? -1) && nodeOf(id) === this.cam) this.rng.int(0, 99, 0);
    }
    if (!all && part !== 'g498') return;
    if (!(this.opts.sourcedEveryOrigin && this.frame === 1)) this.puppetStaticTimer -= this.frameUnits;   // g498
    if (this.puppetStaticTimer <= 0) {
      this.puppetStaticTimer += 600;
      const p = /** @type {any} */ (this.puppet);
      const at = !p.out ? C.BOX_CAM : (typeof p.loc === 'number' ? p.loc : null);
      if (at === this.cam) this.rng.int(0, 99, 0);
    }
  }

  /** e7 (hide once value 0 reaches 22), then the drop's e211 (show). */
  monitorDownEarly() {
    const m = this.monDown;
    const reached = m.av0 >= 22;
    if (reached && !m.hidePrev) m.visible = false;
    m.hidePrev = reached;
    if (m.pendingDrop) { m.visible = true; m.pendingDrop = false; }
  }

  /** e720 draw + e721, e722 (once invisible), e871 (once visible), e872. */
  monitorDownLate() {
    const m = this.monDown;
    if (m.visible && m.av2 === 0) { this.rng.int(0, 999999, 0); m.av2 = 1; }
    const inv = !m.visible;
    if (inv && !m.invPrev) m.av2 = 0;
    m.invPrev = inv;
    const vis = m.visible;
    if (vis && !m.visPrev) m.av0 = 0;
    m.visPrev = vis;
    if (m.visible) m.av0 += 1;
  }

  /**
   * The per-second draw groups in sheet order (sourcedSecondPass). A group's
   * countdown loads on the first frame its earlier conditions hold (returning
   * false) and then counts down only on frames it is reached.
   * @param {number} f
   */
  secondPass(f) { this.secondPassEarly(f); this.secondPassLate(f); }

  /** The per-second pass helpers; mask2 is read when each part starts. @param {number} f */
  passTools(f) {
    /** @param {string} key @param {number} ms */
    const every = (key, ms) => this.passEvery(this.passTimers[key] ??= { v: 0, init: false }, ms);
    /** Random(n) == 1 @param {number} n */
    const one = n => this.rng.int(0, n - 1, 1) === 1;
    /** @param {string} id */
    const unit = id => /** @type {any} */ (this.units.find(x => x.id === id));
    /** @param {any} u */
    const at122 = u => !!u && u.atOpening && !u.inside;
    const mask2 = this.maskFullyOn;
    const p = /** @type {any} */ (this.puppet);
    const danger2 = () => this.units.some(x => x.committedAt >= 0) || p.attackAt >= 0;
    return { every, one, unit, at122, mask2, p, danger2 };
  }

  /** g213-g497; under sourcedSheetOrder also g366/g368, g419, g468-g476, g498, g500-g506 and g517/g518 in sheet order. */
  secondPassEarly(f) {
    const { every, one, unit, at122, mask2, p } = this.passTools(f);
    const sheet = this.opts.sourcedSheetOrder, views = sheet && this.opts.sourcedViewDraws;

    { const u = unit('toyfreddy');                                                    // g213
      if (this.viewing === 0 && !this.lightHeld && u && !u.atOpening && !u.inside &&
          u.path[u.idx] === 'blindB' && mask2 && every('213', 1000) && one(10)) {
        u.idx = 0; u.pending = false;
        this.emit('route-return', { who: u.id, to: 9, group: 213 });
      } }
    if (this.bb.inOpening && mask2 && every('292', 1000) && one(10)) { this.rng.int(0, 3, 0); this.bbLeave(); }   // g292
    if (this.bb.inOpening && this.bb.maskTicks >= C.VENT_MASK_TICKS && mask2) { this.rng.int(0, 3, 0); this.bbLeave(); }   // g294
    if (views) { this.drawViewed(f, 'g366'); this.drawViewed(f, 'g368'); }
    { const u = unit('mangle');
      if (at122(u) && mask2 && every('400', 1000) && one(10)) { this.rng.int(0, 3, 0); this.unitLeave(u); }       // g400
      if (at122(u) && u.maskExposureTicks >= 5 && mask2) { this.rng.int(0, 3, 0); this.unitLeave(u); } }          // g401
    if (this.opts.sourcedPuppetMoveOrder && this.puppet.pending && !this.puppet.atOpening && !this.puppet.inside) {
      this.puppet.pending = false;                                                     // g403-g411
      this.advancePuppet();
    }
    if (views) this.drawViewed(f, 'g419');
    { const u = unit('toybonnie');
      const overlays = this.units.some(x => (x.id === 'toybonnie' || x.id === 'toychica') && x.officeCue);
      if (at122(u) && mask2 && !this.blackout.active && !overlays && every('436', 500) && one(2))
        this.startOfficeEncounter(u);                                                  // g436
      if (at122(u) && mask2 && this.blackout.active && !u.officeCue && every('437', 1000) && one(3)) {
        u.pending = false;
        this.unitLeave(u, { idx: u.path.indexOf(3) });                                 // g437
      } }
    { const u = unit('toychica');
      if (at122(u) && mask2 && every('439', 1000) && one(10)) { this.rng.int(0, 3, 0); this.unitLeave(u); }       // g439
      if (at122(u) && u.maskExposureTicks >= 5 && mask2) { this.rng.int(0, 3, 0); this.unitLeave(u); } }          // g440
    if (views) this.drawViewed(f, 'fades');                                             // g468-g476
    {
      const stage = () => {
        p.stage++;
        this.emit('puppet-stage', p.stage);
        if (p.stage >= C.PUPPET_ESCAPE_STAGES) { p.out = true; this.emit('puppet-out'); }
      };
      if (this.box <= 0 && every('494', 1000) && p.stage < C.PUPPET_ESCAPE_STAGES &&
          this.rng.int(0, 19, 0) <= this.ai.puppet && !this.camLightOn && this.viewing === C.BOX_CAM) stage();   // g494
      if (this.box <= 0 && every('495', 1000) && p.stage < C.PUPPET_ESCAPE_STAGES &&
          this.rng.int(0, 19, 0) <= this.ai.puppet && this.viewing !== C.BOX_CAM) stage();                      // g495
      if (every('496', 1000) && this.rng.int(0, 19, 0) <= this.ai.puppet &&
          p.out && !p.atOpening && !p.inside && f >= p.stunUntil) p.pending = true;                             // g496
      if (this.hooked ? this.passEvery(this.hookTimers.g497, 1000) : f % C.FPS === 0)                          // g497
        p.pathChoice = this.rng.int(1, 2, 1) === 1 ? 'left' : 'right';
    }
    if (views) this.drawViewed(f, 'g498');
    if (sheet && this.opts.sourcedPuppetGlitchDraws) this.puppetGlitchEarly();          // g500-g506
    if (sheet) this.blackoutFlicker(f);                                                  // g517/g518
  }

  /** g556-g781; under sourcedSheetOrder also the hour table (g673-g684) and g774 in sheet order. */
  secondPassLate(f) {
    const { every, one, unit, mask2, p, danger2 } = this.passTools(f);
    const sheet = this.opts.sourcedSheetOrder;
    for (const id of ['withfreddy', 'withbonnie', 'withchica', 'toyfreddy']) {           // g556-g559
      const u = unit(id);
      if (u && u.inside && !danger2() && mask2 && every('556' + id, 1000) && one(2))
        this.commitAttack(u, 'inside-office mask attack roll');
    }
    if (p.atOpening && every('623', 1000) && one(10)) {                                  // g623
      p.atOpening = false; p.inside = true; p.loc = 'inside';
      p.attackAt = f + C.INSIDE_ATTACK_FRAMES;
      this.dropEverything = true;
      this.emit('puppet-attack', { at: 123 });
    }
    const hourTable = this.opts.sourcedHourTable && this.opts.night !== 7;
    if (hourTable) {                                                                     // g627-g630, then g673-g684
      let rows = f === 1 ? 0 : -1;
      if (this.hooked) {
        if (this.passEvery(this.hookTimers.g627, 1000)) this.am++;
        if (this.am >= 70) { this.am = 0; this.hour++; rows = this.hour; }
      } else if (f % C.HOUR_FRAMES === 0) rows = f / C.HOUR_FRAMES;
      if (rows >= 0) this.applyAiHour(rows);
    } else if (sheet && !this.hooked && f % C.HOUR_FRAMES === 0) this.applyAiHour(f / C.HOUR_FRAMES);   // g673-g684
    if (sheet && this.opts.sourcedVentCamDraws) this.ventCamDraws();                      // g685-g690
    if (sheet && this.opts.sourcedFootstepDraws) this.footstepDraws();                    // g695-g703
    if (this.hooked && !hourTable) {                                                     // g627, g629/g630, g673-g684
      if (this.passEvery(this.hookTimers.g627, 1000)) this.am++;
      if (this.am >= 70) { this.am = 0; this.hour++; this.applyAiHour(this.hour); }
    }
    if (this.opts.sourcedBoxCountdown) this.drainBoxCountdown();                         // g652-g661
    { const u = unit('mangle');
      if (u && u.inside && this.viewing > 0 && every('730', 1000) && one(20)) u.insideArmed = true;             // g730
      for (const [g, cue] of /** @type {[string, boolean][]} */ ([['739', true], ['740', true], ['741', true], ['742', false], ['743', false]]))
        if (u && u.inside && every(g, 1000) && one(20) && cue) this.rng.int(0, 2, 0);                          // g739-g743
    }
    if (this.hooked ? this.passEvery(this.hookTimers.g744, 1000) : f % C.FPS === 0) this.rollDecidePath();   // g744
    for (const id of ['withfreddy', 'withbonnie', 'withchica', 'toyfreddy']) {           // g747-g750
      const u = unit(id);
      if (u && u.inside && mask2 && every('747' + id, 1000) && one(10)) {
        if (id === 'withbonnie' || id === 'withchica') this.rng.int(0, 3, 0);
        this.unitLeave(u, { idx: 0, cooldown: C.INSIDE_LEAVE_COOLDOWN });
      }
    }
    if (sheet && this.opts.sourcedPuppetGlitchDraws) this.puppetGlitchLate();           // g774
    { const latch = this.opts.sourcedFoxyChain ? this.hallLatch : this.hallLightOn;    // g781
      if (this.ai.golden > 0 && !latch && every('781', 1000)) {
        const there = this.rng.int(0, C.GF_HALL_ROLL - 1, 1) === 1;
        if (this.opts.gfEnabled && !this.gf.hallInside && there !== this.gf.inHall) {
          this.gf.inHall = there;
          this.gf.hallExposure = 0;
          if (there) this.emit('gf-hall');
        }
      } }
    // g787 copies the Custom Night dials and g821 sets the Puppet, once, after g781 (sourcedCustomDialOrder)
    if (f === 1 && this.opts.sourcedCustomDialOrder && this.opts.night === 7) this.applyAiHour(0);
  }

  /**
   * One reach of a CND_EVERY2 countdown, in 1/3 ms units at 50 per 60 fps frame.
   * CND_EVERY2.eva2 (classes.dex) loads the delay on the first reach and returns
   * false (PARAM_INT value2 is the load flag); later reaches subtract
   * rhTimerDelta, fire at <= 0 and add the delay back. The model's f % N timers
   * fire at frame N where a countdown loaded on the dump's first loop fires on
   * loop N + 1, so model frame f is dump loop f + 1 and the loading loop is the
   * model's frame 0: a group first reached on frame 1 has already loaded.
   * @param {{v: number, init: boolean}} t @param {number} ms
   */
  passEvery(t, ms) {
    if (!t.init) {
      t.init = true; t.v = ms * 3;
      if (this.frame !== 1 || this.opts.sourcedEveryOrigin) return false;
    }
    t.v -= this.frameUnits;
    if (t.v > 0) return false;
    t.v += ms * 3;
    return true;
  }

  /** One reach of a gated group's own CND_EVERY2 countdown (sourcedGatedEvery). @param {string} key @param {number} ms */
  gatedPass(key, ms) { return this.passEvery(this.gatedEvery[key] ??= { v: 0, init: false }, ms); }

  /** g785/g786: the cams-up streak counts gated one-second fires while viewing > 0 (sourcedGatedEvery). */
  tickStreak() {
    if (this.viewing > 0) { if (this.gatedPass('g786', 1000)) this.streakTicks++; }
    else this.streakTicks = 0;
  }

  /** g685-g690: Random(4) the first loop a unit stands on CAM 05/06, re-armed when it leaves (sourcedVentCamDraws). */
  ventCamDraws() {
    /** @type {[string, number][]} */
    const sites = [['toychica', 5], ['withbonnie', 5], ['toybonnie', 6], ['withchica', 6], ['mangle', 6], ['puppet', 6]];
    for (const [id, cam] of sites) {
      let here;
      if (id === 'puppet') {
        const p = this.puppet;
        here = p.out && !p.atOpening && !p.inside && p.route ? p.route[p.idx] === cam : false;
      } else {
        const u = this.units.find(x => x.id === id);
        here = !!u && !u.done && !u.atOpening && !u.inside && u.path[u.idx] === cam;
      }
      if (here && !this.ventCamDrawn[id]) { this.ventCamDrawn[id] = true; this.rng.int(0, 3, 0); }
      else if (!here) this.ventCamDrawn[id] = false;
    }
  }

  /** g811: Random(1000) once per stretch of viewing == 0 (sourcedRandomImageDraw). */
  randomImageDraw() {
    if (this.viewing === 0) {
      if (this.randomImageArmed) { this.randomImageArmed = false; this.rng.int(0, 999, 0); }
    } else this.randomImageArmed = true;
  }

  /** g653-g661: the music box drain as a gated Every 50 ms, then the wind hold's drain (sourcedBoxCountdown). */
  drainBoxCountdown() {
    if (!this.opts.boxEnabled) return;
    const units = Math.round(this.box * C.BOX_UNITS);
    const hour = this.hooked ? this.hour : Math.floor(this.frame / C.HOUR_FRAMES);
    if (this.boxHold === 0 && units > 0 && C.boxDrainsAtHour(this.opts.night, hour) &&
        this.gatedPass('box', C.BOX_DRAIN_TICK_MS))
      this.box = Math.max(0, units - (C.BOX_DRAIN_PER_TICK[this.opts.night] ?? C.BOX_DRAIN_PER_TICK[7])) / C.BOX_UNITS;
    if (this.boxHold > 0)                                                                  // g661
      this.boxHold = Math.max(0, this.boxHold - (this.opts.frameValue5 ? this.opts.frameValue5(this.frame) : 1));
  }

  /** The markers whose hop sets a footstep cue (footstepCamMarkers adds CAM 01-04). */
  footstepNodes() { return this.opts.footstepCamMarkers ? FOOTSTEP_CAM_NODES : FOOTSTEP_NODES; }

  /** g695-g703: one draw per pending footstep cue, in sheet order (sourcedFootstepDraws). */
  footstepDraws() {
    if (this.opts.sourcedFootstepValue2) {
      const g5 = this.opts.frameValue5 ? this.opts.frameValue5(this.frame) : 1;
      for (const u of this.units) {
        if (u.value2 > 0) u.value2 = Math.max(0, u.value2 - g5);                             // g458-g466
        const on = u.value2 > 0 && !u.done && !u.atOpening && !u.inside && this.footstepNodes().has(u.path[u.idx]);
        u.footstep = on && !u.footstepOn;                                                    // g695-g703, NotAlways
        u.footstepOn = on;
      }
    }
    for (const id of ['withfreddy', 'withbonnie', 'withchica', 'foxy', 'toyfreddy', 'toybonnie', 'toychica', 'bb', 'mangle']) {
      const holder = id === 'foxy' ? this.foxy : id === 'bb' ? this.bb : this.units.find(x => x.id === id);
      if (!holder || !holder.footstep) continue;
      holder.footstep = false;
      const value = this.rng.int(0, id === 'mangle' ? 2 : 4, 0) + 1;   // cam01 value 5 = Random(5)+1; Mangle: value 12 = Random(3)+1
      // g704-g708 play samples 25-29 from value 5; g709-g711 play 30-32 from value 12: the draw is audible
      this.emit('footstep', { who: id, value, sample: id === 'mangle' ? 29 + value : 24 + value });
    }
  }

  /**
   * g344-g358's promotion test for a route unit whose roll has passed (sourcedFootstepValue2): the packed
   * FlagOn (value 0 == 1, value 1 == 0), the your-view marker off its room, Mangle's g358 hall light, and
   * before Night 7 the CAM 08/09 conditions sourcedRouteStep holds or discards on.
   * @param {any} u
   * @param {number} f
   */
  footstepPromotable(u, f) {
    if (f < u.stunUntil) return false;
    if (this.opts.selectedCameraGate && C.SELECTED_CAMERA_GATED.has(u.id) && u.path[u.idx] === this.cam &&
        (C.WITHEREDS.has(u.id) || this.camsUp)) return false;
    if (u.id === 'mangle' && !this.camsUp && this.lightStallOn) return false;
    if (this.opts.sourcedRouteForks && this.opts.night !== 7) {
      const onCam = (/** @type {string} */ id, /** @type {number} */ cam) =>
        this.units.some(o => o.id === id && !o.done && !o.atOpening && o.path[o.idx] === cam);
      if (u.id === 'withfreddy' && (onCam('withchica', 8) || onCam('withbonnie', 8))) return false;   // g344
      if (u.id === 'withchica' && onCam('withbonnie', 8)) return false;                               // g347
      if (u.id === 'toyfreddy' && onCam('toychica', 9)) return false;                                  // g350/g352
      if (u.id === 'toychica' && onCam('toybonnie', 9)) return false;                                  // g354/g356
    }
    return true;
  }

  /**
   * Value 2 = 10 when the unit's move is promoted (sourcedFootstepValue2). A passed roll puts value 0 back
   * to 1, so it promotes again (value 2 = 10) a move that was already waiting.
   * @param {any} u
   * @param {boolean} roll
   */
  footstepPromote(u, roll) {
    const value2 = this.opts.sourcedFootstepValue2, viewed = this.opts.sourcedPromotedViewDraws;
    if (!value2 && !viewed && !this.opts.sourcedPromotedMoves) return;
    if (roll) u.promoted = false;
    if (u.promoted || !this.footstepPromotable(u, this.frame)) return;
    if (value2) u.value2 = 10;
    u.promoted = true;
    if (viewed) this.fadeUntil[u.id] = this.frame + 8;                        // g344-g360: C = 10 at promotion
  }

  /** your-view overlaps the Puppet: his route camera when out, CAM 11 in the box. */
  puppetUnderYourView() {
    const p = /** @type {any} */ (this.puppet);
    const at = !p.out ? C.BOX_CAM : (typeof p.loc === 'number' ? p.loc : null);
    return at !== null && at === this.cam;
  }

  /** the Puppet sits on the CAM 11 marker (in his box or just escaped) */
  puppetAtBoxCam() {
    const p = /** @type {any} */ (this.puppet);
    return !p.out || p.loc === C.BOX_CAM;
  }

  /** `lit?` (OI 75): the events 74-83 counter under sourcedFoxyChain, else the camera light. */
  litCounter() { return this.opts.sourcedFoxyChain ? this.hallLit : this.camLightOn; }

  /** g500-g502, g503, g505 (take one off, then 100-Random(150)), g506 in sheet order (sourcedPuppetGlitchDraws). */
  puppetGlitchEarly() {
    const g = this.glitch;
    const lead = () => this.puppetUnderYourView() && this.viewing > 0 && g.value5 === 1 && !this.litCounter();
    const one = () => this.rng.int(0, 49, 1) === 1;
    for (let i = 0; i < 3; i++)                                                       // g500-g502
      if (lead() && !this.puppetAtBoxCam() && one()) g.value4 = 1;
    if (lead() && this.passEvery(g.g503, 1000) && !this.puppetAtBoxCam() && one()) g.value4 = 1;   // g503: countdown after lit == 0
    if (g.value4 > 0) { g.value4 -= 1; this.rng.int(0, 149, 0); }                     // g505
    if (this.passEvery(g.g506, 110)) g.value5 = 0;                                             // g506
  }

  /** g774: the light on the Puppet away from CAM 11 raises the glitch flag. */
  puppetGlitchLate() {
    if (this.puppetUnderYourView() && !this.puppetAtBoxCam() && this.viewing > 0 && this.litCounter())
      this.glitch.value5 = 1;
  }

  /** Blackout flicker: the g514 clock and the g517/g518 draw (sourcedBlackoutDraws). @param {number} f */
  blackoutFlicker(f) {
    if (!this.opts.sourcedBlackoutDraws || !this.blackout.active) return;
    let clock = f - this.blackoutStartFrame + 1;
    if (this.hooked) {                                                                   // g514: += global value 5
      const v5 = this.opts.frameValue5 ? this.opts.frameValue5(f) : 1;
      this.blackoutClock += v5 * (f - this.blackoutClockFrame);
      this.blackoutClockFrame = f;
      clock = this.blackoutClock;
    }
    if (clock > 20 && clock < 200) this.rng.int(0, 49, 0);
  }

  startBlackout(by, unitId = null) {
    this.blackoutStartFrame = this.frame;
    this.blackoutClock = 0;
    this.blackoutClockFrame = this.frame - 1;
    this.blackout = { active: true, until: this.frame + C.BLACKOUT_FRAMES, by,
                      unitId, masked: this.maskFullyOn,
                      deadline: this.frame + C.maskGraceFrames(this.opts.night) };
    this.blackoutCount++;
    this.emit('blackout', by);
  }

  startOfficeEncounter(u) {
    if (this.blackout.active || !u.atOpening) return;
    u.officeCue = true;
    this.startBlackout(u.name, u.id);
    this.emit('office-cue', u.id);
  }

  unitEnterInside(u, why) {
    u.atOpening = false;
    u.inside = true;
    u.officeCue = false;
    u.raiseSeen = false;
    u.openingSince = -1;
    u.openingReadyAt = -1;
    u.openingTicks = 0;
    if (this.engagedToy === u.id) this.engagedToy = null;
    this.emit('office-entry', { who: u.id, why });
    this.flag('inside-office', `${u.name} reached marker 123: ${why}`);
  }

  // Worst luck for the player is the shortest immunity, so the roll pins to 0.
  repelCooldown() {
    return Math.floor(this.rng.int(0, C.REPEL_COOLDOWN_ROLL - 1, 0) / this.opts.night);
  }

  // g532 / g556-559 -> `being attacked by` = N. Past this point the mask is
  // refused (g267) and everything is forced down (g624); nothing cancels it.
  commitAttack(u, why) {
    if (u.committedAt >= 0) return;
    u.insideDangerAt = -1;
    u.committedAt = this.frame + C.INSIDE_ATTACK_FRAMES;
    this.dropEverything = true;   // g624
    this.emit('inside-committed', { who: u.id, why });
  }

  armInsideAttack(u, why) {
    if (u.insideDangerAt >= 0) return;
    // `got you stage` = 1 and `time left` = `time allowed`, per night (g530).
    u.insideDangerAt = this.frame + C.timeAllowedFrames(this.opts.night);
    // NOT dropEverything. g624 gates on `being attacked by` (136) > 0 -- the
    // COMMITTED attack -- and g274 turns `drop everything` into mask = 3, i.e.
    // it forces the mask OFF. Setting it here, at `got you stage` = 1, made the
    // bug self-reinforcing: the mask could never reach `mask == 2`, so g533's
    // escape was unreachable even once the gate above was removed. Third place
    // the same two source variables had been merged.
    this.emit('inside-armed', { who: u.id, why });
  }

  // g262 lowers the monitor and zeroes `viewing`, g274 takes the mask off, and
  // g612 clears the flag -- all in the same frame it was set. The player's own
  // presses that frame are read at g254-270, i.e. after the monitor forcedown
  // and before the mask one, so running this at the top of the tick reproduces
  // the order: neither a monitor nor a mask press survives a forcedown.
  tickForcedown() {
    if (!this.dropEverything) return;
    this.dropEverything = false;
    if (this.monitor === MON_UP || this.monitor === MON_RAISING) this.setMonitor(false);
    if (this.maskOn) this.setMask(false);
    this.emit('forcedown');
  }

  // sourcedDropFlagOrder: g618/g619 read this update's drop-button touch after g262/g274 and g612,
  // so the flag they raise is performed by the next tick's tickForcedown. A touch from an update
  // whose tick returned early (a non-lethal kill) is dropped. (v1, the flip lock g262, g270 and
  // g274 set, is not modelled: it is 0 here for a tap that is not still held from them.)
  readDropTouch() {
    const touched = this.dropTouch === this.frame - 1;
    this.dropTouch = -1;
    if (!touched) return;
    if (this.monitor === MON_UP && this.maskFullyOff) this.dropEverything = true;                         // g618
    else if (this.maskFullyOn && this.viewing === 0) {                                                    // g619
      if (this.blackout.active) this.flag('invalid-input', 'g619: mask-off refused in danger');
      else this.dropEverything = true;
    }
  }

  // ------------------------------------------------------------------- tick
  tick() {
    if (!this.alive || this.won) return;
    const f = ++this.frame;
    // g822 is an application StartOfFrame event, dispatched before ordinary
    // loop events, including g811's first viewing=0 draw. Its condition's
    // object type matters: NUM=-1 alone also names the system Always event.
    if (f === 1 && this.opts.sourcedUnconditionalDraws) {
      this.rng.next();
      this.unconditionalDraws++;
    }
    if (this.opts.frameMs) this.frameUnits = Math.round(this.opts.frameMs(f) * 3);
    if (this.hooked) {
      const t = this.hookTimers;
      this.secTick = this.passEvery(t.sec, 1000);
      this.halfTick = this.passEvery(t.half, 500);
      this.sampleTick = this.passEvery(t.sample, 200);
      this.tenTick = this.passEvery(t.ten, 10000);
      if (this.secTick && !this.opts.sourcedHallLatchOrder) this.lightLogicalUntil = -1;   // the one-second reset
      this.hallLatchResetDue = this.secTick && this.opts.sourcedHallLatchOrder;           // g488, after the moves
    }
    if (this.opts.sourcedFoxyChain) this.updateLitCounter();   // events 74-83 (g84-g94) before the drop; g488/g489 run in tickFoxyChain
    else if (this.opts.sourcedDropLightOrder) this.updateHallLatch(f);

    // g262/g274 execute the forcedown near the top of the sheet, while
    // g612 clears it and g624/g718-721 set it near the bottom -- so a flag
    // raised this frame is spent on the next one. Running it first keeps that
    // one-frame latency and the ordering against the player's own presses.
    this.tickForcedown();
    if (this.opts.sourcedMonitorDownDraw) this.monitorDownEarly();   // e7 hide, then e211 show

    if (this.monAnim > 0 && --this.monAnim === 0) {
      if (this.monitor === MON_RAISING) {
        this.monitor = MON_UP;
        if (!this.hasViewedCamera) {
          this.cam = this.viewing = C.initialCamera(this.opts.night);
          this.hasViewedCamera = true;
        } else if (this.lastViewed > 0) {
          // g1 -> child g2 restores only counter 55. The marker deliberately
          // stays parked, so a stale sample creates the split-camera state.
          this.viewing = this.lastViewed;
        }
        this.onCamsUp();
        // Active 18 has just become invisible: a Mangle that saw this raise
        // crosses 122 -> 123 now (groups 402-403).
        for (const u of this.units) {
          if (u.id === 'mangle' && u.atOpening && u.raiseSeen)
            this.unitEnterInside(u, 'completed a monitor raise after Mangle reached marker 122');
        }
      }
      else if (this.monitor === MON_LOWERING) this.monitor = MON_DOWN;
    }
    if (this.maskAnim > 0 && --this.maskAnim === 0 && this.maskOn) {
      // g911 mirrors monitor-down's counter clear without moving the marker.
      this.viewing = 0;
      // g776: `yellowbear` present AND `mask` = 2 -> alt0 = 1, fade (g1040)
      // and destroy. A fully-on mask is his only dismissal.
      if (this.gf.present) { this.gf.present = false; this.emit('gf-cleared'); }
      // Group 293 resets the local mask-duration counters on each transition
      // into the fully-on mask state. They are continuous holds, not storage.
      for (const u of this.units) {
        if (u.id === 'toychica' || u.id === 'mangle') u.maskExposureTicks = 0;
      }
      this.bb.maskTicks = 0;   // g293 names Balloon Boy alongside the two toys
    }

    if (this.opts.sourcedGatedEvery) this.maskTick = this.maskFullyOn && this.gatedPass('g907', 1000);   // g907
    // g263 is the only writer of `last viewed`: a global 200 ms sample of the
    // live feed. It runs only while a camera is displayed.
    if (this.viewing > 0 && (this.opts.sourcedLastViewPause ? this.passEvery(this.lastViewTimer, 200)
        : this.hooked ? this.sampleTick : f % C.LAST_VIEW_SAMPLE_FRAMES === 0))
      this.lastViewed = this.viewing;

    if (this.opts.sourcedUnconditionalDraws) this.drawUnconditional();   // g58/g59/g192
    // --- 5-second interval: Foxy's kill check runs before anything else
    if (this.hooked ? this.passEvery(this.hookTimers.five, 5000) : f % C.MO_FRAMES === 0) this.onFiveSecond();
    if (this.opts.sourcedFoxyChain) this.foxyChainTransitions();   // g349/g364/g389/g390

    // --- 10-second interval: g718-721 slam everything down while one of the
    // four streak attackers is waiting at marker 122 with the cameras up.
    if ((this.hooked ? this.tenTick : f % (C.MO_FRAMES * 2) === 0) && this.camsUp &&
        this.units.some(u => u.atOpening && u.openingRule === 'streak')) {
      this.dropEverything = true;
    }

    // --- 10-second interval: locked-on Foxy strikes if no blackout is covering
    if ((this.hooked ? this.tenTick : f % (C.MO_FRAMES * 2) === 0) && this.foxy.gotYou && !this.blackout.active) {
      this.kill('foxy', 'Foxy had locked on and no blackout covered the 10s interval');
      return;
    }

    if (this.opts.sourcedSheetOrder) this.secondPassEarly(f);   // g213..g518 in sheet order
    else {
      if (this.opts.sourcedViewDraws) this.drawViewed(f);   // g366/g368/g419, g468-g476, g498
      if (this.opts.sourcedPuppetGlitchDraws) this.puppetGlitchEarly();   // g500-g506
      this.blackoutFlicker(f);                              // g514 clock, g517/g518
    }
    // --- blackout resolution
    if (this.blackout.active) {
      // Android group 533 only defuses while the 45-frame fuse is still in
      // state 1, and only once the mask animation has reached state 2.
      if (!this.blackout.masked && this.maskFullyOn && f < this.blackout.deadline)
        this.blackout.masked = true;
      // Fuse expiry arms the attack, but groups 538-555 do not resolve it
      // until the 300-frame office sequence ends.
      if (f >= this.blackout.until) {
        const ended = this.blackout;
        this.blackout = { active: false, until: 0, by: null, unitId: null, masked: false, deadline: 0 };
        if (ended.unitId) {
          // The source does not resolve whoever started the encounter: g538-555
          // run in group order and the first match consumes `check and move`,
          // so the queue drains one occupant per encounter by fixed priority.
          const order = ended.masked ? C.RESOLVE_ORDER_DEFENDED : C.RESOLVE_ORDER_FAILED;
          const u = order.map(id => this.units.find(x => x.id === id && x.atOpening))
                         .find(Boolean) || this.units.find(x => x.id === ended.unitId);
          if (u?.atOpening) {
            // Endpoint resolution (groups 538-555): a defended occupant is
            // repelled to their sourced mid-route room with a fresh approach
            // cooldown B = Random(500)/night.
            if (ended.masked) this.unitLeave(u, { cooldown: this.repelCooldown() });
            else {
              if (this.opts.sourcedEventDraws) this.rng.int(0, C.REPEL_COOLDOWN_ROLL - 1, 0);   // e478/e484-e489
              this.unitEnterInside(u, 'missed the 45-frame office-defense fuse');
            }
          }
        } else if (!ended.masked) {
          this.kill('blackout', `${ended.by} got you: the mask was not fully on within 0.75s`);
          return;
        }
      }
    }

    // g744 sits after the repel rolls (g538-555, blackout resolution above) and
    // before the inside-attack rolls (g747-750, tickUnits) and Golden Freddy's
    // hall roll (g781). The model's other draws are not all in group order.
    if (this.opts.sourcedRouteForks && f % C.FPS === 0 && !this.opts.sourcedSecondPass) this.rollDecidePath();
    this.tickLight();
    this.tickHallMovement(f);
    this.tickGoldenHall(f);
    this.tickFoxy(f);
    this.tickMask();
    this.tickUnits(f);
    if (this.hallLatchResetDue) {                                                     // g488, then g489
      this.lightLogicalUntil = -1;
      if (this.anyOfficeLightHeld && !this.camsUp) this.lightLogicalUntil = Number.MAX_SAFE_INTEGER;
    }
    this.syncMangleStatic();
    this.tickBox();
    if (this.opts.sourcedDropFlagOrder) this.readDropTouch();  // g618/g619 (g556-g559 precede them but write nothing they read)
    if (this.opts.sourcedSheetOrder) this.secondPassLate(f);   // g556..g781 in sheet order
    else if (this.opts.sourcedSecondPass) this.secondPass(f);   // g213..g781 per-second groups
    if (this.opts.record) this.record();

    // The table groups sit at g673-684, below every group that reads an AI
    // counter (g333-342 and g494-496), so a new hour's levels reach the rolls
    // on the frame after the hour ticks over, not on it.
    if (f % C.HOUR_FRAMES === 0 && !this.opts.sourcedSheetOrder) this.applyAiHour(f / C.HOUR_FRAMES);
    if (this.opts.sourcedPuppetGlitchDraws && !this.opts.sourcedSheetOrder) this.puppetGlitchLate();   // g774
    if (this.opts.sourcedMonitorDownDraw) this.monitorDownLate();                // e720-e722, e871-e872
    if (this.opts.sourcedRandomImageDraw) this.randomImageDraw();                 // g811
    if (this.opts.sourcedGatedEvery) this.tickStreak();                            // g785/g786

    if (this.hooked ? this.hour >= 6 : f >= this.opts.durationFrames) { this.won = true; this.emit('win'); }
  }

  /**
   * The Office frame's unconditional timer draws, g58/g59/g192, before g337.
   * The separate g822 StartOfFrame draw runs once, before the first loop.
   */
  drawUnconditional() {
    const loading = this.opts.sourcedEveryOrigin && this.frame === 1;
    for (const t of this.unconditionalTimers) {
      if (loading) continue;
      t.counter -= this.frameUnits;
      if (t.counter <= 0) { t.counter += t.delayUnits; this.rng.next(); this.unconditionalDraws++; }
    }
  }

  tickLight() {
    // [SOURCED: g778] `yellowbear` present AND `viewing hall light` = 1 AND
    // alt0 = 0 (not yet dismissed by a fully-on mask, g776) -> Golden Freddy
    // takes the got-you box, and g570 attacks a second later. The condition is
    // re-read every frame, not only on a light PRESS: the Minus Toys camdrop
    // holds the camera light THROUGH the monitor drop, so the instant
    // `viewing` reaches 0 with the light still held, g489 sets the latch and
    // g778 fires. He is created only while the cameras are up (g336, at the
    // five-second ticks) and shown at the drop (g775), so the drop with a
    // held light is exactly when this lands. Measured on the phone on
    // 2026-09-13: night6-anchored2 (199 s) and night6-anchored3 (219 s) both
    // died to Golden Freddy the second after a camdrop, after 2 AM (AI 3).
    if (this.gf.present && this.hallLightOn) {
      this.kill('golden-freddy', 'The hall light met Golden Freddy in the office (g778: held through the drop)');
      return;
    }
    // Only `lit?` — the office/camera flashlight — drains the battery
    // (group 284). Vent lights are free.
    if (this.lightHeld && this.opts.powerEnabled && !this.blackout.active && !this.maskOn) {
      this.power--;
      if (this.power <= 0) {
        this.power = 0;
        this.lightHeld = this.ventLightL = this.ventLightR = false;
        this.flag('power-out', 'Flashlight is dead');
      }
    }
    // `new bonnie` is reset on each global one-second event and immediately
    // asserted again if the office light is still held. A released tap thus
    // remains a movement blocker only until the next scheduler boundary.
    if (this.anyOfficeLightHeld && !this.camsUp)
      this.lightLogicalUntil = this.hooked ? Number.MAX_SAFE_INTEGER : Math.ceil((this.frame + 1) / C.FPS) * C.FPS;
    // Groups 450-457 split their reads: marker overlap chooses the target,
    // while `viewing` supplies the CAM 08/09/11 immunity. A desynced marker
    // on 09 with viewing=11 therefore stuns the Toys for Minus Toys.
    if (this.camLightOn && this.opts.cameraLightStunFrames > 0)
      this.stunCam(this.cam, this.opts.cameraLightStunFrames, this.viewing);
    // g848-854 are distinct from the direct edge gate above: while the
    // one-second office-light latch remains set, hall occupants have B pinned
    // to 40. Movement therefore stays blocked for 40 more frames after the
    // latch finally clears. W. Chica and Toy Bonnie have no such group.
    if (this.lightStallOn) {
      for (const u of this.units) {
        if (!u.done && C.HALL_LIGHT_PIN_IDS.has(u.id) &&
            (u.path[u.idx] === 'blindA' || u.path[u.idx] === 'blindB'))
          u.stunUntil = Math.max(u.stunUntil, this.frame + C.HALL_LIGHT_PIN_FRAMES);
      }
    }
    // Legacy diagnostic model only: a 400-frame timer refreshed by looking
    // at a Withered. The sourced look effect is the marker hold in
    // canAdvance, which releases the moment the marker leaves; this knob
    // stays for A/B comparisons against the old trainer behavior.
    if (this.monitor === MON_UP && this.opts.passiveWitheredLookStunFrames > 0) {
      for (const u of this.units) {
        if (C.WITHEREDS.has(u.id) && u.path[u.idx] === this.cam)
          u.stunUntil = this.frame + this.opts.passiveWitheredLookStunFrames;
      }
    }
  }

  stunCam(n, frames = C.STUN_FRAMES, viewing = n) {
    for (const u of this.units) {
      if (u.path[u.idx] !== n || u.done) continue;
      if ((C.WITHEREDS.has(u.id) && viewing === 8) ||
          (C.TOYS.has(u.id) && viewing === 9) ||
          (u.id === 'mangle' && viewing === 11)) continue;
      u.stunUntil = this.frame + frames;
    }
  }

  // `hall movement` (object 180): the hitbox at (669, 503) that only the two
  // hall stages overlap. g779 needs it at zero, and with the hall light held
  // g202/g1035 draw the dark "movement" hall (frame 99 / patch 13) while it is
  // above zero instead of the empty hall (g203/g1034) or a standing character
  // (g205-209) -- the phone's DIM flash class. Ticked every frame, whether or
  // not Golden Freddy is enabled, so a trace can read it at each flash.
  get hallMovementFrames() { return Math.max(0, this.hallMovementUntil - this.frame); }
  tickHallMovement(f) {
    const foxyHere = this.foxy.loc === 'hall';
    let occupied = foxyHere, entered = null;
    for (const u of this.units) {
      const here = !u.done && (u.path[u.idx] === 'blindA' || u.path[u.idx] === 'blindB');
      if (here && !u.hallColumn) entered = entered || u.id;
      u.hallColumn = here;
      occupied = occupied || here;
    }
    if (foxyHere && !this.foxy.hallColumn) entered = entered || 'foxy';
    this.foxy.hallColumn = foxyHere;
    this.hallColumnOccupied = occupied;
    if (this.opts.sourcedHallEntry) {
      // g875-880: each hall-routed character writes 300 when it overlaps the
      // hitbox, and every one of those groups carries C -7 ("only one action
      // when event loops"). So the write lands once per continuous overlap:
      // on entry into the hall column, never while standing there, and a
      // stage-1 -> stage-2 hop keeps the overlap continuous. g881 drains it.
      // (ANDROID-SOURCE-STATUS.md 2026-09-15.)
      if (entered) {
        this.hallMovementUntil = f + C.HALL_MOVEMENT_FRAMES;
        this.emit('hall-movement', { who: entered });
      }
    } else if (occupied) {
      // Legacy reading: refreshed every frame anyone is in the hall, so the
      // block outlasts a long stay by 300 frames the source does not have.
      this.hallMovementUntil = f + C.HALL_MOVEMENT_FRAMES;
    }
  }

  // Hallway Golden Freddy: he can only take the hall when it is genuinely
  // empty, which in Minus 7 means the windows where Foxy has been evicted.
  tickGoldenHall(f) {
    if (!this.opts.gfEnabled) return;
    // g780 only moves the hallway figure to marker 123. g570 waits for a
    // one-second event there before writing attack code 12; g587-588 then run
    // the shared 40-frame transition. Crossing 100 exposure is not itself the
    // jumpscare.
    if (this.gf.hallInside) {
      if (this.gf.attackAt >= 0) {
        if (f >= this.gf.attackAt)
          this.kill('golden-freddy-hall', 'Hall Golden Freddy completed the marker-123 attack');
      } else if (this.opts.sourcedGatedEvery ? !this.attackExecuting && this.gatedPass('g570', 1000)
                 : this.hooked ? this.secTick : f % C.FPS === 0) {           // g570
        this.gf.attackAt = f + C.INSIDE_ATTACK_FRAMES;
        this.dropEverything = true;
        this.emit('gf-hall-attack');
      }
      return;
    }
    // g779's empty-hall test names exactly the characters whose routes pass
    // through the two off-camera transit markers: `hall stage 1` (120) is
    // blindA and `hall stage 2` (121) is blindB, plus W. Foxy in the hall.
    const hallOccupied = this.hallColumnOccupied || f < this.hallMovementUntil;

    // g781: his presence is not a latch. Every one-second event with the hall
    // light off re-rolls it, so holding the light freezes whatever is there.
    if (f % C.FPS === 0 && !this.hallLightOn && !this.opts.sourcedSecondPass) {
      const there = this.rng.int(0, C.GF_HALL_ROLL - 1, 1) === 1;
      if (there !== this.gf.inHall) {
        this.gf.inHall = there;
        this.gf.hallExposure = 0;   // g865 zeroes it whenever he is not there
        if (there) this.emit('gf-hall');
      }
    }
    if (!this.gf.inHall) return;
    // g779 also requires the `hall movement` latch to be zero (hallOccupied
    // above). Source writes the 300 once per entry into hall stage 1/2 (C -7);
    // this refreshes it every transit frame, so it can only over-block.
    if (this.hallLightOn && !hallOccupied) {
      if (++this.gf.hallExposure > C.GF_HALL_KILL_FRAMES) {
        this.gf.inHall = false;
        this.gf.hallInside = true;
        this.emit('gf-hall-inside');
      }
    }
  }

  // D is held at zero for all of night 1 and until 2 AM on night 2
  // (groups 872-874).
  get foxyDormant() {
    const n = this.opts.night;
    return n === 1 || (n === 2 && this.frame < 2 * C.HOUR_FRAMES);
  }

  /** g349 -> g364 -> g389/g390, after g337 and before g488/g489 in the sheet. */
  foxyChainTransitions() {
    if (!this.opts.foxyEnabled) return;
    const fx = this.foxy;
    if (fx.A === 1 && fx.B === 0) { fx.A = 2; fx.acceptedAt = this.frame; if (this.opts.sourcedViewDraws) this.fadeUntil.foxy = this.frame + 8; }   // g349: C = 10, value 2 = 10
    // g364: B = Max(0, B - 1 * Global(5)). The dump's expression is Max( 0 , AV1 - 1 * global -65531 ),
    // and global value 5 is the frame-delta term the same sheet drains `hall movement` with
    // (g881), so a long frame drains this pin by more than one. Read 2026-09-17; the model had
    // been subtracting exactly 1 per frame, which is right only at 60 fps.
    if (fx.B > 0) fx.B = Math.max(0, fx.B - (this.opts.frameValue5 ? this.opts.frameValue5(this.frame) : 1));   // g364
    if (fx.A !== 2 || this.hallLatch) return;       // the latch g489 left on the previous frame
    if (fx.loc === 'parts') {                        // g389
      fx.A = 0; fx.loc = 'hall'; fx.D = 0;
      if (this.opts.sourcedFootstepDraws && this.opts.footstepFoxy && this.frame - (fx.acceptedAt ?? -100) < 10) fx.footstep = true;   // hall stage 1, value 2 still > 0
      this.emit('foxy-arrive');
    } else if (fx.loc === 'hall' && !fx.gotYou) {    // g390
      fx.A = 0; fx.gotYou = true;
      this.emit('foxy-lock');
      this.flag('foxy-lock', 'g390: Foxy reached marker 123 (A=2, B=0, latch clear)');
    }
  }

  /** g488/g489, g573, g745, g824, g825, g846, g855, g864, g872-874 in sheet order. */
  tickFoxyChain(f) {
    const fx = this.foxy;
    const second = this.hooked ? this.secTick : f % C.FPS === 0;
    const danger = this.blackout.active;
    this.updateHallLatch(f, this.hallLit && this.viewing === 0 && this.power > 0);  // g488 (425) / g489 (426): viewing read after the drop
    if (fx.gotYou && this.viewing === 0 && this.hallLatch && !danger) {      // g573
      this.kill('foxy', 'g573: the hall light latched while Foxy was at marker 123');
      return;
    }
    const atHall = fx.loc === 'hall' && !fx.gotYou;
    if (atHall && this.hallLatch) { fx.D = 0; fx.exposure++; }               // g745
    const someoneInOpening = this.bb.inOpening || this.units.some(u => u.atOpening);
    if (this.opts.sourcedGatedEvery) {
      if (!danger && this.gatedPass('g824', 1000)) fx.D++;                                            // g824
      if (!danger && this.maskFullyOn && !someoneInOpening && this.gatedPass('g825', 1000)) fx.D++;   // g825
    } else {
      if (second && !danger) fx.D++;                                           // g824
      if (second && !danger && this.maskFullyOn && !someoneInOpening) fx.D++;  // g825
    }
    if (fx.exposure > C.foxyExposureFrames(this.opts.night) && !this.hallLit && // g846
        !this.hallLatch && fx.B === 0) {
      fx.loc = 'parts'; fx.gotYou = false; fx.A = 0; fx.D = 0; fx.exposure = 0;
      fx.B = this.rng.int(C.FOXY_RETURN_MIN, C.FOXY_RETURN_MAX, C.FOXY_RETURN_MIN);
      this.emit('foxy-leave');
    }
    if (fx.loc === 'hall' && !fx.gotYou && this.hallLatch) fx.B = C.FOXY_HALL_PIN_FRAMES; // g855
    if ((this.hooked ? this.halfTick : f % (C.FPS / 2) === 0) && fx.D > 0 && fx.loc === 'parts' && this.hallLatch) fx.D--; // g864
    if (this.foxyDormant) fx.D = 0;                                          // g872-874
  }

  tickFoxy(f) {
    if (!this.opts.foxyEnabled) return;
    if (this.opts.sourcedFoxyChain) { this.tickFoxyChain(f); return; }
    const fx = this.foxy;
    if (this.foxyDormant) fx.D = 0;

    // D runs all night, not just while Foxy is in the hall: the same variable
    // decides when he *arrives* and when he kills.
    const dTick = ((f + this.blackoutCount) % C.FPS) === 0;
    if (dTick && !this.blackout.active && !this.foxyDormant) fx.D++;

    const hallLit = this.opts.sourcedDropLightOrder ? this.hallLatch : this.hallLightOn;
    if (this.opts.sourcedDropLightOrder) {
      // g573: locked at marker 123, monitor down, latch set, no encounter.
      if (fx.gotYou && this.hallLatch && this.viewing === 0 && !this.blackout.active) {
        this.kill('foxy', 'g573: the hall light latched while Foxy was at marker 123');
        return;
      }
      // g389/g390: an accepted move waits while the latch is set, then lands.
      if (fx.arrivalPending && !this.hallLatch && f >= fx.readyAt) {
        fx.arrivalPending = false; fx.loc = 'hall'; fx.exposure = 0; fx.D = 0;
        this.emit('foxy-arrive');
      }
      if (fx.lockPending && !this.hallLatch && f >= fx.pinUntil) {
        fx.lockPending = false; fx.gotYou = true;
        this.emit('foxy-lock');
        this.flag('foxy-lock', 'Foxy reached marker 123 once the hall latch cleared');
      }
    }
    if (fx.loc === 'parts') {
      // Light still reaches him: it pushes D back down and delays his return.
      if (hallLit && f % 30 === 0) fx.D = Math.max(0, fx.D - 1);
      return;
    }

    if (hallLit) {
      fx.exposure++;
      fx.D = 0; // the hall light zeroes it outright while he is standing there
      // While lit at hall stage 1 his B is pinned to 50 (group 855): eviction
      // and his rolls both wait for it to drain after the light comes off.
      fx.pinUntil = f + C.FOXY_HALL_PIN_FRAMES;
    } else if (fx.exposure > C.foxyExposureFrames(this.opts.night) && f >= fx.pinUntil) {
      // Retreat needs both lights off and B = 0 (group 846).
      fx.loc = 'parts'; fx.gotYou = false; fx.exposure = 0; fx.D = 0;
      fx.readyAt = f + this.rng.int(C.FOXY_RETURN_MIN, C.FOXY_RETURN_MAX, C.FOXY_RETURN_MIN);
      this.emit('foxy-leave');
    }
  }

  tickMask() {
    if (!this.maskOn) { this.maskDAccum = 0; return; }
    // Mask time also feeds Foxy's D when nobody is in a vent opening
    const someoneInOpening = this.bb.inOpening || this.units.some(u => u.atOpening);
    if (!this.blackout.active && !someoneInOpening && !this.opts.sourcedFoxyChain) {   // g825 runs in tickFoxyChain
      if (++this.maskDAccum >= C.FPS) { this.maskDAccum = 0; if (!this.foxyDormant) this.foxy.D++; }
    }
    // [SOURCED] BB is on the same counter as Toy Chica and Mangle: g907 adds
    // one to v12 per one-second event while the mask is fully on, g294 forces
    // him back to CAM 10 at v12 >= 5, and g292 is the 10%/s early leave. The
    // counter is a continuous hold, not storage -- g293 zeroes it on every
    // entry into the fully-on state (see setMask/maskAnim). The old cumulative
    // MASK_LEAVE_FRAMES path let separate flicks add up, which the source
    // does not do for any of the three.
    if (this.bb.inOpening && this.maskFullyOn &&
        (this.opts.sourcedGatedEvery ? this.maskTick : this.hooked ? this.secTick : this.frame % C.FPS === 0)) {   // g907
      this.bb.maskTicks++;
      if (this.opts.sourcedSecondPass) return;   // g292/g294 decide in secondPass
      if (this.opts.sourcedEventDraws) {
        const early = this.rng.chance(C.VENT_EARLY_LEAVE_CHANCE, false);   // g292 draws on every tick
        if (this.bb.maskTicks >= C.VENT_MASK_TICKS) { this.rng.int(0, 3, 0); this.bbLeave(); }   // e237
        else if (early) this.bbLeave();
      } else if (this.bb.maskTicks >= C.VENT_MASK_TICKS ||
          this.rng.chance(C.VENT_EARLY_LEAVE_CHANCE, false)) this.bbLeave();
    }
  }

  bbLeave() {
    this.bb.inOpening = false; this.bb.stage = 0; this.bb.pending = false;
    this.bb.maskTicks = 0;
    this.emit('vent-bang', { who: 'bb', leaving: true, sample: C.THUD_SAMPLE });
  }

  unitLeave(u, opts = {}) {
    u.atOpening = false; u.inside = false; u.promoted = false;               // g538-g555: value 0 = 0
    u.idx = opts.idx ?? (this.opts.sourcedMangleReturn && u.id === 'mangle' ? u.path.findIndex(n => n === 7) : u.repelIdx) ?? 0;   // g400/g401: CAM 7
    // Repels write the unit's B: the movement pipeline requires B = 0, so the
    // cooldown is the same counter as the flash stun (and Toy Bonnie's
    // opening timer).
    if (opts.cooldown) u.stunUntil = this.frame + opts.cooldown;
    u.openingSince = -1; u.openingReadyAt = -1; u.openingTicks = 0;
    u.officeCue = false; u.maskExposureTicks = 0; u.raiseSeen = false;
    u.insideArmed = false;
    // Do not clear insideDangerAt: `danger 2` is global in the source, so a
    // same-tick route return cannot cancel an attack that was already raised.
    if (this.engagedToy === u.id) this.engagedToy = null;
    this.emit('vent-bang', { who: u.id, leaving: true, sample: C.THUD_SAMPLE });
  }

  onCamsUp() {
    this.camsUpCount++;
    // BB steps into the opening the moment the cams come up if he was waiting.
    // [SOURCED] g417 is his only monitor-gated edge and it consumes a latched
    // A = 2, so cameras down defer the hop instead of cancelling it.
    if (this.bb.pending && this.bb.stage === C.BB_STAGES - 1) {
      this.bb.pending = false; this.bbEnterOpening(); return;
    }
    // and walks in if he is already sitting in the opening. He does not kill:
    // g96 forces `lit?` to zero every frame while he is at 123, g301/303 stop
    // the vent lights answering, and no group ever moves him back out. Foxy
    // finishes the job, which is what actually ends the run.
    if (this.bb.inOpening && this.bb.openingAtCamsUp !== this.camsUpCount) {
      this.bb.inside = true;
      this.bb.inOpening = false;
      this.lightHeld = this.ventLightL = this.ventLightR = false;
      this.flag('bb-inside', 'Balloon Boy walked in — the flashlight is gone for the rest of the night');
      this.emit('bb-inside');
    }
  }

  // One route hop along CAM 10 -> 07 -> 03 -> 01 -> 05 (g413-416). The first
  // hop is silent in the source; the next three play his vocal bank, which is
  // the "laugh" a player counts. Reaching CAM 05 is the vent-camera cue.
  bbHop() {
    this.bb.stage++;
    if (this.opts.sourcedFootstepDraws && this.footstepNodes().has([10, 7, 3, 1, 5][this.bb.stage])) this.bb.footstep = true;
    let vocal = null;   // which of his three vocals the cue selects (g608 -> 21 "hi", g609 -> 24 laugh, g610 -> 23 "hello")
    if (this.opts.sourcedEventDraws && this.bb.stage >= 2) {            // e351/e352/e353
      let cue = this.rng.int(0, 3, 0) + 1;                                // cam01 value 6
      if (this.bb.stage === C.BB_STAGES - 1) this.rng.int(0, 3, 0);       // e353 also writes value 21
      if (cue === 4) cue = this.rng.int(0, 2, 0) + 1;                     // e548 redraws a 4
      vocal = [null, 21, 24, 23][cue];
    }
    if (this.bb.stage > C.BB_SILENT_HOPS)
      this.emit('laugh', vocal === null ? { samples: C.BB_VOCAL_SAMPLES } : { samples: C.BB_VOCAL_SAMPLES, vocal });   // shape unchanged when no cue is drawn: the device bundles hash the event stream
    if (this.bb.stage === C.BB_STAGES - 1) {
      this.emit('vent-bang', {
        who: 'bb', leaving: false, cam: true, sample: C.THUD_SAMPLE });
    }
  }

  bbEnterOpening() {
    if (this.opts.sourcedEventDraws) this.rng.int(0, 3, 0);              // e354
    this.bb.stage = C.BB_STAGES; this.bb.inOpening = true;
    this.bb.openingAtCamsUp = this.camsUpCount;
    // g417 plays only the movement sample every hop shares -- no laugh here,
    // but g607 adds sample 21 once on arrival, so this edge is a pair.
    this.emit('vent-bang', {
      who: 'bb', leaving: false, sample: C.THUD_SAMPLE,
      arrival: C.BB_ARRIVAL_SAMPLE });
  }

  // Sourced hop gates: a unit whose movement roll has passed still waits at
  // its room until every gate on the next hop is open (mirrors the state-2
  // transition groups, which retry continuously until their conditions hold).
  /** g744: decide path = Random(2) + 1, bit-exact to Fusion's Random(2). */
  /** g333-g343 in sheet order under sourcedRollDraws: every roll draws; state gates only the outcome. */
  rollAllFiveSecond() {
    /** @param {string} id */
    // sourcedRollsBeforeMoves: g333-g343 roll everyone first; the promotions (g344-g358) and the moves (g380 on)
    // come after the last roll, so a move's own draws (e324) cannot shift a later character's roll.
    /** @type {any[] | null} */
    const deferred = this.opts.sourcedRollsBeforeMoves ? [] : null;
    /** @param {string} id */
    const rollUnit = id => {                                                   // g333-g335, g338-g341
      const hit = this.rng.chance(C.MO_CHANCE(this.ai[id]), true);
      const u = this.units.find(x => x.id === id);
      if (!hit || !this.opts.stalledEnabled || !u || u.done || u.atOpening) return;
      if (deferred) deferred.push(id); else settleRoll(u, id);
    };
    /** @param {any} u @param {string} id */
    const settleRoll = (u, id) => {
      this.footstepPromote(u, true);                                           // g344-g358: value 2 = 10
      const step = this.sourcedRouteStep(u, this.frame);
      if (step === 'discard' || step === 'returned') { u.promoted = false; return; }
      if (this.opts.sourcedViewDraws && !this.opts.sourcedPromotedViewDraws) this.fadeUntil[u.id] = this.frame + 8;
      if (this.cam8CancelAt[id] === this.frame) return;                        // g380/g385 zeroed value 0 (sourcedCam8Cancel)
      if (step !== 'hold' && this.canAdvance(u, this.frame)) this.advance(u);
      else u.pending = true;
    };
    rollUnit('withfreddy'); rollUnit('withbonnie'); rollUnit('withchica');
    {                                                                          // g336 Golden Freddy
      const hit = this.rng.chance(C.MO_CHANCE(this.ai.golden), true);
      if (hit && this.opts.gfEnabled && !this.gf.present && !this.maskOn && this.monitor === MON_UP) {
        this.gf.present = true;
        this.emit('gf-appear');
      }
    }
    {                                                                          // g337 Foxy
      const fx = this.foxy;
      const ok = 21 + this.rng.int(0, 4, 0) - fx.D <= this.ai.foxy;
      if (this.opts.foxyEnabled) {
        if (this.opts.sourcedFoxyChain) { if (ok) { fx.A = 1; fx.D = 0; } }
        else if (this.opts.sourcedDropLightOrder && (fx.arrivalPending || fx.lockPending)) { /* waiting on the latch */ }
        else if (this.opts.sourcedDropLightOrder && fx.loc === 'parts') { if (this.frame >= fx.readyAt && ok) { fx.D = 0; fx.arrivalPending = true; } }
        else if (this.opts.sourcedDropLightOrder) { if (!fx.gotYou && this.frame >= fx.pinUntil && ok) { fx.D = 0; fx.lockPending = true; } }
        else if (fx.loc === 'parts') {
          if (this.frame >= fx.readyAt && ok) { fx.loc = 'hall'; fx.exposure = 0; fx.D = 0; this.emit('foxy-arrive'); }
        } else if (!fx.gotYou && this.frame >= fx.pinUntil && ok) {
          fx.gotYou = true;
          this.emit('foxy-lock');
          this.flag('foxy-lock', `Foxy locked on with D = ${fx.D}`);
        }
      }
    }
    rollUnit('toyfreddy'); rollUnit('toybonnie'); rollUnit('toychica'); rollUnit('mangle');
    {                                                                          // g342 Balloon Boy
      const hit = this.rng.chance(C.MO_CHANCE(this.ai.bb), true);
      if (hit && this.opts.bbEnabled && !this.bb.inOpening) {
        if (this.opts.sourcedViewDraws) this.fadeUntil.bb = this.frame + 8;
        if (this.bb.stage === C.BB_STAGES - 1) {
          if (this.monitor === MON_UP) this.bbEnterOpening();
          else this.bb.pending = true;
        } else {
          this.bbHop();
        }
      }
    }
    this.rng.int(0, 19, 0);                                                    // g343 Paper Pals
    if (deferred) for (const id of deferred) {                                 // g344-g358, then the moves
      const u = this.units.find(x => x.id === id);
      if (u && !u.done && !u.atOpening) settleRoll(u, id);
    }
  }

  rollDecidePath() {
    this.decidePath = this.rng.int(0, 1) + 1;
    return this.decidePath;
  }

  /**
   * The dump's look-hold and route rules the base gates do not express, for a
   * unit whose movement roll has passed (A = 1 or 2). Returns 'hold' (keep it
   * pending), 'discard' (A = 0, roll spent), 'returned' (g378 moved it), or
   * null (fall through to canAdvance). Null whenever sourcedRouteForks is off.
   * @param {any} u
   * @param {number} f
   */
  sourcedRouteStep(u, f) {
    if (!this.opts.sourcedRouteForks) return null;
    const onCam = (id, cam) => this.units.some(o => o.id === id && !o.done && !o.atOpening && o.path[o.idx] === cam);
    if (this.opts.night !== 7) {
      if (u.id === 'withfreddy' && (onCam('withchica', 8) || onCam('withbonnie', 8))) return 'hold';   // g344
      if (u.id === 'withchica' && onCam('withbonnie', 8)) return 'hold';                               // g347
      if (u.id === 'toyfreddy' && f >= u.stunUntil && onCam('toychica', 9)) return 'discard';          // g352
      if (u.id === 'toychica' && f >= u.stunUntil && onCam('toybonnie', 9)) return 'discard';          // g356
    }
    if (u.id === 'withfreddy' && u.path[u.idx] === 3 && this.decidePath !== 1 && this.decidePath !== 2)
      return 'hold';
    if (u.id === 'withfreddy' && u.path[u.idx] === 'blindB' &&
        (this.opts.sourcedPromotedMoves ? u.promoted : f >= u.stunUntil) &&
        this.maskFullyOn && !this.lightStallOn) {                                                       // g378
      u.idx = u.path.indexOf(3);
      u.stunUntil = f + (5000 - this.opts.night * 500);
      this.emit('route-return', { who: u.id, from: 'blindB', to: 3 });
      this.flag('broke-loose', `${u.name} returned from hall stage 2 to CAM 03 under a fully-on mask`);
      return 'returned';
    }
    return null;
  }

  canAdvance(u, f) {
    // sourcedPromotedMoves: the move groups test value 0 == 2; the stun and the marker were the promotion's.
    if (this.opts.sourcedPromotedMoves) { if (!u.promoted) return false; }
    else if (f < u.stunUntil) return false;
    // Android Office groups 344-348 and 357 (post-XOR decode): the
    // selected-camera marker holds a Withered's pending roll while it
    // overlaps their room, with NO monitor condition — and lowering the
    // monitor leaves the marker parked on the last-selected camera (group
    // 262 zeroes `viewing` but never moves `your view`), so the Withered
    // hold persists monitor-down. Mangle's marker gate (357) applies only
    // while the monitor is up; her monitor-down block is the office hall
    // light (358), modeled by the lightStall path below.
    if (!this.opts.sourcedPromotedMoves && this.opts.selectedCameraGate &&
        C.SELECTED_CAMERA_GATED.has(u.id) && u.path[u.idx] === this.cam &&
        (C.WITHEREDS.has(u.id) || this.camsUp))
      return false;
    const next = u.path[u.idx + 1];
    const entry = next === 'ventL' || next === 'ventR' || next === 'office';
    if (entry) {
      if (u.entryGate === 'camsUp' && !this.camsUp) return false;
      // Toy Bonnie's vent hop (group 428) also needs the right vent light off
      // — holding it stalls his entry (the Shooter25 stall).
      if (u.entryGate === 'camsDown' && (this.camsUp || this.ventLightROn)) return false;
      if (u.mutex && this.engagedToy && this.engagedToy !== u.id) return false;
      // g384/g388: W. Bonnie's and W. Chica's final hops also need `in danger`
      // = 0, the encounter latch the model carries as the running blackout.
      if (this.opts.sourcedRouteForks && (u.id === 'withbonnie' || u.id === 'withchica') &&
          this.blackout.active) return false;
    } else if (this.opts.sourcedRouteForks && u.id === 'mangle' && u.path[u.idx] === 1 &&
               !this.camsUp && this.lightStallOn) {
      return false; // g399: CAM 01 -> CAM 02 needs the hall light latch clear
    } else if (u.lightStallAt.includes(u.idx) && !this.camsUp && this.lightStallOn) {
      return false; // only source edges guarded by `new bonnie = 0`
    }
    return true;
  }

  tickUnits(f) {
    if (!this.opts.stalledEnabled) return;
    for (const u of this.units) {
      if (u.done) continue;
      // Stage 2 first: a committed attack runs out its animation and kills.
      if (u.committedAt >= 0) {
        if (f >= u.committedAt) {
          this.kill('inside-office',
            `${u.name} completed the sourced ${C.INSIDE_ATTACK_FRAMES}-frame ` +
            'marker-123 attack');
          return;
        }
        continue;
      }
      // g533: `got you stage` == 1 AND `mask` == 2 -> stage 0. The reaction
      // window is cancelled outright by getting the mask FULLY on -- not merely
      // pressed, since g9 sets mask = 2 only after the 12-frame put-on
      // animation, which is what `maskFullyOn` means here.
      //
      // Added 2026-08-26. Its absence is why every withered that reached the
      // office was fatal: the countdown existed, the kill existed, and the one
      // documented escape did not.
      if (u.insideDangerAt >= 0 && this.maskFullyOn) {
        u.insideDangerAt = -1;
        this.emit('inside-cancelled', { who: u.id, why: 'mask fully on inside `time left`' });
        continue;
      }
      // g532: `time left` <= 0 -> stage 2.
      if (u.insideDangerAt >= 0 && f >= u.insideDangerAt) {
        this.commitAttack(u, `the mask was not fully on within night ` +
          `${this.opts.night}'s ${C.timeAllowedFrames(this.opts.night)}-frame window`);
        continue;
      }
      if (u.inside) {
        if (u.id === 'mangle') {
          if (!this.opts.sourcedSecondPass && this.camsUp && f % C.FPS === 0 &&
              this.rng.chance(C.MANGLE_INSIDE_ARM_CHANCE, true))
            u.insideArmed = true;
          if (!this.camsUp && u.insideArmed)
            this.commitAttack(u, 'Mangle armed while the cameras were up');
        } else if (u.id === 'toybonnie') {
          // In addition to the shared monitor-lowering trigger, Toy Bonnie at
          // marker 123 raises danger every ten seconds spent cameras-up
          // (group 722).
          if (this.opts.sourcedGatedEvery ? this.viewing > 0 && this.gatedPass('g722', 10000)
              : this.camsUp && (this.hooked ? this.tenTick : f % (C.FPS * 10) === 0))   // g722
            this.commitAttack(u, 'Toy Bonnie remained inside with cameras up');
        } else if (u.openingRule === 'streak' && this.maskFullyOn && f % C.FPS === 0 && !this.opts.sourcedSecondPass) {
          // Groups 556-559 precede the 10% return groups 747-750. Preserve
          // that order: a simultaneous attack roll is not cancelled by leave.
          // g556-559 set `being attacked by` outright: this is stage 2, not a
          // new reaction window. Masking is what EXPOSES you to this roll, so
          // it cannot also be the escape from it.
          if (this.rng.chance(C.INSIDE_MASK_ATTACK_CHANCE, true))
            this.commitAttack(u, 'inside-office mask attack roll');
          // A marker-123 leave returns to the route start with B = 500
          // (groups 747-750).
          if (this.rng.chance(C.INSIDE_MASK_LEAVE_CHANCE, false))
            this.unitLeave(u, { idx: 0, cooldown: C.INSIDE_LEAVE_COOLDOWN });
        }
        continue;
      }
      if (u.pending) {
        this.footstepPromote(u, false);                                        // a held roll promoted late
        const step = this.sourcedRouteStep(u, f);
        if (step === 'discard' || step === 'returned') { u.pending = false; u.promoted = false; }
        else if (step !== 'hold' && this.canAdvance(u, f)) { u.pending = false; this.advance(u); }
      }
      // The three Withereds and Toy Freddy -- the four `streak` openers --
      // start the shared office sequence as soon as marker 122 is evaluated
      // with the cameras down (groups 445-447 and 490). "Toys and W. Freddy"
      // was the pre-XOR attribution; config.js's entryStreakFrames note
      // records the 2026-08-20 re-binding.
      if (u.atOpening && u.openingRule === 'streak' && !this.camsUp && !u.officeCue)
        this.startOfficeEncounter(u);

      // Toy Bonnie creates his separate visible overlay on a 500 ms / 50% roll
      // while the Freddy mask is fully on (groups 436 and 443).
      if (!this.opts.sourcedSecondPass && u.id === 'toybonnie' && u.atOpening && this.maskFullyOn && !u.officeCue &&
          !this.blackout.active && f % C.TOY_BONNIE_CUE_FRAMES === 0 &&
          this.rng.chance(C.TOY_BONNIE_CUE_CHANCE, false)) {
        this.startOfficeEncounter(u);
      }

      // Toy Chica and Mangle have no generic immediate repel. With the mask
      // fully on they get a 10% leave roll per one-second event and are forced
      // out after five continuous mask ticks (groups 292-294, 400-401, 907).
      if ((u.id === 'toychica' || u.id === 'mangle') && u.atOpening &&
          this.maskFullyOn && (this.opts.sourcedGatedEvery ? this.maskTick : this.hooked ? this.secTick : f % C.FPS === 0)) {   // g907
        u.maskExposureTicks++;
        if (this.opts.sourcedSecondPass) { /* g400/g401/g439/g440 decide in secondPass */ }
        else if (this.opts.sourcedEventDraws) {
          const early = this.rng.chance(C.VENT_EARLY_LEAVE_CHANCE, false);   // drawn on every tick
          if (u.maskExposureTicks >= 5) { this.rng.int(0, 3, 0); this.unitLeave(u); continue; }   // e338/e377
          if (early) { this.unitLeave(u); continue; }
        } else if (u.maskExposureTicks >= 5 || this.rng.chance(C.VENT_EARLY_LEAVE_CHANCE, false)) {
          this.unitLeave(u);
          continue;
        }
      }
      // g903 zeroes Toy Chica's v8 on arrival; g904 increments it on a
      // one-second event at marker 122 (the global grid by default; under
      // sourcedGatedEvery its own countdown, which runs only while she is
      // there). g905 needs v8 > 5 and cameras up, so this is six ticks, not a
      // fixed five-second delay.
      if (u.id === 'toychica' && u.atOpening &&
          (this.opts.sourcedGatedEvery ? this.gatedPass('g904', 1000) : this.hooked ? this.secTick : f % C.FPS === 0))   // g904
        u.openingTicks++;
      const streakKill = u.atOpening && u.openingRule === 'streak' && (this.opts.sourcedGatedEvery
        ? this.viewing > 0 && this.streakTicks >= 20 - 2 * this.opts.night          // g542-g545 read g786's value 25
        : this.camsUpSince >= 0 && f - this.camsUpSince >= C.entryStreakFrames(this.opts.night));
      const armedKill = u.atOpening && u.openingRule === 'mask' && this.camsUp &&
        (u.id === 'toybonnie'
          ? f >= u.stunUntil
          : u.openingTicks >= C.TOY_CHICA_OPENING_TICKS);
      if (streakKill || armedKill) {
        const why = streakKill
          ? (this.opts.sourcedGatedEvery ? `the cams-up streak reached ${this.streakTicks} with someone at the opening`
             : `cams stayed up ${((f - this.camsUpSince) / C.FPS).toFixed(1)}s with someone at the opening`)
          : 'their sourced opening timer armed before the next cams-up trip';
        if (streakKill && this.opts.sourcedEventDraws) this.rng.int(0, C.REPEL_COOLDOWN_ROLL - 1, 0);   // e479-e482
        this.unitEnterInside(u, why);
      }
    }
  }

  advance(u) {
    if (this.opts.sourcedRouteForks) {
      const here = u.path[u.idx];
      if (u.id === 'withfreddy' && here === 3 && this.decidePath === 2) {                              // g377
        u.idx = u.path.indexOf(7);
        this.emit('route-fork', { who: u.id, at: 3, to: 7 });
        this.flag('broke-loose', `${u.name} moved to CAM 07 (decide path 2)`);
        return;
      }
      if (u.id === 'mangle' && here === 2 && this.decidePath === 2) {                                  // g397
        // Replace, never mutate: units spread the shared route table.
        u.basePath ??= u.path;
        const at = u.basePath.indexOf(2);
        u.path = [...u.basePath.slice(0, at + 1), 1, 2, ...u.basePath.slice(at + 1)];
        u.idx = at;
        this.emit('route-fork', { who: u.id, at: 2, to: 1 });
      } else if (u.id === 'mangle' && here === 1 && u.basePath) {                                      // g399
        u.path = u.basePath;
        u.idx = u.basePath.indexOf(2) - 1;
      }
    }
    if (this.opts.sourcedEventDraws && u.id === 'withchica' && u.path[u.idx] === 2 && u.path[u.idx + 1] === 6)
      this.rng.int(0, 3, 0);                                               // e324
    if (this.opts.sourcedCam8Cancel && u.path[u.idx] === 8 && (u.id === 'withbonnie' || u.id === 'withchica')) {
      for (const id of u.id === 'withbonnie' ? ['withfreddy', 'withchica'] : ['withfreddy']) {   // g380, g385
        const o = this.units.find(x => x.id === id);
        if (o) o.pending = false;
        this.cam8CancelAt[id] = this.frame;
      }
    }
    u.idx++;
    // A move needs value 0 == 2, so one the model makes without a recorded promotion is promoted on this
    // loop; a move promoted loops ago keeps its drained value 2. The move sets value 0 = 0.
    if (this.opts.sourcedFootstepValue2 && !u.promoted) u.value2 = 10;
    if (this.opts.sourcedPromotedViewDraws && !u.promoted) this.fadeUntil[u.id] = this.frame + 8;   // promoted on this loop
    u.promoted = false;
    const node = u.path[u.idx];
    if (this.opts.sourcedFootstepDraws && !this.opts.sourcedFootstepValue2 && this.footstepNodes().has(node))
      u.footstep = true;                                                       // g695-g703, next pass
    if (node === 'office' || node === 'ventL' || node === 'ventR') {
      u.atOpening = true; u.openingSince = this.frame; u.openingTicks = 0;
      // Toy Bonnie's opening timer IS his B counter (group 428 writes
      // B = 1000-100*night on arrival; g546 needs B = 0 plus a monitor
      // raise), so it shares the flash-stun/repel-cooldown field.
      if (u.id === 'toybonnie')
        u.stunUntil = this.frame + C.toyBonnieOpeningFrames(this.opts.night);
      if (u.mutex) this.engagedToy = u.id;
      this.emit('vent-bang', { who: u.id, leaving: false, sample: C.THUD_SAMPLE });
      this.flag('broke-loose', `${u.name} reached office threshold marker 122`);
      if (u.openingRule === 'streak' && !this.camsUp) this.startOfficeEncounter(u);
    } else {
      this.flag('broke-loose', `${u.name} moved to CAM ${String(node).padStart(2, '0')}`);
    }
  }

  onFiveSecond() {
    if (this.opts.sourcedRollDraws) { this.rollAllFiveSecond(); return; }
    // 1. Foxy. The same equation decides his arrival and his kill.
    if (this.opts.foxyEnabled) {
      const fx = this.foxy;
      const eq = () => 21 + this.rng.int(0, 4, 0) - fx.D <= this.ai.foxy;
      if (this.opts.sourcedFoxyChain) {
        // g337: no location, pin or state condition, so the draw is spent every 5 s.
        if (21 + this.rng.int(0, 4, 0) - fx.D <= this.ai.foxy) { fx.A = 1; fx.D = 0; }
      } else if (this.opts.sourcedDropLightOrder && (fx.arrivalPending || fx.lockPending)) {
        // an accepted move is already waiting for the latch (g389/g390)
      } else if (this.opts.sourcedDropLightOrder && fx.loc === 'parts') {
        if (this.frame >= fx.readyAt && eq()) { fx.D = 0; fx.arrivalPending = true; }            // g337 -> g389
      } else if (this.opts.sourcedDropLightOrder) {
        if (!fx.gotYou && this.frame >= fx.pinUntil && eq()) { fx.D = 0; fx.lockPending = true; } // g337 -> g390
      } else if (fx.loc === 'parts') {
        if (this.frame >= fx.readyAt && eq()) {
          // Android Office g389 resets old foxy.v3 on CAM 08 -> hall stage 1.
          // Arrival's accumulated D must not become the hall attack timer,
          // especially when a simultaneous blackout prevents the next flash.
          fx.loc = 'hall'; fx.exposure = 0; fx.D = 0;
          this.emit('foxy-arrive');
        }
      } else if (!fx.gotYou && this.frame >= fx.pinUntil && eq()) {
        fx.gotYou = true;
        this.emit('foxy-lock');
        this.flag('foxy-lock', `Foxy locked on with D = ${fx.D}`);
      }
    }
    // 2. the seven
    if (this.opts.stalledEnabled) {
      for (const u of this.units) {
        if (u.done || u.atOpening) continue;
        if (this.rng.chance(C.MO_CHANCE(this.ai[u.id]), true)) {
          // A successful roll enters the source's retrying transition state.
          // Stun is only one of the reasons that transition may be closed:
          // monitor polarity, the office-light stall and the one-toy mutex are
          // equally load-bearing. Keep the move pending until every gate opens.
          this.footstepPromote(u, true);                                       // g344-g358: value 2 = 10
          const step = this.sourcedRouteStep(u, this.frame);
          if (step === 'discard' || step === 'returned') { u.promoted = false; /* A = 0: the roll is spent */ }
          else {
            if (this.opts.sourcedViewDraws && !this.opts.sourcedPromotedViewDraws)
              this.fadeUntil[u.id] = this.frame + 8;                               // g344-g358: A = 2, C = 10
            if (step !== 'hold' && this.canAdvance(u, this.frame)) this.advance(u);
            else u.pending = true;
          }
        }
      }
    }
    // 3. Balloon Boy. His roll (g342) carries no monitor, camera or light
    // condition, and his look-hold row (g359) has no exclusion, so every route
    // hop resolves on the spot. Only the hop into the opening (g417) waits for
    // the monitor: that roll latches until the next raise completes.
    if (this.opts.bbEnabled && !this.bb.inOpening) {
      if (this.rng.chance(C.MO_CHANCE(this.ai.bb), true)) {
        if (this.opts.sourcedViewDraws) this.fadeUntil.bb = this.frame + 8;   // g359: C = 10
        if (this.bb.stage === C.BB_STAGES - 1) {
          if (this.monitor === MON_UP) this.bbEnterOpening();
          else this.bb.pending = true;
        } else {
          this.bbHop();
        }
      }
    }
    // 4. Golden Freddy
    if (this.opts.gfEnabled && !this.gf.present && !this.maskOn) {
      // g336 needs the raise *finished* -- `viewing > 0` with the monitor-up
      // animation complete. The old 0.3 s "unfair raise" window was a
      // [CALIBRATED] guess at an Android bug and has no group behind it.
      if (this.monitor === MON_UP && this.rng.chance(C.MO_CHANCE(this.ai.golden), true)) {
        this.gf.present = true;
        this.emit('gf-appear');
      }
    }
  }

  tickBox() {
    if (!this.opts.boxEnabled) return;
    if (this.isWinding) {
      // g637/g644: the 'WinD' ratchet on a global 500 ms timer. Frame-locked
      // grid, so the edge carries the game's phase mod WIND_TICK_FRAMES.
      if (this.hooked ? this.halfTick : this.frame % C.WIND_TICK_FRAMES === 0)   // g637/g644
        this.emit('wind-tick', { sample: C.WIND_TICK_SAMPLE });
      // g639/g645: a wind below 300 snaps the counter to 300 first. The climb
      // rate below is already the 300 -> 2000 one, so without this the engine
      // was slower than the game at the bottom of the box -- the only place
      // the difference can cost a night.
      this.box = Math.min(1, Math.max(this.box, C.BOX_SNAP) + 1 / C.BOX_WIND_FRAMES);
      this.boxHold = 10;                                                                     // g638/g643
    } else if (this.opts.sourcedBoxCountdown) {
      // drained in the late pass (drainBoxCountdown)
    } else if (C.boxDrainsAtHour(this.opts.night, Math.floor(this.frame / C.HOUR_FRAMES))) {
      // Per-night rate, sourced at g653-660, and g653's hour gate: night 1's
      // box does not drain during 12 AM or 1 AM. This used to apply the night
      // 6/7 rate from t=0 to every night, which made Night 1 demand winding
      // 3.3x sooner than the game does and two hours earlier than it starts.
      this.box = Math.max(0, this.box - 1 / C.boxDrainFrames(this.opts.night));
    }
    this.tickPuppet();
  }

  // Puppet source order is route actions g404-411, the one-second arm/branch
  // groups g494-497, the office roll g623, and finally the camera B=10 write
  // g774. A successful roll therefore becomes a move on the next frame.
  tickPuppet() {
    const p = /** @type {any} */ (this.puppet);
    const f = this.frame;

    if (p.attackAt >= 0) {
      if (f >= p.attackAt)
        this.kill('puppet', 'The Puppet completed the sourced 40-frame marker-123 attack');
      return;
    }

    if (p.pending && !p.atOpening && !p.inside && !this.opts.sourcedPuppetMoveOrder) {
      p.pending = false;
      this.advancePuppet();
    }

    if (f % C.FPS === 0 && !this.opts.sourcedSecondPass) {
      // g494/g495: three successful one-second rolls while the box is empty.
      // CAM 11 light blocks the viewing=11 branch; every other view rolls.
      if (this.box <= 0 && !p.out && p.stage < C.PUPPET_ESCAPE_STAGES) {
        const protectedByLight = this.camLightOn && this.viewing === C.BOX_CAM;
        if (!protectedByLight && this.rng.chance(C.PUPPET_MO_CHANCE(this.ai.puppet), true)) {
          p.stage++;
          this.emit('puppet-stage', p.stage);
          if (p.stage >= C.PUPPET_ESCAPE_STAGES) {
            p.out = true;
            this.emit('puppet-out');
          }
        }
      }

      // g496: after escape, each one-second AI success arms one route hop,
      // provided B has drained to zero.
      if (p.out && !p.atOpening && !p.inside && f >= p.stunUntil &&
          this.rng.chance(C.PUPPET_MO_CHANCE(this.ai.puppet), true))
        p.pending = true;

      // g497 rewrites the next 07 branch choice every second.
      p.pathChoice = this.rng.int(1, 2, 1) === 1 ? 'left' : 'right';

      // g623: marker 122 is not lethal on arrival. It rolls 1-in-10 each
      // second to move to 123; g574 then raises attack code 9 and forcedown.
      if (p.atOpening && this.rng.int(0, C.PUPPET_OFFICE_ROLL - 1, 1) === 1) {
        p.atOpening = false;
        p.inside = true;
        p.loc = 'inside';
        p.attackAt = f + C.INSIDE_ATTACK_FRAMES;
        this.dropEverything = true;
        this.emit('puppet-attack', { at: 123 });
      }
    }

    // g774 executes after the movement roll. Outside CAM 11, lighting the
    // Puppet's current camera rewrites B to 10 every frame; g372 drains it.
    if (this.camLightOn && p.out && !p.atOpening && !p.inside &&
        p.loc !== C.BOX_CAM && p.loc === this.cam)
      p.stunUntil = f + C.PUPPET_CAMERA_PIN_FRAMES;
  }

  advancePuppet() {
    const p = /** @type {any} */ (this.puppet);
    if (p.loc === 11) p.loc = 10;
    else if (p.loc === 10) p.loc = 7;
    else if (p.loc === 7) {
      p.route = C.PUPPET_ROUTE[p.pathChoice];
      p.loc = p.pathChoice === 'left' ? 3 : 4;
    } else if (p.loc === 3) p.loc = 1;
    else if (p.loc === 4) p.loc = 2;
    else if (p.loc === 1 || p.loc === 2) {
      p.loc = 'opening';
      p.atOpening = true;
    }
    p.idx++;
    this.emit('puppet-move', { at: p.atOpening ? 'office' : p.loc });
  }

  record() {
    const r = this.rec, i = r.n++;
    let occ = 0;
    for (let k = 0; k < 3; k++) {
      const camId = C.TARGET_CAMS[k];
      let best = 0, here = false;
      for (const u of this.units) {
        if (u.done || u.path[u.idx] !== camId) continue;
        here = true;
        if (u.stunUntil > this.frame) best = Math.max(best, u.stunUntil - this.frame);
      }
      r.stun[k][i] = best;
      if (here) occ |= (1 << k);
    }
    r.occ[i] = occ;
    r.d[i] = Math.min(255, this.foxy.D);
    r.power[i] = this.power;
    r.box[i] = Math.round(this.box * 255);
    r.flags[i] = (this.maskOn ? 1 : 0) | (this.camsUp ? 2 : 0) | (this.anyOfficeLightHeld ? 4 : 0) |
                 (this.bb.inOpening ? 8 : 0) | (this.gf.present ? 16 : 0) | (this.gf.inHall ? 32 : 0);
  }
}
