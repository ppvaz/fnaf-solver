/** MonitorUp rule artifact conformance: calibration in, UNKNOWN or OBSERVED out. */
import assert from 'node:assert/strict';
import { monitorRuleDigest, measureMonitorUp, parseMonitorRule } from '../src/sensors/fnaf2/monitor-rule.ts';

const artifact = {
  schema: 'monitor-rule-v1',
  schema_version: 1,
  status: 'calibrated',
  reason: null,
  fact: {
    id: 'monitorUp',
    labels: ['down', 'mask', 'up'],
    unknown_reasons: ['frame-pending', 'frame-stale', 'screen-identity', 'frame-dark',
      'feature-missing', 'ambiguous-threshold', 'sensor-mismatch', 'calibration-refused',
      'monitor-rule-absent', 'monitor-state-unavailable', 'grid-seq-mismatch',
      'grid-unavailable'],
  },
  sensor: {
    id: 'cue-helper-mediaprojection-2400x1080',
    geometry: [2400, 1080],
    sampling: 'helper-grid-20x9-cell-center',
    profile_id: 'moto-g56-v207-landscape',
  },
  adapter: {
    anchors: [
      { cell: 132, x: 1500, y: 780, feature: 'luma', kind: 'present',
        rule: { kind: 'threshold', threshold: 96.5, refuse_band: 72.5 },
        separation_margin: 72.5, up_range: [169, 180],
        not_up: { down: [0, 24], mask: [0, 0] } },
      { cell: 151, x: 1380, y: 900, feature: 'luma', kind: 'present',
        rule: { kind: 'threshold', threshold: 35.5, refuse_band: 17.5 },
        separation_margin: 17.5, up_range: [53, 53],
        not_up: { down: [0, 18], mask: [0, 0] } },
      { cell: 167, x: 900, y: 1020, feature: 'luma', kind: 'absent',
        rule: { kind: 'threshold', threshold: 108.5, refuse_band: 78.5 },
        separation_margin: 78.5, up_range: [1, 30],
        not_up: { down: [187, 187], mask: [187, 187] } },
    ],
    guard: { feature: 'helper_grid_mean_luma', kind: 'floor', min: 5, reason: 'frame-dark' },
    minimum_margin: 5,
    calibration_frames: 42,
    class_counts: { down: 12, mask: 10, up: 20 },
    corpus_reads: { down: { false: 12, true: 0, unknown: 0 },
      mask: { false: 10, true: 0, unknown: 0 }, up: { false: 0, true: 20, unknown: 0 } },
    anim_reads: { false: 1, true: 1, unknown: 10 },
    selection: 'per-cell luma/yellowness worst-case gap, top margins, max 4 present + 2 absent',
    limitations: ['blackout-unproven'],
  },
};

const rule = parseMonitorRule(artifact);
assert.equal(Object.isFrozen(rule), true, 'parsed rule must be frozen');
assert.equal(rule.adapter.anchors.length, 3);
assert.equal(monitorRuleDigest(artifact), monitorRuleDigest(JSON.parse(JSON.stringify(artifact))),
  'digest must be stable across serialization');
assert.notEqual(monitorRuleDigest(artifact), monitorRuleDigest({ ...artifact, adapter: {
  ...artifact.adapter, anchors: artifact.adapter.anchors.slice(0, 2) } }),
  'digest must move when the anchor set moves');

for (const [what, mutate] of [
  ['refused artifact', a => ({ ...a, status: 'refuse', reason: 'anchor-selection-insufficient' })],
  ['wrong schema', a => ({ ...a, schema: 'monitor-rule-v2' })],
  ['wrong fact id', a => ({ ...a, fact: { ...a.fact, id: 'monitorDown' } })],
  ['missing mask label', a => ({ ...a, fact: { ...a.fact, labels: ['down', 'up'] } })],
  ['foreign geometry', a => ({ ...a, sensor: { ...a.sensor, geometry: [1080, 2400] } })],
  ['foreign sampling', a => ({ ...a, sensor: { ...a.sensor, sampling: 'whole-frame-mean' } })],
  ['single anchor', a => ({ ...a, adapter: { ...a.adapter, anchors: a.adapter.anchors.slice(0, 1) } })],
  ['no present anchor', a => ({ ...a, adapter: { ...a.adapter,
    anchors: a.adapter.anchors.filter(anchor => anchor.kind !== 'present') } })],
  ['no absent anchor', a => ({ ...a, adapter: { ...a.adapter,
    anchors: a.adapter.anchors.filter(anchor => anchor.kind !== 'absent') } })],
  ['repeated cell', a => ({ ...a, adapter: { ...a.adapter,
    anchors: [a.adapter.anchors[0], a.adapter.anchors[0], a.adapter.anchors[2]] } })],
  ['non-cell anchor feature', a => ({ ...a, adapter: { ...a.adapter,
    anchors: [...a.adapter.anchors.slice(0, 2),
      { ...a.adapter.anchors[2], feature: 'helper_grid_mean_luma' }] } })],
  ['band over margin', a => ({ ...a, adapter: { ...a.adapter,
    anchors: [...a.adapter.anchors.slice(0, 2),
      { ...a.adapter.anchors[2], rule: { ...a.adapter.anchors[2].rule, refuse_band: 79 } }] } })],
  ['missing separation margin', a => ({ ...a, adapter: { ...a.adapter,
    anchors: [...a.adapter.anchors.slice(0, 2),
      (({ separation_margin: _, ...anchor }) => anchor)(a.adapter.anchors[2])] } })],
  ['cell outside the grid', a => ({ ...a, adapter: { ...a.adapter,
    anchors: [...a.adapter.anchors.slice(0, 2),
      { ...a.adapter.anchors[2], cell: 180 }] } })],
  ['unguarded rule', a => ({ ...a, adapter: { ...a.adapter, guard: { ...a.adapter.guard, kind: 'none' } } })],
  ['invented unknown reason', a => ({ ...a, fact: { ...a.fact, unknown_reasons: ['looks-fine'] } })],
] satisfies [string, (a: typeof artifact) => unknown][]) {
  assert.throws(() => parseMonitorRule(mutate(artifact)), /monitor-rule-v1/, what);
}

const upCells: number[] = [];
for (let index = 0; index < 180; index += 1) upCells.push(0x1e1e1e);
upCells[132] = 0xa9a9a9;   // luma 169 = the worst calibration up frame, edge-inclusive
upCells[151] = 0x353535;   // luma 53 >= 35.5 + 17.5 -> up side
upCells[167] = 0x101010;   // luma 16 <= 108.5 - 78.5 -> up side (covered office)
const downCells = upCells.map((cell, index) => {
  if (index === 132) return 0x0a0a0a;   // 10 <= 24 -> not-up
  if (index === 151) return 0x050505;   // 5 <= 18 -> not-up
  if (index === 167) return 0xbbbbbb;   // 187 >= 187 -> not-up (office visible)
  return cell;
});
const snapshot = (cells: number[], { seq = 7, gridSeq = seq, ageUs = '17',
  screen = 'FNAF2_NIGHT' }: { seq?: number, gridSeq?: number, ageUs?: string, screen?: string } = {}) => ({
  ageUs, screen, seq, gridSeq, cells,
});
const grey = (cells: number[]) => Math.round(
  cells.reduce((total, cell) => total + ((77 * ((cell >> 16) & 0xff)
    + 150 * ((cell >> 8) & 0xff) + 29 * (cell & 0xff)) >> 8), 0) / cells.length);

assert.deepEqual(measureMonitorUp({ ageUs: '17' }, null),
  { signal: 'monitorUp', state: 'UNKNOWN', reason: 'monitor-rule-absent' });
assert.deepEqual(measureMonitorUp({ ageUs: '17', monitorUp: 'true' }, rule),
  { signal: 'monitorUp', state: 'OBSERVED', value: true, confidence: 1 },
  'a fresh explicit helper field wins over the derived rule');
assert.equal((measureMonitorUp({ ageUs: '17', monitorUp: 'UNKNOWN', monitorReason: 'helper-reason' }, rule) as { reason?: string }).reason,
  'monitor-state-unavailable', 'foreign helper reasons stay in vocabulary');
assert.deepEqual((measureMonitorUp({}, rule) as { reason?: string }).reason, 'frame-pending');
assert.deepEqual((measureMonitorUp({ ageUs: '-1' }, rule) as { reason?: string }).reason, 'frame-pending');
assert.deepEqual((measureMonitorUp({ ageUs: '900000' }, rule) as { reason?: string }).reason, 'frame-stale');
assert.deepEqual((measureMonitorUp({ ageUs: '17' }, rule) as { reason?: string }).reason, 'screen-identity');
assert.deepEqual((measureMonitorUp({ ...snapshot(upCells), screen: 'FNAF2_MENU' }, rule) as { reason?: string }).reason, 'screen-identity');
assert.deepEqual((measureMonitorUp(snapshot(Array.from({ length: 180 }, () => 0x000000)), rule) as { reason?: string }).reason,
  'frame-dark', 'a blackout-dark frame refuses on the guard before anchors vote');
assert.deepEqual((measureMonitorUp({ ageUs: '17', screen: 'FNAF2_NIGHT', seq: 7, gridSeq: 7 }, rule) as { reason?: string }).reason,
  'grid-unavailable', 'a snapshot without grid cells cannot vote');
assert.deepEqual((measureMonitorUp(snapshot(upCells, { seq: 7, gridSeq: 8 }), rule) as { reason?: string }).reason, 'grid-seq-mismatch',
  'the grid must be the same frame as the snapshot');

const mixed = [...upCells];
mixed[167] = 0xbbbbbb;  // office visible under an otherwise up frame
assert.deepEqual(measureMonitorUp(snapshot(mixed), rule),
  { signal: 'monitorUp', state: 'UNKNOWN', reason: 'ambiguous-threshold' },
  'mixed anchor evidence must refuse, never vote');
const inBand = [...upCells];
inBand[132] = 0x606060;  // luma 96: exactly at the threshold, between the bands
assert.equal((measureMonitorUp(snapshot(inBand), rule) as { reason?: string }).reason, 'ambiguous-threshold');
const edgeDown = [...downCells];
edgeDown[132] = 0x180000;  // luma 24: exactly the worst calibration not-up frame
assert.deepEqual(measureMonitorUp(snapshot(edgeDown), rule),
  { signal: 'monitorUp', state: 'OBSERVED', value: false, confidence: 1 },
  'the worst calibration down frame classifies, inclusive at the edge');
assert.deepEqual(measureMonitorUp(snapshot(upCells), rule),
  { signal: 'monitorUp', state: 'OBSERVED', value: true, confidence: 1 });
assert.deepEqual(measureMonitorUp(snapshot(downCells), rule),
  { signal: 'monitorUp', state: 'OBSERVED', value: false, confidence: 1 });
assert.equal(grey(upCells) > 0, true, 'sanity: grid luma derivable from cells');

console.log('monitor rule artifact: parse refusal, digest binding, and fail-closed derivation pass');
