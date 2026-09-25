// ---------------------------------------------------------------------------
// FNaF 3, simulated at 60 Hz against the event sheet's own group order.
//
// One antagonist, one movement formula, and a systems economy that is the
// actual cause of death. Springtrap's rule alone cannot kill: the attack chain
// advances on the ventilation blackout (g486, g487, g256, g262), so a model
// built from the movement graph and nothing else would report a night that
// never ends.
//
// What is modelled: the clock and its two hour counters, the single `AI`
// difficulty counter, Springtrap's spawn/move/branch rule and his full
// location graph including the five vents, the attack chain and both kill
// paths, the ventilation drain -> error -> dwell -> blackout ladder, the vent
// seal with its charge and its cancels, ventilation reboots, and aggression
// with its 15 s decay.
//
// What is not: the phantoms' own animations (they matter only through the
// aggression flag and the error they cause, both of which are modelled as
// inputs), the audio lure, and the camera/audio error systems, which share the
// ventilation threshold but do not feed the blackout that advances the chain.
// ---------------------------------------------------------------------------

import { Rng } from '../rng.js';
import { MODEL, CLOCK, SPRINGTRAP, VENTILATION, SYSTEMS, VENTS, PHANTOMS } from './fnaf3.js';
import { applyRows } from './night-model.js';

export const FPS = 60;
export const MS_PER_FRAME = 1000 / FPS;

// Springtrap's location graph [SOURCED: his 73 movement edges,
// packages/core/src/mechanics/games/graphs/fnaf3.json]. Keyed by where he is,
// then by `action selected`. A branch with no edge is a stay.
//
// Corrected 2026-09-25. An earlier table read three `action selected > 2`
// edges (g239, g249, g251) as second action-2 edges, and cam 10's
// `> 1 AND < 4` edge (g227) as action 1 -- which action 1 never reaches,
// being the stay (g225). So cam 10 had no exit but vent 14: under aggression
// one seal on 14 held him in a 10 <-> 14 bounce all night.
const GRAPH = {
  cam10: { 2: 'cam09', 3: 'cam09', 4: 'vent14' },                     // g227, g228
  cam09: { 2: 'cam10', 3: 'cam08', 4: 'vent11' },                     // g229-g231
  cam08: { 2: 'cam09', 3: 'cam07', 4: 'cam05' },                      // g232-g234
  cam07: { 2: 'cam08', 3: 'cam06', 4: 'vent12' },                     // g235-g237
  cam06: { 2: 'cam07', 3: 'cam05', 4: 'cam05' },                      // g238, g239
  cam05: { 2: 'cam06', 3: 'cam02', 4: 'picRandom:cam04:vent13' },     // g240-g243
  cam02: { 2: 'cam05', 3: 'cam04', 4: 'picRandom:attack1:vent15' },   // g244-g247
  cam04: { 2: 'cam02', 3: 'cam03', 4: 'cam03' },                      // g248, g249
  cam03: { 2: 'cam04', 3: 'attack1', 4: 'attack1' },                  // g250, g251
};

// The vents [SOURCED: g604-g613]. Each is entered on action 4 from one camera
// and resolved on `action selected > 1`: a sealed vent sends him back to the
// camera he came from, an unsealed one advances him.
const VENT_EXIT = {
  vent11: { sealedTo: 'cam09', openTo: 'attack3' },
  vent12: { sealedTo: 'cam07', openTo: 'attack3' },
  vent13: { sealedTo: 'cam05', openTo: 'attack1' },
  vent14: { sealedTo: 'cam10', openTo: 'GOT_YOU_2' },
  vent15: { sealedTo: 'cam02', openTo: 'GOT_YOU_2' },
};
const VENT_NUMBER = { vent11: 11, vent12: 12, vent13: 13, vent14: 14, vent15: 15 };

class Every {
  constructor(periodMs) { this.period = periodMs; this.acc = 0; this.loaded = false; }
  tick(ms) {
    // `passEvery` (plant-model.js:944, from the CND_EVERY2.eva2 decompile):
    // the countdown **loads on the first reach and returns false that
    // evaluation**, then counts down. So the first fire is one period after
    // the load, not two. Consuming a period on the load instead pushes every
    // first fire to 2N -- which cost FNaF 3 a whole extra in-game hour and
    // made its nights 420 s against the 360 s the clock groups state and the
    // 240 s the handset measured on Night 1.
    if (!this.loaded) { this.loaded = true; this.acc = 0; return false; }
    this.acc += ms;
    if (this.acc >= this.period) { this.acc -= this.period; return true; }
    return false;
  }
}

// The lure table [SOURCED: g319-g341]: played on camera X, a lure pulls him
// onto X from any of these places. Only cam 02's reaches attack stage 1 and
// only cam 01's reaches stage 4.
export const LURE_FROM = {
  cam01: ['attack4'], cam02: ['attack1', 'cam03', 'cam04', 'cam05'], cam03: ['cam02', 'cam04'],
  cam04: ['cam02', 'cam03'], cam05: ['cam02', 'cam06', 'cam07', 'cam08'], cam06: ['cam05', 'cam07'],
  cam07: ['cam06', 'cam08'], cam08: ['cam07', 'cam05', 'cam09'], cam09: ['cam08', 'cam10'], cam10: ['cam09'],
};

export class Fnaf3Sim {
  /**
   * @param {object} [options]
   * @param {number} [options.night] 1..6
   * @param {number} [options.seed]  16-bit RNG seed
   * @param {boolean} [options.fastNights]
   * @param {boolean} [options.hyper] the Extras "aggressive" cheat: g222
   *   advances `move counter` by 2 a second instead of g221's 1, which halves
   *   the time to every move test. AI itself caps at 7 (g654), so this is the
   *   only knob above Nightmare and the hardest the game goes.
   */
  constructor({ night = 1, seed = 0, fastNights = false, hyper = false, cameraDrain = true } = {}) {
    this.night = night;
    this.rng = new Rng(seed);
    this.fastNights = fastNights;

    const levels = applyRows(MODEL.rows, night, 0, { ...MODEL.initialLevels });
    // g649 writes `AI = night number - 1`, which the table carries as a counter
    // expression rather than a literal.
    this.ai = night < 2 ? night - 1 : levels.ai;
    this.timeLimit = levels.timeLimit;
    this.armed = { bb: levels.bb, mangle: levels.mangle, golden: levels.golden,
                   chica: levels.chica, puppet: levels.puppet };

    this.frame = 0;
    this.hour = 0;
    this.over = null;

    // Springtrap. The spawn is the night's FIRST draw [SOURCED: g215-g219 fire
    // on the StartOfFrame loop, and `passEvery` proves the three earlier
    // cosmetic `Every` groups do not fire on their first reach].
    this.spawnRoll = this.rng.int(0, 4) + 1;
    this.where = ['cam10', 'cam09', 'cam08', 'cam07', 'cam06'][this.spawnRoll - 1];
    this.moveCounter = 0;
    this.totalTurns = 0;
    this.aggressive = 0;
    this.hyper = hyper;                         // g222
    this.picRandom = this.rng.int(0, 1);        // g460, StartOfFrame

    // Ventilation.
    this.vent = 0;                              // `ventilation text` AV0
    this.ventDwell = 0;                         // AV1
    this.hallucination = 0;                     // AV2
    this.blackout = 0;                          // `blackout` AV1
    this.inactivity = 0;                        // AV6, the office-idle counter
    this.sealedVent = 0;                        // `what vent is closed`
    this.sealCharge = 0;
    this.sealTarget = 0;
    this.rebooting = 0;
    this.rebootCursor = 0;
    this.camera = 0;                            // `camera text` AV0
    this.cameraAv5 = 0;
    this.audio = 0;                             // `audio text` AV0
    this.playCounter = 7;                       // g299 refills it to 7
    this.lurePending = null;                    // { to, frames } g342-g352
    this.cameraDrain = cameraDrain;

    // Player state, driven by the policy.
    this.viewing = 0;          // 0/1 office, >=2 a camera
    this.ventMap = false;
    this.cameraId = 0;         // which camera is selected, 1..15

    this.timers = {
      hour: new Every(this.hourMs()),
      move: new Every(SPRINGTRAP.counterMs),
      aggression: new Every(SPRINGTRAP.aggressionResetMs),
      ventByAi: null,
      ventIdle: new Every(VENTILATION.drains.inactivity.everyMs),
      picRandom: new Every(10000),              // g459
      reboot: new Every(1000),                  // g425
      rebootAll: new Every(2000),               // g426
      camera: new Every(1000),                  // g783
      play: new Every(1500),                    // g299
    };
    const byAi = VENTILATION.drains.byAi.everyMsByAi[this.ai];
    if (byAi) this.timers.ventByAi = new Every(byAi);
  }

  hourMs() {
    const base = CLOCK.hourMs(this.night);
    return this.fastNights ? CLOCK.fastHourMs(this.night) : base;
  }

  /** The displayed hour [SOURCED: g646/g647]. Hour 0 reads 12. */
  get timeOfNight() { return this.hour === 0 ? 12 : this.hour; }

  /** `viewing a screen` [SOURCED: g289-g291]. */
  get viewingScreen() { return this.viewing >= 2; }

  /** Video error: the feed shows no room (g381's floor, the shared -10 threshold). */
  get videoError() { return this.camera <= -10; }

  /** Whether the player is watching the room Springtrap is in (`you in = mon in`). */
  watchingHim() {
    const n = Number(String(this.where).replace(/\D/g, ''));
    return this.viewingScreen && this.cameraId === n;
  }

  die(cause) { if (!this.over) this.over = cause; }

  /**
   * Arm a seal on `vent` [SOURCED: g572 sets the charge to `50 + Random(50)`].
   *
   * The draw belongs to the engine, not to the caller: it is one of the
   * night's RNG consumptions and a policy that rolled it itself would put the
   * stream out of step with the phone for every draw after it.
   */
  armSeal(vent) {
    if (this.sealCharge > 0) return false;
    this.sealTarget = vent;
    this.sealCharge = SYSTEMS.seal.chargeMin + this.rng.int(0, SYSTEMS.seal.chargeBound - 1);
    return true;
  }

  /**
   * Play Audio on camera `cam` (1-10) [SOURCED: g301, g317/g318, g319-g352]:
   * it needs the camera map, audio above -10 and a full play counter; costs
   * AI audio points; the lure object rolls Random(7), a 1 failing and a 0
   * rolling again; if he stands where the lure table pairs with `cam`, he is
   * pulled there after Random(100) frames and his move counter resets.
   * Returns whether the audio played.
   */
  lure(cam) {
    if (!this.viewingScreen || this.ventMap || this.audio <= -10 || this.playCounter !== 7) return false;
    this.playCounter = 0;
    this.audio = Math.max(-10, this.audio - this.ai);
    let roll = 0;
    while (roll === 0) roll = this.rng.int(0, 6);
    const key = `cam${String(cam).padStart(2, '0')}`;
    if (roll >= 2 && (LURE_FROM[key] ?? []).includes(this.where)) {
      this.lurePending = { to: key, frames: this.rng.int(0, 99) };
    }
    return true;
  }

  step() {
    if (this.over) return this.over;
    this.frame += 1;
    const ms = MS_PER_FRAME;

    // --- the clock [g642-g648]
    if (this.timers.hour.tick(ms)) {
      this.hour += 1;
      if (this.timeOfNight === CLOCK.winHour) { this.over = '6AM'; return this.over; }
    }

    // --- aggression decays on its own timer [g220]
    if (this.timers.aggression.tick(ms)) this.aggressive = 0;
    // g904 tests `time of night >= 4` -- and hour 0 *displays* as 12, which is
    // >= 4. So aggression is set through the whole first hour, cleared by
    // g220's 15 s decay from 1 AM, and set again from 4 AM. Excluding hour 0
    // as "not yet 4 AM" reads the clock face instead of the counter and makes
    // the opening hour safer than the game does.
    if (this.timeOfNight >= 4) this.aggressive = 1;

    // --- office inactivity [g908/g909]: standing in the office costs
    // ventilation on every night but the first, and raises aggression.
    // AV6 counts seconds off the monitor (g906 every 1000 ms, zeroed on it
    // by g907), so the drain starts after 10 s in the office, not 10 frames.
    if (!this.viewingScreen) this.inactivity += 1; else this.inactivity = 0;
    if (this.inactivity > 10 * FPS) this.aggressive = 1;             // g909
    if (this.inactivity > 10 * FPS && this.night !== 1 && this.timers.ventIdle.tick(ms)) {
      this.vent -= VENTILATION.drains.inactivity.amount;
    }
    // --- the AI-indexed drain [g448-g452], absent above AI 6
    if (this.timers.ventByAi && this.timers.ventByAi.tick(ms)) this.vent -= 1;
    if (this.vent < VENTILATION.floor) this.vent = VENTILATION.floor;  // g382

    // --- the error ladder [g461-g464, g473]
    if (this.vent > VENTILATION.errorAt) this.ventDwell = 0;           // g461
    else this.ventDwell += 1;                                          // g462
    if (this.ventDwell > VENTILATION.hallucinationAt(this.ai) && this.hallucination <= 0) {
      this.hallucination = this.ai * 200 + this.rng.int(0, 199);       // g463
    }
    if (this.hallucination > 0) this.hallucination -= 1;               // g464
    if (this.ventDwell > VENTILATION.blackoutRampAt(this.ai)) this.blackout += 1;  // g473
    else if (this.blackout > 0) this.blackout -= 1;                    // g477

    // --- the camera [g783/g784, g381]: each 1000 ms with a screen up adds
    // one to `camera text` AV5, and at 12 the camera loses AI points; at -10
    // it errors and the feed shows no room. It drains with this.cameraDrain
    // (default on), so the earlier censuses can be reproduced without it.
    if (this.cameraDrain && this.timers.camera.tick(ms) && this.viewingScreen) {
      this.cameraAv5 += 1;
      if (this.cameraAv5 >= 12) { this.camera = Math.max(-10, this.camera - this.ai); this.cameraAv5 = 0; }
    }

    // --- the lure's clock and its delayed pull [g299, g342-g352]
    if (this.playCounter < 7 && this.timers.play.tick(ms)) this.playCounter += 1;
    if (this.lurePending && --this.lurePending.frames <= 0) {
      this.where = this.lurePending.to;
      this.moveCounter = 0;
      this.lurePending = null;
    }

    // --- reboots [g425/g426, g428-g430]: a single system in 1000 ms ticks,
    // reboot all (4) in 2000 ms ticks; the menu stays until it ends.
    if (this.rebooting > 0 && (this.rebooting === 4 ? this.timers.rebootAll : this.timers.reboot).tick(ms)) {
      this.rebootCursor += 1 + this.rng.int(0, 1);
      if (this.rebootCursor >= 10) {
        if (this.rebooting === 3 || this.rebooting === 4) { this.vent = 0; this.ventDwell = 0; }
        if (this.rebooting === 2 || this.rebooting === 4) this.camera = 0;
        if (this.rebooting === 1 || this.rebooting === 4) this.audio = 0;
        if (this.rebooting === 4) this.cameraAv5 = 0;
        this.rebooting = 0; this.rebootCursor = 0;
      }
    }

    // --- the seal [g572, g582-g585]
    if (this.sealCharge > 0) {
      if (!this.ventMap || !this.viewingScreen) { this.sealCharge = 0; this.sealTarget = 0; }
      else if (--this.sealCharge === 0) { this.sealedVent = this.sealTarget; this.sealTarget = 0; }
    }

    // --- `pic random` is redrawn only while he is unwatched [g459]
    if (!this.watchingHim() && this.timers.picRandom.tick(ms)) this.picRandom = this.rng.int(0, 1);

    // --- Springtrap [g221-g226]
    if (this.timers.move.tick(ms)) {
      this.moveCounter += this.hyper ? SPRINGTRAP.hyperStep : SPRINGTRAP.counterStep;
      // `Random(15)` sits inside the comparison, so it is drawn every second
      // whether or not he moves. This is the night's one unconditional draw.
      const threshold = (10 - this.ai - this.aggressive) + this.rng.int(0, 14) - this.totalTurns;
      if (this.moveCounter > threshold) {
        this.moveCounter = 0;
        const action = this.rng.int(0, 2) + this.aggressive + 1;       // g224
        this.act(action);
      }
    }
    return this.over;
  }

  act(action) {
    if (action === SPRINGTRAP.stayAction) { this.totalTurns += 1; return; }   // g225

    // A vent resolves on `action selected > 1` [g604-g613].
    if (this.where.startsWith('vent')) {
      const exit = VENT_EXIT[this.where];
      this.where = this.sealedVent === VENT_NUMBER[this.where] ? exit.sealedTo : exit.openTo;
      this.totalTurns = 0;
      if (this.where === 'GOT_YOU_2') this.die('springtrap-vent');
      return;
    }

    // The attack chain. Stage 1 advances only on the blackout (g486); stage 2
    // also on `action selected > 2` (g253); stages 3 and 4 and cam 01 have
    // action paths while a screen is viewed [g254, g255, g257, g258, g260, g294].
    if (this.where === 'attack1') { this.totalTurns = 0; return; }
    if (this.where === 'attack2') {
      if (action > 2) this.where = 'attack3';                                 // g253
      this.totalTurns = 0;
      return;
    }
    if (this.where === 'attack3') {
      if (action === 2 && this.viewingScreen) this.where = 'cam01';           // g254
      else if (action > 2 && this.viewingScreen) this.where = 'attack4';      // g255
      this.totalTurns = 0;
      return;
    }
    if (this.where === 'attack4') {
      // g260 kills while the little cam is up; g294 kills while it is not.
      if (action > 1) this.die('springtrap-office');
      this.totalTurns = 0;
      return;
    }
    if (this.where === 'cam01') {
      if (action === 2 && this.viewingScreen) this.where = 'attack3';         // g257
      else if (action > 2 && this.viewingScreen) this.where = 'attack4';      // g258
      this.totalTurns = 0;
      return;
    }

    const edge = GRAPH[this.where]?.[action];
    if (!edge) { this.totalTurns = 0; return; }
    if (edge.startsWith('picRandom:')) {
      const [, zero, one] = edge.split(':');
      this.where = this.picRandom === 0 ? zero : one;
    } else {
      this.where = edge;
    }
    this.totalTurns = 0;
  }

  /** The blackout advances the chain whenever it is over 250 [g486/g487/g256/g262]. */
  advanceChainOnBlackout() {
    if (this.blackout <= VENTILATION.chainAdvancesAbove) return;
    if (this.where === 'attack1') this.where = 'attack2';
    else if (this.where === 'attack2') this.where = 'attack3';
    else if (this.where === 'attack3') this.where = 'attack4';
    else if (this.where === 'attack4') this.die('springtrap-blackout');
  }

  run(policy) {
    const limit = 60 * 60 * 20;
    while (!this.over && this.frame < limit) {
      policy(this);
      this.step();
      this.advanceChainOnBlackout();
    }
    return { outcome: this.over ?? 'timeout', frames: this.frame, hour: this.hour,
             where: this.where, vent: this.vent, blackout: this.blackout,
             spawn: this.spawnRoll, sealed: this.sealedVent };
  }
}

export { GRAPH, VENT_EXIT, VENT_NUMBER, PHANTOMS, VENTS };
