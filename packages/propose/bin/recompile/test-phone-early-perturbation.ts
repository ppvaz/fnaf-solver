#!/usr/bin/env node
// FIXTURE for phone-early-perturbation.ts (family, contact shifts, LCG steps, rule), then
// docs/evidence/full06-early-perturbation-20261001.json re-derived from its distinct outcomes. No model run or private input.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isList } from '@sixam/kernel';
import { decide, earlyPredeclaration, family, memberContacts, stepState } from './phone-early-perturbation.ts';
import { fanOut, predeclared, sweepArgs } from './sweep-common.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string) => readFileSync(join(ROOT, path));
const json = (path: string) => JSON.parse(read(path).toString('utf8'));
const sha256 = (bytes: BinaryLike) => createHash('sha256').update(bytes).digest('hex');

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
const fit = { member: { kind: 'none' as const }, audioFits: true, agree: 30 };
assert.equal(decide({ minAgree: 30 }, [fit]).verdict, 'SUPPORTED');
assert.equal(decide({ minAgree: 30 }, [{ ...fit, agree: 29 }, { ...fit, audioFits: false, agree: 40 }]).verdict, 'NOT_SUPPORTED');

assert.throws(() => decide({ minAgree: 30 }, []), /no member/, 'a verdict over no members is refused, not NOT_SUPPORTED');

// --- the predeclaration: every input the sweep reads is pinned by sha256 and still matches
{
  const dir = mkdtempSync(join(tmpdir(), 'sweep-predeclaration-'));
  let written = 0;
  const file = (body: object) => { const path = join(dir, `${written += 1}.json`); writeFileSync(path, JSON.stringify(body)); return path; };
  const reads = () => ({ measuredSeed: 7, hashes: { config: 'a'.repeat(64), contacts: 'b'.repeat(64), frameTimes: null } });
  const declared = { id: 'x', night: 'full-06', seed: 7, decisionRule: { minAgree: 30 },
    inputs: { config: 'a'.repeat(64), contacts: 'b'.repeat(64) } };
  assert.equal(predeclared(file(declared), reads, earlyPredeclaration).pre.decisionRule.minAgree, 30);
  assert.throws(() => predeclared(file({ ...declared, inputs: undefined }), reads, earlyPredeclaration), /inputs must pin/,
    'a predeclaration that pins no input cannot show its inputs held');
  assert.throws(() => predeclared(file({ ...declared, inputs: { config: 'a'.repeat(64) } }), reads, earlyPredeclaration),
    /reads contacts, which the predeclaration does not pin/, 'an input the sweep reads and the predeclaration does not pin is refused');
  assert.throws(() => predeclared(file({ ...declared, inputs: { ...declared.inputs, contacts: 'c'.repeat(64) } }), reads,
    earlyPredeclaration), /input contacts changed/);
  assert.throws(() => predeclared(file({ ...declared, seed: 8 }), reads, earlyPredeclaration), /measured seed is 7/);
  assert.throws(() => predeclared(file({ ...declared, decisionRule: {} }), reads, earlyPredeclaration), /minAgree/);
  assert.throws(() => predeclared(file({ ...declared, seed: '7' }), reads, earlyPredeclaration), /seed must be an integer/);
  rmSync(dir, { recursive: true, force: true });
}
assert.throws(() => sweepArgs(['--predeclaration', 'x', '--workers', '0']), /--workers/, 'zero workers would score nothing');
assert.throws(() => sweepArgs(['--predeclaration', 'x', '--workers', 'six']), /--workers/);
await assert.rejects(fanOut(import.meta.url, 'none', {}, [1, 2], 0), /workers/, 'a pool of no workers scores nothing');

// --- the full-06 record
const rec = json('docs/evidence/full06-early-perturbation-20261001.json');
const pre = json(rec.predeclaration.path);
assert.equal(rec.predeclaration.sha256, sha256(read(rec.predeclaration.path)), 'the predeclaration is the committed one');
// It pins none of the inputs it read (its record states their hashes after the fact), so it is not re-run as it stands.
assert.throws(() => predeclared(join(ROOT, rec.predeclaration.path), () => ({ measuredSeed: pre.seed, hashes: {} }),
  earlyPredeclaration), /inputs must pin/);
assert.equal(rec.seed, pre.seed);
/** A committed distinct outcome, as the checks below read it. */
type Outcome = { readonly members: number, readonly firstHopUpdate: number | null, readonly vocals: readonly (number | string)[], readonly agree: number };
assert.equal(rec.distinctOutcomes.reduce((n: number, o: Outcome) => n + o.members, 0), rec.members, 'every member is in one distinct outcome');
const PHONE = [24, 23, 23];
const fits = (o: Outcome) => o.firstHopUpdate !== null && o.firstHopUpdate <= 312 && o.vocals.every((v, i) => v === PHONE[i] || v === 'redraw');
assert.equal(rec.distinctOutcomes.filter(fits).reduce((n: number, o: Outcome) => n + o.members, 0), rec.counts.audioFits);
assert.equal(rec.distinctOutcomes.filter((o: Outcome) => o.agree >= pre.decisionRule.minAgree).reduce((n: number, o: Outcome) => n + o.members, 0), rec.counts.agreeAtLeastMin);
assert.equal(Math.max(...rec.distinctOutcomes.map((o: Outcome) => o.agree)), rec.counts.maxAgree);
const verdict = rec.distinctOutcomes.some((o: Outcome) => fits(o) && o.agree >= pre.decisionRule.minAgree) ? 'SUPPORTED' : 'NOT_SUPPORTED';
assert.equal(rec.verdict, verdict);
assert.equal(rec.decision.verdict, verdict);
assert.deepEqual([rec.control.agree, rec.control.firstHopUpdate, rec.control.audioFits], [14, 601, false], 'the unperturbed member is the census row for 47593');

const canon = (v: unknown): string => isList(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Readonly<Record<string, unknown>>)[k])}`).join(',')}}` : JSON.stringify(v);
const { id, ...body } = rec;
assert.equal(id, `s2-early-perturbation-${sha256(canon(body)).slice(0, 16)}`, 'record id');
console.log(`phone-early-perturbation: family, members, LCG steps and rule fixtures, and ${id} (${verdict}) re-derived from its outcomes`);
