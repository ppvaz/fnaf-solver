// FIXTURE for calib-replay.ts: the office visit is taken from the log's last
// session, polled edges become harness rows on their own update at the point
// the runtime maps the SDL mouse event to, and the comparison names the first
// update whose draw count or RNG state differs. No device, no harness.
import { compare, compareModel, delivery, inputRows, landedQueue, outcome, rows, toGame, visit } from './calib-replay.ts';
import type { InputRow } from './calib-replay.ts';

const check: (ok: unknown, message: string) => asserts ok = (ok, message) => { if (!ok) throw new Error(message); };

check(JSON.stringify(toGame(900, 539)) === '[384,383]', 'the hall-light press must map where the practice log saw it');
check(JSON.stringify(toGame(166, 753)) === '[70,535]', 'the Continue tap must map into its touch zone');

// A killed process leaves a row cut, and the next launch's header lands on the same line.
const cut = '{"u":9,"f":3,"fu":9,"t0":1,"tp":2,"te":3,"dt":0.0166,"tu":50,"rd":1,"rs":2,"m":0,"ts":4}\n{"u":10,"f":3,"fu":1';
const session = (mono: number) => `{"schema":"fnaf2-calib-updates-v1","session":{"mono_ns":${mono},"boot_ns":${mono + 5},"real_ns":1,"sdl_ms":1,"beacon":1}}`;
const office = [0, 0, 1, 1, 0, 0, 1, 0].map((m, i) => ({
  u: 20 + i, f: 3, fu: i + 1, ev: 1, t0: 1000 * i, tp: 1000 * i + 10, te: 1000 * i + 20,
  dt: 0.016666667, tu: 50, rd: 2 + i, rs: 100 + i, m, ts: 1000 * i + 30,
}));
const text = [cut + session(7), '{"seed":1488,"f":1,"t":5,"after_u":0}',
  ...[0, 1].map(i => JSON.stringify({ u: 1 + i, f: 1, fu: 1 + i, t0: 0, tp: 0, te: 0, dt: 0.0166, tu: 50, rd: 0, rs: 0, m: 0, ts: 0 })),
  '{"seed":24952,"f":3,"t":6,"after_u":2}', ...office.map(r => JSON.stringify(r)),
  '{"seed":6736,"f":4,"t":9,"after_u":27}', JSON.stringify({ u: 28, f: 4, fu: 1, t0: 0, tp: 0, te: 0, dt: 0.0166, tu: 50, rd: 0, rs: 0, m: 0, ts: 0 }),
].join('\n') + '\n';
const parsed = rows(text);
check(parsed.some(r => r.session), 'a header glued to a cut row must still be read');
check(!parsed.some(r => r.u === 10), 'the cut row must be dropped, not half-read');
const v = visit(parsed, 3);
check(v.seed === 24952 && v.rows.length === office.length, 'the office visit must be its seed and its own updates only');

const input: InputRow[] = [
  { src: 'sdl', k: 'mdown', t: 1005, x: 900, y: 539 },
  { src: 'sdl', k: 'mup', t: 3004, x: 900, y: 539 },
  { src: 'sdl', k: 'mdown', t: 5009, x: 1780, y: 1015 },
  { src: 'sdl', k: 'mup', t: 6002, x: 1780, y: 1015 },
];
const rowsOut = inputRows(v.rows, input);
check(JSON.stringify(rowsOut) === JSON.stringify(['3 2 down 0 384 383', '3 4 up 0', '3 6 down 0 759 721', '3 7 up 0']),
  `polled edges must land on tick fu-1 at the mapped point: ${JSON.stringify(rowsOut)}`);
// A second finger: the phone applies it at the start of update u's events, after pointer 0's mirror.
const withFinger = inputRows(v.rows, [...input,
  { src: 'mt', k: 'new', p: 1, u: 22, x: 759, y: 708 }, { src: 'mt', k: 'end', p: 1, u: 23 }]);
check(JSON.stringify(withFinger) === JSON.stringify(['3 2 down 0 384 383', '3 2 down 1 759 708', '3 3 up 1', '3 4 up 0',
  '3 6 down 0 759 721', '3 7 up 0']), `pointer 1 rows must follow pointer 0 on their tick: ${JSON.stringify(withFinger)}`);
let lost = null as string | null;
try { inputRows(v.rows, [...input, { src: 'mt', k: 'lost', n: 2, u: 24 }]); } catch (e) { lost = (e as Error).message; }
check(lost && lost.includes('dropped 2'), 'a finger queue overflow must refuse the replay');

const trace = (mutate: (i: number) => boolean) => ['# frame 1 seeded 5', '1 0 0 0', '# frame 3 seeded 24952',
  ...v.rows.map((r, i) => `3 ${i} ${mutate(i) ? r.rd + 1 : r.rd} ${r.rs} 0`), '# frame 4 seeded 6736', '4 0 9 9'].join('\n');
const same = compare(v.rows, trace(() => false));
check(same.agree === office.length && same.firstDivergence === null, 'an identical trace must agree on every update');
const off = compare(v.rows, trace(i => i >= 5));
check(off.firstDivergence?.update === 6 && off.agree === 5, 'the first differing update must be named by its phone update');

const ended = outcome(['# frame 1 seeded 5', '1 0 0 0', '# frame 3 seeded 9', '3 0 1 1', '3 1 1 1', '# frame 4 seeded 7', '4 0 1 1'].join('\n'));
check(ended.officeUpdates === 2 && ended.nextFrame === 4, 'an outcome is the office visit\'s length and the frame after it');
const d = delivery(v.rows, input, ['3 1 down 0 384 384', '3 4 up 0', '3 5 down 0 759 708', '3 7 up 0', '3 99 down 0 1 1'].join('\n'));
check(d.plannedDue === 4 && d.missing === 0 && JSON.stringify(d.landedMinusPlanned) === '{"0":2,"1":2}',
  `delivery pairs planned edges with landings in order: ${JSON.stringify(d)}`);

// The model's queue at the phone's landings: a queue row follows its harness edge; a tap's release has none.
const sched: Parameters<typeof landedQueue>[0]['sched'] = { contacts: [{ control: 'monitor', downFrame: 1, upFrame: 4 }, { control: 'mask', downFrame: 5, upFrame: 7 }],
  queue: [[1, 'press', 'monitor'], [5, 'press', 'mask']] };
const points: Parameters<typeof landedQueue>[0]['points'] = { monitor: [1780, 1015], mask: [150, 1015] };
const planned = ['3 1 down 0 1780 1015', '3 4 up 0', '3 5 down 0 150 1015', '3 7 up 0'].join('\n');
const q = landedQueue({ sched, points, office: v.rows, input, plannedText: planned });
check(JSON.stringify(q.rows) === JSON.stringify([[2, 'press', 'monitor'], [6, 'press', 'mask']]) && q.moved.length === 2,
  `queue rows move to the ticks their edges landed on: ${JSON.stringify(q)}`);
let refused = null as string | null;
try { landedQueue({ sched, points, office: v.rows, input, plannedText: '3 1 down 0 1 1\n3 9 up 0' }); } catch (e) { refused = (e as Error).message; }
check(refused && refused.includes('not this winner'), 'a planned file that is not the winner\'s rows is refused');
const cm = compareModel(v.rows, [{ draws: 0, state: 0 }, ...v.rows.map((r, i) => ({ draws: r.rd + (i >= 3 ? 1 : 0), state: r.rs }))]);
check(cm.agree === 3 && cm.firstDivergence?.update === 4, 'model frame f is compared with the phone\'s update f');

console.log('calib-replay: session, visit, input rows, comparison, outcome, delivery and the model queue hold');
