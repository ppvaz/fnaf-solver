#!/usr/bin/env node
// FIXTURE for phone-region-readout.ts: the 60 Hz frame-to-update rule, the alias-aware reading, the readout's own
// strength recovered from a synthetic night of known gain and noise, the night inputs derived from a packed run (and
// refused for another predeclaration), then every docs/evidence/s2-region-readout*.json re-derived from its rows.
// No phone, capture or model scan. In `npm run test:unit`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveInputs, identifyReading, measuredNight, periodValue, readoutStrength, regionImages, updateOf } from './phone-region-readout.ts';
import { anchorIndex, back, seedCandidates } from './phone-seed-readout.ts';
import { identifySeed } from './phone-seed-scan.ts';
import { powerCheckPassed } from './sweep-common.ts';
import { check as checkEncounters } from './phone-encounter-replay.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const step = (s: number) => (s * 31415 + 1) & 0xffff;
const along = (s: number, n: number) => { let x = s; for (let i = 0; i < n; i += 1) x = step(x); return x; };

// --- frames to updates
assert.equal(updateOf(0, 81), 4, 'the onset frame is update floor(81 / 16.67)');
assert.equal(updateOf(1000 - 81, 81), 60, 'one second after the run start is update 60');

// --- a period's value: the mean, or robustly the median of the frames between the flash and black
assert.equal(periodValue([10, 20, 30]), 20);
const robust = { above: 250, below: 5, statistic: 'median' };
assert.equal(periodValue([40, 41, 255, 42], robust), 41, 'the camera-switch flash (255) is dropped and the median taken');
assert.equal(periodValue([0, 255], robust), null, 'a period of flash and black frames only has no value');

// --- the reading: aliases a few generator steps away are the same reading, not rivals
const rule = { minR: 0.85, minMargin: 0.08, aliasSteps: 5 };
const top = 12345;
const scores = [{ state: top, r: 0.95 }, { state: along(top, 3), r: 0.93 }, { state: along(top, 16384 - 2), r: 0.92 }, { state: 777, r: 0.8 }];
const read = identifyReading(rule, scores);
assert.equal(read.verdict, 'IDENTIFIED');
assert.equal((read.rival as { state: number }).state, 777, 'the rival is the best state more than aliasSteps away');
assert.equal(identifyReading(rule, [...scores, { state: 778, r: 0.9 }]).verdict, 'UNIDENTIFIED', 'a far rival within the margin');
assert.equal(identifyReading(rule, [{ state: top, r: 0.84 }]).verdict, 'UNIDENTIFIED', 'r under minR');
assert.equal(identifyReading(rule, [{ state: top, r: null }]).verdict, 'UNIDENTIFIED', 'no scored state');

// --- the readout's strength from a synthetic night of known gain and noise
{
  let s = 99; const u = () => ((s = (s * 1664525 + 1013904223) >>> 0) + 0.5) / 2 ** 32;
  const g = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const coef = new Map();
  const coefficientAt = (_win: unknown, ms: number) => { const k = Math.floor(ms / 100); if (!coef.has(k)) coef.set(k, 0.3 + 0.2 * u()); return coef.get(k); };
  const windows = [{ fromMs: 10000, toMs: 13300 }, { fromMs: 20000, toMs: 23300 }, { fromMs: 30000, toMs: 33300 }];
  for (const [gain, noiseSd] of [[30, 1], [30, 2], [10, 1]]) {
    const images = windows.flatMap((w) => { const xs = []; for (let ms = w.fromMs; ms <= w.toMs; ms += 33.3) xs.push({ imageMs: ms, luma: 40 + 6 * Math.sin(ms / 640) + gain * coefficientAt(w, ms) + noiseSd * g() }); return xs; });
    const got = readoutStrength(images, windows, coefficientAt);
    assert.ok(Math.abs((got.noiseSd as number) - noiseSd) / noiseSd < 0.35, `noise ${noiseSd} recovered as ${got.noiseSd}`);
    assert.ok(Math.abs((got.gain as number) - gain) / gain < 0.25, `gain ${gain} recovered as ${got.gain}`);
    assert.equal(got.windows, 3);
  }
}

// --- frames on the onset clock, and the night inputs from a packed run
{
  const rows = [{ seq: 2, imageNs: '2000500000', regions: { v: { cols: 1, rows: 1, hex: Buffer.from(new Uint8Array(new Uint32Array([0x404040]).buffer)).toString('base64') } } },
    { reopened: 1, afterSeq: 2, atHostMs: 5 },
    { seq: 1, imageNs: '2000000000', regions: { v: { cols: 1, rows: 1, hex: Buffer.from(new Uint8Array(new Uint32Array([0x808080]).buffer)).toString('base64') } } }];
  const images = regionImages(rows.map((r) => JSON.stringify(r)).join('\n'), 'v', 1900);
  assert.deepEqual(images.map((im) => im.imageMs), [100, 100.5], 'frames sorted by image time, minus the onset; a reopen row is not a frame');
  const root = mkdtempSync(join(tmpdir(), 'region-readout-'));
  try {
    mkdirSync(join(root, 'docs/evidence/runs/r1'), { recursive: true });
    mkdirSync(join(root, 'captures/static-readouts'), { recursive: true });
    writeFileSync(join(root, 'docs/evidence/runs/r1/events.jsonl'), [
      { type: 'origin.anchor', status: 'scheduled', onsetDeviceMs: 309804879.3 },
      { type: 'origin.anchor', status: 'released', releasedAimMs: 2434.02 }].map((r) => JSON.stringify(r)).join('\n'));
    writeFileSync(join(root, 'captures/static-readouts/r1.jsonl'), 'rows\n');
    const inputs = deriveInputs('r1', 'abc', root);
    assert.deepEqual([inputs.onsetDeviceMs, inputs.releasedAimMs, inputs.readout.sha256], [309804879.3, 2434.02, sha('rows\n')]);
    const pre = { night: { winner: 'w', staticReadout: { region: 'static_view' } }, method: { seedToFirstFrameMs: 81 } };
    const night = measuredNight(pre, inputs, 'abc');
    assert.equal(night.releaseAfterRunStartMs, 81 + 2434.02);
    assert.equal(night.staticReadout.region, 'static_view');
    assert.throws(() => measuredNight(pre, inputs, 'other'), /another predeclaration/);
    writeFileSync(join(root, 'docs/evidence/runs/r1/events.jsonl'), JSON.stringify({ type: 'origin.anchor', status: 'scheduled', onsetDeviceMs: 1 }));
    assert.throws(() => deriveInputs('r1', 'abc', root), /no scheduled onset and released anchor/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- the seed from a read stream (phone-seed-readout.ts)
for (const s of [0, 12345, 57136]) assert.equal(back(along(s, 289), 289), s, `stepping back undoes stepping forward from ${s}`);
assert.equal(anchorIndex([{ differ: null }, { differ: 0 }, { differ: 3 }, { differ: 0 }], 10), 1, 'the earliest of two consecutive consistent pairs');
assert.equal(anchorIndex([{ differ: 0 }, { differ: 99 }, { differ: 0 }], 10), null, 'no two consecutive consistent pairs');
{
  // The 0/20 night's exploratory lead, from its committed record: wind-1's state 57136, the model's 284 draws to it,
  // the onset on the phone's wall clock from the pack; the wall-clock seed 63 ms before onset needs exactly 5 more.
  const rec = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/s2-region-readout-night7-0of20-20261001.json'), 'utf8'));
  assert.equal(rec.windows[0].reading.top.state, 57136);
  const events = readFileSync(join(ROOT, 'docs/evidence/runs', rec.run, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const onset = events.find((r) => r.type === 'origin.anchor' && r.status === 'scheduled').onsetPhoneWallMs;
  const rows = seedCandidates(onset, 57136, 284, 55, 90);
  assert.deepEqual(rows.filter((r) => r.c === 5).map((r) => r.x), [63], 'the lead: x = 63 ms with c = 5, and no other x in the bracket');
}

const canon = (v: unknown): string => Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);
// --- the seed-scan rule (phone-seed-scan.ts): a clear top seed, never a close pair or a weak fit
const seedRule = { minR: 0.85, minMargin: 0.2 };
assert.equal(identifySeed(seedRule, [{ seed: 23712, r: 0.973 }, { seed: 13488, r: 0.585 }]).verdict, 'IDENTIFIED');
assert.equal(identifySeed(seedRule, [{ seed: 1, r: 0.95 }, { seed: 2, r: 0.8 }]).verdict, 'UNIDENTIFIED', 'a lead under 0.2');
assert.equal(identifySeed(seedRule, [{ seed: 1, r: 0.84 }]).verdict, 'UNIDENTIFIED', 'r under 0.85');
assert.equal(identifySeed(seedRule, []).verdict, 'UNIDENTIFIED', 'no seed scored');

// --- the power check: power is shown by recovering what was planted, so planting nothing shows none
assert.equal(powerCheckPassed([], () => true), false, 'an empty power check is not power');
assert.equal(powerCheckPassed([1, 2], (n) => n > 0), true);
assert.equal(powerCheckPassed([1, -2], (n) => n > 0), false, 'one planted state not recovered fails the check');

// --- the whole-seed scan agrees with the injection analysis (docs/evidence/s2-seed-scan-night7-0of20-20261001.json)
{
  const scan = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/s2-seed-scan-night7-0of20-20261001.json'), 'utf8'));
  const rs = scan.top20.map((s: { r: number }) => s.r);
  assert.deepEqual(rs, [...rs].sort((a: number, b: number) => b - a), 'the scan ranks by mean r');
  assert.ok(scan.top20.every((s: { r: number, perWindow: number[] }) => Math.abs(s.r - s.perWindow.reduce((a, b) => a + b, 0) / s.perWindow.length) < 1e-12), 'a seed scores its windows\' mean r');
  assert.equal(scan.top20[0].seed, back(57136, 284), 'the scanned seed is wind-1\'s read state stepped back by the model\'s draws');
  const { id, ...body } = scan;
  assert.equal(id, `s2-seed-scan-night7-0of20-${sha(canon(body)).slice(0, 16)}`, 'seed scan record id');
}

// --- the release-latency bound (docs/evidence/phone-release-latency-20261001.json): each night's outcomes split by
// release latency, every 6 AM at a lower latency than every death, and the bound the v2 predeclaration names inside it
{
  const rel = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/phone-release-latency-20261001.json'), 'utf8'));
  for (const n of rel.nights) {
    const won = n.rows.filter((r: { outcome: string }) => r.outcome === '6am').map((r: { releaseMs: number }) => r.releaseMs);
    const lost = n.rows.filter((r: { outcome: string }) => r.outcome !== '6am').map((r: { releaseMs: number }) => r.releaseMs);
    assert.ok(won.length && lost.length && Math.max(...won) < Math.min(...lost), `${n.night}: outcomes split by release latency`);
    assert.ok(lost.includes(n.pressLandingMs), `${n.night}: the press's own latency on releases loses the night`);
  }
  const v2 = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/s2-seed-scan-night7-1020-v2-predeclaration-20261001.json'), 'utf8'));
  for (const n of rel.nights) assert.ok(n.rows.find((r: { releaseMs: number }) => r.releaseMs === v2.releaseLatencyMs)?.outcome === '6am', `${n.night}: the v2 release latency plays the night as the phone did`);
  const { id, ...body } = rel;
  assert.equal(id, `phone-release-latency-${sha(canon(body)).slice(0, 16)}`, 'release latency record id');
}

// --- the recompiled game with releases at 20 ms (docs/evidence/rebuild-release20-full06-20261001.json): the committed
// compare result's arithmetic rechecked, the rebuild and the model at 6 AM and alike on every window, the control dead
{
  const rec = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/rebuild-release20-full06-20261001.json'), 'utf8'));
  assert.equal(rec.result.sha256, sha(readFileSync(join(ROOT, rec.result.path))), 'the compare result is the committed one');
  checkEncounters(JSON.parse(readFileSync(join(ROOT, rec.result.path), 'utf8')));
  const r20 = rec.variants['landed-r20']; const ctl = rec.variants.landed;
  assert.equal(r20.rebuilt.outcome.result, '6am'); assert.equal(r20.model.outcome.result, '6am');
  assert.equal(r20.rebuilt.windows, r20.model.windows, 'rebuild and model alike on every window');
  assert.equal(r20.drawSplit ?? null, null, 'no draw split');
  assert.notEqual(ctl.rebuilt.outcome.result, '6am', 'the press-latency control loses the night');
  const { id, ...body } = rec;
  assert.equal(id, `rebuild-release20-${sha(canon(body)).slice(0, 16)}`, 'rebuild release record id');
}

// --- the three traced nights (docs/evidence/rebuild-release20-three-nights-20261001.json): the committed result rechecked;
// only full-06's outcome moves to the phone's
{
  const rec = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/rebuild-release20-three-nights-20261001.json'), 'utf8'));
  assert.equal(rec.result.sha256, sha(readFileSync(join(ROOT, rec.result.path))), 'the three-night result is the committed one');
  checkEncounters(JSON.parse(readFileSync(join(ROOT, rec.result.path), 'utf8')));
  const agrees = rec.nights.filter((n: { variants: Record<string, { derived: { rebuiltOutcome: { agrees: boolean | null } } }> }) => n.variants['landed-r20'].derived.rebuiltOutcome.agrees === true).map((n: { name: string }) => n.name);
  assert.deepEqual(agrees, ['full-06'], 'with releases at 20 ms only full-06\'s outcome agrees with the phone');
  const { id, ...body } = rec;
  assert.equal(id, `rebuild-release20-3nights-${sha(canon(body)).slice(0, 16)}`, 'three-night record id');
}

// --- the records
const records = readdirSync(join(ROOT, 'docs/evidence')).filter((f) => /^s2-region-readout.*\.json$/.test(f) && !f.includes('-predeclaration-'));
for (const file of records) {
  const rec = JSON.parse(readFileSync(join(ROOT, 'docs/evidence', file), 'utf8'));
  if (rec.schema === 'phone-region-readout-v1-inputs') {
    // A night's derived inputs: bound to a committed predeclaration, read from a committed pack.
    const pre = readdirSync(join(ROOT, 'docs/evidence')).filter((f) => f.includes('-predeclaration-'))
      .find((f) => sha(readFileSync(join(ROOT, 'docs/evidence', f))) === rec.predeclarationSha256);
    assert.ok(pre, `${file}: no committed predeclaration has sha256 ${rec.predeclarationSha256}`);
    const derived = deriveInputs(rec.run, rec.predeclarationSha256, ROOT, { readoutSha256: rec.readout.sha256 });
    assert.deepEqual(derived, rec, `${file}: re-derived from the pack`);
    continue;
  }
  for (const night of rec.nights ?? []) {
    const consistent = night.pairs.filter((p: { differ: number | null }) => p.differ !== null && Math.abs(p.differ) <= rec.rule.consistencyDraws).length;
    assert.equal(night.consistent, consistent, `${file} ${night.label}: consistent pairs`);
    const verdict = consistent >= rec.rule.supportConsistentPairs ? 'SUPPORTED' : consistent <= rec.rule.refuteConsistentPairs ? 'NOT_SUPPORTED' : 'INCONCLUSIVE';
    assert.equal(night.verdict, verdict, `${file} ${night.label}: verdict`);
  }
  if (Array.isArray(rec.pairs)) {
    // A night's analysis: the consistent pairs, the analysis verdict, and the power check that can override it.
    const consistent = rec.pairs.filter((p: { differ: number | null }) => p.differ !== null && Math.abs(p.differ) <= rec.rule.consistencyDraws).length;
    assert.equal(rec.consistent, consistent, `${file}: consistent pairs`);
    assert.equal(rec.pairs.length, rec.windows.filter((w: { reading: { top: unknown } }) => w.reading.top).length - 1, `${file}: one pair per consecutive window`);
    const analysis = consistent >= rec.rule.supportConsistentPairs ? 'SUPPORTED' : consistent <= rec.rule.refuteConsistentPairs ? 'NOT_SUPPORTED' : 'INCONCLUSIVE';
    assert.equal(rec.analysisVerdict, analysis, `${file}: analysis verdict`);
    const powered = rec.powerCheck.planted.every((p: { verdict: string }) => p.verdict === 'SUPPORTED');
    assert.equal(rec.powerCheck.powered, powered, `${file}: power check`);
    assert.equal(rec.verdict, powered ? analysis : 'UNINFORMATIVE', `${file}: verdict`);
    assert.equal(rec.identified, rec.windows.filter((w: { reading: { verdict: string } }) => w.reading.verdict === 'IDENTIFIED').length, `${file}: identified windows`);
  }
  const { id, ...body } = rec;
  assert.equal(id, `${id.slice(0, id.lastIndexOf('-'))}-${sha(canon(body)).slice(0, 16)}`, `${file}: record id`);
  if (rec.predeclaration?.path && existsSync(join(ROOT, rec.predeclaration.path)))
    assert.equal(rec.predeclaration.sha256, sha(readFileSync(join(ROOT, rec.predeclaration.path))), `${file}: the predeclaration is the committed one`);
}
console.log(`phone-region-readout: update rule, alias-aware reading, strength recovery and night-input fixtures${records.length ? `, and ${records.length} record(s) re-derived` : ''}`);
