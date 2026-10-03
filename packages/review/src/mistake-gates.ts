// The gate each mistake-register entry (CLAUDE.md) relies on. tools/test-mistake-register.ts holds every
// row to a CI step that runs it (item 13 applied to the register), and Review's S7 row reads the same
// rows: one table, imported by both, where the S7 row used to parse it out of the gate's source text.

export const MISTAKE_GATES_FILE = 'tools/test-mistake-register.ts';

/** [register entry, the gate that holds it]; an entry may name several gates. */
export const REGISTER_GATES: readonly (readonly [number, string])[] = Object.freeze([
  [1, 'packages/play/src/sensors/screencap/test-sensor.py'],   // title-observe.py refuses a path it would not read
  [2, MISTAKE_GATES_FILE],
  [3, 'apps/lab/test/test-night-job.py'],   // a night job refuses on an observed title mismatch and on an unreadable Continue night
  [4, 'packages/propose/test/test-terminal-deadline.ts'],   // every committed plan's end plus the port's wait covers the latest measured 6 AM
  [5, MISTAKE_GATES_FILE],
  [7, 'packages/propose/test/test-seam-slack.ts'],
  [9, 'packages/propose/test/test-seam-slack.ts'],
  [10, 'packages/propose/test/test-seam-slack.ts'],   // a floor measured in one order is used only in that order
  [8, MISTAKE_GATES_FILE],
  [11, MISTAKE_GATES_FILE],
  [12, MISTAKE_GATES_FILE],
  [13, MISTAKE_GATES_FILE],
  [13, 'packages/review/bin/grade/test-grade-run-coverage.ts'],
  [14, 'tools/test-sibling-paths.ts'],
  [15, 'apps/desktop/test/test-fnaf1-winner.ts'],
  [6, 'apps/lab/test/test-night-job.py'],   // after an abort or a killed runner the game is driven back to an observed title
] as const);
