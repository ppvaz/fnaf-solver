#!/usr/bin/env node
// The office frame's RNG seed bracket, from the game's own log.
//
//   node packages/review/bin/grade/office-seed-bracket.ts LOGCAT [--onset-ms MS] [--clock-pinned] [--legacy-pair] [--json OUT]
//
// LOGCAT is `adb logcat -v epoch -s MMFRuntime:V` captured live around a run (the phone's 256 KiB log ring
// rolls over in about a minute, so it must be streamed, not read back). The Fusion runtime seeds its one
// 16-bit LCG with the low 16 bits of currentTimeMillis in CRun.allocRunHeader, the first call of
// initRunLoop, which runs between the office frame's "Starting new frame" line and the "startTheFrame()
// called" line that follows it (docs/evidence/night7-k3-seedlog-nights-20260915.json). The bracket is that
// pair, and every whole millisecond in it is a candidate seed.
//
// The pair is found by LINE ORDER, never by timestamp: a "startTheFrame() called" line precedes "Starting
// new frame" in the same millisecond on every load, and picking it by time collapses the bracket to one
// wrong candidate (2026-09-15, full-06). The office is Fusion frame 4 here ("loading frame #:4").
//
// Read from the bytecode on 2026-09-16, the bracket is much tighter than that pair, and this is now the
// default. CRunApp.startTheFrame logs "Starting new frame" at instruction 42, calls
// MMFRuntime.updateViewport (which logs the viewport block, last line "Setting renderer limits...") at 113,
// and only calls CRun.initRunLoop at 231. allocRunHeader -- the one currentTimeMillis that becomes
// rh3Graine -- is instruction 0 of initRunLoop, ahead of initAsmLoop, y_InitLevel, prepareFrame and
// createFrameObjects (29, whose object creation reaches CExtLoad.loadRunObject and logs "Created
// extension: ") and ahead of f_InitLoop (57, which logs "iPhoneOptions are "). So the seed is taken
// strictly between the last line logged before initRunLoop and the first line logged inside it, which on
// the moto g56 is one or two milliseconds rather than the sixteen the startTheFrame pair gives. Pass
// --legacy-pair for the old, wider bracket.
//
// Prints one JSON object: fromMs, toMs, candidates, low16 [first, last], and with --onset-ms the bracket's
// distance before the helper's night onset (beforeOnsetMs [min, max]); exits 1 with a reason when the
// office load or its pair is not in the log.
//
// This interval requires a monotonic wall clock through the seed read. A visible backwards step is
// refused. With --clock-pinned, even increasing endpoints are UNKNOWN: a set-time loop can reset between
// log calls without exposing that reset in their timestamps. Neither one nor two endpoint candidates
// proves a pinned seed. The diagnostic JSON retains no candidate seed.
//
// Ported from office-seed-bracket.py; it prints and writes what that did.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PyFloat, pyDumps, pyFixed } from '@sixam/kernel';

const OFFICE_LOAD = 'loading frame #:4';
const START = 'Starting new frame';
const CALLED = 'startTheFrame() called';
// logged before initRunLoop is entered (CRunApp.startTheFrame 42 and 113)
const PRE = ['Starting new frame', 'updating viewport', 'Updating window dimensions', 'uV: initialUpdateDone', 'Setting renderer limits'];
// logged inside initRunLoop, after allocRunHeader took the seed (29 -> loadRunObject, 57 -> f_InitLoop)
const POST = ['Created extension:', 'iPhoneOptions are'];

// Python's whitespace (str.split, str.strip): JavaScript's \s adds U+FEFF and lacks 0x1c-0x1f and NEL.
const WS = '[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
const DIGITS = '\\d(?:_?\\d)*';
// Python's float(): a decimal (underscores between digits), inf or nan, signed, with surrounding whitespace.
const PY_FLOAT = new RegExp(`^${WS}*([+-]?(?:(?:${DIGITS}(?:\\.(?:${DIGITS})?)?|\\.${DIGITS})(?:[eE][+-]?${DIGITS})?|inf(?:inity)?|nan))${WS}*$`, 'i');
function pyFloat(text: string): number {
  const body = PY_FLOAT.exec(text)?.[1].toLowerCase().replace(/^\+/, '').replaceAll('_', '');
  if (body === undefined) throw new Error(`could not convert string to float: '${text}'`);
  if (body.includes('inf')) return body.startsWith('-') ? -Infinity : Infinity;
  return body.includes('nan') ? NaN : Number(body);
}

// Python's round(x): the nearest integer, an exact tie to the even one.
function pyRound(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`cannot convert float ${x} to integer`);
  const floor = Math.floor(x);
  const rest = x - floor;
  return rest > 0.5 || (rest === 0.5 && floor % 2 !== 0) ? floor + 1 : floor;
}

const FIELDS = new RegExp(`${WS}+`);
const epochMs = (line: string) => pyRound(pyFloat(line.split(FIELDS).find(field => field !== '') ?? '') * 1000);

function checkedInterval(lines: readonly string[], start: number, end: number): [number, number] | string {
  const stamps = lines.slice(start, end + 1).map(epochMs);
  if (stamps.some((after, k) => k > 0 && after < stamps[k - 1])) return 'UNKNOWN: wall clock moved backwards across the seed bracket';
  return [stamps[0], stamps[stamps.length - 1]];
}

/** [fromMs, toMs] of the office frame's seed, or a refusal string. */
export function bracket(lines: readonly string[], legacyPair = false): [number, number] | string {
  const loads = lines.flatMap((line, k) => (line.includes(OFFICE_LOAD) ? [k] : []));
  if (!loads.length) return 'no office load ("loading frame #:4") in the log';
  const from = (first: number, last: number, test: (line: string) => boolean) => {
    for (let k = first; k <= last; k += 1) if (test(lines[k])) return k;
    return null;
  };
  const start = from(loads[loads.length - 1], lines.length - 1, line => line.includes(START));
  if (start === null) return 'office load without a following "Starting new frame"';
  const called = from(start + 1, lines.length - 1, line => line.includes(CALLED));
  if (called === null) return '"Starting new frame" without a following "startTheFrame() called"';
  if (legacyPair) return checkedInterval(lines, start, called);
  const close = from(start + 1, called, line => POST.some(token => line.includes(token)));
  // nothing inside initRunLoop was logged before the next frame start: fall back to the pair
  if (close === null) return checkedInterval(lines, start, called);
  let open = start;
  for (let k = start; k < close; k += 1) if (PRE.some(token => lines[k].includes(token))) open = k;
  return checkedInterval(lines, open, close);
}

/** The log's text as Python's open(errors='ignore').read() gave it: undecodable bytes dropped. */
function readIgnoringErrors(path: string): string {
  const bytes = readFileSync(path);
  const literal = Buffer.from('\ufffd');
  // A U+FFFD the file spells out is kept; every other one marks bytes the decoder could not read.
  const parts: string[] = [];
  let at = 0;
  for (let next = bytes.indexOf(literal, at); next >= 0; next = bytes.indexOf(literal, at)) {
    parts.push(bytes.subarray(at, next).toString('utf8').replaceAll('\ufffd', ''));
    at = next + literal.length;
  }
  parts.push(bytes.subarray(at).toString('utf8').replaceAll('\ufffd', ''));
  return parts.join('\ufffd');
}

// str.splitlines(): every line boundary Python knows, and no empty line after a final one.
const splitLines = (text: string) => {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
};

const USAGE = 'usage: office-seed-bracket.ts [-h] [--onset-ms ONSET_MS] [--json JSON] [--clock-pinned] [--legacy-pair] logcat';

interface Options { logcat: string, onsetMs: number | null, json: string | null, clockPinned: boolean, legacyPair: boolean }

/** argparse's reading of the command line: an Options, or the exit code and message it gave instead. */
function parse(argv: readonly string[]): Options | { code: number, message: string } {
  const options: Options = { logcat: '', onsetMs: null, json: null, clockPinned: false, legacyPair: false };
  const positional: string[] = [];
  const error = (message: string) => ({ code: 2, message: `${USAGE}\noffice-seed-bracket.ts: error: ${message}` });
  const LONG = ['--help', '--onset-ms', '--json', '--clock-pinned', '--legacy-pair'];
  for (let k = 0; k < argv.length; k += 1) {
    if (argv[k] === '--') { positional.push(...argv.slice(k + 1)); break; }
    const equals = argv[k].startsWith('--') ? argv[k].indexOf('=') : -1;
    let [flag, inline] = equals > 0 ? [argv[k].slice(0, equals), argv[k].slice(equals + 1)] : [argv[k], undefined];
    // argparse takes any unique prefix of a long option
    if (flag.startsWith('--') && !LONG.includes(flag)) {
      const matches = LONG.filter(name => name.startsWith(flag));
      if (matches.length > 1) return error(`ambiguous option: ${flag} could match ${matches.join(', ')}`);
      if (matches.length === 1) flag = matches[0];
    }
    if (flag === '-h' || flag === '--help') return { code: 0, message: USAGE };
    if (flag === '--clock-pinned' || flag === '--legacy-pair') {
      if (inline !== undefined) return error(`argument ${flag}: ignored explicit argument '${inline}'`);
      if (flag === '--clock-pinned') options.clockPinned = true; else options.legacyPair = true;
    } else if (flag === '--onset-ms' || flag === '--json') {
      const value = inline ?? argv[k + 1];
      if (inline === undefined) k += 1;
      if (value === undefined || (inline === undefined && value.startsWith('-') && !/^-\d|^-\.\d/.test(value)))
        return error(`argument ${flag}: expected one argument`);
      if (flag === '--json') options.json = value;
      else if (!PY_FLOAT.test(value)) return error(`argument --onset-ms: invalid float value: '${value}'`);
      else options.onsetMs = pyFloat(value);
    } else if (flag.startsWith('-') && flag !== '-') return error(`unrecognized arguments: ${argv[k]}`);
    else positional.push(argv[k]);
  }
  if (!positional.length) return error('the following arguments are required: logcat');
  if (positional.length > 1) return error(`unrecognized arguments: ${positional.slice(1).join(' ')}`);
  options.logcat = positional[0];
  return options;
}

function main(argv: readonly string[]): number {
  const options = parse(argv);
  if ('code' in options) {
    (options.code ? console.error : console.log)(options.message);
    return options.code;
  }
  let lines: string[];
  try {
    lines = splitLines(readIgnoringErrors(options.logcat)).filter(line => line.includes('MMFRuntime'));
  } catch (error) {
    console.error(`cannot read ${options.logcat}: ${(error as Error).message}`);
    return 1;
  }
  const got = bracket(lines, options.legacyPair);
  if (typeof got === 'string' || options.clockPinned) {
    const reason = typeof got === 'string' ? got : 'UNKNOWN: pinned wall-clock endpoints cannot bound the seed read';
    const text = pyDumps({ schema: 'office-seed-bracket-v1', status: 'UNKNOWN', seedProvenance: options.clockPinned ? 'pinned' : 'unverified',
      candidates: null, low16: null, reason });
    console.log(text);
    console.error(reason);
    if (options.json !== null) writeFileSync(options.json, `${text}\n`);
    return 1;
  }
  const [lo, hi] = got;
  const low16 = (ms: number) => ((ms % 65536) + 65536) % 65536;
  const out: Record<string, number | string | readonly number[] | PyFloat | readonly PyFloat[]> = {
    schema: 'office-seed-bracket-v1', fromMs: lo, toMs: hi, candidates: hi - lo + 1, low16: [low16(lo), low16(hi)],
    rule: options.legacyPair ? 'startTheFrame-pair (legacy)'
      : 'last line before initRunLoop to first line inside it (allocRunHeader is initRunLoop instruction 0)',
  };
  if (options.onsetMs !== null) {
    // round(x, 1): the exact value to one decimal, a tie to even, read back as a float; nan and inf stay
    const round1 = (x: number) => new PyFloat(Number.isFinite(x) ? Number(pyFixed(x, 1)) : x);
    out.onsetPhoneWallMs = new PyFloat(options.onsetMs);
    out.beforeOnsetMs = [round1(options.onsetMs - hi), round1(options.onsetMs - lo)];
  }
  const text = pyDumps(out);
  console.log(text);
  if (options.json !== null) writeFileSync(options.json, `${text}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
