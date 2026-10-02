// Plan 08 / item 10: how fast does a BB-departure-bang read have to be?
//
// Item 10 fires the attack cycle's mask-off + hall reset + monitor raise (and
// the dragged recovery sweep) the instant a departure bang is heard, instead of
// the blind `off = b + 5.02 + phaseMargin(900)`. Its whole gain is reacting to
// BB leaving EARLY -- the padded 900 ms is a worst case, the bang says when he
// actually went. So detection latency eats the gain directly.
//
// This sweeps `replay()`'s `bangLatencyMs` (onset -> pilot acts, the entire
// audio path: PCM buffering + onset classification + IPC + reaction) against
// the blind baseline, and reports the crossover -- the latency above which
// item 10 is a NET LOSS.
//
// RESULT (2026-08-27, 800 seeds correlated):
//
//   bang latency  n2    n5    n6    n7
//   blind         68.5  62.4  61.1  33.6
//   0 ms          93.9  91.6  90.5  47.0   <- perfect oracle, the ceiling
//   17 ms         87.9  83.1  81.6  44.6
//   33 ms         79.9  72.6  70.9  39.8   <- still a real +10 on n5/n6
//   50 ms         74.9  64.3  62.9  36.1   <- ~break-even on n5/n6
//   67 ms         69.5  55.6  53.3  30.9   <- net loss on n5/n6/n7
//   83 ms         61.4  43.9  40.5  24.5
//   100 ms        52.4  30.5  26.5  15.9
//
// So the budget is END-TO-END < ~33 ms for a useful gain, < ~50 ms to not
// hurt. Android's CDD recommends continuous input latency <= 30 ms for the PCM
// delivery ALONE, before any onset classification or IPC -- and plan 08's
// windowed-capture design pays cold-start (<= 100 ms recommended, <= 500 ms
// allowed) on top. The g56's audio path is unmeasured and the ARM/HIT/MISS
// protocol to measure it does not exist. This model also ignores detector
// false-negatives (a missed bang -> the fallback fires late -> collapse) and
// false-positives (an early non-BB thud -> raise before BB left -> walk-in),
// both of which make it worse.
//
// Verdict: the latency item 10 needs is below what the audio path can deliver.
// Item 10 is closed, not merely blocked on plan 08.
//
//   node packages/propose/parked/minus7/i10latency.ts [--runs=800] [--latencies=0,17,33,50,67,83,100]
import { makeSearchKnobs } from './hid-device-pilot.ts';
import { build, devicePlan, replay, idleUntilMs } from '../../bin/plans/recipe.ts';
import { jitterPlan } from '../../bin/plans/human-gate.ts';

const arg = (k: string, d: string) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};
const RUNS = +arg('runs', '800');
const LATS = arg('latencies', '0,17,33,50,67,83,100').split(',').map(Number);
const NIGHTS = [2, 5, 6, 7];

function plan(night: number, knobs: ReturnType<typeof makeSearchKnobs>) {
  const r = build({ night, knobs });
  return { p: devicePlan(r, {}), night: r.night, idle: idleUntilMs(r.night), aw: r.cycles.attack.lengthMs };
}
function score(night: number, opts: { bangLatencyMs?: number, bbOnlyBang?: boolean },
  knobs: ReturnType<typeof makeSearchKnobs>) {
  const { p, idle, aw } = plan(night, knobs);
  let won = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const { sim } = replay(jitterPlan(p, seed, 60, 'correlated'),
      { night, seed, idleUntilMs: idle, attackWindowMs: aw, ...opts });
    if (sim.won) won++;
  }
  return +(100 * won / RUNS).toFixed(1);
}
const row = (label: string, fn: (night: number) => number) => console.log(`  ${label.padEnd(22)} ${NIGHTS.map(n => String(fn(n)).padStart(6)).join(' ')}`);

console.log(`item 10 / bang-read latency budget  ${RUNS} seeds correlated   (n2 n5 n6 n7)\n`);
const blind: Record<number, number> = {};
const blindKnobs = makeSearchKnobs();
row('blind (no item 10)', n => (blind[n] = score(n, {}, blindKnobs)));
const gatedKnobs = makeSearchKnobs({ attackBangGateMs: 1 });
let crossed = false;
for (const lat of LATS) {
  const s: Record<number, number> = {};
  NIGHTS.forEach(n => (s[n] = score(n, { bangLatencyMs: lat, bbOnlyBang: true }, gatedKnobs)));
  const netLoss = NIGHTS.slice(1, 3).every(n => s[n] <= blind[n]); // n5 & n6 both <= blind
  row(`gate1  latency ${lat}`, n => s[n]);
  if (netLoss && !crossed) { console.log(`  ^ item 10 is a NET LOSS on n5/n6 at ${lat} ms and above`); crossed = true; }
}
console.log(`\nbudget: end-to-end bang latency must be < ~33 ms for a useful gain,`);
console.log(`< ~50 ms to break even. Android CDD recommends <=30 ms for continuous`);
console.log(`PCM delivery alone. Item 10 is closed on latency, not merely blocked.`);
