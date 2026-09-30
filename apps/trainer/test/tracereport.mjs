// Summarize the trainer's per-step timing traces: the measured human bands
// plans/04 asks for in place of its [INFERRED] profile. A report, not a check:
// it prints lateness quantiles per step, wind-hold coverage, and inter-press
// spacing for a person (or a future HumanActuator) to read. Traces recorded
// under a webdriver or off-speed are counted and excluded -- a bot's perfect
// presses and a slowed clock are exactly the runs the census must not contain.
//
//   node apps/trainer/test/tracereport.mjs [dir]      # default captures/traces
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const quantile = (xs, q) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
const ms = (v) => v == null ? '--' : `${Math.round(v * 1000)}ms`;

// Split the runs into the census and the excluded partitions, then band the
// census per step. Exported so tracetest can gate the math on synthetic runs.
export function summarize(traces) {
  const bot = traces.filter(t => t.env?.webdriver);
  const offSpeed = traces.filter(t => !t.env?.webdriver && (t.speed ?? 1) !== 1);
  const census = traces.filter(t => !t.env?.webdriver && (t.speed ?? 1) === 1);

  const steps = new Map();
  for (const tr of census) {
    for (const s of tr.steps || []) {
      const b = steps.get(s.stepId) ||
        { stepId: s.stepId, n: 0, deltas: [], misses: 0 };
      b.n++;
      if (s.delta == null) b.misses++;
      else b.deltas.push(s.delta);
      steps.set(s.stepId, b);
    }
  }
  const bands = [...steps.values()].map(b => ({
    stepId: b.stepId, n: b.n, misses: b.misses,
    p50: quantile(b.deltas.map(Math.abs), 0.5),
    p90: quantile(b.deltas.map(Math.abs), 0.9),
    worstLate: b.deltas.length ? Math.max(0, ...b.deltas) : null,
    worstEarly: b.deltas.length ? Math.min(0, ...b.deltas) : null,
    earlyShare: b.deltas.length ? b.deltas.filter(d => d < 0).length / b.deltas.length : null,
  })).sort((a, b) => a.stepId.localeCompare(b.stepId));

  const holds = [];
  for (const tr of census) for (const h of tr.holds || []) holds.push(h);
  const heldFrac = holds.filter(h => h.targetSec > 0).map(h => h.heldSec / h.targetSec);

  // Inter-press spacing, from the raw event stream: how close together two
  // consecutive presses actually land. The floor of this distribution is what
  // an "inhumanly timed" schedule violates.
  const gaps = [];
  for (const tr of census) {
    const presses = (tr.events || []).filter(e => e.kind === 'press')
      .map(e => e.t).sort((a, b) => a - b);
    for (let i = 1; i < presses.length; i++) gaps.push(presses[i] - presses[i - 1]);
  }

  const commits = new Map();
  for (const tr of census) {
    const c = tr.commit || 'unstamped';
    commits.set(c, (commits.get(c) || 0) + 1);
  }

  return {
    runs: census.length, botRuns: bot.length, offSpeedRuns: offSpeed.length,
    bands,
    holds: { n: holds.length, p50Frac: quantile(heldFrac, 0.5), shortFrac: heldFrac.length ? heldFrac.filter(f => f < 0.8).length / heldFrac.length : null },
    spacing: { n: gaps.length, min: gaps.length ? Math.min(...gaps) : null, p05: quantile(gaps, 0.05), p50: quantile(gaps, 0.5) },
    commits: [...commits.entries()].sort(),
    cued: census.filter(t => t.settings?.coach).length,
  };
}

function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const dir = process.argv[2] || join(HERE, '..', '..', '..', 'captures', 'traces');
  let files = [];
  try { files = readdirSync(dir).filter(f => f.endsWith('.json')); } catch { /* no dir yet */ }
  if (!files.length) {
    // Say so, loudly: a report that prints nothing reads as coverage.
    console.log(`no trace files under ${dir}`);
    console.log('play a coached lesson with `npm run serve:trainer` running to record one');
    return;
  }
  const traces = [];
  for (const f of files) {
    try { traces.push(JSON.parse(readFileSync(join(dir, f), 'utf8'))); }
    catch (e) { console.log(`unreadable trace ${f}: ${e.message}`); }
  }
  const s = summarize(traces);
  console.log(`${s.runs} census run(s) from ${files.length} file(s)` +
    ` -- excluded ${s.botRuns} webdriver, ${s.offSpeedRuns} off-speed` +
    `; ${s.cued}/${s.runs} with visual cues on`);
  for (const [commit, n] of s.commits) console.log(`  ${n} run(s) at commit ${commit}`);
  console.log('\nper-step lateness (|delta| quantiles; early = pressed before due)');
  console.log('  step             n   miss   p50    p90    worst late  worst early  early%');
  for (const b of s.bands) {
    console.log(`  ${b.stepId.padEnd(14)} ${String(b.n).padStart(4)}  ${String(b.misses).padStart(4)}` +
      `  ${ms(b.p50).padStart(6)} ${ms(b.p90).padStart(6)}  ${ms(b.worstLate).padStart(9)}` +
      `  ${ms(b.worstEarly && Math.abs(b.worstEarly)).padStart(10)}` +
      `  ${b.earlyShare == null ? '--' : Math.round(b.earlyShare * 100) + '%'}`);
  }
  console.log(`\nwind holds: ${s.holds.n}, median ${s.holds.p50Frac == null ? '--' : Math.round(s.holds.p50Frac * 100) + '%'} of target` +
    `, ${s.holds.shortFrac == null ? '--' : Math.round(s.holds.shortFrac * 100) + '%'} under the 80% pass line`);
  console.log(`inter-press spacing: ${s.spacing.n} gap(s), min ${ms(s.spacing.min)}, p05 ${ms(s.spacing.p05)}, p50 ${ms(s.spacing.p50)}`);
  if (s.runs) {
    console.log('\nThese are bands over whatever has been played so far, not yet a');
    console.log('promotable profile: check run counts and commit spread before using one.');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
