// Plan 21 package 3: structural grammar and known-family duplicate control.
import { minimalPolicy } from '../bin/policy/policy-ir.ts';
import {
  buildPolicy, classifyPolicy, knownPolicyFamilies, validateGrammarPolicy,
} from '../bin/policy/policy-grammar.ts';
import type { PolicyProgram } from '@sixam/propose/policy';

// A clone of the generated program, which a mutator edits in place.
type Draft = PolicyProgram & { readonly phases: readonly { actions: { action: string, offsetMs?: number, [field: string]: unknown }[] }[] };

const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
const source = minimalPolicy();
(source.metadata as Record<string, unknown>).setupTarget = 'minus-toys-split'; // minimalPolicy builds a fresh program
const [idle, setup, repeat, finish, observe] = source.phases;

const generated = buildPolicy({
  metadata: source.metadata,
  idleEndMs: idle.endMs,
  loopStartMs: repeat.startMs,
  loopEndMs: repeat.endMs,
  periodMs: repeat.periodMs,
  observeUntilMs: observe.endMs,
  setupActions: setup.actions,
  repeatActions: repeat.actions,
  finishActions: finish.actions,
  observations: observe.observations,
  proof: source.proof,
});
check(classifyPolicy(generated).known, 'generated Minimal structure was not identified');
check(classifyPolicy(generated).family === 'minus-toys-minimal',
  'known-family fingerprint returned the wrong family');
check(knownPolicyFamilies().includes('minus-toys-minimal'),
  'known-family registry is empty');

function rejects(mutator: (candidate: Draft) => void, message: string) {
  const candidate = structuredClone(generated) as Draft;
  mutator(candidate);
  let rejected = false;
  try { validateGrammarPolicy(candidate); } catch (error) { rejected = /policy grammar/.test((error as Error).message); }
  check(rejected, message);
}

rejects(candidate => {
  candidate.phases[2].actions[1].offsetMs = 200;
}, 'overlapping repeat actions were accepted');
rejects(candidate => {
  candidate.phases[2].actions[0].offsetMs = 5000;
}, 'an action outside the repeat period was accepted');
rejects(candidate => {
  candidate.phases[1].actions[1].action = 'mask';
}, 'mask-on while monitor is up was accepted');
rejects(candidate => {
  candidate.phases[2].actions.unshift({ offsetMs: 0, action: 'hall', mode: 'hall', durationMs: 33, contactMs: 33 });
}, 'hall before a monitor-down transition was accepted');
rejects(candidate => {
  candidate.phases[4].actions = [{ atMs: 360001, action: 'monitor', mode: 'tap', contactMs: 33 }];
}, 'a terminal action after the boundary was accepted');

console.log(`policy grammar: generated ${classifyPolicy(generated).family}, rejected illegal ordering/timing controls`);
