/**
 * HID-MULTITOUCH transport codec.  This module owns report bytes and the
 * portrait-natural coordinate transform; it does not choose a policy, read a
 * clock, or open adb.  The composition root injects a line writer and an
 * InputReader-ready gate.
 * CONTRACT:hid-executor-v1.
 */

export const HID_DESCRIPTOR = Object.freeze([
  5, 13, 9, 4, 161, 1, 133, 1, 9, 34, 161, 0, 9, 85, 21, 0, 37, 2,
  117, 8, 149, 1, 177, 2, 9, 84, 129, 2, 5, 13, 9, 34, 161, 2, 9,
  66, 21, 0, 37, 1, 117, 1, 129, 2, 9, 50, 129, 2, 9, 81, 37, 63, 117, 6,
  129, 2, 5, 1, 9, 48, 38, 95, 9, 117, 16, 129, 2, 9, 49, 38, 55,
  4, 129, 2, 192, 5, 13, 9, 34, 161, 2, 9, 66, 21, 0, 37, 1, 117, 1, 129,
  2, 9, 50, 129, 2, 9, 81, 37, 63, 117, 6, 129, 2, 5, 1, 9, 48,
  38, 95, 9, 117, 16, 129, 2, 9, 49, 38, 55, 4, 129, 2, 192, 192,
  192,
]);

// The multitouch descriptor declares one one-byte feature report (report ID
// 1). Recent Android hid implementations query it while attaching the UHID
// device; omitting the response leaves the virtual device out of InputReader,
// even though the hid process itself stays alive.
export const HID_FEATURE_REPORTS = Object.freeze([
  Object.freeze({ id: 1, data: Object.freeze([0]) }),
]);

const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
const byte = value => value & 0xff;
const high = value => (value >> 8) & 0xff;

/** Convert native 2400x1080 landscape coordinates to the HID axes. */
export function toRaw([x, y]) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('HID point must be finite');
  return [Math.floor((1080 - y) * 20 / 9), Math.floor(x * 9 / 20)];
}

function record(flags, point) {
  const [x, y] = toRaw([point.x, point.y]);
  return [flags, byte(x), high(x), byte(y), high(y)];
}

/** Encode a bounded report; report IDs and contact records stay transport-local. */
export function report(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 2)
    throw new TypeError('HID report needs one or two contact records');
  // The hybrid descriptor consumes the filler record as contact 1 when a
  // single contact is released.  Leaving it as all-zero bytes makes the
  // kernel interpret the packet as an unnamed contact transition; the next
  // Click can then stay latched and Fusion never receives the UP.  Active
  // single-contact packets keep the historical zero filler; release packets
  // explicitly name contact 1 as inactive.
  const filler = records.length === 1
    ? [records[0].flags === 0 ? 4 : 0, 0, 0, 0, 0]
    : [];
  return [1, records.length, ...records.flatMap(({ flags, point }) => record(flags, point)),
    ...filler];
}

export class HidWireTransport {
  /** @param {any} options */
  constructor(options = {}) {
    // Generic contact default for discrete UI controls. Device-local gameplay
    // schedules carry their own explicitly qualified duration.
    const { write, ready = async () => {}, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
      registerDelayMs = 0, contactMs = 17, deviceId = 92, name = 'FNAF Timed Touch',
      vid = 6353, pid = 61959, bus = 'usb', descriptor = HID_DESCRIPTOR,
      featureReports = HID_FEATURE_REPORTS } = options;
    if (typeof write !== 'function') throw new TypeError('HID transport needs an injected line writer');
    if (typeof ready !== 'function' || typeof sleep !== 'function') throw new TypeError('HID transport ready/sleep ports are required');
    if (!Number.isInteger(contactMs) || contactMs < 1 || contactMs > 1000)
      throw new TypeError('HID contact timing must be 1..1000 ms');
    this.write = write; this.ready = ready; this.sleep = sleep; this.registerDelayMs = registerDelayMs;
    this.contactMs = contactMs; this.deviceId = deviceId; this.name = name; this.vid = vid; this.pid = pid;
    this.bus = bus; this.descriptor = [...descriptor];
    this.featureReports = featureReports.map(report => ({ id: report.id, data: [...report.data] }));
    this.started = false; this.aborted = false;
  }

  async start() {
    if (this.started) return;
    this.aborted = false;
    await this.write(JSON.stringify({ id: this.deviceId, command: 'register', name: this.name,
      vid: this.vid, pid: this.pid, bus: this.bus, descriptor: this.descriptor,
      feature_reports: this.featureReports }));
    if (this.registerDelayMs > 0) await this.sleep(this.registerDelayMs);
    await this.ready();
    this.started = true;
  }

  async send({ command, point }) {
    if (!command?.action || !finitePoint(point)) throw new TypeError('HID send needs a semantic command and mapped point');
    await this.start();
    if (this.aborted) throw new Error('HID transport is aborted');
    const kind = command.action.kind;
    if (kind === 'release') return this.releaseAll();
    if (!['press', 'hold', 'select'].includes(kind)) throw new Error(`HID action is unsupported: ${kind}`);
    const duration = command.action.durationMs ?? command.source?.durationMs ?? this.contactMs;
    if (!Number.isInteger(duration) || duration < 1 || duration > 30000)
      throw new TypeError('HID action duration must be 1..30000 ms');
    await this.write(JSON.stringify({ id: this.deviceId, command: 'report', report: report([{ flags: 3, point }]) }));
    await this.sleep(duration);
    await this.write(JSON.stringify({ id: this.deviceId, command: 'report', report: report([{ flags: 0, point }]) }));
    return { durationMs: duration };
  }

  async abort() { this.aborted = true; await this.releaseAll(); }

  async releaseAll() {
    if (!this.started) return;
    await this.write(JSON.stringify({ id: this.deviceId, command: 'report',
      report: [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }));
  }
}
