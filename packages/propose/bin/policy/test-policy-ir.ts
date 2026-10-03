// Plan 21 package 1 contract: finite policy IR round-trip and source mapping.
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { canonicalPolicy, roundTripPolicy, validatePolicy } from '@sixam/propose/policy';
import { minimalPolicy } from './policy-ir.ts';

const check: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
/** A field the test reads where the program has it; a missing one fails the check that reads it. */
const found = <T>(value: T | null | undefined) => value as T;
const program = minimalPolicy();
const canonical = canonicalPolicy(program);
const hash = createHash('sha256').update(canonical).digest('hex');
const again = roundTripPolicy(JSON.parse(canonical));
check(canonicalPolicy(again) === canonical, 'policy IR did not round-trip');
check(program.phases.map(phase => phase.kind).join(',') ===
      'idle,setup,repeat,finish,observe', 'policy phases are not complete');
check(program.phases[2].periodMs === 5000 && program.phases[4].endMs === 420000,
      'minimal plan timing did not enter the IR');
check(found(program.phases[2].actions).every(action => found(action.offsetMs) >= 0),
      'repeat actions are not relative offsets');
check(hash.length === 64 && program.proof.traceEquivalence,
      'policy hash/proof obligation is missing');

// Every consumer of the IR (interpreter, device compiler, search) reads an action's mode and its numbers, so the IR
// checks them: a hold without its duration would expand to a release at NaN, which the interpreter's time filter
// then drops, and the replay would score a different program under this one's name.
const withRepeat = (actions: unknown, extra: Readonly<Record<string, unknown>> = {}) => ({
  ...program, phases: program.phases.map((phase) => phase.kind === 'repeat' ? { ...phase, actions, ...extra } : phase) });
const at = { action: 'wind', offsetMs: 0 };
assert.doesNotThrow(() => validatePolicy(withRepeat([{ ...at, mode: 'hold', durationMs: 100 }])));
assert.throws(() => validatePolicy(withRepeat([{ ...at, mode: 'hold' }])), /durationMs/, 'a hold needs its duration');
assert.throws(() => validatePolicy(withRepeat([{ ...at, mode: 'hold', durationMs: 0 }])), /durationMs/);
assert.throws(() => validatePolicy(withRepeat([{ action: 'monitor', offsetMs: 0, mode: 'camdrop', leadMs: 50, durationMs: 100 }])),
  /tailMs/, 'a camdrop needs its lead, contact and tail');
assert.throws(() => validatePolicy(withRepeat([{ ...at, mode: 'swipe' }])), /mode/, 'an unreviewed mode is refused');
assert.throws(() => validatePolicy(withRepeat({})), /actions must be a list/, 'actions that are not a list are not "no actions"');
assert.throws(() => validatePolicy(withRepeat([], { observations: 'x' })), /observations must be a list/);
assert.throws(() => validatePolicy({ ...program, metadata: { ...program.metadata, nights: ['1'] } }), /metadata/);
console.log(`policy IR: ${program.metadata.id} round-trips with hash ${hash}; modes, their numbers and list fields are checked`);
