/** Calibration-state rule conformance. All grids and rules are synthetic:
 * nothing here measures a handset, and an unfitted or refused artifact can
 * never become an OBSERVED state. */
import assert from 'node:assert/strict';
import { calibrationStateRuleDigest, maskRuleDigest, parseMaskRule,
  parseCalibrationStateRule, measureCalibrationState, measureMaskOn } from '@sixam/play';
import { monitorRuleDigest } from '@sixam/play';

const cell = (red: number, green: number, blue: number) => (red << 16) | (green << 8) | blue;
const grid = new Array(180).fill(cell(40, 40, 40));
// Monitor UP: cell 10 shows the map (present anchor high), cell 20 is the
// covered office (absent anchor reads its low/up side).
grid[10] = cell(200, 200, 120);
grid[20] = cell(10, 10, 10);
// Mask OFF: cell 30 has no overlay (present anchor low), cell 40 shows the
// office (absent anchor reads its high/not-up side).
grid[30] = cell(40, 40, 40);
grid[40] = cell(200, 200, 120);

const monitorRule = { schema: 'monitor-rule-v1', schema_version: 1, status: 'calibrated',
  fact: { id: 'monitorUp', labels: ['down', 'mask', 'up'],
    unknown_reasons: ['frame-stale', 'frame-dark', 'ambiguous-threshold', 'grid-unavailable'] },
  sensor: { geometry: [2400, 1080], sampling: 'helper-grid-20x9-cell-center' },
  adapter: { anchors: [
    { cell: 10, feature: 'yellowness', kind: 'present', rule: { kind: 'threshold', threshold: 30, refuse_band: 5 }, separation_margin: 40 },
    { cell: 20, feature: 'luma', kind: 'absent', rule: { kind: 'threshold', threshold: 60, refuse_band: 10 }, separation_margin: 90 },
  ], guard: { kind: 'floor', feature: 'helper_grid_mean_luma', min: 5, reason: 'frame-dark' } } };
const maskRule = { schema: 'mask-rule-v1', schema_version: 1, status: 'calibrated',
  fact: { id: 'maskOn', labels: ['off', 'on'],
    unknown_reasons: ['frame-dark', 'ambiguous-threshold', 'grid-unavailable'] },
  sensor: { geometry: [2400, 1080], sampling: 'helper-grid-20x9-cell-center' },
  adapter: { anchors: [
    { cell: 30, feature: 'yellowness', kind: 'present', rule: { kind: 'threshold', threshold: 30, refuse_band: 5 }, separation_margin: 40 },
    { cell: 40, feature: 'luma', kind: 'absent', rule: { kind: 'threshold', threshold: 60, refuse_band: 10 }, separation_margin: 90 },
  ], guard: { kind: 'floor', feature: 'helper_grid_mean_luma', min: 5, reason: 'frame-dark' } } };
const stateRule = { schema: 'calibration-state-v1', schema_version: 1, status: 'calibrated',
  fact: { id: 'calibrationState', labels: ['NIGHT', 'UP', 'DOWN', 'ON', 'OFF'] },
  screen: { identity: 'FNAF2_NIGHT' },
  monitor: { rule: monitorRule, digest: monitorRuleDigest(monitorRule) },
  mask: { rule: maskRule, digest: maskRuleDigest(maskRule) } };

const parsed = parseCalibrationStateRule(stateRule);
assert.equal(calibrationStateRuleDigest(parsed), calibrationStateRuleDigest(stateRule));
assert.equal(parsed.monitor.digest, monitorRuleDigest(monitorRule));

const snapshot = { screen: 'FNAF2_NIGHT', ageUs: 1000, seq: 7, gridSeq: 7, cells: grid };
// parseCalibrationStateRule has checked the bound mask rule with parseMaskRule.
const boundMask = parsed.mask.rule as Parameters<typeof measureMaskOn>[1];

// A reading carries its value only when OBSERVED and its reason only when UNKNOWN.
const observed = measureCalibrationState(snapshot, parsed);
assert.equal(observed.signal, 'calibrationState');
assert.equal(observed.state, 'OBSERVED');
assert.deepEqual(observed.value, { screen: 'NIGHT', monitor: 'UP', mask: 'OFF' });
assert.deepEqual(measureMaskOn(snapshot, boundMask),
  { signal: 'maskOn', state: 'OBSERVED', value: false, confidence: 1 },
  'one atomic FRAME can expose a fitted mask-off measurement for diagnostic ACKs');

// Mask on, monitor down: invert both anchor pairs and the frame resolves.
const maskOnGrid = [...grid];
maskOnGrid[10] = cell(10, 10, 10);
maskOnGrid[20] = cell(200, 200, 120);
maskOnGrid[30] = cell(210, 170, 120);
maskOnGrid[40] = cell(15, 15, 15);
const masked = measureCalibrationState({ ...snapshot, cells: maskOnGrid }, parsed);
assert.deepEqual((masked as { value?: unknown }).value, { screen: 'NIGHT', monitor: 'DOWN', mask: 'ON' });
assert.deepEqual(measureMaskOn({ ...snapshot, cells: maskOnGrid }, boundMask),
  { signal: 'maskOn', state: 'OBSERVED', value: true, confidence: 1 },
  'the same fitted mask rule exposes a mask-on measurement');
assert.equal((measureMaskOn({ ...snapshot, screen: 'FNAF2_MENU' }, boundMask) as { reason?: string }).reason,
  'screen-identity', 'an explicit menu frame cannot acknowledge a mask transition');

// The opaque mask removes both nightScore inputs, so a real masked FRAME can
// be UNKNOWN and the helper's own monitor detector can be UNKNOWN as well.
// A positive bound mask is the secondary night proof for that exact case;
// the bound monitor rule must then read the same atomic grid.
const maskedUnknown = measureCalibrationState({ ...snapshot, screen: 'UNKNOWN',
  monitorUp: 'UNKNOWN', monitorReason: 'screen-identity', cells: maskOnGrid }, parsed);
assert.deepEqual((maskedUnknown as { value?: unknown }).value, { screen: 'NIGHT', monitor: 'DOWN', mask: 'ON' });
assert.equal((measureCalibrationState({ ...snapshot, screen: 'FNAF2_MENU', cells: maskOnGrid }, parsed) as { reason?: string }).reason,
  'screen-identity', 'an explicit menu identity cannot use the mask fallback');
assert.equal((measureCalibrationState({ ...snapshot, screen: 'UNKNOWN', cells: grid }, parsed) as { reason?: string }).reason,
  'screen-identity', 'an unknown frame still needs a positive mask proof');

// Any UNKNOWN refuses the whole state; both sub-rules must resolve.
assert.equal(measureCalibrationState({ ...snapshot, screen: 'FNAF2_MENU' }, parsed).state, 'UNKNOWN');
assert.equal(measureCalibrationState({ ...snapshot, ageUs: 900000 }, parsed).state, 'UNKNOWN');
const ambiguous = [...grid];
ambiguous[30] = cell(160, 160, 130); // yellowness 30: inside the refuse band
assert.equal((measureCalibrationState({ ...snapshot, cells: ambiguous }, parsed) as { reason?: string }).reason, 'ambiguous-threshold');
assert.equal((measureCalibrationState({ ...snapshot, gridSeq: 6 }, parsed) as { reason?: string }).reason, 'grid-seq-mismatch');
assert.equal((measureCalibrationState(snapshot, null) as { reason?: string }).reason, 'calibration-refused');

// Refused artifacts are evidence, never rules.
for (const patch of [
  { schema: 'calibration-state-v2' }, { schema_version: 2 }, { status: 'refitted', reason: 'x' },
  { fact: { id: 'monitorUp', labels: ['NIGHT', 'UP', 'DOWN', 'ON', 'OFF'] } },
  { screen: { identity: 'FNAF2_MENU' } },
  { monitor: { rule: monitorRule, digest: '0'.repeat(64) } },
  { mask: { rule: maskRule, digest: 'f'.repeat(64) } },
  { mask: { rule: { ...maskRule, status: 'exploratory' }, digest: maskRuleDigest({ ...maskRule, status: 'exploratory' }) } },
]) assert.throws(() => parseCalibrationStateRule({ ...stateRule, ...patch }), /calibration-state-v1/);
assert.throws(() => parseCalibrationStateRule({ ...stateRule,
  mask: { rule: { ...maskRule, adapter: { ...maskRule.adapter, anchors: maskRule.adapter.anchors.slice(0, 1) } },
    digest: maskRuleDigest({ ...maskRule, adapter: { ...maskRule.adapter, anchors: maskRule.adapter.anchors.slice(0, 1) } }) } }),
  /at least two anchors/);

// Occlusion-only is legal, and spread replaces polarity. The mask adds no
// bright cell (its body is opaque and the eye holes show the same office), so
// an all-absent rule must parse -- but its anchors may not sit in one row.
const absentOnly = { ...maskRule, adapter: { ...maskRule.adapter, anchors: [
  { cell: 30, feature: 'luma', kind: 'absent', rule: { kind: 'threshold', threshold: 60, refuse_band: 10 }, separation_margin: 90 },
  { cell: 50, feature: 'luma', kind: 'absent', rule: { kind: 'threshold', threshold: 60, refuse_band: 10 }, separation_margin: 90 },
] } };
assert.doesNotThrow(() => parseCalibrationStateRule({ ...stateRule,
  mask: { rule: absentOnly, digest: maskRuleDigest(absentOnly) } }));
const oneRow = { ...maskRule, adapter: { ...maskRule.adapter, anchors: [
  { cell: 30, feature: 'luma', kind: 'absent', rule: { kind: 'threshold', threshold: 60, refuse_band: 10 }, separation_margin: 90 },
  { cell: 31, feature: 'luma', kind: 'absent', rule: { kind: 'threshold', threshold: 60, refuse_band: 10 }, separation_margin: 90 },
] } };
assert.throws(() => parseCalibrationStateRule({ ...stateRule,
  mask: { rule: oneRow, digest: maskRuleDigest(oneRow) } }), /span at least two/);

// An unproven darkness guard is evidence, never a live gate: with the mask on
// almost every cell is black, so without a captured blackout class the rule
// cannot tell a masked frame from a dark screen.
const unproven = { ...maskRule,
  adapter: { ...maskRule.adapter, limitations: ['night-1-corpus', 'blackout-unproven'] } };
assert.doesNotThrow(() => parseMaskRule(unproven));
// A margin the fitter did not write is not one the band can sit inside.
assert.throws(() => parseMaskRule({ ...maskRule, adapter: { ...maskRule.adapter,
  anchors: maskRule.adapter.anchors.map((anchor, index) => index ? anchor
    : (({ separation_margin: _, ...rest }) => rest)(anchor)) } }), /separation margin/);
assert.throws(() => parseCalibrationStateRule({ ...stateRule,
  mask: { rule: unproven, digest: maskRuleDigest(unproven) } }), /unproven darkness guard/);
const proven = { ...maskRule,
  adapter: { ...maskRule.adapter, limitations: ['night-1-corpus'] } };
assert.doesNotThrow(() => parseCalibrationStateRule({ ...stateRule,
  mask: { rule: proven, digest: maskRuleDigest(proven) } }));

console.log('calibration-state rule: binding and both-positive resolution pass');
