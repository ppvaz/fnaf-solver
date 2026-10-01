#!/usr/bin/env node
// Writes, or checks, the HID controls file of a bundle directory from the
// profile.json beside it (hidControlsText, the transport's own transform). A
// bundle compiled since 2026-09-30 carries the file already; the Companion's
// committed route bundles (android/companion/assets/runners) predate it, and
// its runner now reads the file instead of a control map of its own. The file
// is derived from bytes already in the directory, so adding it changes nothing
// else there.
//
//   node packages/play/bin/companion/hid-controls.ts DIR...          write DIR/hid-controls.txt
//   node packages/play/bin/companion/hid-controls.ts --check DIR...  exit 1 unless each is current
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HID_CONTROLS_FILE, hidControlsText } from '@sixam/play/venues/phone/hid';

const args = process.argv.slice(2);
const check = args.includes('--check');
const dirs = args.filter(arg => arg !== '--check');
if (!dirs.length) {
  console.error('usage: hid-controls.ts [--check] BUNDLE_DIR...');
  process.exit(2);
}
let stale = 0;
for (const dir of dirs) {
  const profileText = readFileSync(join(dir, 'profile.json'), 'utf8');
  const want = hidControlsText(JSON.parse(profileText), createHash('sha256').update(profileText).digest('hex'));
  const path = join(dir, HID_CONTROLS_FILE);
  const have = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (have === want) { console.log(`${path}: current`); continue; }
  if (check) { console.error(`${path}: ${have === null ? 'missing' : 'stale'}; run without --check to write it`); stale += 1; continue; }
  writeFileSync(path, want);
  console.log(`${path}: written`);
}
process.exit(stale ? 1 : 0);
