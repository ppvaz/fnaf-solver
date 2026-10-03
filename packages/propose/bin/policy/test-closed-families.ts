#!/usr/bin/env node
// The duplicate control (closed-families.ts) and the search's use of it (policy-search.ts evaluateCandidate):
// the register is checked when it loads, every program the grammar accepts is classified against it and a
// closed family's member is refused in reject mode, and a program the grammar refuses is left unclassified
// rather than read as outside every closed family. No replay. In the unit lane.
import assert from 'node:assert/strict';
import { CLOSED_FAMILIES, closedFamilyMatches, parseClosedFamilies } from './closed-families.ts';
import { minimalPolicy } from './policy-ir.ts';
import type { PolicyProgram } from '@sixam/propose/policy';
import { evaluateCandidate } from './policy-search.ts';

// --- the register
const register = { schema: 'closed-policy-families-v1', families: [{ id: 'x', rule: 'no-observation-branch', plans: ['05'] }] };
assert.equal(parseClosedFamilies(register, 'r').families.length, 1);
assert.throws(() => parseClosedFamilies({ ...register, schema: 'other' }, 'r'), /schema/);
assert.throws(() => parseClosedFamilies({ ...register, families: {} }, 'r'), /families/);
assert.throws(() => parseClosedFamilies({ ...register, families: [{ id: 'x', rule: 'no-such-rule', plans: ['05'] }] }, 'r'),
  /no-such-rule/, 'a family whose rule is not implemented is refused when the register loads, not when a candidate meets it');
assert.throws(() => parseClosedFamilies({ ...register, families: [{ id: '', rule: 'no-observation-branch', plans: ['05'] }] }, 'r'), /id/);
assert.throws(() => parseClosedFamilies({ ...register, families: [{ id: 'x', rule: 'no-observation-branch', plans: [5] }] }, 'r'), /plans/);
assert.ok(CLOSED_FAMILIES.length >= 3, 'the committed register loads');

// --- the search: the Night 1 Minimal program is the known family itself, so reject mode refuses it before any replay
const minimal = minimalPolicy();
const matches = closedFamilyMatches(minimal).map((match) => match.id);
assert.ok(matches.length > 0, 'the minimal program belongs to a closed family');
const refused = evaluateCandidate(minimal, { seeds: 1 });
assert.equal(refused.status, 'rejected');
assert.deepEqual(refused.closedFamilies?.map((match) => match.id), matches);
assert.ok(refused.reasons.every((reason) => reason.startsWith('closed-family:')), refused.reasons.join('; '));

// --- a program the grammar refuses is not classified: unknown, not outside every closed family
const planted: unknown = { ...minimal, phases: 'not a phase list' };
const broken = evaluateCandidate(planted as PolicyProgram, { seeds: 1 });
assert.equal(broken.status, 'rejected');
assert.ok(broken.reasons.some((reason) => reason.startsWith('grammar:')), broken.reasons.join('; '));
assert.equal(broken.closedFamilies, null, 'a refused program\'s closed families are unknown, not none');
assert.equal(broken.knownFamily, null);

console.log(`closed families: the register (${CLOSED_FAMILIES.length} families) checks on load, the minimal program is refused as ` +
  `${matches.join(', ')}, and a program the grammar refuses stays unclassified`);
