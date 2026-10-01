// Exhaustive, constrained search for Plan 16's Foxy-reset decoupling space.
//
// This searches only named device-plan geometry already implemented by
// HidPilot.  Every trajectory goes through recipe.build -> devicePlan ->
// jitterPlan -> replay over packages/source/src/games/fnaf2/plant-model.ts.
// It is therefore a deterministic enumeration of this finite family, not a
// new policy simulator.
//
//   node packages/propose/parked/minus7/constrainedsearch.ts --mode=screen --workers=8
//   node packages/propose/parked/minus7/constrainedsearch.ts --mode=exhaustive --workers=8
//   node packages/propose/parked/minus7/constrainedsearch.ts --mode=validate --candidate-file=x.json
//
// `exhaustive` validates every mechanically legal generated candidate at the
// gate sample size.  It does not use a beam: a screen result can rank rows for
// reporting but is never allowed to discard a possible gate winner.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { pool, closePool } from '../../bin/census/pool.ts';
import { FLOORS } from './paramsearch.ts';

const WORKER = new URL('./constrained-worker.ts', import.meta.url).href;
const BASELINE = '803feb3';
const DEFAULT_NIGHTS = [2, 3, 4, 5, 6, 7];

const value = (name, fallback) => {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`));
  return raw === undefined ? fallback : raw.slice(name.length + 3);
};
const integer = (name, fallback) => {
  const n = Number(value(name, String(fallback)));
  if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
  return n;
};
const csv = (name, fallback) => value(name, fallback.join(',')).split(',').map(Number);

const zeroParams = () => Object.fromEntries(Object.keys(FLOORS).map(k => [k, 0]));
const product = (axes, i = 0, prefix = {}) => {
  if (i === axes.length) return [prefix];
  const [{ name, values }] = axes.slice(i);
  return values.flatMap(v => product(axes, i + 1, { ...prefix, [name]: v }));
};

// This is deliberately much smaller than paramsearch's general timing space.
// It enumerates only the pkg-4 decoupling geometry and the opening suppression
// required to make an in-read hall pulse legal.  `preReadHallMs` is only
// allowed with `openGfFlick`; otherwise it would knowingly press into the
// un-cleared Golden Freddy opening state.
export function enumeratePackage4() {
  const base = zeroParams();
  const axes = [
    { name: 'attackSweepDeltaMs', values: [0, -17, -33, -50, -67] },
    { name: 'attackRstDeltaMs', values: [0, 6800, 7100, 7400, 7700] },
    { name: 'preReadHallMs', values: [0, 400, 450, 500, 550, 600, 650, 700, 750, 800] },
    { name: 'bangAgeFrames', values: [0, 30, 37, 45, 60, 90, 120, 240, 500, 999] },
  ];
  const seen = new Set();
  return product(axes).flatMap(part => {
    const params = { ...base, ...part,
      // The in-read reset is coupled to the opening GF suppression.  No pulse
      // is the immutable baseline and does not pay that opening mechanism.
      openGfFlick: part.preReadHallMs ? 1 : 0,
      bangAgeFrames: part.preReadHallMs ? part.bangAgeFrames : 0 };
    // The baseline is inserted once by runSearch(), with its immutable name.
    if (Object.values(params).every(v => v === 0)) return [];
    const key = JSON.stringify(params);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ id: `candidate-${seen.size - 1}`, params }];
  });
}

function paramsLabel(params) {
  const d = Object.entries(params).filter(([, v]) => v !== 0);
  return d.length ? d.map(([k, v]) => `${k}=${v}`).join(', ') : 'baseline';
}
function survival(row) { return row.won / row.runs; }
function minSurvival(result, nights) {
  return Math.min(...nights.map(n => survival(result.nights[n])));
}
function objective(result, nights) {
  return [minSurvival(result, nights),
    ...nights.map(n => survival(result.nights[n])),
    ...nights.map(n => result.nights[n].cvar)];
}
// Explicitly lexicographic: a Night 7 collapse cannot be bought with an
// improvement on Night 2.  Device costs are intentionally absent here because
// package 4 is still below the primary survival bar; they must not buy a
// survival trade until a candidate clears it.
export function compareObjectives(a, b, nights) {
  const aa = objective(a, nights), bb = objective(b, nights);
  for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return bb[i] - aa[i];
  return 0;
}
function dominates(a, b, nights) {
  const axes = nights.flatMap(n => [
    survival(a.nights[n]) - survival(b.nights[n]),
    a.nights[n].cvar - b.nights[n].cvar,
  ]);
  return axes.every(x => x >= 0) && axes.some(x => x > 0);
}
export function pareto(results, nights) {
  const front = results.filter(x => !results.some(y => y !== x && dominates(y, x, nights)))
    .sort((a, b) => compareObjectives(a, b, nights));
  // The baseline is first in the input.  Retaining one representative for an
  // exactly equal result prevents a low-seed smoke run from printing hundreds
  // of indistinguishable rows while leaving the exhaustive gate set intact.
  const seen = new Set();
  return front.filter(x => {
    const key = JSON.stringify(objective(x, nights));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function evaluate(candidates, { nights, runs, shape, seedStart }) {
  const jobs = candidates.flatMap(c => nights.map(night => ({ candidateId: c.id,
    params: c.params, night, runs, shape, seedStart })));
  // A job is a candidate × night × seed batch.  One batch avoids IPC for each
  // seed but leaves work dynamically balanced across persistent workers.
  const rows = await pool().map(WORKER, 'evaluateNight', jobs);
  const byId = new Map(candidates.map(c => [c.id, { ...c, nights: {}, ok: true }]));
  for (const row of rows) {
    const out: any = byId.get(row.candidateId);
    out.ok &&= row.ok;
    if (!row.ok) out.error = row.error;
    else out.nights[row.night] = row.result;
  }
  return [...byId.values()].filter((x: any) => x.ok);
}

function candidateFile(file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error('--candidate-file must contain a JSON array');
  const base = zeroParams();
  return raw.map((item, i) => ({ id: item.id ?? `candidate-${i}`,
    params: { ...base, ...(item.params ?? item) } }));
}
function shard(candidates, spec) {
  if (!spec) return candidates;
  const [at, of] = spec.split('/').map(Number);
  if (!Number.isInteger(at) || !Number.isInteger(of) || at < 0 || at >= of)
    throw new Error('--shard must be INDEX/COUNT with 0 <= INDEX < COUNT');
  return candidates.filter((_, i) => i % of === at);
}
function printTable(title, results, nights, limit = 12) {
  console.log(`\n${title} (${results.length})`);
  for (const r of results.slice(0, limit)) {
    const line = nights.map(n => `n${n} ${(100 * survival(r.nights[n])).toFixed(1)}`).join('  ');
    const iid = r.secondaryNights
      ? `  iid-min ${(100 * minSurvival({ nights: r.secondaryNights }, nights)).toFixed(1).padStart(5)}` : '';
    console.log(`  ${r.id.padEnd(15)} min ${(100 * minSurvival(r, nights)).toFixed(1).padStart(5)}  ${line}${iid}  ${paramsLabel(r.params)}`);
  }
  if (results.length > limit) console.log(`  … ${results.length - limit} more Pareto members`);
}

export async function runSearch({ mode = 'screen', nights = DEFAULT_NIGHTS,
  screenRuns = 300, gateRuns = 1200, shape = 'correlated', seedStart = 1,
  secondaryShape = 'iid', candidateFile: file, shard: shardSpec }: any = {}) {
  if (!['screen', 'exhaustive', 'validate'].includes(mode))
    throw new Error('--mode must be screen, exhaustive, or validate');
  let candidates = file ? candidateFile(file) : enumeratePackage4();
  candidates = shard(candidates, shardSpec);
  // The unmodified 803feb3 ladder is immutable and present on every shard so
  // a partial result remains comparable to the known control.
  const baseline = { id: BASELINE, params: zeroParams() };
  candidates = [baseline, ...candidates.filter(c => c.id !== BASELINE)];

  const screen = await evaluate(candidates, { nights, runs: screenRuns, shape, seedStart });
  const screenFrontier = pareto(screen, nights);
  if (mode === 'screen') return { candidates, screen, screenFrontier, gate: [] };

  // In exhaustive mode every legal candidate is re-evaluated.  The screen is
  // intentionally not a pruning rule; finite enumeration is the evidence for
  // the negative result, and a noisy 300-seed ranking cannot weaken it.
  const admitted = mode === 'screen' ? screenFrontier : screen;
  const gate = await evaluate(admitted, { nights, runs: gateRuns, shape, seedStart });
  let secondary = [];
  if (secondaryShape && secondaryShape !== 'none' && secondaryShape !== shape) {
    secondary = await evaluate(admitted, { nights, runs: gateRuns,
      shape: secondaryShape, seedStart });
    const byId = new Map(secondary.map(r => [r.id, r.nights]));
    for (const r of gate) (r as any).secondaryNights = byId.get((r as any).id);
  }
  return { candidates, screen, screenFrontier, gate, secondary,
    frontier: pareto(gate, nights) };
}

async function main() {
  const mode = value('mode', 'screen');
  const nights = csv('nights', DEFAULT_NIGHTS);
  const result = await runSearch({ mode, nights, screenRuns: integer('screen-runs', 300),
    gateRuns: integer('gate-runs', 1200), shape: value('shape', 'correlated'),
    seedStart: integer('seed-start', 1), secondaryShape: value('secondary-shape', 'iid'),
    candidateFile: value('candidate-file', ''),
    shard: value('shard', '') });
  console.log(`CONSTRAINED SEARCH — ${mode.toUpperCase()}`);
  console.log(`baseline: ${BASELINE}; shape: ${value('shape', 'correlated')}; candidates: ${result.candidates.length}; workers: ${value('workers', 'default')}`);
  console.log(`nodes generated: ${result.candidates.length}; screen evaluations: ${result.screen.length * nights.length}; gate evaluations: ${result.gate.length * nights.length}; secondary evaluations: ${(result.secondary?.length ?? 0) * nights.length}`);
  printTable('screen Pareto frontier', result.screenFrontier, nights);
  if (result.frontier) printTable(`gate Pareto frontier @${integer('gate-runs', 1200)} seeds`, result.frontier, nights);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main().catch(err => { console.error(`constrained search: ${err.message}`); process.exitCode = 2; })
  .finally(() => closePool());
