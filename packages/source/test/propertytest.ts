#!/usr/bin/env node
// Dependency-free bounded property checks for the engine invariants.
//
// This is intentionally a small local harness rather than a random-number
// package: the seed campaign is reproducible, and a failing seed is shrunk
// against the same bounded campaign before it is printed.
import assert from 'node:assert/strict';
import { Sim } from '@sixam/source/fnaf2';
import * as C from '@sixam/source/fnaf2';

const SEEDS = Array.from({ length: 64 }, (_, seed) => seed);
const HOLD_ACTIONS = new Set(['light', 'wind', 'ventL', 'ventR']);
const ACTIONS = [
  'monitor', 'mask', 'light', 'wind', 'ventL', 'ventR',
  'cam:4', 'cam:7', 'cam:10', 'cam:11',
];

function propertyOptions(seed) {
  return {
    seed,
    night: 4,
    lethal: false,
    durationFrames: C.HOUR_FRAMES * 7,
    record: false,
  };
}

function actionTrace(seed, length) {
  let state = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
  return Array.from({ length }, () => ({
    action: ACTIONS[next() % ACTIONS.length],
    ticks: 1 + (next() % 9),
  }));
}

function drive(sim, trace) {
  for (const { action, ticks } of trace) {
    sim.press(action);
    for (let tick = 0; tick < ticks; tick++) sim.tick();
    if (HOLD_ACTIONS.has(action)) sim.release(action);
  }
}

function minimalFailingSeed(seed, predicate) {
  for (const candidate of SEEDS) {
    if (candidate >= seed) break;
    if (predicate(candidate)) return candidate;
  }
  return seed;
}

function runProperty(name, property) {
  for (const seed of SEEDS) {
    try {
      property(seed);
    } catch (error) {
      const minimal = minimalFailingSeed(seed, candidate => {
        try {
          property(candidate);
          return false;
        } catch {
          return true;
        }
      });
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(name + ' failed at minimal seed ' + minimal + ': ' + detail);
    }
  }
}

function snapshotRoundTrip(seed) {
  const options = propertyOptions(seed);
  const trace = actionTrace(seed, 120);
  const continuation = actionTrace(seed ^ 0xa5a5a5a5, 100);
  const sim = new Sim(options);
  drive(sim, trace);
  const snapshot = sim.snapshot();
  const restored = Sim.fromSnapshot(options, snapshot);

  assert.deepStrictEqual(restored.snapshot(), snapshot,
    'restore changed the captured state');
  drive(sim, continuation);
  drive(restored, continuation);
  assert.deepStrictEqual(restored.snapshot(), sim.snapshot(),
    'restored continuation diverged from the original');
  assert.deepStrictEqual(restored.events, sim.events,
    'restored event trace diverged from the original');
}

function deterministicTrace(seed) {
  const options = propertyOptions(seed);
  const trace = actionTrace(seed ^ 0x13579bdf, 220);
  const first = new Sim(options);
  const second = new Sim(options);
  drive(first, trace);
  drive(second, trace);
  assert.deepStrictEqual(second.snapshot(), first.snapshot(),
    'same seed and actions produced different state');
  assert.deepStrictEqual(second.events, first.events,
    'same seed and actions produced different events');
}

function nightOneNeverArmsBalloonBoy(seed) {
  assert.equal(C.canAct(1, 'bb'), false,
    'the sourced Night-1 reachability table must exclude Balloon Boy');
  const sim = new Sim({
    seed,
    night: 1,
    lethal: false,
    durationFrames: C.HOUR_FRAMES * 6 + 1,
  });
  for (let hour = 0; hour < 6; hour++) {
    sim.applyAiHour(hour);
    assert.equal(sim.ai.bb, 0,
      'Balloon Boy AI became nonzero at hour ' + hour);
    for (let frame = 0; frame < C.HOUR_FRAMES; frame++) sim.tick();
  }
  assert.equal(sim.bb.stage, 0, 'Balloon Boy advanced on Night 1');
  assert.equal(sim.bb.inOpening, false, 'Balloon Boy reached the opening on Night 1');
  assert.equal(sim.bb.inside, false, 'Balloon Boy reached the office on Night 1');
  assert.equal(sim.events.some(event =>
    event.type === 'laugh' ||
    (event.data && event.data.who === 'bb')), false,
  'Balloon Boy emitted a route event on Night 1');
}

assert.equal(minimalFailingSeed(15, seed => seed === 4 || seed === 11), 4,
  'shrinker should return the first failing campaign seed');
assert.equal(minimalFailingSeed(0, () => true), 0,
  'shrinker should retain the original seed when no lower seed exists');

runProperty('snapshot/restore', snapshotRoundTrip);
runProperty('deterministic event trace', deterministicTrace);
runProperty('Night-1 reachability', nightOneNeverArmsBalloonBoy);

console.log('property checks: ' + SEEDS.length +
  ' seeds, snapshot identity, deterministic traces, and Night-1 reachability pass');
