#!/usr/bin/env node
// Every committed rebuild-options census must still describe the tree it sits in.
//
// `rebuild-options-census.mjs` scores every story-night winner, k3 and the
// Night 7 preset schedule under three model option sets over 6000 seeds; that
// is hours on a shared machine, so CI does not re-run it. This checks in
// seconds that nothing it depends on has moved and that its claims replay, for
// each `docs/evidence/rebuild-options-census-YYYYMMDD[x].json` (a second record
// on one date carries a letter), each against the options file it names:
//
//   - the option file, the option sets and both seed blocks are the ones scored;
//   - each binding's file and emitted plan hash to what was scored;
//   - every row's counts add up, and each verdict and p value follows from the
//     row's own paired counts;
//   - the injection is exact: a Sim built inside the scope carries a
//     constructor-read option (sourcedHourTable skips the constructor's
//     hour-0 table on a story night), and one built outside it does not;
//   - for each distinct replay and option set, a fixed held-out seed replays
//     to the recorded outcome (when the row lists every loss), the first
//     listed held-out loss still dies of the same cause on the same frame, and
//     the first listed seed each way that only one set wins still splits the
//     same way.
//
// An engine change that moves a scored seed fails here; the fix is to re-run
// the census in the diff that changed the engine. A committed winner the
// record does not cover is reported as UNSCORED_WINNERS, not failed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sim } from '@sixam/source/fnaf2';
import { simOptionsFrom } from './recompile/model-draw-trace.mjs';
import { KIND, OPTIONS_FILE, mcnemarExact, optionSets, seedBlocks, subjects, verdict, wilson95, withModelOptions }
  from './rebuild-options-census.mjs';
import { committedWinners } from './winner-census.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = join(ROOT, 'docs/evidence');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The statistics against values computed by hand: 0 : 10 discordant seeds is
// 2 * 2^-10; an even split is no evidence; 3000/3000's Wilson floor is
// n / (n + z^2) = 0.998721.
assert.equal(mcnemarExact(0, 0), 1);
assert.ok(Math.abs(mcnemarExact(0, 10) - 2 / 1024) < 1e-12);
assert.ok(Math.abs(mcnemarExact(10, 0) - 2 / 1024) < 1e-12);
assert.ok(Math.abs(mcnemarExact(5, 5) - 1) < 1e-12);
assert.ok(Math.abs(mcnemarExact(1, 9) - 22 / 1024) < 1e-12);
assert.deepEqual(wilson95(3000, 3000), [0.998721, 1]);
const pair = (defaultOnlyWins, optionOnlyWins) => ({ defaultOnlyWins, optionOnlyWins, pExact: mcnemarExact(defaultOnlyWins, optionOnlyWins) });
assert.equal(verdict(pair(0, 0), pair(0, 0)), 'IDENTICAL');
assert.equal(verdict(pair(2, 0), pair(0, 1)), 'WITHIN_NOISE');
assert.equal(verdict(pair(10, 0), pair(1, 0)), 'ONE_BLOCK');
assert.equal(verdict(pair(10, 0), pair(0, 10)), 'ONE_BLOCK');
assert.equal(verdict(pair(10, 0), pair(12, 1)), 'MOVED');

const names = readdirSync(EVIDENCE).filter((file) => /^rebuild-options-census-\d{8}[a-z]?\.json$/.test(file)).sort();
assert.ok(names.length, 'no docs/evidence/rebuild-options-census-YYYYMMDD.json is committed');
const current = new Map(subjects().map((s) => [s.id, s]));

function checkRecord(name) {
  const record = JSON.parse(readFileSync(join(EVIDENCE, name), 'utf8'));
  assert.equal(record.kind, KIND);
  assert.equal(record.claimLevel, 'MODEL_ONLY');
  assert.equal(record.id, name.replace(/\.json$/, ''));
  assert.equal(record.id.match(/\d{8}/)[0], record.date.replace(/-/g, ''), `${name} is not named for its own date`);

  // The record names the options file it scored; that file must still hash as scored. When it is not the
  // current rebuild set, the record is about the named snapshot, and a re-run with the current set is a new record.
  const scoredOptions = record.method.optionsFile.path;
  assert.ok(scoredOptions === OPTIONS_FILE || /^tools\/recompile\/sourced-rebuild-model-options-\d{8}[a-z]?\.json$/.test(scoredOptions),
    `${name} names ${scoredOptions}, neither the rebuild set nor a dated snapshot of it`);
  assert.equal(sha256(readFileSync(join(ROOT, scoredOptions))), record.method.optionsFile.sha256,
    `${scoredOptions} changed since ${name}; re-run tools/rebuild-options-census.mjs --options ${scoredOptions}`);
  const sets = optionSets(scoredOptions);
  assert.deepEqual(sets.map(({ id, modelOptions }) => ({ id, modelOptions })), record.method.optionSets);
  const count = record.method.designBlock.n;
  const { design, heldOut } = seedBlocks(count);
  assert.equal(sha256(JSON.stringify(design)), record.method.designBlock.sha256, 'the design block no longer rebuilds');
  assert.equal(sha256(JSON.stringify(heldOut)), record.method.heldOutBlock.sha256, 'the held-out block no longer rebuilds');
  assert.equal(design.filter((seed) => heldOut.includes(seed)).length, 0, 'the two seed blocks overlap');

  // The injection reaches the constructor: on a story night sourcedHourTable
  // leaves hour 0's AI table to the first loop, so a fresh Sim has every AI at 0.
  {
    const rebuild = simOptionsFrom(sets.find((s) => s.id === 'rebuild').modelOptions);
    const inside = withModelOptions(rebuild, () => new Sim({ night: 6, seed: 1 }));
    const outside = new Sim({ night: 6, seed: 1 });
    assert.equal(inside.opts.sourcedHourTable, true);
    assert.equal(outside.opts.sourcedHourTable, false, 'the option scope leaked past its replay');
    assert.ok(Object.values(outside.ai).some((level) => level > 0), 'night 6 hour 0 should arm someone by default');
    assert.ok(Object.values(inside.ai).every((level) => level === 0), 'sourcedHourTable did not reach the constructor');
  }

  for (const b of record.bindings) {
    const s = current.get(b.subject);
    assert.ok(s, `${name} scored ${b.subject}, which the tree no longer offers`);
    if (b.binding) {
      assert.equal(s.winnerSha256, b.winnerSha256, `${b.binding} changed since ${name}; re-run the census`);
      assert.equal(s.planSha256, b.planSha256, `${b.subject} emits a different plan than ${name} scored`);
    } else {
      assert.equal(s.knobsSha256, b.knobsSha256, `the preset schedule changed since ${name}`);
    }
    assert.equal(s.replayKey, b.replayKey, `${b.subject} replays differently from what ${name} scored`);
  }

  assert.equal(record.rows.length, record.bindings.length * sets.length, 'a row is missing for some subject and option set');
  let replays = 0;
  const play = (subject, set, seed) => {
    replays += 1;
    return withModelOptions(simOptionsFrom(sets.find((x) => x.id === set).modelOptions), () => subject.play(seed));
  };
  let notRun = 0;
  for (const row of record.rows) {
    const tag = `${name} ${row.subject} ${row.set}`;
    // A stopped run's unfinished subjects carry no figures at all: nothing to add up, nothing to replay.
    if (row.status === 'NOT_RUN') {
      assert.ok(!row.design && !row.heldOut && !row.vsDefault, `${tag}: a NOT_RUN row carries figures`);
      assert.ok(record.coverage.notRun.includes(row.subject), `${tag}: NOT_RUN but not in coverage.notRun`);
      notRun += 1;
      continue;
    }
    assert.equal(row.status, 'SCORED', `${tag}: unknown row status ${row.status}`);
    for (const block of [row.design, row.heldOut]) {
      assert.equal(block.n, count, `${tag}: a block is not ${count} seeds`);
      assert.equal(block.wins + block.losses.count, block.n, `${tag}: wins and losses do not add up`);
      assert.equal(Object.values(block.deaths).reduce((a, b) => a + b, 0), block.losses.count, `${tag}: deaths do not add up`);
    }
    const pairs = [['vsDefault', 'default'], ['vsRebuild', 'rebuild']].filter(([key]) => row[key]);
    for (const [pairKey, baseSet] of pairs) {
      const base = record.rows.find((r) => r.subject === row.subject && r.set === baseSet);
      for (const key of ['design', 'heldOut']) {
        const v = row[pairKey][key];
        assert.equal(v.deltaWins, row[key].wins - base[key].wins, `${tag} ${pairKey} ${key}: delta is not the difference of the rates`);
        assert.equal(v.optionOnlyWins - v.defaultOnlyWins, v.deltaWins, `${tag} ${pairKey} ${key}: discordant seeds do not give the delta`);
        assert.equal(v.pExact, Number(mcnemarExact(v.defaultOnlyWins, v.optionOnlyWins).toPrecision(6)), `${tag} ${pairKey} ${key}: p value`);
      }
      assert.equal(row[pairKey].verdict, verdict(row[pairKey].design, row[pairKey].heldOut), `${tag} ${pairKey}: verdict`);
    }
    if (row.sharesReplayWith) continue;
    const subject = current.get(row.subject);
    // One fixed held-out seed per distinct replay and set, spread by the row's position; when the
    // row lists every loss, its outcome is known and must replay.
    if (!row.heldOut.losses.truncated) {
      const seed = heldOut[(record.rows.indexOf(row) * 977) % heldOut.length];
      const lost = row.heldOut.losses.list.find(([s]) => s === seed);
      const r = play(subject, row.set, seed);
      assert.equal(r.won, !lost, `${tag} held-out seed ${seed} replays ${r.won ? 'WON' : 'LOST'}; ${name} says otherwise`);
    }
    const first = row.heldOut.losses.list[0];
    if (first) {
      const [seed, reason, frame] = first;
      const r = play(subject, row.set, seed);
      assert.ok(!r.won, `${tag} seed ${seed} now wins; ${name} says it lost to ${reason}`);
      assert.deepEqual([r.reason, r.sim.frame], [reason, frame], `${tag} seed ${seed} dies differently now`);
    }
    // The first held-out seed each way that only one of the pair wins still splits that way.
    for (const [pairKey, baseSet] of pairs) {
      const [lostOnly] = row[pairKey].heldOut.lostOnlyUnderSet.list;
      if (lostOnly) {
        assert.equal(play(subject, baseSet, lostOnly[0]).won, true, `${tag} seed ${lostOnly[0]}: ${baseSet} no longer wins it`);
        assert.equal(play(subject, row.set, lostOnly[0]).won, false, `${tag} seed ${lostOnly[0]}: ${row.set} no longer loses it`);
      }
      const [wonOnly] = row[pairKey].heldOut.wonOnlyUnderSet.list;
      if (wonOnly) {
        assert.equal(play(subject, baseSet, wonOnly[0]).won, false, `${tag} seed ${wonOnly[0]}: ${baseSet} no longer loses it`);
        assert.equal(play(subject, row.set, wonOnly[0]).won, true, `${tag} seed ${wonOnly[0]}: ${row.set} no longer wins it`);
      }
    }
  }

  const scored = new Set(record.bindings.map((b) => b.binding).filter(Boolean));
  const unscored = committedWinners().filter((path) => !scored.has(path) &&
    [...current.values()].some((s) => s.binding === path));
  console.log(`rebuild-options census ${name} (${scoredOptions}): ${record.bindings.length} subjects x ${sets.length} ` +
    `option sets still match the tree (${replays} replays); NOT_RUN rows ${notRun} (${record.coverage.notRun.length} ` +
    `subjects); UNSCORED_WINNERS ${unscored.length}${unscored.length ? `: ${unscored.join(', ')}` : ''}`);
}

for (const name of names) checkRecord(name);
