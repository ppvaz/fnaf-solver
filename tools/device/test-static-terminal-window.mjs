#!/usr/bin/env node
// The static-terminal window record is a measurement, so it must reproduce
// from the packs it lists, and a pack committed after it that reads a terminal
// later than its maximum must turn this red (the executor's margin would be
// eaten; write a new dated record and re-derive STATIC_TERMINAL_WAIT_MS).
// Each check first runs against a planted violation and must catch it.
//
//   node tools/device/test-static-terminal-window.mjs
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RECORD_PATH, RUNS_DIR, STATIC_EXIT_REASON, measureStaticTerminalWindow, newerPacksBeyondMaximum, serialize,
  staticEpisodes, staticReadGaps,
} from './static-terminal-window.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const iso = ms => new Date(Date.UTC(2026, 8, 27) + ms).toISOString();
const obs = (ms, label) => ({ at: iso(ms), type: 'observation', label });

// --- Episode rules on synthetic rows ----------------------------------------
{
  const rows = [obs(0, 'state=title'), obs(1000, 'state=night'), obs(90000, 'state=static'),
    obs(91500, 'unknown=no-signature-matched'), obs(92000, 'state=static'), obs(94100, 'state=gameover')];
  assert.deepEqual(staticEpisodes('a', rows), [{ run: 'a', kind: 'terminal', state: 'gameover', delayMs: 4100 }],
    'an UNKNOWN read inside a static run must not restart its clock');
}
{
  const rows = [obs(0, 'state=night'), obs(5000, 'state=static'),
    { at: iso(8500), type: 'campaign.abort.restart', reason: STATIC_EXIT_REASON },
    obs(10000, 'unknown=no-signature-matched'), obs(10800, 'state=sixam'), obs(12000, 'state=title')];
  assert.deepEqual(staticEpisodes('b', rows), [{ run: 'b', kind: 'static-abort', abortMs: 3500,
    terminalAfterAbort: { state: 'sixam', delayMs: 5800 } }],
  'a terminal read after a static abort and before the relaunch belongs to the dying game');
}
{
  const rows = [obs(0, 'state=night'), obs(5000, 'state=static'),
    { at: iso(8500), type: 'campaign.abort.restart', reason: STATIC_EXIT_REASON },
    obs(10000, 'state=intro'), obs(11000, 'state=gameover')];
  assert.deepEqual(staticEpisodes('c', rows), [{ run: 'c', kind: 'static-abort', abortMs: 3500 }],
    'a read after the relaunch is not the dying game\'s terminal');
}
{
  const rows = [obs(0, 'state=night'), obs(5000, 'state=static'), obs(6000, 'state=night'), obs(9000, 'state=gameover')];
  assert.deepEqual(staticEpisodes('d', rows), [{ run: 'd', kind: 'night-resumed', delayMs: 1000 }],
    'a static read inside a live night is not a death, and a later Game Over without static is not timed from it');
}
{
  const reads = [[0, 'state=night'], [1200, 'state=night'], [2900, 'state=static'], [4600, 'state=static'],
    [6300, 'state=gameover']].map(([at, label]) => ({ at, script: 'lifecycle-observe.py', label }));
  assert.deepEqual(staticReadGaps(reads), [1700, 1700, 1700]);
  assert.deepEqual(staticReadGaps(reads, 4700), [1700, 1700],
    'reads after the abort row belong to the restart\'s own waiter');
}

// --- The committed record reproduces from the runs it lists -----------------
const committed = JSON.parse(readFileSync(join(ROOT, RECORD_PATH), 'utf8'));
{
  const planted = structuredClone(committed);
  planted.window.measuredMaxMs -= 1;
  assert.notEqual(serialize(measureStaticTerminalWindow({ runs: planted.runs.scanned })), serialize(planted),
    'a hand-edited record must not reproduce');
}
const again = measureStaticTerminalWindow({ runs: committed.runs.scanned });
assert.equal(serialize(again), serialize(committed),
  `${RECORD_PATH} must reproduce byte for byte from the ${committed.runs.scanned.length} runs it lists`);
assert.equal(committed.window.waitMs, committed.window.measuredMaxMs + committed.window.marginMs);

// --- A newer pack beyond the measured maximum is caught ---------------------
{
  const root = mkdtempSync(join(tmpdir(), 'fnaf2-static-window-packs-'));
  try {
    const pack = join(root, RUNS_DIR, 'planted-late-gameover');
    mkdirSync(pack, { recursive: true });
    const late = committed.window.measuredMaxMs + 1;
    writeFileSync(join(pack, 'events.jsonl'), [obs(0, 'state=night'), obs(1000, 'state=static'),
      obs(1000 + late, 'state=gameover')].map(row => JSON.stringify(row)).join('\n') + '\n');
    assert.deepEqual(newerPacksBeyondMaximum(committed, { root }), [{ run: 'planted-late-gameover', delayMs: late }],
      'a newer pack that reads Game Over past the measured maximum must be reported');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const offenders = newerPacksBeyondMaximum(committed);
assert.deepEqual(offenders, [],
  `packs newer than ${committed.evidenceId} read a terminal past its measured maximum: ` +
  'write a new dated record and re-derive STATIC_TERMINAL_WAIT_MS from it');

console.log(`static-terminal-window: PASS (${committed.evidenceId} reproduces from ${committed.runs.scanned.length} ` +
  `packs; waitMs ${committed.window.waitMs} = ${committed.window.measuredMaxMs} + ${committed.window.marginMs})`);
