#!/usr/bin/env node
// The sound mapping table of a rebuilt mobile game (recompile-sound-map-v1).
//
// For every sound-bank record: its Fusion handle, bank index and name, the length the CCN declares for it
// (CSoundBank.preLoad's handleToLength, in ms) and its frequency; the res/raw file the retail runtime opens for it
// (SoundPoolSounds.load and MediaSound.setSoundSettings: "raw/s%04d" formatted with the HANDLE) with that file's
// sha256, duration, rate and channels; the converted asset id and the generated events that play it; and, from an
// audition capture of the rebuilt runtime's mixer, the length it decoded and how well its output correlates with the
// handle's file and with the file the bank index would name. Anchors are phone-measured pairs (a handle and the file
// heard for it) the table must reproduce. Content-free: names, hashes, lengths and scores.
//
//   sound-map.ts record --game fnaf2 --probe PROBE.json --raw-dir RES_RAW --gamesrc DIR \
//       --audition TRACE:WAVE [--anchor HANDLE=FILE:NOTE ...] [--solo NAME=RESULT.json ...] \
//       [--scope KEY=VALUE ...] --out RESULT.json
//   sound-map.ts check RESULT.json ...
//
// check re-derives, without any audio: the file name from each handle, the declared-length agreement, the asset id
// from the bank index, every anchor's file, the summary counts and the evidenceId.
//
// Ported from sound-map.py: it writes the same record and prints and exits as that did. Its correlations are the
// Python's pure-list path (what CPython computes where numpy does not import); numpy's sums round differently, so a
// score can differ from the numpy path's in its third decimal at a rounding boundary.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PyAssertionError as AssertionError, PyFloat, type PyValue, pyAt as at, pyCompare, pyCompareNumbers, pyDecodeUtf8, pyDumps, pyEquals, pyFixed,
  pyFloatValue as real, pyGet, pyIntValue as int, pyIsDict, pyIsList, pyItem, pyKeyValues as keyValues, pyLoads, pyOptionList, pyOptionText, pyReadText,
  pyRegExp, pyReprOf, pySplit, pySplitLines, pyStr, pyStrip, pySubcommands, pyTruthy, pyUnpack as unpack, pyWave,
} from '@sixam/kernel/py';
import { fileSha256, globNames, readJson, readLines } from './record-io.ts';

export const SCHEMA = 'recompile-sound-map-v1';
const LENGTH_TOLERANCE_MS = 30n;

type Dict = Map<string, PyValue>;
const round = (x: number, digits: number) => new PyFloat(Number(pyFixed(x, digits)));
const list = (value: PyValue): readonly PyValue[] => {
  if (!pyIsList(value)) throw new TypeError('expected a list');
  return value;
};
/** int(value) of what json.loads read: an int as it is, a str read, a float truncated. */
function toInt(value: PyValue): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string') return int(value);
  if (typeof value === 'boolean') return value ? 1n : 0n;
  if (value instanceof PyFloat) return BigInt(Math.trunc(value.value));
  throw new TypeError(`int() argument must be a string or a real number, not ${pyReprOf(value)}`);
}
/** float(value) of a JSON number or str. */
function toFloat(value: PyValue): number {
  if (typeof value === 'string') return real(value);
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof PyFloat) return value.value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new TypeError(`float() argument must be a string or a real number, not ${pyReprOf(value)}`);
}
/** A JSON number as a double, for arithmetic Python did in floats. */
const number = (value: PyValue) => toFloat(value);

interface FileInfo { codec: PyValue, rate: bigint, channels: bigint, durationMs: PyFloat }

/** subprocess.run(argv, check=True).stdout: a failure stops the run. */
function run(argv: string[]): Buffer {
  const result = spawnSync(argv[0], argv.slice(1), { maxBuffer: 1 << 30 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command '${argv.join(' ')}' returned non-zero exit status ${result.status}.`);
  return result.stdout;
}

function ffprobe(path: string): FileInfo {
  const out = pyDecodeUtf8(run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', path]))
    .replace(/\r\n?/g, '\n');
  const j = pyLoads(out);
  const s = at(list(pyItem(j, 'streams')), 0);
  return { codec: pyGet(s, 'codec_name'), rate: toInt(pyItem(s, 'sample_rate')), channels: toInt(pyItem(s, 'channels')),
    durationMs: round(toFloat(pyItem(pyItem(j, 'format'), 'duration')) * 1000.0, 1) };
}

function decode(path: string, rate: number): Int16Array {
  const raw = run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', String(rate), '-']);
  const usable = raw.subarray(0, Math.floor(raw.length / 2) * 2);
  const view = new DataView(usable.buffer, usable.byteOffset, usable.byteLength);
  return Int16Array.from({ length: usable.length / 2 }, (_, k) => view.getInt16(2 * k, true));
}

/** The audition mix averaged to mono, as the pure-list path builds it. */
function monoMix(path: string): [number, number[]] {
  const wave = pyWave(readFileSync(path));
  if (wave.frames.length % 2) throw new RangeError('bytes length not a multiple of item size');
  const view = new DataView(wave.frames.buffer, wave.frames.byteOffset, wave.frames.byteLength);
  const samples = Int16Array.from({ length: wave.frames.length / 2 }, (_, k) => view.getInt16(2 * k, true));
  const ch = wave.channels;
  const mix: number[] = [];
  for (let i = 0; i + ch <= samples.length; i += ch) {
    let total = 0;
    for (let k = i; k < i + ch; k += 1) total += samples[k];
    mix.push(total / ch);
  }
  return [wave.rate, mix];
}

/** The best normalised correlation of ref against mix around start, Python's list arithmetic in its order. */
function nccLists(mix: readonly number[], start: number, ref: ArrayLike<number>, lag: number, step: number): number {
  let top = -1.0;
  const r = Array.from(ref);
  for (let off = -lag; off <= lag; off += step) {
    const a = start + off;
    if (a < 0 || a + r.length > mix.length) continue;
    const x = mix.slice(a, a + r.length);
    let sx = 0, sr = 0;
    for (const p of x) sx += p;
    for (const q of r) sr += q;
    const mx = sx / x.length, mr = sr / r.length;
    let num = 0, px = 0, qr = 0;
    for (let k = 0; k < x.length; k += 1) num += (x[k] - mx) * (r[k] - mr);
    for (const p of x) px += (p - mx) ** 2;
    for (const q of r) qr += (q - mr) ** 2;
    const den = Math.sqrt(px * qr);
    const c = den ? num / den : 0.0;
    if (c > top) top = c;
  }
  return top;
}

function bestNcc(mix: readonly number[], start: number, ref: ArrayLike<number>, lag: number, step: number): PyValue {
  if (!ref.length) return null;
  return round(nccLists(mix, start, ref, lag, step), 3);
}

/** The record's id: the sha256 of its sorted compact JSON without the id. */
export function evidenceId(result: ReadonlyMap<string, PyValue>): string {
  const text = pyDumps(new Map([...result].filter(([key]) => key !== 'evidenceId')), undefined, { separators: [',', ':'], ensureAscii: false, sortKeys: true });
  return `recompile-sound-map-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`;
}

/** The table's counts. */
export function summarize(rows: readonly PyValue[], anchors: readonly PyValue[]): Dict {
  const better = (audition: PyValue) => {
    const handle = pyGet(audition, 'nccHandleFile');
    const index = pyGet(audition, 'nccIndexFile');
    return handle !== null && pyCompareNumbers(handle, pyTruthy(index) ? index : 0n) === 1;
  };
  const count = (from: readonly PyValue[], test: (row: PyValue) => boolean) => BigInt(from.filter(test).length);
  return new Map<string, PyValue>([
    ['records', BigInt(rows.length)],
    ['handleNotIndex', count(rows, row => !pyEquals(pyItem(row, 'handle'), pyItem(row, 'bankIndex')))],
    ['declaredLengthMatchesHandleFile', count(rows, row => pyTruthy(pyItem(row, 'declaredMatchesHandleFile')))],
    ['declaredLengthMatchesIndexFile', count(rows, row => pyTruthy(pyItem(row, 'declaredMatchesIndexFile')))],
    ['auditionBetterOnHandleFile', count(rows, row => better(pyItem(row, 'audition')))],
    ['auditionScored', count(rows, row => pyGet(pyItem(row, 'audition'), 'nccHandleFile') !== null)],
    ['anchorsReproduced', count(anchors, anchor => pyTruthy(pyItem(anchor, 'reproduced')))],
    ['anchors', BigInt(anchors.length)],
  ]);
}

const DEFINE = pyRegExp(String.raw`^#define (SOUND_\w+) (\d+)\s*$`);
const EVENT = pyRegExp(String.raw`^\s*// event (\d+_\d+)`);
const PLAY = pyRegExp(String.raw`media\.play_id\((SOUND_\w+)`, 'g');

export interface RecordOptions {
  game: string, probe: string, rawDir: string, gamesrc: string, audition: string, out: string,
  anchor: readonly string[] | null, scope: readonly string[] | null, solo: readonly string[] | null,
}

export function cmdRecord(opts: RecordOptions) {
  const probeLines = pySplitLines(pyStrip(pyReadText(readFileSync(opts.probe))));
  const probe = pyLoads(probeLines.length ? probeLines[probeLines.length - 1] : '');
  const defines = new Map<bigint, string>();
  for (const line of readLines(join(opts.gamesrc, 'assets.h'))) {
    const match = DEFINE.exec(line);
    if (match) defines.set(int(match[2]), match[1]);
  }
  const sites = new Map<string, (string | null)[]>();
  for (const path of globNames(opts.gamesrc, 'events_', '.cpp').sort(pyCompare)) {
    let event: string | null = null;
    for (const line of readLines(path, 'replace')) {
      const match = EVENT.exec(line);
      if (match) event = match[1];
      for (const play of line.matchAll(PLAY)) sites.set(play[1], [...(sites.get(play[1]) ?? []), event]);
    }
  }
  const params = new Map<bigint, bigint>();
  for (const use of list(pyItem(probe, 'uses'))) {
    const handle = toInt(pyItem(use, 'handle'));
    params.set(handle, (params.get(handle) ?? 0n) + 1n);
  }
  const files = new Map<bigint, string>();
  for (const path of globNames(opts.rawDir, 's', '', name => /^s[0-9]{4}\./.test(name))) files.set(int(basename(path).slice(1, 5)), path);
  const [trace, wav] = unpack(opts.audition, ':', 2);
  const [rate, mix] = monoMix(wav);
  const windows = new Map<bigint, [number, number, number]>(), starts = new Map<bigint, [number, number, number]>();
  for (const line of readLines(trace)) {
    const f = pySplit(line);
    if (f.length > 5 && f[3] === 'audition') {
      const sid = int(f[4]);
      if (f[5] === 'start') {
        const kv = new Map<string, string>();
        for (let k = 6; k + 1 < f.length; k += 2) kv.set(f[k], f[k + 1]);
        const need = (key: string) => { const value = kv.get(key); if (value === undefined) throw new RangeError(`KeyError: '${key}'`); return value; };
        starts.set(sid, [real(f[2]), real(need('length_ms')), real(need('hold_ms'))]);
      } else if (f[5] === 'end') {
        const started = starts.get(sid);
        if (started !== undefined) {
          starts.delete(sid);
          windows.set(sid, started);
        }
      }
    }
  }
  const lag = Math.trunc(0.08 * rate), step = Math.max(1, Math.floor(rate / 4000));
  const rows: Dict[] = list(pyItem(probe, 'bank')).map(bank => {
    const [h, i] = [pyItem(bank, 'handle'), pyItem(bank, 'index')];
    const fh = typeof h === 'bigint' ? files.get(h) ?? null : null, fi = typeof i === 'bigint' ? files.get(i) ?? null : null;
    const infoh = fh ? ffprobe(fh) : null, infoi = fi ? ffprobe(fi) : null;
    const declared = pyItem(bank, 'lengthField');
    const within = (info: FileInfo | null) => info !== null && Math.abs(info.durationMs.value - number(declared)) <= Number(LENGTH_TOLERANCE_MS);
    const define = typeof i === 'bigint' ? defines.get(i) ?? null : null;
    const row = new Map<string, PyValue>([
      ['handle', h], ['bankIndex', i], ['name', pyItem(bank, 'name')], ['flags', pyItem(bank, 'flags')], ['declaredLengthMs', declared],
      ['declaredRate', pyItem(bank, 'rate')], ['file', fh ? basename(fh) : null], ['fileSha256', fh ? fileSha256(fh) : null],
      ['fileDurationMs', infoh ? infoh.durationMs : null], ['fileRate', infoh ? infoh.rate : null], ['fileChannels', infoh ? infoh.channels : null],
      ['fileCodec', infoh ? infoh.codec : null], ['indexFile', fi ? basename(fi) : null],
      ['declaredMatchesHandleFile', within(infoh)], ['declaredMatchesIndexFile', within(infoi)],
      ['assetId', i], ['define', define], ['sampleParameters', typeof h === 'bigint' ? params.get(h) ?? 0n : 0n],
      ['events', define === null ? [] : sites.get(define) ?? []],
    ]);
    const audition = new Map<string, PyValue>();
    const window = typeof i === 'bigint' ? windows.get(i) : undefined;
    if (window !== undefined) {
      const [wall, length, hold] = window;
      audition.set('decodedLengthMs', round(length, 1));
      // the first 250 ms of sound after the file's own leading silence
      const refLength = Math.trunc(Math.min(hold / 1000.0, 0.25) * rate);
      for (const [key, source] of [['nccHandleFile', fh], ['nccIndexFile', fi]] as const) {
        if (source === null) {
          audition.set(key, null);
          continue;
        }
        const ref = decode(source, rate);
        let lead = ref.findIndex(value => Math.abs(value) >= 16);
        if (lead < 0) lead = 0;
        if (lead / rate * 1000.0 > hold - 50) {
          audition.set(key, null);      // the audition window ends before this file makes a sound
          continue;
        }
        audition.set(key, bestNcc(mix, Math.trunc((wall + lead / rate) * rate), ref.subarray(lead, lead + refLength), lag, step));
      }
    }
    row.set('audition', audition);
    return row;
  });
  const anchors: Dict[] = (opts.anchor ?? []).map(spec => {
    const [handleText, rest] = unpack(spec, '=', 2);
    const [file, note] = unpack(rest, ':', 2);
    const handle = int(handleText);
    const mapped = rows.find(row => pyEquals(pyItem(row, 'handle'), handle)) ?? null;
    const mappedFile = mapped ? pyItem(mapped, 'file') : null;
    const stem = (name: string) => name.split('.')[0];
    return new Map<string, PyValue>([['handle', handle], ['file', file], ['note', note], ['mappedFile', mappedFile],
      ['reproduced', typeof mappedFile === 'string' && mappedFile !== '' && stem(mappedFile) === stem(file)]]);
  });
  const solos = new Map<string, PyValue>((opts.solo ?? []).map(spec => {
    const [name, path] = unpack(spec, '=', 2);
    const solo = readJson(path);
    return [name, new Map<string, PyValue>([['asset', pyItem(solo, 'asset')], ['plays', pyItem(solo, 'plays')], ['summary', pyItem(solo, 'summary')]])];
  }));
  const result = new Map<string, PyValue>([
    ['schema', SCHEMA], ['game', opts.game], ['claimLevel', 'MODEL_ONLY'], ['fidelity', 'rebuilt-runtime'],
    ['rule', "res/raw/s%04d formatted with the bank record's handle (SoundPoolSounds.load, MediaSound.setSoundSettings); a Sample parameter names that handle"],
    ['lengthToleranceMs', LENGTH_TOLERANCE_MS], ['handleCount', pyItem(probe, 'handleCount')], ['scope', keyValues(opts.scope ?? [])],
    ['rows', rows], ['anchors', anchors], ['soloCaptures', solos],
  ]);
  result.set('summary', summarize(rows, anchors));
  const id = evidenceId(result);
  result.set('evidenceId', id);
  writeFileSync(opts.out, `${pyDumps(result, 1, { sortKeys: true, ensureAscii: false })}\n`);
  console.log(`${id}: ${pyDumps(result.get('summary') ?? null, undefined, { sortKeys: true })}`);
}

/** '%04d' % n. */
const fourDigits = (n: bigint) => (n < 0n ? `-${String(-n).padStart(3, '0')}` : String(n).padStart(4, '0'));
const SHA256 = pyRegExp('^[0-9a-f]{64}$');

/** Re-derive a table's file names, length agreement, asset ids, anchors, summary and evidenceId. */
export function check(path: string): Dict {
  const loaded = readJson(path);
  const schema = pyGet(loaded, 'schema');
  if (!pyEquals(schema, SCHEMA)) throw new AssertionError(`${path}: schema ${pyReprOf(schema)}`);
  const result: Dict = pyIsDict(loaded) ? new Map(loaded) : new Map();
  const tol = pyItem(result, 'lengthToleranceMs');
  const rows = list(pyItem(result, 'rows'));
  for (const row of rows) {
    const handle = pyItem(row, 'handle'), file = pyItem(row, 'file');
    const handleText = pyStr(handle);
    if (file !== null && !pyStr(file).startsWith(`s${fourDigits(toInt(handle))}.`)) {
      throw new AssertionError(`${path}: handle ${handleText} maps to ${pyStr(file)}, not s${fourDigits(toInt(handle))}.*`);
    }
    if (!pyEquals(pyItem(row, 'assetId'), pyItem(row, 'bankIndex'))) {
      throw new AssertionError(`${path}: handle ${handleText} asset ${pyStr(pyItem(row, 'assetId'))} is not its bank index ${pyStr(pyItem(row, 'bankIndex'))}`);
    }
    const duration = pyItem(row, 'fileDurationMs');
    const want = duration !== null && (pyCompareNumbers(new PyFloat(Math.abs(number(duration) - number(pyItem(row, 'declaredLengthMs')))), tol) ?? 1) <= 0;
    if (!pyEquals(want, pyItem(row, 'declaredMatchesHandleFile'))) throw new AssertionError(`${path}: handle ${handleText} declaredMatchesHandleFile is not its lengths'`);
    const sha = pyItem(row, 'fileSha256');
    if (sha !== null && !SHA256.test(pyStr(sha))) throw new AssertionError(`${path}: handle ${handleText} sha256 malformed`);
  }
  const anchors = list(pyItem(result, 'anchors'));
  for (const anchor of anchors) {
    const row = rows.find(candidate => pyEquals(pyItem(candidate, 'handle'), pyItem(anchor, 'handle'))) ?? null;
    const file = row === null ? null : pyItem(row, 'file');
    const ok = typeof file === 'string' && file !== '' && file.split('.')[0] === pyStr(pyItem(anchor, 'file')).split('.')[0];
    if (!pyEquals(ok, pyItem(anchor, 'reproduced')) || !ok) {
      throw new AssertionError(`${path}: anchor handle ${pyStr(pyItem(anchor, 'handle'))} -> ${pyStr(pyItem(anchor, 'file'))} not reproduced`);
    }
  }
  if (!pyEquals(summarize(rows, anchors), pyItem(result, 'summary'))) throw new AssertionError(`${path}: summary is not its rows'`);
  const id = evidenceId(result);
  if (!pyEquals(id, pyItem(result, 'evidenceId'))) throw new AssertionError(`${path}: evidenceId ${pyStr(pyItem(result, 'evidenceId'))} is not ${id}`);
  return result;
}

function main(argv: readonly string[]): number {
  const parsed = pySubcommands(argv, 'sound-map.ts', 'cmd', {
    record: { options: [...['game', 'probe', 'raw-dir', 'gamesrc', 'audition', 'out'].map(name => ({ name: `--${name}`, required: true })),
      { name: '--anchor', append: true }, { name: '--scope', append: true }, { name: '--solo', append: true }] },
    check: { options: [], positionals: [{ name: 'records', rest: true, required: true }] },
  });
  if ('exit' in parsed) {
    (parsed.exit ? console.error : console.log)(parsed.text);
    return parsed.exit;
  }
  const { command, args } = parsed;
  if (command === 'record') {
    const required = (name: string) => pyOptionText(args, name) ?? '';
    cmdRecord({ game: required('--game'), probe: required('--probe'), rawDir: required('--raw-dir'), gamesrc: required('--gamesrc'),
      audition: required('--audition'), out: required('--out'), anchor: pyOptionList(args, '--anchor'), scope: pyOptionList(args, '--scope'),
      solo: pyOptionList(args, '--solo') });
    return 0;
  }
  for (const path of args.positionals) {
    const result = check(path);
    const summary = pyItem(result, 'summary');
    console.log(`${pyStr(pyItem(result, 'evidenceId'))}: ${path} rechecked (${pyStr(pyItem(summary, 'records'))} records, `
      + `${pyStr(pyItem(summary, 'anchorsReproduced'))}/${pyStr(pyItem(summary, 'anchors'))} anchors)`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
