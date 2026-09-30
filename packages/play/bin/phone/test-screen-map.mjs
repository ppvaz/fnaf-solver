// One screen->raw transform, held to one answer wherever it is written.
//
// `rawX = (1080 - screenY) * 20 / 9, rawY = screenX * 9 / 20`, truncated. It was
// once written four times -- shell (the legacy runner), Python (desync-scan.py),
// JS twice -- and the copies disagreed on four of the thirteen real taps (cam11
// 878 vs 877, mute 2227 vs 2226, newGame 778 vs 777, continue 978 vs 977): the
// probe that measured what the phone accepts sent a coordinate the runner never
// sent. The shell and Python copies left with the legacy lane on 2026-09-25 and
// hid-sweep-probe.mjs now re-exports the transport's function. The last copy,
// NightRunner.java's (with its own control map), left on 2026-09-30: the
// Companion's runner now presses the raw points its route bundle carries in
// hid-controls.txt, which the transport derives from the bundle's profile
// (hidControlsText). One transform remains:
//
//   packages/play/src/venues/phone/hid.js    Math.floor   the campaign executor
//
// and this holds every committed Companion bundle's controls file to it.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HID_CONTROLS_FILE, hidControlsText, toRaw } from '@sixam/play/venues/phone/hid';
import { toRaw as probeToRaw, COORDS } from './hid-sweep-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
let failed = 0;
const complain = (message) => { console.error(message); failed = 1; };

// The real tap table, read from coords.sh rather than restated here -- a stub
// that drifts from the value it stands in for tests the stub -- plus the camera
// sweep coordinates the probe library carries.
const taps = new Map();
for (const line of readFileSync(join(HERE, 'coords.sh'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)="(\d+) (\d+)"/);
  if (m) taps.set(m[1], [Number(m[2]), Number(m[3])]);
}
if (taps.size < 8) complain(`only ${taps.size} taps parsed from coords.sh; the ` +
  'table format changed and this check is no longer reading it');
for (const [name, point] of Object.entries(COORDS)) taps.set(name, point);

if (probeToRaw !== toRaw)
  complain('hid-sweep-probe.mjs carries its own transform again; re-export the transport\'s');

// The Companion holds no transform and no control coordinates of its own.
const java = readFileSync(join(ROOT, 'android/companion/src/com/ppvaz/fnafcompanion/NightRunner.java'), 'utf8');
if (/\* 20 \/ 9|\* 9 \/ 20|CONTROL_MAP|new Point\(/.test(java))
  complain('NightRunner.java carries a screen transform or a control map again; it presses the points in its bundle\'s ' +
    `${HID_CONTROLS_FILE}, derived by the transport`);

// Every committed Companion route bundle carries the controls the transport
// derives from the profile beside it, bound to that profile's sha256.
const runners = join(ROOT, 'android/companion/assets/runners');
const bundles = [runners, ...readdirSync(join(runners, 'generated'), { withFileTypes: true })
  .filter(entry => entry.isDirectory()).map(entry => join(runners, 'generated', entry.name))];
let compared = 0;
for (const dir of bundles) {
  const profileText = readFileSync(join(dir, 'profile.json'), 'utf8');
  const want = hidControlsText(JSON.parse(profileText), createHash('sha256').update(profileText).digest('hex'));
  let have = null;
  try { have = readFileSync(join(dir, HID_CONTROLS_FILE), 'utf8'); } catch { /* reported below */ }
  if (have !== want)
    complain(`${dir.slice(ROOT.length + 1)}/${HID_CONTROLS_FILE} is ${have === null ? 'missing' : 'not what the transport derives from its profile'}; ` +
      `run node packages/play/bin/companion/hid-controls.mjs ${dir.slice(ROOT.length + 1)}`);
  compared += 1;
}
if (compared < 4) complain(`only ${compared} Companion route bundles found; the layout changed and this check no longer reads them`);

// The transform must also be a truncation, not a rounding, at a point where the
// two differ. Without this the check passes if every copy is changed to round
// together, which is a different transform from the one the phone has been
// calibrated against.
const halfUp = [400, 730]; // newGame: exact 777.78, floors to 777, rounds to 778
if (toRaw(halfUp)[0] !== 777)
  complain(`the transform no longer truncates: ${JSON.stringify(halfUp)} -> ` +
    `${toRaw(halfUp)[0]}, expected 777. Every device coordinate this project ` +
    'has ever pressed was truncated; changing that silently re-aims all of them.');

if (failed) process.exit(1);
console.log(`screen map: the Companion holds no transform, its ${compared} route bundles carry the controls the ` +
  `transport derives from their profiles, ${taps.size} real taps map through the one transform, the probe ` +
  're-exports it, and it truncates');
