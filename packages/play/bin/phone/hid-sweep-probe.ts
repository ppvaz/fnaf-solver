// Emit a `/system/bin/hid` report stream that selects CAM 10, CAM 04 and
// CAM 07 at a chosen inter-selection spacing. The camera light is pulsed after
// each selection by default; HELD_LIGHT=1 holds contact 0 across the whole
// sweep and LIGHT_TAIL_MS past the last camera's click.
//
// This exists to settle one measurement. The Night 6 left-opening route needs
// a three-camera sweep spanning about 300 ms; the phone's only proven figure
// is 240 ms spacing, which spans 580 ms and leaves a one-frame scheduler-phase
// window. See docs/device/HID-MULTITOUCH.md. The rejected evidence on record
// is for *batched* `hid delay` macros, not for wall-timed spacing below
// 240 ms, so the floor has never actually been measured.
//
// Usage: node hid-sweep-probe.ts [spacingMs ...]   (default 240 160 120 100)
import { pathToFileURL } from 'node:url';

// The screen->HID transform is the transport's own (packages/play, the one
// the campaign executor presses with): 2400x1080 landscape onto the
// portrait-natural HID axes, truncated. It was written here a second time until
// 2026-09-25, beside a shell copy in the legacy runner and a Python one in
// desync-scan.py; the three disagreed on four real taps once (a Math.round
// here). Both other copies are archived and this one re-exports the
// transport's, so test-screen-map.ts is left comparing the transport with the
// Companion's Java copy.
export { toRaw } from '@sixam/play/venues/phone/hid';
import { toRaw } from '@sixam/play/venues/phone/hid';

// No title coordinate lives here. Selecting a night is menu.sh's job, and it
// is the only place that looks at the screen before pressing: it refuses when
// the item is absent, when the game is not focused, and it gates New Game
// behind MENU_ALLOW_SAVE_RESET. A blind title tap inside an HID stream
// has none of that, and it was a sixth reimplementation of the selection this
// repository had already centralised once after a save was destroyed.
//
// The wrappers therefore enter the night through menu_select and start the
// stream with the office already up. See test-menu.sh's structural half, which
// now covers every language rather than *.sh.
export const COORDS = {
  monitor: [1780, 1015],
  // Official camera-feed flash: the cam-flash/hall-flash intersection point.
  cameraFeedLight: [900, 540],
  cam10: [2045, 720],
  cam4: [1730, 710],
  cam7: [1775, 615],
  cam11: [2275, 685],
};

const ID = 102;
const lo = v => v & 0xff;
const hi = v => (v >> 8) & 0xff;
// 0x03/0x00 are contact 0 down/up; 0x07/0x04 are contact 1 down/up. Both
// records are always present so Linux consumes contact 1's release: a report
// that promises one record leaves contact 1 latched down (trap 2).
const record = (flags, point) => {
  const [x, y] = toRaw(point);
  return [flags, lo(x), hi(x), lo(y), hi(y)];
};

export function stream(spacings, { readyMs = 7000,
                                   contactMs = 33, lightLeadMs = 0,
                                   heldLight = false, lightTailMs = 50,
                                   lightAfter = false, selectMs = 33, parkMs = 1500,
                                   noLight = false, altLight = false } = {}) {
  const out = [];
  const emit = (command, extra) => out.push({ id: ID, command, ...extra });
  const report = (r) => emit('report', { report: [1, 2, ...r] });
  const delay = (duration) => emit('delay', { duration });
  // A one-contact tap still sends its own release; contact 1 stays untouched.
  // Everything single-finger goes on CONTACT 0 (the camera-park taps do), and
  // the release carries the 0x04 in contact 1's flags so Linux consumes it.
  const c0Down = (point) =>
    out.push({ id: ID, command: 'report', report: [1, 1, ...record(0x03, point), 0, 0, 0, 0, 0] });
  const c0Up = (point) =>
    out.push({ id: ID, command: 'report', report: [1, 1, ...record(0x00, point), 4, 0, 0, 0, 0] });
  const tap = (point, hold = 120) => { c0Down(point); delay(hold); c0Up(point); };

  emit('register', {
    name: 'FNAF HID sweep probe',
    vid: 6353, pid: 61959, bus: 'usb',
    descriptor: DESCRIPTOR,
  });
  // Kernel readiness is not input readiness: InputReader attaches about 5.1 s
  // after registration on this phone, and reports sent before that are lost.
  // The night is already running: the wrapper selected it through menu.sh and
  // verified the office is up before starting this stream.
  delay(readyMs);
  tap(COORDS.monitor);
  delay(900);
  // Park on CAM 11 before the first sweep too, not only between them. Without
  // this, sweep 1's start depends on whatever camera the monitor opened on --
  // if that is CAM 10, the first select is a no-op and camtrace reads the
  // sweep as starting on CAM 04. Every sweep now has a clean CAM 11 boundary
  // on both sides.
  tap(COORDS.cam11);
  delay(parkMs);

  for (const [sweepIdx, spacing] of spacings.entries()) {
    const cams = ['cam10', 'cam4', 'cam7'];
    // Control geometries for validating sweepcheck against false positives:
    //   noLight  -- every sweep selects the three cameras and NEVER lights
    //               them; sweepcheck must report 0 lit.
    //   altLight -- even sweeps light, odd sweeps are select-only; sweepcheck
    //               must catch exactly the odd ones.
    const dark = noLight || (altLight && sweepIdx % 2 === 1);
    for (let k = 0; k < cams.length; k++) {
      const cam = cams[k];
      if (dark) {
        c0Down(COORDS[cam]); delay(selectMs); c0Up(COORDS[cam]);
        delay(Math.max(1, spacing - selectMs));
        continue;
      }
      // lightAfter: the select and the light are fully separate reports. The
      // map button is a Click (`viewing` written on RELEASE, g22); the light
      // registers on PRESS (g82). Sending them together attributes each light
      // pulse to the PREVIOUS camera -- the "CAM 07 has the same light as CAM
      // 04, no gap" symptom. So: select down, hold `selectMs`, select up (Click
      // fires, viewing = N), THEN light down on the now-settled feed, hold
      // `contactMs`, light up. Every camera's light lands on the right feed.
      if (lightAfter) {
        // Both the select and the light are single-finger, so BOTH go on
        // contact 0 (well-formed count-1 reports, release consumed) -- the
        // camera-park taps prove that geometry. The c33 LIGHT_AFTER run that
        // lit nothing sent the select on contact 1 with a zeroed contact 0,
        // which the game did not read.
        c0Down(COORDS[cam]); delay(selectMs); c0Up(COORDS[cam]); // select Click -> viewing = N
        delay(17);                                              // one frame to settle
        c0Down(COORDS.cameraFeedLight); delay(contactMs); c0Up(COORDS.cameraFeedLight);
        delay(Math.max(1, spacing - selectMs - 17 - contactMs));
        continue;
      }
      // heldLight: contact 0 (the camera light) goes down at the first select
      // and stays down across the sweep -- and, critically, `lightTailMs` PAST
      // the last camera's release. The map buttons are a Fusion Click
      // (down-then-up, `viewing` is written on the RELEASE, g22), and the
      // flashlight (g82) needs a held frame AT that `viewing`. Every camera but
      // the last gets those frames free because the held light carries into
      // the next select; the last one has nothing after it, so without a tail
      // `viewing == lastCam` and "light held" never coincide -- which is
      // exactly the CAM 07 dark-last symptom the c33 probe showed.
      if (heldLight) {
        report([...record(0x03, COORDS.cameraFeedLight), ...record(0x07, COORDS[cam])]);
        delay(contactMs);
        if (k === cams.length - 1) {
          report([...record(0x03, COORDS.cameraFeedLight), ...record(0x04, COORDS[cam])]); // cam up, light HELD
          delay(lightTailMs);
          report([...record(0x00, COORDS.cameraFeedLight), 0, 0, 0, 0, 0]);                // light up alone
        } else {
          report([...record(0x03, COORDS.cameraFeedLight), ...record(0x04, COORDS[cam])]);
        }
        delay(Math.max(1, spacing - contactMs));
        continue;
      }
      // A lead puts the light down *inside* the select, which costs the light
      // exactly that much of its own contact: the active 100 ms spacing leaves
      // 67 ms released after the 33 ms contact. The runner ships a
      // zero lead for that reason and this defaults to it; the old 10 ms form
      // is kept reachable so the recordings taken under it stay reproducible.
      if (lightLeadMs > 0) {
        report([...record(0x00, COORDS.cameraFeedLight), ...record(0x07, COORDS[cam])]);
        delay(lightLeadMs);
      }
      report([...record(0x03, COORDS.cameraFeedLight), ...record(0x07, COORDS[cam])]);
      delay(contactMs - lightLeadMs);
      if (k === cams.length - 1 && lightTailMs > 0) {
        // Same lesson as HELD_LIGHT: on cameras 1..n-1 the NEXT select's
        // contact keeps the light down while this camera's Click has already
        // set `viewing`, so they light for free. The last camera has no next
        // select -- so release the SELECT here (Click completes, viewing = N)
        // and hold the light `lightTailMs` longer before lifting it.
        report([...record(0x03, COORDS.cameraFeedLight), ...record(0x04, COORDS[cam])]); // select up, light held
        delay(lightTailMs);
        report([...record(0x00, COORDS.cameraFeedLight), 0, 0, 0, 0, 0]);                // light up alone
      } else {
        report([...record(0x00, COORDS.cameraFeedLight), ...record(0x04, COORDS[cam])]);
      }
      delay(Math.max(1, spacing - contactMs));
    }
    // camtrace.py reads a sweep as 10 -> 04 -> 07 -> 11, so park on the box
    // camera between spacings and leave it there long enough to be stable.
    tap(COORDS.cam11);
    delay(parkMs);
  }
  return out;
}

const DESCRIPTOR = [5,13,9,4,161,1,133,1,9,34,161,0,9,85,21,0,37,2,117,8,149,1,177,2,9,84,129,2,
  5,13,9,34,161,2,9,66,21,0,37,1,117,1,129,2,9,50,129,2,9,81,37,63,117,6,129,2,
  5,1,9,48,38,95,9,117,16,129,2,9,49,38,55,4,129,2,192,
  5,13,9,34,161,2,9,66,21,0,37,1,117,1,129,2,9,50,129,2,9,81,37,63,117,6,129,2,
  5,1,9,48,38,95,9,117,16,129,2,9,49,38,55,4,129,2,192,192,192];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const contactMs = Number(process.env.CONTACT_MS || 33);
  if (!Number.isInteger(contactMs) || contactMs < 10 || contactMs > 200)
    throw new Error('CONTACT_MS must be an integer between 10 and 200');
  const spacings = process.argv.slice(2).map(Number);
  // This is a probe: its job is to find where the phone stops accepting input,
  // so it imposes almost nothing. One 60 fps frame (17 ms) is the floor a
  // contact or a gap could possibly mean something at; spacing == contact
  // (zero released gap, back-to-back selects) is a legitimate thing to test.
  if (spacings.some(v => !Number.isInteger(v) || v < 17 || v > 500))
    throw new Error('spacings must be integers between 17 (one frame) and 500 ms');
  const darkOnly = process.env.NO_LIGHT === '1';
  const selectMsArg = Number(process.env.SELECT_MS || 33);
  if (darkOnly) {
    // No light contact at all -- the only per-camera cost is the select.
    if (spacings.some(v => v < selectMsArg))
      throw new Error(`NO_LIGHT still needs spacing >= SELECT_MS (${selectMsArg})`);
  } else if (spacings.some(v => v < contactMs)) {
    throw new Error(`each spacing must be >= CONTACT_MS (${contactMs}); a spacing ` +
      'below the contact would overlap the next select into this one');
  }
  if (process.env.LIGHT_AFTER === '1' && !darkOnly) {
    const per = selectMsArg + 17 + contactMs;
    // altLight's dark sweeps only cost SELECT_MS; its lit sweeps still need
    // the full budget, so the check stays.
    if (spacings.some(v => v < per))
      throw new Error(`LIGHT_AFTER needs spacing >= SELECT_MS + 17 + CONTACT_MS (${per}); ` +
        'the select and the light are separate now, so the camera costs more time');
  }
  const lightLeadMs = Number(process.env.LIGHT_LEAD_MS || 0);
  if (!Number.isInteger(lightLeadMs) || lightLeadMs < 0 || lightLeadMs >= contactMs)
    throw new Error('LIGHT_LEAD_MS must be an integer in [0, CONTACT_MS)');
  const heldLight = process.env.HELD_LIGHT === '1';
  const lightTailMs = Number(process.env.LIGHT_TAIL_MS || 50);
  if (!Number.isInteger(lightTailMs) || lightTailMs < 0 || lightTailMs > 300)
    throw new Error('LIGHT_TAIL_MS must be an integer in [0, 300]');
  const lightAfter = process.env.LIGHT_AFTER === '1';
  const selectMs = Number(process.env.SELECT_MS || 33);
  if (!Number.isInteger(selectMs) || selectMs < 10 || selectMs > 200)
    throw new Error('SELECT_MS must be an integer between 10 and 200');
  const parkMs = Number(process.env.PARK_MS || 1500);
  if (!Number.isInteger(parkMs) || parkMs < 400 || parkMs > 4000)
    throw new Error('PARK_MS must be an integer between 400 and 4000 (camtrace needs a stable CAM 11 to split sweeps)');
  const noLight = process.env.NO_LIGHT === '1';
  const altLight = process.env.ALT_LIGHT === '1';
  if (noLight && altLight) throw new Error('NO_LIGHT and ALT_LIGHT are mutually exclusive');
  if (heldLight && lightLeadMs > 0)
    throw new Error('HELD_LIGHT holds contact 0 across the sweep; LIGHT_LEAD_MS does not apply');
  for (const event of stream(spacings.length ? spacings : [240, 160, 120, 100],
                             { contactMs, lightLeadMs, heldLight, lightTailMs, lightAfter, selectMs, parkMs, noLight, altLight }))
    console.log(JSON.stringify(event));
}
