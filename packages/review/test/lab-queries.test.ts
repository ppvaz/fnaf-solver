// The lab's pure queries (packages/review): the consequence classifier, the mistake registers and
// their tag table, and the ROADMAP step states. Planted changes of each kind are classed, the
// register is read as CLAUDE.md writes it, every entry has a tag row and every row an entry, and
// the ROADMAP still holds every heading and order line the step query quotes. No git, no network.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isUnknown } from '@sixam/kernel';
import { CODE_AREAS, RECORD_RULES, classifyChange, consequenceKey, pathKind } from '../src/consequence.ts';
import { MISTAKE_AREAS, MISTAKE_TAGS, STEP_AREAS, matchMistakes, parseMistakes, readMistakes, stepFamily } from '../src/mistakes.ts';
import { MISTAKE_ENTRIES } from '../src/refusals.ts';
import { ORDER, ORDER_OF, STEPS, closesWhen, mistakeGates, roadmapDrift, stateKey, stepRecords, stepStatus } from '../src/roadmap.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
let checks = 0;

// --- the classifier: planted docs-only, evidence and code changes ------------------------------
const cases = [
  [['docs/research/NOTE.md', 'plans/ROADMAP.md', 'README.md'], 'bookkeeping', 'docs and plans alone'],
  [['docs/evidence/README.md'], 'bookkeeping', "the evidence policy's own README is prose, not a record"],
  [['docs/architecture/generated/command-registry.json', 'package.json'], 'bookkeeping', 'generated catalogs and a manifest'],
  [['docs/evidence/night7-new-record-20260930.json'], 'consequential', 'an evidence record'],
  [['docs/evidence/runs/night1-x-20260930T020000Z/pack.json', 'docs/evidence/graph.json'], 'consequential', 'a run pack and a promotion'],
  [['tools/recompile/results/k3-replay-20260930.json', 'tools/recompile/replay.ts'], 'consequential', 'a host-side record with its code'],
  [['packages/propose/bindings/fnaf2/campaign-night9-z-winner.json'], 'consequential', 'a committed winner'],
  [['packages/review/src/lab-x.mjs', 'packages/review/test/lab-x.test.mjs'], 'consequential', 'solver-interface code with its gate'],
  [['android/companion/src/main/java/X.java', 'android/companion/src/test/java/XTest.java'], 'consequential', 'Companion code with its gate'],
  [['packages/play/src/campaign/campaign.js'], 'UNKNOWN', 'controller code with no gate beside it'],
  [['apps/trainer/src/app.js', 'docs/x.md'], 'UNKNOWN', 'trainer code with no gate beside it'],
  [['packages/core/src/mechanics/plant-model.js', 'packages/core/test/foxy.test.js'], 'bookkeeping', 'model code and a test, no record'],
  [['packages/propose/test/test-seam-slack.ts', '.githooks/commit-msg'], 'bookkeeping', 'gates alone'],
  [[], 'bookkeeping', 'nothing changed'],
];
for (const [paths, expected, why] of cases) {
  const result = classifyChange(paths);
  assert.equal(consequenceKey(result), expected, `${why}: ${JSON.stringify(result)}`);
  if (expected === 'UNKNOWN') assert.ok(isUnknown(result.consequence) && result.consequence.reason.includes('not told from paths'));
  else assert.equal(typeof result.because, 'string');
  checks += 1;
}
assert.deepEqual(pathKind('apps/desktop/src/companion-mcp.ts'), { kind: 'code', area: 'solver-interface' }, 'the MCP server is the solver interface');
assert.deepEqual(pathKind('apps/desktop/src/lab.ts'), { kind: 'code', area: 'solver-interface' });
assert.deepEqual(pathKind('packages/play/bin/phone/actuator.mjs'), { kind: 'code', area: 'controller' });
assert.deepEqual(pathKind('packages/propose/bin/plans/bundle.ts'), { kind: 'code', area: 'controller' }, 'moved device code keeps its area');
assert.deepEqual(pathKind('packages/propose/bin/recompile/pilot/pilot.ts'), { kind: 'code', area: null }, 'rebuild tooling is outside the four areas');
assert.equal(pathKind('packages/source/test/simtest.ts').kind, 'gate');
assert.equal(pathKind('docs/evidence/night5-first-6am-20260912.md').kind, 'record', 'a Markdown evidence record is still a record');
assert.equal(new Set(RECORD_RULES.map(rule => rule.id)).size, RECORD_RULES.length);
assert.deepEqual(CODE_AREAS.map(rule => rule.area).sort(), ['companion', 'controller', 'solver-interface', 'trainer']);
checks += 1;

// --- the mistake registers, read where CLAUDE.md writes them ----------------------------------
const register = readMistakes(ROOT);
assert.ok(['CLAUDE.md', 'docs/operations/MISTAKE-REGISTER.md'].includes(register.source));
const numbers = register.entries.map(entry => entry.n);
assert.ok(numbers.length >= 13, `the registers hold ${numbers.length} entries; 13 on 2026-09-30`);
assert.equal(new Set(numbers).size, numbers.length, 'each entry number once');
for (const [n, lead] of Object.entries(MISTAKE_ENTRIES))
  assert.equal(register.entries.find(entry => entry.n === Number(n))?.lead, lead, `entry ${n}'s lead reads as refusals.mjs cites it`);
assert.equal(register.entries.find(entry => entry.n === 7).lead,
  'A floor is anchored to a measurement plus a named margin, never to the route it protects.', 'a lead that wraps a line is read whole');
// Every entry has a tag row, and every row an entry: a new entry forces a row here.
assert.deepEqual(Object.keys(MISTAKE_TAGS).map(Number).sort((a, b) => a - b), [...numbers].sort((a, b) => a - b),
  'MISTAKE_TAGS has one row per register entry');
for (const [n, tags] of Object.entries(MISTAKE_TAGS)) {
  assert.ok(tags.areas.length && tags.areas.every(area => MISTAKE_AREAS.includes(area)), `entry ${n}'s areas are known`);
  assert.ok(tags.words.length, `entry ${n} has words`);
}
for (const areas of Object.values(STEP_AREAS)) assert.ok(areas.every(area => MISTAKE_AREAS.includes(area)));
assert.deepEqual(Object.keys(STEP_AREAS), STEPS.map(step => step.id), 'every step names its areas');
checks += 1;

const matched = task => matchMistakes(register.entries, task).map(entry => entry.n);
assert.ok([3, 4, 6, 8].every(n => matched({ step: 'S4', text: 'a predeclared Night 7 cohort' }).includes(n)), 'live-device entries for S4');
assert.ok(!matched({ step: 'S4', text: 'a predeclared Night 7 cohort' }).includes(11), 'analysis stays out of an S4 phone task');
assert.ok(matched({ step: 'S1', text: 'a census of the corners' }).includes(11), 'a word in the artifact brings its entry up');
assert.deepEqual(matched({ step: 'S2b', text: '' }), matched({ step: 'S2', text: '' }), 'S2b reads as S2');
assert.equal(stepFamily('S2a'), 'S2');
assert.equal(stepFamily('S3a'), null);
assert.equal(stepFamily('S8'), null);
const planted = parseMistakes('# Register\n\n1. **Known entry wraps\n   onto a second line.** Body text\n   continues.\n\n99. **An untagged entry.** New.\n\nNot an entry.\n');
assert.deepEqual(planted.map(entry => [entry.n, entry.lead]), [[1, 'Known entry wraps onto a second line.'], [99, 'An untagged entry.']]);
assert.equal(planted[0].text, 'Known entry wraps onto a second line. Body text continues.');
assert.ok(matchMistakes(planted, { step: 'S1', text: '' }).some(entry => entry.n === 99 && entry.because.untagged),
  'an entry with no tag row is always printed');
// A moved register is read from its new home first.
const moved = mkdtempSync(join(tmpdir(), 'lab-register-'));
try {
  mkdirSync(join(moved, 'docs/operations'), { recursive: true });
  writeFileSync(join(moved, 'CLAUDE.md'), '1. **Old home.** x\n');
  writeFileSync(join(moved, 'docs/operations/MISTAKE-REGISTER.md'), '1. **New home.** x\n');
  assert.deepEqual(readMistakes(moved), { source: 'docs/operations/MISTAKE-REGISTER.md', entries: [{ n: 1, lead: 'New home.', text: 'New home. x' }] });
} finally { rmSync(moved, { recursive: true, force: true }); }
checks += 1;

// --- the ROADMAP: headings and order lines, and the step states --------------------------------
assert.deepEqual(roadmapDrift(ROOT), [], 'plans/ROADMAP.md still holds every heading and order line the step query quotes');
const closes = closesWhen(ROOT);
for (const step of STEPS) assert.ok(closes[step.id]?.length > 20, `${step.id} has its "Closes when" text`);
assert.match(closes.S1, /graph\.json.*promotion edge/);
assert.equal(ORDER.length, 6);
assert.deepEqual(Object.keys(ORDER_OF).sort(), STEPS.map(step => step.id));
const gates = mistakeGates(ROOT);
for (const n of [5, 7, 9, 12, 13, 8, 10]) assert.ok(gates[n]?.length, `entry ${n} names a gate`);
const records = stepRecords(ROOT);
assert.ok(records.S2.length >= 1 && records.S2.every(row => row.file.endsWith('.json')), 'records that name S2 are found');
checks += 1;

const promotions = ({ edges = 47, modelOnly = [], consistent = true } = {}) => ({
  consistent, lift: { packs: 3, gameRuns: 3 }, edges: { matched: edges, graph: edges, byAttester: {}, byCustody: {} },
  open: { modelOnlyWinners: { count: modelOnly.length, of: 26, winners: modelOnly.map(file => ({ file })) },
    untrackedWinnerDebt: { summary: '1 of 1', untracked: 1, entries: [{ hash: 'fnv1a-x', night: 6, committed: false }] } },
});
const packs = [
  { id: 'fnaf1-a', game: 'com.scottgames.fivenightsatfreddys', promoted: 'claim.fnaf1' },
  { id: 'fnaf3-a', game: 'com.scottgames.fnaf3', promoted: null },
];
const byId = rows => Object.fromEntries(rows.map(row => [row.id, row]));
let rows = byId(stepStatus(ROOT, { promotions: promotions({ modelOnly: ['packages/propose/bindings/fnaf2/a-winner.json'] }), packs }));
assert.equal(rows.S1.state, 'open');
assert.deepEqual(rows.S1.unmet, ['packages/propose/bindings/fnaf2/a-winner.json stands MODEL_ONLY: no run pack names it']);
assert.equal(rows.S1.alsoOpen.length, 1, 'the untracked-winner debt is kept beside the state');
assert.ok(isUnknown(rows.S2.state), 'S2 has no registered closing record kind');
assert.ok(isUnknown(rows.S3.state) && /needs S2/.test(rows.S3.state.reason));
assert.ok(isUnknown(rows.S4.state) && /needs S3/.test(rows.S4.state.reason));
assert.equal(rows.S6.state, 'open');
assert.ok(rows.S6.met.some(item => item.startsWith('FNaF 1: 1 PROMOTED_BY')), 'a promoted FNaF 1 pack meets its game');
assert.ok(rows.S6.unmet.some(item => item.startsWith('FNaF 3: 0 PROMOTED_BY edges over 1')));
const bare = register.entries.map(entry => entry.n).filter(n => !gates[n]);
assert.equal(stateKey(rows.S7), bare.length ? 'open' : 'UNKNOWN');
if (bare.length) assert.match(rows.S7.unmet[0], new RegExp(`^mistake entries ${bare.join(', ')} of`));
rows = byId(stepStatus(ROOT, { promotions: promotions(), packs }));
assert.equal(rows.S1.state, 'closed', 'S1 closes on an edge and no MODEL_ONLY winner');
rows = byId(stepStatus(ROOT, { promotions: promotions({ edges: 0 }), packs }));
assert.equal(rows.S1.state, 'open', 'no edge, no close');
rows = byId(stepStatus(ROOT, { promotions: promotions({ consistent: false }), packs }));
assert.ok(isUnknown(rows.S1.state), 'a graph that disagrees with its packs decides nothing');
checks += 1;

console.log(`lab queries: ${checks} checks pass (${cases.length} planted changes classed; ${register.entries.length} register entries ` +
  `from ${register.source}, each tagged; ${STEPS.length} steps against plans/ROADMAP.md)`);
