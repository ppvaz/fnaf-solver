#!/usr/bin/env node
// FIXTURE for phone-encounter-replay.mjs (clock, press rules, window codes, scoring, the rebuild's occupant),
// then the committed rebuild-vs-phone record's own arithmetic, re-derived from its rows without the binary
// or any private input. In `npm run test:unit`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  FRAME_MS, OFFICE_FRAME, check, compareOutcome, compareSides, cumTick, cumulative, derive, landingLatency, maskPresses,
  officeClock, overlapSeries, rebuiltOccupant, scoreWindows, traceTick, verdictOf, windowCodes, checkPressFile, phoneSchedule,
} from './phone-encounter-replay.mjs';
import { drawTrace, measuredClock } from './model-draw-trace.mjs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

// --- the clock: update 0 is one 60 Hz frame; a captured interval becomes 1-3 updates (catch-up)
{
  const ms = [0, 16, 33, 83, 100];                     // frames at 0, 16, 33, 83 (a 50 ms stall), 100 ms
  const ns = ms.map((m) => 1_000_000_000 + m * 1e6);
  const c = officeClock([5, ...ns], 1);                // row 0 is before the night
  assert.deepEqual(c.deltas.map((d) => Number(d.toFixed(3))), [16.667, 16, 17, 48, 1, 1, 17]);
  assert.deepEqual(c.passStart, [0, 1, 2, 3, 6]);
  assert.deepEqual(c.imageMs, [0, 16, 33, 83, 100]);
  const raw = officeClock(ns, 0, { catchUp: false });
  assert.deepEqual(raw.deltas.map((d) => Number(d.toFixed(3))), [16.667, 16, 17, 50, 17]);
  assert.throws(() => officeClock([2, 1], 0), /not increasing/);
  // cum: update u starts at the sum of the deltas before it, and runs at 60 Hz past the list
  assert.deepEqual(cumulative([10, 20], 3).map((x) => Number(x.toFixed(3))), [0, 10, 30, 46.667]);
  // the cum rule: mid-update; the trace rule: the first captured frame at or after T, its pass's first update
  assert.equal(cumTick(0, [10, 20]), 0);
  assert.equal(cumTick(5, [10, 20]), 0);
  assert.equal(cumTick(5.1, [10, 20]), 1);
  assert.equal(cumTick(20, [10, 20]), 1);
  assert.equal(cumTick(20.1, [10, 20]), 2);
  assert.equal(traceTick(-3, c), 0);
  assert.equal(traceTick(16, c), 1);
  assert.equal(traceTick(16.5, c), 2);
  assert.equal(traceTick(34, c), 3, 'a press during the stall is read by the first loop of the pass that drew 83 ms');
  assert.equal(traceTick(100, c), 6);
  assert.equal(traceTick(110, c), c.deltas.length, 'past the trace: 60 Hz from its last update');
  assert.equal(traceTick(120, c), c.deltas.length + 1);
}

// --- the model's measured clock replaces the hook constants; a constant 50/3 clock is the fixed step
{
  const { frameMs, frameValue5 } = measuredClock([10, 40, 90]);
  assert.equal(frameMs(1), 10);
  assert.equal(frameMs(4), 1000 / 60);
  assert.equal(frameValue5(2), 40 / (1000 / 60));
  assert.equal(frameValue5(3), 4, 'global value 5 is capped at 4');
  const options = JSON.parse(read('tools/recompile/sourced-rebuild-model-options.json'));
  const fixed = drawTrace({ night: 1, seed: 24850, frames: 900, modelOptions: options });
  const clocked = drawTrace({ night: 1, seed: 24850, frames: 900, modelOptions: options, frameTimes: Array(900).fill(1000 / 60) });
  assert.deepEqual(clocked.out, fixed.out, 'a measured constant 60 Hz clock is the fixed-step model');
  const slow = drawTrace({ night: 1, seed: 24850, frames: 900, modelOptions: options, frameTimes: Array(900).fill(20) });
  assert.notDeepEqual(slow.out, fixed.out, 'a slower clock moves the countdown draws');
  assert.throws(() => drawTrace({ night: 1, seed: 1, frames: 2, modelOptions: {}, frameTimes: [16] }), /must carry frameMs/);
}

// --- the schedule at a measured release reproduces a press file; a changed action is refused
{
  const winner = JSON.parse(read('tools/device/campaign-night6-h-winner.json'));
  const sched = phoneSchedule(winner, 6, 4963.6);
  assert.equal(sched.queueMs.length, 517);
  assert.deepEqual(sched.queueMs[0], [4963.6, 'press', 'monitor']);
  const actions = sched.queueMs.map(([ms, kind, action]) => [Number(ms.toFixed(1)), kind, action]);
  assert.equal(checkPressFile(sched.queueMs, { actions }), 517);
  const bad = actions.map((a) => [...a]); bad[40][2] = 'wind';
  assert.throws(() => checkPressFile(sched.queueMs, { actions: bad }), /press file action 40/);
  const presses = maskPresses(sched.queueMs.map(([ms, kind, action]) => [Math.round(ms), kind, action]));
  assert.equal(presses.filter((p) => p.i % 2 === 0).length, 43, 'Night 6 h sends 43 mask-ons; the 43rd comes after 6 AM');
}

// --- the rebuild's occupant: danger first, then the streak markers on `in office`, then the overlays
{
  const counters = ['being attacked by', 'in danger', 'got you stage', 'viewing', 'viewing hall light'];
  const names = ['old bonnie', 'old chica', 'old freddy', 'new freddy', 'new bonnie', 'new chica', 'new foxy', 'balloon boy',
    'Active 19', 'chicalookatyou'];
  const none = [0, 0, 0, 0, 0, 0, 0, 0, null, null];
  assert.equal(rebuiltOccupant([0, 0, 0, 0, 0], counters, [0, 1, 0, 0, 0, 0, 0, 0, null, null], names), null, 'no danger, no occupant');
  assert.equal(rebuiltOccupant([0, 1, 1, 0, 0], counters, [0, 1, 0, 0, 0, 0, 0, 0, null, null], names), 'C');
  assert.equal(rebuiltOccupant([0, 1, 1, 0, 0], counters, [0, 0, 0, 1, 0, 0, 0, 0, null, null], names), 'f');
  assert.equal(rebuiltOccupant([0, 1, 1, 0, 0], counters, [0, 0, 0, 0, 0, 0, 0, 0, 0, null], names), 'b', 'Toy Bonnie\'s overlay present');
  assert.equal(rebuiltOccupant([0, 1, 1, 0, 0], counters, none, names), '*');
  const text = ['# frame 3 seeded 7', `# overlaps in office:${names.join(',')}`, '# overlap 3 0 0 1 0 0 0 0 0 0 - -',
    '# overlap 3 1 1 0 0 0 0 0 0 0 - 1', '# frame 4 seeded 7', '# overlap 4 0 1 1 1 1 1 1 1 1 1 1', ''].join('\n');
  const o = overlapSeries(text, OFFICE_FRAME);
  assert.deepEqual(o.names, names);
  assert.deepEqual([...o.series.keys()], [0, 1], 'only the office visit');
  assert.deepEqual(o.series.get(1), [1, 0, 0, 0, 0, 0, 0, 0, null, 1]);
}

// --- windows: the even mask presses; '.' needs the window played; a refused press is '?'
{
  const cum = cumulative(Array(400).fill(10), 400);    // 10 ms updates
  const states = new Map();
  for (let u = 0; u < 400; u += 1) states.set(u, { maskValue: 0, occupant: null });
  const put = (from, to, s) => { for (let u = from; u <= to; u += 1) states.set(u, { ...states.get(u), ...s }); };
  put(10, 11, { maskValue: 1 }); put(12, 60, { maskValue: 2 }); put(20, 30, { occupant: 'B' });      // window 0: B at 20
  put(200, 201, { maskValue: 1 }); put(202, 399, { maskValue: 2 });                                  // window 1: empty
  // window 2 at 300: the mask is already on, so the press did not put it on
  const presses = [{ tick: 10, i: 0 }, { tick: 100, i: 1 }, { tick: 200, i: 2 }, { tick: 250, i: 3 }, { tick: 300, i: 4 }];
  const w = windowCodes(presses, (u) => states.get(u) ?? null, cum, cum[400]);
  assert.deepEqual(w.map((x) => x.code), ['B', '.', '?']);
  assert.equal(w[0].occupantTick, 20);
  assert.equal(w[2].why, 'mask did not go on');
  const early = windowCodes([{ tick: 200, i: 0 }], (u) => (u < 250 ? states.get(u) : null), cum, cum[250]);
  assert.deepEqual(early.map((x) => x.code), ['?'], 'a night that ends inside an empty window leaves it UNKNOWN');
  const late = windowCodes([{ tick: 10, i: 0 }], (u) => (u < 25 ? states.get(u) : null), cum, cum[25]);
  assert.deepEqual(late.map((x) => x.code), ['B'], 'a positive read survives the end of the night');
}

// --- scoring
{
  assert.deepEqual(scoreWindows('?.C*B', '.CC.?'), { read: 4, occupied: 3, compared: 3, agree: 1, hits: 1, occupancyAgree: 1,
    unplayed: 1, firstDisagreement: { window: 1, phone: '.', side: 'C' } });
  assert.deepEqual(scoreWindows('..C.', '.?C.').firstDisagreement, { window: 1, phone: '.', side: '?' },
    'a window the phone read and the side never played is a disagreement: the phone was there to read it');
  assert.equal(scoreWindows('..', '.?').agree, 1);
  assert.equal(scoreWindows('*', '*').agree, 0, 'an unnamed occupant never agrees on the character');
  assert.equal(scoreWindows('*', 'C').occupancyAgree, 1, 'it agrees on occupancy');
  assert.deepEqual(compareSides('.B?C', '.C.C'), { compared: 3, agree: 2, firstDisagreement: { window: 1, a: 'B', b: 'C' } });
  assert.deepEqual(compareOutcome({ result: 'death', seedClockMs: 100000 }, { result: 'death', endMs: 30000 }),
    { sameResult: true, deltaMs: -70000, agrees: false }, 'a death a minute early is not the phone\'s end');
  assert.equal(compareOutcome({ result: 'death', seedClockMs: 100000 }, { result: 'death', endMs: 95000 }).agrees, true);
  assert.equal(compareOutcome({ result: '6am', seedClockMs: 422706 }, { result: '6am', endMs: 420013 }).agrees, true);
  assert.equal(compareOutcome({ result: '6am', seedClockMs: 422706 }, { result: 'death', endMs: 420013 }).agrees, false);
  assert.equal(compareOutcome({ result: 'UNKNOWN', seedClockMs: null }, { result: 'death', endMs: 1 }).agrees, null);
}

// --- the landing latency: the first frame whose monitor region changes after a send made from the office view
{
  const n = 600;
  const image_ns = Array.from({ length: n }, (_, k) => 5e9 + Math.round(k * FRAME_MS * 1e6));
  const monitor_luma = Array(n).fill(117);
  const sends = [];
  for (let s = 0; s < 6; s += 1) {
    const k = 100 + s * 80;                               // a send inside frame k's interval, drawn 4 frames on
    sends.push((k - 0.5) * FRAME_MS);
    for (let j = k + 4; j < k + 40; j += 1) monitor_luma[j] = 59;
  }
  const lat = landingLatency({ image_ns, monitor_luma }, 0, sends);
  assert.equal(lat.raises, 6);
  assert.equal(lat.officeViewLuma, 117);
  assert.equal(lat.medianMs, Number((4.5 * FRAME_MS).toFixed(1)));
  const lateSend = [...sends, (100 + 20) * FRAME_MS];     // sent while the camera view (59) shows: a drop, not counted
  assert.equal(landingLatency({ image_ns, monitor_luma }, 0, lateSend).raises, 6);
  assert.throws(() => landingLatency({ image_ns, monitor_luma }, 0, sends.slice(0, 4)), /measurable raises/);
}

// --- the committed record: its arithmetic, re-derived from its rows
const result = JSON.parse(read('tools/recompile/results/phone-encounters-20260927.json'));
const summary = check(result);
assert.equal(result.method.configSha256, sha256(read('tools/recompile/phone-encounter-nights.json')),
  'the record names the committed night config');
assert.equal(result.method.modelOptionsSha256, sha256(read(result.method.modelOptions)), 'and the committed model options');
const modelRecord = JSON.parse(read('docs/evidence/model-encounter-fidelity-20260927.json'));
for (const night of result.nights) {
  assert.equal(night.phone.windows.length, 42, `${night.name}: 42 windows`);
  assert.equal(verdictOf(night, derive(night)), night.verdict);
  assert.equal(night.winnerSha256, sha256(read(night.winner)), `${night.name}: the binding replayed is the committed one`);
  // the model strings this record sets beside the rebuild are the committed encounter record's
  const n6 = modelRecord.nights.find((n) => n.name === night.name);
  const n7 = modelRecord.night7Reproduction.rows.find((r) => r.name === `${night.name}-k3`);
  const committedModel = n6 ? n6.baseline.find((r) => r.seed === night.seed).windows : n7.windows;
  assert.equal(night.modelRecord.windows, committedModel, `${night.name}: model record windows`);
  if (n6) {
    // reused phone reads are the encounter record's; exclusions only ever turn a read into UNKNOWN
    const reader = night.phone.readerWindows ?? night.phone.windows;
    assert.equal(reader, n6.phoneWindows, `${night.name}: phone reads`);
    for (let k = 0; k < 42; k += 1) assert.ok(night.phone.windows[k] === reader[k] || night.phone.windows[k] === '?', `${night.name} window ${k}`);
    for (const { window } of night.phone.excluded ?? []) assert.equal(night.phone.windows[window], '?');
  }
  for (const v of night.variants) {
    assert.equal(v.windows.rows.length, 43, `${night.name}/${v.variant}: one row per schedule mask-on`);
    assert.ok(v.windows.rows[42].ms > 420000 && v.windows.rows[42].rebuilt === '?' && v.windows.rows[42].model === '?',
      'the 43rd mask-on comes after the night on both sides');
    assert.ok(v.windows.rows.every((r, k) => r.index === k && (k === 0 || r.tick > v.windows.rows[k - 1].tick)), 'windows in schedule order');
  }
}
const evidence = JSON.parse(read('docs/evidence/rebuild-phone-encounters-20260927.json'));
assert.equal(evidence.schema, 'evidence-record-v1');
assert.match(evidence.claimLevel, /^MODEL_ONLY/, 'a rebuild comparison is never a device claim');
assert.equal(evidence.result.evidenceId, result.evidenceId, 'the evidence record cites this result');
assert.equal(evidence.result.status, result.status);
for (const row of evidence.nights) {
  const night = result.nights.find((n) => n.name === row.name);
  assert.equal(row.verdict, night.verdict, `${row.name}: verdict`);
  const d = night.derived[night.primaryVariant].rebuiltVsPhone;
  assert.deepEqual(row.rebuiltVsPhone, { agree: d.agree, compared: d.compared, hits: d.hits, occupied: d.occupied },
    `${row.name}: the evidence record's counts are the result's`);
  assert.deepEqual(row.firstDisagreement, d.firstDisagreement, `${row.name}: first disagreeing window`);
}
console.log(`phone-encounter-replay: fixtures pass; ${summary.evidenceId} ${summary.status} over ${summary.nights} nights re-derived`);
