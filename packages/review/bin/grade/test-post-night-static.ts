#!/usr/bin/env node
// The post-night-static record justifies halting actuation on the first static
// read after a night, so it must reproduce from the packs it lists, and a pack
// committed after it in which the night went on after such a static -- the
// office read twice in a row, or a 6 AM past the window -- must turn this red
// (re-derive POST_NIGHT_STATIC_HALT). Each check first runs against a planted
// violation and must catch it.
//
//   node packages/review/bin/grade/test-post-night-static.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OBSERVER_INTERVAL_BOUND_MS, RECORD_PATH, RUNS_DIR, STATIC_TERMINAL_WAIT_MS, liveNightMisreads,
  measurePostNightStatic, newerPacksContradicting, nightWentOn, postNightStaticEpisodes, serialize,
} from './post-night-static.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const reads = (rows: readonly (readonly [number, string])[]) => rows.map(([at, label]) => ({ at, label }));

// --- The tool's window is the executor's measured one -----------------------
{
  const window = JSON.parse(readFileSync(join(ROOT, 'docs/evidence/static-terminal-window-20260927.json'), 'utf8'));
  assert.equal(STATIC_TERMINAL_WAIT_MS, window.window.waitMs, 'the halted window must be the measured one');
  assert.equal(OBSERVER_INTERVAL_BOUND_MS, window.staticAbort.observerIntervalBoundMs);
}

// --- Episode rules on synthetic reads ---------------------------------------
{
  const [episode] = postNightStaticEpisodes('a', 'reads', reads([[0, 'state=night'], [1000, 'state=static'],
    [2600, 'unknown=no-signature-matched'], [4100, 'state=gameover']]));
  assert.equal(episode.end?.state, 'gameover');
  assert.equal(episode.secondReadMs, 1600);
  assert.equal(episode.gapBeforeMs, 1000);
  assert.equal(nightWentOn(episode), false, 'a death is not a night that went on');
}
{
  // p1b's shape: one night misread from inside the death minigame.
  const [episode] = postNightStaticEpisodes('p', 'reads', reads([[0, 'state=night'], [1000, 'state=static'],
    [2000, 'unknown=office-hud-without-night'], [3000, 'state=night'], [4000, 'unknown=no-signature-matched'],
    [5000, 'state=static'], [6000, 'state=title']]));
  assert.deepEqual(episode.nightReadsAfterMs, [2000]);
  assert.equal(episode.consecutiveNightReadsAfter, 1);
  assert.equal(nightWentOn(episode), false, 'a single night read inside a death is not the night going on');
}
{
  const [episode] = postNightStaticEpisodes('n', 'reads', reads([[0, 'state=night'], [1000, 'state=static'],
    [2000, 'state=night'], [3000, 'unknown=dark-frame-no-text'], [4000, 'state=night']]));
  assert.equal(episode.consecutiveNightReadsAfter, 2, 'an UNKNOWN between two night reads does not separate them');
  assert.equal(nightWentOn(episode), true, 'the office read twice in a row after a static is the night going on');
}
{
  const [episode] = postNightStaticEpisodes('s', 'label-changes', reads([[0, 'state=night'], [1000, 'state=static'],
    [6000, 'state=sixam']]));
  assert.equal(nightWentOn(episode), true, 'a 6 AM after a static is a night that went on');
}
{
  // The executor's night latches: an intro between the night and the static
  // does not make it a pre-night static (night7-night7-k3-seedlog-01).
  const found = postNightStaticEpisodes('i', 'label-changes', reads([[0, 'state=night'], [1000, 'state=intro'],
    [2000, 'state=static'], [3000, 'state=title']]));
  assert.equal(found.length, 1);
  assert.equal(postNightStaticEpisodes('t', 'label-changes', reads([[0, 'state=static'], [1000, 'state=night']])).length, 0,
    'a static before any night is not a post-night static');
}
{
  const counts = liveNightMisreads(reads([[0, 'state=night'], [1000, 'state=newspaper'], [2000, 'state=night'],
    [3000, 'state=night'], [4000, 'state=static'], [5000, 'state=gameover']]));
  assert.deepEqual(counts['state=newspaper'], { reads: 1, liveNight: 1 });
  assert.deepEqual(counts['state=static'], { reads: 1, liveNight: 0 });
}

// --- The committed record reproduces from the runs it lists -----------------
const committed = JSON.parse(readFileSync(join(ROOT, RECORD_PATH), 'utf8'));
{
  const planted = structuredClone(committed);
  planted.episodes.n -= 1;
  assert.notEqual(serialize(measurePostNightStatic({ runs: planted.runs.scanned })), serialize(planted),
    'a hand-edited record must not reproduce');
}
const again = measurePostNightStatic({ runs: committed.runs.scanned });
assert.equal(serialize(again), serialize(committed),
  `${RECORD_PATH} must reproduce byte for byte from the ${committed.runs.scanned.length} runs it lists`);

// --- A newer pack in which the night went on is caught ----------------------
{
  const root = mkdtempSync(join(tmpdir(), 'fnaf2-post-night-static-packs-'));
  try {
    const pack = (name: string, rows: readonly (readonly [number, string])[]) => {
      const dir = join(root, RUNS_DIR, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'events.jsonl'), '');
      writeFileSync(join(dir, 'observations.jsonl'), rows.map(([at, label]) =>
        JSON.stringify({ at, script: 'lifecycle-observe.py', label })).join('\n') + '\n');
    };
    pack('planted-night-went-on', [[0, 'state=night'], [1000, 'state=static'], [2000, 'state=night'], [3000, 'state=night']]);
    pack('planted-late-sixam', [[0, 'state=night'], [1000, 'state=static'], [1000 + STATIC_TERMINAL_WAIT_MS, 'state=sixam']]);
    pack('planted-sixam-inside', [[0, 'state=night'], [1000, 'state=static'], [6000, 'state=sixam']]);
    assert.deepEqual(newerPacksContradicting(committed, { root }).map(item => item.run),
      ['planted-late-sixam', 'planted-night-went-on'],
      'a night read twice after a static, or a 6 AM past the window, must be reported; a 6 AM inside it must not');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const offenders = newerPacksContradicting(committed);
assert.deepEqual(offenders, [],
  `packs newer than ${committed.evidenceId} read a night that went on after a post-night static: ` +
  'write a new dated record and re-derive POST_NIGHT_STATIC_HALT from it');

console.log(`post-night-static: PASS (${committed.evidenceId} reproduces from ${committed.runs.scanned.length} packs; ` +
  `${committed.episodes.n} post-night static episodes, ${committed.episodes.nightWentOn.length} went on, ` +
  'every one inside the window)');
