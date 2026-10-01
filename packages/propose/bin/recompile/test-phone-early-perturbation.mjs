#!/usr/bin/env node
// FIXTURE for phone-early-perturbation.mjs (family, contact shifts, LCG steps, rule), then
// docs/evidence/full06-early-perturbation-20261001.json re-derived from its distinct outcomes. No model run or private input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, family, memberContacts, stepState } from './phone-early-perturbation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path) => readFileSync(join(ROOT, path));
const json = (path) => JSON.parse(read(path).toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// --- the family and its members
const contacts = [{ control: 'monitor', downFrame: 2, upFrame: 4 }, { control: 'cam', downFrame: 10, upFrame: 11 }, { control: 'mask', downFrame: 20, upFrame: 22 }];
const fam = family(contacts, 20, 3);
assert.equal(fam.filter((m) => m.kind !== 'draws').length, 14, 'two contacts before the first mask press, seven variants each');
assert.equal(fam.filter((m) => m.kind === 'draws').length, 16, 'four draw changes after each of updates 0..3');
assert.deepEqual(memberContacts(contacts, { kind: 'shift', index: 0, d: -3 })[0], { control: 'monitor', downFrame: 1, upFrame: 2 }, 'nothing before update 1; release after press');
assert.deepEqual(memberContacts(contacts, { kind: 'shift', index: 1, d: 2 }).map((c) => c.downFrame), [2, 12, 20]);
assert.equal(memberContacts(contacts, { kind: 'drop', index: 1 }).length, 2);
for (const s of [0, 1, 47593, 65535]) for (const k of [1, 2]) assert.equal(stepState(stepState(s, k), -k), s, 'the LCG steps back exactly');
assert.equal(stepState(47593, 1), 61328);

// --- the rule
const fit = { member: { kind: 'none' }, audioFits: true, agree: 30 };
assert.equal(decide({ minAgree: 30 }, [fit]).verdict, 'SUPPORTED');
assert.equal(decide({ minAgree: 30 }, [{ ...fit, agree: 29 }, { ...fit, audioFits: false, agree: 40 }]).verdict, 'NOT_SUPPORTED');

// --- the full-06 record
const rec = json('docs/evidence/full06-early-perturbation-20261001.json');
const pre = json(rec.predeclaration.path);
assert.equal(rec.predeclaration.sha256, sha256(read(rec.predeclaration.path)), 'the predeclaration is the committed one');
assert.equal(rec.seed, pre.seed);
assert.equal(rec.distinctOutcomes.reduce((n, o) => n + o.members, 0), rec.members, 'every member is in one distinct outcome');
const PHONE = [24, 23, 23];
const fits = (o) => o.firstHopUpdate !== null && o.firstHopUpdate <= 312 && o.vocals.every((v, i) => v === PHONE[i] || v === 'redraw');
assert.equal(rec.distinctOutcomes.filter(fits).reduce((n, o) => n + o.members, 0), rec.counts.audioFits);
assert.equal(rec.distinctOutcomes.filter((o) => o.agree >= pre.decisionRule.minAgree).reduce((n, o) => n + o.members, 0), rec.counts.agreeAtLeastMin);
assert.equal(Math.max(...rec.distinctOutcomes.map((o) => o.agree)), rec.counts.maxAgree);
const verdict = rec.distinctOutcomes.some((o) => fits(o) && o.agree >= pre.decisionRule.minAgree) ? 'SUPPORTED' : 'NOT_SUPPORTED';
assert.equal(rec.verdict, verdict);
assert.equal(rec.decision.verdict, verdict);
assert.deepEqual([rec.control.agree, rec.control.firstHopUpdate, rec.control.audioFits], [14, 601, false], 'the unperturbed member is the census row for 47593');

const canon = (v) => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v);
const { id, ...body } = rec;
assert.equal(id, `s2-early-perturbation-${sha256(canon(body)).slice(0, 16)}`, 'record id');
console.log(`phone-early-perturbation: family, members, LCG steps and rule fixtures, and ${id} (${verdict}) re-derived from its outcomes`);
