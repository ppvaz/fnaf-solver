// Plan 20 package 5 gate: compare a fixed schedule, a truth-state upper
// bound, and a belief-backed short-horizon controller on the exact engine.
// The scenario injects a sourced five-second blackout at a bounded decision
// boundary; it does not claim a full-night strategy or a device result.
import { readFileSync } from 'node:fs';
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Observer } from '@sixam/core/sensing';
import { Rng } from '@sixam/source/fnaf2';
import { CycleController, getCycle, makeUnknownFacts } from '@sixam/core/control';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const RUNS = 80;
const HORIZON = C.s(9);

const seedOf = index => (index * 2654435761) >>> 0;
const O = value => ({ state: 'OBSERVED', value });

function choose(controller, wanted) {
  return controller.plan({
    exactGate: cycle => ({ accepted: true, cycleId: cycle.id }),
    score: cycle => ({ risk: cycle.id === wanted ? 0 : 1,
      resourceMargin: cycle.id === wanted ? 10 : 0 }),
  });
}

// ---------------------------------------------------------------- contacts
// A cycle id names a reusable primitive, not one invocation. Releases survive
// preemption only for the exact invocation that put that exact contact down.
const contact = new CycleController({
  cycles: [getCycle('vent-stall-right'), getCycle('mask-now')],
});
contact.observe({ blackout: O(false), monitorUp: O(false), maskOn: O(false) },
  { frame: 0 });
const contactCommit = contact.commit(choose(contact, 'vent-stall-right'), { frame: 0 });
check(contact.outstandingHolds().length === 1,
  'committing a held primitive did not record its physical contact');
contact.observe({ blackout: O(true), monitorUp: O(false), maskOn: O(false) },
  { frame: 4 });
check(choose(contact, 'mask-now').selected === 'mask-now',
  'a blackout did not preempt the held idle primitive');
const preemptedRelease = contact.releaseDeferred(contactCommit.deferred[0], {
  frame: contactCommit.deferred[0].dueFrame,
});
check(preemptedRelease.accepted && contact.outstandingHolds().length === 0,
  'a preempted invocation could not release the contact it actually held');
check(!contact.releaseDeferred(contactCommit.deferred[0], {
  frame: contactCommit.deferred[0].dueFrame,
}).accepted, 'a duplicate release was accepted after its contact was already lifted');

const emergency = new CycleController({ cycles: [getCycle('vent-stall-right')] });
emergency.observe({ blackout: O(false), monitorUp: O(false), maskOn: O(false) },
  { frame: 0 });
const emergencyCommit = emergency.commit(choose(emergency, 'vent-stall-right'), { frame: 0 });
check(emergency.releaseDeferred(emergencyCommit.deferred[0], {
  frame: 4, emergency: true,
}).accepted && emergency.outstandingHolds().length === 0,
  'terminal cleanup could not release a held contact before its scheduled due frame');

// A later release from the same multi-action primitive must not match a
// contact that an earlier press/release pair already closed.
const stale = new CycleController({
  cycles: [getCycle('sweep-routes'), getCycle('lower-monitor')],
});
stale.observe({ blackout: O(false), monitorUp: O(true), maskOn: O(false) },
  { frame: 0 });
const sweep = stale.commit(choose(stale, 'sweep-routes'), { frame: 0 });
for (const atFrame of [2, 4, 6]) {
  const action = sweep.deferred.find(candidate => candidate.atFrame === atFrame);
  check(stale.releaseDeferred(action, { frame: atFrame }).accepted,
    `sweep action at ${atFrame} was unexpectedly refused`);
}
stale.observe({ blackout: O(true), monitorUp: O(true), maskOn: O(false) },
  { frame: 8 });
check(choose(stale, 'lower-monitor').selected === 'lower-monitor',
  'a blackout did not preempt the multi-action sweep');
const staleRelease = sweep.deferred.find(action =>
  action.kind === 'release' && action.action === 'light' && action.atFrame === 18);
check(!stale.releaseDeferred(staleRelease, { frame: 18 }).accepted,
  'a stale future release was allowed to lift a contact it never opened');

function score(cycle, hypothesis) {
  if (hypothesis.hazard === 'active') {
    return cycle.id === 'defensive-mask'
      ? { risk: 0, resourceMargin: 5, detail: 'mask before the blackout fuse' }
      : { risk: 1, resourceMargin: 0, detail: 'observation cycle leaves blackout unmasked' };
  }
  return cycle.id === 'observe-and-hold'
    ? { risk: 0, resourceMargin: 10, detail: 'no positive hazard fact' }
    : { risk: 0.25, resourceMargin: 0, detail: 'unneeded defensive mask cost' };
}

// Exact proof is deliberately outside CycleController. It gets a snapshot of
// the engine only as a proof oracle for the already-reviewed primitive; the
// controller itself sees facts and reduced state, never this object.
function exactCycleGate(sim, cycle) {
  // The observe primitive has no actions or state transition to replay. Its
  // exact proof is the empty trace; spending an engine snapshot on it would
  // obscure the controller comparison rather than strengthen the proof.
  if (cycle.id === 'observe-and-hold') return { accepted: true, cycleId: cycle.id };
  const copy = Sim.fromSnapshot(sim.opts, sim.snapshot());
  const origin = copy.frame;
  for (const action of cycle.actions) {
    const target = origin + action.atFrame;
    // `tick()` is a no-op once `won` is set and does not advance the frame,
    // so a target past `durationFrames` spins forever without this guard.
    while (copy.alive && !copy.won && copy.frame < target) copy.tick();
    if (!copy.alive) return { accepted: false, reason: 'exact-death-before-action' };
    copy[action.kind](action.action);
  }
  // For the defensive primitive, the exact obligation is local: the mask must
  // become fully on before the sourced blackout fuse expires. The remaining
  // five-second hold is a reviewed duration, not a reason to replay thousands
  // of identical no-threat frames for every idle decision.
  const end = origin + C.MASK_ANIM_ON + 2;
  while (copy.alive && !copy.won && copy.frame < end) copy.tick();
  return copy.alive || copy.won
    ? { accepted: true, cycleId: cycle.id }
    : { accepted: false, reason: `exact-death:${copy.death?.reason ?? 'unknown'}` };
}

function blackoutFacts(facts) {
  return {
    frame: facts.frame,
    blackout: facts.blackout,
    monitorUp: facts.monitorUp,
    maskOn: facts.maskOn,
  };
}

function runOne(index, mode, observerOptions = {}) {
  const seed = seedOf(index);
  const sim = new Sim({ night: 1, seed, durationFrames: HORIZON });
  const timing = new Rng(seed ^ 0x7f4a7c15);
  const blackoutFrame = C.s(1.5) + Math.floor(timing.next() * C.s(1));
  const observer = mode === 'oracle' || mode === 'open-loop' ? null : new Observer({
    interval: 4, rng: new Rng(seed ^ 0x9e3779b9), ...observerOptions,
  });
  const controller = mode === 'oracle' || mode === 'open-loop' ? null : new CycleController();
  let maskPresses = 0;
  let exactChecks = 0;

  while (sim.alive && !sim.won) {
    if (sim.frame === blackoutFrame) sim.startBlackout('synthetic-p5', null);

    if (mode === 'oracle') {
      // This is the upper bound only: it reads the exact hidden engine flag.
      if (sim.blackout.active && !sim.maskOn) sim.press('mask');
    } else if (mode !== 'open-loop') {
      const facts = blackoutFacts(observer.read(sim));
      const visible = mode === 'disabled' ? makeUnknownFacts(facts) : facts;
      // The watchlist is a four-frame decision cadence. Reading the cached
      // line every frame is fine, but feeding identical lines into a growing
      // belief trace is not a distinct observation.
      if (sim.frame % 4 === 0) {
        controller.observe(visible, { frame: sim.frame });
        const decision = controller.plan({
          exactGate: cycle => { exactChecks++; return exactCycleGate(sim, cycle); },
          score,
        });
        const committed = controller.commit(decision, { frame: sim.frame });
        for (const action of committed.actions) {
          if (action.action === 'mask' && action.kind === 'press') maskPresses++;
          sim[action.kind](action.action);
        }
      }
    }
    sim.tick();
  }
  return {
    won: sim.won,
    death: sim.death?.reason ?? null,
    maskPresses,
    exactChecks,
    decisions: controller?.decisions.length ?? 0,
  };
}

function cohort(mode, options = {}) {
  const result = { mode, won: 0, deaths: {}, maskPresses: 0, exactChecks: 0, decisions: 0 };
  for (let i = 0; i < RUNS; i++) {
    const run = runOne(i, mode, options);
    if (run.won) result.won++;
    if (run.death) result.deaths[run.death] = (result.deaths[run.death] ?? 0) + 1;
    result.maskPresses += run.maskPresses;
    result.exactChecks += run.exactChecks;
    result.decisions += run.decisions;
  }
  return result;
}

const oracle = cohort('oracle');
const openLoop = cohort('open-loop');
const disabled = cohort('disabled');
const estimator = cohort('estimator', { readDelayFrames: 8, dropRate: 0.2 });
// An intentionally harsh but finite observation control demonstrates that the
// estimator's result is not silently being equated with the oracle's upper
// bound. It is a sensitivity result, not a device calibration claim.
const stress = cohort('estimator', { readDelayFrames: 70, dropRate: 0.8 });

console.log(`cycle controller: ${RUNS} exact-engine blackout scenarios`);
for (const result of [openLoop, disabled, estimator, stress, oracle]) {
  console.log(`  ${result.mode.padEnd(9)} ${String(result.won).padStart(3)}/${RUNS}` +
    ` won, ${String(result.maskPresses).padStart(4)} mask presses,` +
    ` ${String(result.exactChecks).padStart(5)} exact checks`);
}

check(oracle.won === RUNS, 'truth-state oracle failed its upper-bound scenario');
check(openLoop.won === 0 && openLoop.maskPresses === 0,
  'fixed open-loop control acted or survived without a reaction');
check(disabled.won === 0 && disabled.maskPresses === 0,
  'observation-disabled control acted or survived without observations');
check(estimator.won > disabled.won,
  `estimator did not beat disabled control (${estimator.won} <= ${disabled.won})`);
check(estimator.exactChecks > 0 && estimator.decisions > 0,
  'estimator never exercised the planner or exact proof gate');
check(stress.won > disabled.won && stress.won < oracle.won,
  `stress result did not remain between disabled and oracle (${stress.won})`);
check(!/\bSim\b|engine\.js/.test(
  readFileSync(new URL('../src/control/cycle-controller.js', import.meta.url), 'utf8')),
  'production cycle controller contains a privileged exact-engine read');

console.log(`cycle controller: disabled ${disabled.won}/${RUNS}, ` +
  `estimator ${estimator.won}/${RUNS}, stress ${stress.won}/${RUNS}, ` +
  `oracle ${oracle.won}/${RUNS}; no privileged engine read in controller`);
