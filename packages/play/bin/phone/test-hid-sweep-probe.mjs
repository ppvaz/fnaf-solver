// No-device regression for the sweep probe's report stream: the trap-2
// contact discipline, the pulsed (not held) light, and the requested spacing.
import { stream, COORDS, toRaw } from './hid-sweep-probe.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };
const key = (point) => toRaw(point).join(',');

const SPACINGS = [240, 160, 120, 100];
const events = stream(SPACINGS);   // the shipped geometry: no light lead
check(events[0].command === 'register', 'must register first');
check(events[1].command === 'delay' && events[1].duration >= 6000,
  'must wait for framework-level input attachment, not just UHID open');

for (const event of events.filter(e => e.command === 'report'))
  check(event.report.length === 12 && event.report[0] === 1 && event.report[1] <= 2,
    'every report must be a 12-byte report-ID-1 packet within the descriptor');

// Walk the stream on a virtual clock and record what the light and the
// selected camera are doing.
let t = 0, lightDown = null, camDown = null;
const selections = [];   // [camKey, downMs]
const lightPulses = [];  // [downMs, upMs, camKeyAtDown]
for (const event of events) {
  if (event.command === 'delay') { t += event.duration; continue; }
  if (event.command !== 'report') continue;
  const count = event.report[1];
  const records = [event.report.slice(2, 7), event.report.slice(7, 12)].slice(0, count);
  for (const r of records) {
    const id = r[0] >> 2, down = (r[0] & 1) !== 0;
    const xy = `${r[1] | (r[2] << 8)},${r[3] | (r[4] << 8)}`;
    if (id === 0) {
      if (down && lightDown === null) lightDown = [t, xy];
      if (!down && lightDown !== null) { lightPulses.push([lightDown[0], t, camDown, lightDown[1]]); lightDown = null; }
    } else {
      if (down && camDown === null) { camDown = xy; selections.push([xy, t]); }
      else if (!down) camDown = null;
    }
  }
}
check(lightDown === null && camDown === null, 'both contacts must end released');

const wanted = [COORDS.cam10, COORDS.cam4, COORDS.cam7].map(key);
check(selections.length === SPACINGS.length * 3,
  `expected ${SPACINGS.length * 3} camera selections, got ${selections.length}`);
for (const [i, [xy]] of selections.entries())
  check(xy === wanted[i % 3], `selection ${i} should be ${wanted[i % 3]}, got ${xy}`);

for (const [i, spacing] of SPACINGS.entries()) {
  const [a, b, c] = selections.slice(i * 3, i * 3 + 3).map(([, at]) => at);
  check(b - a === spacing && c - b === spacing,
    `sweep ${i} must space selections ${spacing} ms apart, got ${b - a} and ${c - b}`);
}

// Contact 0 also carries the plain taps the probe makes inside the office.
//
// The night is NOT among them any more. Selecting one was a sixth copy of the
// title selection, in the only language test-menu.sh could not see, tapped
// blind as the stream's first report. hid-sweep-probe.sh now enters through
// menu_select and confirms a night started before a report goes out, so this
// asserts the stream contains no title tap at all -- the strongest form of the
// property, since a reintroduced one would have to appear here.
const menuTaps = lightPulses.filter(([, , , xy]) => xy !== key(COORDS.cameraFeedLight));
check(menuTaps.map(([, , , xy]) => xy).join(' ') ===
  // monitor raise, then a CAM 11 park BEFORE the first sweep and one after each
  [COORDS.monitor, ...Array(SPACINGS.length + 1).fill(COORDS.cam11)].map(key).join(' '),
  'the probe must raise the monitor and park on CAM 11 before the first sweep ' +
  'and after each, and must not select a night itself -- that is menu_select\'s job');
check(!('sixth' in COORDS),
  'COORDS must not carry a title coordinate; menu.sh owns night selection');
const litPulses = lightPulses.filter(([, , , xy]) => xy === key(COORDS.cameraFeedLight));
check(litPulses.length === SPACINGS.length * 3,
  'the light must be pulsed once per selection, not held across the sweep');
for (const [, , cam] of litPulses)
  // cam is null only for the deliberate tail on the last selection, where the
  // select's Click has already completed and `viewing` is held.
  check(cam === null || wanted.includes(cam),
    'the light must only be on while a target camera is selected (or its tail)');

// The first two selections of each sweep get a plain 33 ms pulse (light and
// select released together -- the next select keeps `viewing` covered). The
// LAST selection holds the light `lightTailMs` (default 50) past its own Click
// release, because there is no next select to cover it -- the CAM 07-dark-last
// fix. Device-confirmed 2026-08-27: with the tail, every camera lights.
for (let s = 0; s < SPACINGS.length; s++) {
  const [p10, p04, p07] = litPulses.slice(s * 3, s * 3 + 3);
  check(p10[1] - p10[0] === 33 && p04[1] - p04[0] === 33,
    `sweep ${s}: the first two pulses must be a plain 33 ms, got ${p10[1] - p10[0]}/${p04[1] - p04[0]}`);
  check(p07[1] - p07[0] === 83,
    `sweep ${s}: the last pulse must be 33 ms contact + 50 ms tail = 83, got ${p07[1] - p07[0]}`);
}
// The 10 ms lead stays reachable so recordings taken under it stay
// reproducible, and it must still be the shorter pulse it always was.
const led = stream([120], { lightLeadMs: 10, lightTailMs: 0, contactMs: 100 });
let lt = 0, ldown = null, ledPulses = [];
const [leadLightX, leadLightY] = toRaw(COORDS.cameraFeedLight);
for (const event of led) {
  if (event.command === 'delay') { lt += event.duration; continue; }
  if (event.command !== 'report') continue;
  const r = event.report.slice(2, 7);
  if ((r[0] >> 2) !== 0) continue;
  if ((r[1] | (r[2] << 8)) !== leadLightX || (r[3] | (r[4] << 8)) !== leadLightY) continue;
  if ((r[0] & 1) !== 0) { if (ldown === null) ldown = lt; }
  else if (ldown !== null) { ledPulses.push(lt - ldown); ldown = null; }
}
check(ledPulses.filter(d => d === 90).length === 3,
  `a 10 ms lead must leave three 90 ms pulses, got ${ledPulses.join('/')}`);
// The point of the pulse: bounded light per camera instead of a hold that
// would outspend night 6's 3000-frame flashlight. The budget is three
// 33 ms contacts plus the one last-camera tail: 149 ms.
const litMs = litPulses.reduce((sum, [down, up]) => sum + (up - down), 0) / SPACINGS.length;
const budget = 3 * 33 + 50;   // three 33 ms contacts + a 50 ms tail
check(litMs <= budget, `a sweep must draw at most ${budget} ms of light, got ${litMs}`);

// HELD_LIGHT mode (plans/17): contact 0 goes down at the first select and
// stays down until the last camera's release, so the light spans the whole
// sweep instead of pulsing per camera. The c33 probe showed 33 ms selects
// land but the third camera's pulsed light loses its edge -- holding removes
// the edges.
{
  const held = stream([66], { contactMs: 33, heldLight: true });
  let ht = 0, hLightDown = null, hSelections = [], hLightSpan = null;
  for (const event of held) {
    if (event.command === 'delay') { ht += event.duration; continue; }
    if (event.command !== 'report') continue;
    const count = event.report[1];
    const recs = [event.report.slice(2, 7), event.report.slice(7, 12)].slice(0, count);
    for (const r of recs) {
      const id = r[0] >> 2, down = (r[0] & 1) !== 0;
      const xy = `${r[1] | (r[2] << 8)},${r[3] | (r[4] << 8)}`;
      if (id === 0 && xy === key(COORDS.cameraFeedLight)) {
        if (down && hLightDown === null) hLightDown = ht;
        if (!down && hLightDown !== null) { hLightSpan = ht - hLightDown; hLightDown = null; }
      } else if (id === 1 && down && wanted.includes(xy)) hSelections.push(xy);
    }
  }
  check(hSelections.join(' ') === wanted.join(' '),
    `held-light sweep must still select 10,4,7 in order, got ${hSelections.join(' ')}`);
  // one continuous span, not three pulses: 3*33 contact + 2*33 gap = 165, plus
  // the 50 ms tail that keeps the light held past CAM 07's click release so
  // `viewing == 7` and "light held" coincide for a few frames.
  check(hLightSpan === 215,
    `held light must be one continuous span = 165 sweep + 50 tail = 215 ms, got ${hLightSpan}`);
  // that tail must sit AFTER the last select's release, not before it
  const heldTail = stream([66], { contactMs: 33, heldLight: true, lightTailMs: 0 });
  let tt = 0, tLightUp = null, tLastSelUp = null;
  for (const event of heldTail) {
    if (event.command === 'delay') { tt += event.duration; continue; }
    if (event.command !== 'report') continue;
    const recs = [event.report.slice(2, 7), event.report.slice(7, 12)].slice(0, event.report[1]);
    for (const r of recs) {
      const id = r[0] >> 2, down = (r[0] & 1) !== 0;
      const xy = `${r[1] | (r[2] << 8)},${r[3] | (r[4] << 8)}`;
      if (id === 0 && xy === key(COORDS.cameraFeedLight) && !down) tLightUp = tt;
      if (id === 1 && !down && wanted.includes(xy)) tLastSelUp = tt;
    }
  }
  check(tLightUp !== null && tLastSelUp !== null && tLightUp >= tLastSelUp,
    `even at tail 0 the light must release no earlier than the last select (light ${tLightUp}, select ${tLastSelUp})`);
}

// LIGHT_AFTER mode (plans/17): the select and the light are separate reports,
// and every light-down comes AFTER its own select-up so it lands on the
// settled feed. Working theory for the "each light renders on the previous
// camera" symptom -- the map button is a Click (viewing on release) but the
// flashlight registers on press.
{
  const la = stream([120], { lightAfter: true, selectMs: 25, contactMs: 40 });
  let t = 0, events = [];
  for (const e of la) {
    if (e.command === 'delay') { t += e.duration; continue; }
    if (e.command !== 'report') continue;
    // Single-finger reports: contact 0 slot (bytes 2-6) carries the flags and
    // point; the release also sets byte 7 to 0x04 so Linux consumes contact 1.
    const flags = e.report[2];
    const down = (flags & 1) !== 0;
    const xy = `${e.report[3] | (e.report[4] << 8)},${e.report[5] | (e.report[6] << 8)}`;
    events.push({ t, down, xy, count: e.report[1] });
  }
  // Every LIGHT_AFTER report is a single-contact report (count 1) on contact 0
  // -- that is the geometry the camera-park taps use and the c33 run that lit
  // nothing did NOT (it put the select on contact 1 with a zeroed contact 0).
  for (const e of la.filter(x => x.command === 'report'))
    check(e.report[1] === 1, `LIGHT_AFTER reports must be single-contact, got count ${e.report[1]}`);
  const key2 = ([x, y]) => `${x},${y}`;
  for (const cam of ['cam10', 'cam4', 'cam7']) {
    const camXY = key(COORDS[cam]);
    const selDown = events.find(e => e.down && e.xy === camXY);
    const selUp = events.find(e => !e.down && e.xy === camXY && e.t >= (selDown?.t ?? 0));
    const lightDown = events.find(e => e.down && e.xy === key(COORDS.cameraFeedLight) && e.t > (selUp?.t ?? 0));
    check(selDown && selUp && lightDown,
      `LIGHT_AFTER ${cam}: expected select-down, select-up, then a light-down`);
    check(lightDown.t > selUp.t,
      `LIGHT_AFTER ${cam}: the light must go down strictly after the select's Click completes`);
  }
}

console.log(`HID sweep probe checks passed (${SPACINGS.join('/')} ms spacings, ${litMs} ms lit per sweep)`);

// NO_LIGHT / altLight -- the controls for sweepcheck false positives. NO_LIGHT
// selects the three cameras and never lights them; altLight lights only even
// sweeps. A frame walk must find zero light-coordinate presses in a dark sweep.
{
  const isLight = r => r[2] % 2 === 1
    && (r[3] | (r[4] << 8)) === toRaw(COORDS.cameraFeedLight)[0]
    && (r[5] | (r[6] << 8)) === toRaw(COORDS.cameraFeedLight)[1];
  const camKeys = [COORDS.cam10, COORDS.cam4, COORDS.cam7].map(key);
  const isTargetSelDown = r => r[2] === 3
    && camKeys.includes(`${r[3] | (r[4] << 8)},${r[5] | (r[6] << 8)}`);
  const dark = stream([90, 90], { lightAfter: true, selectMs: 17, contactMs: 33, noLight: true });
  check(dark.filter(e => e.command === 'report' && isLight(e.report)).length === 0,
    'NO_LIGHT must emit no light-coordinate press at all');
  check(dark.filter(e => e.command === 'report' && isTargetSelDown(e.report)).length === 6,
    'NO_LIGHT must still select all three cameras on both sweeps');

  const alt = stream([90, 90, 90, 90], { lightAfter: true, selectMs: 17, contactMs: 33, altLight: true });
  // split the report stream into sweeps at each CAM 11 park
  let sweep = -1, perSweepLights = [];
  for (const e of alt) {
    if (e.command !== 'report') continue;
    const xy = `${e.report[3] | (e.report[4] << 8)},${e.report[5] | (e.report[6] << 8)}`;
    if (e.report[2] === 3 && xy === `${toRaw(COORDS.cam10)[0]},${toRaw(COORDS.cam10)[1]}`) {
      sweep++; perSweepLights[sweep] = 0;
    }
    if (isLight(e.report) && e.report[2] === 3 && sweep >= 0) perSweepLights[sweep]++;
  }
  check(JSON.stringify(perSweepLights) === JSON.stringify([3, 0, 3, 0]),
    `altLight must light even sweeps only, got ${JSON.stringify(perSweepLights)}`);
}
