#!/usr/bin/env node
// Phone-free tests for the mandatory actuation UNKNOWN metric.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GRID_CELLS, reconcile, report, state } from './actuation-frame-metric.ts';

function cellsFor(monitor: boolean, mask: boolean, ambiguous = false): number[] {
  const cells: number[] = new Array(GRID_CELLS).fill(0x141414);
  const monitorValues: Record<number, number> = {
    112: monitor ? 170 : 0, 131: monitor ? 53 : 0, 132: monitor ? 170 : 0, 151: monitor ? 53 : 0, 165: monitor ? 0 : 187, 167: monitor ? 0 : 187,
  };
  const maskValues: Record<number, number> = {
    1: mask ? 0 : 194, 18: mask ? 0 : 148, 154: mask ? 0 : 143, 172: mask ? 0 : 216, 174: mask ? 0 : 228, 175: mask ? 0 : 194,
  };
  for (const [index, value] of Object.entries({ ...monitorValues, ...maskValues })) cells[Number(index)] = value << 16 | value << 8 | value;
  if (ambiguous) cells[112] = 120 << 16 | 120 << 8 | 120;
  return cells;
}
const gridHex = (cells: readonly number[]) => cells.map(cell => cell.toString(16).padStart(6, '0')).join('');

// A positive complement is known, but a negative is not an inference.
assert.equal(reconcile(state(true), state(null)).value, true);
assert.equal(reconcile(state(true), state(null)).reason, 'mask-off-monitor-complement');
assert.equal(reconcile(state(false), state(null)).value, null);
assert.equal(reconcile(state(null), state(false)).value, null);

// A contradiction is unknown.
const contradiction = reconcile(state(true), state(true));
assert.equal(contradiction.value, null);
assert.equal(contradiction.reason, 'mask-monitor-contradiction');

const temp = mkdtempSync(join(tmpdir(), 'actuation-metric-'));
try {
  // A native trace's report counts combined unknown frames.
  const trace = join(temp, 'trace.tsv');
  const rows = [cellsFor(false, false), cellsFor(true, false), cellsFor(false, false, true)].map((cells, k) =>
    [k + 1, (k + 1) * 1000000, (k + 1) * 1000000, 16666666, 20, 0, 40, 100, gridHex(cells)].join('\t'));
  writeFileSync(trace, '# schema=fnaf2-frame-trace-v1 clock=helper-monotonic-ns start_ns=1000000 label=test\n'
    + 'seq\timage_ns\tcallback_ns\tinterval_ns\tgrid_mean_luma\tscreen_identity\tmask_luma\tmonitor_luma\tgrid_hex\n'
    + `${rows.join('\n')}\n`);
  const result = report(trace);
  assert.equal(result.frames, 3);
  assert.equal(result.combined.knownFrames, 2);
  assert.equal(result.combined.unknownFrames, 1);
  assert.equal(result.unknown_frame_pct.value, 33.333);

  // Native strokes override the grid and report their basis.
  const v3 = join(temp, 'trace-v3.tsv');
  const grid = gridHex(cellsFor(false, false));
  const strokeRows = [[1, 1000000, 1000000, 1000000, 0, 0, 0, 0, 141, 140, grid], [2, 2000000, 2000000, 2000000, 0, 0, 0, 0, 0, 140, grid],
    [3, 3000000, 3000000, 3000000, 0, 0, 0, 0, 60, 80, grid]];
  writeFileSync(v3, '# schema=fnaf2-frame-trace-v3 clock=helper-monotonic-ns start_ns=1000000 label=test\n'
    + 'seq\timage_ns\tcallback_ns\tinterval_ns\tgrid_mean_luma\tscreen_identity\tmask_luma\tmonitor_luma\tmask_downstroke\tmonitor_downstroke\tgrid_hex\n'
    + `${strokeRows.map(row => row.join('\t')).join('\n')}\n`);
  const strokes = report(v3);
  assert.equal(strokes.basis, 'native-strokes');
  assert.equal(strokes.monitor.unknownFrames, 1);
  assert.equal(strokes.mask.unknownFrames, 1);
  assert.equal(strokes.combined.unknownFrames, 1);
} finally {
  rmSync(temp, { recursive: true, force: true });
}

console.log('actuation frame metric: native unknown-frame percentage and safe complements pass');
