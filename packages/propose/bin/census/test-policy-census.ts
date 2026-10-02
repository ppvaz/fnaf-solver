// Holds the newest policy-family census record (policy-census.ts) to its pre-registration and
// to the tree, without re-running it:
//
//   - the spec it names is the committed pre-registration, byte for byte (sha256): committed alone,
//     never edited since, in a commit that precedes the record's (and, while the commit the census
//     ran at is reachable, the same bytes there); both blocks re-resolve at or above the 3000-seed floor;
//   - its evidenceId, its experiment-result-v2, the selected policy, the observation, every
//     explanation's tag and the P_max rate re-derive from the record's own counts with the same
//     functions that wrote them (a planted change to one count is caught);
//   - the family re-derives from the tree: the same winners, plan hashes, bands and schedule
//     classes (queue hashes), so a changed binding or anchor aim fails here;
//   - a cheap slice replays as recorded: per schedule class, two development and two held-out
//     seeds and up to two listed losses, and each multi-epoch class's last epoch against its
//     representative (the class claim); per binding, two held-out device-lane nights.
//
// MODEL_ONLY, like the record. `test:unit`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateExperimentResultV2, validateExperimentSpecV2 } from '@sixam/kernel/contracts';
import { SEED_FLOOR, decideExperiment, resolveCensusCohort } from '@sixam/propose/census';
import {
  CENSUS_KIND, anchorBandBindings, deviceNight, exactNight, observe, pMaxRate, scheduleClasses, selectPolicy,
} from './policy-census.ts';
import type { CensusSpec, buildRecord } from './policy-census.ts';
import type { Loss } from './winner-census.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const EVIDENCE = join(ROOT, 'docs/evidence');
/** A value the test reads where the record has it; a missing one fails the check that reads it. */
const found = <T>(value: T | null | undefined) => value as T;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const records = readdirSync(EVIDENCE).filter((name) => /-census-\d{8}\.json$/.test(name)).sort()
  .map((name): { name: string, record: ReturnType<typeof buildRecord> } => ({ name, record: JSON.parse(readFileSync(join(EVIDENCE, name), 'utf8')) }))
  .filter(({ record }) => record.kind === CENSUS_KIND);
assert.ok(records.length, `no ${CENSUS_KIND} record under docs/evidence`);
const { name, record } = found(records.at(-1));
assert.equal(record.claimLevel, 'MODEL_ONLY', `${name}: a census is MODEL_ONLY`);
// The worker count a record states is the one its command ran with (until 2026-10-01 it stated the cap).
for (const { name: each, record: r } of records)
  assert.equal(r.method.jobs, Number(/--jobs (\d+)/.exec(r.method.command)?.[1] ?? 1), `${each}: method.jobs is not its command's --jobs`);

// The pre-registration, byte for byte, committed alone and never edited, and before the record.
const git = (...args: string[]) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const specPath = record.preregistration.spec;
const specText = readFileSync(join(ROOT, specPath), 'utf8');
assert.equal(sha256(specText), record.preregistration.specSha256, `${name}: the spec file changed since the census`);
assert.equal(record.result.specSha256, record.preregistration.specSha256);
assert.match(record.preregistration.commit ?? '', /^[0-9a-f]{40}$/, `${name}: the census ran from a committed spec`);
const specCommits = git('log', '--format=%H', '--', specPath).split('\n').filter(Boolean);
assert.equal(specCommits.length, 1, `${name}: the pre-registration was edited after it was committed`);
assert.deepEqual(git('show', '--format=', '--name-only', specCommits[0]).split('\n').filter(Boolean), [specPath],
  `${name}: the pre-registration was not committed alone`);
const recordCommits = git('log', '--format=%H', '--', `docs/evidence/${name}`).split('\n').filter(Boolean);
if (recordCommits.length) {
  const recordAdded = recordCommits[recordCommits.length - 1];
  assert.notEqual(recordAdded, specCommits[0], `${name}: the record and its pre-registration share a commit`);
  git('merge-base', '--is-ancestor', specCommits[0], recordAdded); // throws unless the spec came first
}
// The commit the census ran at, while it is reachable (a rebase moves it; the order above still holds).
let reachable = true;
try { git('cat-file', '-e', `${record.preregistration.commit}^{commit}`); } catch { reachable = false; }
if (reachable)
  assert.equal(sha256(git('show', `${record.preregistration.commit}:${specPath}`) + '\n'), record.preregistration.specSha256,
    `${name}: the spec at the commit the census ran at is not the one censused`);
// The census's own family, as its pre-registration wrote it.
const spec = validateExperimentSpecV2(JSON.parse(specText)) as CensusSpec;
validateExperimentResultV2(record.result, spec);
const cohort = resolveCensusCohort(spec);
for (const block of ['development', 'heldOut'] as const) assert.ok(cohort[block].length >= SEED_FLOOR, `${block} under the floor`);

// Identity and decision, re-derived from the record's own counts.
const { evidenceId, ...unsigned } = record;
assert.equal(evidenceId, `${spec.id}-${sha256(JSON.stringify(unsigned)).slice(0, 16)}`, `${name}: evidenceId does not re-derive`);
for (const binding of record.bindings)
  for (const cls of binding.classes) {
    assert.equal(cls.development.n, cohort.development.length);
    assert.equal(cls.heldOut.n, cohort.heldOut.length);
  }
const selectedName = selectPolicy(spec, record.bindings);
assert.equal(selectedName, record.selection.selected, `${name}: the development block selects another policy`);
// The rule's second key: policies with the same worst class are ranked by their member-weighted mean,
// each class weighted by its epoch count, which a class row states as epochsMs.count.
{
  const cls = (count: number, wins: number) => ({ epochsMs: { lo: 0, hi: count - 1, count }, development: { wins, n: 10 } });
  const tied = [{ name: 'k3', classes: [cls(1, 8), cls(9, 8)] }, { name: 'k2', classes: [cls(1, 8), cls(9, 10)] }];
  assert.equal(selectPolicy(spec, tied), 'k2', 'a tie on the worst class is broken by the member-weighted mean, not the tie order');
}
const selected = found(record.bindings.find((binding) => binding.name === selectedName));
const observations = observe(selected);
assert.deepEqual(observations, record.result.observations.values, `${name}: the observation does not re-derive`);
const pMax = pMaxRate(selected);
assert.deepEqual(pMax, record.pMax.rate, `${name}: the P_max rate does not re-derive`);
assert.deepEqual(record.result.rates[0], pMax);
const decided = decideExperiment(spec, { specSha256: record.result.specSha256, observations, rates: record.result.rates,
  stopped: record.result.stopped });
assert.deepEqual(decided.explanations.map((item) => [item.id, item.status]),
  record.result.explanations.map((item) => [item.id, item.status]), `${name}: an explanation's tag does not re-derive`);
// A planted change to one held-out count must move the observation or the rate.
const planted = structuredClone(selected);
planted.classes[0].heldOut.wins = planted.classes[0].heldOut.wins === planted.classes[0].heldOut.n
  ? planted.classes[0].heldOut.n - 1 : planted.classes[0].heldOut.n;
assert.ok(JSON.stringify(observe(planted)) !== JSON.stringify(observations) ||
  JSON.stringify(pMaxRate(planted)) !== JSON.stringify(pMax), 'a planted held-out count is not caught');

// The family, re-derived from the tree.
const bindings = anchorBandBindings(spec);
assert.deepEqual(bindings.map((b) => b.name), record.bindings.map((b) => b.name));
let replays = 0;
for (const binding of bindings) {
  const recorded = found(record.bindings.find((b) => b.name === binding.name));
  assert.equal(binding.winnerSha256, recorded.winnerSha256, `${binding.name}: winner changed`);
  assert.equal(binding.planSha256, recorded.planSha256, `${binding.name}: emitted plan changed`);
  const classes = scheduleClasses(binding, spec.family.grid.stepMs);
  assert.deepEqual(classes.map((c) => [c.id, c.queueSha256, c.epochsMs[0], c.epochsMs.at(-1), c.epochsMs.length]),
    recorded.classes.map((c) => [c.id, c.queueSha256, c.epochsMs.lo, c.epochsMs.hi, c.epochsMs.count]),
    `${binding.name}: the schedule classes do not re-derive`);
  // The slice.
  const night = spec.family.grid.night;
  const expect = (block: { readonly losses: readonly Loss[] | null }, seed: number) => {
    if (block.losses === null) return null;
    const loss = block.losses.find(([s]) => s === seed);
    return loss ? { won: false, reason: loss[1], frame: loss[2] } : { won: true };
  };
  for (const [index, cls] of classes.entries()) {
    const rec = recorded.classes[index];
    const probe = (block: 'development' | 'heldOut', seed: number) => {
      const want = expect(rec[block], seed);
      if (!want) return;
      const got = exactNight(binding, night, seed, cls.representativeMs);
      replays += 1;
      assert.equal(got.won, want.won, `${cls.id} ${block} seed ${seed}: won`);
      if (!want.won) assert.deepEqual([got.reason, got.frame], [want.reason, want.frame], `${cls.id} ${block} seed ${seed}: death`);
    };
    for (const seed of cohort.development.slice(0, 2)) probe('development', seed);
    for (const seed of cohort.heldOut.slice(0, 2)) probe('heldOut', seed);
    for (const block of ['development', 'heldOut'] as const)
      for (const [seed] of (rec[block].losses ?? []).slice(0, 2)) probe(block, seed);
    if (cls.epochsMs.length > 1) {
      const seed = cohort.heldOut[0];
      const a = exactNight(binding, night, seed, cls.representativeMs);
      const b = exactNight(binding, night, seed, cls.epochsMs[cls.epochsMs.length - 1]);
      replays += 2;
      assert.deepEqual(b, a, `${cls.id}: epochs ${cls.representativeMs} and ${cls.epochsMs.at(-1)} share a queue but not a night`);
    }
  }
  for (const seed of cohort.heldOut.slice(0, 2)) {
    const want = expect(recorded.device.heldOut, seed);
    if (!want) continue;
    const got = deviceNight(binding, night, seed);
    replays += 1;
    assert.equal(got.won, want.won, `${binding.name} device seed ${seed}: won`);
    if (!want.won) assert.deepEqual([got.reason, got.frame], [want.reason, want.frame], `${binding.name} device seed ${seed}: death`);
  }
}
console.log(`policy census: ${name} (${record.evidenceId}) holds its pre-registration ${record.preregistration.specSha256.slice(0, 12)}, ` +
  `re-derives its selection (${selectedName}), observation, ${decided.explanations.length} explanation tags and P_max ` +
  `${pMax.successes}/${pMax.n} [${pMax.interval.lo.toFixed(5)}, ${pMax.interval.hi.toFixed(5)}], and ${replays} slice replays match`);
