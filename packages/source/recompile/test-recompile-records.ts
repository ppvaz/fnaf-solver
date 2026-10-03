#!/usr/bin/env node
// FIXTURE regressions for game-builds.ts and sound-map.ts, then a recheck of every committed recompile-game-builds-v1
// and recompile-sound-map-v1 record (no binaries needed). Review's bin/recompile/test-audio-records.ts covers the
// audio records these cite.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PyAssertionError, PyFloat, type PyValue, pyDumps, pyGet, pyIsList, pyItem, pyLoads } from '@sixam/kernel/py';
import * as builds from './game-builds.ts';
import * as soundmap from './sound-map.ts';

const RESULTS = fileURLToPath(new URL('../../../tools/recompile/results', import.meta.url));
const read = (path: string): PyValue => pyLoads(readFileSync(path, 'utf8'));
const field = (value: PyValue, ...keys: string[]) => keys.reduce((node, key) => pyItem(node, key), value);
const rowsOf = (value: PyValue) => {
  const rows = pyItem(value, 'rows');
  assert.ok(pyIsList(rows));
  return rows;
};

test('a build record row is derived from its step outputs, and a wrong status or a missing audio record refused', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'recompile-records-'));
  try {
    const results = join(tmp, 'results');
    mkdirSync(results);
    // The audio record a build row cites: only its id and answer are read.
    writeFileSync(join(results, 'fixture-audio.json'), JSON.stringify({ schema: 'recompile-audio-v1', evidenceId: 'recompile-audio-0000000000000000',
      answer: { declared: 3, resolvedFiles: 2, auditionNonSilent: 1 } }));
    const src = join(tmp, 'gamesrc');
    mkdirSync(src);
    writeFileSync(join(src, 'events_1.cpp'), '    media.play_id(SOUND_A_0, 1-1);\n    media.play_id(SOUND_B_1, 3-1, 0);\n    media.play_id(INVALID_ASSET_ID, 1-1);\n');
    writeFileSync(join(src, 'frame1_1.cpp'), '    name = std::string("02-title", 8);\n');
    writeFileSync(join(src, 'CMakeLists.txt'), 'project(Chowdren)\n');
    const log = join(tmp, 'convert.log');
    writeFileSync(log, 'skipping truncated frame: 29\naction omitted for unsupported expression: X\nconvert exit 0\n');
    const boot = join(tmp, 'boot');
    mkdirSync(boot);
    writeFileSync(join(boot, 'trace'), '# frame tick draws graine values...\n# frame 0 seeded 1\n0 0 1 1 0\n0 1 1 1 0\n# stop total ticks 2 frame 0 tick 2\n');
    writeFileSync(join(boot, 'run.log'), 'Audio initialized: 1.1 ALSOFT\nexit 0\n');
    writeFileSync(join(boot, 'env'), 'CHOWDREN_HARNESS=1\nCHOWDREN_TRACE=x\nALSOFT_DRIVERS=null\n');
    writeFileSync(join(boot, 'audio-trace'), '# v1\n0 0 0.1 play 0 0 1 10.0 2\n');
    const apk = join(tmp, 'g.apk');
    writeFileSync(apk, 'PK');
    const ccn = join(tmp, 'app.ccn');
    writeFileSync(ccn, 'PAMU');
    const recPath = join(tmp, 'builds.json');
    const options = { out: recPath, game: 'fixture', ccn, gamesrc: src, convertLog: log, binary: apk, assets: ccn, pinned: join(tmp, 'pinned', 'abcd-ef01'),
      boot, libmain: apk, apk, package: 'org.fixture.play', audio: join(results, 'fixture-audio.json'), blocker: null };
    builds.cmdRecord(options);
    const row = rowsOf(builds.check(recPath, results))[0];
    assert.equal(field(row, 'firstFailedStep'), null);
    assert.ok(field(row, 'conversion', 'frames') === 1n && field(row, 'conversion', 'truncatedFramesSkipped') === 1n);
    assert.deepEqual(field(row, 'conversion', 'playSites'), new Map([['resolved', 2n], ['invalid', 1n]]));
    assert.equal(field(row, 'boot', 'updates'), 2n);
    assert.deepEqual(field(row, 'boot', 'visits'), [new Map<string, PyValue>([['frame', 0n], ['name', '02-title'], ['updates', 2n]])]);
    assert.ok(field(row, 'boot', 'reachedTitle') === 'YES' && field(row, 'boot', 'samplePlays') === 1n);
    assert.deepEqual(field(row, 'boot', 'env'), new Map([['CHOWDREN_HARNESS', '1']]));
    assert.equal(field(row, 'host', 'pinned'), 'abcd-ef01');
    // a second game without an APK: its first failed step is the apk
    builds.cmdRecord({ ...options, game: 'fixture2', apk: null, libmain: null, blocker: 'no NDK in the fixture' });
    const both = rowsOf(builds.check(recPath, results));
    assert.deepEqual(both.map(entry => field(entry, 'game')), ['fixture', 'fixture2']);
    assert.ok(field(both[1], 'firstFailedStep') === 'apk' && pyDumps(field(both[1], 'apk')) === '{"status": "NOT_BUILT"}');
    // A row whose first failed step is cleared contradicts its own statuses.
    const record = read(recPath);
    const cleared = rowsOf(record).map((entry, k) => (k === 1 && entry instanceof Map ? new Map([...entry, ['firstFailedStep', null]]) : entry));
    writeFileSync(`${recPath}.bad`, pyDumps(new Map([...(record instanceof Map ? record : []), ['rows', cleared]])));
    assert.throws(() => builds.check(`${recPath}.bad`, results), PyAssertionError);
    assert.throws(() => builds.check(recPath, tmp), PyAssertionError, 'its audio record is not in that results dir');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a sound-map table is checked from its rows: a file keyed by bank index, a length off its file or a lost anchor is refused', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'recompile-records-'));
  try {
    type Change = { file?: string, duration?: number, assetId?: bigint };
    const smRow = (handle: bigint, index: bigint, length: bigint, duration: number, change: Change = {}) => {
      const seconds = change.duration ?? duration;
      return new Map<string, PyValue>([
        ['handle', handle], ['bankIndex', index], ['name', `n${handle}`], ['flags', 256n], ['declaredLengthMs', length], ['declaredRate', 44100n],
        ['file', change.file ?? `s${String(handle).padStart(4, '0')}.wav`], ['fileSha256', '0'.repeat(64)], ['fileDurationMs', new PyFloat(seconds)],
        ['fileRate', 44100n], ['fileChannels', 1n], ['fileCodec', 'pcm_s16le'], ['indexFile', `s${String(index).padStart(4, '0')}.wav`],
        ['declaredMatchesHandleFile', Math.abs(duration - Number(length)) <= 30], ['declaredMatchesIndexFile', false], ['assetId', change.assetId ?? index],
        ['define', `SOUND_N_${index}`], ['sampleParameters', 1n], ['events', ['1_3']],
        ['audition', new Map<string, PyValue>([['decodedLengthMs', new PyFloat(duration)], ['nccHandleFile', new PyFloat(0.99)], ['nccIndexFile', new PyFloat(0.05)]])],
      ]);
    };
    const anchor = (file: string) => new Map<string, PyValue>([['handle', 1n], ['file', file], ['note', 'fixture'], ['mappedFile', 's0001.wav'], ['reproduced', true]]);
    const table = (rows: Map<string, PyValue>[], anchors: Map<string, PyValue>[]) => {
      const sm = new Map<string, PyValue>([['schema', soundmap.SCHEMA], ['game', 'fixture'], ['claimLevel', 'MODEL_ONLY'], ['fidelity', 'rebuilt-runtime'],
        ['rule', 'x'], ['lengthToleranceMs', 30n], ['handleCount', 2n], ['rows', rows], ['anchors', anchors], ['soloCaptures', new Map()]]);
      sm.set('summary', soundmap.summarize(rows, anchors));
      sm.set('evidenceId', soundmap.evidenceId(sm));
      return sm;
    };
    const good = table([smRow(1n, 0n, 1000n, 1001.0), smRow(0n, 1n, 500n, 510.0)], [anchor('s0001')]);
    const path = join(tmp, 'sm.json');
    writeFileSync(path, pyDumps(good));
    const summary = (key: string) => pyGet(field(soundmap.check(path), 'summary'), key);
    assert.deepEqual(['handleNotIndex', 'declaredLengthMatchesHandleFile', 'auditionBetterOnHandleFile', 'anchorsReproduced'].map(summary), [2n, 2n, 2n, 1n]);
    // Each wrong table keeps the good one's summary and id, so the refusal comes from the row or anchor itself.
    const wrong = (rows: Map<string, PyValue>[], anchors: Map<string, PyValue>[]) => new Map<string, PyValue>([...good, ['rows', rows], ['anchors', anchors]]);
    for (const [label, bad] of [
      ['a file keyed by the bank index', wrong([smRow(1n, 0n, 1000n, 1001.0, { file: 's0000.wav' }), smRow(0n, 1n, 500n, 510.0)], [anchor('s0001')])],
      ['a declared length off its file', wrong([smRow(1n, 0n, 1000n, 1001.0), smRow(0n, 1n, 500n, 510.0, { duration: 900.0 })], [anchor('s0001')])],
      ['a lost anchor', wrong([smRow(1n, 0n, 1000n, 1001.0), smRow(0n, 1n, 500n, 510.0)], [anchor('s0002')])],
      ['an asset that is not its bank index', wrong([smRow(1n, 0n, 1000n, 1001.0, { assetId: 5n }), smRow(0n, 1n, 500n, 510.0)], [anchor('s0001')])],
    ] as const) {
      writeFileSync(`${path}.bad`, pyDumps(bad));
      assert.throws(() => soundmap.check(`${path}.bad`), PyAssertionError, label);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('every committed build and sound-map record rechecks from its rows alone', () => {
  const schemaOf = (path: string): PyValue => {
    try {
      return pyGet(read(path), 'schema');
    } catch {
      return null;   // not a JSON record
    }
  };
  const checks = new Map<PyValue, (path: string) => unknown>([[builds.SCHEMA, path => builds.check(path)], [soundmap.SCHEMA, soundmap.check]]);
  const committed = readdirSync(RESULTS).filter(name => name.endsWith('.json')).sort().map(name => join(RESULTS, name))
    .flatMap(path => {
      const check = checks.get(schemaOf(path));
      return check ? [() => check(path)] : [];
    });
  for (const recheck of committed) recheck();
  assert.ok(committed.length >= 2, `rechecked ${committed.length} committed records`);
});
