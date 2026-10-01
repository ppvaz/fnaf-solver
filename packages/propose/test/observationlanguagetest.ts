// Plan 05 package 6b/6c: the observation-conditioned language, its measured
// budget, and the mechanical duplicate control the invention search runs.
//
// Nothing here claims a candidate survives anything. It pins the two rules the
// language exists to enforce -- a fact is searchable only if its read cost is
// measured, and a branch may only demand a decision the measured budget can
// supply -- plus the exclusion of the families Plans 05/06/16 closed.
import { FACTS } from '@sixam/play/sim';
import {
  BRANCH_SCHEMA, OBSERVATION_BUDGET, UNKNOWN, VISUAL_READ_COST_MS,
  admissibleFacts, deviceAdmissibleFacts, earliestReactionMs, evaluatePredicate,
  excludedFacts, observationLanguage, validateBranch, validatePredicate,
  validatePolicy, worstCaseFactAgeMs,
} from '@sixam/propose/policy';
import { minimalPolicy } from '../bin/policy/policy-ir.ts';
import {
  policyBranches, policyFingerprint, structuralShape, validateGrammarPolicy,
} from '../bin/policy/policy-grammar.ts';
import { compileDevicePlan } from '../bin/policy/policy-equivalence.ts';
import { compilePolicy } from '../bin/policy/policy-interpreter.ts';
import { closedFamilyMatches } from '../bin/policy/closed-families.ts';

const check = (condition, message) => { if (!condition) throw new Error(message); };
const rejects = (run, pattern, message) => {
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  check(error && pattern.test(error.message), `${message} (got ${error?.message ?? 'no error'})`);
};

// --- The budget ----------------------------------------------------------

check(Object.keys(OBSERVATION_BUDGET).length === FACTS.length,
  'the observation budget does not cover the sensor fact vocabulary exactly');

// The visual channel's read cost is DEVICE_MEASURED; the audio channel's is not.
check(OBSERVATION_BUDGET.leftOpening.readCostMs === VISUAL_READ_COST_MS &&
      VISUAL_READ_COST_MS === 59.5,
  'the visual read cost is not the measured p95 device-local snapshot read');
// The three `ventThud*` facts joined this list in `deb6463`: the marker-122
// thud is the only cue that reaches Toy Chica, and it is AUDIO, whose read
// cost plan 08 says is unmeasured. They are priced exactly like the other
// unmeasured reads -- searchable by nothing until the ARM/HIT/MISS protocol
// exists -- which is why the excluded count below moved from four to seven.
for (const fact of ['bbVent', 'bbVentId', 'mangleStatic', 'mangleStaticCam',
                    'ventThud', 'ventThudId', 'ventThudAge']) {
  check(OBSERVATION_BUDGET[fact].readCostMs === UNKNOWN,
    `${fact} was given a read cost the repository has not measured`);
  check(!OBSERVATION_BUDGET[fact].admissible &&
        OBSERVATION_BUDGET[fact].exclusion === 'read-cost-unmeasured',
    `${fact} is admissible despite an unmeasured read cost`);
}
check(admissibleFacts().length === 10 && excludedFacts().length === 7,
  'the admissible/excluded split does not match the measured budget');
check(admissibleFacts().every(fact => OBSERVATION_BUDGET[fact].channel === 'visual'),
  'an audio fact reached the searchable vocabulary');

// Read cost is measured; classifier calibration is not. They must not be
// confused: no fact is device-promotable today (Plan 15).
check(deviceAdmissibleFacts().length === 0,
  'a fact claims a calibrated device pairing that has not been measured');
check(observationLanguage().hostRoundTripMs === UNKNOWN,
  'the host round trip was given a number; observer.readDelayFrames is a knob');

// --- Predicates are total over UNKNOWN ------------------------------------

const armed = { op: 'observed-equals', fact: 'splitArmed', value: true };
check(evaluatePredicate(armed, { state: 'OBSERVED', value: true }), 'observed-equals missed a match');
check(!evaluatePredicate(armed, { state: 'OBSERVED', value: false }), 'observed-equals matched the wrong value');
check(!evaluatePredicate(armed, { state: 'UNKNOWN', reason: 'cams-not-up' }),
  'an UNKNOWN reading satisfied a value predicate');
check(evaluatePredicate({ op: 'unknown', fact: 'splitArmed' }, { state: 'UNKNOWN', reason: 'cams-not-up' }),
  'the unknown predicate did not fire on a refusal');
rejects(() => validatePredicate({ op: 'observed-equals', fact: 'bbVent', value: true }),
  /excluded fact bbVent/, 'a predicate on an excluded fact was accepted');
rejects(() => validatePredicate({ op: 'gt', fact: 'boxPie', value: 0.5 }),
  /predicate op must be/, 'an operator outside the finite vocabulary was accepted');

// --- Branches against the measured budget ---------------------------------

const branch = () => ({
  schema: BRANCH_SCHEMA, id: 'reverify-split', atMs: 4400,
  observe: { fact: 'splitArmed', maxAgeMs: 200, confidenceFloor: 1 },
  predicate: { op: 'observed-equals', fact: 'splitArmed', value: false },
  then: [{ offsetMs: 100, action: 'cam9', mode: 'tap', contactMs: 33 },
         { offsetMs: 300, action: 'cam11', mode: 'tap', contactMs: 33 }],
  otherwise: [{ offsetMs: 100, action: 'cam11', mode: 'tap', contactMs: 33 }],
});
validateBranch(branch());

check(worstCaseFactAgeMs('splitArmed') ===
      OBSERVATION_BUDGET.splitArmed.cadenceMs + VISUAL_READ_COST_MS,
  'worst-case fact age is not one sample interval plus one read');
rejects(() => validateBranch({ ...branch(), observe: { fact: 'splitArmed', maxAgeMs: 20, confidenceFloor: 1 } }),
  /the measured budget delivers/, 'a branch demanded a fact fresher than the sensor delivers');
rejects(() => validateBranch({
  ...branch(),
  then: [{ offsetMs: 10, action: 'cam9', mode: 'tap', contactMs: 33 }],
}), /the measured read costs/, 'a branch acted faster than the measured read');
check(earliestReactionMs('splitArmed') === VISUAL_READ_COST_MS,
  'the earliest reaction is not the measured read cost');
rejects(() => validateBranch({
  ...branch(), observe: { fact: 'bbVent', maxAgeMs: 5000, confidenceFloor: 1 },
  predicate: { op: 'observed-equals', fact: 'bbVent', value: 'opening' },
}), /excluded fact bbVent/, 'a branch on an unmeasured audio fact was accepted');

// --- The grammar can now express a branch, and constrains it --------------

function branchedPolicy(mutate = () => {}) {
  const program = minimalPolicy();
  const repeat = program.phases.find(phase => phase.kind === 'repeat');
  // Shorten the wind hold so the body has room for a decision point.
  repeat.actions[1].durationMs = 4000;
  repeat.actions[1].contactMs = 4000;
  repeat.branches = [branch()];
  mutate(repeat);
  return program;
}

const branched = branchedPolicy();
validateGrammarPolicy(branched);
validatePolicy(branched);
check(policyBranches(branched).length === 1, 'the branch was lost from the program');
check(policyFingerprint(branched) !== policyFingerprint(minimalPolicy()),
  'the structural fingerprint ignores branches');
check(structuralShape(branched) !== structuralShape(minimalPolicy()),
  'the timing-free shape ignores branches');

rejects(() => validateGrammarPolicy(branchedPolicy(repeat => {
  repeat.branches[0].then = [{ offsetMs: 100, action: 'cam9', mode: 'tap', contactMs: 33 }];
})), /arms leave different control states/,
  'a branch arm that leaves a different control state was accepted');
rejects(() => validateGrammarPolicy(branchedPolicy(repeat => {
  repeat.branches[0].atMs = 4900;
})), /escapes its period/, 'a branch that runs past its period was accepted');
rejects(() => validateGrammarPolicy(branchedPolicy(repeat => {
  repeat.branches[0].atMs = 1000;
})), /overlaps unconditional/, 'a branch overlapping the wind hold was accepted');
rejects(() => validateGrammarPolicy(branchedPolicy(repeat => {
  repeat.branches.push({ ...branch(), id: 'duplicate-window' });
})), /overlaps branch/, 'two branches sharing one window were accepted');

// The device plan text is a static schedule and must say so rather than
// flattening a branch into one of its arms.
rejects(() => compileDevicePlan(branched),
  /cannot express them/, 'the device compiler silently flattened a branch');

// The exact-engine adapter compiles the same unconditional stream, so it must
// refuse too: a flattened branch replayed under the branched program's name is
// a survival number for a different program.
rejects(() => compilePolicy(branched),
  /evaluates unconditional programs only/,
  'the exact-engine compiler evaluated a branched program as a schedule');

// --- The duplicate control ------------------------------------------------

const minimalMatches = closedFamilyMatches(minimalPolicy()).map(match => match.id);
check(minimalMatches.includes('unconditioned-schedule'),
  'the Minimal schedule was not classified into the family Plans 05/06/16 closed');
check(minimalMatches.includes('timing-only-mutation'),
  'a known shape with different times was not classified as a knob mutation');
check(!closedFamilyMatches(branched).some(match => match.id === 'unconditioned-schedule'),
  'a branched program was classified as an unconditioned schedule');

// Defence in depth: even if a branch on an audio fact reached the register
// without passing validation, the register still names it as closed.
const audioBranched = branchedPolicy(repeat => {
  repeat.branches[0].observe = { fact: 'bbVent', maxAgeMs: 5000, confidenceFloor: 1 };
  repeat.branches[0].predicate = { op: 'observed-equals', fact: 'bbVent', value: 'opening' };
});
check(closedFamilyMatches(audioBranched).some(match => match.id === 'audio-anchored-branch'),
  'an audio-anchored branch escaped the duplicate control');

console.log(`observation language: ${admissibleFacts().length} admissible fact(s), ` +
  `${excludedFacts().length} excluded as ${UNKNOWN}, ` +
  `${deviceAdmissibleFacts().length} calibrated for device use, ` +
  `${closedFamilyMatches(minimalPolicy()).length} closed families matched on the Minimal control`);
