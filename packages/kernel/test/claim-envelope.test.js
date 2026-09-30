// claim-envelope-v1's contract test: pins the shape a claim and a refusal take, and refuses what
// ADR 0002 and Plan 28 rule out -- a missing or bare-UNKNOWN label, a label outside the two closed
// enums, an UNKNOWN value the answer does not own up to in notMeasured, a field the contract does
// not name, a superseded claim that does not say by what. CONTRACT:claim-envelope-v1.
import assert from 'node:assert/strict';
import {
  CLAIM_ENVELOPE_SCHEMA, CLAIM_FIELDS, ENVELOPE_STATUSES, REFUSAL_FIELDS, REPOSITORY_TARGET, claimEnvelope, isEnvelopeLabel,
  isRefusal, refusalEnvelope, unknown, unknownsIn, validateClaimEnvelope, validateEnvelopeLabel,
} from '../src/index.js';

const refuses = (fn, pattern, what) => assert.throws(fn, error => error instanceof TypeError && pattern.test(error.message), what);

// The shape, pinned field for field.
assert.equal(CLAIM_ENVELOPE_SCHEMA, 'claim-envelope-v1');
assert.deepEqual([...CLAIM_FIELDS], ['schema', 'claim', 'label', 'target', 'cite', 'status', 'supersededBy', 'notMeasured', 'reproducer']);
assert.deepEqual([...REFUSAL_FIELDS], ['schema', 'refused', 'rule', 'because', 'cite', 'remedy']);
assert.deepEqual([...ENVELOPE_STATUSES], ['standing', 'superseded', 'retracted']);
for (const list of [CLAIM_FIELDS, REFUSAL_FIELDS, ENVELOPE_STATUSES]) assert.ok(Object.isFrozen(list));
assert.equal(REPOSITORY_TARGET, 'repository');

// A golden claim: Plan 28's example in kernel labels.
const golden = {
  schema: 'claim-envelope-v1',
  claim: { night: 6, reached: 'SixAM' },
  label: 'DEVICE_MEASURED',
  target: 'com.scottgames.fnaf2@2.0.7+26',
  cite: ['docs/evidence/runs/night6-n6h2-01-20260920T024030Z/pack.json', 'commit:e14ce7b'],
  status: 'standing',
  supersededBy: null,
  notMeasured: ['reliability: one clear is not a rate'],
  reproducer: 'npm run evidence -- show night6-n6h2-01-20260920T024030Z',
};
assert.equal(validateClaimEnvelope(golden), golden);
const { schema: _schema, ...fields } = golden;
assert.deepEqual(claimEnvelope(fields), golden, 'the constructor adds the schema and nothing else');
assert.ok(!isRefusal(golden));

// Labels: a ClaimLevel, a named SourceLabel, or UNKNOWN(reason) -- never a default, never bare.
for (const label of ['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED', 'SOURCED', 'CALIBRATED', 'MEASURED', 'INFERRED', 'MODEL'])
  assert.equal(validateClaimEnvelope({ ...golden, label }).label, label);
const why = unknown('a coverage map joins several labels');
assert.equal(validateClaimEnvelope({ ...golden, label: why }).label, why);
assert.ok(isEnvelopeLabel(why) && !isEnvelopeLabel('UNKNOWN') && !isEnvelopeLabel('WIN'));
refuses(() => validateEnvelopeLabel(undefined), /needs a label/, 'a missing label');
refuses(() => validateClaimEnvelope({ ...golden, label: 'UNKNOWN' }), /needs its reason/, 'a bare UNKNOWN label');
refuses(() => validateClaimEnvelope({ ...golden, label: 'PASS' }), /ClaimLevel, a SourceLabel/, 'a label outside the enums');
refuses(() => validateClaimEnvelope({ ...golden, label: { kind: 'UNKNOWN' } }), /ClaimLevel, a SourceLabel/, 'an UNKNOWN with no reason');
const { label: _label, ...unlabelled } = golden;
refuses(() => validateClaimEnvelope(unlabelled), /missing label/, 'a claim with no label field');

// An answer that carries UNKNOWN names what it does not measure.
const partial = { ...golden, claim: { night: 6, deathAt: unknown('the executor never reads it') }, notMeasured: [] };
refuses(() => validateClaimEnvelope(partial), /claim\.deathAt/, 'a kernel UNKNOWN nobody owns up to');
refuses(() => validateClaimEnvelope({ ...partial, claim: { anchor: 'UNKNOWN(not-traced)' } }), /claim\.anchor/,
  "a catalog-style UNKNOWN(reason) nobody owns up to");
assert.equal(validateClaimEnvelope({ ...partial, notMeasured: ['the death time'] }).notMeasured.length, 1);
assert.deepEqual(unknownsIn({ a: [1, 'UNKNOWN'], b: { c: why } }), [{ path: 'a[1]', reason: null }, { path: 'b.c', reason: why.reason }]);
assert.deepEqual(unknownsIn('UNKNOWN(no-effect-reader)'), [{ path: '', reason: 'no-effect-reader' }]);
assert.deepEqual(unknownsIn({ note: 'the word UNKNOWN inside text is not a value' }), []);

// Target, citations, status, reproducer.
for (const target of ['com.scottgames.fnaf2', 'com.scottgames.fivenightsatfreddys', 'repository', why])
  assert.equal(validateClaimEnvelope({ ...golden, target }).target, target);
refuses(() => validateClaimEnvelope({ ...golden, target: 'FNaF 2' }), /target/, 'a target that is not a package');
refuses(() => validateClaimEnvelope({ ...golden, cite: [] }), /cite/, 'an answer that cites nothing');
refuses(() => validateClaimEnvelope({ ...golden, cite: ['a path with spaces'] }), /cite/, 'a citation with whitespace');
assert.equal(validateClaimEnvelope({ ...golden, status: 'superseded', supersededBy: 'native-fps-regrade' }).status, 'superseded');
assert.equal(validateClaimEnvelope({ ...golden, status: 'retracted' }).status, 'retracted');
assert.equal(validateClaimEnvelope({ ...golden, status: 'retracted', supersededBy: 'input-cancel-correction' }).status, 'retracted');
refuses(() => validateClaimEnvelope({ ...golden, status: 'superseded' }), /superseded it/, 'superseded by nothing');
refuses(() => validateClaimEnvelope({ ...golden, supersededBy: 'x' }), /standing claim/, 'a standing claim with a successor');
refuses(() => validateClaimEnvelope({ ...golden, status: 'open' }), /status/, 'a status outside the three');
refuses(() => validateClaimEnvelope({ ...golden, reproducer: '' }), /reproduces/, 'no reproducer');
refuses(() => validateClaimEnvelope({ ...golden, notMeasured: [''] }), /notMeasured/, 'an empty notMeasured item');
refuses(() => validateClaimEnvelope({ ...golden, claimLevel: 'DEVICE_MEASURED' }), /unexpected claimLevel/, 'a field the contract does not name');
refuses(() => validateClaimEnvelope({ ...golden, schema: 'claim-envelope-v2' }), /schema/, 'another schema');
refuses(() => validateClaimEnvelope({ ...golden, claim: undefined }), /carries its claim/, 'no claim');

// A refusal: rule, because, cite, remedy -- and nothing else.
const refusal = refusalEnvelope({ rule: 'seam-slack', because: 'plan clears MONITOR_MASK_READY_MS by 0 ms',
  cite: ['CLAUDE.md#mistake-7'], remedy: 'maskOffMs 9260 -> 9560' });
assert.deepEqual(refusal, { schema: 'claim-envelope-v1', refused: true, rule: 'seam-slack',
  because: 'plan clears MONITOR_MASK_READY_MS by 0 ms', cite: ['CLAUDE.md#mistake-7'], remedy: 'maskOffMs 9260 -> 9560' });
assert.ok(isRefusal(refusal));
refuses(() => validateClaimEnvelope({ ...refusal, remedy: '' }), /remedy/, 'a refusal with no remedy');
refuses(() => validateClaimEnvelope({ ...refusal, rule: 'Seam Slack' }), /kebab-case/, 'a rule that is not kebab-case');
refuses(() => validateClaimEnvelope({ ...refusal, label: 'MODEL' }), /unexpected label/, 'a refusal carrying a label');
refuses(() => validateClaimEnvelope({ ...refusal, refused: false }), /refused is true/, 'refused: false');
const { cite: _cite, ...uncited } = refusal;
refuses(() => validateClaimEnvelope(uncited), /missing cite/, 'a refusal that cites nothing');
refuses(() => validateClaimEnvelope(null), /object/, 'not an object');

console.log('claim-envelope-v1: the claim and refusal shapes are pinned, labels are the kernel enums or UNKNOWN(reason), ' +
  'and an UNKNOWN the answer does not name in notMeasured is refused');
