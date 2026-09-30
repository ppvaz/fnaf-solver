// policy-v1 is keyed by game: an action must name a control in the policy's
// game's catalog (@sixam/source), and a policy that names no game is FNaF 2's.
// CONTRACT:policy-program-v1.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalPolicy, policyGame, roundTripPolicy, validatePolicy } from '@sixam/propose/policy';
import { minimalPolicy } from '../bin/policy/policy-ir.mjs';
import { compilePolicy } from '../bin/policy/policy-interpreter.mjs';
import { compilePolicyArtifact } from '../bin/policy/policy-artifact.mjs';

const sha256 = text => createHash('sha256').update(text).digest('hex');
// The program with the first action of its first acting phase renamed.
const withAction = (program, action) => {
  const copy = structuredClone(program);
  copy.phases.find(phase => phase.actions?.length).actions[0].action = action;
  return copy;
};

// -- an existing policy names no game, validates as FNaF 2's, and keeps its
//    bytes: these are the canonical policy and compiled plan hashes from
//    before the IR took a game, and the compiled plan carries the first.
const minimal = minimalPolicy();
assert.equal(Object.hasOwn(minimal.metadata, 'game'), false);
assert.equal(policyGame(minimal), 'fnaf2');
assert.equal(sha256(canonicalPolicy(minimal)), '08fb6bd4efac232b889a84443c98f91b3614ab7d38b653274ddaccdd3a4d0eee');
assert.equal(canonicalPolicy(roundTripPolicy(minimal)), canonicalPolicy(minimal));
const artifact = compilePolicyArtifact(minimal);
assert.equal(artifact.policySha256, '08fb6bd4efac232b889a84443c98f91b3614ab7d38b653274ddaccdd3a4d0eee');
assert.equal(artifact.planSha256, '7784187d9dbeca2b9b9c7da06d2d76dfcd0614c6c885d59428f92b8bdde727be');
// Naming the game it already had changes nothing it validates.
validatePolicy({ ...minimal, metadata: { ...minimal.metadata, game: 'fnaf2' } });

// -- FNaF 2's stored spellings map onto its catalog, and the rest of that
//    catalog is accepted as spelled.
for (const action of ['monitor', 'mask', 'cam9', 'cam11', 'ventl', 'light', 'wind', 'hall',
  'cameraFeedLight', 'rightVentLight', 'cam:8'])
  validatePolicy(withAction(minimal, action));

// -- a FNaF 1 control in a FNaF 2 policy is refused, naming the game.
assert.throws(() => validatePolicy(withAction(minimal, 'leftDoor')),
  /phase 1 action 0 has an unsupported action: "leftDoor" is not a FNaF 2 control/);
assert.throws(() => validatePolicy(withAction(minimal, 'cam:13')), /not a FNaF 2 control/);

// -- a FNaF 1 policy validates against the FNaF 1 catalog, and FNaF 2's
//    spellings are not FNaF 1 controls.
const fnaf1 = {
  schema: 'policy-v1',
  metadata: { id: 'fnaf1-door-fixture', game: 'fnaf1', nights: [1] },
  phases: [
    { id: 'setup', kind: 'setup', startMs: 0, endMs: 1000, actions: [
      { atMs: 0, action: 'monitor' }, { atMs: 200, action: 'leftDoor' }, { atMs: 400, action: 'rightDoorLight' },
    ] },
  ],
  proof: { seeds: [], traceEquivalence: false },
};
assert.equal(validatePolicy(fnaf1), fnaf1);
assert.equal(policyGame(fnaf1), 'fnaf1');
for (const action of ['wind', 'cam9', 'ventl', 'mask'])
  assert.throws(() => validatePolicy(withAction(fnaf1, action)), /is not a FNaF 1 control/, action);
assert.throws(() => validatePolicy(withAction(fnaf1, 'wind')), /phase 0 action 0 has an unsupported action/);

// -- a game the registry does not know is refused, listing the known ones.
assert.throws(() => validatePolicy({ ...fnaf1, metadata: { ...fnaf1.metadata, game: 'fnaf9' } }),
  /policy metadata.game "fnaf9" is not a registered game \(fnaf1, fnaf2, fnaf3, fnaf4\)/);

// -- the FNaF 2 interpreter replays only what it can expand: a catalog control
//    it has no Sim action for, or another game's policy, is refused rather
//    than pressed as a name the Sim ignores.
assert.throws(() => compilePolicy(withAction(minimal, 'rightVentLight')),
  /action "rightVentLight" has no FNaF 2 Sim expansion/);
assert.throws(() => compilePolicy(fnaf1), /fnaf1-door-fixture is a fnaf1 policy; this interpreter replays FNaF 2/);

console.log('policy game: an unnamed game is FNaF 2 with its bytes unchanged; actions are checked ' +
  'against the named game\'s catalog, FNaF 1 controls refused in FNaF 2 and FNaF 1 policies accepted');
