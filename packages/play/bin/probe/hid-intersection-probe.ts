// Emit the legal camera-light/monitor intersection followed by a state-gated
// hall-light pulse.
//
// The camera-feed light is a legal monitor-up control.  `camdrop` holds that
// light on contact 0 while contact 1 lowers the monitor, then keeps the light
// held through the monitor release/tail.  The hall light is deliberately a
// separate phase: it is not written until the wrapper has observed monitor
// down, mask down, and both office buttons visible on two fresh FRAME reads.
//
// There is no mask report in this stream.  Mask-up -> hall-light and
// mask-up -> monitor are illegal routes and are recorded as refused plan paths,
// never as executable events.
//
// Usage: SPLIT_OUT=captures/name node hid-intersection-probe.ts
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { COORDS, toRaw } from '../phone/hid-sweep-probe.ts';

type Point = readonly [number, number];
export const HALL_LIGHT: Point = [1200, 540];
export const HID_ID = 114;

const lo = (value: number) => value & 0xff;
const hi = (value: number) => (value >> 8) & 0xff;
export const record = (flags: number, point: Point) => {
  const [x, y] = toRaw(point);
  return [flags, lo(x), hi(x), lo(y), hi(y)];
};

const DESCRIPTOR = [5,13,9,4,161,1,133,1,9,34,161,0,9,85,21,0,37,2,117,8,149,1,177,2,9,84,129,2,
  5,13,9,34,161,2,9,66,21,0,37,1,117,1,129,2,9,50,129,2,9,81,37,63,117,6,129,2,
  5,1,9,48,38,95,9,117,16,129,2,9,49,38,55,4,129,2,192,
  5,13,9,34,161,2,9,66,21,0,37,1,117,1,129,2,9,50,129,2,9,81,37,63,117,6,129,2,
  5,1,9,48,38,95,9,117,16,129,2,9,49,38,55,4,129,2,192,192,192];

const integer = (name: string, value: number, min: number, max: number) => {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer between ${min} and ${max} ms`);
  return value;
};

export function timingPlan({ contactMs = 33, camdropLeadMs = 150,
                             camdropMonitorMs = contactMs, camdropTailMs = 67,
                             hallMs = contactMs, preRaiseMs = 100,
                             postHallMs = 1500 }: {contactMs?: number, camdropLeadMs?: number, camdropMonitorMs?: number, camdropTailMs?: number, hallMs?: number, preRaiseMs?: number, postHallMs?: number} = {}) {
  integer('contactMs', contactMs, 17, 1000);
  integer('camdropLeadMs', camdropLeadMs, 0, 1000);
  integer('camdropMonitorMs', camdropMonitorMs, 17, 1000);
  integer('camdropTailMs', camdropTailMs, 0, 1000);
  integer('hallMs', hallMs, 17, 1000);
  integer('preRaiseMs', preRaiseMs, 0, 3000);
  integer('postHallMs', postHallMs, 100, 5000);
  return Object.freeze({ contactMs, camdropLeadMs, camdropMonitorMs,
    camdropTailMs, hallMs, preRaiseMs, postHallMs,
    camdropTotalMs: camdropLeadMs + camdropMonitorMs + camdropTailMs });
}

function oneContactReport(point: Point, flags: number) {
  return { id: HID_ID, command: 'report',
    report: [1, 1, ...record(flags, point), 0, 0, 0, 0, 0] };
}

function twoContactReport(first: Point, firstFlags: number, second: Point, secondFlags: number) {
  return { id: HID_ID, command: 'report',
    report: [1, 2, ...record(firstFlags, first), ...record(secondFlags, second)] };
}

function delay(duration: number) { return { id: HID_ID, command: 'delay', duration }; }

/**
 * Build the four independently releasable phases.  The wrapper writes only
 * the next phase after its state gate has passed.
 */
export function phases(options: Parameters<typeof timingPlan>[0] = {}) {
  const plan = timingPlan(options);
  const register = [{ id: HID_ID, command: 'register',
    name: 'FNAF HID camera-light intersection probe', vid: 6353, pid: 61964,
    bus: 'usb', descriptor: DESCRIPTOR }];

  const raise = [
    delay(plan.preRaiseMs),
    oneContactReport(COORDS.monitor, 0x03),
    delay(plan.contactMs),
    oneContactReport(COORDS.monitor, 0x00),
  ];

  // Legal intersection primitive: cameraFeedLight remains contact 0 while
  // monitor is lowered on contact 1.  The second report releases only contact
  // 1, the third keeps it released while the light tail remains active, and
  // the final report releases contact 0 with a consumed contact-1 filler.
  const camdrop = [
    oneContactReport(COORDS.cameraFeedLight, 0x03),
    delay(plan.camdropLeadMs),
    twoContactReport(COORDS.cameraFeedLight, 0x03, COORDS.monitor, 0x07),
    delay(plan.camdropMonitorMs),
    twoContactReport(COORDS.cameraFeedLight, 0x03, COORDS.monitor, 0x04),
    delay(plan.camdropTailMs),
    oneContactReport(COORDS.cameraFeedLight, 0x00),
  ];

  // This phase is prepared but must not be written until the wrapper's office
  // gate has passed.  Keeping it in a separate file makes an accidental
  // pre-queued hall report structurally visible and testable.
  const hall = [
    oneContactReport(HALL_LIGHT, 0x03),
    delay(plan.hallMs),
    oneContactReport(HALL_LIGHT, 0x00),
    delay(plan.postHallMs),
  ];

  const manifest = {
    schema: 'intersection-probe-schedule-v1',
    controls: ['cameraFeedLight', 'monitor', 'hallLight'],
    coordinates: {
      cameraFeedLight: COORDS.cameraFeedLight,
      monitor: COORDS.monitor,
      hallLight: HALL_LIGHT,
    },
    contactMs: plan.contactMs,
    camdropLeadMs: plan.camdropLeadMs,
    camdropMonitorMs: plan.camdropMonitorMs,
    camdropTailMs: plan.camdropTailMs,
    camdropTotalMs: plan.camdropTotalMs,
    hallMs: plan.hallMs,
    preRaiseMs: plan.preRaiseMs,
    postHallMs: plan.postHallMs,
    phases: ['register', 'raise', 'camdrop', 'hall'],
    stateGates: {
      initial: 'office: monitor-down + mask-down + both-bottom-buttons-visible',
      beforeCamdrop: 'monitor-up: fresh consecutive positive observations',
      beforeHall: 'office: monitor-down + mask-down + both-bottom-buttons-visible',
      consecutiveObservations: 2,
    },
    dependentControls: ['hallLight'],
    dependentControlsStateGated: true,
    illegalPathsRefused: ['mask-up->hallLight', 'mask-up->monitor'],
    maskReports: 0,
  };
  return Object.freeze({ register, raise, camdrop, hall, manifest });
}

export function stream(options: Parameters<typeof timingPlan>[0] = {}) {
  const built = phases(options);
  return [...built.register, ...built.raise, ...built.camdrop, ...built.hall];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('intersection probe takes no positional arguments');
  const env = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
  };
  const splitOut = process.env.SPLIT_OUT || null;
  if (!splitOut) throw new Error('SPLIT_OUT is required so gated phases cannot be mixed');
  const built = phases({
    contactMs: env('CONTACT_MS', 33),
    camdropLeadMs: env('CAMDROP_LEAD_MS', 150),
    camdropMonitorMs: env('CAMDROP_MONITOR_MS', env('CONTACT_MS', 33)),
    camdropTailMs: env('CAMDROP_TAIL_MS', 67),
    hallMs: env('HALL_MS', env('CONTACT_MS', 33)),
    preRaiseMs: env('PRE_RAISE_MS', 100),
    postHallMs: env('POST_HALL_MS', 1500),
  });
  writeFileSync(`${splitOut}.register.jsonl`, built.register.map((event) => JSON.stringify(event)).join('\n') + '\n');
  writeFileSync(`${splitOut}.raise.jsonl`, built.raise.map((event) => JSON.stringify(event)).join('\n') + '\n');
  writeFileSync(`${splitOut}.camdrop.jsonl`, built.camdrop.map((event) => JSON.stringify(event)).join('\n') + '\n');
  writeFileSync(`${splitOut}.hall.jsonl`, built.hall.map((event) => JSON.stringify(event)).join('\n') + '\n');
  writeFileSync(`${splitOut}.intersection.json`, JSON.stringify(built.manifest, null, 2) + '\n');
  for (const event of stream({
    contactMs: env('CONTACT_MS', 33),
    camdropLeadMs: env('CAMDROP_LEAD_MS', 150),
    camdropMonitorMs: env('CAMDROP_MONITOR_MS', env('CONTACT_MS', 33)),
    camdropTailMs: env('CAMDROP_TAIL_MS', 67),
    hallMs: env('HALL_MS', env('CONTACT_MS', 33)),
    preRaiseMs: env('PRE_RAISE_MS', 100),
    postHallMs: env('POST_HALL_MS', 1500),
  })) console.log(JSON.stringify(event));
}
