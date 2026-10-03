#!/usr/bin/env node
// FIXTURE regressions for audio-report.ts, then a recheck of every committed recompile-audio-v1 record (no binaries
// needed). Source's recompile/test-recompile-records.ts covers the build and sound-map records.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PyAssertionError as AssertionError, type PyValue, pyDumps, pyGet, pyIsDict, pyItem, pyLoads, pyRound } from '@sixam/kernel/py';
import * as audio from './audio-report.ts';

const RESULTS = fileURLToPath(new URL('../../../../tools/recompile/results', import.meta.url));

/** segments: [seconds, peak amplitude] of a 440 Hz tone; amplitude 0 is digital silence. A stereo 16-bit WAV. */
function writeWave(path: string, segments: readonly [number, number][], rate = 44100) {
  const samples: number[] = [];
  for (const [seconds, amp] of segments) {
    for (let i = 0; i < Math.trunc(seconds * rate); i += 1) {
      const v = pyRound(amp * Math.sin(2 * Math.PI * 440 * i / rate)) ?? 0;
      samples.push(v, v);
    }
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, k) => data.writeInt16LE(v, 2 * k));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

const read = (path: string): PyValue => pyLoads(readFileSync(path, 'utf8'));
const at = (value: PyValue, ...keys: string[]) => keys.reduce((node, key) => pyItem(node, key), value);
/** A copy of a record with one value replaced along a path. */
function tampered(value: PyValue, keys: readonly (string | number)[], replacement: PyValue): PyValue {
  if (!keys.length) return replacement;
  const [key, ...rest] = keys;
  if (typeof key === 'number') {
    if (!Array.isArray(value)) throw new TypeError('not a list');
    return value.map((entry, k) => (k === key ? tampered(entry, rest, replacement) : entry));
  }
  if (!pyIsDict(value)) throw new TypeError('not a dict');
  return new Map([...value].map(([name, entry]) => [name, name === key ? tampered(entry, rest, replacement) : entry]));
}
const write = (path: string, value: PyValue) => writeFileSync(path, pyDumps(value));

test('the audio record is derived, checked and refused as the Python did', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'audio-records-'));
  try {
    // A mix: 0.5 s silence, sound 0 loud for 0.4 s, 0.3 s silence, sound 1 at peak 10 (under the floor).
    const wav = join(tmp, 'mix.wav');
    writeWave(wav, [[0.5, 0], [0.4, 8000], [0.3, 0], [0.4, 10], [0.4, 0]]);
    const trace = join(tmp, 'audition');
    writeFileSync(trace, '# audio-trace v1\n-1 0 0.5000 audition 0 start length_ms 400.0 hold_ms 400.0 rate 44100\n-1 0 0.9000 audition 0 end status 2\n'
      + '-1 0 1.2000 audition 1 start length_ms 400.0 hold_ms 400.0 rate 44100\n-1 0 1.6000 audition 1 end status 2\n-1 0 1.7000 audition 2 absent\n');
    const run = join(tmp, 'run');
    writeFileSync(run, '1 3 0.5000 play 0 0 1 400.0 2\n1 9 1.2000 play 1 2 0 400.0 2\n1 10 1.3000 vol 2 50\n');
    const probe = join(tmp, 'probe.json');
    writeFileSync(probe, JSON.stringify({ schema: 'recompile-sound-probe-v1', build: 296, handleCount: 4, records: 3,
      bank: [{ index: 0, handle: 1, flags: 288, named: true, rate: 44100, lengthField: 0, name: 'a', resource: ['s0001.wav'], bytes: 100, format: 'wav' },
        { index: 1, handle: 0, flags: 256, named: true, rate: 44100, lengthField: 0, name: 'b', resource: ['s0000.mp3'], bytes: 100, format: 'mp3' },
        { index: 2, handle: 3, flags: 256, named: true, rate: 44100, lengthField: 0, name: 'c', resource: [], bytes: null }],
      uses: [{}, {}], rawFiles: 2, rawWithoutRecord: [], frameErrors: [] }));
    const src = join(tmp, 'gamesrc');
    mkdirSync(src);
    writeFileSync(join(src, 'assets.h'), '#define SOUND_A_0 0\n#define SOUND_B_1 1\n#define SOUND_C_2 2\n');
    writeFileSync(join(src, 'events_1.cpp'), '    // event 4_3\n    media.play_id(SOUND_A_0, 1-1);\n    // event 5_3\n'
      + '    media.play_id(SOUND_B_1, 3-1, 0);\n    media.play_id(INVALID_ASSET_ID, 1-1);\n');
    writeFileSync(join(src, 'frame1_1.cpp'), '    name = std::string("02-title", 8);\n');
    writeFileSync(join(src, 'CMakeLists.txt'), 'project(Chowdren)\n');
    const out = join(tmp, 'fixture-audio.json');
    audio.cmdRecord({ game: 'fixture', probe, gamesrc: src, audition: `${trace}:${wav}`, run: [`night:${run}:${wav}`], baseline: [`old:${wav}`],
      scope: ['binarySha256=x'], limitation: null, out });
    const rec = audio.check(out);
    const answer = (key: string) => at(rec, 'answer', key);
    assert.deepEqual(['declared', 'resolvedFiles', 'missingFiles', 'transcodedMp3', 'handleNotIndex', 'playSites', 'soundsWithPlaySites',
      'auditionMeasured', 'auditionNonSilent', 'run:night:plays', 'run:night:soundsPlayed'].map(answer), [3n, 2n, 1n, 1n, 3n, 2n, 2n, 2n, 1n, 2n, 2n]);
    assert.equal(at(rec, 'static', 'invalidPlaySites'), 1n);
    const rows = pyItem(rec, 'rows');
    const row = (k: number) => (Array.isArray(rows) ? rows[k] : null);
    assert.ok(at(row(0), 'audition', 'nonSilent') === true && Number(at(row(0), 'audition', 'peak')) >= 7990, 'sound 0 is loud');
    assert.ok(at(row(1), 'audition', 'nonSilent') === false && Number(at(row(1), 'audition', 'peak')) <= 10, 'sound 1 stays under the floor');
    assert.deepEqual(at(row(2), 'audition'), new Map([['status', 'ABSENT']]));
    assert.deepEqual([at(row(0), 'events'), at(row(1), 'events')], [['4_3'], ['5_3']]);
    assert.deepEqual(at(row(1), 'runs', 'night', 'loops'), [0n]);
    assert.deepEqual(at(rec, 'runs', 'night', 'traceEvents'), new Map([['play', 2n], ['vol', 1n]]));
    // a silent mix stays silent under the thresholds: openal-soft's dither is RMS 0.5, peak 1
    assert.equal(at(rec, 'baselines', 'old', 'nonSilent'), true, 'the fixture mix itself is loud');
    write(`${out}.bad`, tampered(rec, ['answer', 'auditionNonSilent'], 2n));
    assert.throws(() => audio.check(`${out}.bad`), AssertionError);
    write(`${out}.bad2`, tampered(rec, ['rows', 1, 'audition', 'nonSilent'], true));
    assert.throws(() => audio.check(`${out}.bad2`), AssertionError);
    const partial = audio.totals([tampered(row(0), ['audition'], 'UNKNOWN')], []);
    assert.ok(pyGet(partial, 'auditionMeasured') === 0n && pyGet(partial, 'auditionNonSilent') === 0n);

  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('every committed audio record rechecks from its rows alone', () => {
  let rechecked = 0;
  for (const name of readdirSync(RESULTS).filter(file => file.endsWith('.json')).sort()) {
    const path = join(RESULTS, name);
    let schema: PyValue = null;
    try {
      schema = pyGet(read(path), 'schema');
    } catch {
      continue;
    }
    if (schema !== audio.SCHEMA) continue;
    audio.check(path);
    rechecked += 1;
  }
  assert.ok(rechecked >= 4, `rechecked ${rechecked} committed audio records`);
});
