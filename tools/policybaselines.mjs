// Baseline policies for the plans/11 comparison, on the exact engine through
// `tools/policy.mjs`.
//
// PROVENANCE. The three public-bot families here are **independently
// reimplemented from this repository's own reconstructions**, not ported:
//
//   - Jason-style phase loop  -- docs/research/FNAF-BOT-IMPLEMENTATION-COMPARISON.md
//                                §"1. Jason: the nearest black-box stock-game
//                                comparator", plus the census row for
//                                `jasonclone/fnaf2bot`.
//   - Shooter25-style machine -- docs/in-engine/SHOOTER25-BOT-STATE-MACHINE.md,
//                                whose extracted thresholds (phase = Timer mod
//                                5000, the 2000/3000/4800 gates, the 15/10/30
//                                light countdowns, the 211/305 mask-loop
//                                counts) are used literally where extracted.
//   - Couraeel-style priority -- the census row for `Couraeel/Fnaf2-Ai` and the
//                                comparison document's §"3. Couraeel: the
//                                cleanest open controller decomposition".
//
// No source was read from those projects for this file, and most of them carry
// no reuse licence (see the census's licensing section). Every place where the
// public description does not determine a value is marked **[GUESS]** in a
// comment, because a guessed detail that flatters the local route is the
// failure mode this exercise exists to avoid.
//
// The local Minus 7 control is not reimplemented at all: it is
// `tools/model/reactive-pilot.mjs`'s `Bot`, driven through the adapter, so the control and
// the published reactive Minus 7 figure are the same code.
import * as C from '@sixam/source/fnaf2';
import { Rng } from '@sixam/source/fnaf2';
import { Bot, DEFAULT_CYCLE } from './model/reactive-pilot.mjs';

const ms = (v) => Math.round(v * C.FPS / 1000);
const MINUS7_SALT = 0x6d373037; // "m707"; its own stream, never the sim's

// ---------------------------------------------------------------- Minus 7
// The project's own route, as the control. `Bot` presses on a proxy `sim`
// that forwards to the adapter; its four plan builders are wrapped so that
// human slack lands on the SCHEDULED row offsets, which is human-gate.mjs's
// semantics (one draw per row, order re-sorts afterwards). The adapter's own
// slack must therefore be left at zero for this policy -- `sweepMinus7()`
// below does that.
export function minus7Policy({ slackMs = 0, slackModel = 'iid', seed = 1,
                               cycle = DEFAULT_CYCLE, targets = null } = {}) {
  const rng = new Rng((((seed >>> 0) ^ MINUS7_SALT) >>> 0));
  const spread = slackModel === 'common' ? 0 : Math.round(slackMs / 3);
  let bot = null, proxy = null;
  const draw = (common) => slackModel !== 'iid'
    ? common + ms(rng.int(-spread, spread)) : ms(rng.int(-slackMs, slackMs));
  const jit = (rows) => {
    if (!slackMs) return rows;
    const common = slackModel !== 'iid' ? ms(rng.int(-slackMs, slackMs)) : 0;
    return rows.map(([fr, k, a]) => [Math.max(0, fr + draw(common)), k, a])
      .sort((x, y) => x[0] - y[0]);
  };
  return {
    name: 'minus7', version: 1, observation: 'truth',
    // The slack is applied to this policy's own plan rows, above; the adapter
    // must not shift them a second time.
    ownSlack: true, slackMs,
    reset(api) {
      proxy = {
        bb: { inOpening: false, stage: 0 },
        get frame() { return api.frame; },
        press(a) { api.press(api.frame, a); },
        release(a) { api.release(api.frame, a); },
      };
      bot = new Bot(proxy, cycle, targets);
      bot.plan = jit(bot.plan);
      for (const name of ['cycle', 'attack', 'recover']) {
        const base = Bot.prototype[name];
        bot[name] = (...args) => jit(base.apply(bot, args));
      }
      // phaseA() normally obtains its rows through this.cycle(). Supply the
      // untransformed base explicitly so its rows take exactly one draw, not
      // one here and one in cycle() -- model/reactive-pilot.mjs's own jitter path does the
      // same for the same reason.
      bot.phaseA = (a) => jit(Bot.prototype.phaseA.call(
        bot, a, Bot.prototype.cycle.call(bot, a)));
    },
    step(obs) {
      proxy.bb.inOpening = obs.bbInOpening;
      proxy.bb.stage = obs.bbStage;
      bot.step();
    },
  };
}

// Control C4: the same route with the three camera flashes deleted. Minus 7
// without its stun-lock should collapse; if it does not, the score is coming
// from somewhere other than the mechanism the strategy claims.
export const NO_STUN_CYCLE = DEFAULT_CYCLE.filter(
  ([fr, kind, act]) => !(act === 'light' && fr > 50));

// --------------------------------------------------------- Jason-style loop
// A coarse repeating phase: wind for most of it, then one office block that
// drops the monitor, flicks the mask, strobes the hall for Foxy, checks both
// vents, and goes back up. Reactions (blackout, a vent occupant) preempt the
// block, and the mask is verified and retried rather than assumed.
//
// [GUESS] The published description gives the phase length (~10 s) and the
// list of subroutines with "time gates near the beginning, middle and end",
// but not the offsets. The block below is ordered by what the ANDROID engine
// requires rather than by any observed PC timing: every office light is gated
// on `mask = 0` (g75/g84/g302/g304), so the flick has to finish before the
// hall strobe, and the strobe before the vent reads.
//
// [GUESS] `phaseMs` is a variant knob, not a tuning knob. 10000 is the
// documented phase. The 5000 variant exists because MINUS-7-STRATEGY.md §3
// gives Foxy's kill equation: D climbs one per second and the check at every
// 5 s interval needs D under 4, so ONE hall reset per 10 s cannot hold him on
// this model whatever the rest of the loop does. Both are reported.
export function jasonPolicy({ phaseMs = 10000, observation = 'belief' } = {}) {
  const BLOCK_MS = 1900;
  const MASK_HOLD = ms(5500);      // five continuous mask ticks + margin
  let anchor = 0, busyUntil = 0, verifyAt = -1, maskOffAt = -1;
  return {
    name: `jason-${phaseMs / 1000}s`, version: 1, observation,
    reset(api) {
      busyUntil = 0; verifyAt = -1; maskOffAt = -1;
      // The opening: the night starts with the monitor down, so the loop has
      // to establish its own precondition before the first office block.
      api.tap(ms(100), 'monitor');
      api.tap(ms(400), `cam:${C.BOX_CAM}`);
      api.press(ms(500), 'wind');
      anchor = ms(phaseMs);
    },
    step(obs, api) {
      const f = api.frame;

      // Act, then verify (the one habit the census singles out in Jason's
      // controller): a mask that did not go on is pressed again.
      if (verifyAt >= 0 && f >= verifyAt) {
        verifyAt = -1;
        if (!obs.maskOn) { api.tap(f, 'mask'); verifyAt = f + ms(400); }
      }

      const commit = (holdFrames) => {
        api.clear();
        api.tap(f + ms(30), 'mask');
        api.tap(f + ms(30) + holdFrames, 'mask');
        verifyAt = f + ms(30) + ms(400);
        maskOffAt = f + ms(30) + holdFrames;
        busyUntil = maskOffAt + ms(400);
        anchor = busyUntil;
      };

      // Emergency: the office blackout. Night 7's fuse is 45 frames.
      if (obs.blackout && !obs.maskOn && f >= maskOffAt) {
        commit(ms(5200));
        return;
      }
      // A vent read that came back occupied: mask until they leave.
      const fresh = (age) => age < ms(5000);
      if (f >= busyUntil && !obs.maskOn &&
          ((obs.ventLOccupied && fresh(obs.ventLAge)) ||
           (obs.ventROccupied && fresh(obs.ventRAge)))) {
        commit(MASK_HOLD);
        return;
      }
      if (f < busyUntil || f < anchor) return;

      // The office block. On PC the monitor and mask are hover positions and
      // so idempotent; on Android they are toggles, so each polarity change is
      // guarded by what the controller believes the state to be. That
      // translation is the one place this reimplementation cannot be literal.
      const a = anchor;
      if (obs.monUp) api.tap(a + ms(30), 'monitor');   // drop into the office
      if (!obs.maskOn) {
        api.tap(a + ms(400), 'mask');                  // clears office Golden Freddy
        api.tap(a + ms(560), 'mask');
      }
      api.hold(a + ms(830), ms(100), 'light');         // Foxy strobe
      api.hold(a + ms(1000), ms(250), 'ventR');        // right vent check
      api.hold(a + ms(1300), ms(250), 'ventL');        // left vent check
      api.tap(a + ms(1600), 'monitor');                // back up
      api.tap(a + ms(1820), `cam:${C.BOX_CAM}`);
      api.press(a + ms(BLOCK_MS), 'wind');
      api.release(a + ms(phaseMs), 'wind');
      anchor = a + ms(phaseMs);
    },
  };
}

// ----------------------------------------------- Shooter25-style priority machine
// Six states, the literal names and thresholds from the local reconstruction:
// Wind, Stalling, Checking, Blackout, Toy Bonnie, Vent Character. `value 0`
// is `Timer mod 5000`, so every gate below is expressed against the same
// five-second phase the engine's movement ticks run on.
//
// Faithful, extracted: the 2000 / 3000 (low-wind) raise gates, the 4800 drop
// gate with its 15-tick hall light, the box-full latch at counter >= 1950,
// the low-wind latch at music-button <= 200 (<= 400 in Vent Character), the
// Checking substate walk 0->1->2->3->4 with its 15-tick right and 10-tick
// left vent lights, Blackout's 305-loop mask, Toy Bonnie's 211-loop mask and
// 30-tick hall light, and Stalling's held right vent light.
//
// [GUESS] The reconstruction leaves three things unresolved and they are
// guessed here, marked at each site: how Wind re-enters Checking after the
// 21 s startup gate; what observation puts the machine into Vent Character
// (the extracted entries are debug key codes); and what "music button value"
// scales to. All three are noted in plans/11.
//
// NOT IMPLEMENTED, and recorded as such rather than approximated: the
// response-complete latch (flag 4) and the value-6 accumulator, whose
// complete role the extraction does not establish. In the mod they shortcut
// out of Checking substates 1 and 3; here the machine always completes its
// vent scan. Anything built on value 6 is therefore absent.
export function shooter25Policy({ observation = 'truth', hoistDanger = false } = {}) {
  const PHASE = C.s(5);
  let state = 'Wind', sub = 0, next = 0, boxFull = false;
  let maskSince = -1, windHeld = false, ventRUntil = -1, hallPhase = -1;
  return {
    name: hoistDanger ? 'shooter25-hoisted' : 'shooter25', version: 1, observation,
    reset() {
      state = 'Wind'; sub = 0; next = 0; boxFull = false;
      maskSince = -1; windHeld = false; ventRUntil = -1; hallPhase = -1;
    },
    step(obs, api) {
      const f = api.frame;
      // [DEVIATION, off by default] The extraction lists `in danger = 1 ->
      // Blackout` only inside `Checking`, so the literal machine cannot
      // answer a g718-721 forcedown blackout raised while it is winding.
      // Hoisting the test looks like the obvious repair and MEASURES WORSE
      // (plans/11): it is kept only as the control for that change, and the
      // literal reading is what `shooter25` runs.
      if (hoistDanger && obs.blackout && state !== 'Blackout' && state !== 'Toy Bonnie') {
        if (!obs.maskOn) { api.clear(); api.tap(f, 'mask'); maskSince = f; }
        state = 'Blackout'; sub = 0; next = f + 6;
        return;
      }
      if (f < next) return;
      const phaseMs = (f % PHASE) * 1000 / C.FPS;
      // `music box counter >= 1950` of 2000, and `music button value <= 200`
      // / `<= 400`. [GUESS] both counters are read as the box charge scaled
      // to 0..2000; the mod's two objects are not distinguished here.
      const counter = obs.box * 2000;
      if (counter >= 1950) boxFull = true;
      const lowWind = counter <= 200;

      const raise = () => {
        boxFull = false;          // "Panel state becomes 1: clear box-full latch"
        api.tap(f, 'monitor');
        api.tap(f + ms(250), `cam:${C.BOX_CAM}`);
        api.press(f + ms(330), 'wind');
        windHeld = true;
        next = f + ms(400);
      };
      // "Hall light for 15 ticks, request camera-down": the light goes on
      // while the panel is still up and is still held as the panel falls, so
      // the same contact is the camera light and then the hall light.
      const drop = (ticks) => {
        if (windHeld) { api.release(f, 'wind'); windHeld = false; }
        api.hold(f + ms(20), ticks * ms(16.66), 'light');
        api.tap(f + ms(50), 'monitor');
        next = f + ms(450);
      };
      const maskUp = () => { api.tap(f, 'mask'); maskSince = f; next = f + ms(220); };
      const maskDown = () => { api.tap(f, 'mask'); maskSince = -1; next = f + ms(300); };

      switch (state) {
        case 'Wind':
          if (obs.monUp && phaseMs >= 4800) { drop(15); state = 'Checking'; sub = 0; }
          // [GUESS] Wind re-enters Checking on the camera-down edge. The
          // extraction only proves the 21 s startup gate into Checking; a
          // Wind loop that never masks would hand Golden Freddy the night.
          else if (!obs.monUp && (phaseMs < 2000 || (lowWind && phaseMs < 3000))) raise();
          else next = f + 6;
          break;

        case 'Checking':
          if (obs.blackout) { state = 'Blackout'; if (!obs.maskOn) maskUp(); break; }
          if (sub === 0) {
            if (!obs.maskOn) maskUp();
            else if (obs.tbCue) { state = 'Toy Bonnie'; sub = 0; }
            else { maskDown(); sub = 1; }
          } else if (sub === 1) {
            api.hold(f, 15 * ms(16.66), 'ventR');
            next = f + 15 * ms(16.66) + 4; sub = 2;
          } else if (sub === 2) {
            if (obs.ventROccupied && obs.ventRAge < ms(1000)) { state = 'Vent Character'; sub = 0; }
            else { api.hold(f, 10 * ms(16.66), 'ventL'); next = f + 10 * ms(16.66) + 4; sub = 3; }
          } else {
            if (obs.ventLOccupied && obs.ventLAge < ms(1000)) { state = 'Vent Character'; sub = 0; }
            else { sub = 0; state = boxFull ? 'Stalling' : 'Wind'; }
          }
          break;

        case 'Blackout':
          // "the mask has remained fully up for at least 305 event loops"
          if (!obs.maskOn) maskUp();
          else if (f - maskSince >= 305) { maskDown(); state = 'Checking'; sub = 0; }
          else next = f + 6;
          break;

        case 'Toy Bonnie':
          if (!obs.maskOn) { api.hold(f, 10 * ms(16.66), 'light'); maskUp(); }
          else if (f - maskSince >= 211) {
            api.hold(f, 30 * ms(16.66), 'light'); maskDown(); state = 'Wind'; sub = 0;
          } else next = f + 6;
          break;

        case 'Vent Character':
          // [GUESS] entered on a vent read rather than the mod's debug key.
          if (sub === 0) { api.hold(f, 10 * ms(16.66), 'light'); maskUp(); sub = 1; }
          else if (sub === 1) {
            if (f - maskSince >= 305) {
              api.hold(f, 20 * ms(16.66), 'light'); maskDown(); sub = 2;
            } else next = f + 6;
          } else {
            api.hold(f, 15 * ms(16.66), 'ventR');
            state = 'Wind'; sub = 0; next = f + 15 * ms(16.66) + 4;
          }
          break;

        case 'Stalling':
          // Sit out the rest of the five-second phase with the right vent
          // light held -- the documented Toy Bonnie stall, and the engine
          // models exactly that gate (`entryGate === 'camsDown' &&
          // ventLightROn` blocks his hop) -- flashing the hall once past
          // phase 3000. The state ends at the phase boundary.
          if (phaseMs <= 400) { boxFull = false; state = 'Wind'; next = f + 6; break; }
          if (f >= ventRUntil) { api.hold(f, C.s(1), 'ventR'); ventRUntil = f + C.s(1) - 6; }
          if (phaseMs >= 3000 && hallPhase !== Math.floor(f / PHASE)) {
            hallPhase = Math.floor(f / PHASE);
            api.hold(f, 10 * ms(16.66), 'light');
          }
          next = f + 6;
          break;
      }
    },
  };
}

// ------------------------------------------- Couraeel-style emergency priority
// One urgency ladder re-evaluated every frame, an explicit commitment window
// so a chosen response is not re-decided mid-flight, and a camera patrol list.
// Nothing is anchored to a wall clock: every rung is a threshold, which is the
// property under test.
//
// [GUESS] The thresholds. The published description gives the SHAPE ("explicit
// urgency thresholds, prioritizes emergencies, alternates office checks and
// camera work, keeps a camera patrol list") and the recreation's numbers are
// properties of that recreation, so the values below are taken from this
// repository's own mechanics instead: the 400-frame camera stun sets the
// patrol deadline, Foxy's D equation sets the hall deadline, and the box
// drain/wind rates set the wind band. They are stated once here rather than
// searched.
export function couraeelPolicy({ observation = 'truth', inverted = false,
                                 hallEveryMs = 4600, name = null } = {}) {
  const PATROL = C.TARGET_CAMS;               // 10, 4, 7
  const PATROL_DEADLINE = C.s(6.0);           // stun is 400 frames = 6.66 s
  const HALL_DEADLINE = ms(hallEveryMs);      // D must be under 4 at each 5 s check
  const BOX_LOW = 0.45, BOX_OK = 0.92;
  const MASK_CAP = ms(6400);                  // five ticks can span 5.98 s
  let busy = 0, lastPatrol = -1e9, lastHall = -1e9, ventTurn = false;
  let maskUntil = -1e9, maskEarliest = -1e9, maskOffAt = -1e9;
  const truth = observation === 'truth';
  return {
    name: name ?? (inverted ? 'couraeel-inverted' : 'couraeel'), version: 1, observation,
    reset() {
      busy = 0; lastPatrol = -1e9; lastHall = -1e9; ventTurn = false;
      maskUntil = -1e9; maskEarliest = -1e9; maskOffAt = -1e9;
    },
    step(obs, api) {
      const f = api.frame;
      const maskForRef = (cap) => {
        api.clear();
        if (obs.monUp) api.tap(f, 'monitor');
        const on = f + (obs.monUp ? ms(420) : ms(30));
        api.tap(on, 'mask');
        maskEarliest = on + ms(420);
        maskUntil = on + cap;
        busy = maskUntil + ms(900);   // released early by the unmask branch
      };
      const fresh = (v, age) => v && age < C.s(5);
      const threatSeen = () => fresh(obs.ventLOccupied, obs.ventLAge) ||
        fresh(obs.ventROccupied, obs.ventRAge) || obs.blackout;

      // Coming off a mask is its own act. Minus 7 §6 spends the mask-off
      // animation on a held hall light for exactly this reason: the seconds
      // under the mask are seconds Foxy's D is uncovered, so the recovery
      // owns a hall reset rather than waiting for the next rung to notice.
      const unmask = (at) => {
        api.tap(at, 'mask');
        api.hold(at + ms(330), ms(100), 'light');
        lastHall = at + ms(330);
        maskOffAt = at; maskUntil = -1e9;
        busy = at + ms(520);
      };
      if (obs.maskOn && f >= maskEarliest && maskUntil > -1e8) {
        // Truth can watch the opening clear; belief cannot see past its own
        // mask, so it can only run the counter out. That difference is the
        // price of perception, not a different policy.
        if (f >= maskUntil || (truth && !threatSeen())) { unmask(f); return; }
        return;
      }
      // True preemption. The 45-frame office fuse (50 on nights 5-6) leaves
      // about 630 ms once the mask animation is paid for, and a commitment
      // window measured in seconds swallows it. An "emergency priority"
      // policy that cannot interrupt itself is not one, so this rung is
      // tested above the commitment guard rather than inside the ladder.
      // `maskUntil < f` keeps this from re-arming every frame and clearing
      // the mask press it just scheduled.
      if (obs.blackout && !obs.maskOn && maskUntil < f && f >= maskOffAt + ms(400)) {
        maskForRef(MASK_CAP);
        return;
      }
      if (f < busy) return;

      const maskFor = maskForRef;
      // The office pass: drop, flick the mask off Golden Freddy, strobe the
      // hall for Foxy, optionally pay for one vent read, come back up. The
      // offsets are the trainer's own motor timings (C.CYCLE_SCRIPT) with the
      // mask-off -> flash gap widened from one frame to six: on Android every
      // office light is gated on `mask = 0` (g75/g84), and a one-frame margin
      // is precisely the precision dependence under test here.
      const officePass = (readVent) => {
        api.clear();
        if (obs.monUp) api.tap(f, 'monitor');
        const t = f;
        api.tap(t + ms(200), 'mask');
        api.tap(t + ms(350), 'mask');
        api.hold(t + ms(700), ms(100), 'light');
        if (readVent) api.hold(t + ms(830), ms(200), readVent);
        lastHall = t + ms(700);
        const up = t + (readVent ? ms(1070) : ms(870));
        api.tap(up, 'monitor');
        api.tap(up + ms(240), `cam:${C.BOX_CAM}`);
        api.press(up + ms(320), 'wind');
        busy = up + ms(380);
      };
      const patrol = () => {
        api.clear();
        if (!obs.monUp) api.tap(f, 'monitor');
        const t = f + (obs.monUp ? 0 : ms(230));
        PATROL.forEach((cam, i) => {
          api.tap(t + i * ms(190), `cam:${cam}`);
          api.hold(t + i * ms(190) + ms(50), ms(60), 'light');
        });
        api.tap(t + PATROL.length * ms(190), `cam:${C.BOX_CAM}`);
        api.press(t + PATROL.length * ms(190) + ms(90), 'wind');
        lastPatrol = t + (PATROL.length - 1) * ms(190);
        busy = t + PATROL.length * ms(190) + ms(140);
      };

      // ---- the ladder. Control C3 runs it upside down.
      const rungs = [
        // 1. the office blackout fuse (45 frames on night 7)
        () => (obs.blackout && !obs.maskOn && f >= maskOffAt + ms(400)) &&
          (maskFor(MASK_CAP), true),
        // 2. anyone standing in a vent opening, Balloon Boy included
        () => (!obs.maskOn && f >= maskOffAt + ms(400) &&
               (fresh(obs.ventLOccupied, obs.ventLAge) ||
                fresh(obs.ventROccupied, obs.ventRAge))) && (maskFor(MASK_CAP), true),
        // 3. Golden Freddy in the office: he kills on the next raise or flash
        () => (obs.gfPresent) && (officePass(null), true),
        // 4. Foxy: the hall has to be reset inside his equation's window.
        //    The pass alternates which vent it pays to read, so both openings
        //    are covered without doubling the office time.
        () => (f - lastHall >= HALL_DEADLINE) &&
          (ventTurn = !ventTurn, officePass(ventTurn ? 'ventL' : 'ventR'), true),
        // 5. the box
        () => (obs.box < BOX_LOW) && (
          (!obs.monUp ? (api.tap(f, 'monitor'), api.tap(f + ms(250), `cam:${C.BOX_CAM}`),
            api.press(f + ms(330), 'wind'), busy = f + ms(400))
            : (obs.cam !== C.BOX_CAM ? (api.tap(f, `cam:${C.BOX_CAM}`),
              api.press(f + ms(90), 'wind'), busy = f + ms(150))
              : (api.press(f, 'wind'), busy = f + ms(120)))), true),
        // 6. the stun clock on the three chokepoint rooms
        () => (f - lastPatrol >= PATROL_DEADLINE) && (patrol(), true),
        // 7. idle: keep winding
        () => {
          if (!obs.monUp) { api.tap(f, 'monitor'); api.tap(f + ms(250), `cam:${C.BOX_CAM}`);
            api.press(f + ms(330), 'wind'); busy = f + ms(400); return true; }
          if (obs.box < BOX_OK && !obs.winding) {
            if (obs.cam !== C.BOX_CAM) api.tap(f, `cam:${C.BOX_CAM}`);
            api.press(f + ms(90), 'wind'); busy = f + ms(150); return true;
          }
          busy = f + 6; return true;
        },
      ];
      const order = inverted ? [...rungs].reverse() : rungs;
      for (const rung of order) if (rung()) return;
    },
  };
}

// ------------------------------------------------------------------ controls
// C1: no inputs at all. Must be 0 on any night that can kill.
export const nullPolicy = () => ({
  name: 'null', version: 1, observation: 'truth', step() {},
});

// C2: a perfect music box and nothing else. If a policy's survival came from
// the box alone this would score, and it must not.
export const windOnlyPolicy = () => {
  let done = false;
  return {
    name: 'wind-only', version: 1, observation: 'truth',
    reset() { done = false; },
    step(obs, api) {
      if (done) return;
      done = true;
      api.tap(api.frame + ms(100), 'monitor');
      api.tap(api.frame + ms(400), 'cam:11');
      api.press(api.frame + ms(500), 'wind');
    },
  };
};

// Each entry is `(seed, slackMs) -> policy`. Only the Minus 7 control reads
// either: it needs the seed for its own error stream and the slack because it
// shifts plan rows rather than dispatch frames.

/**
 * A Golden Freddy guard, wrapped around any of the families above.
 *
 * Measured 2026-09-20: `minus7` and `couraeel` clear FNaF 2 nights 1-5 and
 * then score **0/3000 on nights 6 and 7**, and it is one mechanic, not luck.
 * Golden Freddy accounts for ~96% of every night-6/7 loss across every family.
 *
 * He does not kill on his own. He kills when the player **flashes the hall or
 * raises the monitor while he is in the office** (g690, g701, g727, g1292),
 * and `maskFullyOn` is his only dismissal (g776: `yellowbear` present AND
 * `mask` = 2 fades and destroys him). The baseline families keep to a fixed
 * cycle and never check, so they walk into him on a timer.
 *
 * The community rule is exactly "if Golden Freddy appears, put the mask on",
 * and it is observation-legal: `gfPresent` in belief mode is
 * `!camsUp && !maskOn && gf.present` -- what a player can actually see, since
 * he is rendered in the office. This wrapper does nothing else: it defers to
 * the wrapped family on every frame he is absent.
 */
export function goldenGuard(inner, { observation = null } = {}) {
  let holdUntil = -1e9;
  return {
    name: `${inner.name}+gf`,
    version: 1,
    observation: observation ?? inner.observation,
    reset() { if (inner.reset) inner.reset(); holdUntil = -1e9; },
    step(obs, api) {
      const f = api.frame;
      if (obs.gfPresent && !obs.maskFullyOn) {
        api.clear();
        if (obs.monUp) api.tap(f, 'monitor');
        api.tap(f + (obs.monUp ? ms(420) : ms(30)), 'mask');
        holdUntil = f + ms(900);
        return;
      }
      if (f < holdUntil && !obs.maskFullyOn) return;
      holdUntil = -1e9;
      inner.step(obs, api);
    },
  };
}

export const POLICIES = {
  minus7: (seed, slackMs, slackModel) => minus7Policy({ seed, slackMs, slackModel }),
  'minus7-no-stun': (seed, slackMs, slackModel) =>
    minus7Policy({ seed, slackMs, slackModel, cycle: NO_STUN_CYCLE, targets: [] }),
  'jason-10s': () => jasonPolicy({ phaseMs: 10000 }),
  'jason-5s': () => jasonPolicy({ phaseMs: 5000 }),
  'jason-5s-truth': () => jasonPolicy({ phaseMs: 5000, observation: 'truth' }),
  shooter25: () => shooter25Policy(),
  'shooter25-belief': () => shooter25Policy({ observation: 'belief' }),
  'shooter25-hoisted': () => shooter25Policy({ hoistDanger: true }),
  couraeel: () => couraeelPolicy(),
  'couraeel-2x': () => couraeelPolicy({ hallEveryMs: 2400, name: 'couraeel-2x' }),
  'couraeel-2x-belief': () => couraeelPolicy({ hallEveryMs: 2400, observation: 'belief', name: 'couraeel-2x-belief' }),
  'couraeel-belief': () => couraeelPolicy({ observation: 'belief' }),
  'couraeel-inverted': () => couraeelPolicy({ inverted: true }),
  null: nullPolicy,
  'wind-only': windOnlyPolicy,
  // The same families with the Golden Freddy rule added, which is the one
  // thing standing between them and nights 6 and 7.
  'minus7+gf': (seed, slackMs, slackModel) =>
    goldenGuard(minus7Policy({ seed, slackMs, slackModel })),
  'couraeel+gf': () => goldenGuard(couraeelPolicy()),
  'couraeel-belief+gf': () => goldenGuard(couraeelPolicy({ observation: 'belief' })),
  'shooter25+gf': () => goldenGuard(shooter25Policy()),
};
