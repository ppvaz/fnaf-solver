// Static regression for the two-contact UHID fixture. This catches the subtle
// failure where Android displays two dots but contact 1 never receives an up:
// an inactive second record must still be included in a count=2 packet.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, 'testdata', 'hid-multitouch-smoke.json');
const text = readFileSync(fixture, 'utf8').replace(/^\s*\/\/.*$/gm, '');
const events = [...text.matchAll(/\{[^{}]*\}/gs)].map(match => JSON.parse(match[0]));

function check(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
}

check(events[0]?.command === 'register', 'fixture must register HID first');
check(events[1]?.command === 'delay' && events[1].duration >= 6000,
  'fixture must wait for framework-level input attachment');

const reports = events.filter(event => event.command === 'report').map(event => event.report);
for (const report of reports) {
  check(Array.isArray(report) && report.length === 12 && report[0] === 1,
    'every report must be a 12-byte report-ID-1 packet');
  check(report[1] >= 0 && report[1] <= 2, 'contact count must fit the descriptor');
}

const LIGHT = '1033,157';
const EXPECTED_CAMS = ['800,920', '822,778', '1033,798'];
const active = new Map();
const cameraDowns = [];
let cameraUps = 0;
let completedSweep = false;

for (const report of reports) {
  const count = report[1];
  if (count === 0) {
    active.clear();
    continue;
  }

  const records = [report.slice(2, 7), report.slice(7, 12)];
  const beforeSecond = active.has(1);
  let consumedInactiveSecond = false;
  for (const record of records.slice(0, count)) {
    const flags = record[0];
    const id = flags >> 2;
    const down = (flags & 1) !== 0;
    const xy = `${record[1] | (record[2] << 8)},${record[3] | (record[4] << 8)}`;
    if (down) active.set(id, xy);
    else {
      active.delete(id);
      if (id === 1) consumedInactiveSecond = true;
    }
  }

  if (!beforeSecond && active.has(1) && active.get(0) === LIGHT) {
    cameraDowns.push(active.get(1));
  }
  if (beforeSecond && !active.has(1)) {
    cameraUps++;
    check(count === 2 && consumedInactiveSecond,
      'contact 1 up must be an explicitly consumed inactive record');
  }
  if (cameraDowns.length === 3 && !active.has(0) && !active.has(1)) {
    completedSweep = true;
    break;
  }
}

check(JSON.stringify(cameraDowns) === JSON.stringify(EXPECTED_CAMS),
  `expected fresh CAM 10/04/07 downs, got ${cameraDowns.join(' -> ')}`);
check(cameraUps === 3, `expected three explicit contact-1 ups, got ${cameraUps}`);
check(completedSweep, 'fixture must explicitly release both contacts after the sweep');

console.log('HID report checks passed');
