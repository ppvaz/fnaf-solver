// The four refusals Plan 28 found missing, each against a planted violation and a clean case.
//
// A checker that cannot refuse measures nothing, so every rule is first run on the move it exists
// to stop -- a win rate over 1200 seeds (Plan 05's old admission gate), SEAM_BANDS reused in the
// reverse order (the 2026-09-11 error of mistake 10), inputtrace.py proposed before the phone was
// asked (mistake 8), an UNKNOWN floor fed to arithmetic -- and must refuse it with a rule, a
// reason, a citation that resolves and a remedy. Then the clean case must pass. Every citation is
// read: the text each rule cites must still be in the file it names.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRefusal, unknown, validateClaimEnvelope } from '@sixam/kernel';
import { CAPABILITIES_SCHEMA, CHECKS, DIRECTIONAL_CONSTANTS, MISTAKE_ENTRIES, RULE_CITES, RULE_SOURCES, SEED_FLOOR,
  checkCapabilitiesFirst, checkDirectionalReuse, checkSeedFloor, checkUnknownAsNumber, numberKind } from '../src/refusals.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
// Whitespace is folded, so a cited sentence that wraps across lines still matches.
const read = path => readFileSync(join(ROOT, path), 'utf8').replace(/\s+/g, ' ');

const refusedBy = (result, rule, what) => {
  assert.ok(isRefusal(result), `${what} must be refused, got ${JSON.stringify(result)}`);
  validateClaimEnvelope(result);
  assert.equal(result.rule, rule, `${what}: refused by ${result.rule}, not ${rule}`);
  assert.deepEqual(result.cite, [...RULE_CITES[rule]], `${what} cites where ${rule} is written`);
  assert.ok(result.because.length > 10 && result.remedy.length > 10, `${what} says why and what to do`);
  return result;
};
const passes = (result, what) => {
  assert.equal(result.refused, false, `${what} must pass, got ${JSON.stringify(result)}`);
  assert.ok(Array.isArray(result.notMeasured), `${what} names what passing does not establish`);
  return result;
};

// Every citation resolves: the file exists and still holds the text the rule rests on.
for (const [rule, sources] of Object.entries(RULE_SOURCES)) {
  assert.ok(RULE_CITES[rule], `${rule} has citations`);
  for (const [path, text] of sources) assert.ok(read(path).includes(text), `${rule}: ${path} no longer holds "${text}"`);
  for (const cite of RULE_CITES[rule]) {
    const [path] = cite.split('#');
    assert.ok(sources.some(([source]) => source === path), `${rule}: the cite ${cite} is checked against its source`);
  }
}
for (const [number, lead] of Object.entries(MISTAKE_ENTRIES))
  assert.ok(read('CLAUDE.md').includes(`${number}. **${lead}**`), `CLAUDE.md mistake ${number} is still "${lead}"`);
assert.deepEqual(Object.keys(CHECKS).sort(), ['capabilities-first', 'directional-reuse', 'seed-floor', 'unknown-as-number']);

// --- seed-floor ------------------------------------------------------------------------------
assert.equal(SEED_FLOOR, 3000);
refusedBy(checkSeedFloor({ seeds: 1200, wins: 1200 }), 'seed-floor', 'a win rate over 1200 seeds (Plan 05\'s old gate)');
refusedBy(checkSeedFloor({ seeds: 2999, wins: 2999 }), 'seed-floor', 'one seed short of the floor');
refusedBy(checkSeedFloor({ seeds: unknown('the census log was not kept'), wins: 40 }), 'unknown-as-number', 'a rate over an unknown seed count');
refusedBy(checkSeedFloor({ seeds: 3000, wins: 3001 }), 'not-a-number', 'more wins than seeds');
refusedBy(checkSeedFloor({ seeds: '3000' }), 'not-a-number', 'a seed count written as text');
const floor = passes(checkSeedFloor({ seeds: 3000, wins: 2995 }), 'a rate over 3000 seeds');
assert.ok(floor.notMeasured.some(item => item.startsWith('a held-out seed block')), 'no held-out block named is said');
const exhaustive = passes(checkSeedFloor({ seeds: 65536, wins: 65536, heldOut: { start: 3000 } }), 'an exhaustive census');
assert.ok(!exhaustive.notMeasured.some(item => item.includes('outside the census')), 'an exhaustive census leaves no seed out');

// --- directional-reuse -----------------------------------------------------------------------
for (const [constant, entry] of Object.entries(DIRECTIONAL_CONSTANTS)) {
  assert.ok(read(entry.source).includes(entry.marker), `${constant}: ${entry.source} no longer holds "${entry.marker}"`);
  passes(checkDirectionalReuse({ constant, use: { first: entry.first, then: entry.then } }), `${constant} as measured`);
  refusedBy(checkDirectionalReuse({ constant, use: { first: entry.then, then: entry.first } }), 'directional-reuse', `${constant} in reverse`);
}
const reversed = refusedBy(checkDirectionalReuse({ constant: 'SEAM_BANDS', use: { first: 'monitor', then: 'mask' } }),
  'directional-reuse', 'the seam table read as a mask press after a monitor press (mistake 10)');
assert.match(reversed.because, /reverse order/);
refusedBy(checkDirectionalReuse({ constant: 'SEAM_BANDS', use: { first: 'mask', then: 'wind' } }), 'directional-reuse',
  'the seam table read for another pair of presses');
refusedBy(checkDirectionalReuse({ constant: 'SEAM_BANDS', measured: { first: 'monitor', then: 'mask' }, use: { first: 'monitor', then: 'mask' } }),
  'directional-reuse', 'a caller restating a registered direction wrongly');
refusedBy(checkDirectionalReuse({ constant: 'HALL_GAP_MS', use: { first: 'hall', then: 'mask' } }), 'directional-reuse',
  'an unregistered constant whose direction nobody states');
const stated = passes(checkDirectionalReuse({ constant: 'HALL_GAP_MS', measured: { first: 'hall', then: 'mask' }, use: { first: 'hall', then: 'mask' } }),
  'an unregistered constant used as the caller says it was measured');
assert.ok(stated.notMeasured.some(item => item.includes('no register holds it')));
refusedBy(checkDirectionalReuse({ constant: 'SEAM_BANDS' }), 'directional-reuse', 'a reuse that names no direction');

// --- capabilities-first ----------------------------------------------------------------------
const report = {
  schema: CAPABILITIES_SCHEMA, recordedAt: '2026-09-11',
  device: { serial: 'UNKNOWN', perfettoDataSources: ['android.inputmethod'] },
  instruments: [
    { tool: 'packages/play/bin/probe/inputtrace.py', needs: 'a Perfetto app input-dispatch data source (android.input.inputevent)',
      available: false, ifMissing: 'use the Companion native frame trace instead' },
    { tool: 'tools/device/actuation-frame-metric.py', needs: 'the Companion native frame trace', available: true },
    { tool: 'tools/device/input-frame-align.py', needs: 'both traces', available: null, ifMissing: 'alignment needs dispatch' },
    { tool: 'tools/device/run-timeline.py, grade-night.py, grade-minus7.py', needs: 'screenrecord', available: true },
  ],
};
refusedBy(checkCapabilitiesFirst({ instrument: 'packages/play/bin/probe/inputtrace.py' }), 'capabilities-first',
  'an input-dispatch trace proposed before the phone was asked (mistake 8)');
refusedBy(checkCapabilitiesFirst({ instrument: 'packages/play/bin/probe/inputtrace.py', capabilities: unknown('the phone was away') }),
  'capabilities-first', 'an UNKNOWN report');
refusedBy(checkCapabilitiesFirst({ instrument: 'packages/play/bin/probe/inputtrace.py', capabilities: { schema: 'something-else' } }),
  'capabilities-first', 'a report of another schema');
const missing = refusedBy(checkCapabilitiesFirst({ instrument: 'packages/play/bin/probe/inputtrace.py', capabilities: report }), 'capabilities-first',
  'an instrument the report says the phone cannot feed');
assert.equal(missing.remedy, 'use the Companion native frame trace instead', 'the report\'s own ifMissing is the remedy');
refusedBy(checkCapabilitiesFirst({ instrument: 'input-frame-align.py', capabilities: report }), 'capabilities-first',
  'an instrument whose need the report could not read');
passes(checkCapabilitiesFirst({ instrument: 'tools/device/actuation-frame-metric.py', capabilities: report }), 'an offered instrument');
passes(checkCapabilitiesFirst({ instrument: 'grade-night.py', capabilities: report }), 'one tool of a multi-tool entry, by name');
const unlisted = passes(checkCapabilitiesFirst({ instrument: 'tools/device/new-probe.py', capabilities: report }), 'an instrument the report does not list');
assert.ok(unlisted.notMeasured.some(item => item.includes('lists no entry')));

// --- unknown-as-number -----------------------------------------------------------------------
const kinds = [[400, 'number'], [unknown('not traced'), 'unknown'], ['UNKNOWN', 'unknown'], ['UNKNOWN(no-effect-reader)', 'unknown'],
  [{ kind: 'UNKNOWN' }, 'unknown'], [null, 'missing'], [undefined, 'missing'], [{ lo: 1, hi: 2 }, 'interval'], ['400', 'other'],
  [Number.NaN, 'other'], [Infinity, 'other']];
for (const [value, kind] of kinds) assert.equal(numberKind(value).kind, kind, `${String(value)} is ${kind}`);
const floorUnknown = refusedBy(checkUnknownAsNumber({ gap: 400, floor: unknown('the mask button was never traced') },
  { operation: 'the seam slack' }), 'unknown-as-number', 'an UNKNOWN floor subtracted from a gap');
assert.match(floorUnknown.because, /never traced/, 'the UNKNOWN\'s own reason is carried');
refusedBy(checkUnknownAsNumber({ gap: 400, floor: 'UNKNOWN' }), 'unknown-as-number', 'a bare UNKNOWN');
refusedBy(checkUnknownAsNumber({ gap: 400, floor: null }), 'unknown-as-number', 'a missing value');
refusedBy(checkUnknownAsNumber({ gap: 400, floor: { lo: 337, hi: 383 } }), 'not-a-number', 'an interval read as one number');
refusedBy(checkUnknownAsNumber({}), 'not-a-number', 'no operands');
passes(checkUnknownAsNumber({ gap: 400, floor: 383 }), 'two measured numbers');

console.log('refusals: seed-floor, directional-reuse, capabilities-first and unknown-as-number each refuse their planted ' +
  'violation with a citation that resolves, and pass the clean case');
