/**
 * ADB-backed physical ports for the modern composition.
 *
 * These ports only open two named channels: `/system/bin/hid -` for the
 * existing HID JSONL protocol and the Companion's authenticated loopback
 * control port. There is intentionally no public command/shell escape hatch.
 * Full-night timing remains owned by a device-local executor, not by a series
 * of host ADB calls.
 * CONTRACT:hid-executor-v1 CONTRACT:cue-helper-control-v1.
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { writeFileSync } from 'node:fs';
import { parseCueResponse, parseRegionRead, regionSetLine, REGION_LIMITS } from '@sixam/play/venues/phone/companion';
import { COMPANION_ENDPOINT_FILE, parseCompanionEndpoint, parseCompanionStatus } from '@sixam/play/venues/phone/companion-status';
const HELPER_PACKAGE = 'com.ppvaz.fnafcompanion';
const READY_DEVICE = 'FNAF Timed Touch';
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function endpointError(message) { throw new Error(`Companion endpoint: ${message}`); }

/**
 * Parse the latest authenticated endpoint announcement from logcat: the
 * legacy `control=READY port=... token=...` line. The Companion's endpoint
 * file (companion-endpoint-v1) is read first; this is the fallback for a
 * helper older than 0.2.0 or a device where run-as is unavailable.
 */
export function parseCompanionLogEndpoint(text) {
  if (typeof text !== 'string') endpointError('logcat output is not text');
  const lines = text.split(/\r?\n/).filter(line => /control=(?:READY|DEGRADED)/.test(line));
  const line = lines.at(-1);
  if (!line) endpointError('no READY or DEGRADED endpoint');
  const port = line.match(/\bport=(\d+)\b/)?.[1];
  const token = line.match(/\btoken=([0-9a-f]{32})\b/)?.[1];
  if (!port || !token) endpointError('endpoint has no bounded port/token');
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535)
    endpointError('endpoint port is outside 1..65535');
  return Object.freeze({ port: numericPort, token });
}

/** @param {string} adb @param {string[]} args @param {{timeout?: number, input?: string, encoding?: any, maxBuffer?: number}} options */
function runSync(adb, args, { timeout = 5000, input, encoding = 'utf8', maxBuffer = 1024 * 1024 } = {}) {
  const output = execFileSync(adb, args, { encoding, input, timeout, maxBuffer });
  return encoding === null ? output : output.replace(/\r/g, '');
}

// The shell text is fixed here so the port has no caller-controlled shell
// surface. It exists only to perform the authenticated loopback exchange.
const HELPER_QUERY_SCRIPT = `
port="$1"
shift
case "$1" in GET|FRAME|WATCH|READ) ;; *) exit 64 ;; esac
printf '%s\\n' "$*" | toybox nc -w 2 127.0.0.1 "$port"
`;

// Keep log volume on the device. Capture diagnostics repeat control=READY,
// so filtering alone still overflows a bounded host buffer after a night.
const HELPER_DISCOVERY_SCRIPT = `
logcat -d --pid="$1" -e 'control=(READY|DEGRADED)' -v brief -s FnafCueHelper:I '*:S' | tail -n 32
`;

/**
 * One timed GET over a host-local forwarded port. The helper stamps
 * `snapshotNs` with System.nanoTime() while answering, so that instant lies
 * inside [sentAt, receivedAt] on the host clock whatever the path's asymmetry:
 * the midpoint is off by at most half the round trip.
 * @param {number} hostPort @param {string} line @param {number} timeoutMs
 */
function timedExchange(hostPort, line, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect({ host: '127.0.0.1', port: hostPort });
    let sentAt = null;
    let text = '';
    let settled = false;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) rejectPromise(error); else resolvePromise(value);
    };
    // The composition's other helper reads are execFileSync adb shells that
    // block this event loop for 140-240 ms at a time. When the loop frees up,
    // Node runs expired timers BEFORE pending socket I/O, so a reply that
    // arrived in time would lose to its own timeout (night5-anchor3: "clock
    // probe timed out" during the intro, while the native anchor loop polled).
    // Defer the verdict one turn so arrived bytes are read first.
    const timer = setTimeout(() => setImmediate(() => settle(new Error('Companion clock probe timed out'))), timeoutMs);
    socket.setNoDelay(true);
    socket.on('connect', () => { sentAt = performance.now(); socket.write(`${line}\n`); });
    socket.on('data', chunk => {
      text += chunk.toString('utf8');
      const newline = text.indexOf('\n');
      if (newline < 0) { if (text.length > 65536) settle(new Error('Companion clock probe reply is oversized')); return; }
      const receivedAt = performance.now();
      try {
        const fields = parseCueResponse(text.slice(0, newline));
        if (!/^\d+$/.test(fields.snapshotNs ?? '')) throw new Error('Companion reply has no snapshotNs');
        const deviceMs = Number(BigInt(fields.snapshotNs)) / 1e6;
        const rttMs = receivedAt - sentAt;
        settle(null, { offsetMs: (sentAt + receivedAt) / 2 - deviceMs, rttMs, fields });
      } catch (error) { settle(error); }
    });
    socket.on('error', error => settle(error));
    socket.on('end', () => settle(new Error('Companion closed the clock probe without a reply')));
  });
}

/**
 * One request line and its one reply line over a host-local forwarded port.
 * @param {number} hostPort @param {string} line @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function lineExchange(hostPort, line, timeoutMs, maxChars = 4096) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect({ host: '127.0.0.1', port: hostPort });
    let text = '';
    let settled = false;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) rejectPromise(error); else resolvePromise(value);
    };
    // Same deferral as timedExchange: bytes that arrived in time win over a
    // timer that expired while the event loop was blocked.
    const timer = setTimeout(() => setImmediate(() => settle(new Error('Companion exchange timed out'))), timeoutMs);
    socket.setNoDelay(true);
    socket.on('connect', () => socket.write(`${line}\n`));
    socket.on('data', chunk => {
      text += chunk.toString('utf8');
      const newline = text.indexOf('\n');
      if (newline >= 0) settle(null, text.slice(0, newline).trim());
      else if (text.length > maxChars) settle(new Error('Companion reply is oversized'));
    });
    socket.on('error', error => settle(error));
    socket.on('end', () => settle(text ? null : new Error('Companion closed the exchange without a reply'), text.trim()));
  });
}

export class AdbCompanionPort {
  /** @param {{serial: string, adb?: string}} options */
  constructor(options) {
    const { serial, adb = 'adb' } = options ?? {};
    if (typeof serial !== 'string' || serial.length === 0) throw new TypeError('Companion port requires an ADB serial');
    this.serial = serial; this.adb = adb; this.endpoint = null;
  }

  /**
   * Find the live session's endpoint: the Companion's handshake file first
   * (files/companion-endpoint.properties, read with run-as; it cannot rotate
   * out the way a logcat line does), and the logcat announcement only when
   * the file is absent -- a helper older than 0.2.0. The file must belong to
   * the running process.
   */
  discover() {
    const pid = runSync(this.adb, ['-s', this.serial, 'shell', 'pidof', HELPER_PACKAGE]).trim().split(/\s+/)[0];
    if (!/^\d+$/.test(pid)) endpointError('helper process is not running');
    let text = null;
    try {
      text = runSync(this.adb, ['-s', this.serial, 'exec-out', 'run-as', HELPER_PACKAGE, 'cat', COMPANION_ENDPOINT_FILE]);
    } catch { /* no file: an older helper, or no session yet */ }
    if (text && text.includes('schema=')) {
      const file = parseCompanionEndpoint(text);
      if (String(file.pid) !== pid) endpointError(`endpoint file belongs to pid ${file.pid}, not the running helper ${pid}`);
      this.endpoint = Object.freeze({ port: file.port, token: file.token, socket: file.socket,
        session: file.session, source: 'endpoint-file' });
      return { ...this.endpoint };
    }
    // A night fills this tag with capture diagnostics. Filter on the phone so
    // discovery still fits its bounded buffer after a long-running capture,
    // while retaining the latest endpoint rather than the first announcement.
    const log = runSync(this.adb, ['-s', this.serial, 'shell', 'sh', '-s', '--', pid],
      { input: HELPER_DISCOVERY_SCRIPT });
    this.endpoint = parseCompanionLogEndpoint(log);
    return { ...this.endpoint };
  }

  /**
   * One request line over a short-lived forward, for the game-agnostic verbs
   * (STATUS, TARGET, LEASE). Returns the reply text; an ERROR reply rejects.
   * @param {string} line @param {{timeoutMs?: number}} [options]
   */
  async #exchangeOnce(line, { timeoutMs = 2000 } = {}) {
    const endpoint = this.endpoint ?? this.discover();
    const forwarded = runSync(this.adb, ['-s', this.serial, 'forward', 'tcp:0', `tcp:${endpoint.port}`]).trim().split(/\s+/).at(-1);
    if (!/^\d+$/.test(forwarded ?? '')) throw new Error('Companion: adb forward returned no host port');
    try {
      const reply = await lineExchange(Number(forwarded), line.replace('<token>', endpoint.token), timeoutMs, 8192);
      if (!reply.startsWith('OK')) throw new Error(`Companion ${line.split(' ')[0]}: ${reply}`);
      return reply;
    } finally {
      try { runSync(this.adb, ['-s', this.serial, 'forward', '--remove', `tcp:${forwarded}`]); } catch { /* the forward dies with adb */ }
    }
  }

  /** The versioned status (companion-status-v1), decoded. */
  async status() {
    return parseCompanionStatus(await this.#exchangeOnce('STATUS <token>'));
  }

  /**
   * Name the Companion's target (a package or game key; `clear` for none).
   * The FNaF 2 legacy readers run only while the target is retail FNaF 2.
   * @param {string} target
   */
  async setTarget(target) {
    if (typeof target !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(target)) throw new TypeError('target must be a package, a game key, or clear');
    return parseCueResponse(await this.#exchangeOnce(`TARGET <token> ${target}`));
  }

  /**
   * Show who holds the host's serial lease on the phone (a label, not an
   * authority: the lease itself is the host's lock). `null` clears it.
   * @param {string | null} label
   */
  async setLease(label) {
    const value = label === null ? 'clear' : label;
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:@-]{1,48}$/.test(value)) throw new TypeError('lease label must be 1..48 of [A-Za-z0-9._:@-]');
    return parseCueResponse(await this.#exchangeOnce(`LEASE <token> ${value}`));
  }

  /**
   * One bounded AudioPlaybackCapture probe on the phone, reduced there to
   * derived numbers (AudioProbe.java): rate, channels, duration, RMS/peak
   * dBFS, active fraction, onset count and times. No audio crosses the wire.
   * `scope` is `all`, `target`, a game key or a package.
   * @param {{seconds: number, scope?: string, pollMs?: number}} options
   */
  async audioProbe({ seconds, scope = 'target', pollMs = 500 }) {
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 30) throw new TypeError('audio probe seconds must be 1..30');
    if (typeof scope !== 'string' || !/^[a-z0-9._-]{1,64}$/.test(scope)) throw new TypeError('audio probe scope must be all, target, a game key or a package');
    await this.#exchangeOnce(`AUDIO <token> probe ${seconds} ${scope}`);
    const deadline = performance.now() + (seconds + 15) * 1000;
    while (performance.now() < deadline) {
      await sleep(pollMs);
      const fields = parseCueResponse(await this.#exchangeOnce('AUDIO <token> status'));
      if (fields.audioProbe === 'DONE' || fields.audioProbe === 'ERROR') return fields;
    }
    throw new Error('Companion audio probe did not finish before its deadline');
  }

  /**
   * Best-effort: name the target and the lease label a runner holds, so the
   * phone's own screen says what it serves. A helper older than 0.2.0 answers
   * `ERROR unknown-verb`; that is reported, never thrown, because it changes
   * nothing a runner reads.
   * @param {{target?: string, lease?: string | null}} options
   */
  async announce({ target, lease } = {}) {
    const result = { target: null, lease: null, errors: [] };
    if (target !== undefined) {
      try { result.target = await this.setTarget(target); } catch (error) { result.errors.push(String(error?.message ?? error)); }
    }
    if (lease !== undefined) {
      try { result.lease = await this.setLease(lease); } catch (error) { result.errors.push(String(error?.message ?? error)); }
    }
    return result;
  }

  /** Synchronous by design: CompanionControlTransport is a bounded request/response codec. */
  request(line) {
    // FNaF 2 legacy reads (Fnaf2Legacy.java). FRAME is the snapshot and its
    // grid from one locked read; the separate GRID verb is retired.
    if (typeof line !== 'string' || !/^(?:GET|FRAME|WATCH|READ) [0-9a-f]{32}(?: status| [0-9a-f]{64})?$/.test(line))
      throw new TypeError('Companion request is outside the authenticated read vocabulary');
    const endpoint = this.endpoint ?? this.discover();
    const args = ['-s', this.serial, 'shell', 'sh', '-s', '--', String(endpoint.port), ...line.split(/\s+/)];
    return runSync(this.adb, args, { timeout: 10000, input: HELPER_QUERY_SCRIPT });
  }

  /**
   * One adb forward to the helper's loopback control port, and timed raw GETs
   * over it. `request()` spawns an adb shell per read (140-240 ms) and cannot
   * bound a clock; over the forward a GET measured RTT min 5.6, p50 9.1, p90
   * 14.6 ms on the campaign handset (2026-09-12), the five fastest of 40 agreeing on the
   * device->host offset within 0.46 ms. The forward is opened once, so polling
   * the latched night onset costs a socket round trip, not a process spawn.
   * `read()` is one exchange (offset bound RTT/2); `probe()` keeps the fastest
   * of `samples` for the offset and the newest for the fields. Always close().
   * @param {{timeoutMs?: number}} [options]
   */
  openClock({ timeoutMs = 1000 } = {}) {
    const endpoint = this.endpoint ?? this.discover();
    const forwarded = runSync(this.adb, ['-s', this.serial, 'forward', 'tcp:0', `tcp:${endpoint.port}`]).trim().split(/\s+/).at(-1);
    if (!/^\d+$/.test(forwarded ?? '')) throw new Error('Companion clock: adb forward returned no host port');
    let closed = false;
    const exchange = async () => {
      if (closed) throw new Error('Companion clock is closed');
      const sample = await timedExchange(Number(forwarded), `GET ${endpoint.token}`, timeoutMs);
      return { ...sample, uncertaintyMs: sample.rttMs / 2, hostClock: 'performance-now-ms' };
    };
    return {
      read: exchange,
      /** @param {{samples?: number, spacingMs?: number}} [options] */
      probe: async ({ samples = 8, spacingMs = 15 } = {}) => {
        if (!Number.isInteger(samples) || samples < 1 || samples > 64) throw new TypeError('clock probe samples must be 1..64');
        let best = null;
        let latest = null;
        for (let index = 0; index < samples; index += 1) {
          latest = await exchange();
          if (best === null || latest.rttMs < best.rttMs) best = latest;
          if (index + 1 < samples) await sleep(spacingMs);
        }
        return { offsetMs: best.offsetMs, uncertaintyMs: best.uncertaintyMs, rttMs: best.rttMs,
          samples, hostClock: 'performance-now-ms', fields: latest.fields };
      },
      close: () => {
        if (closed) return;
        closed = true;
        try { runSync(this.adb, ['-s', this.serial, 'forward', '--remove', `tcp:${forwarded}`]); } catch { /* the forward dies with adb */ }
      },
    };
  }

  /**
   * The teach panel's lesson channel: one forward, and only LESSON lines
   * (cycle-lesson.js LESSON_LINE). Each line is one exchange; the reply is
   * returned as text and an `ERROR` reply rejects. Opening the forward is the
   * only blocking step, so call this before any phase-critical moment.
   * @param {{timeoutMs?: number, lessonLine: RegExp}} options
   */
  openLesson({ timeoutMs = 1000, lessonLine } = /** @type {any} */ ({})) {
    if (!(lessonLine instanceof RegExp)) throw new TypeError('lesson channel needs the LESSON line grammar');
    const endpoint = this.endpoint ?? this.discover();
    const forwarded = runSync(this.adb, ['-s', this.serial, 'forward', 'tcp:0', `tcp:${endpoint.port}`]).trim().split(/\s+/).at(-1);
    if (!/^\d+$/.test(forwarded ?? '')) throw new Error('Companion lesson: adb forward returned no host port');
    let closed = false;
    return {
      /** @param {string} line */
      send: async line => {
        if (closed) throw new Error('Companion lesson channel is closed');
        if (typeof line !== 'string' || !lessonLine.test(line))
          throw new TypeError('Companion lesson line is outside the LESSON vocabulary');
        const reply = await lineExchange(Number(forwarded), line, timeoutMs);
        if (!reply.startsWith('OK')) throw new Error(`Companion lesson: ${reply}`);
        return reply;
      },
      close: () => {
        if (closed) return;
        closed = true;
        try { runSync(this.adb, ['-s', this.serial, 'forward', '--remove', `tcp:${forwarded}`]); } catch { /* the forward dies with adb */ }
      },
    };
  }

  /**
   * The native-region channel: one forward, REGION lines only. `set` registers
   * a rectangle of native display pixels, `read` returns every registered
   * region's raw pixels from the newest copied frame with that frame's image
   * time, and the host time the exchange was sent and answered -- so a caller
   * can place the frame on its own clock to within half the round trip.
   * @param {{timeoutMs?: number}} [options]
   */
  openRegions({ timeoutMs = 1000 } = {}) {
    const endpoint = this.endpoint ?? this.discover();
    const forwarded = runSync(this.adb, ['-s', this.serial, 'forward', 'tcp:0', `tcp:${endpoint.port}`]).trim().split(/\s+/).at(-1);
    if (!/^\d+$/.test(forwarded ?? '')) throw new Error('Companion regions: adb forward returned no host port');
    let closed = false;
    const exchange = async (line) => {
      if (closed) throw new Error('Companion region channel is closed');
      const sentAt = performance.now();
      const reply = await lineExchange(Number(forwarded), line, timeoutMs, REGION_LIMITS.lineChars);
      return { reply, sentAt, receivedAt: performance.now() };
    };
    return {
      /** @param {string} name @param {{x:number,y:number,width:number,height:number,step?:number}} rect */
      set: async (name, rect) => {
        const { reply } = await exchange(regionSetLine(endpoint.token, name, rect));
        if (!reply.startsWith('OK')) throw new Error(`Companion region ${name}: ${reply}`);
        return reply;
      },
      clear: async () => {
        const { reply } = await exchange(`REGION ${endpoint.token} clear`);
        if (!reply.startsWith('OK')) throw new Error(`Companion region clear: ${reply}`);
      },
      read: async () => {
        const { reply, sentAt, receivedAt } = await exchange(`REGION ${endpoint.token} read`);
        const parsed = parseRegionRead(reply);
        const deviceMs = Number(parsed.snapshotNs) / 1e6;
        const offsetMs = (sentAt + receivedAt) / 2 - deviceMs;      // host ms = device ms + offset
        const imageHostMs = parsed.imageNs !== null && parsed.imageNs >= 0n
          ? Number(parsed.imageNs) / 1e6 + offsetMs : null;
        return { ...parsed, sentAt, receivedAt, rttMs: receivedAt - sentAt, offsetMs, imageHostMs };
      },
      close: () => {
        if (closed) return;
        closed = true;
        try { runSync(this.adb, ['-s', this.serial, 'forward', '--remove', `tcp:${forwarded}`]); } catch { /* the forward dies with adb */ }
      },
    };
  }

  /**
   * One whole native frame from the helper's projection, as a PNG on the
   * host: SNAP writes it under the helper's files/frames, and it is pulled
   * with run-as and removed. For title, menu and calibration screens; a
   * night reads openRegions() instead.
   * @param {string} label @param {string} target @param {{timeoutMs?: number}} [options]
   */
  async snap(label, target, { timeoutMs = 5000 } = {}) {
    if (!/^[A-Za-z0-9._-]{1,48}$/.test(label)) throw new TypeError('snap label must be 1..48 of [A-Za-z0-9._-]');
    const endpoint = this.endpoint ?? this.discover();
    const forwarded = runSync(this.adb, ['-s', this.serial, 'forward', 'tcp:0', `tcp:${endpoint.port}`]).trim().split(/\s+/).at(-1);
    try {
      const reply = await lineExchange(Number(forwarded), `SNAP ${endpoint.token} ${label}`, timeoutMs);
      const fields = parseCueResponse(reply);
      if (fields.path !== `files/frames/${label}.png`) throw new Error(`Companion snap wrote an unexpected path: ${reply}`);
      const bytes = runSync(this.adb, ['-s', this.serial, 'exec-out', 'run-as', HELPER_PACKAGE, 'cat', fields.path],
        { timeout: 10000, encoding: null, maxBuffer: 64 * 1024 * 1024 });
      if (!bytes || bytes.length < 1000) throw new Error('Companion snap pulled an empty frame');
      writeFileSync(target, bytes);
      try { runSync(this.adb, ['-s', this.serial, 'shell', 'run-as', HELPER_PACKAGE, 'rm', '-f', fields.path]); } catch { /* next snap overwrites */ }
      return { path: target, imageNs: BigInt(fields.imageNs), snapshotNs: BigInt(fields.snapshotNs), bytes: bytes.length };
    } finally {
      try { runSync(this.adb, ['-s', this.serial, 'forward', '--remove', `tcp:${forwarded}`]); } catch { /* the forward dies with adb */ }
    }
  }

  /** One offset measurement on a short-lived forward. @param {{samples?: number, spacingMs?: number, timeoutMs?: number}} [options] */
  async probeClock({ timeoutMs = 1000, ...options } = {}) {
    const clock = this.openClock({ timeoutMs });
    try { return await clock.probe(options); }
    finally { clock.close(); }
  }
}

export class AdbHidProcess {
  /** @param {{serial: string, adb?: string, readyTimeoutMs?: number}} options */
  constructor(options) {
    const { serial, adb = 'adb', readyTimeoutMs = 12000 } = options ?? {};
    if (typeof serial !== 'string' || serial.length === 0) throw new TypeError('HID port requires an ADB serial');
    this.serial = serial; this.adb = adb; this.readyTimeoutMs = readyTimeoutMs;
    this.child = null; this.failed = null; this.closed = false;
  }

  ensureStarted() {
    if (this.closed) throw new Error('ADB HID process is closed');
    if (this.failed) throw this.failed;
    if (this.child) return;
    const child = spawn(this.adb, ['-s', this.serial, 'shell', '/system/bin/hid', '-'], {
      stdio: ['pipe', 'ignore', 'pipe'], shell: false,
    });
    child.on('error', error => { this.failed = error; });
    child.on('close', code => {
      if (!this.closed && code !== 0) this.failed = new Error(`ADB HID process exited with ${code}`);
      this.child = null;
    });
    this.child = child;
  }

  async write(line) {
    if (typeof line !== 'string' || line.includes('\n') || line.includes('\r'))
      throw new TypeError('HID port accepts one JSONL line at a time');
    this.ensureStarted();
    if (this.failed || !this.child?.stdin) throw this.failed ?? new Error('ADB HID stdin is unavailable');
    if (!this.child.stdin.write(`${line}\n`)) await new Promise((resolve, reject) => {
      this.child.stdin.once('drain', resolve); this.child.stdin.once('error', reject);
    });
  }

  async ready(deviceName = READY_DEVICE) {
    this.ensureStarted();
    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (this.failed) throw this.failed;
      try {
        const output = runSync(this.adb, ['-s', this.serial, 'shell', 'dumpsys', 'input'], { timeout: 2000 });
        if (output.includes(deviceName)) return;
      } catch { /* a transient dumpsys failure stays inside the bounded wait */ }
      await sleep(100);
    }
    throw new Error('InputReader did not expose the registered HID device before the deadline');
  }

  async close() {
    this.closed = true;
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.stdin?.end();
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
}

/** Construct the two named ports consumed by composeModernDevice. */
/** @param {{serial: string, adb?: string}} options */
export function createAdbModernPorts(options) {
  const { serial, adb = 'adb' } = options ?? {};
  const hid = new AdbHidProcess({ serial, adb });
  const cue = new AdbCompanionPort({ serial, adb });
  return Object.freeze({ hid, cue, close: () => hid.close() });
}
