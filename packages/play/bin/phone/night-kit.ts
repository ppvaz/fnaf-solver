/**
 * What every night runner on the handset shares: the native-region recorder
 * and the demonstration video. Game rules stay in each game's runner.
 */
import { type WriteStream, createWriteStream, existsSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { type ChildProcess, spawn, execFileSync } from 'node:child_process';
import { finished } from 'node:stream/promises';
import { type Gzip, createGzip } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { AdbCompanionPort } from '../../src/campaign/physical-ports.ts';

/** A point on the native display. */
export interface Point { readonly x: number, readonly y: number }
/** What an Actor writes its contacts through: the HID transport a device runner composes. */
interface ContactPort {
  send(input: { command: { action: { kind: 'press' | 'hold', durationMs: number } }, point: Point }): Promise<unknown>;
}
type RegionChannel = ReturnType<AdbCompanionPort['openRegions']>;
/** One read of the registered regions, stamped on the host clock. */
export type RegionRead = Awaited<ReturnType<RegionChannel['read']>>;
/** A retained native frame. */
interface CaptureFrame { name: string, path: string, sha256: string, atWallMs: number }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** What a child process left. */
export interface RunResult { code: number | null, signal: NodeJS.Signals | null, timedOut: boolean, stdout: string, stderr: string }
type RunOptions = { input?: string | Buffer | null, timeoutMs?: number, env?: NodeJS.ProcessEnv };

/** Run a command from the repository root to its end, its output collected; past `timeoutMs` it is sent SIGTERM. */
export function runProcess(command: string, args: string[], { input = null, timeoutMs = 15000, env = {} }: RunOptions = {}) {
  return new Promise<RunResult>((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: ROOT, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env } });
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, timedOut, stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8') });
    });
    if (input === null) child.stdin.end(); else child.stdin.end(input);
  });
}
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A run's document (run.json) and its event rows (events.jsonl), host clocks named. */
export class RunRecord {
  declare outdir: string;
  declare captureDir: string;
  declare eventsPath: string;
  /** A game's runner records its own fields beside these. */
  declare document: {
    schema: string, id: string, startedAt: string, claimLevel: string, target: { package: string }, options: unknown, bindings: unknown,
    capture: { sensor: string, directory: string, frames: CaptureFrame[] }, inputsSent: number, status: string, updatedAt?: string,
    [field: string]: unknown,
  };
  constructor({ schema, pkg, id, outdir, captureDir, options, bindings, claimLevel, sensor }: { schema: string, pkg: string, id: string,
    outdir: string, captureDir: string, options: unknown, bindings: unknown, claimLevel: string, sensor: string }) {
    this.outdir = outdir; this.captureDir = captureDir;
    this.eventsPath = join(outdir, 'events.jsonl');
    this.document = {
      schema, id, startedAt: new Date().toISOString(), claimLevel,
      target: { package: pkg }, options, bindings,
      capture: { sensor, directory: captureDir, frames: [] },
      inputsSent: 0, status: 'STARTING',
    };
  }
  async event(type: string, fields: object = {}) {
    const row = { atWallMs: Date.now(), atMonotonicMs: Math.round(performance.now()), type, ...fields };
    await appendFile(this.eventsPath, `${JSON.stringify(row)}\n`);
    return row;
  }
  async capture(name: string, png: Buffer) {
    const filename = `${String(this.document.capture.frames.length).padStart(4, '0')}-${name}.png`;
    const path = join(this.captureDir, filename);
    await writeFile(path, png);
    const frame = { name, path, sha256: sha256(png), atWallMs: Date.now() };
    this.document.capture.frames.push(frame);
    await this.event('capture', frame);
    return path;
  }
  async save(status: string) {
    this.document.status = status;
    this.document.updatedAt = new Date().toISOString();
    await writeFile(join(this.outdir, 'run.json'), `${JSON.stringify(this.document, null, 2)}\n`);
  }
}

/**
 * Ctrl-C and SIGTERM both end a runner's night at its next step, so the
 * record, the region file and the game's teardown still run: a killed run
 * leaves all three. Returns what removes the listeners.
 */
export function onStopSignal(stop: (signal: NodeJS.Signals) => void) {
  const listeners = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    const listener = () => stop(signal);
    process.once(signal, listener);
    return [signal, listener] as const;
  });
  return () => { for (const [signal, listener] of listeners) process.removeListener(signal, listener); };
}

/**
 * A sleep port for HidWireTransport whose pending sleeps can be cut short: a
 * hold is then ONE contact from its DOWN to an UP written when the caller
 * decides, not a chain of reports with a release between each.
 */
export function interruptibleSleep() {
  const pending = new Set<() => void>();
  return {
    sleep: (ms: number) => new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); pending.delete(done); resolve(); };
      const timer = setTimeout(done, ms);
      pending.add(done);
    }),
    interrupt: () => { for (const done of [...pending]) done(); },
  };
}

/** HID contacts, each one an event row on the host clock. */
export class Actor {
  /** `interrupt` cuts the transport's pending sleep (interruptibleSleep): holdWhile needs it. */
  declare hid: ContactPort;
  declare record: RunRecord;
  declare contactMs: number;
  declare interrupt: (() => void) | null;
  constructor(hid: ContactPort, record: RunRecord, contactMs: number, { interrupt = null }: { interrupt?: (() => void) | null } = {}) {
    this.hid = hid; this.record = record; this.contactMs = contactMs; this.interrupt = interrupt;
  }
  async press(control: string, point: Point, detail: object = {}) {
    await this.record.event('input.requested', { control, point, kind: 'press', durationMs: this.contactMs, hostMs: performance.now(), ...detail });
    await this.hid.send({ command: { action: { kind: 'press', durationMs: this.contactMs } }, point });
    this.record.document.inputsSent += 1;
    await this.record.event('input.released', { control, hostMs: performance.now() });
  }
  async double(control: string, point: Point, gapMs: number) {
    await this.record.event('input.requested', { control, point, kind: 'double', gapMs, hostMs: performance.now() });
    await this.hid.send({ command: { action: { kind: 'press', durationMs: this.contactMs } }, point });
    const between = performance.now();
    await sleep(gapMs);
    await this.hid.send({ command: { action: { kind: 'press', durationMs: this.contactMs } }, point });
    this.record.document.inputsSent += 2;
    await this.record.event('input.released', { control, firstReleasedHostMs: between, hostMs: performance.now() });
  }
  /**
   * Hold a control for up to `maxMs` as ONE contact, polling `stop()` every
   * `pollMs`, and let go as soon as it returns a reason. The earlier version
   * chained 1000 ms reports with a release between each, on the belief that
   * one host write is under a game frame; on n5b the held door read open for
   * 0.44-0.50 s three times in 17 s of holding (native frames, evidence
   * fnaf4-night5-n5b-20260927), so a repel tick could find it open.
   */
  async holdWhile(control: string, point: Point, maxMs: number, stop: () => string | null, { pollMs = 30 }: { pollMs?: number } = {}) {
    if (typeof this.interrupt !== 'function') throw new Error('holdWhile needs the transport\'s interruptible sleep');
    const start = performance.now();
    await this.record.event('input.requested', { control, point, kind: 'hold-while', maxMs, hostMs: start });
    let why = 'max';
    let done = false as boolean;
    const contact = this.hid.send({ command: { action: { kind: 'hold', durationMs: Math.round(maxMs) } }, point })
      .finally(() => { done = true; });
    this.record.document.inputsSent += 1;
    while (!done) {
      await sleep(pollMs);
      if (done) break;
      const s = stop();
      if (s) { why = s; this.interrupt(); break; }
    }
    await contact;
    await this.record.event('input.released', { control, hostMs: performance.now(), why });
    return { heldMs: performance.now() - start, why };
  }
  async hold(control: string, point: Point, durationMs: number) {
    await this.record.event('input.requested', { control, point, kind: 'hold', durationMs, hostMs: performance.now() });
    await this.hid.send({ command: { action: { kind: 'hold', durationMs } }, point });
    this.record.document.inputsSent += 1;
    await this.record.event('input.released', { control, hostMs: performance.now() });
  }
}

/** What a region reader reads and gives up; a recorder's channel also clears its regions. */
interface ReadChannel { read(): Promise<RegionRead>, close(): void }
type RecorderChannel = Pick<RegionChannel, 'read' | 'clear' | 'close'>;
/** One reopen of a stalled or dead channel, on the host clock. */
export interface RegionReopen { readonly reopened: number, readonly afterSeq: number, readonly atHostMs: number }
// How long a reader waits without a new frame before reopening its channel.
export const REGION_STALL_MS = 3000;

/**
 * Distinct native-region frames from a channel that reopens itself. `open(fresh)` registers the set on a new
 * channel; `fresh` rediscovers the helper's endpoint.
 *
 * Three ways a night took the recorder on 2026-10-01, each held here:
 *   - a still screen copies no frame (the intro card: seq -1, then the same seq): it waits, reopening through the
 *     cached endpoint after REGION_STALL_MS without a new frame (night7-k3-sr02 gave up within a second);
 *   - a capture restart leaves the channel on a stopped session whose last frame never changes and whose endpoint
 *     is gone: the cached reopen fails, and a fresh one reaches the new session (night7-k3-sr01 kept two frames);
 *   - rediscovery can fail mid-night (the endpoint's logcat line rotates out), so it is tried only after the cached
 *     endpoint fails (night7-k3-sr03 lost the recorder rediscovering through a still intro).
 * A read the session no longer answers forces a reopen; a reopen that fails both ways throws.
 */
export class RegionStream<C extends ReadChannel> {
  declare channel: C;
  declare open: (fresh: boolean) => Promise<C>;
  declare now: () => number;
  declare stallMs: number;
  declare last: number;
  declare reopened: number;
  declare advancedAt: number;
  constructor(channel: C, open: (fresh: boolean) => Promise<C>, { now = () => performance.now(), stallMs = REGION_STALL_MS }:
    { now?: () => number, stallMs?: number } = {}) {
    this.channel = channel; this.open = open; this.now = now; this.stallMs = stallMs;
    this.last = -1; this.reopened = 0; this.advancedAt = now();
  }
  /** The next distinct frame, the reopen that replaced a stalled channel, or null once `done()` holds. */
  async next(done: () => boolean): Promise<{ frame: RegionRead } | { reopen: RegionReopen } | null> {
    while (!done()) {
      if (this.now() - this.advancedAt > this.stallMs) {
        try { this.channel.close(); } catch { /* the stopped session may already be gone */ }
        let next: C;
        try { next = await this.open(false); }
        catch {
          try { next = await this.open(true); }
          catch (error) { throw new Error(`frames stopped at seq ${this.last} and the channel could not be reopened: ${(error as Error).message}`); }
        }
        this.channel = next; this.reopened += 1; this.advancedAt = this.now();
        return { reopen: { reopened: this.reopened, afterSeq: this.last, atHostMs: this.now() } };
      }
      let r: RegionRead;
      try { r = await this.channel.read(); }
      catch { this.advancedAt = -Infinity; continue; }   // a read the session no longer answers: reopen now
      if (r.seq < 0 || r.seq === this.last) continue;
      this.last = r.seq; this.advancedAt = this.now();
      return { frame: r };
    }
    return null;
  }
}

/**
 * Every distinct native-region frame, gzipped NDJSON, stamped on the host clock, through a RegionStream: a still
 * screen, a capture restart and a dead read reopen the channel instead of reading it forever. A reopen that fails
 * both ways ends the recorder and names itself in `failure`.
 */
export class RegionRecorder {
  declare open: (fresh: boolean) => Promise<RecorderChannel>;
  declare path: string;
  declare now: () => number;
  declare onReopen: (row: RegionReopen) => void;
  declare stream: RegionStream<RecorderChannel> | null;
  declare running: boolean;
  declare frames: number;
  declare reopened: number;
  declare failure: string | null;
  declare gzip: Gzip;
  declare file: WriteStream;
  declare latest: RegionRead | null;
  declare listeners: Set<(read: RegionRead) => void>;
  declare loop: Promise<void>;
  declare stopping: Promise<void> | null;
  constructor(open: (fresh: boolean) => Promise<RecorderChannel>, path: string,
    { now = () => performance.now(), onReopen = () => {} }: { now?: () => number, onReopen?: (row: RegionReopen) => void } = {}) {
    this.open = open; this.path = path; this.now = now; this.onReopen = onReopen;
    this.stream = null; this.running = false; this.frames = 0; this.reopened = 0; this.failure = null;
    this.gzip = createGzip(); this.file = createWriteStream(path); this.gzip.pipe(this.file);
    this.latest = null;
    this.listeners = new Set();
    this.loop = Promise.resolve();
    this.stopping = null;
  }
  /** The channel the recorder reads now: a reopen replaces the one it was started on. */
  get channel() { return this.stream?.channel ?? null; }
  /** Called with each new frame, in order, before the next read. */
  onFrame(fn: (read: RegionRead) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  /** Open the first channel through the cached endpoint and start reading. */
  async start() {
    const stream = new RegionStream(await this.open(false), this.open, { now: this.now });
    this.stream = stream;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        let next: Awaited<ReturnType<typeof stream.next>>;
        try { next = await stream.next(() => !this.running); }
        catch (error) { this.failure = (error as Error).message; this.running = false; break; }
        if (next === null) break;
        if ('reopen' in next) { this.reopened = next.reopen.reopened; this.onReopen(next.reopen); continue; }
        const r = next.frame;
        this.latest = r;
        const regions = Object.fromEntries(Object.entries(r.regions).map(([k, v]) =>
          [k, Buffer.from(new Uint8Array(v.pixels.buffer)).toString('base64')]));
        this.gzip.write(`${JSON.stringify({ seq: r.seq, imageHostMs: r.imageHostMs,
          imageWallMs: r.imageHostMs === null ? null : performance.timeOrigin + r.imageHostMs, sentAt: r.sentAt,
          receivedAt: r.receivedAt, regions })}\n`);
        this.frames += 1;
        for (const fn of this.listeners) fn(r);
      }
    })();
  }
  /** Stop reading, finish the file, and clear and close the live channel; every call waits for the one stop. */
  stop() {
    this.stopping ??= (async () => {
      this.running = false;
      await this.loop;
      this.gzip.end();
      await finished(this.file);
      const channel = this.channel;
      this.stream = null;
      if (!channel) return;
      try { await channel.clear(); } catch { /* the helper drops regions with its session */ }
      channel.close();
    })();
    return this.stopping;
  }
}

/** Release any held contact, then end the HID process: a contact held when a night errors must not outlive it. */
export async function releaseContacts(hid: { abort(): Promise<unknown> } | null, hidProcess: { close(): Promise<unknown> } | null) {
  try { await hid?.abort(); } catch { /* the process close below ends the stream either way */ }
  try { await hidProcess?.close(); } catch { /* the lease bounds cleanup */ }
}

/**
 * After a night, leave the game on its title: force-stop and start it, then wait for `onTitle` (the game's own title
 * rule over a fresh read) within `boundMs`, and retain the title as a snap. A game without a title rule waits
 * `settleMs` and says its relaunch is unverified; the retained snap is then for a person.
 */
export async function relaunchToTitle({ pkg, activity, snapTo, adb, onTitle = null, boundMs = 30000, pollMs = 500, settleMs = 10000 }:
  { pkg: string, activity: string, snapTo: (name: string) => Promise<void>, adb: (args: string[], timeoutMs: number) => void,
    onTitle?: (() => Promise<boolean>) | null, boundMs?: number, pollMs?: number, settleMs?: number }) {
  adb(['shell', 'am', 'force-stop', pkg], 10000);
  adb(['shell', 'am', 'start', '-W', '-n', activity], 30000);
  if (!onTitle) {
    await sleep(settleMs);
    await snapTo('title-after');
    return `RELAUNCHED_UNVERIFIED (no title rule for this game; the snap is retained for a person after ${settleMs} ms)`;
  }
  const until = performance.now() + boundMs;
  while (performance.now() < until) {
    if (await onTitle()) {
      await snapTo('title-after');
      return 'RELAUNCHED_TO_TITLE (the title rule read the title)';
    }
    await sleep(pollMs);
  }
  await snapTo('title-after');
  throw new Error(`the title did not show within ${boundMs} ms of the relaunch`);
}

/**
 * A demonstration video of the night: screenrecord segments chained on the
 * host (the phone's own limit is 180 s), pulled and joined with ffmpeg after
 * the night. Local only: game frames never enter the repository.
 *
 * One adb shell per segment, chained on the host: the chain can be stopped
 * without killing an adb client, which would cut the running screenrecord off
 * before it writes its moov atom (420-c lost its segment that way). Light on
 * purpose: any screenrecord halves the helper's distinct frames (75 -> 37 of
 * 150 reads, 2026-09-25), and a full-size one starved 420-c into a death.
 */
export function startVideo(serial: string, id: string, { segmentsMax = 6 }: { segmentsMax?: number } = {}) {
  const segments: string[] = [];
  let stopped = false;
  let current = null as ChildProcess | null;
  const next = () => {
    if (stopped || segments.length >= segmentsMax) return;
    const path = `/sdcard/Movies/${id}-${segments.length + 1}.mp4`;
    segments.push(path);
    current = spawn('adb', ['-s', serial, 'shell', 'screenrecord', '--time-limit', '170',
      '--size', '1200x540', '--bit-rate', '2000000', path], { stdio: 'ignore' });
    current.once('exit', () => { current = null; next(); });
  };
  next();
  return {
    async stop(outDir: string) {
      stopped = true;
      try { execFileSync('adb', ['-s', serial, 'shell', 'pkill', '-INT', 'screenrecord'], { timeout: 10000 }); } catch { /* none running */ }
      for (let i = 0; i < 40 && current; i += 1) await sleep(250);
      const pulled: string[] = [];
      for (const remote of segments) {
        // A path's last segment: split returns at least one.
        const local = join(outDir, remote.split('/').pop() as string);
        try {
          execFileSync('adb', ['-s', serial, 'pull', remote, local], { timeout: 120000, stdio: 'ignore' });
          if (existsSync(local)) pulled.push(local);
          execFileSync('adb', ['-s', serial, 'shell', 'rm', '-f', remote], { timeout: 10000 });
        } catch { /* a segment that never started */ }
      }
      if (pulled.length === 0) return null;
      const list = join(outDir, `${id}-segments.txt`);
      await writeFile(list, pulled.map((p) => `file '${p}'`).join('\n'));
      const out = join(outDir, `${id}.mp4`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], { timeout: 300000 });
      return out;
    },
  };
}
