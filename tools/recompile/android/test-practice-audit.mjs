// FIXTURE for practice-audit.mjs: the plans are fixed by their seed, the
// stream is the campaign transport's vocabulary, glued and cut log rows are
// read safely, and the chain's verdicts follow the pumps: a contact whose press
// and release one pump drains is INVISIBLE. No device.
import { HID_FEATURE_REPORTS } from '@sixam/adapters';
import { MONITOR_POINT, READY_DELAY_MS, SYNC, chain, jsonl, plan, stream } from './practice-audit.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };

const sweep = plan(1);
check(sweep.contacts.length === 126 && sweep.contacts.filter(c => c.sync).length === 2 * SYNC.count,
  'the sweep is 120 graded contacts between two sync blocks');
check(JSON.stringify(plan(1)) === JSON.stringify(sweep) && JSON.stringify(plan(2)) !== JSON.stringify(sweep),
  'the plan must be fixed by its seed');
const monitor = plan(1, 'monitor');
check(monitor.contacts.filter(c => !c.sync).every(c => c.point === MONITOR_POINT && c.holdMs === 50 && c.gapMs >= 900),
  'the monitor plan toggles the monitor point with separated 50 ms holds');

const lines = stream(sweep).map(l => JSON.parse(l));
check(lines[0].command === 'register' && JSON.stringify(lines[0].feature_reports) === JSON.stringify(HID_FEATURE_REPORTS),
  'registration must answer the feature report, or InputReader leaves the device out');
check(lines[1].command === 'delay' && lines[1].duration === READY_DELAY_MS, 'reports before InputReader attaches are lost');
const reports = lines.filter(l => l.command === 'report');
check(reports.every(r => r.report.length === 12 && r.report[0] === 1), 'every report is a 12-byte report-ID-1 packet');
check(reports.filter((_, i) => i % 2 === 1).every(r => r.report[7] === 4), 'a release names contact 1 inactive (trap 2)');

const parsed = jsonl('{"u":1}{"u":2}\n{"u":3,"f\n{"event":"x"}\n{"u":4,"f":3{"schema":"s"}\n');
check(JSON.stringify(parsed.map(r => r.u ?? r.event ?? r.schema)) === '[1,2,"x","s"]',
  `glued rows split, cut rows dropped: ${JSON.stringify(parsed)}`);

// Two contacts: the first drained by different pumps (taken), the second by one (invisible).
const ms = n => n * 1e6;
const kernelEdges = [{ pressMs: 100, releaseMs: 150 }, { pressMs: 300, releaseMs: 305 }];
const calibInput = [
  { src: 'java', a: 0, ev: ms(100), rx: ms(102), t: ms(102.05) }, { src: 'sdl', k: 'mdown', t: ms(102.1) },
  { src: 'java', a: 1, ev: ms(150), rx: ms(151.5), t: ms(151.55) }, { src: 'sdl', k: 'mup', t: ms(151.6) },
  { src: 'java', a: 0, ev: ms(300), rx: ms(302), t: ms(302.05) }, { src: 'sdl', k: 'mdown', t: ms(302.1) },
  { src: 'java', a: 1, ev: ms(305), rx: ms(306.5), t: ms(306.55) }, { src: 'sdl', k: 'mup', t: ms(306.6) },
];
const pumpsAt = [95, 112, 129, 145, 162, 295, 312, 329];
const calibUpdates = [{ session: { mono_ns: 0, boot_ns: ms(1e6) } },
  ...pumpsAt.map((t, i) => ({ u: i + 1, f: 3, fu: i + 1, t0: ms(t - 1), tp: ms(t), te: ms(t + 0.5), ts: ms(t + 3),
    dt: 0.0166, tu: 50, rd: 0, rs: 0, m: [0, 1, 1, 1, 0, 0, 0, 0][i] }))];
const two = { holdMs: 50, gapMs: 150 }, tiny = { holdMs: 5, gapMs: 100 };
const result = chain({ kernelEdges, plan: { contacts: [two, tiny] }, calibUpdates, calibInput });
check(result.getevent.clock === 'CLOCK_MONOTONIC', 'a getevent stamp equal to the MotionEvent time is CLOCK_MONOTONIC');
check(result.rows[0].verdict === 'TAKEN' && result.rows[0].pressPump === 2 && result.rows[0].releasePump === 5,
  'a press and release drained by different pumps is taken on the first pump');
check(result.rows[1].verdict === 'INVISIBLE', 'one pump draining press and release leaves the game blind to it');
check(result.flagsAgree, 'the polled flags must agree with the verdicts');
check(Math.abs(result.press.kernelToPollMs.min - 12) < 1e-6 && Math.abs(result.press.dispatchMs.min - 2) < 1e-6,
  'the chain terms are the stamps\' differences');

console.log('practice-audit: plans, stream, log reading and chain verdicts hold');
