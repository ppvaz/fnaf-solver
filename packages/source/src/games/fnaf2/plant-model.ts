import * as C from './config.ts';
import { Rng } from './rng.ts';
import { MON_DOWN, MON_RAISING, MON_UP, MON_LOWERING, SOURCED_HOUR0_GOLDEN, VALUE5_DIVISOR } from './plant-constants.ts';
import { defaultSimOptions } from './plant-options.ts';
import * as hall from './plant-hall.ts';
import * as office from './plant-office.ts';
import * as puppet from './plant-puppet.ts';
import * as sheet from './plant-sheet.ts';
import * as units from './plant-units.ts';
import { unitStunLeft } from './movement-clock.ts';
import { releaseFlipLock, readContactInput } from './contact-input.ts';
import type { ContactInput } from './contact-input.ts';
import { attackAnimationEarly } from './attack-animation.ts';
import type { AttackAnimation } from './attack-animation.ts';
import { blackoutResolveReady, blackoutLate } from './blackout-clock.ts';

export class Sim {
  declare press: typeof office.press;
  declare release: typeof office.release;
  declare setMask: typeof office.setMask;
  declare setMonitor: typeof office.setMonitor;
  declare startBlackout: typeof office.startBlackout;
  declare startOfficeEncounter: typeof office.startOfficeEncounter;
  declare unitEnterInside: typeof office.unitEnterInside;
  declare repelCooldown: typeof office.repelCooldown;
  declare commitAttack: typeof office.commitAttack;
  declare armInsideAttack: typeof office.armInsideAttack;
  declare tickForcedown: typeof office.tickForcedown;
  declare readDropTouch: typeof office.readDropTouch;
  declare enableContactInput: typeof office.enableContactInput;
  declare contactDown: typeof office.contactDown;
  declare contactUp: typeof office.contactUp;
  declare updateHallLatch: typeof hall.updateHallLatch;
  declare updateLitCounter: typeof hall.updateLitCounter;
  declare hallLitNow: typeof hall.hallLitNow;
  declare onLightPress: typeof hall.onLightPress;
  declare tickLight: typeof hall.tickLight;
  declare hallLightPin: typeof hall.hallLightPin;
  declare stunCam: typeof hall.stunCam;
  declare tickHallMovement: typeof hall.tickHallMovement;
  declare tickGoldenHall: typeof hall.tickGoldenHall;
  declare foxyChainTransitions: typeof hall.foxyChainTransitions;
  declare tickFoxyChain: typeof hall.tickFoxyChain;
  declare tickFoxy: typeof hall.tickFoxy;
  declare tickStreak: typeof units.tickStreak;
  declare footstepPromotable: typeof units.footstepPromotable;
  declare footstepPromote: typeof units.footstepPromote;
  declare tickMask: typeof units.tickMask;
  declare bbLeave: typeof units.bbLeave;
  declare unitLeave: typeof units.unitLeave;
  declare onCamsUp: typeof units.onCamsUp;
  declare bbHop: typeof units.bbHop;
  declare bbEnterOpening: typeof units.bbEnterOpening;
  declare rollAllFiveSecond: typeof units.rollAllFiveSecond;
  declare routePass: typeof units.routePass;
  declare officeRoll: typeof units.officeRoll;
  declare officePromote: typeof units.officePromote;
  declare rollDecidePath: typeof units.rollDecidePath;
  declare sourcedRouteStep: typeof units.sourcedRouteStep;
  declare canAdvance: typeof units.canAdvance;
  declare tickUnits: typeof units.tickUnits;
  declare onFiveSecond: typeof units.onFiveSecond;
  declare drawViewed: typeof sheet.drawViewed;
  declare monitorDownEarly: typeof sheet.monitorDownEarly;
  declare monitorDownLate: typeof sheet.monitorDownLate;
  declare secondPass: typeof sheet.secondPass;
  declare secondPassFront: typeof sheet.secondPassFront;
  declare passTools: typeof sheet.passTools;
  declare secondPassEarly: typeof sheet.secondPassEarly;
  declare secondPassLate: typeof sheet.secondPassLate;
  declare ventCamDraws: typeof sheet.ventCamDraws;
  declare randomImageDraw: typeof sheet.randomImageDraw;
  declare footstepNodes: typeof sheet.footstepNodes;
  declare footstepDraws: typeof sheet.footstepDraws;
  declare blackoutFlicker: typeof sheet.blackoutFlicker;
  declare drawUnconditional: typeof sheet.drawUnconditional;
  declare drainBoxCountdown: typeof puppet.drainBoxCountdown;
  declare puppetUnderYourView: typeof puppet.puppetUnderYourView;
  declare puppetAtBoxCam: typeof puppet.puppetAtBoxCam;
  declare litCounter: typeof puppet.litCounter;
  declare puppetGlitchEarly: typeof puppet.puppetGlitchEarly;
  declare puppetGlitchLate: typeof puppet.puppetGlitchLate;
  declare tickBox: typeof puppet.tickBox;
  declare tickPuppet: typeof puppet.tickPuppet;
  declare advancePuppet: typeof puppet.advancePuppet;
  declare opts: { seed: number; worst: boolean; night: number; customNight: any; android: boolean; speed: number; record: boolean; bbEnabled: boolean; foxyEnabled: boolean; gfEnabled: boolean; boxEnabled: boolean; powerEnabled: boolean; stalledEnabled: boolean; lethal: boolean; durationFrames: number; cameraLightStunFrames: number; passiveWitheredLookStunFrames: number; selectedCameraGate: boolean; sourcedRouteForks: boolean; sourcedHallEntry: boolean; sourcedDropLightOrder: boolean; sourcedDropFlagOrder: boolean; sourcedAnimationCount: boolean; sourcedFoxyChain: boolean; sourcedUnconditionalDraws: boolean; sourcedEventDraws: boolean; sourcedBlackoutDraws: boolean; sourcedBlackoutClockEnd: boolean; sourcedViewDraws: boolean; sourcedRollDraws: boolean; sourcedMonitorDownDraw: boolean; sourcedSecondPass: boolean; sourcedPuppetGlitchDraws: boolean; sourcedFootstepDraws: boolean; footstepFoxy: boolean; sourcedFoxyMoveValue2: boolean; footstepCamMarkers: boolean; sourcedFootstepValue2: boolean; sourcedOfficeFootsteps: boolean; sourcedOfficeRolls: boolean; sourcedPromotedViewDraws: boolean; sourcedHallLatchOrder: boolean; sourcedBDrainOrder: boolean; sourcedMovementClock: boolean; sourcedAttackAnimation: boolean; sourcedRollsBeforeMoves: boolean; sourcedPromotedMoves: boolean; sourcedRoutePass: boolean; sourcedBBMoves: boolean; sourcedRouteViewDraws: boolean; sourcedMangleReturn: boolean; sourcedBoxCountdown: boolean; sourcedPuppetMoveOrder: boolean; sourcedHourTable: boolean; sourcedParkedMarker: boolean; sourcedCustomDialOrder: boolean; sourcedCam8Cancel: boolean; sourcedVentCamDraws: boolean; sourcedRandomImageDraw: boolean; sourcedMonitorRaiseGate: boolean; sourcedSheetOrder: boolean; sourcedLastViewPause: boolean; sourcedGatedEvery: boolean; sourcedEveryOrigin: boolean; sourcedValue5: boolean; sourcedExposureValue5: boolean; frameMs: (frame: number) => number; frameValue5: (frame: number) => number; };
  declare rng: Rng;
  declare frame: number;
  declare events: any[];
  declare alive: boolean;
  declare won: boolean;
  declare death: { reason: any; detail: any; frame: number; t: number; };
  declare monitor: string;
  declare monAnim: number;
  declare animationClocks: { monAnim: number; maskAnim: number };
  declare contactInput: ContactInput | null;
  declare camsUpCount: number;
  declare camsUpSince: number;
  declare cam: number;
  declare viewing: number;
  declare lastViewed: number;
  declare ventCamDrawn: {};
  declare cam8CancelAt: Record<string, number>;
  declare randomImageArmed: boolean;
  declare hasViewedCamera: boolean;
  declare maskOn: boolean;
  declare maskAnim: number;
  declare maskOffBlocked: boolean;
  declare attackAnimation: AttackAnimation | null;
  declare lightHeld: boolean;
  declare lightLogicalUntil: number;
  declare hallLatchResetDue: boolean;
  declare winding: boolean;
  declare ventLightL: boolean;
  declare ventLightR: boolean;
  declare power: any;
  declare box: number;
  declare boxHold: number;
  declare ai: { [k: string]: number; };
  declare foxy: { loc: string; hallColumn: boolean; footstep: boolean; acceptedAt: number; D: number; exposure: number; gotYou: boolean; pinUntil: number; A: number; B: number; readyAt: any; arrivalPending?: boolean; lockPending?: boolean; };
  declare maskDAccum: number;
  declare gf: { present: boolean; inHall: boolean; hallExposure: number; hallInside: boolean; attackAt: number; };
  declare hallMovementUntil: number;
  declare hallColumnOccupied: boolean;
  declare bb: { stage: number; footstep: boolean; pending: boolean; inOpening: boolean; openingAtCamsUp: number; maskTicks: number; inside: boolean; promotedAt: number; armed: boolean; hopDue: boolean; cueRedraw: boolean; };
  declare mangleStatic: { office: boolean; cam11: boolean; };
  declare blackout: { active: boolean; until: number; by: any; unitId: any; masked: boolean; deadline: number; };
  declare blackoutCount: number;
  declare blackoutStartFrame: number;
  declare puppetStaticTimer: number;
  declare fadeUntil: Record<string, number>;
  declare monDown: { visible: boolean; av0: number; av2: number; pendingDrop: boolean; hidePrev: boolean; invPrev: boolean; visPrev: boolean; };
  declare passTimers: Record<string, { v: number; init: boolean; }>;
  declare glitch: { value4: number; value5: number; g503: { v: number; init: boolean; }; g506: { v: number; init: boolean; }; };
  declare hooked: boolean;
  declare frameUnits: number;
  declare hookTimers: { five: { v: number; init: boolean; }; g497: { v: number; init: boolean; }; g744: { v: number; init: boolean; }; g627: { v: number; init: boolean; }; sec: { v: number; init: boolean; }; half: { v: number; init: boolean; }; sample: { v: number; init: boolean; }; ten: { v: number; init: boolean; }; };
  declare secTick: boolean;
  declare halfTick: boolean;
  declare sampleTick: boolean;
  declare tenTick: boolean;
  declare lastViewTimer: { v: number; init: boolean; };
  declare gatedEvery: Record<string, { v: number; init: boolean; }>;
  declare maskTick: boolean;
  declare streakTicks: number;
  declare am: number;
  declare hour: number;
  declare blackoutClock: number;
  declare blackoutClockFrame: number;
  declare blackoutPhase: { fade: number; danger: boolean; threshold: boolean; viewing: boolean };
  declare dropEverything: boolean;
  declare dropTouch: number;
  declare units: { idx: number; stunUntil: number; stunRemaining: number; pending: boolean; atOpening: boolean; openingSince: number; openingReadyAt: number; officeCue: boolean; openingTicks: number; maskExposureTicks: number; raiseSeen: boolean; inside: boolean; insideArmed: boolean; insideDangerAt: number; committedAt: number; done: boolean; hallColumn: boolean; footstep: boolean; value2: number; promoted: boolean; footstepOn: boolean; officeRoll: boolean; id: string; name: string; short: string; path: (string | number)[]; choke: number; entryGate: string; openingRule: string; lightStallAt: number[]; mutex: boolean; repelIdx: number; }[];
  declare engagedToy: any;
  declare decidePath: number;
  declare hallLatch: boolean;
  declare hallLit: boolean;
  declare unconditionalTimers: { group: number; delayUnits: number; counter: number; }[];
  declare unconditionalDraws: number;
  declare puppet: { stage: number; out: boolean; route: any; idx: number; loc: number; pending: boolean; pathChoice: string; stunUntil: number; stunRemaining: number; atOpening: boolean; inside: boolean; attackAt: number; };
  declare rec: { n: number; stun: Uint16Array<ArrayBuffer>[]; occ: Uint8Array<ArrayBuffer>; d: Uint8Array<ArrayBuffer>; power: Uint16Array<ArrayBuffer>; box: Uint8Array<ArrayBuffer>; flags: Uint8Array<ArrayBuffer>; };
  declare mistakes: any[];
  constructor(opts = {}) {
    // Every option, its default and what it models: plant-options.js.
    this.opts = Object.assign(defaultSimOptions(), opts);

    if (this.opts.customNight && this.opts.night !== 7)
      throw new Error('customNight requires night: 7 (Custom Night is night 7 in the menus)');
    if (this.opts.sourcedFoxyChain && !this.opts.sourcedDropLightOrder)
      throw new Error('sourcedFoxyChain reads the hall latch: it requires sourcedDropLightOrder');
    if (this.opts.sourcedRoutePass && !(this.opts.sourcedPromotedMoves && this.opts.sourcedRollsBeforeMoves))
      throw new Error('sourcedRoutePass splits promotion from move: it requires sourcedPromotedMoves and sourcedRollsBeforeMoves');
    if (this.opts.sourcedRouteViewDraws && !(this.opts.sourcedRoutePass && this.opts.sourcedPromotedViewDraws))
      throw new Error('sourcedRouteViewDraws draws inside the route pass: it requires sourcedRoutePass and sourcedPromotedViewDraws');
    if (this.opts.sourcedBBMoves && !this.opts.sourcedRoutePass)
      throw new Error('sourcedBBMoves hops Balloon Boy in the route pass: it requires sourcedRoutePass');
    if (this.opts.sourcedDropFlagOrder && !this.opts.sourcedDropLightOrder)
      throw new Error('sourcedDropFlagOrder moves the drop flag: it requires sourcedDropLightOrder');
    if (this.opts.sourcedMovementClock && !(this.opts.sourcedBDrainOrder && this.opts.sourcedRoutePass))
      throw new Error('sourcedMovementClock requires sourcedBDrainOrder and sourcedRoutePass');

    this.rng = new Rng(this.opts.seed, this.opts.worst);
    this.frame = 0;
    this.events = [];
    this.alive = true;
    this.won = false;
    this.death = null;

    // --- player-controlled state
    this.monitor = MON_DOWN;
    this.monAnim = 0;
    this.animationClocks = { monAnim: 0, maskAnim: 0 };
    this.contactInput = null;
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
    /** the frame g380/g385 last zeroed a Withered's value 0 (sourcedCam8Cancel)*/
    this.cam8CancelAt = {};
    /** g811 "only one action" flag: armed until the draw, re-armed while viewing > 0 (sourcedRandomImageDraw) */
    this.randomImageArmed = true;
    this.hasViewedCamera = false;
    this.maskOn = false;
    this.maskAnim = 0;
    this.maskOffBlocked = false; // g10 hides the animation; g11 keeps state 3 during a committed attack
    this.attackAnimation = null;
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
                maskTicks: 0, inside: false,
                promotedAt: -100, armed: false,     // g359's last promotion; value 0 still 2 at 122 (sourcedOfficeRolls)
                hopDue: false, cueRedraw: false };  // g413-g418 due in the route pass; g611 due (sourcedBBMoves)   // g359's last promotion; value 0 still 2 at 122 (sourcedOfficeRolls)
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
    /** last frame each unit's fade counter is above 0 (sourcedViewDraws)*/
    this.fadeUntil = {};
    // the monitor-down sprite (sourcedMonitorDownDraw)
    this.monDown = { visible: false, av0: 0, av2: 0, pendingDrop: false, hidePrev: false, invPrev: false, visPrev: false };
    /** per-group CND_EVERY2 countdowns (sourcedSecondPass)*/
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
    /** the gated countdowns (sourcedGatedEvery)*/
    this.gatedEvery = {};
    this.maskTick = false;     // g907 fired this frame (sourcedGatedEvery)
    this.streakTicks = 0;      // old freddy value 25, the cams-up streak (sourcedGatedEvery)
    this.am = 0;
    this.hour = 0;
    this.blackoutClock = 0;
    this.blackoutClockFrame = -1;
    this.blackoutPhase = { fade: 0, danger: false, threshold: false, viewing: false };
    // `drop everything` (g141): the forcedown flag. Set by g718-721, g624 and
    // g574; executed on the monitor by g262 and on the mask by g274, then
    // cleared by g612.
    this.dropEverything = false;
    // the update a drop-button touch landed on (frame before its tick), read there by g618/g619 (sourcedDropFlagOrder)
    if (this.opts.sourcedDropFlagOrder) this.dropTouch = -1;

    // --- the seven
    this.units = C.STALLED.map(u => ({
      ...u, idx: 0, stunUntil: -1, stunRemaining: 0, pending: false, atOpening: false,
      openingSince: -1, openingReadyAt: -1, officeCue: false,
      openingTicks: 0, maskExposureTicks: 0, raiseSeen: false, inside: false,
      insideArmed: false, insideDangerAt: -1, committedAt: -1, done: false,
      hallColumn: false,   // overlapping `hall movement` last frame (sourcedHallEntry)
      footstep: false,     // a roll hop onto a `hear footsteps` marker, drawn at g695-g703 (sourcedFootstepDraws)
      value2: 0,           // value 2: 10 at promotion, drained by global 5 per loop (sourcedFootstepValue2)
      promoted: false,     // value 0 == 2: the move is promoted and waits for its own conditions
      footstepOn: false,   // g695-g703's condition on the previous loop (only one action when event loops)
      officeRoll: false,   // value 0 == 1 at 122, waiting for its promotion (sourcedOfficeRolls)
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
    if (this.opts.sourcedOfficeFootsteps && !(this.opts.sourcedFootstepValue2 && this.opts.sourcedRollDraws))
      throw new Error('sourcedOfficeFootsteps promotes rolls at 122 into value 2: it requires sourcedFootstepValue2 and sourcedRollDraws');
    if (this.opts.sourcedOfficeRolls && !(this.opts.sourcedOfficeFootsteps && this.opts.sourcedRoutePass))
      throw new Error('sourcedOfficeRolls retries the promotions at 122 in the route pass: it requires sourcedOfficeFootsteps and sourcedRoutePass');
    if (this.opts.sourcedFootstepValue2 && !this.opts.sourcedFootstepDraws)
      throw new Error('sourcedFootstepValue2 changes when the footstep cue draws: it requires sourcedFootstepDraws');
    if (this.opts.sourcedFoxyMoveValue2 && !(this.opts.sourcedFootstepDraws && this.opts.sourcedFoxyChain))
      throw new Error('sourcedFoxyMoveValue2 is g389 writing value 2 for g698: it requires sourcedFootstepDraws and sourcedFoxyChain');
    if (this.opts.sourcedHallLatchOrder && !this.opts.frameMs)
      throw new Error('sourcedHallLatchOrder moves the hooked one-second latch reset: it requires frameMs');
    if (this.opts.sourcedBlackoutClockEnd && !(this.opts.sourcedBlackoutDraws && this.opts.frameMs))
      throw new Error('sourcedBlackoutClockEnd reads the g514 clock: it requires sourcedBlackoutDraws and frameMs');
    if (this.opts.sourcedValue5 && !this.opts.frameMs)
      throw new Error('sourcedValue5 derives global value 5 from the timer delta: it requires frameMs');
    if (this.opts.sourcedExposureValue5 && !this.opts.sourcedValue5)
      throw new Error('sourcedExposureValue5 adds the sheet\'s value 5: it requires sourcedValue5');
    if (this.opts.sourcedValue5 && this.opts.frameValue5)
      throw new Error('sourcedValue5 derives global value 5 from frameMs: give it or frameValue5, not both');
    if (this.opts.sourcedPromotedViewDraws && !this.opts.sourcedViewDraws)
      throw new Error('sourcedPromotedViewDraws changes which view draws fire: it requires sourcedViewDraws');
    if (this.opts.sourcedSheetOrder && !this.opts.sourcedSecondPass)
      throw new Error('sourcedSheetOrder orders the per-second pass: it requires sourcedSecondPass');
    if (this.opts.sourcedAttackAnimation && !this.opts.sourcedSheetOrder)
      throw new Error('sourcedAttackAnimation requires sourcedSheetOrder');
    if (this.opts.sourcedUnconditionalDraws && C.FPS !== 60)
      throw new Error('sourcedUnconditionalDraws assumes a 60 fps frame (50 timer units)');
    this.unconditionalTimers = [{ group: 58, delayUnits: 300, counter: 300 },
                                { group: 59, delayUnits: 1470, counter: 1470 },
                                { group: 192, delayUnits: 300, counter: 300 }];
    this.unconditionalDraws = 0;

    // --- puppet
    this.puppet = {
      stage: 0, out: false, route: null, idx: -1, loc: 11,
      pending: false, pathChoice: 'left', stunUntil: -1, stunRemaining: 0,
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
  unitStunLeft(unit) { return unitStunLeft(this, unit); }
  // The rows that fire as `hour` begins, capped as g829/g830/g856-863 cap them.
  applyAiHour(hour) {
    for (const row of C.aiUpdates(this.opts.night, hour, this.opts.customNight)) {
      for (const [id, level] of Object.entries(row.set as Record<string, any>)) {
        const value = typeof level === 'number' ? level : this.rollAi(level.oneIn);
        this.ai[id] = Math.min(value, C.aiCap(id));
      }
    }
    // g677/g679/g681: Golden Freddy's first-loop roll on nights 3-5 (sourcedHourTable)
    const golden = this.opts.sourcedHourTable && hour === 0 ? SOURCED_HOUR0_GOLDEN[this.opts.night] : undefined;
    if (golden) this.ai.golden = Math.min(this.rollAi(golden), C.aiCap('golden'));
  }

  /**
   * Global value 5 on loop `f`: g1236's Min(4, previous loop's timer delta / VALUE5_DIVISOR) under
   * sourcedValue5 (frame 0 stands for the loop before the office's first), else frameValue5(f), else 1.
   */
  value5(f: number) {
    if (this.opts.sourcedValue5) return Math.min(4, (this.opts.frameMs as (frame: number) => number)(f - 1) / VALUE5_DIVISOR);
    return this.opts.frameValue5 ? this.opts.frameValue5(f) : 1;
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
  get maskState() { return this.maskOn ? (this.maskAnim > 0 ? 1 : 2) : (this.maskAnim > 0 || this.maskOffBlocked ? 3 : 0); }
  get maskFullyOff() { return this.maskState === 0; }
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
  emit(type, data?) {
    const event: { f: number, type: any, data?: any } = { f: this.frame, type };
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

  /**
   * One reach of a CND_EVERY2 countdown, in 1/3 ms units at 50 per 60 fps frame.
   * CND_EVERY2.eva2 (classes.dex) loads the delay on the first reach and returns
   * false (PARAM_INT value2 is the load flag); later reaches subtract
   * rhTimerDelta, fire at <= 0 and add the delay back. The model's f % N timers
   * fire at frame N where a countdown loaded on the dump's first loop fires on
   * loop N + 1, so model frame f is dump loop f + 1 and the loading loop is the
   * model's frame 0: a group first reached on frame 1 has already loaded.
   */
  passEvery(t: {v: number, init: boolean}, ms: number) {
    if (!t.init) {
      t.init = true; t.v = ms * 3;
      if (this.frame !== 1 || this.opts.sourcedEveryOrigin) return false;
    }
    t.v -= this.frameUnits;
    if (t.v > 0) return false;
    t.v += ms * 3;
    return true;
  }

  /** One reach of a gated group's own CND_EVERY2 countdown (sourcedGatedEvery). */
  gatedPass(key: string, ms: number) { return this.passEvery(this.gatedEvery[key] ??= { v: 0, init: false }, ms); }

  // ------------------------------------------------------------------- tick
  tick() {
    if (!this.alive || this.won) return;
    const f = ++this.frame;
    if (attackAnimationEarly(this)) return; // triggered exits skip ordinary events and draws
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

    // g262/g274 consume the previous loop's flag before player presses;
    // g612 clears it and g624/g718-721 raise it for the next loop.
    releaseFlipLock(this);
    this.tickForcedown();
    if (this.opts.sourcedMonitorDownDraw) this.monitorDownEarly();   // e7 hide, then e211 show

    if (this.finishAnimation('monAnim', this.monitor === MON_RAISING ? C.MONITOR_ANIM_UP : C.MONITOR_ANIM_DOWN)) {
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
        // g402-403: hiding mmonitorUp lets a Mangle that saw the raise cross 122 -> 123.
        for (const u of this.units) {
          if (u.id === 'mangle' && u.atOpening && u.raiseSeen)
            this.unitEnterInside(u, 'completed a monitor raise after Mangle reached marker 122');
        }
      }
      else if (this.monitor === MON_LOWERING && !(this.opts.sourcedAnimationCount &&
        (this.attackExecuting || this.puppetAttackExecuting || this.goldenHallAttackExecuting))) this.monitor = MON_DOWN;
    }
    if (this.finishAnimation('maskAnim', this.maskOn ? C.MASK_ANIM_ON : C.MASK_ANIM_OFF - 1) && this.maskOn) {
      // g911 mirrors monitor-down's counter clear without moving the marker.
      this.viewing = 0;
      // g776/g1040: a fully-on mask dismisses yellowbear (alt0 = 1, fade, destroy).
      if (this.gf.present) { this.gf.present = false; this.emit('gf-cleared'); }
      // g293 resets the continuous mask-hold counters each time the mask becomes fully on.
      for (const u of this.units) {
        if (u.id === 'toychica' || u.id === 'mangle') u.maskExposureTicks = 0;
      }
      this.bb.maskTicks = 0;   // g293 names Balloon Boy alongside the two toys
    }

    readContactInput(this);
    if (this.opts.sourcedGatedEvery) this.maskTick = this.maskFullyOn && this.gatedPass('g907', 1000);   // g907
    // g263 is the only writer of `last viewed`: a global 200 ms sample of the
    // live feed. It runs only while a camera is displayed.
    if (this.viewing > 0 && (this.opts.sourcedLastViewPause ? this.passEvery(this.lastViewTimer, 200)
        : this.hooked ? this.sampleTick : f % C.LAST_VIEW_SAMPLE_FRAMES === 0))
      this.lastViewed = this.viewing;

    if (this.opts.sourcedUnconditionalDraws) this.drawUnconditional();   // g58/g59/g192
    if (this.opts.sourcedSheetOrder) this.secondPassFront(f);             // g213/g292/g294 before g333
    // --- 5-second interval: Foxy's kill check runs before anything else
    if (this.hooked ? this.passEvery(this.hookTimers.five, 5000) : f % C.MO_FRAMES === 0) this.onFiveSecond();
    if (this.opts.sourcedRoutePass) this.routePass(f);             // g344-g360, then g374-g435
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

    if (this.opts.sourcedSheetOrder) this.secondPassEarly(f);   // g366..g518 in sheet order
    else {
      if (this.opts.sourcedViewDraws) this.drawViewed(f);   // g366/g368/g419, g468-g476, g498
      if (this.opts.sourcedPuppetGlitchDraws) this.puppetGlitchEarly();   // g500-g506
      this.blackoutFlicker(f);                              // g514 clock, g517/g518
    }
    const resolveBlackout = blackoutResolveReady(this, f); // g534-g537, also during the fade after danger
    if (this.blackout.active) {
      // Android group 533 only defuses while the 45-frame fuse is still in
      // state 1, and only once the mask animation has reached state 2.
      if (!this.blackout.masked && this.maskFullyOn && f < this.blackout.deadline)
        this.blackout.masked = true;
      // Fuse expiry arms the attack, but groups 538-555 do not resolve it
      // until the 300-frame office sequence ends.
      if (resolveBlackout) {   // g537
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
    if (this.opts.sourcedBDrainOrder && this.opts.sourcedHallLatchOrder) this.hallLightPin();   // g848-g854, after g488/g489
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
    blackoutLate(this);                                                         // g845
    if (this.opts.sourcedGatedEvery) this.tickStreak();                            // g785/g786
    if (this.opts.sourcedAnimationCount) {                                      // g1015-g1022, before g1236
      const delta = this.value5(f);
      if (this.monAnim > 0) this.animationClocks.monAnim += delta;
      if (this.maskAnim > 0) this.animationClocks.maskAnim += delta;
    }

    if (this.hooked ? this.hour >= 6 : f >= this.opts.durationFrames) { this.won = true; this.emit('win'); }
  }

  /** g1/g6/g9/g10 read the prior loop's accumulated counter. */
  finishAnimation(field: 'monAnim' | 'maskAnim', threshold: number) {
    if (this[field] <= 0) return false;
    if (!this.opts.sourcedAnimationCount) return --this[field] === 0;
    this[field] = Math.max(0, threshold - this.animationClocks[field]);
    if (field === 'maskAnim' && this[field] === 0 && !this.maskOn)
      this.maskOffBlocked = this.attackExecuting || this.puppetAttackExecuting || this.goldenHallAttackExecuting;
    return this[field] === 0;
  }

  // `hall movement` (object 180): the hitbox at (669, 503) that only the two
  // hall stages overlap. g779 needs it at zero, and with the hall light held
  // g202/g1035 draw the dark "movement" hall (frame 99 / patch 13) while it is
  // above zero instead of the empty hall (g203/g1034) or a standing character
  // (g205-209) -- the phone's DIM flash class. Ticked every frame, whether or
  // not Golden Freddy is enabled, so a trace can read it at each flash.
  get hallMovementFrames() { return Math.max(0, this.hallMovementUntil - this.frame); }

  // D is held at zero for all of night 1 and until 2 AM on night 2
  // (groups 872-874).
  get foxyDormant() {
    const n = this.opts.night;
    return n === 1 || (n === 2 && this.frame < 2 * C.HOUR_FRAMES);
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
        best = Math.max(best, unitStunLeft(this, u));
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

  // A unit's move. It was named `advance`, which PlantModel's port clock (plant.js) shadowed, so every
  // PlantModel night threw at its first move (packages/source/test/plant-facade.test.js).
  advanceUnit(u) { return units.advance.call(this, u); }
  // The old name, for callers outside the Sim (simtest.mjs moves a unit by hand); a PlantModel shadows it.
  advance(u) { return units.advance.call(this, u); }
}

// The mechanisms live beside this file, one module per mechanism, as functions that take the Sim as `this`.
// Each is installed with a class method's own descriptor (writable, configurable, not enumerable), so
// `this.x()` calls, a subclass's override and the tools that patch Sim.prototype reach exactly what they did
// when the class declared them; TypeScript types each member from its descriptor.
Object.defineProperty(Sim.prototype, 'press', { value: office.press, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'release', { value: office.release, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'setMask', { value: office.setMask, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'setMonitor', { value: office.setMonitor, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'startBlackout', { value: office.startBlackout, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'startOfficeEncounter', { value: office.startOfficeEncounter, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'unitEnterInside', { value: office.unitEnterInside, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'repelCooldown', { value: office.repelCooldown, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'commitAttack', { value: office.commitAttack, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'armInsideAttack', { value: office.armInsideAttack, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickForcedown', { value: office.tickForcedown, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'readDropTouch', { value: office.readDropTouch, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'enableContactInput', { value: office.enableContactInput, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'contactDown', { value: office.contactDown, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'contactUp', { value: office.contactUp, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'updateHallLatch', { value: hall.updateHallLatch, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'updateLitCounter', { value: hall.updateLitCounter, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'hallLitNow', { value: hall.hallLitNow, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'onLightPress', { value: hall.onLightPress, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickLight', { value: hall.tickLight, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'hallLightPin', { value: hall.hallLightPin, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'stunCam', { value: hall.stunCam, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickHallMovement', { value: hall.tickHallMovement, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickGoldenHall', { value: hall.tickGoldenHall, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'foxyChainTransitions', { value: hall.foxyChainTransitions, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickFoxyChain', { value: hall.tickFoxyChain, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickFoxy', { value: hall.tickFoxy, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickStreak', { value: units.tickStreak, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'footstepPromotable', { value: units.footstepPromotable, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'footstepPromote', { value: units.footstepPromote, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickMask', { value: units.tickMask, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'bbLeave', { value: units.bbLeave, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'unitLeave', { value: units.unitLeave, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'onCamsUp', { value: units.onCamsUp, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'bbHop', { value: units.bbHop, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'bbEnterOpening', { value: units.bbEnterOpening, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'rollAllFiveSecond', { value: units.rollAllFiveSecond, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'routePass', { value: units.routePass, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'officeRoll', { value: units.officeRoll, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'officePromote', { value: units.officePromote, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'rollDecidePath', { value: units.rollDecidePath, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'sourcedRouteStep', { value: units.sourcedRouteStep, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'canAdvance', { value: units.canAdvance, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickUnits', { value: units.tickUnits, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'onFiveSecond', { value: units.onFiveSecond, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'drawViewed', { value: sheet.drawViewed, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'monitorDownEarly', { value: sheet.monitorDownEarly, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'monitorDownLate', { value: sheet.monitorDownLate, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'secondPass', { value: sheet.secondPass, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'secondPassFront', { value: sheet.secondPassFront, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'passTools', { value: sheet.passTools, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'secondPassEarly', { value: sheet.secondPassEarly, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'secondPassLate', { value: sheet.secondPassLate, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'ventCamDraws', { value: sheet.ventCamDraws, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'randomImageDraw', { value: sheet.randomImageDraw, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'footstepNodes', { value: sheet.footstepNodes, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'footstepDraws', { value: sheet.footstepDraws, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'blackoutFlicker', { value: sheet.blackoutFlicker, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'drawUnconditional', { value: sheet.drawUnconditional, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'drainBoxCountdown', { value: puppet.drainBoxCountdown, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'puppetUnderYourView', { value: puppet.puppetUnderYourView, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'puppetAtBoxCam', { value: puppet.puppetAtBoxCam, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'litCounter', { value: puppet.litCounter, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'puppetGlitchEarly', { value: puppet.puppetGlitchEarly, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'puppetGlitchLate', { value: puppet.puppetGlitchLate, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickBox', { value: puppet.tickBox, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'tickPuppet', { value: puppet.tickPuppet, writable: true, configurable: true });
Object.defineProperty(Sim.prototype, 'advancePuppet', { value: puppet.advancePuppet, writable: true, configurable: true });
