// FIXTURE for rebuild-night.mjs: rows become the transport's reports (two
// records while contact 1 is involved), a tick-F row is sent (F - 1) ticks
// after its frame's marker with no drift, and a press on the tick its pointer
// released is moved one tick later. No device.
import { HID_PROCESS, encoder, onPhoneScript, parts, timedPart, toNative } from './rebuild-night.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };

const p = toNative([384, 384]);
check(p.x === 900 && p.y === 540, 'the frame point maps back to the profile point');

const enc = encoder();
const camdrop = [
  { tick: 274, op: 'down', pointer: 0, x: 384, y: 384 },
  { tick: 286, op: 'down', pointer: 1, x: 759, y: 708 },
  { tick: 298, op: 'up', pointer: 1 },
  { tick: 310, op: 'up', pointer: 0 },
].map(r => enc(r));
check(camdrop[0][1] === 1 && camdrop[0][2] === 0x03, 'the light alone is a one-record press');
check(camdrop[1][1] === 2 && camdrop[1][2] === 0x03 && camdrop[1][7] === 0x07, 'the monitor tap rides with the held light');
check(camdrop[2][1] === 2 && camdrop[2][7] === 0x04, 'contact 1 releases while contact 0 is held');
check(camdrop[3][1] === 1 && camdrop[3][2] === 0x00 && camdrop[3][7] === 4, 'the last release names contact 1 inactive');

const rows = [];
for (let k = 0; k < 600; k++) rows.push({ tick: 2 + k * 40, op: 'down', pointer: 0, x: 384, y: 384 }, { tick: 4 + k * 40, op: 'up', pointer: 0 });
const lines = timedPart(rows, encoder()).map(l => JSON.parse(l));
let t = 0; const at = [];
for (const l of lines) { if (l.command === 'delay') t += l.duration; else at.push(t); }
check(at.every((ms, i) => Math.abs(ms - (rows[i].tick - 1) * 1000 / 60) <= 0.5), 'every report goes out within 0.5 ms of its tick, however late in the night');

const bumped = [];
const same = timedPart([{ tick: 271, op: 'down', pointer: 0, x: 213, y: 631 }, { tick: 274, op: 'up', pointer: 0 },
  { tick: 274, op: 'down', pointer: 0, x: 384, y: 384 }], encoder(), bumped);
check(bumped.length === 1 && bumped[0].sentAtTick === 275, 'a press on its pointer\'s release tick goes one tick later');
check(JSON.parse(same.at(-2)).duration === 17, 'the moved press is one tick after the release');

const text = ['1 200 downobj 0 btnCustomNight.Active', '1 203 up 0', '12 60 down 0 896 112', '12 63 up 0',
  '3 146 down 0 759 708', '3 148 up 0'].join('\n');
const all = parts(text);
check(JSON.parse(all.A[0]).command === 'register' && all.B.length === 4 && all.C.length === 5,
  'three parts: registration and title, customize, office with a final release');

// The on-phone shell stops hid by PID when the office is left, and never by process name.
const sh = onPhoneScript();
check(/\| \/system\/bin\/hid - >\/dev\/null 2>&1 &/.test(sh) && sh.includes('HP=$!') && sh.includes('kill $HP'),
  'hid runs in the background and is killed by the PID $! gave');
check(sh.includes("'frame ([0-24-9]|[0-9][0-9]+) update 1 done'") && sh.includes('logcat -T 1'),
  'the watcher waits, from the log\'s last line, for any frame but the office');
check(!/pkill -x hid|killall hid/.test(sh), 'hid is app_process: a kill by the name hid matches nothing');
for (const f of [4, 6, 1, 12, 21, 27, 30]) check(new RegExp('frame ([0-24-9]|[0-9][0-9]+) update 1 done').test(`frame ${f} update 1 done`), `frame ${f} ends the office`);
check(!new RegExp('frame ([0-24-9]|[0-9][0-9]+) update 1 done').test('frame 3 update 1 done'), 'the office itself does not');
check(new RegExp(HID_PROCESS).test('app_process /system/bin com.android.commands.hid.Hid -')
  && !new RegExp(HID_PROCESS).test("sh -c pkill -f '^app_process /system/bin com.android.commands.hid.Hid'"),
  'the anchored pattern matches hid and not the shell that runs pkill');

console.log('rebuild-night: reports, timing, same-tick separation and the office-exit stop hold');
