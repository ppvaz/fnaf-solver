import assert from 'node:assert/strict';
import {
  SCREEN_FNAF2_NIGHT, NIGHT_ONSET_HOLD_MS, NIGHT5_ANCHOR_AIM_MS,
  nightOnsetFromFrames, latchedNightOnsetMs, anchoredReleaseAt,
} from '@sixam/play/phone/night-onset';

const frames = (startMs: number, count: number, identity: number, stepMs = 1000 / 60) =>
  Array.from({ length: count }, (_, i) => ({ imageMs: startMs + i * stepMs, screenIdentity: identity }));

// A held run latches its first frame; the hold is image time, not frame count.
const held = [...frames(0, 20, 0), ...frames(20 * 1000 / 60, 40, SCREEN_FNAF2_NIGHT)];
const onset = nightOnsetFromFrames(held);
assert.equal(onset?.index, 20);
assert.equal(onset?.imageMs, held[20].imageMs);
assert.equal(onset?.priorIdentity, 0);
assert.ok(Math.abs(Number(onset?.resolutionMs) - 1000 / 60) < 1e-9);

// Shorter than the hold: no onset.
assert.equal(nightOnsetFromFrames(frames(0, 29, SCREEN_FNAF2_NIGHT)), null);

// A one-frame flicker is never the onset.
const flicker = [...frames(0, 5, 0), ...frames(100, 1, 2), ...frames(120, 2, 0), ...frames(160, 40, 2)];
assert.equal(nightOnsetFromFrames(flicker)?.imageMs, 160);

// The helper's field: absent or -1 is "not latched", anything else must be a positive integer.
assert.equal(latchedNightOnsetMs({}), null);
assert.equal(latchedNightOnsetMs({ nightOnsetImageNs: '-1' }), null);
assert.equal(latchedNightOnsetMs({ nightOnsetImageNs: '692812010513602' }), 692812010.513602);
assert.throws(() => latchedNightOnsetMs({ nightOnsetImageNs: 'x' }), /malformed/);
assert.throws(() => latchedNightOnsetMs({ nightOnsetImageNs: '0' }), /malformed/);

// Release: onset + aim when that is still ahead...
assert.deepEqual(
  anchoredReleaseAt({ onsetDeviceMs: 1000, deviceToHostOffsetMs: 5000, earliestHostMs: 6100 }),
  { releaseHostMs: 6233, k: 0, onsetHostMs: 6000 });
// ...otherwise the next whole second that is, never earlier than allowed.
assert.deepEqual(
  anchoredReleaseAt({ onsetDeviceMs: 1000, deviceToHostOffsetMs: 5000, earliestHostMs: 6750 }),
  { releaseHostMs: 7233, k: 1, onsetHostMs: 6000 });
assert.equal(anchoredReleaseAt({ onsetDeviceMs: 0, deviceToHostOffsetMs: 0, earliestHostMs: 1233 }).k, 1);
// The residue mod one second is always the aim.
for (const earliest of [0, 1, 999, 1234, 5000.5]) {
  const { releaseHostMs, onsetHostMs } = anchoredReleaseAt({ onsetDeviceMs: 0, deviceToHostOffsetMs: 0, earliestHostMs: earliest });
  assert.equal(((releaseHostMs - onsetHostMs) % 1000 + 1000) % 1000, NIGHT5_ANCHOR_AIM_MS);
  assert.ok(releaseHostMs >= earliest);
}
assert.throws(() => anchoredReleaseAt({ onsetDeviceMs: 0, deviceToHostOffsetMs: 0, aimMs: 1000, earliestHostMs: 0 }), RangeError);
assert.throws(() => anchoredReleaseAt({ onsetDeviceMs: NaN, deviceToHostOffsetMs: 0, earliestHostMs: 0 }), TypeError);
assert.equal(NIGHT_ONSET_HOLD_MS, 500);

console.log('night onset: held-run onset, flicker rejection, helper field and anchored release pass');
