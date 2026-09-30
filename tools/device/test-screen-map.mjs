// One screen->raw transform, held to one answer wherever it is written.
//
// `rawX = (1080 - screenY) * 20 / 9, rawY = screenX * 9 / 20`, truncated. It was
// once written four times -- shell (the legacy runner), Python (desync-scan.py),
// JS twice -- and the copies disagreed on four of the thirteen real taps (cam11
// 878 vs 877, mute 2227 vs 2226, newGame 778 vs 777, continue 978 vs 977): the
// probe that measured what the phone accepts sent a coordinate the runner never
// sent. The shell and Python copies left with the legacy lane on 2026-09-25 and
// hid-sweep-probe.mjs now re-exports the transport's function, so two remain:
//
//   packages/play/src/venues/phone/hid.js    Math.floor   the campaign executor
//   android/.../NightRunner.java              int /        the Companion's runner
//
// The transport is the authority: it is what presses the phone.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toRaw } from '@sixam/play/venues/phone/hid';
import { toRaw as probeToRaw, COORDS } from './hid-sweep-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
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

// The Companion's copy is Java int arithmetic, which truncates like Math.floor
// for these non-negative operands. Hold its text to the one expression, and
// evaluate that expression's semantics over every real tap.
const java = readFileSync(join(ROOT, 'android/companion/src/com/ppvaz/fnafcompanion/NightRunner.java'), 'utf8');
if (!/int rawX = \(1080 - point\.y\) \* 20 \/ 9;/.test(java) || !/int rawY = point\.x \* 9 \/ 20;/.test(java))
  complain('NightRunner.java no longer computes rawX = (1080 - y) * 20 / 9, rawY = x * 9 / 20');
const javaInt = (x, y) => [Math.trunc((1080 - y) * 20 / 9), Math.trunc(x * 9 / 20)];

let compared = 0;
for (const [name, point] of taps) {
  const js = toRaw(point);
  const jv = javaInt(...point);
  compared += 1;
  if (js[0] !== jv[0] || js[1] !== jv[1])
    complain(`${name} ${JSON.stringify(point)} maps two ways: transport=${JSON.stringify(js)} ` +
      `java=${JSON.stringify(jv)}. The transport is the authority -- it is what presses the phone.`);
}

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
console.log(`screen map: ${compared} taps agree between the transport and the Companion, ` +
  'the probe re-exports the transport, and the transform truncates');
