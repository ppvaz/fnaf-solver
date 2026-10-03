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
import { PyFloat, pyArgs, pyDumps, pyFixed, pyFloat, pyRound, pySplit, pySplitLines } from '@sixam/kernel';

const OFFICE_LOAD = 'loading frame #:4';
const START = 'Starting new frame';
const CALLED = 'startTheFrame() called';
// logged before initRunLoop is entered (CRunApp.startTheFrame 42 and 113)
const PRE = ['Starting new frame', 'updating viewport', 'Updating window dimensions', 'uV: initialUpdateDone', 'Setting renderer limits'];
// logged inside initRunLoop, after allocRunHeader took the seed (29 -> loadRunObject, 57 -> f_InitLoop)
const POST = ['Created extension:', 'iPhoneOptions are'];

// float(line.split()[0]) * 1000, rounded: a line without a number there stops the run, as Python's raise did.
function epochMs(line: string) {
  const field = pySplit(line)[0] ?? '';
  const seconds = pyFloat(field);
  if (seconds === null) throw new Error(`could not convert string to float: '${field}'`);
  const ms = pyRound(seconds * 1000);
  if (ms === null) throw new Error(`cannot convert float ${seconds * 1000} to integer`);
  return ms;
}

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

interface Options { logcat: string, onsetMs: number | null, json: string | null, clockPinned: boolean, legacyPair: boolean }

/** argparse's reading of the command line: an Options, or the exit code and message it gave instead. */
function parse(argv: readonly string[]): Options | { code: number, message: string } {
  const args = pyArgs(argv, 'office-seed-bracket.ts', [
    { name: '--onset-ms', type: 'float' }, { name: '--json' }, { name: '--clock-pinned', takes: 'flag' }, { name: '--legacy-pair', takes: 'flag' },
  ], [{ name: 'logcat' }]);
  if ('exit' in args) return { code: args.exit, message: args.text };
  const text = (name: string) => { const value = args.options[name]; return typeof value === 'string' ? value : null; };
  const onset = text('--onset-ms');
  return { logcat: args.positionals[0], onsetMs: onset === null ? null : pyFloat(onset), json: text('--json'),
    clockPinned: args.options['--clock-pinned'] === true, legacyPair: args.options['--legacy-pair'] === true };
}

function main(argv: readonly string[]): number {
  const options = parse(argv);
  if ('code' in options) {
    (options.code ? console.error : console.log)(options.message);
    return options.code;
  }
  let lines: string[];
  try {
    lines = pySplitLines(readIgnoringErrors(options.logcat)).filter(line => line.includes('MMFRuntime'));
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
