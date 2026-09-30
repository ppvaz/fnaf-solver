/**
 * What every night runner on the handset shares: the native-region recorder
 * and the demonstration video. Game rules stay in each game's runner.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A run's document (run.json) and its event rows (events.jsonl), host clocks named. */
export class RunRecord {
  constructor({ schema, pkg, id, outdir, captureDir, options, bindings, claimLevel, sensor }) {
    this.outdir = outdir; this.captureDir = captureDir;
    this.eventsPath = join(outdir, 'events.jsonl');
    this.document = {
      schema, id, startedAt: new Date().toISOString(), claimLevel,
      target: { package: pkg }, options, bindings,
      capture: { sensor, directory: captureDir, frames: [] },
      inputsSent: 0, status: 'STARTING',
    };
  }
  async event(type, fields = {}) {
    const row = { atWallMs: Date.now(), atMonotonicMs: Math.round(performance.now()), type, ...fields };
    await appendFile(this.eventsPath, `${JSON.stringify(row)}\n`);
    return row;
  }
  async capture(name, png) {
    const filename = `${String(this.document.capture.frames.length).padStart(4, '0')}-${name}.png`;
    const path = join(this.captureDir, filename);
    await writeFile(path, png);
    const frame = { name, path, sha256: sha256(png), atWallMs: Date.now() };
    this.document.capture.frames.push(frame);
    await this.event('capture', frame);
    return path;
  }
  async save(status) {
    this.document.status = status;
    this.document.updatedAt = new Date().toISOString();
    await writeFile(join(this.outdir, 'run.json'), `${JSON.stringify(this.document, null, 2)}\n`);
  }
}

/**
 * A sleep port for HidWireTransport whose pending sleeps can be cut short: a
 * hold is then ONE contact from its DOWN to an UP written when the caller
 * decides, not a chain of reports with a release between each.
 */
export function interruptibleSleep() {
  const pending = new Set();
  return {
    sleep: (ms) => new Promise((resolve) => {
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
  constructor(hid, record, contactMs, { interrupt = null } = {}) {
    this.hid = hid; this.record = record; this.contactMs = contactMs; this.interrupt = interrupt;
  }
  async press(control, point, detail = {}) {
    await this.record.event('input.requested', { control, point, kind: 'press', durationMs: this.contactMs, hostMs: performance.now(), ...detail });
    await this.hid.send({ command: { action: { kind: 'press', durationMs: this.contactMs } }, point });
    this.record.document.inputsSent += 1;
    await this.record.event('input.released', { control, hostMs: performance.now() });
  }
  async double(control, point, gapMs) {
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
  async holdWhile(control, point, maxMs, stop, { pollMs = 30 } = {}) {
    if (typeof this.interrupt !== 'function') throw new Error('holdWhile needs the transport\'s interruptible sleep');
    const start = performance.now();
    await this.record.event('input.requested', { control, point, kind: 'hold-while', maxMs, hostMs: start });
    let why = 'max';
    let done = false;
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
  async hold(control, point, durationMs) {
    await this.record.event('input.requested', { control, point, kind: 'hold', durationMs, hostMs: performance.now() });
    await this.hid.send({ command: { action: { kind: 'hold', durationMs } }, point });
    this.record.document.inputsSent += 1;
    await this.record.event('input.released', { control, hostMs: performance.now() });
  }
}

/** Every distinct native-region frame, gzipped NDJSON, stamped on the host clock. */
export class RegionRecorder {
  constructor(channel, path) {
    this.channel = channel; this.path = path; this.running = false; this.frames = 0; this.errors = 0;
    this.gzip = createGzip(); this.gzip.pipe(createWriteStream(path));
    this.last = -1; this.latest = null;
    this.listeners = new Set();
  }
  /** Called with each new frame, in order, before the next read. */
  onFrame(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  start() {
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        try {
          const r = await this.channel.read();
          if (r.seq < 0 || r.seq === this.last) continue;
          this.last = r.seq;
          this.latest = r;
          const regions = Object.fromEntries(Object.entries(r.regions).map(([k, v]) =>
            [k, Buffer.from(new Uint8Array(v.pixels.buffer)).toString('base64')]));
          this.gzip.write(`${JSON.stringify({ seq: r.seq, imageHostMs: r.imageHostMs,
            imageWallMs: performance.timeOrigin + r.imageHostMs, sentAt: r.sentAt,
            receivedAt: r.receivedAt, regions })}\n`);
          this.frames += 1;
          for (const fn of this.listeners) fn(r);
        } catch {
          this.errors += 1;
          await sleep(20);
        }
      }
    })();
  }
  async stop() {
    this.running = false;
    await this.loop;
    await new Promise((r) => this.gzip.end(r));
  }
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
export function startVideo(serial, id, { segmentsMax = 6 } = {}) {
  const segments = [];
  let stopped = false;
  let current = null;
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
    async stop(outDir) {
      stopped = true;
      try { execFileSync('adb', ['-s', serial, 'shell', 'pkill', '-INT', 'screenrecord'], { timeout: 10000 }); } catch { /* none running */ }
      for (let i = 0; i < 40 && current; i += 1) await sleep(250);
      const pulled = [];
      for (const remote of segments) {
        const local = join(outDir, remote.split('/').pop());
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
