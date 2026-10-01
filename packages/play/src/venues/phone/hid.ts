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

// The HID axes' logical ranges, from HID_DESCRIPTOR (Logical Maximum 2399 on
// X, 1079 on Y): a raw coordinate outside them is not a place on the screen.
const RAW_MAX = Object.freeze([2399, 1079]);

/** The bundle file that carries each control's HID coordinates beside the profile it came from. */
export const HID_CONTROLS_FILE = 'hid-controls.txt';
export const HID_CONTROLS_SCHEMA = 'hid-controls-v1';

/**
 * Every control a device profile's controlMap names, as the raw HID
 * coordinates this transport would press, in the line file a bundle carries
 * (HID_CONTROLS_FILE). The Companion's runner reads them from there and holds
 * no geometry of its own: until 2026-09-30 NightRunner.java kept a copy of the
 * control map and of toRaw, and test-screen-map.ts held the two copies to one
 * answer. The file names the profile and its sha256, so a runner can refuse
 * controls that were not derived from the profile beside them.
 * 
 * @param profileSha256 sha256 of the profile file's bytes
 */
export function hidControlsText(profile: {id: string, controlMap: Record<string, {x: number, y: number}>}, profileSha256: string) {
  if (!profile || typeof profile.controlMap !== 'object' || profile.controlMap === null)
    throw new TypeError('the profile names no controlMap');
  if (typeof profile.id !== 'string' || !/^\S+$/.test(profile.id)) throw new TypeError('the profile has no id');
  if (!/^[0-9a-f]{64}$/.test(profileSha256)) throw new TypeError('the profile sha256 must be 64 hex digits');
  const lines = [`#schema ${HID_CONTROLS_SCHEMA}`, `#profile ${profile.id}`, `#profile-sha256 ${profileSha256}`];
  for (const name of Object.keys(profile.controlMap).sort()) {
    if (!/^[A-Za-z][A-Za-z0-9:]*$/.test(name)) throw new TypeError(`control name ${JSON.stringify(name)} is not a plan token`);
    const point = profile.controlMap[name];
    if (!finitePoint(point)) throw new TypeError(`control ${name} has no finite x and y`);
    const raw = toRaw([point.x, point.y]);
    if (raw.some((value, axis) => value < 0 || value > RAW_MAX[axis]))
      throw new RangeError(`control ${name} at (${point.x}, ${point.y}) maps to raw (${raw.join(', ')}), off the HID axes`);
    lines.push(`${name} ${raw[0]} ${raw[1]}`);
  }
  return `${lines.join('\n')}\n`;
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
  declare write: any;
  declare ready: any;
  declare sleep: any;
  declare registerDelayMs: any;
  declare contactMs: any;
  declare deviceId: any;
  declare name: any;
  declare vid: any;
  declare pid: any;
  declare bus: any;
  declare descriptor: any[];
  declare featureReports: any;
  declare started: boolean;
  declare aborted: boolean;
  constructor(options: any = {}) {
    // Generic contact default for discrete UI controls. Device-local gameplay
    // schedules carry their own explicitly qualified duration.
    const { write, ready = async () => {}, sleep = milliseconds => new Promise<any>(resolve => setTimeout(resolve, milliseconds)),
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
