// Phone-free checks for the stock-APK seed recovery helpers.
import assert from 'node:assert/strict';
import { Rng, SEED_SPACE, filterSeedCandidatesByEvents, filterSeedCandidatesByRolls, nextRngState, seedCandidatesFromTimeWindow, seedCandidatesFromHostMarker, seedFromDeviceTimeMs } from '@sixam/source/fnaf2';
import { LEGACY_SIM_OPTIONS } from '../src/games/fnaf2/plant-options.ts';

assert.equal(seedFromDeviceTimeMs(0), 0);
assert.equal(seedFromDeviceTimeMs(65535), 65535);
assert.equal(seedFromDeviceTimeMs(65536), 0);
assert.throws(() => seedFromDeviceTimeMs(-1), /device time must be an integer/);

const wrapped = seedCandidatesFromTimeWindow({ startMs: 65534, endMs: 65537 });
assert.deepEqual(wrapped.candidates, [
  { seed: 65534, timestampMs: 65534 },
  { seed: 65535, timestampMs: 65535 },
  { seed: 0, timestampMs: 65536 },
  { seed: 1, timestampMs: 65537 },
]);
assert.equal(wrapped.complete, false);
assert.equal(seedCandidatesFromTimeWindow({ startMs: 0, endMs: SEED_SPACE }).candidates.length,
  SEED_SPACE);
const markerWindow = seedCandidatesFromHostMarker({
  hostMarkerMs: 1_000_000,
  clockSample: { status: 'READY', offsetMs: 12.25, uncertaintyMs: 2 },
  markerUncertaintyMs: 3,
});
assert.equal(markerWindow.estimatedDeviceMs, 1_000_012);
assert.equal(markerWindow.uncertaintyMs, 6);
assert.equal(markerWindow.candidates.length, 13);

const knownSeed = 0x1234;
const reference = new Rng(knownSeed);
const observations = [];
for (const bound of [20, 500, 2, 20]) {
  const state = reference.next();
  observations.push({ bound, result: Math.floor(state * bound) });
}
const rollResult = filterSeedCandidatesByRolls({
  candidates: Array.from({ length: SEED_SPACE }, (_, seed) => seed),
  observations,
});
assert.deepEqual(rollResult.candidates, [knownSeed]);
assert.equal(rollResult.consumedThroughDraw, 3);
assert.equal(nextRngState(0), 1);
assert.throws(() => filterSeedCandidatesByRolls({ candidates: [knownSeed], observations: [{ bound: 20 }] }),
  /needs result, outcome, or state/);

const eventResult = filterSeedCandidatesByEvents({
  candidates: [0, 1, 2],
  simOptions: { ...LEGACY_SIM_OPTIONS, night: 7, durationFrames: 700, lethal: false },
  observations: [{ event: 'foxy-arrive', frame: 600 }],
});
assert.deepEqual(eventResult.candidateSeeds, [0, 1, 2]);

const dataResult = filterSeedCandidatesByEvents({
  candidates: [0],
  simOptions: { ...LEGACY_SIM_OPTIONS, night: 7, durationFrames: 300, lethal: false },
  observations: [{ event: 'mangle-static', frame: 300,
    data: { context: 'cam11', present: true } }],
});
assert.deepEqual(dataResult.candidateSeeds, [0]);

const mismatch = filterSeedCandidatesByEvents({
  candidates: [0],
  simOptions: { ...LEGACY_SIM_OPTIONS, night: 7, durationFrames: 601, lethal: false },
  observations: [{ event: 'foxy-arrive', frame: 601 }],
});
assert.deepEqual(mismatch.candidateSeeds, []);

assert.throws(() => filterSeedCandidatesByEvents({
  candidates: Array.from({ length: 4097 }, (_, seed) => seed),
  observations: [{ event: 'win', frame: 0 }],
}), /maxCandidates/);

console.log('seed recovery: device-time windows, exact roll filtering, event replay, and bounds pass');
