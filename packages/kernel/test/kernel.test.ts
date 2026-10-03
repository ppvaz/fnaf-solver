// The ADR 0002 kernel types with a consumer today: each validator accepts its shape and refuses
// what the ADR rules out -- an UNKNOWN without a reason, a label outside its closed enum, an
// outcome or annotation with a field the kernel does not name, complete custody that lost
// something, a superseded annotation that does not say by what.
import assert from 'node:assert/strict';
import {
  ANNOTATION_KINDS, ANNOTATION_STATUSES, CLAIM_LEVELS, CUSTODY_CLASSES, GAME_RUN_FIELDS, OUTCOME_KINDS, RUN_MODES,
  SOURCE_LABELS, SUBJECT_KINDS, aborted, death, interval, invalid, isClaimLevel, isSourceLabel, isUnknown, mulberry32, sixAm, timeout,
  unknown, validateAnnotation, validateClaimLevel, validateGameRun, validateInterval, validateOutcome, validateSourceLabel,
} from '../src/index.ts';

const refuses = (fn: () => unknown, pattern: RegExp, what: string) =>
  assert.throws(fn, error => error instanceof TypeError && pattern.test(error.message), what);

// Closed enums, frozen.
for (const list of [CLAIM_LEVELS, SOURCE_LABELS, OUTCOME_KINDS, RUN_MODES, CUSTODY_CLASSES, GAME_RUN_FIELDS,
  ANNOTATION_KINDS, ANNOTATION_STATUSES, SUBJECT_KINDS]) assert.ok(Object.isFrozen(list));
assert.deepEqual([...CLAIM_LEVELS], ['MODEL_ONLY', 'FIXTURE', 'DEVICE_MEASURED']);
assert.deepEqual([...SOURCE_LABELS], ['SOURCED', 'CALIBRATED', 'MEASURED', 'INFERRED', 'MODEL', 'UNKNOWN']);
assert.deepEqual([...OUTCOME_KINDS], ['SixAM', 'Death', 'Timeout', 'Aborted', 'Invalid', 'UNKNOWN']);
assert.deepEqual([...RUN_MODES], ['dry', 'shadow', 'replay', 'live']);
assert.deepEqual([...CUSTODY_CLASSES], ['complete', 'recovered']);
assert.deepEqual([...ANNOTATION_STATUSES], ['standing', 'superseded', 'retracted']);

// UNKNOWN is a value with a reason, never a default.
const why = unknown('the executor never reads it');
assert.ok(isUnknown(why) && Object.isFrozen(why));
refuses(() => unknown(''), /reason/, 'UNKNOWN without a reason');
assert.ok(!isUnknown({ kind: 'UNKNOWN' }) && !isUnknown('UNKNOWN') && !isUnknown({ kind: 'UNKNOWN', reason: 'x', extra: 1 }));

// The labels never promote one another: each is its own closed enum.
for (const level of CLAIM_LEVELS) assert.equal(validateClaimLevel(level), level);
assert.ok(!isClaimLevel('MEASURED') && !isClaimLevel('UNKNOWN') && !isClaimLevel('SOURCED'));
refuses(() => validateClaimLevel('MEASURED'), /claim level/, 'a source label is not a claim level');
for (const label of ['SOURCED', 'CALIBRATED', 'MEASURED', 'INFERRED', 'MODEL']) assert.equal(validateSourceLabel(label), label);
assert.ok(isSourceLabel(why) && !isSourceLabel('DEVICE_MEASURED'));
refuses(() => validateSourceLabel('UNKNOWN'), /reason/, 'a bare UNKNOWN label');
refuses(() => validateSourceLabel('DEVICE_MEASURED'), /source label/, 'a claim level is not a source label');

// Interval{lo, hi}.
assert.deepEqual(interval(47, 82), { lo: 47, hi: 82 });
assert.deepEqual(interval(5, 5), { lo: 5, hi: 5 });
refuses(() => interval(82, 47), /lo <= hi/, 'an inverted interval');
refuses(() => validateInterval({ lo: 0, hi: Infinity }), /finite/, 'an unbounded interval');
refuses(() => validateInterval({ lo: 0, hi: 1, unit: 'ms' }), /nothing else/, 'an interval with other fields');

// Outcome.
assert.deepEqual(sixAm(), { kind: 'SixAM' });
assert.deepEqual(timeout(), { kind: 'Timeout' });
assert.deepEqual(aborted('HOLD before any night'), { kind: 'Aborted', why: 'HOLD before any night' });
assert.equal(invalid('the save cursor was not observed').kind, 'Invalid');
const foxy = death({ by: 'Withered Foxy', how: 'hall flash missed', rule: 'g389', at: interval(59_000, 60_000) });
assert.equal(validateOutcome(foxy), foxy);
assert.equal(validateOutcome(death({ by: why, how: why, rule: why, at: why })).kind, 'Death');
assert.equal(validateOutcome(why), why, 'an UNKNOWN outcome is the kernel UNKNOWN value');
// sixAm builds a SixAM, which carries the deaths it survived.
assert.equal((sixAm([{ by: 'Balloon Boy', how: 'inside', rule: 'g907', at: why }]) as { readonly wouldDie?: readonly unknown[] }).wouldDie?.length, 1);
refuses(() => validateOutcome({ kind: 'Win' }), /kind/, 'an outcome the kernel does not name');
refuses(() => validateOutcome({ kind: 'SixAM', by: 'Foxy' }), /no by/, 'a 6 AM with a death field');
refuses(() => validateOutcome({ kind: 'Aborted' }), /why/, 'an abort without why');
refuses(() => validateOutcome({ kind: 'UNKNOWN' }), /reason/, 'an UNKNOWN outcome without its reason');
refuses(() => death({ by: 'Foxy', how: why, rule: '389', at: why }), /g###/, 'a rule that is not an event group');
refuses(() => death({ by: 'Foxy', how: why, rule: why, at: { lo: 2, hi: 1 } }), /lo <= hi/, 'a death at an inverted interval');

// GameRun and custody.
const run = {
  id: 'night1-example', spec: { winnerHash: 'fnv1a-00000000' }, venue: why, runMode: 'live', clocks: why,
  before: [], night: [{ type: 'observation' }], after: [], reportedOutcome: sixAm(),
  witnesses: [{ name: 'events.jsonl', sha256: 'a'.repeat(64), kind: 'text' }], custody: { class: 'complete', lost: [] },
};
assert.equal(validateGameRun(run), run);
assert.equal(validateGameRun({ ...run, custody: { class: 'recovered', lost: ['request.json'] } }).custody.class, 'recovered');
assert.equal(validateGameRun({ ...run, custody: { class: unknown('incomplete-campaign'), lost: ['result.json'] } }).id, run.id);
refuses(() => validateGameRun({ ...run, custody: { class: 'complete', lost: ['request.json'] } }), /lost nothing/, 'complete custody that lost a file');
refuses(() => validateGameRun({ ...run, custody: { class: 'original', lost: [] } }), /custody.class/, 'a v1 custody kind');
refuses(() => validateGameRun({ ...run, runMode: 'dry-run' }), /runMode/, 'a v1 mode string');
refuses(() => validateGameRun({ ...run, runMode: undefined }), /runMode/, 'a missing value with no reason');
refuses(() => validateGameRun({ ...run, claimLevel: 'DEVICE_MEASURED' }), /unexpected claimLevel/, 'a field the kernel does not name');
const { witnesses, ...noWitnesses } = run;
assert.ok(witnesses);
refuses(() => validateGameRun(noWitnesses), /missing witnesses/, 'a run without witnesses');
refuses(() => validateGameRun({ ...run, witnesses: [{ name: 'video', sha256: 'fnv1a-1', kind: 'video' }] }), /sha256/, 'a witness not named by sha256');
refuses(() => validateGameRun({ ...run, reportedOutcome: { kind: 'WIN' } }), /kind/, 'a v1 outcome string');

// Annotation: a wide subject, exactly one of class | measure | tag, a status.
const promotion = {
  subject: { kind: 'GameRun', id: run.id }, instrument: 'plan12-promotion@plan12-attestation-v2', class: 'plan12-promotion',
  value: 'claim.fnaf2.night1.device-6am', inputs: ['b'.repeat(64), 'fnv1a-537a1bbf'], by: 'agent:pedro-2026-09-27', status: 'standing',
};
assert.equal(validateAnnotation(promotion), promotion);
for (const subject of [{ kind: 'GameRuns', ids: ['a', 'b'] }, { kind: 'Census', id: 'fnaf2-winner-census-20260925' },
  { kind: 'Rule', id: 'g389' }, { kind: 'Policy', id: 'fnv1a-5c8dcb5f' }, { kind: 'Calibration', id: 'monitor-rule-v1' },
  { kind: 'ChronicleEntry', id: 'six-seven-refuted' }])
  assert.equal(validateAnnotation({ ...promotion, subject }).subject, subject);
assert.equal(validateAnnotation({ ...promotion, status: 'superseded', supersededBy: 'fnv1a-12345678' }).status, 'superseded');
assert.equal(validateAnnotation({ ...promotion, status: 'retracted' }).status, 'retracted');
const { class: _, ...measured } = promotion;
assert.equal(validateAnnotation({ ...measured, measure: 'first-divergent-update', value: 812 }).value, 812);
refuses(() => validateAnnotation({ ...promotion, tag: 'twin' }), /exactly one/, 'a class and a tag at once');
refuses(() => validateAnnotation(measured), /exactly one/, 'neither class, measure nor tag');
refuses(() => validateAnnotation({ ...promotion, status: 'superseded' }), /supersededBy/, 'superseded by nothing');
refuses(() => validateAnnotation({ ...promotion, supersededBy: 'x' }), /supersededBy/, 'a standing annotation naming a successor');
refuses(() => validateAnnotation({ ...promotion, subject: { kind: 'Rule', id: '389' } }), /g###/, 'a rule subject that is not g###');
refuses(() => validateAnnotation({ ...promotion, subject: { kind: 'Run', id: 'x' } }), /subject kind/, 'a subject the kernel does not name');
refuses(() => validateAnnotation({ ...promotion, instrument: 'plan12-promotion' }), /name@version/, 'an unversioned instrument');
refuses(() => validateAnnotation({ ...promotion, inputs: ['not a hash'] }), /content hash/, 'an input that is not a hash');
refuses(() => validateAnnotation({ ...promotion, status: 'open' }), /status/, 'a status outside the three');

// mulberry32 keeps the draws the lanes and tests that pasted it were measured with.
const draws = mulberry32(1);
assert.deepEqual([draws(), draws(), draws()], [0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
assert.equal(mulberry32(1 ^ 0x9e3779b9)(), 0.18967728852294385, 'a negative seed is read unsigned');

console.log('kernel: labels are closed enums that never promote one another, UNKNOWN carries its reason, and Interval, Outcome, GameRun with custody, and Annotation refuse what ADR 0002 rules out');
