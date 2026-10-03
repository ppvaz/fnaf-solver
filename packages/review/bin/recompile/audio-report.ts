#!/usr/bin/env node
// Content-free audio record for a rebuilt Clickteam game (recompile-audio-v1).
//
// The rebuilt runtime writes CHOWDREN_AUDIO_TRACE lines (media.cpp) and, under openal-soft's wave backend
// (ALSOFT_DRIVERS=wave, ALSOFT_CONF naming the file), the mixer's own output as a WAV. This joins the converter's view
// (the sound bank from probe-sounds.py, the generated assets.h and every play site in the generated events), an
// audition run (CHOWDREN_AUDIO_AUDITION: each sound alone through the mixer) and bounded game runs into one record of
// derived numbers: counts, lengths, RMS and peak levels in 16-bit sample units. No audio, frame or game text other
// than sound names and event ids is written.
//
//   audio-report.ts record --game fnaf2 --probe probe.json --gamesrc DIR \
//       --audition TRACE:WAVE [--run NAME:TRACE:WAVE ...] [--baseline NAME:WAVE ...] \
//       [--scope KEY=VALUE ...] --out RESULT.json
//   audio-report.ts check RESULT.json ...     re-derive a record's totals and evidenceId
//
// A window is NON-SILENT when its peak is at least PEAK_FLOOR and its RMS at least RMS_FLOOR: openal-soft dithers a
// silent 16-bit mix to RMS 0.5, peak 1.
//
// Ported from audio-report.py: it writes the same record, byte for byte, and prints and exits as that did. The record
// is held as Python held it -- dicts as Maps in their key order, ints as bigints, floats as PyFloats -- so its
// evidenceId is the same hash.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PyAssertionError as AssertionError, PyFloat, type PyValue, pyAt as at, pyCompare, pyCompareNumbers, pyDecodeUtf8, pyDumps, pyEquals, pyFixed,
  pyFloatValue as real, pyGet, pyIntValue as int, pyIsDict, pyIsList, pyItem, pyKeyValues as keyValues, pyLen, pyLoads, pyOptionList, pyOptionText,
  pyReadText, pyRegExp, pySplit, pySplitLimit as split, pyStr, pyStrip, pySubcommands, pySum, pyTruthy, pyUnpack as unpack, pyWave,
} from '@sixam/kernel/py';

export const SCHEMA = 'recompile-audio-v1';
const PEAK_FLOOR = 16n;
const RMS_FLOOR = 2.0;
const TAIL_S = 0.1;          // an audition window runs to its end line plus this (mixer latency)
const PLAY_WINDOW_S = 1.0;   // a game-run play is measured over at most this much of its length

type Dict = Map<string, PyValue>;

const fileSha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
/** `for line in open(path)`: strict UTF-8, universal newlines, each line with its newline. */
const readLines = (path: string) => pyReadText(readFileSync(path)).match(/[^\n]*\n|[^\n]+$/g) ?? [];
const readJson = (path: string): PyValue => pyLoads(pyDecodeUtf8(readFileSync(path)));
/** sorted(glob(join(directory, 'events_*.cpp'))). */
function eventFiles(directory: string): string[] {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return [];
  }
  return names.filter(name => name.startsWith('events_') && name.endsWith('.cpp') && name.length >= 11).map(name => join(directory, name)).sort(pyCompare);
}
const round = (x: number, digits: number) => new PyFloat(Number(pyFixed(x, digits)));
const list = (value: PyValue): readonly PyValue[] => {
  if (!pyIsList(value)) throw new TypeError('expected a list');
  return value;
};

/** A 16-bit PCM WAV held as interleaved samples. */
export class Mix {
  readonly rate: number;
  readonly channels: number;
  readonly samples: Int16Array;
  readonly seconds: number;

  constructor(path: string) {
    const wave = pyWave(readFileSync(path));
    if (wave.sampwidth !== 2) throw new RangeError(`${path}: expected 16-bit PCM`);
    if (wave.frames.length % 2) throw new RangeError('bytes length not a multiple of item size');
    this.rate = wave.rate;
    this.channels = wave.channels;
    const view = new DataView(wave.frames.buffer, wave.frames.byteOffset, wave.frames.byteLength);
    this.samples = Int16Array.from({ length: wave.frames.length / 2 }, (_, k) => view.getInt16(2 * k, true));
    this.seconds = this.samples.length / (this.rate * this.channels);
  }

  window(startS: number, endS: number): Dict {
    const a = Math.max(0, Math.trunc(startS * this.rate)) * this.channels;
    const b = Math.min(this.samples.length, Math.trunc(endS * this.rate) * this.channels);
    if (b <= a) return new Map<string, PyValue>([['rms', null], ['peak', null], ['nonSilent', null], ['samples', 0n]]);
    // sum(x * x) exactly: blocks small enough to stay exact as doubles, added as one int.
    let squares = 0n, low = Infinity, high = -Infinity;
    for (let from = a; from < b; from += 65536) {
      let block = 0;
      for (let k = from; k < Math.min(b, from + 65536); k += 1) {
        const x = this.samples[k];
        block += x * x;
        low = Math.min(low, x);
        high = Math.max(high, x);
      }
      squares += BigInt(block);
    }
    const rms = Math.sqrt(Number(squares) / (b - a));
    const peak = BigInt(Math.max(Math.abs(low), Math.abs(high)));
    return new Map<string, PyValue>([['rms', round(rms, 2)], ['peak', peak], ['nonSilent', peak >= PEAK_FLOOR && rms >= RMS_FLOOR],
      ['samples', BigInt(b - a)]]);
  }

  overall(blockS = 0.1): Dict {
    const whole = this.window(0.0, this.seconds + 1.0);
    const blocks = Math.trunc(this.seconds / blockS);
    let loud = 0n;
    for (let i = 0; i < blocks; i += 1) if (this.window(i * blockS, (i + 1) * blockS).get('nonSilent') === true) loud += 1n;
    return new Map<string, PyValue>([['seconds', round(this.seconds, 3)], ['rate', BigInt(this.rate)], ['channels', BigInt(this.channels)],
      ['rms', whole.get('rms') ?? null], ['peak', whole.get('peak') ?? null], ['nonSilent', whole.get('nonSilent') ?? null],
      ['blocks100ms', BigInt(blocks)], ['nonSilentBlocks100ms', loud]]);
  }
}

interface TraceRow { frame: bigint, tick: bigint, wall: number, event: string, args: string[] }

function readTrace(path: string): TraceRow[] {
  return readLines(path).flatMap(line => {
    if (line.startsWith('#') || !pyStrip(line)) return [];
    const parts = pySplit(line);
    return [{ frame: int(parts[0]), tick: int(parts[1]), wall: real(parts[2]), event: at(parts, 3), args: parts.slice(4) }];
  });
}

const DEFINE = pyRegExp(String.raw`^#define (SOUND_\w+) (\d+)\s*$`);
const EVENT = pyRegExp(String.raw`^\s*// event (\d+_\d+)`);
const PLAY = pyRegExp(String.raw`media\.play_id\((\w+)`, 'g');
const QUERY = pyRegExp(String.raw`media\.is_sample_playing\((\w+)`, 'g');

/** assets.h's sound defines and every generated play site, by event id. */
function staticCensus(gamesrc: string) {
  const defines = new Map<bigint, string>();
  for (const line of readLines(join(gamesrc, 'assets.h'))) {
    const match = DEFINE.exec(line);
    if (match) defines.set(int(match[2]), match[1]);
  }
  const sites = new Map<string, (string | null)[]>(), queries = new Map<string, (string | null)[]>();
  const add = (to: Map<string, (string | null)[]>, key: string, event: string | null) => to.set(key, [...(to.get(key) ?? []), event]);
  let invalid = 0n;
  for (const path of eventFiles(gamesrc)) {
    let event: string | null = null;
    for (const line of readLines(path)) {
      const match = EVENT.exec(line);
      if (match) event = match[1];
      for (const play of line.matchAll(PLAY)) {
        if (play[1] === 'INVALID_ASSET_ID') invalid += 1n;
        else add(sites, play[1], event);
      }
      for (const query of line.matchAll(QUERY)) add(queries, query[1], event);
    }
  }
  return { defines, sites, invalid, queries };
}

/** dict(zip(args[from::2], args[from + 1::2])). */
function pairs(args: readonly string[], from: number) {
  const out = new Map<string, string>();
  for (let k = from; k + 1 < args.length; k += 2) out.set(args[k], args[k + 1]);
  return out;
}
function need(map: ReadonlyMap<string, string>, key: string) {
  const value = map.get(key);
  if (value === undefined) throw new RangeError(`KeyError: '${key}'`);
  return value;
}

function auditionRows(trace: readonly TraceRow[], mix: Mix): Map<bigint, Dict> {
  const starts = new Map<bigint, [number, number, number, bigint]>();
  const out = new Map<bigint, Dict>();
  for (const row of trace) {
    if (row.event !== 'audition') continue;
    const sid = int(row.args[0]), what = at(row.args, 1);
    const started = starts.get(sid);
    if (what === 'start') {
      const kv = pairs(row.args, 2);
      starts.set(sid, [row.wall, real(need(kv, 'length_ms')), real(need(kv, 'hold_ms')), int(need(kv, 'rate'))]);
    } else if (what === 'end' && started !== undefined) {
      starts.delete(sid);
      const [wall, length, hold, rate] = started;
      const window = mix.window(wall, row.wall + TAIL_S);
      out.set(sid, new Map<string, PyValue>([['lengthMs', round(length, 1)], ['holdMs', round(hold, 1)], ['rate', rate],
        ['rms', window.get('rms') ?? null], ['peak', window.get('peak') ?? null], ['nonSilent', window.get('nonSilent') ?? null]]));
    } else if (what === 'absent' || what === 'undecodable') out.set(sid, new Map([['status', what.toUpperCase()]]));
  }
  return out;
}

interface Played { plays: bigint, channels: bigint[], loops: bigint[], first: Dict | null, windowPeakMax: bigint | null, nonSilentWindows: bigint }

function runSummary(trace: readonly TraceRow[], mix: Mix | null): [Map<bigint, Dict>, Dict] {
  const per = new Map<bigint, Played>();
  const plays = trace.filter(row => row.event === 'play');
  for (const row of plays) {
    const [sid, channel, loop, length] = [int(row.args[0]), int(row.args[1]), int(row.args[2]), real(row.args[3])];
    const window = mix ? mix.window(row.wall, row.wall + Math.min(PLAY_WINDOW_S, Math.max(length, 0.0) / 1000.0)) : null;
    const p = per.get(sid) ?? { plays: 0n, channels: [], loops: [], first: null, windowPeakMax: null, nonSilentWindows: 0n };
    per.set(sid, p);
    p.plays += 1n;
    if (!p.channels.includes(channel)) p.channels.push(channel);
    if (!p.loops.includes(loop)) p.loops.push(loop);
    if (p.first === null) p.first = new Map<string, PyValue>([['frame', row.frame], ['tick', row.tick], ['wallS', round(row.wall, 3)]]);
    const peak = window?.get('peak');
    if (window && typeof peak === 'bigint') {
      // max(windowPeakMax or 0, peak)
      const best = p.windowPeakMax ?? 0n;
      p.windowPeakMax = best >= peak ? best : peak;
      if (window.get('nonSilent') === true) p.nonSilentWindows += 1n;
    }
  }
  const events = new Map<string, bigint>();
  for (const row of trace) events.set(row.event, (events.get(row.event) ?? 0n) + 1n);
  const rows = new Map([...per].map(([sid, p]) => [sid, new Map<string, PyValue>([['plays', p.plays], ['channels', p.channels], ['loops', p.loops],
    ['first', p.first], ['windowPeakMax', p.windowPeakMax], ['nonSilentWindows', p.nonSilentWindows]])]));
  return [rows, new Map<string, PyValue>([['traceEvents', events], ['plays', BigInt(plays.length)], ['distinctSounds', BigInt(per.size)],
    ['mix', mix ? mix.overall() : 'UNKNOWN']])];
}

/** The record's id: the sha256 of its compact JSON without the id, as json.dumps(separators=(',', ':'),
 *  ensure_ascii=False) wrote it. */
function evidenceId(result: ReadonlyMap<string, PyValue>): string {
  const text = pyDumps(new Map([...result].filter(([key]) => key !== 'evidenceId')), undefined, { separators: [',', ':'], ensureAscii: false });
  return `recompile-audio-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`;
}

/** The answer's counts, derived from the rows alone (check re-derives them). */
export function totals(rows: readonly PyValue[], runs: readonly string[]): Dict {
  const count = (test: (row: PyValue) => boolean) => BigInt(rows.filter(test).length);
  const measured = (row: PyValue, key: string) => {
    const audition = pyGet(row, 'audition');
    return pyIsDict(audition) ? pyGet(audition, key) : undefined;
  };
  const t = new Map<string, PyValue>([
    ['declared', BigInt(rows.length)],
    ['resolvedFiles', count(row => pyTruthy(pyGet(row, 'resource')))],
    ['missingFiles', count(row => !pyTruthy(pyGet(row, 'resource')))],
    ['transcodedMp3', count(row => pyEquals(pyGet(row, 'format'), 'mp3'))],
    ['handleNotIndex', count(row => !pyEquals(pyItem(row, 'handle'), pyItem(row, 'bankIndex')))],
    ['playSites', pySum(rows.map(row => pyLen(pyItem(row, 'events'))))],
    ['soundsWithPlaySites', count(row => pyTruthy(pyItem(row, 'events')))],
    ['auditionNonSilent', count(row => { const value = measured(row, 'nonSilent'); return value !== undefined && pyTruthy(value); })],
    ['auditionMeasured', count(row => { const value = measured(row, 'rms'); return value !== undefined && value !== null; })],
  ]);
  for (const name of runs) {
    // name in r.get('runs', {})
    const played = rows.filter(row => {
      const ran = pyIsDict(row) && row.has('runs') ? pyItem(row, 'runs') : new Map<string, PyValue>();
      if (pyIsDict(ran)) return ran.has(name);
      if (pyIsList(ran)) return ran.some(entry => pyEquals(entry, name));
      if (typeof ran === 'string') return ran.includes(name);
      throw new TypeError(`argument of type '${typeof ran}' is not iterable`);
    });
    t.set(`run:${name}:soundsPlayed`, BigInt(played.length));
    t.set(`run:${name}:plays`, pySum(played.map(row => pyItem(pyItem(pyItem(row, 'runs'), name), 'plays'))));
  }
  return t;
}

export interface RecordOptions {
  game: string, probe: string, gamesrc: string, audition: string, run: readonly string[] | null, baseline: readonly string[] | null,
  scope: readonly string[] | null, limitation: readonly string[] | null, out: string,
}

export function cmdRecord(opts: RecordOptions) {
  const probe = readJson(opts.probe);
  const { defines, sites, invalid, queries } = staticCensus(opts.gamesrc);
  const [atTrace, atWave] = unpack(opts.audition, ':', 2);
  const aud = auditionRows(readTrace(atTrace), new Mix(atWave));
  const runs = new Map<string, Map<bigint, Dict>>(), runMeta = new Map<string, PyValue>();
  for (const spec of opts.run ?? []) {
    const [name, trace, wav] = unpack(spec, ':', 3);
    const [per, meta] = runSummary(readTrace(trace), wav ? new Mix(wav) : null);
    runs.set(name, per);
    runMeta.set(name, meta);
  }
  const baselines = new Map<string, PyValue>();
  for (const spec of opts.baseline ?? []) {
    const [name, wav] = unpack(spec, ':', 2);
    baselines.set(name, new Mix(wav).overall());
  }
  const rows: Dict[] = list(pyItem(probe, 'bank')).map(bank => {
    // Mobile banks convert one asset per record in bank order (converter.py).
    const sid = pyItem(bank, 'index');
    const define = typeof sid === 'bigint' ? defines.get(sid) ?? null : null;
    const resource = pyGet(bank, 'resource');
    const row = new Map<string, PyValue>([
      ['assetId', sid], ['define', define], ['bankIndex', pyItem(bank, 'index')], ['handle', pyItem(bank, 'handle')], ['name', pyItem(bank, 'name')],
      ['named', pyItem(bank, 'named')], ['flags', pyItem(bank, 'flags')], ['rate', pyItem(bank, 'rate')],
      ['resource', pyTruthy(resource) ? list(resource)[0] ?? null : null], ['format', pyGet(bank, 'format')], ['bytes', pyGet(bank, 'bytes')],
      ['events', define === null ? [] : sites.get(define) ?? []], ['sampleQueries', define === null ? [] : queries.get(define) ?? []],
      ['audition', (typeof sid === 'bigint' ? aud.get(sid) : undefined) ?? 'UNKNOWN'],
    ]);
    const ran = new Map<string, PyValue>();
    for (const [name, per] of runs) {
      const entry = typeof sid === 'bigint' ? per.get(sid) : undefined;
      if (entry !== undefined) ran.set(name, entry);
    }
    row.set('runs', ran);
    return row;
  });
  const optional = (key: string, fallback: PyValue) => (pyIsDict(probe) && probe.has(key) ? pyItem(probe, key) : fallback);
  const result = new Map<string, PyValue>([
    ['schema', SCHEMA], ['game', opts.game], ['claimLevel', 'MODEL_ONLY'], ['fidelity', 'rebuilt-runtime'],
    ['question', "Does every sound the converted game declares reach the rebuilt runtime's mixer, and do the game's own events play them?"],
    ['scope', keyValues(opts.scope ?? [])],
    ['sourceHashes', new Map<string, PyValue>([['probe', fileSha256(opts.probe)], ['assetsHeader', fileSha256(join(opts.gamesrc, 'assets.h'))],
      ['audition', split(opts.audition, ':', 1).map(fileSha256)],
      ['runs', new Map((opts.run ?? []).map(spec => [split(spec, ':', 2)[0], split(spec, ':', 2).slice(1).filter(path => path).map(fileSha256)]))],
      ['baselines', new Map((opts.baseline ?? []).map(spec => [split(spec, ':', 1)[0], fileSha256(at(split(spec, ':', 1), 1))]))]])],
    ['thresholds', new Map<string, PyValue>([['peakFloor', PEAK_FLOOR], ['rmsFloor', new PyFloat(RMS_FLOOR)], ['auditionTailS', new PyFloat(TAIL_S)],
      ['playWindowS', new PyFloat(PLAY_WINDOW_S)], ['units', '16-bit sample values']])],
    ['probe', new Map<string, PyValue>([['build', pyItem(probe, 'build')], ['handleCount', pyItem(probe, 'handleCount')], ['records', pyItem(probe, 'records')],
      ['sampleParameters', pyLen(pyItem(probe, 'uses'))], ['rawFiles', pyGet(probe, 'rawFiles')], ['rawWithoutRecord', optional('rawWithoutRecord', [])],
      ['frameErrors', pyLen(optional('frameErrors', []))]])],
    ['static', new Map<string, PyValue>([['invalidPlaySites', invalid], ['definedSounds', BigInt(defines.size)]])],
    ['runs', runMeta], ['baselines', baselines], ['rows', rows],
  ]);
  result.set('answer', totals(rows, [...runs.keys()]));
  result.set('limitations', [...(opts.limitation ?? [])]);
  const id = evidenceId(result);
  result.set('evidenceId', id);
  writeFileSync(opts.out, `${pyDumps(result, 1, { ensureAscii: false })}\n`);
  console.log(`${id}: ${pyDumps(result.get('answer') ?? null, undefined, { sortKeys: true })}`);
}

/** Re-derive a record's totals, its rows' thresholds and its evidenceId; an AssertionError where they disagree. */
export function check(path: string): Dict {
  const loaded = readJson(path);
  const schema = pyGet(loaded, 'schema');
  if (!pyEquals(schema, SCHEMA)) throw new AssertionError(`${path}: schema ${pyStr(schema)}`);
  const result: Dict = pyIsDict(loaded) ? new Map(loaded) : new Map();
  const runsValue = result.get('runs') ?? new Map<string, PyValue>();
  const runs = pyIsDict(runsValue) ? [...runsValue.keys()] : [];
  if (!pyEquals(totals(list(pyItem(result, 'rows')), runs), pyItem(result, 'answer'))) throw new AssertionError(`${path}: answer is not the rows'`);
  const thresholds = pyItem(result, 'thresholds');
  for (const row of list(pyItem(result, 'rows'))) {
    const audition = pyItem(row, 'audition');
    if (pyIsDict(audition) && pyGet(audition, 'rms') !== null) {
      const atLeast = (a: PyValue, b: PyValue) => (pyCompareNumbers(a, b) ?? -1) >= 0;
      const ns = atLeast(pyItem(audition, 'peak'), pyItem(thresholds, 'peakFloor')) && atLeast(pyItem(audition, 'rms'), pyItem(thresholds, 'rmsFloor'));
      if (!pyEquals(ns, pyItem(audition, 'nonSilent'))) throw new AssertionError(`${path}: sound ${pyStr(pyItem(row, 'assetId'))} nonSilent is not its thresholds'`);
    }
  }
  const id = evidenceId(result);
  if (!pyEquals(id, pyItem(result, 'evidenceId'))) throw new AssertionError(`${path}: evidenceId ${pyStr(pyItem(result, 'evidenceId'))} is not ${id}`);
  return result;
}

function main(argv: readonly string[]): number {
  const parsed = pySubcommands(argv, 'audio-report.ts', 'cmd', {
    record: { options: [{ name: '--game', required: true }, { name: '--probe', required: true }, { name: '--gamesrc', required: true },
      { name: '--audition', required: true }, { name: '--run', append: true }, { name: '--baseline', append: true }, { name: '--scope', append: true },
      { name: '--limitation', append: true }, { name: '--out', required: true }] },
    check: { options: [], positionals: [{ name: 'records', rest: true, required: true }] },
  });
  if ('exit' in parsed) {
    (parsed.exit ? console.error : console.log)(parsed.text);
    return parsed.exit;
  }
  if (parsed.command === 'record') {
    const text = (name: string) => pyOptionText(parsed.args, name) ?? '';
    const many = (name: string) => pyOptionList(parsed.args, name);
    cmdRecord({ game: text('--game'), probe: text('--probe'), gamesrc: text('--gamesrc'), audition: text('--audition'), run: many('--run'),
      baseline: many('--baseline'), scope: many('--scope'), limitation: many('--limitation'), out: text('--out') });
    return 0;
  }
  for (const path of parsed.args.positionals) {
    const result = check(path);
    const answer = pyItem(result, 'answer');
    console.log(`${pyStr(pyItem(result, 'evidenceId'))}: ${path} rechecked (${pyStr(pyItem(answer, 'declared'))} sounds, `
      + `${pyStr(pyItem(answer, 'auditionNonSilent'))} audition non-silent)`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
