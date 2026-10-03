#!/usr/bin/env node
// FIXTURE for phone-static-readout.ts (correlation, the generator's cycles, the identification rule), then every
// docs/evidence/full06-static-readout*-20261001.json re-derived from its rows: verdicts, cycle positions, neighbourhood
// states and record ids. No model run, frame trace or capture. In `npm run test:unit`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cycleIndex, detrend, identify, lumaByImage, pearson, regionMeanLuma, staticPredeclaration } from './phone-static-readout.ts';
import { checkSweepPredeclaration, recordId } from './sweep-common.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (path: string) => readFileSync(join(ROOT, path));
const json = (path: string) => JSON.parse(read(path).toString('utf8'));
const sha256 = (bytes: BinaryLike) => createHash('sha256').update(bytes).digest('hex');
const step = (s: number) => (s * 31415 + 1) & 0xffff;
const along = (from: number, n: number) => { let s = from; for (let i = 0; i < n; i += 1) s = step(s); return s; };

// --- the predeclaration: each kind carries its own rule, and a window list
{
  const shared = { id: 'x', night: 'full-06', seed: 7, inputs: { config: 'a'.repeat(64) } };
  const win = { name: 'w', injectAt: 1, endFrame: 2, fromMs: 0, toMs: 1, cam: 9, viewing: 11 };
  const check = (body: object) => staticPredeclaration(checkSweepPredeclaration({ ...shared, ...body }, 'p'), 'p');
  const identifying = check({ windows: [win], decisionRule: { minR: 0.85, minMargin: 0.1 } });
  assert.ok(identifying.kind === undefined && identifying.decisionRule.minR === 0.85);
  assert.throws(() => check({ kind: 'confirm', windows: [win], decisionRule: { alpha: 0.01, minHits: 2 } }), /decisionRule\.radius/,
    'a confirmation needs its radius');
  assert.throws(() => check({ windows: [win], decisionRule: { radius: 100, alpha: 0.01, minHits: 2 } }), /decisionRule\.minR/,
    'an identification needs its floor');
  assert.throws(() => check({ windows: [], decisionRule: { minR: 0.85, minMargin: 0.1 } }), /at least one window/);
  assert.throws(() => check({ windows: [{ ...win, endFrame: '2' }], decisionRule: { minR: 0.85, minMargin: 0.1 } }), /endFrame/);
  assert.throws(() => check({ kind: 'scan', windows: [win], decisionRule: { minR: 0.85, minMargin: 0.1 } }), /kind/);
}

// --- fixtures
assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
assert.equal(pearson([1, 2, 3], [3, 2, 1]), -1);
assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
const cycle = cycleIndex(47593);
assert.equal(cycle.size, 16384, 'the LCG splits its 65,536 states into four cycles');
assert.equal(cycle.get(along(47593, 597)), 597);
const rule = { minR: 0.85, minMargin: 0.1 };
assert.equal(identify(rule, [{ state: 1, r: 0.9 }, { state: 2, r: 0.7 }]).verdict, 'IDENTIFIED');
assert.equal(identify(rule, [{ state: 1, r: 0.9 }, { state: 2, r: 0.85 }]).verdict, 'UNIDENTIFIED', 'a lead under 0.1');
assert.equal(identify(rule, [{ state: 1, r: 0.8 }]).verdict, 'UNIDENTIFIED', 'r under 0.85');

// --- the native recording a measurement night writes (night-run.sh --static-readout)
const words = (list: readonly number[]) => Buffer.from(new Uint8Array(new Uint32Array(list).buffer)).toString('base64');
assert.equal(regionMeanLuma({ cols: 2, rows: 1, hex: words([0xffffff, 0x000000]) }), 127.5, 'white and black average to the middle');
assert.ok(Math.abs(regionMeanLuma({ cols: 1, rows: 1, hex: words([0xff0000]) }) - 0.299 * 255) < 1e-9, 'Rec. 601 weights');
assert.throws(() => regionMeanLuma({ cols: 3, rows: 1, hex: words([0, 0]) }), /geometry/);
const rows = [{ seq: 1, imageNs: '875229956574475', regions: { static_view: { cols: 1, rows: 1, hex: words([0x808080]) } } },
  { seq: 2, imageNs: null, regions: {} }].map((r) => JSON.stringify(r)).join('\n');
const recorded = [...lumaByImage(rows, 'static_view')];
assert.ok(recorded.length === 1 && recorded[0][0] === 875229956574475 && Math.abs(recorded[0][1] - 128) < 1e-9, 'rows keyed by their image time; an unread frame is skipped');
assert.deepEqual(detrend([1, 2, 3, 4, 5], 3), [-0.5, 0, 0, 0, 0.5]);
assert.throws(() => detrend([1, 2, 3], 4), /odd/);

// --- the records
const recs = ['docs/evidence/full06-static-readout-20261001.json', 'docs/evidence/full06-static-readout-confirm-20261001.json',
  'docs/evidence/full06-static-readout-detrended-20261001.json'].filter((p) => existsSync(join(ROOT, p)));
assert.ok(recs.length >= 1, 'the static readout record exists');
for (const path of recs) {
  const rec = json(path);
  const pre = json(rec.predeclaration.path);
  assert.equal(rec.predeclaration.sha256, sha256(read(rec.predeclaration.path)), `${path}: the predeclaration is the committed one`);
  // Its shared fields, its pinned inputs and its kind's rule all check (the drift check needs the night's inputs).
  staticPredeclaration(checkSweepPredeclaration(pre, rec.predeclaration.path), rec.predeclaration.path);
  assert.deepEqual(rec.inputs, pre.inputs);
  const seedCycle = cycleIndex(rec.seed);
  for (const w of rec.windows) {
    const declared = pre.windows.find((x: { readonly name: string }) => x.name === w.name);
    assert.ok(declared && declared.injectAt === w.injectAt && declared.fromMs === w.fromMs && declared.toMs === w.toMs, `${w.name} is a predeclared window`);
    if (w.decision) {
      assert.equal(w.decision.verdict, identify(pre.decisionRule, w.top10).verdict, `${w.name} verdict`);
      const top = w.top10[0];
      assert.equal(w.topInSeedCycle, seedCycle.has(top.state));
      assert.equal(w.stepsFromSeed, seedCycle.get(top.state) ?? null);
      assert.equal(w.stepsFromSeedLessModelDraws, seedCycle.has(top.state) ? (seedCycle.get(top.state) as number) - w.modelAtInject.draws : null);
      assert.ok(top.r <= w.rQuantiles.max + 1e-12 && w.rQuantiles.p999 <= w.rQuantiles.max);
    }
    if (w.offsets) {   // the confirmation's seed-cycle neighbourhood
      for (const o of w.offsets) assert.equal(o.state, along(rec.seed, w.modelAtInject.draws + o.d), `${w.name} d=${o.d}`);
      const best = w.offsets.reduce((a: { readonly r: number }, b: { readonly r: number }) => (b.r > a.r ? b : a));
      assert.deepEqual(w.best, best);
      assert.equal(w.offsets.length, 2 * pre.decisionRule.radius + 1);
      assert.ok(Math.abs(w.p - (1 - (w.below / w.scanned) ** w.offsets.length)) < 1e-12, `${w.name} p from the scan's rank`);
      assert.equal(w.hit, w.p < pre.decisionRule.alpha, `${w.name} hit`);
    }
  }
  if (rec.neighbourhood) for (const n of rec.neighbourhood) for (const o of n.offsets) assert.equal(o.state, along(rec.seed, n.modelDraws + o.d));
  if (pre.kind === 'confirm') {
    const hits = rec.windows.filter((w: { readonly hit: boolean }) => w.hit).length;
    assert.equal(rec.hits, hits);
    assert.equal(rec.verdict, hits >= pre.decisionRule.minHits ? 'SUPPORTED' : 'NOT_SUPPORTED');
  }
  const { id } = rec;
  assert.equal(id, recordId(id.slice(0, id.lastIndexOf('-')), rec), `${path}: record id`);
}
console.log(`phone-static-readout: correlation, cycle and rule fixtures, and ${recs.length} readout record(s) re-derived from their rows`);
