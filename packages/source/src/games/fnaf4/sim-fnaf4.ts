// ---------------------------------------------------------------------------
// FNaF 4, simulated at 60 Hz against the event sheet's own group order.
//
// Every rule below cites the group it implements, and the phases run in
// ascending group id -- which is the order the runtime evaluates them in, and
// therefore the order the RNG is consumed in. `Every N ms` loads its delay on
// first reach and returns false that evaluation, so the first fire is at
// t = N (see sim-fnaf1.js for the decompile citation).
//
// What killed the first version of this file -- and made the 2026-09-20
// session refuse to report its census -- was that every `gameover = 1` group
// it knew about was player-triggered, so `do-nothing` cleared every night.
// The missing mechanic is now traced and modelled: **the Freddy counter's
// 80 cap arms the black flash from anywhere** (g464 -> g467 -> g468/g469),
// the counter fills while the bed is unwatched (g397) and again every 200 ms
// once the player has stood still for 30 s on Night 2+ (g593), and on
// Fredbear nights 25 s of standing still arms the flash outright (g566/g564).
// A player who faces centre and never acts now dies on every night, which is
// what the real game does.
//
// The full kill list, all traced:
//
//   g345/g346   flashing a hall while that character is at hall-near
//   g375/g376   the bed-turn finishing with Bonnie/Chica AV7 set (bedroom)
//   g427/g428   Freddy counter >= 60 while at the bed
//   g101-g103   arriving anywhere with `foxy got you`
//   g438        the bed-turn finishing with `foxy got you`
//   g558        a clean bed-turn's `fredcheck` with Fredbear AV6 >= 10
//   g468/g469   the black flash reaching 1 -- from anywhere, no player state
//               -- armed by the counter at 80 (g464), by Fredbear's dwell
//               counters (g516-g521, g561-g564, g646-g648), or by 25 s of
//               standing still on a Fredbear night (g564 via g566)
//
// `UNKNOWN(walk-cadence)` and `UNKNOWN(listen-pair)` are marked where the
// rendered sheet cannot settle a choice; see fnaf4.js's FOXY_CLOSET and
// FREDBEAR for what is assumed. The walk-flag groups (g230-g235, g292/g293,
// g491-g496) carry a flag index the renderer does not print, so the zone
// chains are modelled at one leg per passed roll -- the same cadence the
// InstaFoxy challenge (g671) proves the frame can skip outright.
// ---------------------------------------------------------------------------

import { Rng } from '../../clockwork/rng.ts';
import {
  MODEL, CLOCK, ROLLS, FREDDY, FOLLOW, WALK_MS, BLACK_FLASH, BEDROOM,
  FOXY_CLOSET, FREDBEAR, IDLE,
} from './fnaf4.ts';
import { applyRows } from '../../clockwork/night-model.ts';
import { Every } from '../../clockwork/every.ts';

export const FPS = 60;
export const MS_PER_FRAME = 1000 / FPS;

// Bonnie's chain [SOURCED: g291-g295]; Chica mirrors it through the kitchen
// [g296-g301]. One passed roll advances one zone; viewing the hall blocks the
// centre -> far leg (g293/g299), a further pulse at near retreats to far on
// the 10 s timer while not listening (g295/g301).
const LEFT_CHAIN = ['center', 'left', 'farL', 'nearL'];
const RIGHT_CHAIN = ['center', 'right', 'farR', 'nearR'];

// Foxy's zones [SOURCED: g230-g235, g261/g262].
const FOXY_CHAIN = ['away', 'centre', 'living', 'hall', 'closet'];

// The bed-turn animation, which every bed exit and every forced turn plays
// (g589 forces it from anywhere). UNKNOWN(bed-turn-anim): the sheet does not
// state its length; `fromBed` (667 ms) is the closest measured leg.
const TURN_MS = WALK_MS.fromBed;


export class Fnaf4Sim {
  /**
   * 
   * @param options.night 1..6 story, 7 = Nightmare (shadow 1),
 * 8 = 20/20/20/20 (shadow 2)
 * @param options.seed 16-bit RNG seed
 * @param options.plushtrapReward g596: starts the hour at 2
   */
  declare night: number;
  declare shadow: number;
  declare rng: Rng;
  declare fastNights: boolean;
  declare levels: any;
  declare forceBonnie: any;
  declare forceChica: any;
  declare bonnieForced: boolean;
  declare chicaForced: boolean;
  declare frame: number;
  declare hour: number;
  declare appliedHour: number;
  declare over: any;
  declare bonnie: string;
  declare chica: string;
  declare bonniePulse: number;
  declare chicaPulse: number;
  declare bonnieTag: number;
  declare chicaTag: number;
  declare interlock: number;
  declare bonnieAV6: number;
  declare chicaAV6: number;
  declare bonnieAV7: number;
  declare chicaAV7: number;
  declare freddyCounter: number;
  declare blackFlash: any;
  declare counterWas80: boolean;
  declare idleSec: number;
  declare idleFredSec: number;
  declare bedWatchSec: number;
  declare foxy: string;
  declare foxyAv2: number;
  declare foxyGotYou: number;
  declare fredbear: string;
  declare fbSpawned: boolean;
  declare fbAv6: number;
  declare fbAv8: number;
  declare fbAv9: number;
  declare fbAv19: number;
  declare fbDir: number;
  declare fredcheck: number;
  declare follow: number;
  declare walkLeft: number;
  declare pendingStation: number;
  declare leftDoorShut: number;
  declare rightDoorShut: number;
  declare listening: number;
  declare flashing: number;
  declare peek: number;
  declare viewingBed: number;
  declare closetShut: number;
  declare turning: number;
  declare forceTurn: number;
  declare timers: { hour: Every; av0: Every; foxyRoll: Every; bonnieRoll: Every; chicaRoll: Every; fredbearRoll: Every; freddyFill: Every; freddyAccel: Every; freddyDrain: Every; freddyBedCheck: Every; idle: Every; idleFred: Every; bedWatch: Every; bonnieAV6: Every; chicaAV6: Every; fbAv6: Every; fbAv19: Every; foxyDecay: Every; bonnieRetreat: Every; chicaRetreat: Every; doorRepelL: Every; doorRepelR: Every; forceTurn: Every; dismissL: Every; dismissR: Every; fbEject: Every; fbTeleport: Every; };
  declare pendingAfterTurn: any;
  constructor({ night = 1, seed = 0, plushtrapReward = false, fastNights = false }: { night?: number; seed?: number; plushtrapReward?: boolean; fastNights?: boolean; } = {}) {
    this.night = night;
    this.shadow = night >= 7 ? night - 6 : 0;
    this.rng = new Rng(seed);
    this.fastNights = fastNights;

    this.levels = applyRows(MODEL.rows, night, 0, { ...MODEL.initialLevels });
    // Forced-appearance hours are drawn at night start, before any frame
    // business [g626-g628 -- the draws are the first two of the night].
    if (night >= 2 && night <= 4) {
      this.forceBonnie = 2 + this.rng.int(0, 3);
      this.forceChica = 3 + this.rng.int(0, 2);
    } else { this.forceBonnie = 0; this.forceChica = 0; }
    this.bonnieForced = false;
    this.chicaForced = false;

    this.frame = 0;
    this.hour = plushtrapReward && night < 6 ? 2 : 0;
    this.appliedHour = this.hour;      // rows fire as an hour *begins*
    this.over = null;

    this.bonnie = 'center';
    this.chica = 'center';
    this.bonniePulse = 0;              // AV1, the walk pulse g284 sets
    this.chicaPulse = 0;               // AV1, g285
    this.bonnieTag = 0;                // `in closet` AV5 position tag, g631/g632
    this.chicaTag = 0;
    this.interlock = 0;                // the shared summon/dismiss interlock
    this.bonnieAV6 = 0;                // near-hall dwell, g484
    this.chicaAV6 = 0;                 // g479
    this.bonnieAV7 = 0;                // bedroom flag, g486
    this.chicaAV7 = 0;                 // g480

    this.freddyCounter = 0;            // the Freddle meter
    this.blackFlash = null;            // frames left on the fuse, g464/g467
    this.counterWas80 = false;         // rising edge for g464's NotAlways

    this.idleSec = 0;                  // Fredbear AV13, g592
    this.idleFredSec = 0;              // Fredbear AV12, g566
    this.bedWatchSec = 0;              // Fredbear AV14, g594

    this.foxy = 'away';
    this.foxyAv2 = 0;                  // closet aggression, g264/g273
    this.foxyGotYou = 0;               // g282/g283

    this.fredbear = 'off';             // g490 spawns him when his AI rises
    this.fbSpawned = false;
    this.fbAv6 = 0;                    // bed/closet dwell, g556/g557
    this.fbAv8 = 0;                    // viewed-in-left-hall frames, g514
    this.fbAv9 = 0;                    // viewed-in-right-hall frames, g515
    this.fbAv19 = 0;                   // hall dwell seconds, g644/g645
    this.fbDir = 1;                    // AV0, redrawn every second by g229
    this.fredcheck = 0;

    // Player state.
    this.follow = FOLLOW.hub;
    this.walkLeft = 0;
    this.pendingStation = FOLLOW.hub;
    this.leftDoorShut = 0;
    this.rightDoorShut = 0;
    this.listening = 0;                // 0 none, 1 left, 2 right
    this.flashing = 0;                 // 0 none, 1 left hall, 2 right hall
    this.peek = 0;                     // 0 none, 1 left hall, 2 right hall
    this.viewingBed = 0;
    this.closetShut = 0;               // holding the closet closed, g273
    this.turning = 0;                  // frames of forced/voluntary bed-turn
    this.forceTurn = 0;                // g589's flag

    this.timers = {
      hour: new Every(fastNights ? CLOCK.fastHourMs : CLOCK.hourMs),
      av0: new Every(1000),            // g229
      foxyRoll: new Every(ROLLS.foxy.everyMs),
      bonnieRoll: new Every(ROLLS.bonnie.everyMs),
      chicaRoll: new Every(ROLLS.chica.everyMs),
      fredbearRoll: new Every(this.shadow === 0 ? ROLLS.fredbear.everyMs : ROLLS.fredbear.shadowEveryMs),
      freddyFill: new Every(FREDDY.fill.everyMs),
      freddyAccel: new Every(IDLE.av13Accelerant.everyMs),
      freddyDrain: new Every(FREDDY.drain.everyMs),
      freddyBedCheck: new Every(3000), // g428
      idle: new Every(IDLE.av13EveryMs),
      idleFred: new Every(FREDBEAR.av12Idle.everyMs),
      bedWatch: new Every(IDLE.av14EveryMs),
      bonnieAV6: new Every(BEDROOM.av6EveryMs),
      chicaAV6: new Every(BEDROOM.av6EveryMs),
      fbAv6: new Every(FREDBEAR.av6.everyMs),
      fbAv19: new Every(FREDBEAR.av19.everyMs),
      foxyDecay: new Every(1000),      // g273
      bonnieRetreat: new Every(10000), // g295
      chicaRetreat: new Every(10000),  // g301
      doorRepelL: new Every(FREDBEAR.doorRepel.everyMs),
      doorRepelR: new Every(FREDBEAR.doorRepel.everyMs),
      forceTurn: new Every(BEDROOM.forcedTurn.everyMs),
      dismissL: new Every(3000),       // g342
      dismissR: new Every(3000),       // g344
      fbEject: new Every(3000),        // g522/g523
      fbTeleport: new Every(this.shadow === 0 ? FREDBEAR.teleport.everyMs : FREDBEAR.teleport.shadowEveryMs),
    };
  }

  // --- player geometry -------------------------------------------------------

  get atLeftDoor() { return this.follow === FOLLOW.stations.leftDoor; }
  get atRightDoor() { return this.follow === FOLLOW.stations.rightDoor; }
  get atBed() { return this.follow === FOLLOW.stations.bed; }
  get atCloset() { return this.follow === FOLLOW.stations.closet; }
  get walking() { return this.walkLeft > 0 || this.turning > 0; }

  get viewingLeftHall() { return this.atLeftDoor && (this.flashing === 1 || this.peek === 1); }
  get viewingRightHall() { return this.atRightDoor && (this.flashing === 2 || this.peek === 2); }
  get viewingCloset() { return this.atCloset && !this.closetShut; }

  /** Belief channel: breathing is audible at a door while someone is in its
   *  hall [the audio rule the published line runs on; the sheet's rendering
   *  of it is the different peek animations g64-g66/g120-g122]. */
  breathAt(side) {
    if (side === 1) {
      return this.bonnie === 'farL' || this.bonnie === 'nearL' || this.fredbear === 'hallL';
    }
    return this.chica === 'farR' || this.chica === 'nearR' || this.fredbear === 'hallR';
  }

  die(cause) { if (!this.over) this.over = cause; }

  /** Begin a walk to `station`, paying the animation cost from the bank. A
   *  walk is a `carpet run`, which is the only thing that resets the idle
   *  counters (g567). Leaving the bed runs the turn animation first, and the
   *  walk out only starts if the turn resolves cleanly. */
  goTo(station) {
    if (this.walking || this.follow === station) return false;
    if (this.follow === FOLLOW.stations.bed) {
      this.pendingAfterTurn = station;
      this.beginBedTurn();
      return true;
    }
    const names = { [FOLLOW.stations.leftDoor]: 'LeftDoor', [FOLLOW.stations.rightDoor]: 'RightDoor',
                    [FOLLOW.stations.closet]: 'Closet', [FOLLOW.stations.bed]: 'Bed' };
    const here = names[this.follow];
    const there = names[station];
    let ms = 0;
    if (here) ms += WALK_MS[`from${here}`];
    if (there) ms += WALK_MS[`to${there}`];
    this.walkLeft = Math.round(ms / MS_PER_FRAME);
    this.pendingStation = station;
    return true;
  }

  /** Every bed exit runs the turn animation (43 -> 44 -> 45), and the turn's
   *  finish is where the bedroom and Foxy kills live (g375/g376, g438) and
   *  where `fredcheck` arms (g374). */
  beginBedTurn() {
    this.viewingBed = 0;
    this.pendingAfterTurn = null;
    this.turning = Math.round(TURN_MS / MS_PER_FRAME);
  }

  resolveBedTurn() {
    if (this.bonnieAV7) return this.die('bonnie-bedroom');
    if (this.chicaAV7) return this.die('chica-bedroom');
    if (this.foxyGotYou) return this.die('foxy');
    // g374: the clean exit, which arms the Fredbear check (g558/g560).
    this.fredcheck = 1;
    this.follow = FOLLOW.hub;
    if (this.pendingAfterTurn && this.pendingAfterTurn !== FOLLOW.hub) {
      this.goTo(this.pendingAfterTurn);
    }
  }

  step() {
    if (this.over) return this.over;
    this.frame += 1;
    const ms = MS_PER_FRAME;

    // --- g97-g104: arrivals. Walking home with `foxy got you` is lethal on
    // arrival (g101-g103 test the return-walk states 12/19/31), reading the
    // state last frame's g282/g283 left behind -- the order the sheet sees.
    if (this.walkLeft > 0 && --this.walkLeft === 0) {
      this.follow = this.pendingStation;
      if (this.foxyGotYou && this.follow !== FOLLOW.hub) this.die('foxy');
    }

    // --- the clock [g568-g573]
    if (this.timers.hour.tick(ms)) {
      this.hour += 1;
      if (this.hour === CLOCK.winHour) { this.over = '6AM'; return this.over; }
    }

    // Difficulty rows fire as an hour begins, exactly once per hour.
    if (this.hour !== this.appliedHour) {
      this.appliedHour = this.hour;
      this.levels = applyRows(MODEL.rows, this.night, this.hour, this.levels);
    }

    // --- g629/g630: the forced appearances -- once the drawn hour passes,
    // the character lands at hall-near while the player is at the hub.
    if (!this.bonnieForced && this.forceBonnie > 0 && this.forceBonnie <= this.hour
        && this.follow === FOLLOW.hub && !this.foxyGotYou && this.hour !== 12) {
      this.bonnie = 'nearL'; this.bonnieTag = 2; this.bonnieForced = true;
    }
    if (!this.chicaForced && this.forceChica > 0 && this.forceChica <= this.hour
        && this.follow === FOLLOW.hub && !this.foxyGotYou && this.hour !== 12) {
      this.chica = 'nearR'; this.chicaTag = 2; this.chicaForced = true;
    }

    // The Every timers whose group lists them first advance every frame the
    // frame runs, so they are ticked here rather than inside their branches:
    // g295/g301, g342/g344, g428, g502/g503, g522/g523, g590/g591.
    const tickRetreatB = this.timers.bonnieRetreat.tick(ms);
    const tickRetreatC = this.timers.chicaRetreat.tick(ms);
    const tickDismissL = this.timers.dismissL.tick(ms);
    const tickDismissR = this.timers.dismissR.tick(ms);
    const tickBedCheck = this.timers.freddyBedCheck.tick(ms);
    const tickRepelL = this.timers.doorRepelL.tick(ms);
    const tickRepelR = this.timers.doorRepelR.tick(ms);
    const tickEject = this.timers.fbEject.tick(ms);
    const tickForceTurn = this.timers.forceTurn.tick(ms);

    // --- g229: four draws every second, in action order -- foxy's AV0
    // against 10, then Bonnie, Chica and Fredbear's against 2. Only
    // Fredbear's steers anything (his walk resolution, g522/g523); the other
    // three feed animation the model does not price, but the draws are
    // consumed regardless because they are actions, not conditions.
    if (this.timers.av0.tick(ms)) {
      this.rng.int(0, 9);              // foxy AV0
      this.rng.int(0, 1);              // Bonnie AV0
      this.rng.int(0, 1);              // Chica AV0
      this.fbDir = this.rng.int(0, 1) + 1;
    }

    // --- Foxy [g236 roll, g230-g235 + g261/g262 walk, g264 charge]
    let foxyPulse = false;
    if (this.timers.foxyRoll.tick(ms)) {
      // The draw is the roll itself (condition 2 of g236, right after the
      // Every), so it is consumed on every tick whatever his dial.
      const draw = this.rng.int(0, ROLLS.foxy.bound - 1) + 1;
      foxyPulse = draw <= (this.levels.foxy ?? 0);
    }
    if (foxyPulse) {
      const i = FOXY_CHAIN.indexOf(this.foxy);
      if (i >= 0 && i < FOXY_CHAIN.length - 1) {
        // g233/g234 are blocked while that hall is viewed; g261/g262 take
        // him hall -> closet. UNKNOWN(walk-cadence): one leg per pulse.
        const next = FOXY_CHAIN[i + 1];
        if (!(next === 'hall' && (this.viewingLeftHall || this.viewingRightHall))) this.foxy = next;
      }
      // g264: a pulse in the closet and unviewed is +1 AV2.
      if (this.foxy === 'closet' && !this.viewingCloset) this.foxyAv2 += 1;
    }
    // g273: holding the closet shut bleeds AV2 back off.
    if (this.atCloset && this.closetShut && this.timers.foxyDecay.tick(ms)) {
      this.foxyAv2 = Math.max(0, this.foxyAv2 - 1);
    }
    // g276/g279 set the pose (derived); g282/g283: `foxy got you`, set at
    // AV2 >= 10 and cleared below it, every frame.
    this.foxyGotYou = this.foxyAv2 >= FOXY_CLOSET.av2GotYou ? 1 : 0;

    // --- Bonnie and Chica [g284/g285 rolls; chains g291-g301]
    //
    // A passed roll sets their AV1 pulse, and the pulse moves them ONE zone:
    // centre -> living (g291/g296), living -> hall-far when that hall is not
    // viewed and back to centre when it is (g293/g292 and their mirrors), and
    // hall-far -> hall-near (g294/g300). At hall-near the pulse is NOT
    // consumed by an advance -- it lingers until the 10 s timer's next tick
    // retreats them to far (g295/g301), so unaddressed they oscillate
    // far <-> near rather than camping. Listening cancels a standing pulse
    // outright (g288/g290), and so does a summon latch (g289).
    if (this.timers.bonnieRoll.tick(ms)) {
      const draw = this.rng.int(0, ROLLS.bonnie.bound - 1) + 1;
      const gated = this.listening === 1 || this.leftDoorShut || this.interlock === 2;
      if (draw <= (this.levels.bonnie ?? 0) && !gated) this.bonniePulse = 1;
    }
    if (this.timers.chicaRoll.tick(ms)) {
      const draw = this.rng.int(0, ROLLS.chica.bound - 1) + 1;
      const gated = this.listening === 2 || this.rightDoorShut || this.interlock === 2;
      if (draw <= (this.levels.chica ?? 0) && !gated) this.chicaPulse = 1;
    }
    if (this.listening === 1 || this.interlock === 1) this.bonniePulse = 0;      // g288/g289
    if (this.listening === 2 || this.interlock === 1) this.chicaPulse = 0;       // g290/g289
    if (this.bonniePulse) {
      if (this.bonnie === 'center') { this.bonnie = 'left'; this.bonniePulse = 0; }
      else if (this.bonnie === 'left') {
        this.bonnie = this.viewingLeftHall ? 'center' : 'farL';
        this.bonnieTag = this.bonnie === 'farL' ? 1 : 0;
        this.bonniePulse = 0;
      } else if (this.bonnie === 'farL') {
        this.bonnie = 'nearL'; this.bonnieTag = 2; this.bonniePulse = 0;         // g294
      } else if (this.bonnie === 'nearL' && tickRetreatB) {
        this.bonnie = 'farL'; this.bonnieTag = 1; this.bonniePulse = 0;          // g295
      }
    }
    if (this.chicaPulse) {
      if (this.chica === 'center') { this.chica = 'right'; this.chicaPulse = 0; }
      else if (this.chica === 'right') {
        this.chica = this.viewingRightHall ? 'center' : 'farR';
        this.chicaTag = this.chica === 'farR' ? 1 : 0;
        this.chicaPulse = 0;
      } else if (this.chica === 'farR') {
        this.chica = 'nearR'; this.chicaTag = 2; this.chicaPulse = 0;            // g300
      } else if (this.chica === 'nearR' && tickRetreatC) {
        this.chica = 'farR'; this.chicaTag = 1; this.chicaPulse = 0;             // g301
      }
    }

    // --- the forced door [g341-g344, g352] -- unchanged from the traced
    // two-close cycle with the shared interlock.
    if (this.leftDoorShut === 0 && this.rightDoorShut === 0) this.interlock = 0;  // g352
    if (this.leftDoorShut) {
      if (this.bonnieTag === 1 && this.interlock === 0) {
        this.bonnie = 'nearL'; this.bonnieTag = 2; this.interlock = 1;           // g341
      } else if (this.bonnieTag === 2 && this.interlock === 0
                 && this.bonnie === 'nearL' && tickDismissL) {
        this.bonnie = 'left'; this.interlock = 2;                                // g342
      }
    }
    if (this.rightDoorShut) {
      if (this.chicaTag === 1 && this.interlock === 0) {
        this.chica = 'nearR'; this.chicaTag = 2; this.interlock = 1;             // g343
      } else if (this.chicaTag === 2 && this.interlock === 0
                 && this.chica === 'nearR' && tickDismissR) {
        this.chica = 'right'; this.interlock = 2;                                // g344
      }
    }

    // --- the flashlight [g345/g346 kill at near; g68/g84 push far home]
    if (this.flashing === 1 && this.atLeftDoor) {
      if (this.bonnie === 'nearL') this.die('bonnie-flash');
      else if (this.bonnie === 'farL') { this.bonnie = 'center'; this.bonnieTag = 0; }
    }
    if (this.flashing === 2 && this.atRightDoor) {
      if (this.chica === 'nearR') this.die('chica-flash');
      else if (this.chica === 'farR') { this.chica = 'center'; this.chicaTag = 0; }
    }

    // --- the bed-turn (44) resolving [g375/g376, g438, g374]. It reads the
    // `foxy got you` this frame's g282/g283 just wrote, which is the order
    // the sheet sees (283 < 375 < 438).
    if (this.turning > 0 && --this.turning === 0) this.resolveBedTurn();

    // --- Freddy's meter [g397/g398/g399/g401]
    if (this.timers.freddyFill.tick(ms) && !this.viewingBed) {
      this.freddyCounter += this.levels.freddy ?? 0;                             // g397
    }
    if (this.night > 1 && this.idleSec >= IDLE.av13Accelerant.requiresIdle
        && !this.viewingBed && this.timers.freddyAccel.tick(ms)) {
      this.freddyCounter += 1;                                                   // g593
    }
    if (this.viewingBed && this.timers.freddyDrain.tick(ms)) {
      this.freddyCounter = Math.max(0, this.freddyCounter - FREDDY.drain.amount); // g401
    }
    if (this.freddyCounter < 0) this.freddyCounter = 0;                          // g399

    // g427/g428: the 60 kill needs the player at the bed.
    if (this.atBed && this.freddyCounter >= FREDDY.killAt) {
      if (this.viewingBed) this.die('freddy');
      else if (tickBedCheck) this.die('freddy');
    }

    // --- g439: at the bed with `foxy got you` raises the forced turn.
    if (this.atBed && this.foxyGotYou && !this.over) this.forceTurn = 1;

    // --- the black flash [g464-g469]
    const is80 = this.freddyCounter >= BLACK_FLASH.armAt;
    if (is80 && !this.counterWas80) {
      // g464's NotAlways: armed once, on the rising edge, with a draw.
      this.blackFlash = BLACK_FLASH.framesMin + this.rng.int(0, BLACK_FLASH.framesRandom - 1);
    }
    this.counterWas80 = is80;
    // g465: the only defuse, and Fredbear nights cannot take it.
    if (this.freddyCounter < BLACK_FLASH.armAt && (this.levels.fredbear ?? 0) === 0) {
      this.blackFlash = null;
    }
    if (this.blackFlash !== null) {
      this.blackFlash = Math.max(1, this.blackFlash - 1);                        // g467
      if (this.blackFlash === 1) this.die('black-flash');                        // g468/g469
    }

    // --- the bedroom [g447/g478 resets, g484/g479 dwell, g485/g481 the
    // hall-view resets, g486/g480 entry, g590/g591 the forced turn]
    //
    // The resets are the community line's own rule, in the source: looking
    // down a hall with the light clears that side's dwell and flag (g485 for
    // Bonnie, both AV6 and AV7; g481 for Chica, AV6 only -- her AV7 has no
    // view reset), and Bonnie's counters clear again when he leaves the halls
    // entirely (g447, unconditional; Chica's g478 clears only below 20, an
    // asymmetry in the source, not a modelling choice).
    if (this.bonnie !== 'nearL' && this.bonnie !== 'farL') {
      this.bonnieAV6 = 0; this.bonnieAV7 = 0;                                     // g447
    }
    if (this.chicaAV6 < 20 && this.chica !== 'nearR' && this.chica !== 'farR') {
      this.chicaAV6 = 0;                                                          // g478
    }
    if (this.viewingLeftHall) { this.bonnieAV6 = 0; this.bonnieAV7 = 0; }         // g485
    if (this.viewingRightHall) { this.chicaAV6 = 0; }                             // g481
    if (this.bonnie === 'nearL' && this.timers.bonnieAV6.tick(ms)) this.bonnieAV6 += 1;
    if (this.chica === 'nearR' && this.timers.chicaAV6.tick(ms)) this.chicaAV6 += 1;
    if (this.viewingBed) {
      if (this.bonnieAV6 > 20 - this.night) this.bonnieAV7 = 1;                  // g486
      if (this.chicaAV6 >= 20 - this.night) this.chicaAV7 = 1;                   // g480
    }
    if (this.atBed && (this.bonnieAV7 || this.chicaAV7)
        && tickForceTurn) this.forceTurn = 1;                                     // g590/g591

    // --- Fredbear [g490-g523 walk, g554-g567 dwell]
    if ((this.levels.fredbear ?? 0) > 0 && !this.fbSpawned) {
      this.fredbear = 'centre'; this.fbSpawned = true;                           // g490
    }
    if (this.fbSpawned) {
      let fbPulse = false;
      if (this.timers.fredbearRoll.tick(ms)) {
        // g286/g287: the draw sits after the shadow check and fires whenever
        // the timer does; the position NOTs gate only the action.
        const draw = this.rng.int(0, ROLLS.fredbear.bound - 1) + 1;
        fbPulse = draw <= (this.levels.fredbear ?? 0)
          && this.fredbear !== 'closet' && this.fredbear !== 'bed'
          && this.fredbear !== 'hallL' && this.fredbear !== 'hallR';
      }
      if (fbPulse) {
        // g491-g496, one transit per pulse -- the same cadence the walk
        // chains are modelled at everywhere else (UNKNOWN(walk-cadence)).
        // Viewing a hall blocks its entry leg and bounces him across.
        if (this.fredbear === 'centre') {
          this.fredbear = this.fbDir === 1 ? 'livingL' : 'livingR';
        } else if (this.fredbear === 'livingL') {
          this.fredbear = this.viewingLeftHall ? 'livingR' : 'hallL';
        } else if (this.fredbear === 'livingR') {
          this.fredbear = this.viewingRightHall ? 'livingL' : 'hallR';
        }
        // g508-g511: listening while he is walking drops him on the bed or
        // in the closet. UNKNOWN(listen-pair): which is a coin.
        if (this.listening !== 0) {
          this.fredbear = this.rng.int(0, 1) === 1 ? 'closet' : 'bed';
        }
      }
      // g526/g527: seeing him on the bed flashes him back to a living zone.
      if (this.fredbear === 'bed' && this.viewingBed) {
        this.fredbear = this.fbDir === 1 ? 'livingL' : 'livingR';
      }
      // g502/g503: a shut door repels him off that hall every 3 s.
      if (this.fredbear === 'hallL' && this.leftDoorShut && tickRepelL) {
        this.fredbear = 'livingR';
      }
      if (this.fredbear === 'hallR' && this.rightDoorShut && tickRepelR) {
        this.fredbear = 'livingL';
      }
      // g522/g523: standing in the closet walks him back out.
      if (this.fredbear === 'closet' && this.atCloset && this.closetShut
          && tickEject) {
        this.fredbear = this.fbDir === 1 ? 'livingL' : 'livingR';
      }
      // g639-g642: the slow teleport -- a coin every 30 s (20 s under
      // shadow) into the closet, drawn only while he is eligible.
      if (this.fredbear !== 'closet' && this.fredbear !== 'bed'
          && this.fredbear !== 'hallL' && this.fredbear !== 'hallR'
          && this.timers.fbTeleport.tick(ms)) {
        if (this.rng.int(0, 1) === 1) {
          this.fredbear = 'closet';
          this.rng.int(0, 4);        // the laugh draw, g639's AV11
        }
      }
      // The dwell counters.
      if ((this.fredbear === 'bed' || this.fredbear === 'closet') && this.timers.fbAv6.tick(ms)) {
        this.fbAv6 += 1;                                                        // g556/g557
      }
      if (this.fredbear !== 'bed' && this.fredbear !== 'closet') this.fbAv6 = 0; // g554/g555
      if ((this.fredbear === 'hallL' || this.fredbear === 'hallR')) {
        if (this.timers.fbAv19.tick(ms)) this.fbAv19 += 1;                       // g644/g645
      } else this.fbAv19 = 0;                                                   // g643
      if (this.fredbear === 'hallL' && this.viewingLeftHall) this.fbAv8 += 1;    // g514, per frame
      else if (this.fredbear !== 'hallL') this.fbAv8 = 0;                        // g512
      if (this.fredbear === 'hallR' && this.viewingRightHall) this.fbAv9 += 1;   // g515
      else if (this.fredbear !== 'hallR') this.fbAv9 = 0;                        // g513
      // The flash arms. g516-g521 are night-based; g561-g563/g646-g648 shadow.
      const stareAbove = this.night >= 7 ? FREDBEAR.av8av9.flashAbove.night7
        : this.night === 6 ? FREDBEAR.av8av9.flashAbove.night6
        : FREDBEAR.av8av9.flashAbove.night5;
      if (this.fbAv8 > stareAbove || this.fbAv9 > stareAbove) this.armFlash(50); // g516-g521
      const av6At = this.shadow === 0 ? FREDBEAR.av6.flashAt.shadow0 : FREDBEAR.av6.flashAt.shadow2;
      if (this.fbAv6 >= av6At) this.armFlash(50);                                // g561-g563
      const av19At = this.shadow === 0 ? FREDBEAR.av19.flashAt.shadow0
        : this.shadow === 1 ? FREDBEAR.av19.flashAt.shadow1 : FREDBEAR.av19.flashAt.shadow2;
      if (this.fbAv19 >= av19At) this.armFlash(50);                              // g646-g648
      // g558/g560: the fredcheck resolves once, at the turn.
      if (this.fredcheck) {
        if (this.fbAv6 >= FREDBEAR.av6.fredcheckAt) this.die('fredbear-bedcheck');
        else this.fredcheck = 0;
      }
    }

    // --- the idle counters [g592, g566, g594; g567 resets all three the
    // moment a `carpet run` exists, which in this model is any walk or turn]
    if (this.walking) {
      this.idleSec = 0; this.idleFredSec = 0; this.bedWatchSec = 0;              // g567
    }
    if (this.timers.idle.tick(ms)) this.idleSec += 1;                            // g592
    if ((this.levels.fredbear ?? 0) > 0 && this.timers.idleFred.tick(ms)) {
      this.idleFredSec += 1;                                                     // g566
      if (this.idleFredSec >= FREDBEAR.av12Idle.flashAt) this.armFlash(50);      // g564
    }
    if (this.viewingBed && this.timers.bedWatch.tick(ms)) {
      this.bedWatchSec += 1;                                                     // g594
      if (this.bedWatchSec >= IDLE.av14BedWatchAt) {                             // g595
        this.foxy = 'closet';
        this.foxyGotYou = 1;
        this.forceTurn = 1;
      }
    }

    // --- g589: the forced turn, from anywhere.
    if (this.forceTurn) {
      this.forceTurn = 0;
      if (this.turning === 0) {
        this.walkLeft = 0;
        this.beginBedTurn();
      }
    }

    return this.over;
  }

  armFlash(fixed) {
    // g516-g521/g561-g564/g646-g648 arm with a constant, no draw, and do not
    // re-arm while a fuse is already burning.
    if (this.blackFlash === null) this.blackFlash = fixed;
  }

  /** Foxy's closet pose as the player sees it from the closet peek
   *  [g188-g191 pick the peek animation by AV3: pose 0 at AV2 < 2 (g276),
   *  3 the attack pose at AV2 >= 6 (g279); 1-2 in between (g277/g278)]. */
  get foxyStage() {
    if (this.foxy !== 'closet' || this.foxyAv2 < 2) return 0;
    return this.foxyAv2 >= FOXY_CLOSET.av2AttackPose ? 3 : 1;
  }

  run(policy) {
    const limit = 60 * 60 * 20;
    while (!this.over && this.frame < limit) {
      policy(this);
      this.step();
    }
    return { outcome: this.over ?? 'timeout', frames: this.frame, hour: this.hour,
             bonnie: this.bonnie, chica: this.chica, freddy: this.freddyCounter };
  }
}

export { LEFT_CHAIN, RIGHT_CHAIN };
