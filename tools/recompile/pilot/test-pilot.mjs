#!/usr/bin/env node
// Gate for the rebuilt-night pilot records (recompile-pilot-night-v1), run in
// `npm run test:unit`. No binary, no container: it re-derives each committed
// record's verdict and evidenceId from its fields and its input fixture,
// refuses a fixture row that touches outside the 1024 x 768 window, and runs
// the negative controls that must fail. It also pins the controller's tables
// to the core model's graph, so the two cannot drift apart silently.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA, check, evidenceId, iniKeys, verdict } from './record.mjs';
import { SEAL_FOR, LURE_TO, proxyOf, whereIs } from './fnaf3.mjs';
import { MARKERS, ACTORS, WATCH as WATCH4, places } from './fnaf4.mjs';
import { GRAPH, LURE_FROM } from '../../../packages/core/src/mechanics/games/sim-fnaf3.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const RESULTS = join(ROOT, 'tools/recompile/results');
let passed = 0;
const ok = (name) => { passed += 1; console.log(`ok ${passed} - ${name}`); };

// 1. Every committed record re-derives, and every touch is in the window.
const records = readdirSync(RESULTS).filter((f) => f.endsWith('.json'))
  .map((f) => join(RESULTS, f)).filter((p) => JSON.parse(readFileSync(p, 'utf8')).schema === SCHEMA);
assert.ok(records.length >= 1, 'at least one pilot record is committed');
for (const path of records) {
  const r = check(path);
  for (const line of readFileSync(join(ROOT, r.input.fixture), 'utf8').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [frame, tick, op, pointer, x, y] = line.trim().split(/\s+/);
    assert.ok(Number.isInteger(Number(frame)) && Number.isInteger(Number(tick)) && Number.isInteger(Number(pointer)), line);
    assert.ok(['down', 'move', 'up'].includes(op), `${r.input.fixture}: op ${op}`);
    if (op !== 'up') {
      assert.ok(Number(x) >= 0 && Number(x) < 1024 && Number(y) >= 0 && Number(y) < 768,
        `${r.input.fixture}: ${line} touches outside the window`);
    }
  }
  ok(`${r.evidenceId} ${r.game} ${r.status}: re-derived, all touches in the window`);
}

// 2. Negative controls: each must change the verdict or fail the check.
const base = JSON.parse(readFileSync(records[0], 'utf8'));
const diverged = { ...base, replay: { ...base.replay, traceEqual: false } };
assert.equal(verdict(diverged).status, 'REPLAY_DIVERGED');
ok('a replay whose trace differs from the pilot run is not a win');
if (base.winKeys.length) {
  const [key, value] = base.winKeys[0].split('=');
  const preset = { ...base, saveBefore: { ...base.saveBefore, keys: { ...base.saveBefore.keys, [key]: value } } };
  assert.equal(verdict(preset).status, 'NOT_WON');
  ok('a win key already in the save before the night proves nothing');
  const unwritten = { ...base, saveAfter: { ...base.saveAfter, [key]: '0' } };
  assert.equal(verdict(unwritten).status, 'NOT_WON');
  ok('a save without the win key is not a win');
}
const tampered = { ...base, seed: base.seed + 1 };
assert.notEqual(evidenceId(tampered), base.evidenceId);
ok('the evidenceId covers the seed');
assert.deepEqual(iniKeys('[fn4]\nbeat8=1\n\n[options]\nx=2\n'), { 'fn4.beat8': '1', 'options.x': '2' });
ok('iniKeys reads sections');

// 3. The controller's tables against the core model's graph (sim-fnaf3.js).
for (const [where, vent] of Object.entries(SEAL_FOR)) {
  const place = `cam${where.slice(4)}`;
  const edge = GRAPH[place]?.[4];
  assert.ok(edge && edge.includes(`vent${vent}`), `${where}: action 4 does not reach vent ${vent} in the core graph`);
}
ok('SEAL_FOR names the vent each camera\'s action-4 edge enters (core GRAPH)');
for (const [where, cam] of Object.entries(LURE_TO)) {
  const from = where.startsWith('attack stage') ? `attack${where.slice(-1)}` : `cam${where.slice(4)}`;
  const to = `cam${String(cam).padStart(2, '0')}`;
  assert.ok((LURE_FROM[to] ?? []).includes(from), `lure on ${to} does not pull from ${from} in the core table`);
}
ok('LURE_TO uses only pulls the core lure table allows (g319-g341)');

// 4. The state readers over a synthetic pilot line.
const box = (x, y) => ({ box: [x, y, x + 10, y + 10], c: [x + 5, y + 5], fx: x * 1000 + y, v: 1 });
const s = { f: 3, t: 0, o: {
  dhfgh: [box(100, 100)], 'cam 10': [box(98, 98)], 'cam 09': [box(300, 300)],
  'olivier_cameraHitboxA.Active': [{ ...box(90, 90), al: [98 * 1000 + 98] }, { ...box(2000, 90), al: [300 * 1000 + 300] }],
} };
const v = { s, all: (n) => s.o[n] ?? [], one: (n) => (s.o[n] ?? [])[0] ?? null, frame: 3, tick: 0 };
assert.equal(whereIs(v), 'cam 10');
assert.equal(proxyOf(v, 'olivier_cameraHitboxA.Active', 'cam 10').index, 0);
assert.equal(proxyOf(v, 'olivier_cameraHitboxA.Active', 'cam 09'), null, 'an off-window proxy is refused');
ok('whereIs reads the radar dot; proxyOf matches FixedValue and refuses off-window proxies');

// 5. FNaF 4's map reader: every marker and actor it reads is watched, and an
// actor is placed on the marker its box overlaps.
for (const n of [...MARKERS, ...ACTORS, 'follow', 'Freddy counter', 'in closet']) assert.ok(WATCH4.includes(n), `fnaf4 WATCH lacks ${n}`);
const s4 = { f: 3, t: 0, o: { 'left hall near': [box(788, 130)], 'kitchen': [box(954, 20)], Bonnie: [box(790, 132)], Chica: [box(2000, 2000)] } };
const v4 = { s: s4, all: (n) => s4.o[n] ?? [], one: (n) => (s4.o[n] ?? [])[0] ?? null };
assert.deepEqual(places(v4), { foxy: null, Bonnie: 'left hall near', Chica: 'away', Fredbear: null });
ok('fnaf4 places() reads the hidden map markers; WATCH covers them');

console.log(`# pilot records: ${passed} passed`);
