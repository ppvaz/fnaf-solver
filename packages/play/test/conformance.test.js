/** Adapter conformance: the HID wire, the Cue Helper transport, clocks and the detection rules the campaign reads. */
import assert from 'node:assert/strict';
import { Clock } from '../src/phone/clocks.js';
import { HID_DESCRIPTOR, HidWireTransport, toRaw, report } from '../src/venues/phone/hid.js';
import { CueHelperControlTransport, parseCueResponse } from '../src/venues/phone/cue-helper.js';

assert.deepEqual(new Clock({ name: 'simulator-frame', read: () => 7 }).now(), { clock: 'simulator-frame', value: 7 });
assert.deepEqual(toRaw([2275, 685]), [877, 1023], 'HID transform must truncate at the adapter boundary');
assert.deepEqual(report([{ flags: 3, point: { x: 350, y: 615 } }]).slice(0, 7),
  [1, 1, 3, 9, 4, 157, 0], 'HID report must preserve contact flags and native transform');
assert.equal(HID_DESCRIPTOR.length, 124, 'HID descriptor must declare both contact identifiers');
assert.equal(report([{ flags: 0, point: { x: 350, y: 615 } }])[7], 4,
  'single-contact release must consume the inactive second contact record');
const lines = [];
const hid = new HidWireTransport({ write: async line => lines.push(JSON.parse(line)), ready: async () => {}, sleep: async () => {} });
await hid.send({ command: { action: { kind: 'press', control: 'cameraFeedLight', durationMs: 17 }, source: { controller: 'test' } }, point: { x: 900, y: 540 } });
assert.equal(lines[0].command, 'register');
assert.deepEqual(lines.filter(line => line.command === 'report').map(line => line.report[2]), [3, 0]);
await hid.abort();
assert.equal(lines.at(-1).report[1], 2, 'abort must emit a two-contact release');
assert.deepEqual(parseCueResponse('OK snapshotNs=3 ageUs=17 monitorUp=true'),
  { snapshotNs: '3', ageUs: '17', monitorUp: 'true' });
const cue = new CueHelperControlTransport({ token: '0123456789abcdef0123456789abcdef', request: request =>
  request.startsWith('GET ') ? 'OK snapshotNs=3 ageUs=17 monitorUp=true' : 'ERROR unsupported' });
assert.deepEqual(cue.monitorMeasurement(await cue.snapshot()),
  { signal: 'monitorUp', state: 'OBSERVED', value: true, confidence: 1 });
assert.equal(cue.monitorMeasurement({ ageUs: '900000', monitorUp: 'true' }).state, 'UNKNOWN');
const captureTiming = cue.visualAcquisition({ snapshotNs: '5000000000',
  visualCaptureNs: '4990000000', ageUs: '10000', seq: '12' });
assert.equal(captureTiming.at, 4990);
assert.equal(captureTiming.basis, 'image-timestamp');
assert.equal(captureTiming.sequence, 12);
const oldTiming = cue.visualAcquisition({ snapshotNs: '5000000000', ageUs: '10000', seq: '12' });
assert.equal(oldTiming.at, 4990);
assert.equal(oldTiming.uncertaintyMs, 0.001);

// FRAME (FNaF 2 legacy): snapshot fields and the grid from ONE device read. The
// helper emits the 180 cells as a single concatenated hex run, no separators;
// the 180-cell length decides.
const runCells = Array.from({ length: 180 }, (_, index) => (index << 8) | 0x11);
const runBody = runCells.map(cell => cell.toString(16).padStart(6, '0')).join('');
const framed = new CueHelperControlTransport({ token: '0123456789abcdef0123456789abcdef',
  request: request => request.startsWith('FRAME ')
    ? `OK snapshotNs=3 seq=42 ageUs=17 screen=FNAF2_NIGHT grid=20x9 cells=${runBody}`
    : 'ERROR unsupported' });
const oneRead = framed.frame();
assert.equal(oneRead.cells.length, 180);
assert.deepEqual([...oneRead.cells], runCells);
// One read means one frame: the sequence a detector correlates on is shared by
// construction, so grid-seq-mismatch cannot arise from the transport.
assert.equal(oneRead.seq, oneRead.gridSeq);
assert.equal(oneRead.screen, 'FNAF2_NIGHT');
// The retired GRID verb, the camera-selection and battery facts left the
// transport with the device fields they read (Companion 0.2.0).
for (const retired of ['grid', 'cameraMeasurement', 'cameraHighlightsMeasurement', 'batteryMeasurement'])
  assert.equal(typeof framed[retired], 'undefined', `${retired} is retired`);
for (const bad of [
  'OK snapshotNs=3 seq=42 grid=20x9 cells=deadbeef',
  'OK snapshotNs=3 seq=42 cells=' + runBody,
]) assert.throws(() => new CueHelperControlTransport({ token: '0123456789abcdef0123456789abcdef',
  request: () => bad }).frame(), /cue-helper frame/);
assert.throws(() => cue.visualAcquisition({ snapshotNs: '1', ageUs: '1', seq: '1' }), /invalid/);
assert.throws(() => cue.visualAcquisition({ snapshotNs: '5000000000',
  visualCaptureNs: '4990000000', ageUs: '1', seq: '12' }), /disagrees/);
console.log('adapter contracts: HID wire, Cue Helper transport, clock and detection rules pass');
