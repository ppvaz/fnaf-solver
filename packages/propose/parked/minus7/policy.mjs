// The exact-engine policy adapter (plans/11, work package 1).
//
// One observation/action contract so that scripted schedules, priority
// machines and belief-state controllers can be compared on the same engine,
// the same seeds and the same error models. It creates NO second simulator:
// the `Sim` in `packages/source/src/games/fnaf2/plant-model.js` remains the sole
// mechanics authority and this file only wraps construction, action
// delivery, observation privilege and the terminal report.
//
// It is deliberately the same machinery the existing tools already use:
//
//   - the run loop is `packages/propose/parked/minus7/hid-device-pilot.mjs`'s `run()` -- schedule rows into
//     a frame-sorted queue, drain what is due, `actuator.deliver()`, `tick()`;
//   - the error streams follow `packages/propose/parked/minus7/reactive-pilot.mjs`: a jitter draw taken from
//     `sim.rng` would move the game's own rolls, so slack and actuator noise
//     each get their own salted `Rng` and never touch the sim's;
//   - the device layer is `packages/play/bin/phone/actuator.mjs` unchanged.
//
// --------------------------------------------------------------- the contract
//
// A policy is a plain object:
//
//   { name, version, observation: 'truth' | 'belief',
//     reset(api),            // optional; called once before frame 0
//     step(obs, api) }       // called every frame while the night runs
//
// `obs` is a single object REUSED every frame (25,200 frames a night times
// thousands of nights -- allocating a fresh observation per frame doubles the
// cost of a sweep). A policy must read it, never retain it.
//
// `api` schedules future actions; a policy never presses "now" directly,
// because "now" is not a thing a hand or a phone can do. Every scheduled row
// is the unit of execution error, exactly as in `human-gate.mjs`, where one
// plan row takes one slack draw and a hold's release shares its press's draw.
//
//   api.frame              current frame
//   api.tap(f, act)        one press at frame f
//   api.hold(f, n, act)    press at f, release at f+n (ONE draw: length kept)
//   api.clear()            drop everything still pending (preemption)
//   api.pending            how many rows are still queued
//
// -------------------------------------------------------- observation modes
//
// `truth`  -- the whole engine state. An upper bound, never a device claim.
// `belief` -- only what a stock Android controller could plausibly hold:
//             its OWN action history (not the game's answer to it), the
//             blackout, the office view while the monitor is down, and sensor
//             reads that must be paid for (a vent light held, the box visible
//             only on CAM 11 with the monitor up).
//
// The belief self-state is updated when a row is DISPATCHED, not when the
// engine accepts it. That is the point: a monitor press the phone drops still
// flips the controller's belief, which is the belief inversion CLAUDE.md
// describes ("one lost monitor press inverts the rest of the night, and
// nothing in the run notices").
//
// Nothing here prices a press. See CLAUDE.md, "The simulator prices nothing":
// every number this file produces is a statement about the model.
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Rng } from '@sixam/source/fnaf2';
import { DeviceActuator } from '../../../play/bin/phone/actuator.mjs';

export const ADAPTER_VERSION = 1;

// Its own stream, never the sim's. "slac" -- the same trick human-gate.mjs
// and model/reactive-pilot.mjs use so two error models stay comparable on identical luck.
const SLACK_SALT = 0x736c6163;

const f = (msv) => Math.round(msv * C.FPS / 1000);

export class PolicyRun {
  constructor({ policy, night = 7, seed = 1, worst = false, slackMs = 0,
                slackModel = 'iid', deviceActuator = null,
                observation = null } = {}) {
    if (!policy || typeof policy.step !== 'function')
      throw new Error('a policy must expose step(obs, api)');
    this.policy = policy;
    this.night = night;
    // A policy that carries its own error stream (the Minus 7 control shifts
    // its PLAN ROWS, which is human-gate.mjs's semantics) must not also be
    // shifted here, or the slack is applied twice.
    this.slackMs = policy.ownSlack ? 0 : slackMs;
    // Two error SHAPES, because CLAUDE.md is explicit that the shape decides
    // the answer: "iid is the wrong shape -- humans clear at per-step error
    // the iid model calls fatal".
    //   iid        -- one independent draw per scheduled row. This is
    //                 human-gate.mjs's model, and the one the device gate
    //                 currently enforces.
    //   correlated -- one draw shared by every row of a decision (you started
    //                 the whole pass late) plus a third of the magnitude
    //                 independently per row. This is model/reactive-pilot.mjs's model.
    //   common     -- the shared draw alone: the whole pass translated, with
    //                 no differential error at all. It is the optimistic end
    //                 of the bracket and it is what model/reactive-pilot.mjs's published
    //                 jitter curve actually measures at small magnitudes,
    //                 where its integer spread term rounds to zero.
    this.slackModel = slackModel;
    this.spreadMs = slackModel === 'common' ? 0 : Math.round(slackMs / 3);
    this.commonShift = 0;
    this.mode = observation ?? policy.observation ?? 'truth';
    if (this.mode !== 'truth' && this.mode !== 'belief')
      throw new Error(`unknown observation mode: ${this.mode}`);

    this.sim = new Sim({ seed, night, worst });
    this.act = deviceActuator
      ? new DeviceActuator(this.sim, Object.assign(
        { seed, worst, perPress: false },
        deviceActuator === true ? {} : deviceActuator))
      : null;
    this.slackRng = new Rng((((seed >>> 0) ^ SLACK_SALT) >>> 0)); // never worst-pinned

    this.queue = [];
    this.seq = 0;
    this.actions = 0;
    this.minBox = 1;

    // What the controller thinks it has done. Diverges from the engine on
    // every refused or dropped press -- deliberately.
    this.belief = { monUp: false, maskOn: false, cam: C.BOX_CAM,
                    lightHeld: false, windHeld: false,
                    ventL: false, ventR: false };
    // Last paid-for sensor reads: [value, frameRead].
    this.sensors = { ventL: [null, -1], ventR: [null, -1], box: [null, -1] };

    this.obs = this.blankObs();
    this.api = this.makeApi();
    if (policy.reset) policy.reset(this.api);
  }

  // ------------------------------------------------------------------- api
  makeApi() {
    const self = this;
    return {
      get frame() { return self.sim.frame; },
      get pending() { return self.queue.length; },
      night: this.night,
      s: C.s,
      ms: f,
      tap(frame, act) { self.emit(frame, 0, act); },
      hold(frame, frames, act) { self.emit(frame, frames, act); },
      // Low-level rows, for a policy whose plan already carries separate
      // down/up rows (model/reactive-pilot.mjs's `Bot` is the one in this repository).
      press(frame, act) { self.emit(frame, 0, act); },
      release(frame, act) { self.emit(frame, -1, act); },
      clear() { self.queue.length = 0; },
    };
  }

  // One scheduled row -> one slack draw. A hold's release shares it, so the
  // duration survives the error model (plans/04: independent draws price
  // nothing). The absolute frame is clamped to the present: a negative draw
  // can make an action earlier, but not retroactive.
  // holdFrames: 0 = a bare press, >0 = press plus its release, -1 = a bare
  // release (the low-level `api.release` row).
  emit(frame, holdFrames, act) {
    let shift = 0;
    if (this.slackMs) {
      shift = this.slackModel !== 'iid'
        ? this.commonShift + f(this.slackRng.int(-this.spreadMs, this.spreadMs))
        : f(this.slackRng.int(-this.slackMs, this.slackMs));
    }
    const at = Math.max(this.sim.frame, frame + shift);
    if (holdFrames < 0) this.queue.push([at, this.seq++, 'release', act]);
    else {
      this.queue.push([at, this.seq++, 'press', act]);
      if (holdFrames > 0) this.queue.push([at + holdFrames, this.seq++, 'release', act]);
    }
  }

  // ----------------------------------------------------------- observation
  blankObs() {
    return {
      mode: this.mode, night: this.night, frame: 0, t: 0,
      // self-state
      monUp: false, maskOn: false, maskFullyOn: false, cam: C.BOX_CAM,
      lightHeld: false, winding: false,
      // resources
      box: 1, bars: 4, power: C.powerFrames(this.night),
      // office
      blackout: false, blackoutMasked: false, blackoutFuseLeft: 0,
      gfPresent: false,
      // sensors / threats
      ventLOccupied: false, ventROccupied: false, ventLAge: Infinity, ventRAge: Infinity,
      foxyAmbience: false, foxyD: 0, foxyLocked: false, foxyInHall: false,
      bbInOpening: false, bbInside: false, bbStage: 0,
      tbCue: false, insideCount: 0, openingCount: 0,
      units: C.STALLED.map(u => ({ id: u.id, node: null, atOpening: false,
                                   inside: false, vent: null })),
    };
  }

  // Whether a vent read, if paid for right now, would show an occupant.
  ventTruth(side) {
    const s = this.sim;
    if (side === 'L' && s.bb.inOpening) return true;
    return s.units.some(u => u.atOpening && !u.done &&
      u.path[u.idx] === (side === 'L' ? 'ventL' : 'ventR'));
  }

  observe() {
    const s = this.sim, o = this.obs;
    o.frame = s.frame; o.t = s.t;
    o.blackout = s.blackout.active;
    o.blackoutMasked = s.blackout.masked;
    o.blackoutFuseLeft = s.blackout.active ? Math.max(0, s.blackout.deadline - s.frame) : 0;

    if (this.mode === 'truth') {
      o.monUp = s.camsUp; o.maskOn = s.maskOn; o.maskFullyOn = s.maskFullyOn;
      o.cam = s.viewing; o.lightHeld = s.lightHeld; o.winding = s.isWinding;
      o.box = s.box; o.power = s.power; o.bars = s.bars;
      o.gfPresent = s.gf.present;
      o.foxyD = s.foxy.D; o.foxyLocked = s.foxy.gotYou;
      o.foxyInHall = s.foxy.loc === 'hall'; o.foxyAmbience = o.foxyInHall;
      o.bbInOpening = s.bb.inOpening; o.bbInside = s.bb.inside; o.bbStage = s.bb.stage;
      o.ventLOccupied = this.ventTruth('L'); o.ventROccupied = this.ventTruth('R');
      o.ventLAge = 0; o.ventRAge = 0;
      let inside = 0, opening = 0;
      for (let i = 0; i < s.units.length; i++) {
        const u = s.units[i], v = o.units[i];
        v.node = u.path[u.idx]; v.atOpening = u.atOpening; v.inside = u.inside;
        v.vent = v.node === 'ventL' ? 'L' : v.node === 'ventR' ? 'R'
          : v.node === 'office' ? 'O' : null;
        if (u.inside) inside++;
        if (u.atOpening) opening++;
      }
      o.insideCount = inside; o.openingCount = opening;
      o.tbCue = s.units.some(u => u.id === 'toybonnie' && u.officeCue);
      return o;
    }

    // --- belief mode -------------------------------------------------------
    const b = this.belief;
    o.monUp = b.monUp; o.maskOn = b.maskOn; o.maskFullyOn = b.maskOn;
    o.cam = b.cam; o.lightHeld = b.lightHeld; o.winding = b.windHeld && b.monUp && b.cam === C.BOX_CAM;
    // The box gauge is drawn on CAM 11; the power bars are in the office.
    if (s.camsUp && s.viewing === C.BOX_CAM) this.sensors.box = [s.box, s.frame];
    o.box = this.sensors.box[0] ?? 1;
    o.bars = s.camsUp ? o.bars : s.bars;
    o.power = s.camsUp ? o.power : s.power;
    // Golden Freddy is drawn in the office: visible whenever the monitor is
    // actually down and the mask is actually off.
    o.gfPresent = !s.camsUp && !s.maskOn && s.gf.present;
    // A vent read costs a held vent light; nothing is known between reads.
    if (s.ventLightLOn) this.sensors.ventL = [this.ventTruth('L'), s.frame];
    if (s.ventLightROn) this.sensors.ventR = [this.ventTruth('R'), s.frame];
    o.ventLOccupied = this.sensors.ventL[0] === true;
    o.ventROccupied = this.sensors.ventR[0] === true;
    o.ventLAge = this.sensors.ventL[1] < 0 ? Infinity : s.frame - this.sensors.ventL[1];
    o.ventRAge = this.sensors.ventR[1] < 0 ? Infinity : s.frame - this.sensors.ventR[1];
    // The hall AMBIENCE, not the picture: MINUS-7-STRATEGY.md §2 is explicit
    // that a blank hallway means someone is standing in it and that the
    // ambience is the reliable Foxy cue.
    o.foxyAmbience = s.foxy.loc === 'hall';
    // Not observable on a stock screen at any price: Foxy's D, his lock-on,
    // Balloon Boy's route stage, and where any stalled unit is standing.
    o.foxyD = -1; o.foxyLocked = false; o.foxyInHall = false;
    o.bbStage = -1;
    o.bbInOpening = o.ventLOccupied;   // the device-validated lit-left read
    o.bbInside = s.bb.inside && !s.camsUp; // the flashlight is visibly dead
    o.insideCount = -1; o.openingCount = -1;
    o.tbCue = o.blackout;              // the overlay reads as an office cue
    for (const v of o.units) { v.node = null; v.atOpening = false; v.inside = false; v.vent = null; }
    return o;
  }

  // --------------------------------------------------------------- delivery
  dispatch(kind, act) {
    const b = this.belief;
    if (kind === 'press') {
      if (act === 'monitor') b.monUp = !b.monUp;
      else if (act === 'mask') b.maskOn = !b.maskOn;
      else if (act === 'light') b.lightHeld = true;
      else if (act === 'wind') b.windHeld = true;
      else if (act === 'ventL') b.ventL = true;
      else if (act === 'ventR') b.ventR = true;
      else if (act.startsWith('cam:')) b.cam = +act.slice(4);
      this.actions++;
      if (this.act) this.act.press(act); else this.sim.press(act);
    } else {
      if (act === 'light') b.lightHeld = false;
      else if (act === 'wind') b.windHeld = false;
      else if (act === 'ventL') b.ventL = false;
      else if (act === 'ventR') b.ventR = false;
      if (this.act) this.act.release(act); else this.sim.release(act);
    }
  }

  step() {
    if (this.slackMs && this.slackModel !== 'iid')
      this.commonShift = f(this.slackRng.int(-this.slackMs, this.slackMs));
    this.policy.step(this.observe(), this.api);
    if (this.queue.length) {
      this.queue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      // One wall-timed launch per DELIVERY frame, not per press: everything
      // the runner issues together shares a lateness draw, the way
      // model/hid-device-pilot.mjs beats once per HID macro (perPress: false). This is
      // uniform across policies so the actuator column compares like with
      // like -- a policy that batches its rows onto one frame is not thereby
      // given a different error model from one that spreads them.
      if (this.act && this.queue[0][0] <= this.sim.frame) this.act.beat();
      while (this.queue.length && this.queue[0][0] <= this.sim.frame) {
        const [, , kind, act] = this.queue.shift();
        this.dispatch(kind, act);
      }
    }
    if (this.act) this.act.deliver();
    this.minBox = Math.min(this.minBox, this.sim.box);
  }

  run() {
    while (this.sim.alive && !this.sim.won) { this.step(); this.sim.tick(); }
    return this.report();
  }

  report() {
    const s = this.sim;
    return {
      policy: this.policy.name, version: this.policy.version ?? 0,
      adapter: ADAPTER_VERSION, mode: this.mode, night: this.night,
      slackMs: this.policy.ownSlack ? (this.policy.slackMs ?? 0) : this.slackMs,
      actuator: Boolean(this.act),
      won: s.won, frame: s.frame, t: s.t,
      reason: s.won ? null : (s.death?.reason ?? 'unknown'),
      detail: s.won ? null : (s.death?.detail ?? ''),
      minBox: this.minBox, power: s.power, actions: this.actions,
      seamDrops: this.act ? this.act.seamDrops : 0,
    };
  }
}

export function runPolicy(opts) { return new PolicyRun(opts).run(); }

// A seeded sweep. Seeds are the bbtest stride so two policies see the same
// luck; the engine's Rng keeps only 16 bits, so the stride matters more than
// the count. `makePolicy(seed)` is handed the seed because a policy that
// carries its OWN error stream (the Minus 7 control does, so that slack lands
// on its plan rows the way human-gate.mjs shifts a plan's offsets) has to
// re-seed per run.
export function sweep(makePolicy, { runs = 100, night = 7, worst = false,
                                    slackMs = 0, slackModel = 'iid',
                                    deviceActuator = null,
                                    observation = null } = {}) {
  let survived = 0, minBox = 1, minPower = Infinity, actions = 0, seamDrops = 0;
  const deaths = new Map();
  for (let i = 0; i < runs; i++) {
    const seed = (i * 2246822519) >>> 0;
    const r = runPolicy({ policy: makePolicy(seed, slackMs, slackModel), night,
                          seed, worst, slackMs, slackModel, deviceActuator,
                          observation });
    if (r.won) survived++;
    else deaths.set(r.reason, (deaths.get(r.reason) || 0) + 1);
    minBox = Math.min(minBox, r.minBox);
    minPower = Math.min(minPower, r.power);
    actions += r.actions; seamDrops += r.seamDrops;
  }
  return { survived, runs, night, slackMs, slackModel, worst,
           actuator: Boolean(deviceActuator), minBox, minPower,
           actions: Math.round(actions / runs), seamDrops,
           deaths: [...deaths.entries()].sort((a, b) => b[1] - a[1]) };
}
