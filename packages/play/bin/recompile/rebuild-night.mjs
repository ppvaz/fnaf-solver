#!/usr/bin/env node
// Play a harness input file -- a committed winner's schedule as
// schedule-to-input.mjs writes it, with its title and customize navigation --
// on the calibration build on the phone, through the campaign's transport.
//
// The file's rows are in frame ticks. On the phone each frame's ticks start
// when that frame's first update ends: the calibration build logs
// `Calib: frame N update 1 done` then (apply-calib-mod.py), and the first
// update carries the frame's load stall, which the game clock does not count.
// So the stream is sent in three parts to one `/system/bin/hid` on the phone,
// and a shell on the phone releases each part when its frame's marker prints:
//   A  register, the InputReader delay, the title tap
//   B  (on `frame 12 update 1 done`) the customize rows
//   C  (on `frame 3 update 1 done`) the office rows
// A row at tick F is sent (F - 1) x 1000/60 ms after its marker, so it
// arrives inside the poll interval before update F + 1, the update the host
// harness applies it to. The phone's actual landings are read afterwards from
// the calibration log, and calib-replay.mjs replays those, not these.
//
// Two contacts are encoded as the transport sends them (hid-sweep-probe.mjs,
// apps/device/src/hid-schedule.js): pointer p is HID contact p; contact 0 is
// 0x03 down / 0x00 up, contact 1 is 0x07 down / 0x04 up, and a report carries
// both records whenever contact 1 is down or just released.
//
//   node rebuild-night.mjs plan --input FILE [--title-tap X,Y]
//   node rebuild-night.mjs live --input FILE --save FILE --out DIR --live   (under device-lock-exec.py)
//
// The title row of a harness file names an object (downobj); the phone needs
// a point, so --title-tap takes the frame point of that object's touch zone
// (default 264,696: the centre of Custom Night's zone [64,664,464,728] as
// fixtures/night7-dials20-5x2.input records it).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HID_DESCRIPTOR, HID_FEATURE_REPORTS, report } from '@sixam/play';
import { resolveSerial } from '../phone/local-profile.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const PACKAGE = 'org.fnaf2practice.play';
const ACTIVITY = `${PACKAGE}/org.libsdl.app.SDLActivity`;
const HID_ID = 105;
const READY_DELAY_MS = 7000;
const TICK_MS = 1000 / 60;
const GAME = [1024, 768], NATIVE = [2400, 1080];
export const toNative = ([x, y]) => ({ x: x * NATIVE[0] / GAME[0], y: y * NATIVE[1] / GAME[1] });

function fail(message) { console.error(`rebuild-night: ${message}`); process.exit(2); }
const opt = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const line = (command, fields = {}) => JSON.stringify({ id: HID_ID, command, ...fields });

/** Harness rows by frame: { frame, tick, op, pointer, x, y }. */
export function parseInput(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const [frame, tick, op, pointer, x, y] = l.split(/\s+/);
    rows.push({ frame: Number(frame), tick: Number(tick), op, pointer: op === 'downobj' ? 0 : Number(pointer),
      x: x === undefined ? null : Number(x), y: y === undefined ? null : Number(y), object: op === 'downobj' ? x : null });
  }
  return rows;
}

/** Contact-state encoder: one report per row, both records while contact 1 is involved. */
export function encoder() {
  const state = [{ down: false, point: null }, { down: false, point: null }];
  return (row) => {
    const p = row.pointer;
    if (p !== 0 && p !== 1) throw new Error(`pointer ${p}: the descriptor has two contacts`);
    const c = state[p];
    if (row.op === 'down') { c.down = true; c.point = toNative([row.x, row.y]); }
    else if (row.op === 'move') { c.point = toNative([row.x, row.y]); }
    else if (row.op === 'up') { if (!c.down) throw new Error(`pointer ${p} released while up`); c.down = false; }
    else throw new Error(`unsupported op ${row.op}`);
    const involvesOne = state[1].down || (p === 1 && row.op === 'up');
    const rec0 = { flags: state[0].down ? 0x03 : 0x00, point: state[0].point ?? state[1].point };
    if (!involvesOne) return report([rec0]);
    return report([rec0, { flags: state[1].down ? 0x07 : 0x04, point: state[1].point }]);
  };
}

/**
 * Timed lines for one frame's rows, from its marker; cumulative rounding, so
 * no drift. A press of a pointer on the tick its previous contact released is
 * sent one tick later: one pump would drain both edges, and play mode mirrors
 * pointer 0 from the polled button, so the game would see the finger slide
 * instead of lift and press (the harness applies both edges, and the retail
 * Multiple Touch takes both events). Each such row is returned in `bumped`.
 */
export function timedPart(rows, encode, bumped = []) {
  const out = [];
  let sent = 0;
  const lastUp = new Map();
  for (const r of [...rows].sort((a, b) => a.tick - b.tick)) {
    let tick = r.tick;
    if (r.op === 'down' && lastUp.get(r.pointer) === tick) { tick += 1; bumped.push({ ...r, sentAtTick: tick }); }
    if (r.op === 'up') lastUp.set(r.pointer, tick);
    const at = Math.max(0, Math.round((tick - 1) * TICK_MS));
    if (at > sent) { out.push(line('delay', { duration: at - sent })); sent = at; }
    out.push(line('report', { report: encode(r) }));
  }
  return out;
}

export function parts(text, titleTap = [264, 696]) {
  const rows = parseInput(text);
  const frames = [...new Set(rows.map(r => r.frame))];
  if (JSON.stringify(frames) !== JSON.stringify([1, 12, 3])) throw new Error(`expected title (1), customize (12) and office (3) rows, got ${frames}`);
  const encode = encoder();
  const tap = toNative(titleTap);
  const A = [line('register', { name: 'FNAF Rebuild Night', vid: 6353, pid: 61959, bus: 'usb',
      descriptor: HID_DESCRIPTOR, feature_reports: HID_FEATURE_REPORTS }),
    line('delay', { duration: READY_DELAY_MS }),
    line('report', { report: report([{ flags: 0x03, point: tap }]) }), line('delay', { duration: 50 }),
    line('report', { report: report([{ flags: 0x00, point: tap }]) })];
  const bumped = [];
  const B = timedPart(rows.filter(r => r.frame === 12), encode, bumped);
  const C = timedPart(rows.filter(r => r.frame === 3), encode, bumped);
  C.push(line('report', { report: report([{ flags: 0x00, point: tap }]) }));
  return { A, B, C, bumped, office: rows.filter(r => r.frame === 3), lastOfficeTick: Math.max(...rows.filter(r => r.frame === 3).map(r => r.tick)) };
}

/** The hid stream's own process: `app_process /system/bin com.android.commands.hid.Hid -`. */
export const HID_PROCESS = '^app_process /system/bin com.android.commands.hid.Hid';

/**
 * The shell run on the phone. Part A goes to hid at once; B and C wait for
 * their frames' markers; the watcher waits for the office's marker and then
 * for the first marker of any other frame, and kills hid by the PID `$!`
 * gave. `logcat -c` ran before the app started, so the waits read only this
 * launch's markers; the watcher's second wait starts at the log's last line
 * (-T 1) and matches every frame but 3.
 */
export function onPhoneScript() {
  const wait = e => `logcat -m 1 -s Calib:I -e '${e}' >/dev/null`;
  return [
    `( cat /data/local/tmp/rn-A.hid; ${wait('frame 12 update 1 done')}; cat /data/local/tmp/rn-B.hid;`,
    ` ${wait('frame 3 update 1 done')}; cat /data/local/tmp/rn-C.hid ) | /system/bin/hid - >/dev/null 2>&1 &`,
    ' HP=$!;',
    ` ( ${wait('frame 3 update 1 done')}; logcat -T 1 -m 1 -s Calib:I -e 'frame ([0-24-9]|[0-9][0-9]+) update 1 done' >/dev/null;`,
    ' kill $HP; echo OFFICE_LEFT ) &',
    ' WP=$!; wait $HP; kill $WP 2>/dev/null; echo HID_DONE; rm -f /data/local/tmp/rn-?.hid',
  ].join('');
}

function hidProcesses(adb) {
  return Number(adb(['shell', `ps -A -o ARGS | grep -c '${HID_PROCESS}' || true`]).trim()) || 0;
}

function stopHid(adb) {
  // pkill -f with an anchored pattern: the shell running this has `sh -c` first.
  try { adb(['shell', `pkill -f '${HID_PROCESS}'`]); } catch { /* none left */ }
}

async function live(args) {
  if (!args.includes('--live')) fail('dry by default: add --live to press the phone');
  if (process.env.CUE_HELPER_LEASE_OWNER_PID === undefined) fail('run under packages/play/src/safety/device-lock-exec.py SERIAL -- ...');
  const input = resolve(opt(args, '--input') ?? fail('--input FILE'));
  const save = resolve(opt(args, '--save') ?? fail('--save FILE (the save the night starts from)'));
  const out = resolve(opt(args, '--out') ?? fail('--out DIR'));
  if (!relative(ROOT, out).startsWith('..')) fail('--out must be outside the repository');
  mkdirSync(out, { recursive: true });
  const text = readFileSync(input, 'utf8');
  const { A, B, C, bumped, lastOfficeTick } = parts(text, (opt(args, '--title-tap') ?? '264,696').split(',').map(Number));
  const { serial } = resolveSerial();
  const adb = (a, o = {}) => execFileSync('adb', ['-s', serial, ...a], { encoding: 'utf8', timeout: 60000, maxBuffer: 512 << 20, ...o });
  const log = m => { console.log(m); writeFileSync(join(out, 'live.log'), `${new Date().toISOString()} ${m}\n`, { flag: 'a' }); };
  const pkg = adb(['shell', `pm path ${PACKAGE}`]).trim();
  if (!pkg.startsWith('package:')) fail(`${PACKAGE} is not installed`);
  const apkSha = adb(['shell', `sha256sum ${pkg.split('\n')[0].slice(8)}`]).split(/\s+/)[0];
  if (/mDreamingLockscreen=true/.test(adb(['shell', 'dumpsys window | grep -m1 mDreamingLockscreen']))) fail('the phone is locked');
  copyFileSync(input, join(out, 'run.input'));
  writeFileSync(join(out, 'meta.json'), JSON.stringify({ apkSha256: apkSha, input: createHash('sha256').update(text).digest('hex'),
    startedAt: new Date().toISOString(), lastOfficeTick, bumped }, null, 1));
  for (const [name, lines] of Object.entries({ A, B, C })) {
    writeFileSync(join(out, `part-${name}.hid`), lines.join('\n') + '\n');
    adb(['shell', `cat > /data/local/tmp/rn-${name}.hid`], { input: lines.join('\n') + '\n' });
  }
  adb(['shell', `am force-stop ${PACKAGE}`]);
  writeFileSync(join(out, 'freddy2.before'), adb(['exec-out', 'run-as', PACKAGE, 'cat', 'files/freddy2']));
  adb(['shell', `run-as ${PACKAGE} sh -c 'cat > files/freddy2'`], { input: readFileSync(save) });
  adb(['logcat', '-c']);
  adb(['shell', `am start -n ${ACTIVITY}`]);
  log(`save written, app started; streams ${A.length}/${B.length}/${C.length} lines; office ends near tick ${lastOfficeTick}`);
  // One shell on the phone: each part waits for its frame's first-update
  // marker, and a watcher stops hid the moment the office is left (the first
  // marker of any other frame after frame 3's), so nothing is pressed into a
  // death screen, the title or a menu. /system/bin/hid runs as app_process
  // (com.android.commands.hid.Hid), so it is stopped by its PID, never by name.
  const script = onPhoneScript();
  const budgetMs = READY_DELAY_MS + 60000 + Math.round(lastOfficeTick * TICK_MS) + 60000;
  const run = spawnSync('adb', ['-s', serial, 'shell', script], { encoding: 'utf8', timeout: budgetMs });
  log(`device shell: status ${run.status} signal ${run.signal ?? 'none'} ${run.stdout.trim()}`);
  if (run.status !== 0 || !run.stdout.includes('HID_DONE')) {
    stopHid(adb);
    log('stream did not complete: hid stopped by its process, which lifts every contact');
  }
  const left = hidProcesses(adb);
  if (left > 0) { stopHid(adb); log(`${left} hid process(es) were still running and were stopped`); }
  // The night ends on its own after the last row; wait (bounded) for the frame after the office.
  const until = Date.now() + 90000;
  let after = '';
  while (Date.now() < until) {
    after = adb(['shell', 'logcat -d -s Calib:I | grep "update 1 done" | tail -3']).trim();
    if (/frame 3 update 1 done[\s\S]*frame \d+ update 1 done/.test(after)) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  log(`frames after the office: ${after.split('\n').map(l => l.replace(/.*Calib\s*:\s*/, '')).join(' | ')}`);
  const tail = h => `tail -n +$(grep -n schema files/${h} | tail -1 | cut -d: -f1) files/${h}`;
  writeFileSync(join(out, 'calib-updates.jsonl'), adb(['exec-out', 'run-as', PACKAGE, 'sh', '-c', tail('calib-updates.jsonl')], { timeout: 180000 }));
  writeFileSync(join(out, 'calib-input.jsonl'), adb(['exec-out', 'run-as', PACKAGE, 'sh', '-c', tail('calib-input.jsonl')], { timeout: 120000 }));
  writeFileSync(join(out, 'freddy2'), readFileSync(save));
  log('pulled the calibration logs of this session');
}

function plan(args) {
  const text = readFileSync(resolve(opt(args, '--input') ?? fail('--input FILE')), 'utf8');
  const { A, B, C, bumped, office, lastOfficeTick } = parts(text, (opt(args, '--title-tap') ?? '264,696').split(',').map(Number));
  const twoRecord = C.filter(l => l.includes('"report":[1,2')).length;
  console.log(JSON.stringify({ partA: A.length, partB: B.length, partC: C.length, officeRows: office.length,
    twoRecordReports: twoRecord, bumped, lastOfficeTick, officeSpanMs: Math.round((lastOfficeTick - 1) * TICK_MS) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'plan') plan(args);
  else if (cmd === 'live') await live(args);
  else fail('usage: plan --input FILE | live --input FILE --save FILE --out DIR --live');
}
