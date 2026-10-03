// death-prediction.ts --attach writes a DEATH_TARGETED gate into a winner. It
// must never rewrite a committed binding (custody, the gate register and
// ANCHOR_AIMS know a binding by its file's stableHash), and the gate it writes
// must not carry the wall clock, so one prediction always writes the same bytes.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { attachDeathTarget } from './death-prediction.ts';
import type { predictDeaths } from './death-prediction.ts';
import { DEATH_PREDICTION_SCHEMA } from './bundle.ts';

const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const refusal = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof Error ? error.message : String(error); }
  return '';
};

const prediction = (generatedAt: string, wins = 2900): ReturnType<typeof predictDeaths> => ({
  schema: DEATH_PREDICTION_SCHEMA, night: 5, replays: 3000, phasesMs: [0, 50], wins, winRate: wins / 3000,
  killers: [{ killer: 'foxy', count: 3000 - wins, share: (3000 - wins) / 3000,
    tSeconds: { min: 26, p10: 30, p50: 60, p90: 170, max: 200 } }],
  strategy: 'minus-toys', periodMs: 1000,
  generatedBy: 'packages/propose/bin/plans/death-prediction.ts', generatedAt,
});
const winner = { schema: 'winner-v1', strategy: 'minus-toys', nights: [5] };

const root = mkdtempSync(join(tmpdir(), 'death-prediction-'));
try {
  // A committed binding is refused, and left untouched.
  const committed = join(root, 'packages/propose/bindings/fnaf2/campaign-night5-x-winner.json');
  mkdirSync(join(root, 'packages/propose/bindings/fnaf2'), { recursive: true });
  writeFileSync(committed, '{"untouched":true}\n');
  check(/is a committed binding/.test(refusal(() => attachDeathTarget(committed, winner, prediction('2026-10-03T00:00:00Z'), root))),
    'attach rewrote a committed binding instead of refusing it');
  check(readFileSync(committed, 'utf8') === '{"untouched":true}\n', 'a refused attach still wrote the binding');

  // A candidate is written, without the wall clock: two runs, one prediction, the same bytes.
  const candidate = join(root, 'artifacts/candidate-winner.json');
  mkdirSync(join(root, 'artifacts'), { recursive: true });
  attachDeathTarget(candidate, winner, prediction('2026-10-03T00:00:00Z'), root);
  const first = readFileSync(candidate, 'utf8');
  attachDeathTarget(candidate, winner, prediction('2026-10-04T12:34:56Z'), root);
  check(readFileSync(candidate, 'utf8') === first, 'the attached gate changes with the time it was generated');
  check(!first.includes('generatedAt'), 'the attached gate carries the wall clock');
  check(first.includes('"status": "DEATH_TARGETED"'), 'the candidate carries no DEATH_TARGETED gate');

  // A prediction with no deaths is a PASS candidate, not a death target.
  const winning = join(root, 'artifacts/winning-winner.json');
  check(/predicts no death/.test(refusal(() => attachDeathTarget(winning, winner, prediction('2026-10-03T00:00:00Z', 3000), root))),
    'a deathless prediction was attached as a death target');
  check(!existsSync(winning), 'a refused deathless attach wrote a file');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('death prediction: --attach refuses a committed binding, writes a candidate without the wall clock, ' +
  'and refuses a deathless prediction');
