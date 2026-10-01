import * as C from './config.ts';

/**
 * The Sim's options at their defaults, a new object on every call (the default seed is drawn per Sim).
 * The comment above each option says what it models and where it was read.
 */
export type SimOptions = ReturnType<typeof defaultSimOptions>;

export function defaultSimOptions() {
  return {
    seed: (Math.random() * 4294967295) >>> 0,
    worst: false,
    night: 7,             // sourced tables index by night; 7 = 10/20 mode
    // A Custom Night AI vector (an `AI_DIALS` map). Replaces the night-7 AI
    // table with the player's ten dials; requires `night: 7`, since Custom
    // Night is night 7 in the menus and every `night >= 7` rule must apply.
    customNight: (null as null | Readonly<Record<string, number>>),
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
    // g1/g6/g9/g10 read animation counters at the top; g1015-g1022 reset on show and add value 5 late.
    // At 60 Hz they take 12/22/12/14 updates. A measured clock needs accumulated value 5, not a fixed count:
    // docs/evidence/full06-animation-clock-20260930.json explains the BB entry/draw split at update 1823.
    sourcedAnimationCount: false,
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
    // g537 resolves on the rising edge of clock >= 300. g534-g536 retain that clock through the fade;
    // a new encounter can restart the fade before its reset. See blackout-clock.js and full06-winning-branch.
    // Requires sourcedBlackoutDraws and frameMs; off resolves 300 frames after encounter start.
    sourcedBlackoutClockEnd: false,
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
    // Foxy's move writes his value 2 (requires sourcedFootstepDraws and sourcedFoxyChain). g389 (generated
    // e317: A == 2, on CAM 08, viewing hall light == 0) sets A = 0, moves him to hall stage 1 and sets
    // value 2 = 10 itself, as g349 did at the acceptance (e277). Hall stage 1 is under `hear footsteps`,
    // so g698 draws on every move, however long the latch held it after g349; off, the draw needs the
    // move within ten loops of the acceptance. Night 7 10/20 k3 at seed 27656: Foxy accepted on loop 300,
    // value 2 drained to 0 by 309, moved on 361 with value 2 = 10 again, and the rebuilt runtime drew
    // Random(5) there (tools/recompile/results/model-foxy-move-value2-20260929.json).
    sourcedFoxyMoveValue2: false,
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
    // Footsteps at the office opening (requires sourcedFootstepValue2 and sourcedRollDraws). `in office` (122,
    // at (668, 612)) overlaps `hear footsteps` (x 538-802, y 458-609) for the bottom/centre-hotspot sprites:
    // Withered Bonnie, Toy Bonnie and Mangle among the route units (docs/android/ANDROID-SOURCE-STATUS.md; the
    // rebuilt runtime's instance dump puts W. Bonnie's box at 656,589-680,613 there). g333-g343 roll a unit
    // wherever it stands, so a passed roll at 122 sets value 0 = 1, g346/g353/g357/g358 promote it (value 2 =
    // 10), and g696/g700/g703 draw its footstep where it stands; an arrival at 122 inside value 2's window
    // draws too. Off: a unit at the opening is not rolled into a promotion and 122 is not a footstep marker
    // (Night 7 k3 tick 2100: W. Bonnie, at 122 in her encounter, promoted and drew before Mangle's g703).
    sourcedOfficeFootsteps: false,
    // The rolls at the office opening as the sheet keeps them (requires sourcedOfficeFootsteps and sourcedRoutePass).
    // A passed roll at 122 leaves value 0 = 1 until g344-g360 promote it, re-tested every loop: Mangle's g358 holds
    // on the hall latch, so a roll on a latched loop is promoted, and draws g703, on the loop after g488 clears it
    // (Night 5 contact-final tick 9301 in the rebuilt runtime). Balloon Boy is rolled at 122 too: g359 promotes him
    // unconditionally and g702 draws his footstep there, as it does when he arrives within value 2's window. His
    // value 0 then stays 2, since no move group leaves 122 and g292/g294 do not clear it, so the loop g292/g294
    // send him to CAM 10, g413 (later in the sheet) moves him on to CAM 07 (Night 7 k3 tick 4703).
    sourcedOfficeRolls: false,
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
    // Promotions read B before its drain, g546 afterwards; hall pins g848-g854 follow the g488/g489 reset.
    sourcedBDrainOrder: false,
    // Actual B countdowns for route units and the Puppet: drain by value 5 between promotions and moves.
    // Update deadlines lose measured-clock time (full-06 Freddy step: model 3045, rebuild 3047).
    sourcedMovementClock: false,
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
    // The promotions and the moves as two passes, where the sheet runs them (requires sourcedPromotedMoves and
    // sourcedRollsBeforeMoves). Every loop, g344-g360 test the promotion of every waiting roll, and only then do
    // g374-g435 move the promoted units, right after the rolls (g333-g343) and before g436 on. The model settled a
    // roll inside the roll pass and a waiting unit in tickUnits (after the g436-g518 draws), unit by unit, so one
    // unit's move could land before another's promotion test read it: on Night 1 minimal (tick 21715 in the rebuilt
    // runtime) Toy Chica's g356 discard reads Toy Bonnie still on CAM 09, where the model had already moved him.
    // On: after the rolls, every waiting unit's promotion is tested (and the g352/g356 discards applied), then the
    // promoted ones move in unit order, with g378's return among the moves.
    sourcedRoutePass: false,
    // Balloon Boy's hops where the sheet makes them (requires sourcedRoutePass). g342 rolls him with the others and
    // g359 promotes him at once, but his moves are g413-g418, after the other units' moves (g374-g412) and after the
    // Paper Pals roll (g343); g414-g416 draw his cue (cam 01 value 6 = Random(4) + 1, and g416 also value 21), and g611,
    // far later (after g556-g559), redraws a cue of 4 as Random(3) + 1. The model hopped him inside the roll pass and
    // redrew at once, so his cue took the LCG value before the Paper Pals roll, and a 4 changed the loop's count at
    // the wrong place (Night 7 k3 tick 6600 in the rebuilt runtime). On: the roll marks the hop, the route pass makes
    // it after the other moves, and the redraw waits for g611's place.
    sourcedBBMoves: false,
    // The Toy view draws and the moves in sheet order (requires sourcedRoutePass and sourcedPromotedViewDraws). g366
    // and g368 (Toy Bonnie's and Toy Chica's Random(100) while value 0 == 2 under your view with a camera up) sit
    // between the promotions and the moves, among the value 1 drains g361-g371; g419 (Toy Freddy's) sits after
    // Balloon Boy's moves g413-g418 and before Toy Freddy's own g420-g423. So a Toy promoted and moved off the viewed
    // camera on one loop still draws there (Night 5 contact-final tick 22241 in the rebuilt runtime: Toy Bonnie
    // leaves CAM 09 with your view on it). The model drew them in the per-second pass, after every move. On: they
    // run inside the route pass, whose moves then follow the sheet: the Withereds (g374-g388), Mangle (g391-g399),
    // Balloon Boy (g413-g418), g419, then Toy Freddy, Toy Bonnie and Toy Chica (g420-g435).
    sourcedRouteViewDraws: false,
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
    // Sheet order requires sourcedSecondPass: g213/g292/g294 precede the five-second
    // rolls and route moves. g366-g518 precede blackout resolution and the music box;
    // g556-g781 follow, including the hour table before g730 and g774 after g750.
    sourcedSheetOrder: false,
    // The frame-time hook requires sourcedSheetOrder. frameMs supplies rhTimerDelta;
    // frameValue5 supplies global 5 unless sourcedValue5 derives its prior-loop value.
    // CND_EVERY2 timers spend round(ms * 3) units; frame-only mode retains the 60 Hz grid.
    // sourcedAnimationCount weights panel counters, sourcedMovementClock weights stuns,
    // and sourcedAttackAnimation separates the shared attack counter from sprite exits.
    // The entry streak window remains frame-counted. A non-lethal kill can skip a loop's
    // countdown reaches, so hooked cadences may slip under lethal:false.
    // g263 places its 200 ms countdown after `viewing > 0`, so the countdown only runs on
    // frames a camera is displayed and its phase follows the accumulated camera-up time,
    // not frame 0. Off keeps the model's global f % 12 sample (dump g263).
    sourcedLastViewPause: false,
    sourcedAttackAnimation: false, // g587/g588 plus rebuilt sprite exits; existing committed-attack paths only
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
    // cadences (identical to them at 50/3 ms, frame-time-hook.test.ts).
    sourcedEveryOrigin: false,
    // Global value 5 as the sheet writes it (requires frameMs). g1236, the office's last group (Always),
    // sets value 5 = Min(4, (TimerValue - global 0) / D) and then global 0 = TimerValue, so every loop reads
    // the PREVIOUS loop's timer delta over D. The Android runtime decodes D's Double token as 32.32 fixed:
    // 71582788266 / 2^32 = 16.666666666511446 ms (the rebuilt runtime's generated source; the CTFAK dump
    // prints the IEEE reading 16.66666603088379). Both lie below 50/3, so at an exact 60 Hz step value 5 is
    // a hair above 1, not 1, and an accumulator compared strictly against an integer crosses it a loop
    // sooner: g514 adds value 5 to the blackout clock, g517 draws while it is > 20, and so the flicker's
    // first draw lands on the 20th loop of `in danger`, not the 21st (Night 7 k3 tick 2044, Night 5
    // contact-final tick 7460 in the rebuilt runtime). Replaces frameValue5, which it refuses beside it.
    // Off: value 5 is frameValue5(frame), or 1.
    sourcedValue5: false,
    // The exposure accumulators add global value 5 (requires sourcedValue5). g745 adds `1 * Global(5)` to Withered
    // Foxy's value 9 each loop the hall latch is lit on him, and g846 retreats him once it is > 100 * night; g779 adds
    // it to hallway Golden Freddy's value 0, and g780 moves him in once it is > 100. With value 5 a hair above 1, the
    // Nth loop already passes > N: on Night 7 (night 7, 700) Foxy's retreat, and its B = 500 + Random(500) draw,
    // came on the 700th lit loop in the rebuilt runtime (k3 tick 20449), where the model's integer count needed the
    // 701st. Off: both count 1 per loop.
    sourcedExposureValue5: false,
    frameMs: (null as null | ((frame: number) => number)),
    frameValue5: (null as null | ((frame: number) => number)),
  };
}
