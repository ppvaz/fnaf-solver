#!/usr/bin/env node
// FIXTURE for phone-clock-sweep.ts (the rate scaling, the match and ranking rules, the derived
// summaries and the verdict), then the committed sweep result's own arithmetic, re-derived from
// its rows and the retained control without the model or any private input. In `npm run test:unit`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bestCell, cellMatches, cellScore, check, deriveNight, deriveVerdict, droppedClock, scaledDeltas, SCHEMA } from './phone-clock-sweep.ts';
import type { SweepResult } from './phone-clock-sweep.ts';
import { officeClock, traceTick } from './phone-encounter-replay.ts';

const read = (rel: string) => readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8');
const sha256 = (value: BinaryLike) => createHash('sha256').update(value).digest('hex');
/** A committed night, and a committed cell, as the checks below read them. */
type Named = { readonly name: string };
type Cell = {
  readonly deltaMs: number, readonly timerRate: number, readonly dropMs?: number, readonly codes: string, readonly compared: number;
  readonly agree: number,
};
const cleaningMap = (cells: readonly { readonly deltaMs: number }[]) => cells.map((c) => c.deltaMs).sort((a, b) => a - b);

// --- dropping the intro rebuilds update 0 at the retained image and re-bases event time to it
{
  const clock = officeClock([0, 16_667_000, 33_334_000, 50_001_000], 0, { catchUp: true });
  const dropped = droppedClock(clock, 20);
  assert.equal(dropped.startMs, 33.334);
  assert.equal(dropped.droppedFrames, 2);
  assert.deepEqual(dropped.imageMs, [0, 16.667]);
  assert.equal(traceTick(33.334 - dropped.startMs, dropped), 0, 'the first kept frame is update 0');
  assert.equal(traceTick(50.001 - dropped.startMs, dropped), 1, 'a scheduled event keeps its relative time after re-zeroing');
  assert.equal(traceTick(16.667 - dropped.startMs, dropped), 0, 'an event before the new zero clamps to update 0');
}

// --- the rate scaling: 0 is the identity; r scales the timer's share of the clock by (1 + r)
{
  assert.deepEqual(scaledDeltas([16.667, 1, 48], 0), [16.667, 1, 48]);
  assert.deepEqual(scaledDeltas([20, 10], -0.5).map((d) => Number(d.toFixed(3))), [10, 5]);
  assert.deepEqual(scaledDeltas([20], 0.25), [25]);
  assert.throws(() => scaledDeltas([20], -1), /must exceed -1/);
  assert.throws(() => scaledDeltas([20], Number.NaN), /must exceed -1/);
}

// --- cell scoring is recomputed from the codes string: a death inside a window reads '?', not '.'
{
  const phone = { windows: '.B..', terminal: { result: '6am', seedClockMs: 420000 } };
  const s = cellScore(phone.windows, phone.terminal, { codes: '.B..', modelResult: '6am', modelEndMs: 420100 });
  assert.equal(s.agree, 4);
  assert.equal(s.compared, 4);
  assert.equal(s.unplayed, 0);
  assert.equal(s.occupancyAgree, 4);
  assert.equal(s.firstDisagreement, null);
  assert.equal(s.outcomeAgrees, true);
  const early = cellScore(phone.windows, phone.terminal, { codes: '.B.?', modelResult: 'death', modelEndMs: 90000 });
  assert.equal(early.unplayed, 1);
  assert.deepEqual(early.firstDisagreement, { window: 3, phone: '.', side: '?' });
  assert.equal(early.outcomeAgrees, false);
}

// --- the match rule needs every phone-read window played and agreeing, with enough of them
{
  const v = { matchMinCompared: 3 };
  assert.ok(cellMatches({ agree: 4, compared: 4, unplayed: 0 }, v));
  assert.ok(!cellMatches({ agree: 2, compared: 2, unplayed: 0 }, v), 'too few compared windows');
  assert.ok(!cellMatches({ agree: 3, compared: 4, unplayed: 0 }, v), 'a disagreement');
  assert.ok(!cellMatches({ agree: 4, compared: 4, unplayed: 1 }, v), 'an unplayed window the phone read');
}

// --- ranking: a match beats every non-match; then agreeing windows by count, not by rate
{
  const v = { matchMinCompared: 3 };
  const match = { deltaMs: 3000, timerRate: 0.02, agree: 3, compared: 3, unplayed: 0, occupancyAgree: 3 };
  const broad = { deltaMs: 0, timerRate: 0, agree: 30, compared: 38, unplayed: 0, occupancyAgree: 30 };
  const degenerate = { deltaMs: 0, timerRate: -0.005, agree: 4, compared: 4, unplayed: 38, occupancyAgree: 4 };
  assert.equal(bestCell([broad, degenerate], v).deltaMs, 0, '30 agreeing windows beat a 4/4 early death');
  assert.equal(bestCell([broad, match], v).deltaMs, 3000, 'a match beats a non-match with more agreeing windows');
  const near = { deltaMs: -100, timerRate: 0, agree: 30, compared: 38, unplayed: 0, occupancyAgree: 30 };
  const far = { deltaMs: 500, timerRate: 0.02, agree: 30, compared: 38, unplayed: 0, occupancyAgree: 30 };
  assert.equal(bestCell([far, near], v).deltaMs, -100, 'ties break toward the smaller perturbation');
}

// --- a night's derived summary and the verdict, on synthetic rows
{
  const night = {
    name: 'synthetic', phone: { windows: '.B..', terminal: { result: '6am', seedClockMs: 420000 } },
    verdictCfg: { matchMinCompared: 3, improveMargin: 0.5, consistentDeltaMs: 1000, consistentRate: 0.01 },
    control: { codes: '.B..', modelResult: '6am', modelEndMs: 420100 },
    cells: [
      { deltaMs: 0, timerRate: 0, codes: '.B..', modelResult: '6am', modelEndMs: 420100 },
      { deltaMs: 1000, timerRate: 0, codes: '.B..', modelResult: '6am', modelEndMs: 420100 },
      { deltaMs: -8000, timerRate: 0.04, codes: '.?.?', modelResult: 'death', modelEndMs: 90000 },
    ],
  };
  const derived = deriveNight(night);
  assert.ok(derived.matches, 'a matching cell exists');
  assert.equal(derived.matchCells.length, 2);
  assert.equal(derived.best.deltaMs, 0, 'the smaller perturbation among matches');
  assert.equal(derived.controlScore.agree, 4);
  assert.equal(derived.controlRate, 1);
  const night2 = { ...night, name: 'second', cells: [{ deltaMs: 1400, timerRate: 0, codes: '.B..', modelResult: '6am', modelEndMs: 420100 },
    { deltaMs: 0, timerRate: 0, codes: '..B.', modelResult: '6am', modelEndMs: 420100 }], control: night.control };
  const verdict = deriveVerdict([{ ...night, derived }, { ...night2, derived: deriveNight(night2) }]);
  assert.equal(verdict.status, 'ALIGNMENT_CELLS_FOUND');
  assert.equal(verdict.consistency, 'NIGHT_SPECIFIC', 'deltaMs 0 and 1400 differ by more than 1000');
  const none = { ...night, cells: [{ deltaMs: 5000, timerRate: 0.06, codes: '.B??', modelResult: 'death', modelEndMs: 90000 }] };
  const verdictNone = deriveVerdict([{ ...none, derived: deriveNight(none) }]);
  assert.equal(verdictNone.status, 'NO_PHASE_RATE_ALIGNMENT');
}

// --- the committed results: schema, control equality to the retained replay, and every score re-derived
{
  for (const [resultPath, minCells] of [['tools/recompile/results/phone-clock-sweep-20260928.json', 40],
    ['tools/recompile/results/phone-clock-sweep-fine-20260928.json', 40]] as const) {
    const result: SweepResult = JSON.parse(read(resultPath));
    assert.equal(result.schema, SCHEMA);
    assert.equal(result.claimLevel, 'MODEL_ONLY');
    const summary = check(result);
    assert.ok(summary.nights >= 1, resultPath);
    assert.ok(['ALIGNMENT_CELLS_FOUND', 'IMPROVED_NOT_ALIGNED', 'NO_PHASE_RATE_ALIGNMENT'].includes(summary.status), resultPath);
    for (const night of result.nights) {
      assert.ok(night.control.retainedEqual, resultPath);
      assert.ok(night.cells.length >= minCells, 'the predeclared grid ran');
      assert.equal(new Set(night.cells.map((c) => `${c.deltaMs}/${c.timerRate}/${c.dropMs ?? 0}`)).size, night.cells.length, 'no cell ran twice');
      assert.ok(night.cells.some((c) => c.deltaMs === 0 && c.timerRate === 0), 'the control cell is a row');
    }
  }
  // the retained conclusions, stated where a check reads them:
  {
    const coarse = JSON.parse(read('tools/recompile/results/phone-clock-sweep-20260928.json'));
    const fine = JSON.parse(read('tools/recompile/results/phone-clock-sweep-fine-20260928.json'));
    const full06 = fine.nights.find((n: Named) => n.name === 'full-06');
    // no cell of either pass reproduces the phone's occupied windows on the full-read night
    assert.ok(full06.derived.matchCells.length === 0);
    assert.equal(full06.derived.best.agree, 32);
    assert.equal(full06.derived.best.compared, 42);
    assert.equal(full06.derived.best.deltaMs, 50);
    assert.ok(full06.derived.best.agree < full06.derived.best.compared, 'the best cell anywhere still disagrees');
    // window 6 is phase-robust: it disagrees at the control, at every coarse rate-0 cell, and at 34 of
    // 44 fine cells; where it clears, other windows still disagree (disagreement is redistributed, not resolved)
    const control = full06.cells.find((c: Cell) => c.deltaMs === 0 && c.timerRate === 0);
    assert.equal(control.firstDisagreement.window, 6);
    const coarseFull06 = coarse.nights.find((n: Named) => n.name === 'full-06');
    const coarseRate0 = coarseFull06.cells.filter((c: Cell) => c.timerRate === 0);
    assert.ok(coarseRate0.every((c: Cell) => (c.codes[6] ?? '?') !== full06.phone.windows[6]), 'window 6 disagrees at every coarse rate-0 cell');
    const fineRate0 = full06.cells.filter((c: Cell) => c.timerRate === 0);
    assert.equal(fineRate0.filter((c: Cell) => (c.codes[6] ?? '?') !== full06.phone.windows[6]).length, 34);
    const clearing = fineRate0.filter((c: Cell) => (c.codes[6] ?? '?') === full06.phone.windows[6]);
    assert.deepEqual(cleaningMap(clearing), [-40, -20, -10, 50, 60, 65, 70, 75, 110, 130]);
    assert.ok(clearing.every((c: Cell) => c.compared - c.agree >= 8), 'every window-6-clearing cell still disagrees elsewhere');
    assert.ok(fineRate0.filter((c: Cell) => c.compared >= 10).every((c: Cell) => c.compared - c.agree >= 8), 'no cell anywhere resolves the night');
    // twin-01's all-empty read matches at two configurations 6 s apart: the rule's output, read as noise
    const twinFine = fine.nights.find((n: Named) => n.name === 'twin-01');
    const twinCoarse = coarse.nights.find((n: Named) => n.name === 'twin-01');
    assert.ok(twinFine.derived.matchCells.length > 0 && twinCoarse.derived.matchCells.length > 0);
    assert.ok(Math.max(...twinFine.derived.matchCells.map((c: Cell) => c.deltaMs))
      - Math.min(...twinCoarse.derived.matchCells.map((c: Cell) => c.deltaMs)) >= 5000);
  }
}

// --- the measured clock-zero and schedule-phase candidates stay model-only and are row-rechecked
{
  const config = JSON.parse(read('packages/propose/bin/recompile/phone-clock-sweep-zero.json'));
  const evidence = JSON.parse(read('docs/evidence/phone-clock-zero-sweep-20260928.json'));
  for (const [name, suffix, expectedControl, expectedJoint] of [
    ['full-04', 'full-04', 4, 3], ['full-06', 'full-06', 14, 2],
  ]) {
    const result = JSON.parse(read(`tools/recompile/results/phone-clock-sweep-zero-${suffix}-20260928.json`));
    const retained = evidence.results.find((r: { readonly night: string }) => r.night === name);
    assert.equal(retained.evidenceId, result.evidenceId);
    assert.equal(retained.sha256, sha256(read(retained.path)));
    assert.equal(result.claimLevel, 'MODEL_ONLY');
    assert.equal(check(result).status, 'NO_PHASE_RATE_ALIGNMENT');
    const night = result.nights[0];
    assert.equal(night.name, name);
    assert.equal(night.cells.find((c: Cell) => c.deltaMs === 0 && c.dropMs === 0).agree, expectedControl);
    const reference = config.references[name];
    const grid = config.grid.byNight[name];
    assert.equal(Number((reference.anchorFireAfterFirstFrameMs - reference.configuredOriginAfterFirstFrameMs).toFixed(1)), reference.scheduleDelayMs);
    assert.ok(grid.deltaMs.includes(-reference.scheduleDelayMs));
    assert.ok(grid.dropMs.includes(reference.clockZeroAfterFirstFrameMs));
    const joint = night.cells.find((c: Cell) => c.deltaMs === -reference.scheduleDelayMs && c.dropMs === reference.clockZeroAfterFirstFrameMs);
    assert.ok(joint, 'the joint measured correction ran');
    assert.ok(joint.clockStartMs >= joint.dropMs && joint.clockStartMs - joint.dropMs < 40, 'clock zero uses the first captured frame at or after the fitted phase');
    assert.ok(joint.droppedFrames > 0);
    assert.equal(joint.agree, expectedJoint);
    assert.equal(night.derived.matchCells.length, 0, 'neither trace has a matching measured-reference cell');
  }
}

// --- the sweep runs from this checkout: its config's paths are where those files stood (records keep their
// paths), and every private input is read under --inputs-root. None is here, so the sweep stops at the first.
{
  const dir = mkdtempSync(join(tmpdir(), 'clock-sweep-'));
  const nowhere = join(dir, 'inputs');
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('./phone-clock-sweep.ts', import.meta.url)), 'sweep',
    '--out', join(dir, 'out.json'), '--inputs-root', nowhere], { encoding: 'utf8' });
  const error = run.stderr.split('\n').find((l) => /Error/.test(l)) ?? '';
  assert.ok(run.status !== 0 && error.includes(`'${nowhere}/`), `the sweep must read its first private input under --inputs-root: ${error}`);
  rmSync(dir, { recursive: true, force: true });
}

console.log('phone-clock-sweep: clock-origin fixtures and four retained results rechecked; the sweep reads its inputs under --inputs-root');
