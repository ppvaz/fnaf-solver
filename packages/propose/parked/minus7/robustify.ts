// Per-row jitter-robustness analysis of an emitted device plan.
//
// This session's finding (plans/PROGRESS.md item 11): the Minus 7 device
// schedule replays 100% on every night with NO human-slack jitter, and the
// sub-70 human-gate ladder is entirely a consequence of `human-gate.ts`'s
// iid +/-60 ms per-row model. So the lever is not "add more resets" -- it is
// "which rows sit on a cliff, and can moving them a frame or two toward the
// centre of their tolerance window raise survival under the SAME jitter".
//
//   node packages/propose/parked/minus7/robustify.ts --night=6 [--seeds=600] [--range=3] [--descend]
//
// --descend runs coordinate descent: apply each round's single best per-row
// shift, re-measure, repeat until nothing helps. The output is a shift vector
// over the plan's rows; translating it back into `packages/propose/parked/minus7/hid-device-pilot.ts`
// timings (and re-gating at 1200 seeds) is a manual follow-up -- a hand-edited
// plan is not shippable (CLAUDE.md: "port the table to recipe.ts").
import { execFileSync } from 'node:child_process';
import { replay } from '../../bin/plans/recipe.ts';
import { jitterPlan, parsePlanText } from '../../bin/plans/human-gate.ts';
import type { PlanRows } from '../../bin/plans/human-gate.ts';

const arg = (k: string, d: string) => {
  const m = process.argv.find(a => a.startsWith(`--${k}=`));
  return m ? m.split('=')[1] : d;
};
const FLAG = (k: string) => process.argv.includes(`--${k}`);
const f2ms = (fr: number) => Math.round(fr * 1000 / 60);

// Shift one named row (by its index within its cycle) by `deltaMs`, then apply
// the normal iid jitter on top. Row order is (cycle, index).
function shiftPlan(plan: PlanRows, shifts: Readonly<Record<string, number>>) {
  const out: PlanRows = {};
  for (const [name, lines] of Object.entries(plan)) {
    out[name] = lines.map((line, i) => {
      const sp = line.indexOf(' ');
      const d = shifts[`${name}:${i}`] || 0;
      return `${Math.max(0, +line.slice(0, sp) + d)}${line.slice(sp)}`;
    });
  }
  return out;
}

function survival(plan: PlanRows, night: number, idleUntilMs: number, seeds: number, slackMs = 60,
  shifts: Readonly<Record<string, number>> = {}) {
  const shifted = shiftPlan(plan, shifts);
  let won = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const { sim } = replay(jitterPlan(shifted, seed, slackMs), { night, seed, idleUntilMs });
    if (sim.won) won++;
  }
  return won;
}

function rowList(plan: PlanRows) {
  const rows: { id: string, name: string, i: number, line: string }[] = [];
  for (const [name, lines] of Object.entries(plan))
    lines.forEach((line, i) => rows.push({ id: `${name}:${i}`, name, i, line }));
  return rows;
}

function main() {
  const night = +arg('night', '6');
  const seeds = +arg('seeds', '600');
  const rangeFr = +arg('range', '3');
  const text = execFileSync('node',
    ['packages/propose/bin/plans/recipe.ts', '--device-plan', `--night=${night}`]).toString();
  const { plan, idleUntilMs } = parsePlanText(text);
  const rows = rowList(plan);

  const base = survival(plan, night, idleUntilMs, seeds);
  const unjit = survival(plan, night, idleUntilMs, seeds, 0);
  console.log(`night ${night}: ${seeds} seeds`);
  console.log(`  unjittered      ${unjit}/${seeds} (${(100*unjit/seeds).toFixed(1)}%)`);
  console.log(`  iid +/-60 ms    ${base}/${seeds} (${(100*base/seeds).toFixed(1)}%)   <- the gap`);
  console.log(`  ${rows.length} plan rows; sweeping each +/-${rangeFr} frames\n`);

  const deltas = [];
  for (let d = -rangeFr; d <= rangeFr; d++) if (d) deltas.push(d);

  const shifts: Record<string, number> = {};
  let cur = base;
  const rounds = FLAG('descend') ? 8 : 1;
  for (let round = 0; round < rounds; round++) {
    let bestGain = 0, bestId = null, bestD = 0, bestWon = cur;
    for (const row of rows) {
      for (const d of deltas) {
        if ((shifts[row.id] || 0) === d) continue;
        const trial = { ...shifts, [row.id]: d };
        try {
          const w = survival(plan, night, idleUntilMs, seeds, 60, trial);
          if (w - cur > bestGain) { bestGain = w - cur; bestId = row.id; bestD = d; bestWon = w; }
          if (round === 0 && w - base >= Math.max(6, seeds * 0.01))
            console.log(`  ${row.id.padEnd(14)} ${row.line.split(' ').slice(1).join(' ').padEnd(22)} ${d > 0 ? '+' : ''}${d}fr (${f2ms(d)}ms) -> ${w}/${seeds}  (${w - base > 0 ? '+' : ''}${w - base})`);
        } catch { /* a shift the model refuses is not a candidate */ }
      }
    }
    if (!bestId) break;
    shifts[bestId] = bestD;
    cur = bestWon;
    console.log(`\nround ${round + 1}: shift ${bestId} by ${bestD > 0 ? '+' : ''}${bestD}fr -> ${cur}/${seeds} (${(100*cur/seeds).toFixed(1)}%)`);
    if (!FLAG('descend')) break;
  }

  if (Object.keys(shifts).length) {
    console.log('\nfinal shift vector (row -> frames):');
    for (const [id, d] of Object.entries(shifts)) {
      const row = rows.find(r => r.id === id) as (typeof rows)[number]; // every shifted id is a plan row's
      console.log(`  ${id.padEnd(14)} ${d > 0 ? '+' : ''}${d}fr  ${row.line}`);
    }
    console.log(`\n  iid +/-60 ms  ${base}/${seeds} -> ${cur}/${seeds}  (+${cur - base}, ${((cur - base) * 100 / seeds).toFixed(1)} pts)`);
    console.log('  verify at 1200 seeds and translate to model/hid-device-pilot.mjs before shipping.');
  } else {
    console.log('\nno single-row shift within range improved survival -- the fragility is not one row.');
  }
}

main();
