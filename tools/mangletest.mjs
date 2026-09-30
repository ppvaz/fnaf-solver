// Mangle's audio-static detection and bounded response gate.
//
//   node tools/mangletest.mjs
//   node tools/mangletest.mjs --assert
//
// Mangle is intentionally not visually detected yet. The simulator emits the
// sourced s0020 static transition; Observer applies independent audio
// latency/drop/error modelling; MangleThreatReactive consumes only the office
// context, never the same static raised on CAM 11.
import * as C from '@sixam/source/fnaf2';
import { Sim } from '@sixam/source/fnaf2';
import { Observer } from '@sixam/play/sim';
import { MangleThreatReactive } from '@sixam/propose/fnaf2';

let failures = 0;
const ok = (what, condition) => {
  if (!condition) {
    failures++;
    console.error(`FAIL  ${what}`);
  } else {
    console.log(`ok    ${what}`);
  }
};

const O = value => ({ state: 'OBSERVED', value });

function isolateMangle(sim) {
  const mangle = sim.units.find(u => u.id === 'mangle');
  for (const unit of sim.units) if (unit !== mangle) unit.done = true;
  return mangle;
}

// --- 1. Observer: the two occurrences of the same static stay separated.
{
  const sim = new Sim({ seed: 1, night: 4, bbEnabled: false,
                        foxyEnabled: false, gfEnabled: false, boxEnabled: false });
  const mangle = isolateMangle(sim);
  mangle.idx = 1; // CAM 11 / Prize Corner, the winding camera
  const observer = new Observer({ interval: 60, audioLatencyFrames: 0 });

  sim.tick();
  let facts = observer.read(sim);
  ok('Mangle has no visual opening fact yet', facts.mangleOpening === undefined);
  ok('CAM 11 static is reported in its non-actionable audio context',
    facts.mangleStaticCam.state === 'OBSERVED' && facts.mangleStaticCam.value === true);
  ok('CAM 11 static does not become office static',
    facts.mangleStatic.state === 'OBSERVED' && facts.mangleStatic.value === false);

  mangle.idx = mangle.path.length - 1;
  mangle.atOpening = true;
  sim.tick();
  facts = observer.read(sim);
  ok('office/right-vent static is reported separately',
    facts.mangleStatic.state === 'OBSERVED' && facts.mangleStatic.value === true);
  ok('the old CAM 11 context clears when Mangle leaves that camera',
    facts.mangleStaticCam.state === 'OBSERVED' && facts.mangleStaticCam.value === false);

  const delayedSim = new Sim({ seed: 2, night: 4, bbEnabled: false,
                               foxyEnabled: false, gfEnabled: false, boxEnabled: false });
  const delayedMangle = isolateMangle(delayedSim);
  delayedMangle.atOpening = true;
  const delayed = new Observer({ interval: 60, audioLatencyFrames: 3 });
  facts = delayed.read(delayedSim);
  delayedSim.tick();
  facts = delayed.read(delayedSim);
  ok('office static onset is not visible before audio latency',
    facts.mangleStatic.state === 'OBSERVED' && facts.mangleStatic.value === false);
  delayedSim.tick(); delayedSim.tick(); delayedSim.tick();
  facts = delayed.read(delayedSim);
  ok('office static onset becomes present after modeled latency',
    facts.mangleStatic.state === 'OBSERVED' && facts.mangleStatic.value === true);

  const droppedSim = new Sim({ seed: 3, night: 4, bbEnabled: false,
                               foxyEnabled: false, gfEnabled: false, boxEnabled: false });
  isolateMangle(droppedSim).atOpening = true;
  droppedSim.tick();
  const dropped = new Observer({ interval: 60, audioLatencyFrames: 0,
                                 mangleAudioDropRate: 1, rng: { next: () => 0 } });
  const droppedFacts = dropped.read(droppedSim);
  ok('Mangle audio transport loss is UNKNOWN, not visual truth',
    droppedFacts.mangleStatic.state === 'UNKNOWN' &&
    droppedFacts.mangleStatic.reason === 'audio-dropped' &&
    droppedFacts.mangleStaticCam.state === 'UNKNOWN');

  const missedSim = new Sim({ seed: 4, night: 4, bbEnabled: false,
                              foxyEnabled: false, gfEnabled: false, boxEnabled: false });
  isolateMangle(missedSim).atOpening = true;
  missedSim.tick();
  const missed = new Observer({ interval: 60, audioLatencyFrames: 0,
                                mangleAudioFalseNegativeRate: 1,
                                rng: { next: () => 0 } });
  const missedFacts = missed.read(missedSim);
  ok('Mangle audio false negative stays safely absent',
    missedFacts.mangleStatic.state === 'OBSERVED' && missedFacts.mangleStatic.value === false);
}

// --- 2. Named controller: BB evidence and CAM 11 static cannot cross-trigger.
{
  const controller = new MangleThreatReactive({ phaseUncertaintyFrames: 0 });
  const facts = {
    mangleStatic: O(false),
    mangleStaticCam: O(true),
    leftOpening: O('threat'),
    maskOn: O(false),
    monitorUp: O(false),
    bbVent: O('opening'),
    bbVentId: O('bb-visit'),
  };
  const intents = controller.decide(facts, { frame: 0, scheduled: [] });
  ok('BB left/audio evidence and CAM 11 static do not trigger Mangle response',
    intents.length === 0);
  controller.settle(intents);

  const audioFacts = { ...facts, mangleStatic: O(true) };
  const pulse = controller.decide(audioFacts, { frame: 1, scheduled: [] });
  ok('office static triggers the shared pre-mask hall pulse',
    pulse.length === 1 && pulse[0].action === 'hall');
  controller.settle(pulse);
  const mask = controller.decide(audioFacts, { frame: 2, scheduled: [] });
  ok('office static then requests the mask',
    mask.length === 1 && mask[0].action === 'mask');
  controller.settle(mask);
}

// --- 3. Integration: office static detection -> mask -> five continuous ticks.
{
  const sim = new Sim({ seed: 7, night: 4, bbEnabled: false,
                        foxyEnabled: false, gfEnabled: false, boxEnabled: false,
                        durationFrames: C.s(20) });
  const mangle = isolateMangle(sim);
  mangle.idx = mangle.path.length - 1;
  mangle.atOpening = true;

  const observer = new Observer({ interval: 1, audioLatencyFrames: 0 });
  const controller = new MangleThreatReactive({ phaseUncertaintyFrames: 0 });
  let hallReactions = 0, maskReactions = 0, offReactions = 0;
  let decisionsSettled = true;
  for (let guard = 0; guard < C.s(20) && sim.alive && !sim.won; guard++) {
    const facts = observer.read(sim);
    const intents = controller.decide(facts, { frame: sim.frame, scheduled: [] });
    decisionsSettled = controller.settle(intents) && decisionsSettled;
    for (const intent of intents) {
      if (intent.at > sim.frame) continue;
      if (intent.action === 'hall') {
        hallReactions++;
        sim.press('light');
        sim.release('light');
      } else {
        if (intent.action === 'mask' && !sim.maskOn) maskReactions++;
        if (intent.action === 'mask' && sim.maskOn) offReactions++;
        sim.press(intent.action);
      }
    }
    sim.tick();
  }

  ok('Mangle response includes the Foxy-budget hall pulse', hallReactions === 1);
  ok('controller accepts every uncollided Mangle decision', decisionsSettled);
  ok('Mangle response turns the mask on once', maskReactions === 1);
  ok('Mangle response drops the mask after the hold', offReactions === 1);
  ok('five continuous mask ticks repel Mangle to her route',
    !mangle.atOpening && !mangle.inside && mangle.idx === mangle.repelIdx);
  ok('Mangle response returns to idle after static clears',
    controller.state === 'idle' && !controller.dead);
  ok('Mangle response does not kill the run', sim.alive);
}

if (process.argv.includes('--assert') && failures) process.exit(1);
console.log(failures ? `\n${failures} failure(s)` : '\nall Mangle checks passed');
