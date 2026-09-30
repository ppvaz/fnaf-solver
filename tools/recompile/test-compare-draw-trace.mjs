import assert from 'node:assert/strict';
import { compareTrace } from './compare-draw-trace.mjs';
import { drawTrace } from './model-draw-trace.mjs';
import { AI_DIALS, Rng } from '@sixam/core/mechanics';

const settings = { night: 1, seed: 24850, frame: 3, frames: 20 };
const originalNext = Rng.prototype.next;
const model = drawTrace(settings);
assert.equal(Rng.prototype.next, originalNext);
assert.equal(model.out[0].draws, 1);
assert.equal(model.out[0].state, 63455);
assert.throws(() => drawTrace({ ...settings, modelOptions: { seed: 7 } }), /sourced/);
assert.throws(() => drawTrace({ ...settings, modelOptions: { sourcedUnconditionalDraws: 'yes' } }), /sourced/);
assert.throws(() => drawTrace({ ...settings, modelOptions: { sourcedFoxyChain: true } }), /requires/);
assert.equal(Rng.prototype.next, originalNext);
assert.equal(drawTrace({ ...settings, modelOptions: { sourcedFoxyChain: true, sourcedDropLightOrder: true } }).out[0].draws, 0);
const header = '# frame tick draws graine values...\n# frame 3 seeded 24850\n';
const rows = model.out.slice(1).map((row, tick) => `3 ${tick} ${row.draws} ${row.state}\n`).join('');
const exact = compareTrace(header + rows, settings);
assert.equal(exact.status, 'MATCHED_PREFIX');
assert.equal(exact.alignments[1].compared, 20);
assert.equal(exact.alignments[1].firstMismatch, null);
const changedGlobals = compareTrace(header + rows.replace(/^3 0 (\d+) (\d+)/, '3 0 $1 $2 999'), settings);
assert.equal(changedGlobals.runtime.drawTraceSha256, exact.runtime.drawTraceSha256);
assert.notEqual(changedGlobals.runtime.traceSha256, exact.runtime.traceSha256);
assert.equal(compareTrace('# frame 1 seeded 24850\n1 0 0 24850\n', settings).status, 'TARGET_NOT_REACHED');
assert.equal(compareTrace(header + rows.split('\n')[0] + '\n', settings).status, 'INCOMPLETE');
assert.equal(compareTrace(header.replace('24850', '7') + rows, settings).status, 'INVALID_COMPARISON');
assert.equal(compareTrace(header + rows + header + rows, settings).status, 'INVALID_COMPARISON');
const divergent = compareTrace(header + rows.replace(/^3 0 \d+ \d+/, '3 0 2 0'), settings);
assert.equal(divergent.status, 'DIVERGENT');
assert.equal(divergent.alignments[1].firstMismatch.tick, 0);
// A mismatch on the last update of a visit the rebuild left is the terminal loop; the same
// mismatch where the harness merely stopped is a divergence.
const lastRow = rows.trimEnd().split('\n').length - 1;
const endMismatch = rows.replace(new RegExp(`^3 ${lastRow} \\d+ \\d+`, 'm'), `3 ${lastRow} 999 1`);
const left = compareTrace(header + endMismatch + '# frame 4 seeded 24850\n4 0 0 1\n', settings);
assert.equal(left.status, 'MATCHED_TO_TERMINAL_LOOP');
assert.equal(left.alignments[1].firstMismatch.tick, lastRow);
assert.equal(compareTrace(header + endMismatch, settings).status, 'DIVERGENT');
assert.throws(() => compareTrace(header + rows.trimEnd(), settings), /truncated/);
assert.throws(() => compareTrace(header + '3 1 0 24850\n', settings), /interleaved/);
// A Custom Night names all ten dials, on night 7 only, and the model plays that vector.
const zero = Object.fromEntries(AI_DIALS.map((id) => [id, 0]));
assert.throws(() => compareTrace(header + rows, { ...settings, customNight: zero }), /requires night 7/);
const { golden, ...nine } = zero;
assert.throws(() => compareTrace(header + rows, { ...settings, night: 7, customNight: nine }), /each of/);
assert.throws(() => compareTrace(header + rows, { ...settings, night: 7, customNight: { ...zero, foxy: 21 } }), /0-20/);
// Over 3000 frames the all-zero dials end on the Puppet (frame 1540) and the 10/20 table on Foxy (1200).
const custom = { ...settings, night: 7, frames: 3000, customNight: zero };
const customModel = drawTrace(custom);
const customRows = customModel.out.slice(1).map((row, tick) => `3 ${tick} ${row.draws} ${row.state}\n`).join('');
const customResult = compareTrace(header + customRows, custom);
assert.equal(customResult.status, 'MATCHED_PREFIX');
assert.deepEqual(customResult.scope.customNight, zero);
assert.equal(customResult.model.death.reason, 'puppet');
assert.equal(compareTrace(header + customRows, { ...custom, customNight: null }).model.death.reason, 'foxy',
  'the dials reach the model: the 10/20 table plays a different night');
assert.equal(compareTrace(header + rows, settings).scope.customNight, undefined, 'story nights carry no dial vector');
console.log('PASS recompile comparison: exact prefix, mismatch, terminal loop, absent/short target, wrong seed, repeated visit, truncated trace and Custom Night dials (FIXTURE)');
