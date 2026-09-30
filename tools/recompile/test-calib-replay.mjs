// FIXTURE for calib-replay.mjs: the office visit is taken from the log's last
// session, polled edges become harness rows on their own update at the point
// the runtime maps the SDL mouse event to, and the comparison names the first
// update whose draw count or RNG state differs. No device, no harness.
import { compare, inputRows, rows, toGame, visit } from './calib-replay.mjs';

const check = (ok, message) => { if (!ok) throw new Error(message); };

check(JSON.stringify(toGame(900, 539)) === '[384,383]', 'the hall-light press must map where the practice log saw it');
check(JSON.stringify(toGame(166, 753)) === '[70,535]', 'the Continue tap must map into its touch zone');

// A killed process leaves a row cut, and the next launch's header lands on the same line.
const cut = '{"u":9,"f":3,"fu":9,"t0":1,"tp":2,"te":3,"dt":0.0166,"tu":50,"rd":1,"rs":2,"m":0,"ts":4}\n{"u":10,"f":3,"fu":1';
const session = (mono) => `{"schema":"fnaf2-calib-updates-v1","session":{"mono_ns":${mono},"boot_ns":${mono + 5},"real_ns":1,"sdl_ms":1,"beacon":1}}`;
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

const input = [
  { src: 'sdl', k: 'mdown', t: 1005, x: 900, y: 539 },
  { src: 'sdl', k: 'mup', t: 3004, x: 900, y: 539 },
  { src: 'sdl', k: 'mdown', t: 5009, x: 1780, y: 1015 },
  { src: 'sdl', k: 'mup', t: 6002, x: 1780, y: 1015 },
];
const rowsOut = inputRows(v.rows, input);
check(JSON.stringify(rowsOut) === JSON.stringify(['3 2 down 0 384 383', '3 4 up 0', '3 6 down 0 759 721', '3 7 up 0']),
  `polled edges must land on tick fu-1 at the mapped point: ${JSON.stringify(rowsOut)}`);

const trace = (mutate) => ['# frame 1 seeded 5', '1 0 0 0', '# frame 3 seeded 24952',
  ...v.rows.map((r, i) => `3 ${i} ${mutate(i) ? r.rd + 1 : r.rd} ${r.rs} 0`), '# frame 4 seeded 6736', '4 0 9 9'].join('\n');
const same = compare(v.rows, trace(() => false));
check(same.agree === office.length && same.firstDivergence === null, 'an identical trace must agree on every update');
const off = compare(v.rows, trace(i => i >= 5));
check(off.firstDivergence?.update === 6 && off.agree === 5, 'the first differing update must be named by its phone update');

console.log('calib-replay: session, visit, input rows and comparison hold');
