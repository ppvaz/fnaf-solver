#!/usr/bin/env node
// Phone-free contract tests for the curated Chronicle and its generated view.
// This checks the presentation's claims are reachable; it does not promote
// any finding or manufacture device evidence.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENTRIES_SCHEMA, ENTRIES_SCHEMA_V2, NIGHTS, checkCorpus, readEntries } from '@sixam/review/chronicle-schema';
import { STORY_OUTPUT, chapterView, checkStory } from '../chronicle-story.ts';
import { generate, loadCorpus, OUTPUT, ROOT } from '../chronicle.ts';
import { currentPath } from '@sixam/review/renamed-path';

// The v1 checkpoints are frozen byte for byte: a correction is a v2 entry that
// supersedes, never an edit (ADR 0002 principle 9; docs/chronicle/README.md).
const FROZEN = {
  'docs/chronicle/entries/2026-08.json': '4356a56205552190cc088a3e4d3c9b3b37d4d07e7deb7f076c0b1f47feb9f112',
  'docs/chronicle/entries/2026-09.json': '3fbd5f7cb467263727b2dc53f8cf53c022f28c80380ba575ca8c23023bfb7716',
};
for (const [file, sha256] of Object.entries(FROZEN))
  assert.equal(createHash('sha256').update(readFileSync(resolve(ROOT, file))).digest('hex'), sha256, `${file} is frozen and changed`);

function sourcePath(source) {
  if (source.startsWith('commit:')) return null;
  const match = source.match(/^(.*?)(?::(\d+))?$/);
  assert(match, `source has no path shape: ${source}`);
  // An entry keeps the path it was written with; a file moved since resolves
  // through git's rename history (ADR 0002 principle 9).
  const now = currentPath(ROOT, match[1]);
  assert(now, `source file does not exist: ${source}`);
  const file = resolve(ROOT, now);
  if (match[2]) {
    const line = Number(match[2]);
    const lines = readFileSync(file, 'utf8').split('\n').length;
    assert(line <= lines, `source line is past EOF: ${source}`);
  }
  return file;
}

function checkSource(source) {
  if (source.startsWith('commit:')) {
    execFileSync('git', ['cat-file', '-e', `${source.slice(7)}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    return;
  }
  sourcePath(source);
}

function checkOutlook(outlook) {
  for (const section of ['next', 'missing']) {
    for (const item of outlook?.[section] ?? []) {
      assert(item.title && item.body, `outlook ${section} item is incomplete`);
      item.sources.forEach(checkSource);
    }
  }
}

const corpus = await loadCorpus();
assert(corpus.entries.length > 0, 'chronicle corpus is empty');
assert(corpus.checkpoints.length > 0, 'chronicle has no checkpoints');
corpus.entries.forEach((entry) => entry.sources.forEach(checkSource));
checkOutlook(corpus.outlook);

const invalid = structuredClone(corpus.checkpoints[0]);
invalid.file = 'fixture.json';
invalid.entries = [structuredClone(invalid.entries[0])];
invalid.entries[0].kind = 'commit-explorer';
assert(checkCorpus([invalid]).some((problem) => problem.includes('kind must be one of')),
  'schema accepted an unknown finding kind');

// chronicle-entries-v2: each rule the v1 schema could not hold, and each guard around it.
const v2 = corpus.checkpoints.find((checkpoint) => checkpoint.schema === ENTRIES_SCHEMA_V2);
assert(v2, 'the corpus holds a chronicle-entries-v2 checkpoint');
const base = { ...structuredClone(v2.entries.find((entry) => entry.game === 'fnaf2' && entry.supersedes === null)), id: 'fixture-entry' };
const fixture = (changes, schema = ENTRIES_SCHEMA_V2) => {
  const entry = { ...base, ...changes };
  if (schema === ENTRIES_SCHEMA) { delete entry.game; delete entry.supersedes; }
  return checkCorpus([...corpus.checkpoints, { schema, checkpoint: schema === ENTRIES_SCHEMA ? '2026-10' : '2026-09z', label: 'fixture', file: 'fixture.json',
    entries: [{ ...entry, date: schema === ENTRIES_SCHEMA ? '2026-10-01' : entry.date }] }]);
};
const refuses = (problems, text, what) => assert(problems.some((problem) => problem.includes(text)), `${what}: ${problems.join(' | ') || 'accepted'}`);
assert.deepEqual(fixture({}), [], 'a well-formed v2 entry passes');
assert.equal(NIGHTS.fnaf4, 8, "FNaF 4's Rulebook names Night 8");
assert.deepEqual(fixture({ game: 'fnaf4', night: 8, route: null, rung: null }), [], 'FNaF 4 Night 8 is a v2 night');
refuses(fixture({ night: 8 }), 'night must be null or 1..7', 'FNaF 2 has no Night 8');
refuses(fixture({ game: 'fnaf5' }), 'game must be one of', 'an unknown game');
refuses(fixture({ game: 'fnaf3' }), "route and rung are FNaF 2's", 'a FNaF 3 entry with a FNaF 2 route');
assert.deepEqual(fixture({ plan: 28 }), [], 'v2 plans are any positive integer');
refuses(fixture({ plan: 28 }, ENTRIES_SCHEMA), 'plan must be null or 1..24', 'v1 plans stay 1..24');
assert.deepEqual(fixture({ label: 'MODEL_ONLY' }), [], 'MODEL_ONLY is a v2 label');
refuses(fixture({ label: 'MODEL_ONLY' }, ENTRIES_SCHEMA), 'label must be one of', 'v1 labels are unchanged');
refuses(fixture({ label: 'MEASURED' }), 'label must be one of', 'a label the evidence docs do not define');
refuses(fixture({ supersedes: 'no-such-entry' }), 'which is not an entry', 'a correction of nothing');
const corrected = v2.entries.find((entry) => entry.supersedes);
refuses(fixture({ supersedes: corrected.supersedes }), 'is superseded by both', 'two corrections of one entry');
const { supersedes: _, ...withoutSupersedes } = base;
refuses(checkCorpus([...corpus.checkpoints, { schema: ENTRIES_SCHEMA_V2, checkpoint: '2026-09z', label: 'fixture', file: 'fixture.json', entries: [withoutSupersedes] }]),
  'supersedes is required', 'a v2 entry without supersedes');
refuses(checkCorpus([...corpus.checkpoints, structuredClone(v2)]), 'is already', 'two checkpoints with one id');

// A correction reads its target as superseded. A frozen v1 target's file is never edited and still says
// standing; a v2 target's file states its side of the pair (checkCorpus refuses one that does not).
const read = readEntries(corpus.checkpoints);
for (const entry of read.filter((item) => item.supersedes)) {
  const target = read.find((item) => item.id === entry.supersedes);
  assert.equal(target.status, 'superseded', `${target.id} reads as superseded`);
  assert.equal(target.supersededBy, entry.id);
  if (target.schema === 'chronicle-entries-v1') assert.equal(target.storedStatus, 'standing', `${target.id}'s frozen file is not edited`);
  else assert.notEqual(target.storedStatus, 'standing', `${target.id}'s v2 file names its correction`);
}

const first = await generate({ write: true });
const second = await generate({ write: false });
assert.equal(first.output, second.output, 'chronicle generation is not deterministic');
assert.equal(readFileSync(OUTPUT, 'utf8'), first.output, 'generated page differs from generator output');
assert.equal(first.storyOutput, second.storyOutput, 'story generation is not deterministic');
assert.equal(readFileSync(STORY_OUTPUT, 'utf8'), first.storyOutput, 'generated story page differs from generator output');

// The story: every chapter's dates come from its standing entries, and every
// entry it draws on is rendered with its title and a link to its card.
const byId = new Map<string, any>(first.entries.map((entry) => [entry.id, entry]));
assert.deepEqual(checkStory(first.story, byId), []);
refuses(checkStory({ ...first.story, chapters: [{ number: 1, title: 'x', entries: ['no-such-entry'] }] }, byId), 'is not a chronicle entry', 'a chapter of nothing');
for (const chapter of first.story.chapters) {
  const view = chapterView(chapter, byId);
  const dates = view.members.filter((entry) => entry.status === 'standing').map((entry) => entry.date).sort();
  assert.equal(view.from, dates[0]);
  assert.equal(view.to, dates.at(-1));
  assert(first.storyOutput.includes(`id="chapter-${chapter.number}"`), `chapter ${chapter.number} is rendered`);
  for (const entry of view.members)
    assert(first.storyOutput.includes(`href="chronicle.html#${entry.id}"`), `chapter ${chapter.number} links ${entry.id}`);
}
assert(first.output.includes("WHAT'S NEXT"), 'generated page has no future section');
assert(first.output.includes("WHAT'S LEFT / MISSING"), 'generated page has no missing-work section');
for (const item of [...(corpus.outlook?.next ?? []), ...(corpus.outlook?.missing ?? [])])
  assert(first.output.includes(item.title), `generated page dropped outlook item: ${item.title}`);

const since = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
checkSource(`commit:${since}`);
const harvested = JSON.parse(execFileSync(process.execPath, ['apps/wiki/chronicle-harvest.ts', '--since', since, '--until', 'HEAD', '--json'], { cwd: ROOT, encoding: 'utf8' }));
assert(Array.isArray(harvested), 'harvester did not emit a JSON array');
for (const candidate of harvested) {
  assert(candidate.id && candidate.date && candidate.sources?.length, 'harvester emitted an incomplete candidate');
  candidate.sources.forEach(checkSource);
}

console.log(`chronicle: ${corpus.entries.length} curated findings over ${corpus.checkpoints.length} checkpoints, ${first.story.chapters.length} story chapters, ${harvested.length} harvest candidates, outlook wired`);
