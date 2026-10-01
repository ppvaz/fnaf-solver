// The lights and the hall: the `lit?` counter and the hall-light latch (g75-g94, g488/g489), the flashlight,
// the camera stuns and the hall pins, `hall movement`, hallway Golden Freddy (g570, g779-g781) and Foxy
// (g337-g390, g573, g745-g874). Each function is a Sim method; plant-model.js installs it on Sim.prototype.
import * as C from './config.ts';
import { MON_UP } from './plant-constants.ts';
import { unitStunLeft, setUnitStun } from './movement-clock.ts';
import type { Sim } from './plant-model.ts';

/** g75/g84 -> g94 -> (g262, g445-447 later) -> g488 -> g489, from frame-start state. */
export function updateHallLatch(this: Sim, f: number, lit = this.hallLitNow()) {
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
export function updateLitCounter(this: Sim) {
  if (!this.lightHeld) this.hallLit = false;                                    // 79
  else if ((this.viewing === 0 && this.maskFullyOff && !this.bb.inside) ||      // 74
           (this.viewing > 0 && this.viewing !== 10 && !this.bb.inside) ||      // 75
           this.viewing === 10) this.hallLit = true;                            // 76
  if (this.power <= 0 || this.blackout.active || this.maskFullyOn || this.bb.inside) this.hallLit = false; // 80-83
}

/** g75/g84 set lit? with viewing 0 and the mask off; g94 clears it in danger. */
export function hallLitNow(this: Sim) {
  return this.lightHeld && this.viewing === 0 && this.maskFullyOff &&
    !this.blackout.active && !this.bb.inside && this.power > 0;
}

export function onLightPress(this: Sim) {
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

export function tickLight(this: Sim) {
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
  if (!(this.opts.sourcedBDrainOrder && this.opts.sourcedHallLatchOrder)) this.hallLightPin();
  // Legacy diagnostic model only: a 400-frame timer refreshed by looking
  // at a Withered. The sourced look effect is the marker hold in
  // canAdvance, which releases the moment the marker leaves; this knob
  // stays for A/B comparisons against the old trainer behavior.
  if (this.monitor === MON_UP && this.opts.passiveWitheredLookStunFrames > 0) {
    for (const u of this.units) {
      if (C.WITHEREDS.has(u.id) && u.path[u.idx] === this.cam)
        setUnitStun(this, u, this.opts.passiveWitheredLookStunFrames);
    }
  }
}

/** g848-g854: the hall occupants' value 1 pinned to 40 while the hall-light latch is set. */
export function hallLightPin(this: Sim) {
  if (!this.lightStallOn) return;
  for (const u of this.units) {
    if (!u.done && C.HALL_LIGHT_PIN_IDS.has(u.id) &&
        (u.path[u.idx] === 'blindA' || u.path[u.idx] === 'blindB'))
      setUnitStun(this, u, Math.max(unitStunLeft(this, u), C.HALL_LIGHT_PIN_FRAMES));
  }
}

export function stunCam(this: Sim, n: number, frames = C.STUN_FRAMES, viewing = n) {
  for (const u of this.units) {
    if (u.path[u.idx] !== n || u.done) continue;
    if ((C.WITHEREDS.has(u.id) && viewing === 8) ||
        (C.TOYS.has(u.id) && viewing === 9) ||
        (u.id === 'mangle' && viewing === 11)) continue;
    setUnitStun(this, u, frames);
  }
}

export function tickHallMovement(this: Sim, f: number) {
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
export function tickGoldenHall(this: Sim, f: number) {
  if (!this.opts.gfEnabled) return;
  // g780 only moves the hallway figure to marker 123. g570 waits for a
  // one-second event there before writing attack code 12; g587-g595 end its attack.
  if (this.gf.hallInside) {
    if (this.gf.attackAt >= 0) {
      if (!this.opts.sourcedAttackAnimation && f >= this.gf.attackAt)
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
    if ((this.gf.hallExposure += this.opts.sourcedExposureValue5 ? this.value5(f) : 1) > C.GF_HALL_KILL_FRAMES) {   // g779, g780
      this.gf.inHall = false;
      this.gf.hallInside = true;
      this.emit('gf-hall-inside');
    }
  }
}

/** g349 -> g364 -> g389/g390, after g337 and before g488/g489 in the sheet. */
export function foxyChainTransitions(this: Sim) {
  if (!this.opts.foxyEnabled) return;
  const fx = this.foxy;
  if (fx.A === 1 && fx.B === 0) { fx.A = 2; fx.acceptedAt = this.frame; if (this.opts.sourcedViewDraws) this.fadeUntil.foxy = this.frame + 8; }   // g349: C = 10, value 2 = 10
  // g364: B = Max(0, B - 1 * Global(5)). The dump's expression is Max( 0 , AV1 - 1 * global -65531 ),
  // and global value 5 is the frame-delta term the same sheet drains `hall movement` with
  // (g881), so a long frame drains this pin by more than one. Read 2026-09-17; the model had
  // been subtracting exactly 1 per frame, which is right only at 60 fps.
  if (fx.B > 0) fx.B = Math.max(0, fx.B - this.value5(this.frame));   // g364
  if (fx.A !== 2 || this.hallLatch) return;       // the latch g489 left on the previous frame
  if (fx.loc === 'parts') {                        // g389
    fx.A = 0; fx.loc = 'hall'; fx.D = 0;
    // hall stage 1 with value 2 > 0: g389 sets it to 10 (sourcedFoxyMoveValue2), else what is left of g349's
    if (this.opts.sourcedFootstepDraws && this.opts.footstepFoxy &&
        (this.opts.sourcedFoxyMoveValue2 || this.frame - (fx.acceptedAt ?? -100) < 10)) fx.footstep = true;
    this.emit('foxy-arrive');
  } else if (fx.loc === 'hall' && !fx.gotYou) {    // g390
    fx.A = 0; fx.gotYou = true;
    this.emit('foxy-lock');
    this.flag('foxy-lock', 'g390: Foxy reached marker 123 (A=2, B=0, latch clear)');
  }
}

/** g488/g489, g573, g745, g824, g825, g846, g855, g864, g872-874 in sheet order. */
export function tickFoxyChain(this: Sim, f: number) {
  const fx = this.foxy;
  const second = this.hooked ? this.secTick : f % C.FPS === 0;
  const danger = this.blackout.active;
  this.updateHallLatch(f, this.hallLit && this.viewing === 0 && this.power > 0);  // g488 (425) / g489 (426): viewing read after the drop
  if (fx.gotYou && this.viewing === 0 && this.hallLatch && !danger) {      // g573
    this.kill('foxy', 'g573: the hall light latched while Foxy was at marker 123');
    return;
  }
  const atHall = fx.loc === 'hall' && !fx.gotYou;
  if (atHall && this.hallLatch) { fx.D = 0; fx.exposure += this.opts.sourcedExposureValue5 ? this.value5(f) : 1; }               // g745
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

export function tickFoxy(this: Sim, f: number) {
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
