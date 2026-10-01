// The Sim observer draws its noise only from the generator the caller passes.
// Until 2026-09-30 an observer with a rate above zero and no generator fell
// back to Math.random() in silence, so one seed could give two nights; now the
// constructor refuses it, and tools/architecture-test.ts tolerates no ambient
// draw in the observer.
import assert from 'node:assert/strict';
import { Rng, Sim } from '@sixam/source/fnaf2';
import { Observer } from '@sixam/play/sim';

const RATES = ['dropRate', 'audioDropRate', 'audioFalseNegativeRate', 'audioFalsePositiveRate',
  'mangleAudioDropRate', 'mangleAudioFalseNegativeRate', 'mangleAudioFalsePositiveRate'];

// Each rate above zero without a generator is refused by name (a Mangle rate
// defaults to its audio rate, so setting an audio rate names both).
for (const rate of RATES)
  assert.throws(() => new Observer({ [rate]: 0.25 }),
    (error: any) => new RegExp(`\\b${rate}\\b`).test(error.message) && /above zero needs a seeded rng/.test(error.message), rate);
assert.throws(() => new Observer({ dropRate: 0.25, rng: {} }), /needs a seeded rng/, 'an rng without next()');

// With Math.random() stubbed to throw around the frames the observer reads. (A
// Sim is built outside the stub: defaultSimOptions draws its natural seed even
// when a seed is passed, which is Source's tolerated draw, not the observer's.)
const withoutAmbient = (frames) => {
  const random = Math.random;
  Math.random = () => { throw new Error('ambient draw'); };
  try { return frames(); } finally { Math.random = random; }
};

// A night with every rate at zero needs no generator and draws nothing.
{
  const quiet = new Observer({ interval: 1 });
  const sim = new Sim({ seed: 11, night: 3 });
  withoutAmbient(() => { for (let f = 0; f < 600; f += 1) { sim.tick(); quiet.read(sim); } });
}

// A noisy observer replays: the same seeded stream gives the same facts, frame for frame.
const noisyNight = (seed) => {
  const observer = new Observer({ interval: 1, dropRate: 0.3, audioDropRate: 0.2, audioFalseNegativeRate: 0.2,
    audioFalsePositiveRate: 0.05, rng: new Rng(seed ^ 0x9e3779b9) });
  const night = new Sim({ seed, night: 5 });
  return withoutAmbient(() => {
    const facts = [];
    for (let f = 0; f < 1200; f += 1) { night.tick(); facts.push(JSON.stringify(observer.read(night))); }
    return facts;
  });
};
const first = noisyNight(24850);
assert.deepEqual(noisyNight(24850), first, 'the same seed gives the same observations');
assert.ok(first.some(line => line.includes('"UNKNOWN"')), 'the drop rate was exercised');
console.log(`observer entropy: ${RATES.length} noise rates each refused without a seeded rng, a quiet night draws nothing, and a noisy night replays frame for frame with Math.random() stubbed to throw`);
