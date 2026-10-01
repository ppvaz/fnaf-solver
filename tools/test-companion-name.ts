#!/usr/bin/env node
// The phone's app is the Companion. No file calls it the Cue Helper, except
// where that name is stored.
//
// Pedro, 2026-09-30: "anything that is still called cue helper must be
// companion instead". ADR 0002 principle 9 sets the limit: stored names never
// change. So the old spelling stays only in the names below, which something
// outside the tree reads (the installed APK, a retained record, the lease and
// queue on disk, an operator's environment), and in files whose bytes are
// frozen, hash-bound or history.
//
// Scanned: every tracked file and every untracked file git does not ignore
// (tools/test-no-serial.ts does the same), and every path's own name. A match
// of cue[ _-]?helper that is not one of the stored names is refused.
//
//   node tools/test-companion-name.ts   exit 0 clean, 1 with the lines it refuses
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'tools/test-companion-name.ts';
const OLD = /cue[ _-]?helper/i;

// Stored names, each with the reason it keeps its spelling.
export const STORED = [
  [/cue-helper-control-v1|cue-helper-overlay-qualification-v1/g, 'contract and schema ids'],
  [/com\\?\.fnaf2\\?\.cuehelper/g, 'the socket and intent-action names the installed Companion answers'],
  [/FnafCueHelper/g, 'the logcat tag the host parses, in retained logs too'],
  [/\bCUE_HELPER(?:_(?:LOCK_DIR|STATE_DIR|QUEUE_FILE|LEASE_OWNER_PID|TRANSPORT|CALIBRATION|OVERLAY_PHASE|TOKEN))?\b/g,
    'the emitted screen label, and the lease, queue and operator variables a running window or shell may set'],
  [/\bcueHelper(?:Port|TargetSdk)?\b/g, 'record keys'],
  [/cue-helper-(?:mediaprojection-2400x1080|watch-native-2400x1080|grid|detector|native-frame-trace)\b/g,
    'sensor, detector and frame-trace ids in retained records'],
  [/cue-helper-(?:capture-restart|running|endpoint|pcm|pid)\b/g, 'preflight check ids and session-record values'],
  [/captures\/cue-helper\b|\bcue-helper\/(?:calibration|models|locks|queue|soak)|['"]cue-helper['"]/g,
    'the host-wide state directory (lease, queue, models) and its path parts'],
  [/23-cue-helper-overlay-hud\.md/g, 'a plan file name: plans/ is an id namespace'],
  [/(?:@fnaf2-1020\/adapters\/)?transports\/cue-helper(?:\.js)?|(?:mcp__)?fnaf2-cue-helper/g,
    'retired paths and the retired MCP server name, cited as history'],
  [/called the Cue Helper until 2026-09-30/g, 'the glossary records the former name'],
];

// Paths not scanned, each with its reason.
export const UNSCANNED = [
  [/^docs\/evidence\/|^docs\/chronicle\/|^tools\/recompile\/results\/|^plans\/archive\/|^packages\/propose\/bindings\/[^/]+\/[^/]+-winner\.json$|^docs\/research\/ROOT-README-HISTORY\.txt$/,
    'frozen byte for byte (CLAUDE.md, ADR 0002)'],
  [/^packages\/play\/profiles\/fnaf2\/moto-g56\/(?:hid-mediaprojection(?:-17ms)?|fixture-hid-screencap)\.json$|^android\/companion\/assets\/runners\//,
    'device profiles, bound by profileSha256'],
  [/^packages\/play\/profiles\/fnaf2\/moto-g56\/(?:camera|mask|monitor)-rule-moto-g56-v207\.json$/,
    'fitted rules and calibration records pinned by sha256'],
  [/^packages\/play\/src\/sensors\/fnaf2\/button-strokes\.(?:js|ts)$|^packages\/adapters\/src\/button-strokes\.js$/,
    'full06-responses-20260928 pins its bytes as ruleSourceSha256 (test-phone-encounter-replay.mjs); the adapters path is its registered link'],
  [/^packages\/source\/recompile\/native-frame\.py$/, 'gles2-renderer and three native-frame-title records pin its sha256'],
  [/^packages\/review\/test\/legacy-session\/|^docs\/device\/[^/]+\.json$/, 'stored-format fixtures and retained device records'],
  [/^plans\/PROGRESS\.md$|^docs\/operations\/CLAUDE-HISTORY\.txt$|^docs\/portal\/(?:chronicle|story)\.html$/,
    'history, and pages generated from the frozen chronicle'],
  [/^plans\/(?:0\d|1\d|20|21|24|25|26|27|28)-|^plans\/22-architecture-/, 'dated plan prose keeps the words of its date'],
  [new RegExp(`^${SELF.replace(/[.]/g, '\\.')}$`), 'this gate names the old spelling'],
];

/** The lines of `text` that still call the app the Cue Helper once every stored name is removed. */
export function offenders(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    let rest = line;
    for (const [pattern] of STORED) rest = rest.replace(pattern, '');
    if (OLD.test(rest)) found.push({ line: index + 1, text: line.trim().slice(0, 160) });
  });
  return found;
}

// Planted cases run first and must come out as expected.
const PLANTED = [
  ['enqueue a Cue Helper job', 1],
  ['tools/device/cue_helper_device_lock.py', 1],
  ['node apps/desktop/src/cue-helper-mcp.mjs', 1],
  ['export CUE_HELPER_NEW_KNOB=1', 1],
  ['a cue-helper-something-new id', 1],
  ['schema=cue-helper-control-v1 socket=com.fnaf2.cuehelper.control.3', 0],
  ["join(mainRoot(), 'captures/cue-helper')", 0],
  ['/^com\\.fnaf2\\.cuehelper\\.control\\.[0-9a-z]+$/', 0],
  ['I/FnafCueHelper(7007): RUNNING', 0],
  ['env["CUE_HELPER_LEASE_OWNER_PID"] and ScreenIdentity label "CUE_HELPER"', 0],
  ['"cueHelperPort": 49707', 0],
  ['sensor: "cue-helper-mediaprojection-2400x1080"', 0],
];
const planted = PLANTED.filter(([text, expected]) => offenders(text).length !== expected);
if (planted.length) {
  console.error('companion-name: FAILED -- planted cases came out wrong:');
  for (const [text, expected] of planted) console.error(`  ${JSON.stringify(text)}: expected ${expected} offending line(s)`);
  process.exit(1);
}

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
const refused = [];
let scanned = 0;
let unscanned = 0;
for (const file of files) {
  if (UNSCANNED.some(([pattern]) => (pattern as any).test(file))) { unscanned += 1; continue; }
  if (offenders(file).length) refused.push(`${file}: the path itself`);
  const path = join(ROOT, file);
  if (!existsSync(path) || !statSync(path).isFile()) continue;   // deleted in the working tree
  const bytes = readFileSync(path);
  if (bytes.includes(0)) continue;                                 // binary
  scanned += 1;
  for (const { line, text } of offenders(bytes.toString('utf8'))) refused.push(`${file}:${line}: ${text}`);
}

if (refused.length) {
  console.error('companion-name: FAILED -- the phone\'s app is the Companion (docs/GLOSSARY.md). '
    + 'Say Companion, or add a name to STORED here only if something outside the tree reads it:');
  for (const line of refused) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`companion-name: ${PLANTED.length} planted cases caught; ${scanned} files scanned, none calls the app `
  + `the Cue Helper outside ${STORED.length} stored-name families; ${unscanned} frozen, hash-bound or history files not scanned`);
