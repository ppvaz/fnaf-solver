#!/usr/bin/env node
// No file in the repository names the handset's serial, outside the frozen set
// and the allowlist below.
//
// Pedro, 2026-09-29 (ADR 0002, decision 8): the serial is "read from an
// untracked local profile with no default; a gate refuses new occurrences;
// frozen evidence keeps it; no history rewrite." Until that day 18 scripts
// defaulted to one handset's serial, so a run on any host addressed that phone
// by name and every checkout published it. The runners now read FNAF_SERIAL or
// tools/device/local-profile.json (gitignored; packages/play/bin/phone/local-profile.ts).
//
// Scanned: every tracked file, plus untracked files git does not ignore, so a
// new file is refused before it is committed (tools/test-docs.ts does the
// same). Not scanned: the frozen set, whose records keep the serial they were
// written with. Allowlisted: the records below, each with its reason and its
// exact count, so an allowlisted file cannot gain an occurrence either; an
// entry whose count no longer matches fails too, so the list only shrinks
// deliberately. It also checks that the local profile is ignored and untracked.
//
//   node tools/test-no-serial.ts        exit 0 clean, 1 with the files it refuses
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The concrete serial of the campaign handset, assembled so this file does not
// itself carry it.
const SERIAL = ['ZF525', 'F5BH5'].join('');
// The same handset's Bluetooth address (the A2DP capture's target), assembled the same way. Code reads it from
// FNAF_BT_MAC or the local profile's btMac (local-profile.ts); no record pins it, so nothing outside the frozen set
// may name it, in either case.
const BT_MAC = ['10:2B:1C', ':DA:18:2C'].join('');
const PROFILE = 'tools/device/local-profile.json';

// Records frozen byte for byte (CLAUDE.md, ADR 0002): never edited, never scanned.
export const FROZEN = [
  /^docs\/evidence\//,
  /^docs\/chronicle\//,
  /^tools\/recompile\/results\//,
  /^plans\/archive\//,
  /^packages\/propose\/bindings\/[^/]+\/[^/]+-winner\.json$/,
];

const HASH_BOUND = 'calibration record pinned by sha256';
const MEASURED = 'calibration record: its device block names the handset it was measured on (Truth, ADR 0002)';
// Path -> [occurrences, reason]. Each is a measurement or calibration record
// whose device field names the handset measured, not a default any code reads.
export const ALLOWLIST: Readonly<Record<string, readonly [number, string]>> = {
  'docs/device/accessibility-game-acceptance-20260906.json': [1, 'retained 2026-09-06 measurement record (ACCESSIBILITY-VS-HID-BENCHMARK.md); its device block names the handset measured'],
  'docs/device/accessibility-hid-pilot-20260906.json': [1, 'retained 2026-09-06 measurement record (ACCESSIBILITY-VS-HID-BENCHMARK.md); its device block names the handset measured'],
  'packages/play/profiles/fnaf1/moto-g56/controls-fnaf1-moto-g56-v207.json': [1, `${HASH_BOUND} in fnaf1-custom-night7-420-grid420-winner.json and a run pack's probe.json`],
  'packages/play/profiles/fnaf3/moto-g56/controls-fnaf3-moto-g56-v204.json': [1, MEASURED],
  'packages/play/profiles/fnaf4/moto-g56/controls-fnaf4-moto-g56-v204.json': [1, `${HASH_BOUND} in fnaf4-night3-loop-winner.json`],
  'packages/play/profiles/fnaf2/moto-g56/custom-night-calibration-v1.json': [1, `${HASH_BOUND} in docs/evidence/night7-corner2-bbfoxy-predeclaration-20260927.json`],
  'packages/play/profiles/fnaf1/moto-g56/custom-night-fnaf1-moto-g56-v207.json': [1, `${HASH_BOUND} in fnaf1-custom-night7-420-grid420-winner.json and a run pack's probe.json`],
  'packages/play/profiles/fnaf2/moto-g56/custom-night-moto-g56-v207.json': [1, `${HASH_BOUND} in docs/evidence/night7-preset-population-20260925.json`],
  'packages/play/profiles/fnaf1/moto-g56/fnaf1-community-loop-moto-g56-v207.json': [1, MEASURED],
  'packages/play/profiles/fnaf1/moto-g56/fnaf1-device-timing-moto-g56-v207.json': [1, `${HASH_BOUND} in fnaf1-custom-night7-420-grid420-winner.json and three docs/evidence populations`],
  'packages/play/profiles/fnaf1/moto-g56/regions-fnaf1-moto-g56-v207.json': [1, `${HASH_BOUND} in fnaf1-custom-night7-420-grid420-winner.json and a run pack's probe.json`],
  'packages/play/profiles/fnaf3/moto-g56/regions-fnaf3-moto-g56-v204.json': [1, MEASURED],
  'packages/play/profiles/fnaf4/moto-g56/regions-fnaf4-moto-g56-v204.json': [1, `${HASH_BOUND} in fnaf4-night3-loop-winner.json`],
  'packages/play/profiles/fnaf1/moto-g56/teach-panel-fnaf1-moto-g56-v207.json': [1, MEASURED],
};

const count = (buffer: Buffer, needle: Buffer) => {
  let n = 0;
  for (let at = buffer.indexOf(needle); at !== -1; at = buffer.indexOf(needle, at + needle.length)) n += 1;
  return n;
};

const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
const needle = Buffer.from(SERIAL);
const macNeedles = [Buffer.from(BT_MAC), Buffer.from(BT_MAC.toLowerCase())];
const refused = [];
const allowlisted = [];
let frozen = 0;
let scanned = 0;
for (const file of [...new Set(files)].sort()) {
  if (FROZEN.some((pattern) => pattern.test(file))) { frozen += 1; continue; }
  const path = join(ROOT, file);
  if (!existsSync(path) || !statSync(path).isFile()) continue;   // deleted in the working tree
  scanned += 1;
  const bytes = readFileSync(path);
  const found = count(bytes, needle);
  const macs = macNeedles.reduce((sum, mac) => sum + count(bytes, mac), 0);
  if (macs) refused.push(`${file}: names the phone's Bluetooth address ${macs} time(s)`);
  const allowed = ALLOWLIST[file];
  if (allowed && found === allowed[0]) allowlisted.push(file);
  else if (allowed) refused.push(`${file}: ${found} occurrence(s), allowlisted at ${allowed[0]} -- update the entry only if a record changed`);
  else if (found) refused.push(`${file}: ${found} occurrence(s)`);
}
for (const file of Object.keys(ALLOWLIST))
  if (!files.includes(file)) refused.push(`${file}: allowlisted but not in the repository -- remove the entry`);

const problems = [];
try { git(['check-ignore', '-q', '--no-index', PROFILE]); } catch { problems.push(`${PROFILE} is not ignored by .gitignore`); }
if (git(['ls-files', '--', PROFILE]).trim()) problems.push(`${PROFILE} is tracked: remove it from the index (git rm --cached), never commit it`);

if (refused.length || problems.length) {
  console.error(`no-serial: FAILED -- the handset serial and Bluetooth address must come from FNAF_SERIAL/FNAF_BT_MAC or ${PROFILE}, never a tracked file.`);
  if (refused.length) {
    console.error('Files that name it (use <serial> in docs, a fake such as FAKE0001 in fixtures, and '
      + 'packages/play/bin/phone/local-profile.ts in code):');
    for (const line of refused) console.error(`  ${line}`);
  }
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`no-serial: ${scanned} files scanned, none names the handset serial or Bluetooth address; ${frozen} frozen files not scanned, `
  + `${allowlisted.length} allowlisted records at their counts; ${PROFILE} is ignored and untracked`);
