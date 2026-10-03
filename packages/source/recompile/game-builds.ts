#!/usr/bin/env node
// Per-game build record for the rebuilt Clickteam games (recompile-game-builds-v1).
//
// One row per game, derived from the files each step left outside the repository: the converter's log and generated
// sources, the pinned host binary and assets, a bounded no-input harness boot (its trace, audio trace and log), the
// Android libmain.so and APK, and the game's committed recompile-audio-v1 record. Every value is a count, a name, a
// hash or a status; no game content is copied.
//
//   game-builds.ts record --out RESULT.json --game fnaf1 --ccn FILE --gamesrc DIR --convert-log FILE \
//       [--binary FILE --assets FILE --pinned DIR] [--boot DIR] [--libmain FILE --apk FILE --package NAME] \
//       [--audio RECORD] [--blocker TEXT]         (adds or replaces the game's row)
//   game-builds.ts check RESULT.json ...        re-derive statuses and the evidenceId, and resolve each row's audio
//                                                record in tools/recompile/results
//
// A boot dir holds the harness run: trace (CHOWDREN_TRACE), audio-trace, run.log (the container's output, ending
// "exit N") and env.
//
// Ported from game-builds.py: it writes the same record, byte for byte, and prints and exits as that did.
import { createHash } from 'node:crypto';
import { existsSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PyAssertionError as AssertionError, type PyValue, pyCompare, pyDumps, pyEquals, pyGet, pyIntValue as int, pyIsDict, pyIsList, pyItem, pyOptionText,
  pyRegExp, pyReprOf, pySplit, pySplitLimit as split, pyStr, pyStrip, pySubcommands, pySum,
} from '@sixam/kernel/py';
import { fileSha256, globNames, readJson, readLines, readText } from './record-io.ts';

export const SCHEMA = 'recompile-game-builds-v1';
const RESULTS = fileURLToPath(new URL('../../../tools/recompile/results', import.meta.url));  // frozen in place
const STEPS = ['conversion', 'host', 'boot', 'apk'];

type Dict = Map<string, PyValue>;

const FRAME_FILE = pyRegExp(String.raw`frame(\d+)_1\.cpp$`);
const FRAME_NAME = pyRegExp(String.raw`name = std::string\("((?:[^"\\]|\\.)*)"`);

function frameNames(gamesrc: string): Map<bigint, string> {
  const names = new Map<bigint, string>();
  for (const path of globNames(gamesrc, 'frame', '_1.cpp')) {
    const m = FRAME_FILE.exec(path);
    const n = FRAME_NAME.exec(readText(path, 'replace'));
    if (m && n) names.set(int(m[1]) - 1n, n[1]);
  }
  return names;
}

/** len(re.findall(pattern, text)), with re.M's ^ (a line start) where asked. */
const count = (text: string, pattern: string, multiline = false) => {
  const source = multiline ? pattern.replaceAll('^', '(?<=^|\\n)') : pattern;
  return BigInt([...text.matchAll(pyRegExp(source, 'g'))].length);
};

interface Options {
  out: string, game: string, ccn: string, gamesrc: string, convertLog: string, binary: string | null, assets: string | null, pinned: string | null,
  boot: string | null, libmain: string | null, apk: string | null, package: string | null, audio: string | null, blocker: string | null,
}

function conversion(opts: Options): Dict {
  const log = readText(opts.convertLog, 'replace');
  const exit = /(?<=^|\n)convert exit (\p{Nd}+)/u.exec(log);
  const code = exit ? int(exit[1]) : null;
  const events = globNames(opts.gamesrc, 'events_', '.cpp');
  let invalid = 0n, resolved = 0n;
  for (const path of events) {
    const text = readText(path, 'replace');
    invalid += count(text, String.raw`media\.play_id\(INVALID_ASSET_ID`);
    resolved += count(text, String.raw`media\.play_id\(SOUND_`);
  }
  return new Map<string, PyValue>([
    ['status', code === 0n && existsSync(join(opts.gamesrc, 'CMakeLists.txt')) ? 'OK' : 'FAILED'], ['exitCode', code], ['ccnSha256', fileSha256(opts.ccn)],
    ['frames', BigInt(frameNames(opts.gamesrc).size)], ['eventFiles', BigInt(events.length)],
    ['truncatedFramesSkipped', count(log, '^skipping truncated frame', true)], ['omittedActions', count(log, '^action omitted', true)],
    ['mp3Decoded', count(log, 'MP3 decoded to WAV')], ['silencedSounds', count(log, 'missing -> silence')],
    ['playSites', new Map<string, PyValue>([['resolved', resolved], ['invalid', invalid]])],
  ]);
}

const SEEDED = pyRegExp(String.raw`^# frame (-?\d+) seeded`);
const TITLED = pyRegExp('title|menu', 'i');
const CRASH = /Segmentation fault|core dumped|Aborted/u;
const KEPT_OUT = ['CHOWDREN_INPUT', 'CHOWDREN_TRACE', 'CHOWDREN_AUDIO_TRACE', 'CHOWDREN_SNAP_DIR'];

function boot(names: ReadonlyMap<bigint, string>, directory: string): Dict {
  const log = readText(join(directory, 'run.log'), 'replace');
  const exits = [...log.matchAll(/(?<=^|\n)exit (\p{Nd}+)/gu)];
  const code = exits.length ? int(exits[exits.length - 1][1]) : null;
  const visits: { frame: bigint, name: string, updates: bigint }[] = [];
  let rows = 0n, stop: string | null = null;
  let last: (typeof visits)[number] | null = null;
  for (const line of readLines(join(directory, 'trace'), 'replace')) {
    const seeded = SEEDED.exec(line);
    if (seeded) {
      const index = int(seeded[1]);
      last = { frame: index, name: names.get(index) ?? 'UNKNOWN', updates: 0n };
      visits.push(last);
    } else if (line.startsWith('# stop')) stop = pyStrip(line.slice(2));
    else if (!line.startsWith('#') && pyStrip(line)) {
      rows += 1n;
      if (last !== null) last.updates += 1n;
    }
  }
  let plays = 0n;
  const audioTrace = join(directory, 'audio-trace');
  if (existsSync(audioTrace)) {
    for (const line of readLines(audioTrace)) if (!line.startsWith('#') && pySplit(line)[3] === 'play') plays += 1n;
  }
  const env = new Map<string, PyValue>();
  for (const line of readLines(join(directory, 'env'))) {
    if (!line.includes('=')) continue;
    const [key, value] = split(line.replace(/\n$/, ''), '=', 1);
    if (key.startsWith('CHOWDREN_') && !KEPT_OUT.includes(key)) env.set(key, value);
  }
  const titled = visits.filter(visit => TITLED.test(visit.name));
  const crashed = (code !== 0n && code !== null) || CRASH.test(log);
  return new Map<string, PyValue>([
    ['status', crashed ? 'CRASH' : stop ? 'OK' : 'NO_STOP_LINE'], ['exitCode', code], ['env', env], ['updates', rows], ['stop', stop],
    ['visits', visits.map(visit => new Map<string, PyValue>([['frame', visit.frame], ['name', visit.name], ['updates', visit.updates]]))],
    ['reachedTitle', names.size ? (titled.some(visit => visit.updates > 0n) ? 'YES' : 'NO') : 'UNKNOWN'],
    ['audioInitialized', log.includes('Audio initialized')],
    ['glErrors', count(log, '^Mesa: User error|^OpenGL error', true)],
    ['samplePlays', plays],
  ]);
}

function apk(opts: Options, path: string): Dict {
  const out = new Map<string, PyValue>([['status', 'OK'], ['file', basename(path)], ['sha256', fileSha256(path)], ['bytes', BigInt(statSync(path).size)],
    ['package', opts.package]]);
  if (opts.libmain) {
    out.set('libmainSha256', fileSha256(opts.libmain));
    out.set('libmainBytes', BigInt(statSync(opts.libmain).size));
  }
  return out;
}

/** The record's id: the sha256 of its sorted compact JSON without the id. */
function evidenceId(result: ReadonlyMap<string, PyValue>): string {
  const text = pyDumps(new Map([...result].filter(([key]) => key !== 'evidenceId')), undefined, { separators: [',', ':'], ensureAscii: false, sortKeys: true });
  return `recompile-game-builds-${createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)}`;
}

function firstBlocker(row: PyValue): string | null {
  for (const step of STEPS) {
    const status = pyGet(row, step);
    if (!pyIsDict(status) || !pyEquals(pyGet(status, 'status'), 'OK')) return step;
  }
  return null;
}

export function cmdRecord(opts: Options) {
  const loaded = existsSync(opts.out) ? readJson(opts.out) : null;
  if (loaded !== null && !pyIsDict(loaded)) throw new TypeError(`${pyReprOf(loaded)} is not a record`);
  const result: Dict = loaded !== null && pyIsDict(loaded) ? new Map(loaded) : new Map<string, PyValue>([
    ['schema', SCHEMA], ['claimLevel', 'MODEL_ONLY'], ['fidelity', 'rebuilt-runtime'],
    ['question', 'Does each build-296 game convert, build for the host, boot under the harness without input, and package as an Android APK, '
      + 'with its sounds reaching the mixer?'],
    ['rows', []]]);
  const isDirectory = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
  const names = isDirectory(opts.gamesrc) ? frameNames(opts.gamesrc) : new Map<bigint, string>();
  const row = new Map<string, PyValue>([['game', opts.game], ['conversion', conversion(opts)]]);
  row.set('host', opts.binary ? new Map<string, PyValue>([['status', 'OK'], ['binarySha256', fileSha256(opts.binary)],
    ['assetsSha256', fileSha256(opts.assets ?? '')], ['pinned', opts.pinned ? basename(normalize(opts.pinned)) : null]]) : new Map([['status', 'NOT_BUILT']]));
  row.set('boot', opts.boot ? boot(names, opts.boot) : new Map([['status', 'NOT_RUN']]));
  row.set('apk', opts.apk ? apk(opts, opts.apk) : new Map([['status', 'NOT_BUILT']]));
  if (opts.audio) {
    const audio = readJson(opts.audio);
    const answer = pyItem(audio, 'answer');
    row.set('audio', new Map<string, PyValue>([['evidenceId', pyItem(audio, 'evidenceId')], ['record', basename(opts.audio)],
      ['declared', pyItem(answer, 'declared')], ['resolvedFiles', pyItem(answer, 'resolvedFiles')], ['auditionNonSilent', pyItem(answer, 'auditionNonSilent')]]));
  } else row.set('audio', 'UNKNOWN');
  row.set('firstFailedStep', firstBlocker(row));
  row.set('blocker', opts.blocker);
  const rows = pyItem(result, 'rows');
  const kept = (pyIsList(rows) ? rows : []).filter(other => !pyEquals(pyItem(other, 'game'), opts.game));
  result.set('rows', [...kept, row].sort((a, b) => pyCompare(pyStr(pyItem(a, 'game')), pyStr(pyItem(b, 'game')))));
  const id = evidenceId(result);
  result.set('evidenceId', id);
  writeFileSync(opts.out, `${pyDumps(result, 1, { sortKeys: true })}\n`);
  console.log(`${id}: ${opts.game} ${STEPS.map(step => `${step} ${pyStr(pyItem(pyItem(row, step), 'status'))}`).join(', ')}`);
}

const SHA256 = pyRegExp('^[0-9a-f]{64}$');

/** Re-derive a record's first failed steps, boot sums, APK hashes, audio links and evidenceId. */
export function check(path: string, resultsDir: string = RESULTS): Dict {
  const loaded = readJson(path);
  const schema = pyGet(loaded, 'schema');
  if (!pyEquals(schema, SCHEMA)) throw new AssertionError(`${path}: schema ${pyReprOf(schema)}`);
  const result: Dict = pyIsDict(loaded) ? new Map(loaded) : new Map();
  const rows = pyItem(result, 'rows');
  for (const row of pyIsList(rows) ? rows : []) {
    const game = pyStr(pyItem(row, 'game'));
    const failed = pyItem(row, 'firstFailedStep');
    if (!pyEquals(firstBlocker(row), failed)) {
      throw new AssertionError(`${path}: ${game} firstFailedStep ${pyReprOf(failed)} is not ${pyReprOf(firstBlocker(row))}`);
    }
    const ran = pyItem(row, 'boot');
    if (['OK', 'CRASH', 'NO_STOP_LINE'].some(status => pyEquals(pyGet(ran, 'status'), status))) {
      const visits = pyItem(ran, 'visits');
      if (!pyEquals(pySum((pyIsList(visits) ? visits : []).map(visit => pyItem(visit, 'updates'))), pyItem(ran, 'updates'))) {
        throw new AssertionError(`${path}: ${game} boot visits do not sum to its updates`);
      }
    }
    const built = pyItem(row, 'apk');
    if (pyEquals(pyGet(built, 'status'), 'OK') && !SHA256.test(pyStr(pyItem(built, 'sha256')))) throw new AssertionError(`${path}: ${game} apk sha256 malformed`);
    const audio = pyItem(row, 'audio');
    if (pyIsDict(audio)) {
      const record = join(resultsDir, pyStr(pyItem(audio, 'record')));
      if (!existsSync(record)) throw new AssertionError(`${path}: ${game} audio record ${pyStr(pyItem(audio, 'record'))} is not committed`);
      if (!pyEquals(pyItem(readJson(record), 'evidenceId'), pyItem(audio, 'evidenceId'))) {
        throw new AssertionError(`${path}: ${game} audio evidenceId differs from ${record}`);
      }
    }
  }
  const id = evidenceId(result);
  if (!pyEquals(id, pyItem(result, 'evidenceId'))) throw new AssertionError(`${path}: evidenceId ${pyStr(pyItem(result, 'evidenceId'))} is not ${id}`);
  return result;
}

function main(argv: readonly string[]): number {
  const required = ['out', 'game', 'ccn', 'gamesrc', 'convert-log'].map(name => ({ name: `--${name}`, required: true }));
  const optional = ['binary', 'assets', 'pinned', 'boot', 'libmain', 'apk', 'package', 'audio', 'blocker'].map(name => ({ name: `--${name}` }));
  const parsed = pySubcommands(argv, 'game-builds.ts', 'cmd', {
    record: { options: [...required, ...optional] },
    check: { options: [], positionals: [{ name: 'records', rest: true, required: true }] },
  });
  if ('exit' in parsed) {
    (parsed.exit ? console.error : console.log)(parsed.text);
    return parsed.exit;
  }
  const value = (name: string) => pyOptionText(parsed.args, name);
  if (parsed.command === 'record') {
    cmdRecord({ out: value('--out') ?? '', game: value('--game') ?? '', ccn: value('--ccn') ?? '', gamesrc: value('--gamesrc') ?? '',
      convertLog: value('--convert-log') ?? '', binary: value('--binary'), assets: value('--assets'), pinned: value('--pinned'), boot: value('--boot'),
      libmain: value('--libmain'), apk: value('--apk'), package: value('--package'), audio: value('--audio'), blocker: value('--blocker') });
    return 0;
  }
  for (const path of parsed.args.positionals) {
    const result = check(path);
    const rows = pyItem(result, 'rows');
    console.log(`${pyStr(pyItem(result, 'evidenceId'))}: ${path} rechecked (${(pyIsList(rows) ? rows : []).map(row => {
      const failed = pyItem(row, 'firstFailedStep');
      return `${pyStr(pyItem(row, 'game'))}: ${failed === null || failed === '' ? 'all steps OK' : pyStr(failed)}`;
    }).join(', ')})`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
