#!/usr/bin/env node
/**
 * Pull one whole native frame from the Companion's projection as a PNG.
 *
 *   native-frame.mjs --out FRAME.png [--label NAME]
 *
 * The frame is the projection's own 2400x1080 image, so the calibrated PNG
 * readers (title-observe.py, fnaf1-custom-night-read.py, sensor.open_frame)
 * read it unchanged. It replaces the full-display screencap for screens where
 * latency does not matter; a night reads native regions instead
 * (native-regions.mjs). Run under the serial lease.
 */
import { AdbCompanionPort } from '../../packages/play/src/campaign/physical-ports.js';
import { resolveSerial } from './local-profile.mjs';

function fail(message) { console.error(`native-frame: ${message}`); process.exit(2); }

const argv = process.argv.slice(2);
let out = null;
let label = `snap-${Date.now()}`;
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--out') out = argv[++i];
  else if (argv[i] === '--label') label = argv[++i];
  else fail(`unknown flag ${argv[i]}`);
}
if (!out) fail('--out is required');
if (process.env.FNAF_LEASE_HELD !== '1' && process.env.FNAF1_LEASE_HELD !== '1') fail('run under the serial lease');
let serial;
try { ({ serial } = resolveSerial()); } catch (error) { fail(error.message); }
const port = new AdbCompanionPort({ serial });
port.snap(label, out).then((r) => {
  console.log(JSON.stringify({ out: r.path, bytes: r.bytes, imageNs: String(r.imageNs), snapshotNs: String(r.snapshotNs) }));
}).catch((error) => fail(error.message));
