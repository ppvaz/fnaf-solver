#!/usr/bin/env node
// No-device regression for audio-probe.mjs: argument refusals and the probe
// row, which carries derived numbers only.
import assert from 'node:assert/strict';
import { parseArgs, probeRow } from './audio-probe.mjs';

assert.deepEqual(parseArgs(['--seconds', '8', '--scope', 'fnaf2-rebuild', '--label', 'switch-on']),
  { seconds: 8, scope: 'fnaf2-rebuild', label: 'switch-on', out: null });
assert.equal(parseArgs(['--seconds', '3']).scope, 'target', 'the default scope is the named target');
for (const bad of [[], ['--seconds', '0'], ['--seconds', '31'], ['--seconds', '2.5'],
  ['--seconds', '3', '--scope', 'Bad Scope'], ['--seconds', '3', '--label', 'a b'], ['--seconds', '3', '--pcm']])
  assert.throws(() => parseArgs(bad), `refuses ${bad.join(' ')}`);

const done = probeRow({ audioProbe: 'DONE', scope: 'org.fnaf2rebuild.play', rateHz: '48000', channels: '2',
  seconds: '8.00', frames: '384000', rmsDbfs: '-31.4', peakDbfs: '-7.9', activeFraction: '0.412', onsets: '5',
  onsetMs: '610,1820,3010,4400,6120' }, { label: 'switch-on' });
assert.equal(done.onsets, 5);
assert.deepEqual(done.onsetMs, [610, 1820, 3010, 4400, 6120]);
assert.equal(done.rateHz, 48000);
assert.equal(done.schema, 'companion-audio-probe-v1');
assert.equal(done.label, 'switch-on');
const silent = probeRow({ audioProbe: 'DONE', scope: 'all', onsets: '0', onsetMs: 'NONE', activeFraction: '0.000' });
assert.deepEqual(silent.onsetMs, []);
assert.equal(silent.onsets, 0, 'a silent capture is zero onsets, reported as such');
const refused = probeRow({ audioProbe: 'ERROR', scope: 'target', reason: 'audio-record-permission' });
assert.equal(refused.state, 'ERROR');
assert.equal(refused.reason, 'audio-record-permission');
assert.throws(() => probeRow({ audioProbe: 'DONE', onsetMs: '12,x' }), /malformed/);
for (const key of Object.keys(done)) assert.ok(!/pcm|sample(s)?$|wav|audio$/i.test(key), `no audio field: ${key}`);

console.log('audio probe: arguments refuse, rows carry derived numbers only, silence and refusal are explicit');
