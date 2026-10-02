// `npm run evidence` on a clean checkout. artifacts/ is gitignored, so there every run the
// repository can speak about is a committed pack under docs/evidence/runs/. Until 2026-09-29
// `why` and `diff` read artifacts/ only and failed with a raw ENOENT on all 184 committed packs,
// `replay` crashed on the FNaF 1 pack, and a misspelled id got the same ENOENT. This runs the
// CLI itself against committed packs of each custody kind and pins: `why`, `show`, `diff` and
// `replay` read the pack; what a recovered pack lost is named, not thrown; an unknown id is
// refused with the nearest ids; and `promotions` prints exactly the library's summary. Under
// `--envelope`, `show` and `promotions` print that same object as the claim of a
// claim-envelope-v1 (Plan 28 step 1), while their default output stays byte for byte.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS_DIR, readPack, trackedWinners } from '@sixam/review/evidence-pack';
import type { RunPack } from '@sixam/review/evidence-pack';
import { promotionSummary } from '@sixam/review/evidence-promotion';
import { validateClaimEnvelope } from '@sixam/kernel';
import type { ClaimEnvelope, Unknown } from '@sixam/kernel';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '../../..'));
const CLI = join(ROOT, 'apps/desktop/src/evidence.ts');
// The FNaF 1 pack's events.jsonl is 1.5 MB, and `why` prints all of it: past spawnSync's 1 MB default.
const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
const json = (result: ReturnType<typeof cli>, what: string) => {
  assert.equal(result.status, 0, `${what} exits 0; stderr: ${result.stderr}`);
  return JSON.parse(result.stdout);
};

// One committed pack of each custody kind. They are night-run labels (or a FNaF 1 run
// directory), which live under artifacts/runs/, never artifacts/<id>: so the pack is what
// every reading below exercises, on this machine as on CI's clone.
const FNAF1 = 'fnaf1-custom-grid420-420-a-20260925T024452598Z';
const ORIGINAL = 'night1-ladder-n1e-20260927T055611Z';
const RESULT_LOST = 'night1-minus7-n1-first-20260919T215053Z';
const RECOVERED = 'night1-minus7-n1-first-20260919T215533Z';
const packDir = (id: string) => join(ROOT, PACKS_DIR, id);
for (const id of [FNAF1, ORIGINAL, RESULT_LOST, RECOVERED]) {
  assert.ok(existsSync(join(packDir(id), 'pack.json')), `${id} is a committed pack`);
  assert.ok(!existsSync(join(ROOT, 'artifacts', id)), `artifacts/${id} would shadow the pack this test reads`);
}
const packJson = (id: string): RunPack => JSON.parse(readFileSync(join(packDir(id), 'pack.json'), 'utf8'));
const rows = (id: string) => readFileSync(join(packDir(id), 'events.jsonl'), 'utf8').split('\n').filter(line => line.trim())
  .map(line => JSON.parse(line));

// promotions runs beside everything else: it compiles every committed winner (~7 s), and the
// in-process summary it must equal byte for byte compiles them again. So does its --envelope.
const background = (...args: string[]) => new Promise<{ status: number | null, stdout: string, stderr: string }>((done, fail) => {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', fail);
  child.on('close', status => done({ status, stdout, stderr }));
});
const promotionsRun = background('promotions');
const promotionsEnvelopeRun = background('promotions', '--envelope');

// --- why: the pack's event rows, verbatim, with the custody they came through ----------------
for (const id of [FNAF1, ORIGINAL, RESULT_LOST]) {
  const trace = json(cli('why', id), `why ${id}`);
  assert.equal(trace.schema, 'causal-trace-v1');
  assert.equal(trace.run, id);
  assert.equal(trace.source, 'pack', `why ${id} reads the committed pack`);
  assert.deepEqual(trace.events, rows(id), `why ${id} prints every event row of the pack as it was appended`);
  assert.deepEqual(trace.custody, { kind: packJson(id).custody?.kind ?? 'original', lost: packJson(id).custody?.lost ?? [] });
}
assert.equal(json(cli('why', FNAF1), 'why').kind, 'fnaf1-run');
assert.ok(json(cli('why', RESULT_LOST), 'why').custody.lost.includes('result.json'),
  'a pack whose result was lost still has its event rows, and says what it lost');

// --- show: the pack's entry, digest and custody --------------------------------------------------
const shown = json(cli('show', ORIGINAL), 'show');
assert.equal(shown.source, 'pack');
assert.equal(shown.kind, 'device-campaign');
assert.equal(shown.packSha256, readPack(packDir(ORIGINAL)).digest, 'show names the sha256 an attestation binds');
assert.deepEqual(shown.custody, { kind: 'original', lost: [] });
const lostShown = json(cli('show', RESULT_LOST), 'show');
assert.equal(lostShown.outcome, 'RESULT_LOST', 'no result is invented for a pack that lost it');
assert.ok(lostShown.custody.lost.includes('result.json'));
assert.equal(json(cli('show', FNAF1), 'show').kind, 'fnaf1-run');

// --- show --envelope: the same object as a claim-envelope-v1 at the record's own claim level -----
for (const id of [FNAF1, ORIGINAL, RESULT_LOST, RECOVERED]) {
  const plain = json(cli('show', id), `show ${id}`);
  const wrapped = validateClaimEnvelope(json(cli('show', id, '--envelope'), `show ${id} --envelope`)) as ClaimEnvelope; // show of a committed pack answers, it does not refuse
  assert.deepEqual(wrapped.claim, plain, `show ${id} --envelope wraps exactly what show prints`);
  const level = packJson(id).claimLevel;
  if (level === 'UNKNOWN') assert.equal((wrapped.label as Unknown).kind, 'UNKNOWN', `${id}'s UNKNOWN claim level stays UNKNOWN, with its reason`);
  else assert.equal(wrapped.label, level, `${id}'s envelope carries its pack's claim level`);
  // Only the FNaF 1 pack's target is read, and that pack names its game's package.
  assert.equal(wrapped.target, id === FNAF1 ? (packJson(id).target as { package: string }).package : 'com.scottgames.fnaf2');
  assert.equal(wrapped.reproducer, `npm run evidence -- show ${id}`);
  for (const name of packJson(id).custody?.lost ?? [])
    assert.ok(wrapped.notMeasured.some(item => item.startsWith(`${name}:`)), `${id}: lost ${name} is named as not measured`);
}

// --- diff: two committed packs, file by file, the lost result named ----------------------------
const diff = json(cli('diff', RESULT_LOST, RECOVERED), 'diff');
assert.equal(diff.schema, 'evidence-diff-v1');
const leftFiles = packJson(RESULT_LOST).files;
const rightFiles = packJson(RECOVERED).files;
const rightBy = new Map(rightFiles.map(file => [file.name, file.sha256]));
const leftBy = new Map(leftFiles.map(file => [file.name, file.sha256]));
assert.deepEqual(diff.changed, leftFiles.filter(file => rightBy.has(file.name) && rightBy.get(file.name) !== file.sha256).map(file => file.name));
assert.deepEqual(diff.unchanged, leftFiles.filter(file => rightBy.get(file.name) === file.sha256).map(file => file.name));
assert.deepEqual(diff.onlyLeft, leftFiles.filter(file => !rightBy.has(file.name)).map(file => file.name));
assert.deepEqual(diff.onlyRight, rightFiles.filter(file => !leftBy.has(file.name)).map(file => file.name));
assert.ok(diff.changed.includes('events.jsonl') && diff.onlyRight.includes('result.json'));
assert.deepEqual([diff.sides.left.source, diff.sides.right.source], ['pack', 'pack']);
assert.deepEqual([diff.sides.left.outcome, diff.sides.right.outcome], ['RESULT_LOST', packJson(RECOVERED).outcome]);
assert.equal(diff.sides.left.packSha256, readPack(packDir(RESULT_LOST)).digest);
assert.ok(diff.unavailable.some((line: string) => line.startsWith(`${PACKS_DIR}/${RESULT_LOST} lost `) && line.includes('result.json')
  && line.includes('recovered-from-run-log')), 'the left pack\'s lost result is named, not compared as if empty');
const self = json(cli('diff', ORIGINAL, ORIGINAL), 'diff');
assert.deepEqual([self.changed, self.onlyLeft, self.onlyRight], [[], [], []]);
assert.deepEqual(self.unchanged, packJson(ORIGINAL).files.map(file => file.name));
assert.deepEqual(self.unavailable, [], 'a pack of original custody lost nothing');

// --- replay: a night on the phone is not a deterministic replay, and says so --------------------
for (const id of [FNAF1, ORIGINAL]) {
  const replay = cli('replay', id);
  assert.equal(replay.status, 0, replay.stderr);
  assert.match(replay.stdout, new RegExp(`^replay=${id} status=NOT_REPLAYABLE reason="`));
}

// --- an unknown id: the nearest ids, then where the whole list is ------------------------------
const packs = new Set(readdirSync(join(ROOT, PACKS_DIR)));
const refused = (result: ReturnType<typeof cli>, typo: string, nearest?: string, noun = 'run or pack') => {
  assert.notEqual(result.status, 0, `an unknown id exits non-zero: ${typo}`);
  assert.equal(result.stdout, '', 'and prints nothing on stdout');
  const lines = result.stderr.trimEnd().split('\n');
  assert.equal(lines[0], `evidence: no ${noun} named ${typo}`);
  assert.equal(lines[1], 'nearest ids:');
  assert.equal(lines.length, 6, result.stderr);
  const suggested = lines.slice(2, 5).map(line => line.replace(/^ {2}/, ''));
  assert.ok(suggested.every(id => packs.has(id) || existsSync(join(ROOT, 'artifacts', id))), `${suggested} are ids that exist`);
  if (nearest) assert.equal(suggested[0], nearest, `the nearest id to ${typo} comes first`);
  assert.equal(lines[5], '`npm run evidence -- list` shows them all');
  assert.ok(!result.stderr.includes('ENOENT'));
  return suggested;
};
const typo = 'night1-ladder-n1f-20260927T055611Z';
refused(cli('why', typo), typo, ORIGINAL);
refused(cli('show', typo), typo, ORIGINAL);
refused(cli('replay', typo), typo, ORIGINAL);
refused(cli('promote', typo), typo, ORIGINAL);
refused(cli('diff', ORIGINAL, typo), typo, ORIGINAL);
refused(cli('why', 'fnaf1-custom-grid420-420-a-20260925T024452589Z'), 'fnaf1-custom-grid420-420-a-20260925T024452589Z', FNAF1);
assert.ok(refused(cli('show', 'night1-minus7-n1-first'), 'night1-minus7-n1-first')
  .every(id => id.startsWith('night1-minus7-n1-first')), 'an id typed as a prefix suggests the ids it begins');
refused(cli('attest', typo, '--by', 'agent', '--note', 'test-evidence-cli'), typo, ORIGINAL, 'pack');
// Flags may come before the pack id: the id is the positional, never the word after `attest`.
refused(cli('attest', '--by', 'agent', '--note', 'test-evidence-cli', typo), typo, ORIGINAL, 'pack');
assert.ok(!existsSync(packDir(typo)), 'a refused attestation writes nothing');

// --- arguments: a flag an operation does not take is refused, not ignored ------------------------
const misspelt = cli('show', ORIGINAL, '--envelop');
assert.equal(misspelt.status, 2, 'a misspelt flag exits 2');
assert.equal(misspelt.stdout, '', 'and prints no record that looks like what was asked');
assert.match(misspelt.stderr, /^evidence: .*--envelop/);
assert.match(cli('pack', ORIGINAL, '--envelope').stderr, /^evidence: pack takes no --envelope/);
assert.match(cli('diff', ORIGINAL).stderr, /^evidence: diff needs two ids/);
assert.match(cli('show', ORIGINAL, ORIGINAL).stderr, /^evidence: show takes one id/);
assert.match(cli('attest', ORIGINAL, '--by').stderr, /^evidence: .*--by/, 'a flag missing its value is refused');

// --- promotions: byte for byte the library's summary ----------------------------------------------
const summary = promotionSummary(ROOT, trackedWinners(ROOT));
const expected = `${JSON.stringify(summary, null, 2)}\n`;
const promotions = await promotionsRun;
assert.equal(promotions.status, 0, promotions.stderr);
assert.equal(promotions.stdout, expected, 'promotions prints exactly promotionSummary, nothing added or reordered');
const wrappedPromotions = await promotionsEnvelopeRun;
assert.equal(wrappedPromotions.status, 0, wrappedPromotions.stderr);
const promotionsEnvelope = validateClaimEnvelope(JSON.parse(wrappedPromotions.stdout)) as ClaimEnvelope; // promotions answers, it does not refuse
assert.deepEqual(promotionsEnvelope.claim, summary, 'promotions --envelope wraps exactly the summary');
assert.equal(promotionsEnvelope.label, 'DEVICE_MEASURED');
assert.ok(summary.refusedWins.every(win => promotionsEnvelope.notMeasured.some(item => item.startsWith(`${win.id}:`))),
  'every executor 6 AM that is not promoted is named as not measured');

console.log(`evidence cli: why, show, diff and replay read committed packs (${packs.size} here), a lost result is named rather than thrown, `
  + 'an unknown id gets the three nearest ids, promotions prints the library summary byte for byte, and show and promotions '
  + 'wrap exactly that output in claim-envelope-v1 under --envelope');
