// Plan 16 structural experiment: does shortening the BB-response ("attack")
// cycle change the geometry that produced the Foxy wedge, or does Foxy still
// lock during the 5 s masked hold regardless of cycle length?
//
// This is NOT a timing optimiser. It sweeps ONE structural parameter --
// `attackWindowMs`, the cycle boundary -- coarsely, and for each value scores
// EVERY pinned actuator configuration, not just the nominal gate. A candidate
// that wins at readLatencyMs=550 while collapsing at 480 is a resonance, not a
// strategy (that is exactly how the pkg-4 timing search failed). The primary
// key is the minimum survival across the pinned configs; the per-config
// vectors, failure-reason mix and time-to-death are kept for diagnosis.
//
//   node packages/propose/parked/minus7/cyclelengthsearch.ts [--windows=6000,6500,...] [--runs=400]
//                                           [--nights=5,6,7]
//
// `attackWindowMs = 10000` is the regression fixture: it must reproduce the
// 803feb3 numbers within noise on every config.
import { build, devicePlan, idleUntilMs } from '../../bin/plans/recipe.ts';
import { modelGate } from '../../bin/plans/human-gate.ts';
import { run } from './hid-device-pilot.ts';
import * as C from '@sixam/source/fnaf2';

const arg = (k: string, d: string) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};

const WINDOWS = arg('windows', '6000,6500,7000,7500,8000,8500,9000,9500,10000')
  .split(',').map(Number);
const RUNS = +arg('runs', '400');
const NIGHTS = arg('nights', '5,6,7').split(',').map(Number);

// The pinned actuator configs from tools/test.ts. Each is a distinct sourced
// latch model the search MUST NOT trade against the others.
/** A pinned config: the model gate, or the HID pilot run with its options. */
type ActuatorConfig = { id: string, kind: 'gate' }
  | { id: string, kind: 'run', worst?: boolean, opts: NonNullable<Parameters<typeof run>[0]> };
const ACTUATOR_CONFIGS: ActuatorConfig[] = [
  { id: 'gate       (replay, readLatency 550)', kind: 'gate' },
  { id: 'n6target    (run, readLatency 480)',
    kind: 'run', opts: { deviceSweep: true, pulseLight: true, sweepSlotMs: 120,
      maskMarginMs: 900, readLatencyMs: 480, pilotOffset: 10 } },
  { id: 'n6target-wst (run, readLatency 480, worst luck)',
    kind: 'run', worst: true, opts: { deviceSweep: true, pulseLight: true, sweepSlotMs: 120,
      maskMarginMs: 900, readLatencyMs: 480, pilotOffset: 10 } },
  { id: 'n6target-act (run, readLatency 480, device actuator)',
    kind: 'run', opts: { deviceSweep: true, pulseLight: true, sweepSlotMs: 120,
      maskMarginMs: 900, readLatencyMs: 480, pilotOffset: 10, deviceActuator: true } },
];

function planText(night: number, attackWindowMs: number) {
  const recipe = build({ night, attackWindowMs });
  const plan = devicePlan(recipe);
  let text = `#night ${recipe.night}\n#idle-until ${idleUntilMs(recipe.night)}\n`;
  for (const [name, lines] of Object.entries(plan))
    text += `#cycle ${name} ${recipe.cycles[name as keyof typeof recipe.cycles].lengthMs}\n${lines.join('\n')}\n`; // devicePlan names its cycles after the recipe's
  return text;
}

const median = (xs: readonly (number | undefined)[]) =>
  xs.length ? xs.slice().sort((a, b) => Number(a) - Number(b))[xs.length >> 1] : null;

// Survival + failure census for one config at one window.
function scoreRun(cfg: Extract<ActuatorConfig, { kind: 'run' }>, night: number, attackWindowMs: number, runs: number) {
  let won = 0;
  const deaths: Record<string, number> = {};
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const seed = (i * 2246822519) >>> 0;
    const { sim } = run({ ...cfg.opts, attackWindowMs,
      sim: { seed, night, worst: !!cfg.worst } });
    if (sim.won) won++;
    else if (sim.death) {
      const k = sim.death.reason;
      deaths[k] = (deaths[k] || 0) + 1;
      times.push(sim.death.t);
    }
  }
  return { won, runs, pct: +(100 * won / runs).toFixed(1), deaths, medianDeath: median(times) };
}
function scoreGate(night: number, attackWindowMs: number, runs: number, shape: string) {
  const text = planText(night, attackWindowMs);
  const g = modelGate(text, { night, runs, shape });
  const deaths: Record<string, number> = {};
  const times: (number | undefined)[] = [];
  for (const [k, v] of g.deaths) {
    const reason = k.split(':')[0];
    deaths[reason] = (deaths[reason] || 0) + v;
    times.push(...(g.deathTimes.get(k) || []));
  }
  return { won: g.survived, runs, pct: +(100 * g.survived / g.runs).toFixed(1),
    deaths, medianDeath: median(times) };
}

function fmtDeaths(d: Readonly<Record<string, number>>, runs: number) {
  const total = Object.values(d).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(d).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => `${k} ${(100 * v / runs).toFixed(0)}%`).join('  ') || '(none)';
}

async function main() {
  console.log(`plan-16 cycle-length experiment  windows ${WINDOWS.join('/')} ms  ${RUNS} runs/config`);
  console.log(`nights ${NIGHTS} on the gate; night 6 on the run-mode actuator configs\n`);

  for (const W of WINDOWS) {
    console.log(`\n===== attackWindowMs = ${W} ${W === 10000 ? '(baseline / regression fixture)' : ''} =====`);
    let broke = false;
    // gate ladder, both shapes, every night
    for (const shape of ['correlated', 'iid']) {
      const cells = [];
      for (const night of NIGHTS) {
        let r;
        try { r = scoreGate(night, W, RUNS, shape); }
        catch (e) { cells.push(`n${night} ERR(${(e as Error).message.slice(0, 40)})`); broke = true; continue; }
        cells.push(`n${night} ${r.pct}%`);
        if (shape === 'correlated')
          console.log(`  gate n${night} ${shape.padEnd(10)} ${String(r.pct).padStart(5)}%  deaths: ${fmtDeaths(r.deaths, r.runs)}  medianTOD ${r.medianDeath ?? '-'}s`);
      }
      console.log(`  gate ${shape.padEnd(10)}: ${cells.join('  ')}`);
    }
    // pinned actuator configs (night 6)
    for (const cfg of ACTUATOR_CONFIGS.filter(c => c.kind === 'run')) {
      let r;
      try { r = scoreRun(cfg, 6, W, cfg.opts.deviceActuator ? Math.min(RUNS, 200) : RUNS); }
      catch (e) { console.log(`  ${cfg.id}: ERR ${(e as Error).message.slice(0, 60)}`); broke = true; continue; }
      const flag = r.pct < 40 ? '  <-- COLLAPSE' : '';
      console.log(`  ${cfg.id.padEnd(46)} ${String(r.pct).padStart(5)}%  deaths: ${fmtDeaths(r.deaths, r.runs)}  medianTOD ${r.medianDeath ?? '-'}s${flag}`);
    }
    if (broke) console.log('  (one or more configs failed to build/replay at this window)');
  }
}

main();
