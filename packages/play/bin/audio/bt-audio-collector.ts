#!/usr/bin/env node
// Retain one BlueALSA PCM stream with receipt-time bounds.
//
// `bluealsa-cli open` writes raw PCM without timestamps. The former shell recorder stamped its wall interval
// before the process had opened the PCM and after its termination wait, so setup and teardown looked like lost
// Bluetooth samples. This helper owns the child process and records the first and final received PCM blocks. It
// also catches an interactive SIGINT/SIGTERM, terminates the child in a private session, and writes a terminal
// state file before exit.
//
// Receipt timing is not a cue clock: callers still need continuous known content before they may treat its
// duration comparison as transport acceptance.
//
// Ported from bt-audio-collector.py: it writes the same state and raw bytes, and exits as that did.
import { type ChildProcess, spawn } from 'node:child_process';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { constants } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PyFloat, type PyJson, type PyOption, pyArgs, pyArgsError, pyDumps, pyFixed, pyInt, pyPath, pyStrRepr } from '@sixam/kernel/py';

const PROG = 'bt-audio-collector.ts';
const FORMATS = ['S16_LE', 'S24_LE', 'S24_3LE', 'S32_LE'];
const OPTIONS: readonly PyOption[] = [
  { name: '--pcm', required: true }, { name: '--raw', required: true }, { name: '--state', required: true }, { name: '--stderr', required: true },
  { name: '--format', required: true, choices: FORMATS }, { name: '--rate', required: true, type: 'int' },
  { name: '--channels', required: true, type: 'int' }, { name: '--bluealsa-cli' },
];

const wallMs = () => Date.now();
// time.monotonic_ns(): the same OS clock libuv's hrtime reads (mach_absolute_time, CLOCK_MONOTONIC).
const monoMs = () => Number(process.hrtime.bigint() / 1_000_000n);
const round3 = (x: number) => Number(pyFixed(x, 3));

type State = Map<string, PyJson>;

/** Atomically publish a state readers may inspect while this process runs. */
function writeJson(path: string, value: State) {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  const fd = openSync(temporary, 'w');
  try {
    writeSync(fd, `${pyDumps(value, 2, { sortKeys: true })}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

/** An OSError's class and text as Python wrote them for a program that could not start (these numbers are the
 *  same on Linux and macOS). */
function osErrorText(error: NodeJS.ErrnoException, file: string) {
  const known = new Map<string, [string, number, string]>([
    ['ENOENT', ['FileNotFoundError', 2, 'No such file or directory']], ['EACCES', ['PermissionError', 13, 'Permission denied']],
    ['EPERM', ['PermissionError', 1, 'Operation not permitted']], ['ENOTDIR', ['NotADirectoryError', 20, 'Not a directory']],
    ['ENOEXEC', ['OSError', 8, 'Exec format error']],
  ]);
  const python = known.get(error.code ?? '');
  return python ? `${python[0]}: [Errno ${python[1]}] ${python[2]}: ${pyStrRepr(file)}` : `OSError: ${error.message}`;
}

function parse(argv: readonly string[]) {
  const args = pyArgs(argv, PROG, OPTIONS);
  if ('exit' in args) return args;
  const text = (name: string) => { const value = args.options[name]; return typeof value === 'string' ? value : ''; };
  const refuse = (message: string) => pyArgsError(PROG, OPTIONS, [], message);
  const pcm = text('--pcm');
  if (!pcm.startsWith('/org/bluealsa/')) return refuse('--pcm must name a BlueALSA object path');
  const rate = pyInt(text('--rate')) ?? 0n, channels = pyInt(text('--channels')) ?? 0n;   // checked by pyArgs
  if (!(rate >= 1n && rate <= 384_000n && channels >= 1n && channels <= 8n)) return refuse('--rate/--channels are out of bounds');
  const paths: string[] = [];
  for (const name of ['--raw', '--state', '--stderr']) {
    const path = pyPath(text(name));
    if (!isAbsolute(path)) return refuse(`${path} must be an absolute path`);
    mkdirSync(dirname(path), { recursive: true });
    paths.push(path);
  }
  const [raw, state, stderr] = paths;
  return { pcm, raw, state, stderr, format: text('--format'), rate: Number(rate), channels: Number(channels),
    cli: typeof args.options['--bluealsa-cli'] === 'string' ? args.options['--bluealsa-cli'] : 'bluealsa-cli' };
}

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

async function main(argv: readonly string[]): Promise<number> {
  const args = parse(argv);
  if ('exit' in args) {
    (args.exit ? console.error : console.log)(args.text);
    return args.exit;
  }
  const width = ['S24_LE', 'S24_3LE', 'S32_LE'].includes(args.format) ? 4 : 2;
  const bytesPerSecond = args.rate * args.channels * width;
  const state: State = new Map<string, PyJson>([
    ['schema', 'bt-audio-stream-v1'], ['status', 'STARTING'], ['collectorPid', process.pid], ['pcm', args.pcm], ['format', args.format],
    ['rate', args.rate], ['channels', args.channels], ['bytesPerSecond', bytesPerSecond], ['startedWallMs', wallMs()],
    ['startedMonotonicMs', monoMs()], ['firstPcmWallMs', null], ['firstPcmMonotonicMs', null], ['firstChunkBytes', 0],
    ['lastPcmWallMs', null], ['lastPcmMonotonicMs', null], ['lastChunkBytes', 0], ['rawBytes', 0], ['chunks', 0], ['maxInterChunkGapMs', 0],
  ]);
  writeJson(args.state, state);

  let requestedSignal: string | null = null;
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(name, () => { requestedSignal ??= name; });

  let child: ChildProcess | null = null;
  const stderrFd = openSync(args.stderr, 'w');
  const rawFd = openSync(args.raw, 'w');
  let terminateSentAt: number | null = null;
  let previousChunkMono: number | null = null;
  let previousChunkAudioMs: number | null = null;
  // Keep one receipt timestamp within roughly 20 ms of the source clock. A 64 KiB read can contain hundreds of
  // milliseconds of already-buffered PCM, making a healthy stream look like one large reception gap.
  const readSize = Math.max(1_024, Math.min(8_192, Math.floor(bytesPerSecond / 50)));
  let firstChunkBytes = 0, rawBytes = 0, chunks = 0, maxGap = 0;
  let firstMono: number | null = null, lastMono: number | null = null, maxExcess: number | null = null;

  const consume = (block: Buffer) => {
    const arrivedWall = wallMs(), arrivedMono = monoMs();
    if (firstMono === null) {
      firstMono = arrivedMono;
      firstChunkBytes = block.length;
      state.set('firstPcmWallMs', arrivedWall).set('firstPcmMonotonicMs', arrivedMono).set('firstChunkBytes', block.length);
    }
    if (previousChunkMono !== null) {
      maxGap = Math.max(maxGap, arrivedMono - previousChunkMono);
      state.set('maxInterChunkGapMs', maxGap);
      // This is diagnostic provenance, not an acceptance threshold: the capture's duration comparison remains
      // the continuity gate.
      const excess = Math.max(0.0, arrivedMono - previousChunkMono - (previousChunkAudioMs ?? 0.0));
      maxExcess = Math.max(maxExcess ?? 0.0, round3(excess));
      state.set('maxInterChunkExcessMs', new PyFloat(maxExcess));
    }
    previousChunkMono = arrivedMono;
    previousChunkAudioMs = 1000.0 * block.length / bytesPerSecond;
    writeSync(rawFd, block);
    rawBytes += block.length;
    chunks += 1;
    lastMono = arrivedMono;
    state.set('rawBytes', rawBytes).set('chunks', chunks).set('lastPcmWallMs', arrivedWall).set('lastPcmMonotonicMs', arrivedMono)
      .set('lastChunkBytes', block.length);
  };

  let exitCode = 3;
  try {
    // Ctrl-C applies to the collector; it then stops this child and retains the terminal byte bound instead of
    // abandoning the run.
    const started = spawn(args.cli, ['open', args.pcm], { stdio: ['ignore', 'pipe', stderrFd], detached: true });
    child = started;
    await new Promise((ready, refused) => {
      started.once('spawn', ready);
      started.once('error', (error: NodeJS.ErrnoException) => refused(new Error(osErrorText(error, args.cli))));
    });
    let returnCode: number | null = null;   // child.poll(): set once it has exited
    const exited = new Promise<void>(done => started.once('exit', (code, signal) => {
      returnCode = code ?? -(signal ? constants.signals[signal] : 0);
      done();
    }));
    state.set('status', 'RUNNING').set('sourcePid', started.pid ?? null);
    writeJson(args.state, state);
    const stdout = started.stdout;
    if (stdout === null) throw new Error('the source has no stdout pipe');
    let streamClosed = false, readSinceTick = false;
    const onData = (chunk: Buffer) => {
      readSinceTick = true;
      for (let at = 0; at < chunk.length; at += readSize) consume(chunk.subarray(at, at + readSize));
    };
    stdout.on('data', onData);
    stdout.once('end', () => { streamClosed = true; });
    while (!streamClosed) {
      const now = monoMs();
      if (requestedSignal && terminateSentAt === null) {
        terminateSentAt = now;
        if (returnCode === null) started.kill('SIGTERM');
      }
      if (terminateSentAt !== null && returnCode === null && now - terminateSentAt > 1500) started.kill('SIGKILL');
      readSinceTick = false;
      await sleep(50);   // selector.select(timeout=0.05)
      // An exited source with nothing to read ends the stream, as Python's one non-blocking read after poll() did.
      if (returnCode !== null && !readSinceTick) streamClosed = true;
    }
    stdout.off('data', onData);
    stdout.destroy();
    if (returnCode === null) {
      const timeout = new Promise<'timeout'>(done => setTimeout(() => done('timeout'), 2000).unref());
      if (await Promise.race([exited, timeout]) === 'timeout')
        throw new Error(`TimeoutExpired: Command '[${[args.cli, 'open', args.pcm].map(pyStrRepr).join(', ')}]' timed out after 2 seconds`);
    }
    state.set('sourceReturnCode', returnCode);
    let status = 'NO_PCM';
    if (firstMono !== null && lastMono !== null && rawBytes !== 0) {
      // Receipt timestamps are taken after each read. The first one therefore marks the end of its first PCM
      // block, while the last one marks the end of its final block. Put only the first block back onto the left
      // edge; adding the final block would double it and makes unequal read sizes report false loss.
      state.set('sampleSpanMs', new PyFloat(round3((lastMono - firstMono) + 1000.0 * firstChunkBytes / bytesPerSecond)));
      status = requestedSignal ? 'STOPPED' : 'ENDED';
    }
    state.set('status', status);
    state.set('requestedSignal', requestedSignal).set('stoppedWallMs', wallMs()).set('stoppedMonotonicMs', monoMs());
    exitCode = status === 'NO_PCM' ? 3 : 0;
  } catch (error) {
    state.set('status', 'FAILED').set('error', error instanceof Error ? error.message : String(error)).set('requestedSignal', requestedSignal)
      .set('stoppedWallMs', wallMs()).set('stoppedMonotonicMs', monoMs());
    if (child !== null && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  } finally {
    try {
      closeSync(rawFd);
      closeSync(stderrFd);
    } finally {
      writeJson(args.state, state);
    }
  }
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv.slice(2)));
