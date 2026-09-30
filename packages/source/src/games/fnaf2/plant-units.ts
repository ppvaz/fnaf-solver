// The route units: the five-second rolls (g333-g343), their promotions and moves (g344-g435), Balloon Boy's
// hops, the mask ticks, the cams-up streak, and the occupants of markers 122 and 123. Each function is a Sim
// method; plant-model.js installs it on Sim.prototype.
import * as C from './config.ts';
import { ROUTE_MOVE_ORDER, MON_UP } from './plant-constants.ts';
import type { Sim } from './plant-model.ts';

/** g785/g786: the cams-up streak counts gated one-second fires while viewing > 0 (sourcedGatedEvery). */
export function tickStreak(this: Sim) {
  if (this.viewing > 0) { if (this.gatedPass('g786', 1000)) this.streakTicks++; }
  else this.streakTicks = 0;
}

/**
 * g344-g358's promotion test for a route unit whose roll has passed (sourcedFootstepValue2): the packed
 * FlagOn (value 0 == 1, value 1 == 0), the your-view marker off its room, Mangle's g358 hall light, and
 * before Night 7 the CAM 08/09 conditions sourcedRouteStep holds or discards on.
 */
export function footstepPromotable(this: Sim, u: any, f: number) {
  if (this.opts.sourcedBDrainOrder ? f <= u.stunUntil : f < u.stunUntil) return false;   // g344-g360 read B before g361-g371
  if (this.opts.selectedCameraGate && C.SELECTED_CAMERA_GATED.has(u.id) && u.path[u.idx] === this.cam &&
      (C.WITHEREDS.has(u.id) || this.camsUp)) return false;
  if (u.id === 'mangle' && !this.camsUp && this.lightStallOn) return false;
  if (this.opts.sourcedRouteForks && this.opts.night !== 7) {
    const onCam = (id, cam) =>
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
 */
export function footstepPromote(this: Sim, u: any, roll: boolean) {
  const value2 = this.opts.sourcedFootstepValue2, viewed = this.opts.sourcedPromotedViewDraws;
  if (!value2 && !viewed && !this.opts.sourcedPromotedMoves) return;
  if (roll) u.promoted = false;
  if (u.promoted || !this.footstepPromotable(u, this.frame)) return;
  if (value2) u.value2 = 10;
  u.promoted = true;
  if (viewed) this.fadeUntil[u.id] = this.frame + 8;                        // g344-g360: C = 10 at promotion
}

export function tickMask(this: Sim) {
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

export function bbLeave(this: Sim) {
  this.bb.inOpening = false; this.bb.stage = 0; this.bb.pending = false;
  this.bb.maskTicks = 0;
  if (this.opts.sourcedOfficeRolls && this.bb.armed) { this.bb.armed = false; this.bbHop(); }   // g413, later in the loop
  this.emit('vent-bang', { who: 'bb', leaving: true, sample: C.THUD_SAMPLE });
}

export function unitLeave(this: Sim, u, opts: { idx?: number, cooldown?: number } = {}) {
  u.atOpening = false; u.inside = false; u.promoted = false; u.officeRoll = false;               // g538-g555: value 0 = 0
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

export function onCamsUp(this: Sim) {
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
export function bbHop(this: Sim) {
  this.bb.stage++;
  if (this.opts.sourcedFootstepDraws && this.footstepNodes().has([10, 7, 3, 1, 5][this.bb.stage])) this.bb.footstep = true;
  let vocal = null;   // which of his three vocals the cue selects (g608 -> 21 "hi", g609 -> 24 laugh, g610 -> 23 "hello")
  if (this.opts.sourcedEventDraws && this.bb.stage >= 2) {            // e351/e352/e353
    let cue = this.rng.int(0, 3, 0) + 1;                                // cam01 value 6
    if (this.bb.stage === C.BB_STAGES - 1) this.rng.int(0, 3, 0);       // e353 also writes value 21
    if (cue === 4 && this.opts.sourcedBBMoves) { this.bb.cueRedraw = true; cue = 0; }   // g611 redraws it later in the loop
    else if (cue === 4) cue = this.rng.int(0, 2, 0) + 1;                     // e548 redraws a 4
    vocal = [null, 21, 24, 23][cue];
  }
  if (this.bb.stage > C.BB_SILENT_HOPS)
    this.emit('laugh', vocal === null ? { samples: C.BB_VOCAL_SAMPLES } : { samples: C.BB_VOCAL_SAMPLES, vocal });   // shape unchanged when no cue is drawn: the device bundles hash the event stream
  if (this.bb.stage === C.BB_STAGES - 1) {
    this.emit('vent-bang', {
      who: 'bb', leaving: false, cam: true, sample: C.THUD_SAMPLE });
  }
}

export function bbEnterOpening(this: Sim) {
  if (this.opts.sourcedEventDraws) this.rng.int(0, 3, 0);              // e354
  if (this.opts.sourcedOfficeRolls && this.frame - (this.bb.promotedAt ?? -100) <= 8) this.bb.footstep = true;   // g702 on arrival
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
export function rollAllFiveSecond(this: Sim) {
  // sourcedRollsBeforeMoves: g333-g343 roll everyone first; the promotions (g344-g358) and the moves (g380 on)
  // come after the last roll, so a move's own draws (e324) cannot shift a later character's roll.
  const deferred: any[] | null = this.opts.sourcedRollsBeforeMoves ? [] : null;
  const rollUnit = (id: string) => {                                                   // g333-g335, g338-g341
    const hit = this.rng.chance(C.MO_CHANCE(this.ai[id]), true);
    const u = this.units.find(x => x.id === id);
    if (hit && this.opts.sourcedOfficeFootsteps && this.opts.stalledEnabled && u && !u.done && u.atOpening && !u.inside) {
      if (deferred) deferred.push(id); else this.officeRoll(u);              // value 0 = 1 at 122: promoted, no move
      return;
    }
    if (!hit || !this.opts.stalledEnabled || !u || u.done || u.atOpening) return;
    if (deferred) deferred.push(id); else settleRoll(u, id);
  };
  const settleRoll = (u: any, id: string) => {
    this.footstepPromote(u, true);                                           // g344-g358: value 2 = 10
    const step = this.sourcedRouteStep(u, this.frame);
    if (step === 'discard' || step === 'returned') { u.promoted = false; return; }
    if (this.opts.sourcedViewDraws && !this.opts.sourcedPromotedViewDraws) this.fadeUntil[u.id] = this.frame + 8;
    if (this.cam8CancelAt[id] === this.frame) return;                        // g380/g385 zeroed value 0 (sourcedCam8Cancel)
    if (step !== 'hold' && this.canAdvance(u, this.frame)) this.advanceUnit(u);
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
    if (hit && this.opts.bbEnabled && this.opts.sourcedOfficeRolls) {                // g359: value 0 = 2, value 2 = 10
      this.bb.promotedAt = this.frame;
      if (this.bb.inOpening) { this.bb.footstep = true; this.bb.armed = true; }    // g702 at 122; value 0 stays 2
    }
    if (hit && this.opts.bbEnabled && !this.bb.inOpening && this.opts.sourcedBBMoves) {
      if (this.opts.sourcedViewDraws) this.fadeUntil.bb = this.frame + 8;
      this.bb.hopDue = true;                                                   // g359: value 0 = 2; g413-g418 in routePass
    } else if (hit && this.opts.bbEnabled && !this.bb.inOpening) {
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
    if (u && !u.done && u.atOpening && !u.inside && this.opts.sourcedOfficeFootsteps) this.officeRoll(u);
    else if (u && !u.done && !u.atOpening && this.opts.sourcedRoutePass) {             // value 0 = 1: routePass promotes and moves
      u.pending = true; u.promoted = false;
      if (this.opts.sourcedViewDraws && !this.opts.sourcedPromotedViewDraws) this.fadeUntil[u.id] = this.frame + 8;
    }
    else if (u && !u.done && !u.atOpening) settleRoll(u, id);
  }
}

/** g344-g360 test every waiting roll's promotion, then g374-g435 move the promoted units (sourcedRoutePass). */
export function routePass(this: Sim, f: number) {
  const stalled = this.opts.stalledEnabled;
  if (stalled && this.opts.sourcedOfficeRolls) for (const u of this.units) this.officePromote(u);   // g344-g360 at 122
  const waiting = (u) => stalled && u.pending && !u.done && !u.atOpening && !u.inside && u.committedAt < 0;
  for (const u of this.units) {
    if (!waiting(u)) continue;
    this.footstepPromote(u, false);
    if (this.sourcedRouteStep(u, f, 'promote') === 'discard') { u.pending = false; u.promoted = false; }
  }
  const views = this.opts.sourcedRouteViewDraws && this.opts.sourcedViewDraws;
  if (views) { this.drawViewed(f, 'g366'); this.drawViewed(f, 'g368'); }             // among g361-g371, before the moves
  const order = views ? ROUTE_MOVE_ORDER : [...this.units.map(u => u.id), 'bb'];
  for (const id of order) {
    if (id === 'g419') { if (views) this.drawViewed(f, 'g419'); continue; }
    if (id === 'bb') {
      if (this.opts.sourcedBBMoves && this.bb.hopDue) {                               // g413-g418
        this.bb.hopDue = false;
        if (this.bb.stage === C.BB_STAGES - 1) {
          if (this.monitor === MON_UP) this.bbEnterOpening();
          else this.bb.pending = true;
        } else this.bbHop();
      }
      continue;
    }
    const u = (this.units.find(x => x.id === id) as any);
    if (!u || !waiting(u)) continue;
    const step = this.sourcedRouteStep(u, f, 'move');
    if (step === 'returned') { u.pending = false; u.promoted = false; }
    else if (step !== 'hold' && this.canAdvance(u, f)) { u.pending = false; this.advanceUnit(u); }
  }
}

/** A passed roll at 122: value 0 = 1, promoted now or, under sourcedOfficeRolls, on a later loop. */
export function officeRoll(this: Sim, u: any) {
  if (!this.opts.sourcedOfficeRolls) { this.footstepPromote(u, true); return; }
  u.promoted = false;
  u.officeRoll = true;
  this.officePromote(u);
}

/** g344-g360 at 122: promote a waiting roll where the unit stands (sourcedOfficeRolls). */
export function officePromote(this: Sim, u: any) {
  if (!u.officeRoll || !u.atOpening || u.inside || u.done) return;
  this.footstepPromote(u, false);
  if (u.promoted) u.officeRoll = false;
}

export function rollDecidePath(this: Sim) {
  this.decidePath = this.rng.int(0, 1) + 1;
  return this.decidePath;
}

/**
 * The dump's look-hold and route rules the base gates do not express, for a
 * unit whose movement roll has passed (A = 1 or 2). Returns 'hold' (keep it
 * pending), 'discard' (A = 0, roll spent), 'returned' (g378 moved it), or
 * null (fall through to canAdvance). Null whenever sourcedRouteForks is off.
 */
export function sourcedRouteStep(this: Sim, u: any, f: number, phase = null) {
  if (!this.opts.sourcedRouteForks) return null;
  const onCam = (id, cam) => this.units.some(o => o.id === id && !o.done && !o.atOpening && o.path[o.idx] === cam);
  if (this.opts.night !== 7 && phase !== 'move') {                                                   // promotion rules
    if (u.id === 'withfreddy' && (onCam('withchica', 8) || onCam('withbonnie', 8))) return 'hold';   // g344
    if (u.id === 'withchica' && onCam('withbonnie', 8)) return 'hold';                               // g347
    const flagOn = this.opts.sourcedBDrainOrder ? f > u.stunUntil : f >= u.stunUntil;               // value 1 == 0
    if (u.id === 'toyfreddy' && flagOn && onCam('toychica', 9)) return 'discard';                    // g352
    if (u.id === 'toychica' && flagOn && onCam('toybonnie', 9)) return 'discard';                    // g356
  }
  if (phase === 'promote') return null;                                                               // move rules below
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

export function canAdvance(this: Sim, u, f) {
  // sourcedPromotedMoves: the move groups test value 0 == 2; the stun and the marker were the promotion's.
  if (this.opts.sourcedPromotedMoves) { if (!u.promoted) return false; }
  else if (this.opts.sourcedBDrainOrder ? f <= u.stunUntil : f < u.stunUntil) return false;
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

export function tickUnits(this: Sim, f) {
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
    if (u.pending && !this.opts.sourcedRoutePass) {
      this.footstepPromote(u, false);                                        // a held roll promoted late
      const step = this.sourcedRouteStep(u, f);
      if (step === 'discard' || step === 'returned') { u.pending = false; u.promoted = false; }
      else if (step !== 'hold' && this.canAdvance(u, f)) { u.pending = false; this.advanceUnit(u); }
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

export function advance(this: Sim, u) {
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

export function onFiveSecond(this: Sim) {
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
          if (step !== 'hold' && this.canAdvance(u, this.frame)) this.advanceUnit(u);
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
