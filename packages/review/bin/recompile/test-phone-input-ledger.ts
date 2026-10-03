#!/usr/bin/env node
// Gate for the phone input ledger: the frame classifiers on synthetic cells, then every difference, alignment and hash
// of docs/evidence/full06-input-registration-20260928.json re-derived from the retained result rows, and the audio
// cue and rebuild records it cites read back. Needs no frame trace, capture, numpy or binary. test-phone-audio-cues.py
// checks the offset rule phone-audio-cues.py solves, which needs that tool.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type PyValue, pyDumps, pyFixed, pyGet, pyIsDict, pyIsList, pyItem, pyLoads, pyStr } from '@sixam/kernel/py';
import { eyeholeLetter, officeClock, signature } from './phone-input-ledger.ts';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const load = (path: string): PyValue => pyLoads(readFileSync(`${ROOT}${path}`, 'utf8'));
const sha = (path: string) => createHash('sha256').update(readFileSync(`${ROOT}${path}`)).digest('hex');
const at = (value: PyValue, ...keys: string[]) => keys.reduce((node, key) => pyItem(node, key), value);
const list = (value: PyValue) => (pyIsList(value) ? value : assert.fail(`not a list: ${pyStr(value)}`));
const entries = (value: PyValue) => (pyIsDict(value) ? [...value] : assert.fail(`not a dict: ${pyStr(value)}`));
const num = (value: PyValue) => (typeof value === 'bigint' ? Number(value) : value instanceof Object && 'value' in value && typeof value.value === 'number' ? value.value
  : assert.fail(`not a number: ${pyStr(value)}`));
/** round(x, 2) as Python rounds a float. */
const round2 = (x: number) => Number(pyFixed(x, 2));

test('the frame classifiers and the catch-up clock', () => {
  assert.ok(signature(142, 144) === 'office' && signature(4, 144) === 'monitor-up' && signature(142, 0) === 'mask-on');
  assert.ok(signature(60, 144) === null && signature(4, 4) === null, 'transitional and both-absent frames withhold an answer');
  // {(row, col): (r, g, b)} -> 20x9 RGB hex, everything else black
  const grid = (cells: (row: number, col: number) => [number, number, number] | null) => {
    let hex = '';
    for (let r = 0; r < 9; r += 1) for (let c = 0; c < 20; c += 1) for (const v of cells(r, c) ?? [0, 0, 0]) hex += v.toString(16).padStart(2, '0');
    return hex;
  };
  const block = (colour: [number, number, number]) => grid((r, c) => (r >= 3 && r <= 5 && c >= 11 && c <= 14 ? colour : null));
  assert.equal(eyeholeLetter(block([40, 40, 120])), 'B');     // 12 cells, hue 240
  assert.equal(eyeholeLetter(block([120, 100, 20])), 'C');    // hue 48, sat 0.83
  assert.equal(eyeholeLetter(block([60, 20, 25])), null, 'the mask rim (hue 352) is not an occupant');
  assert.equal(eyeholeLetter(grid((r, c) => (r === 3 && (c === 11 || c === 12) ? [40, 40, 120] : null))), null, 'a two-cell fleck is not an occupant');
  // the office clock: catch-up splits a 33 ms interval into two updates (32 + 1 ms) and never past three
  const [deltas, passStart, cum] = officeClock([0n, 16_700_000n, 50_000_000n, 66_700_000n, 150_000_000n], 0);
  assert.deepEqual(passStart, [0, 1, 2, 4, 5]);
  assert.ok(Math.abs(deltas[2] - 32.3) < 0.01 && deltas[3] === 1.0 && deltas.length === 8, String(deltas));
  assert.ok(Math.abs(cum[cum.length - 1] - (150.0 + 1000 / 60)) < 1e-6, 'the clock spends one 60 Hz frame for update 0 and then exactly the captured time');
});

test('the input-registration record against its rows, and the cue and rebuild records it cites', () => {
  const rec = load('docs/evidence/full06-input-registration-20260928.json');
  const body = new Map(entries(rec).filter(([key]) => key !== 'id'));
  assert.equal(pyItem(rec, 'id'), `s2-input-registration-${createHash('sha256').update(pyDumps(body, undefined, { sortKeys: true })).digest('hex').slice(0, 16)}`,
    'the record id is not its own hash');
  for (const result of list(pyItem(rec, 'results'))) assert.equal(sha(pyStr(pyItem(result, 'path'))), pyItem(result, 'sha256'), `${pyStr(pyItem(result, 'path'))} changed since the record was written`);

  const ledger = load('tools/recompile/results/phone-input-ledger-full-06-20260928.json');
  assert.ok(pyItem(ledger, 'schema') === 'phone-input-ledger-v1' && list(pyItem(ledger, 'cycles')).length === 7);
  const registration = at(rec, 'measurements', 'inputRegistration', 'phoneMinusRebuildUpdates');
  for (const cycle of list(pyItem(ledger, 'cycles'))) {
    const index = pyStr(pyItem(cycle, 'cycle'));
    for (const [name, event] of entries(pyItem(cycle, 'events'))) {
      const [phone, rebuild, difference] = [pyItem(event, 'phone'), pyItem(event, 'rebuild'), pyItem(event, 'phoneMinusRebuildUpdates')];
      if (pyIsDict(phone) && pyIsDict(rebuild)) assert.equal(difference, BigInt(num(pyItem(phone, 'update')) - num(pyItem(rebuild, 'update'))), `${index} ${name}`);
      else assert.equal(difference, null);
      if (pyIsDict(registration) && registration.has(name)) assert.equal(pyGet(pyItem(registration, name), index), difference, `${name} ${index}`);
    }
    const eye = at(rec, 'measurements', 'eyehole', index);
    const letter = (side: string) => { const value = at(cycle, 'occupant', side); return pyIsDict(value) ? pyGet(value, 'letter') : null; };
    assert.ok(pyItem(eye, 'phone') === letter('phone') && pyItem(eye, 'rebuild') === letter('rebuild'), `eyehole ${index}`);
  }
  assert.deepEqual(entries(pyItem(registration, 'hallFlashOff')).map(([k, v]) => [Number(k), num(v)]), [[1, -3], [3, -5], [4, -5], [6, -4]],
    'the phone flash ends 3-5 updates before the replayed hall release in every flashed cycle');
  assert.ok(entries(pyItem(registration, 'monitorUp')).every(([k, v]) => k === '0' || (num(v) >= -2 && num(v) <= 1)));
  const eyehole = (index: string) => entries(at(rec, 'measurements', 'eyehole', index));
  assert.deepEqual([eyehole('3'), eyehole('4'), eyehole('6')], [[['phone', 'B'], ['rebuild', 'B']], [['phone', 'C'], ['rebuild', 'C']], [['phone', null], ['rebuild', 'B']]],
    'window 6: the phone eyehole is empty where the rebuild has Bonnie');

  const cues = load('tools/recompile/results/phone-audio-cues-full-06-20260928.json');
  const offset = pyItem(cues, 'offset');
  const pairs = list(pyItem(offset, 'pairs'));
  const diffs = pairs.map(pair => num(pyItem(pair, 'diffS'))).sort((a, b) => a - b);
  assert.ok(num(pyItem(offset, 'audioMinusGameS')) === diffs[Math.floor(diffs.length / 2)] && pairs.length >= 3
    && diffs.every(diff => Math.abs(diff) <= num(at(cues, 'rule', 'anchorToleranceS'))));
  assert.ok(pairs.every(pair => Math.abs(num(pyItem(pair, 'audioS')) - num(pyItem(pair, 'gameS')) - num(pyItem(pair, 'diffS'))) < 1e-6));
  for (const [, cue] of entries(pyItem(cues, 'cues'))) {
    for (const onset of list(pyItem(cue, 'onsets'))) {
      assert.ok(Math.abs(num(pyItem(onset, 'gameS')) - round2(num(pyItem(onset, 'audioS')) - num(pyItem(offset, 'audioMinusGameS')))) < 0.011);
    }
  }
  const strong = list(at(cues, 'cues', 's0017', 'onsets')).filter(onset => num(pyItem(onset, 'ncc')) >= 0.5).map(onset => num(pyItem(onset, 'gameS')));
  assert.deepEqual(strong, list(at(rec, 'measurements', 'phoneCues', 'bangsGameS_ncc>=0.5')).map(num));
  assert.deepEqual(strong.slice(0, 3), [50.04, 55.01, 60.38]);
  const vocals = at(rec, 'measurements', 'phoneCues', 'balloonBoyVocalsGameS');
  assert.deepEqual(list(pyItem(vocals, 's0024')).map(entry => num(list(entry)[0])), [40.04]);
  assert.deepEqual(list(pyItem(vocals, 's0023')).map(entry => num(list(entry)[0])), [45.08, 50.04]);

  const rebuild = load('tools/recompile/results/rebuild-audio-full-06-landed-20260928.json');
  const bangs = list(pyItem(rebuild, 'plays')).filter(play => pyItem(play, 'assetId') === 22n).map(play => num(pyItem(play, 'gameS')));
  assert.deepEqual(bangs, list(pyItem(rebuild, 'bangsGameS')).map(num));
  assert.deepEqual(bangs, list(at(rec, 'measurements', 'rebuildCues', 'bangsGameS')).map(num));
  assert.ok(num(list(at(rebuild, 'balloonBoy', 'hopsAfterLeaveGameS'))[0]) === 50.02 && num(at(rebuild, 'balloonBoy', 'officeArrivalGameS')) === 70.32,
    'the rebuild holds Balloon Boy through the 40 and 45 s rolls');
  const hall = load('tools/recompile/results/hall-shift-sensitivity-full-06-20260928.json');
  for (const [name, variant] of entries(pyItem(hall, 'variants'))) {
    const windows = pyStr(pyItem(variant, 'rebuiltWindows'));
    assert.notEqual([...windows][6], '.', `${name}: a hall shift emptied window 6, the record says none does`);
    assert.equal(at(rec, 'measurements', 'hallShiftSensitivity', 'variants', name, 'window6'), [...windows][6]);
  }
  assert.ok(pyStr(at(hall, 'variants', 'v-hallLight_down_0_up_0', 'rebuiltWindows')).startsWith('...BC.BC.BC.BC.C..BC'), 'the 0/0 control is the retained landed replay');
});
