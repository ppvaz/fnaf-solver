#!/usr/bin/env node
// Gate for fnaf4-run-seed.ts and its predeclaration (docs/evidence/fnaf4-n5b-rebuild-seed-predeclaration-20261002.json),
// in `npm run test:unit`. No binary: the rows are rebuilt from the committed run pack, the roll rule is re-derived on
// every development tick from the generator alone, and stage 1 is recounted.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide, phoneRows, prefilter, readNight, roll, stream } from './fnaf4-run-seed.ts';
import { sha256 } from './sweep-common.ts';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const pre = json('docs/evidence/fnaf4-n5b-rebuild-seed-predeclaration-20261002.json');

// The night's rows, from its committed pack, are the predeclared ones; the pack is the night the record measured.
const rows = phoneRows(join(ROOT, pre.run.dir), pre.mapping.pressMs, pre.mapping.releaseMs);
assert.equal(sha256(rows), pre.rows.sha256, 'n5b rows from the pack');
assert.equal(rows.split('\n').filter(Boolean).length, pre.rows.count);
assert.equal(sha256(readFileSync(join(ROOT, pre.run.dir, 'events.jsonl'))), pre.run.eventsSha256);
assert.equal(sha256(readFileSync(join(ROOT, pre.run.dir, 'run.json'))), pre.run.runJsonSha256);
assert.equal(sha256(readFileSync(join(ROOT, pre.phone.source))), pre.phone.sha256, 'the phone record is the predeclared one');
assert.equal(sha256(readFileSync(join(ROOT, pre.save.path))), pre.save.sha256);
const phone = json(pre.phone.source).derived['n5b-replay'].hearing;
const heard = pre.rollTicks.map((t: number) => phone.sideTicks.find((s: unknown[]) => s[1] === t / 60)?.[4] ?? '-').join('');
assert.equal(heard, pre.decisionRule.ticks, 'the heard string is the record\'s accepted sides');

// The roll rule on every development tick: a landing or a hall entry is a pass to that side, '-' a failed roll.
let ticks = 0;
for (const dev of pre.drawRule.development) {
  const st = stream(dev.seed, 400);
  for (const [, before, withFive, seen] of dev.ticks) {
    const r = roll(st, before, withFive);
    if (seen === '-') assert.equal(r.pass, false, `seed ${dev.seed}: a silent tick is a failed roll`);
    else assert.ok(r.pass && r.side === seen.slice(-1), `seed ${dev.seed}: ${seen} is a pass to ${seen.slice(-1)}`);
    ticks += 1;
  }
}
assert.equal(ticks, 45);

// Stage 1 is recounted, and the validity seeds are seeds it drops.
const kept = new Set(prefilter(pre.prefix));
assert.equal(kept.size, pre.stage1.kept);
assert.ok(pre.validity.seeds.every((s: number) => !kept.has(s)));

// The night reader: a fresh living-room landing on a roll tick, '-' otherwise; the update `gameover` turned 1.
const still = [{ t: 0, at: { Fredbear: 'living room center' }, gameover: 0 }, { t: 180, at: { Fredbear: 'living room right' }, gameover: 0 },
  { t: 181, at: { Fredbear: 'living room center' }, gameover: 0 }, { t: 540, at: { Fredbear: 'right hall far' }, gameover: 0 },
  { t: 600, at: { Fredbear: 'right hall far' }, gameover: 1 }, { t: 0, f: 4, dead: true }].map((r) => JSON.stringify(r)).join('\n');
assert.deepEqual(readNight(still, [180, 360, 540]), { ticks: 'R--', dead: true, gameoverAt: 600 });

// The rule: one match, several, none, and the two ways it is void.
const rule = { ticks: 'R-', deathWindow: [100, 200] as [number, number] };
const hit = (seed: number, extra = {}) => ({ seed, kept: true, ticks: 'R-', gameoverAt: 150, prefixOk: true, ...extra });
assert.equal(decide(rule, [hit(1), hit(2, { ticks: 'L-' }), hit(3, { gameoverAt: 300 })]).verdict, 'REPRODUCED_UNIQUE');
assert.deepEqual(decide(rule, [hit(1), hit(2, { ticks: 'L-' }), hit(3, { gameoverAt: 300 })]).landingsOnly, [1, 3]);
assert.equal(decide(rule, [hit(1), hit(2)]).verdict, 'REPRODUCED_MULTIPLE');
assert.equal(decide(rule, [hit(1, { gameoverAt: null })]).verdict, 'NOT_REPRODUCED');
assert.equal(decide(rule, [hit(1), { seed: 9, kept: false, prefixOk: false }]).verdict, 'UNINFORMATIVE');
assert.equal(decide(rule, [hit(1), { seed: 2, kept: true, error: 'x' }]).verdict, 'UNINFORMATIVE');

// The result, once it exists, re-derives from its own rows.
const resultPath = join(ROOT, pre.resultRecord);
if (existsSync(resultPath)) {
  const rec = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.equal(rec.predeclaration.sha256, sha256(readFileSync(join(ROOT, 'docs/evidence/fnaf4-n5b-rebuild-seed-predeclaration-20261002.json'))));
  const scanned = rec.rows.split(' ').map((r: string) => {
    const [seed, k, tk, go, ok] = r.split(',');
    return { seed: Number(seed), kept: k === '1', ticks: tk, gameoverAt: go === '' ? null : Number(go), prefixOk: ok === '1' };
  });
  const d = decide(pre.decisionRule, scanned);
  assert.equal(d.verdict, rec.verdict);
  assert.deepEqual(d.matches, rec.matches);
  const { id, ...body } = rec;
  assert.equal(id, `fnaf4-n5b-rebuild-seed-${sha256(JSON.stringify(body)).slice(0, 16)}`);
}
console.log(`fnaf4-run-seed: n5b rows from the pack, ${ticks} development ticks, stage 1 ${kept.size} seeds, reader and rule fixtures${existsSync(resultPath) ? ', and the result re-derived' : ''}`);
