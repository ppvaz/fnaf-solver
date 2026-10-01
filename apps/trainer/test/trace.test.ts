// The per-step trainer trace, checked without a browser: the Coach's census
// rows against a scripted run with known lateness, and serve.py's /save-trace
// endpoint against a temporary trace directory. The rows this gates are the
// raw material for a future HumanActuator's bands (plans/04), so what matters
// is exactly what a lateness census needs: cycle attribution, null-delta miss
// rows, and the wind hold as a duration rather than a press.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Coach } from '@sixam/trainer';
import * as C from '@sixam/source/fnaf2';
import { summarize } from './tracereport.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
let failed = 0;
const check = (name, cond, detail = '') => {
  if (!cond) { failed++; console.error(`FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------- the Coach census
// A stub sim: the Coach reads only t and isWinding, and stubbing them lets the
// press times sit exactly on the frame grid so every delta is known a priori.
const sim = { t: 0, isWinding: false };
const script = [
  { id: 'tap-a', at: 0.0, label: 'Tap A', action: 'light' },
  { id: 'wind', at: 1.0, label: 'Wind', action: 'wind', hold: 1.0 },
  { id: 'tap-b', at: 2.6, label: 'Tap B', action: 'light' },
];
const coach = new Coach(sim, { script });

// anchorDigits [2,7] from t=0 puts cycle 0 at t=2. Cycle 0 is played with
// small known lateness; cycle 1 (anchored at t=7) is left entirely unplayed.
const presses = new Map([[123, 'light'], [182, 'wind'], [279, 'light']]);
const WIND_FROM = 182, WIND_TO = 235; // 54 frames held = 0.9s of a 1.0s hold
for (let f = 0; f <= 645; f++) {
  sim.t = f / C.FPS;
  sim.isWinding = f >= WIND_FROM && f <= WIND_TO;
  coach.update();
  const act = presses.get(f);
  if (act) coach.onInput(act);
}

check('trace rows', coach.trace.length === 7, `got ${coach.trace.length}`);
const [a, w, b, m1, m2, m3, nw] = coach.trace;
check('cycle 0 deltas', near(a?.delta, 0.05) && near(w?.delta, 1 / 30) && near(b?.delta, 0.05),
  JSON.stringify([a?.delta, w?.delta, b?.delta]));
check('cycle 0 grades', [a, w, b].every(r => r?.grade === 'good'));
check('cycle 0 attribution', [a, w, b].every(r => r?.cycle === 0));
check('trace carries the step', a?.stepId === 'tap-a' && a?.action === 'light' && a?.at === 0);
check('missed rows are census rows', [m1, m2, m3].every(r => r?.grade === 'missed' && r?.delta === null));
check('missed rows attribute to cycle 1', [m1, m2, m3].every(r => r?.cycle === 1));
check('unwound cycle flagged', nw?.stepId === 'wind' && nw?.grade === 'no-wind' && nw?.cycle === 1);
check('hold rows', coach.holds.length === 2, `got ${coach.holds.length}`);
check('hold 0 is a duration', coach.holds[0]?.cycle === 0 &&
  near(coach.holds[0]?.heldSec, 0.9) && coach.holds[0]?.targetSec === 1);
check('hold 1 is empty', coach.holds[1]?.cycle === 1 && coach.holds[1]?.heldSec === 0);
// The UI's rolling window must not be the census: the trace is a different,
// uncapped array, so trimming results cannot drop early cycles from it.
check('trace is not the rolling results array', coach.trace !== coach.results);

// ------------------------------------------------------- summarizer banding
{
  const censusTrace = {
    speed: 1, env: { webdriver: false }, settings: { coach: true }, commit: 'abc1234',
    steps: [
      { stepId: 'x', delta: 0.05, grade: 'good' },
      { stepId: 'x', delta: -0.10, grade: 'good' },
      { stepId: 'x', delta: null, grade: 'missed' },
    ],
    holds: [{ stepId: 'wind', heldSec: 0.5, targetSec: 1.0 }],
    events: [{ kind: 'press', t: 1.0 }, { kind: 'release', t: 1.2 },
             { kind: 'press', t: 1.3 }, { kind: 'press', t: 2.0 }],
  };
  // The two exclusions are controls, not filters of convenience: a webdriver
  // run is perfectly timed and a slowed clock distorts every interval, so a
  // census containing either would report bands no human produced.
  const botTrace = { env: { webdriver: true }, steps: [{ stepId: 'x', delta: 0, grade: 'good' }] };
  const slowTrace = { speed: 0.5, env: {}, steps: [{ stepId: 'x', delta: 0, grade: 'good' }] };
  const s = summarize([censusTrace, botTrace, slowTrace]);
  check('census partitions', s.runs === 1 && s.botRuns === 1 && s.offSpeedRuns === 1,
    JSON.stringify([s.runs, s.botRuns, s.offSpeedRuns]));
  const x = s.bands.find(b => b.stepId === 'x');
  check('band counts misses', x?.n === 3 && x?.misses === 1);
  check('band quantiles', near(x?.p50, 0.10) && near(x?.worstLate, 0.05) &&
    near(x?.worstEarly, -0.10) && near(x?.earlyShare, 0.5), JSON.stringify(x));
  check('spacing from presses only', s.spacing.n === 2 && near(s.spacing.min, 0.3),
    JSON.stringify(s.spacing));
  check('hold coverage', near(s.holds.p50Frac, 0.5) && near(s.holds.shortFrac, 1));
  check('commit provenance surfaces', s.commits.some(([c, n]) => c === 'abc1234' && n === 1));
}

// ------------------------------------------------------- serve.py /save-trace
const PORT = 8747;
const traceDir = mkdtempSync(join(tmpdir(), 'fnaf-traces-'));
const server = spawn('python3', [join(HERE, 'serve.py'), String(PORT)],
  { cwd: ROOT, stdio: 'ignore', env: { ...process.env, FNAF_TRACE_DIR: traceDir } });

const post = async (body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/save-trace`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

try {
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    try { up = (await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok; }
    catch { await new Promise<any>(r => setTimeout(r, 25)); }
  }
  check('serve.py answered', up);
  if (up) {
    const trace = { v: 1, lesson: 'cycle', steps: coach.trace, holds: coach.holds, events: [] };
    const dry = await post({ ...trace, dry: true });
    check('dry run validates without writing', dry.status === 200 && dry.body.dry === true,
      JSON.stringify(dry));
    check('dry run wrote nothing', readdirSync(traceDir).length === 0);

    const bad = await post({ ...trace, v: 2 });
    check('unknown version refused', bad.status === 400);
    const noLesson = await post({ ...trace, lesson: '../evil' });
    check('bad lesson id refused', noLesson.status === 400);
    const noSteps = await post({ v: 1, lesson: 'cycle', steps: [] });
    check('empty steps refused', noSteps.status === 400);

    const real = await post(trace);
    check('real save accepted', real.status === 200 && !!real.body.file, JSON.stringify(real));
    const files = readdirSync(traceDir);
    check('trace file written', files.length === 1, JSON.stringify(files));
    if (files.length === 1) {
      const saved = JSON.parse(readFileSync(join(traceDir, files[0]), 'utf8'));
      check('server stamped provenance', typeof saved.savedAt === 'string' && !!saved.commit,
        JSON.stringify({ savedAt: saved.savedAt, commit: saved.commit }));
      check('rows survived the round trip', saved.steps.length === coach.trace.length);
    }
  }
} finally {
  server.kill();
  rmSync(traceDir, { recursive: true, force: true });
}

if (failed) { console.error(`${failed} trace check(s) failed`); process.exit(1); }
console.log('tracetest: coach census rows and /save-trace verified');
