#!/usr/bin/env node
/** Small lexical retrieval gate for the repository's human-facing indexes. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const SKIP = new Set(['.git', 'node_modules', 'artifacts', 'dist', 'captures', '__pycache__']);
const TEXT = /\.(?:md|txt|json)$/;
const ROUTES = /^(?:README\.md|CLAUDE\.md|CONTRIBUTING\.md|docs\/(?:README\.md|architecture\/(?:README|DEPENDENCY-GRAPH)\.md|evidence\/README\.md)|(?:packages|apps)\/[^/]+\/README\.md)$/;

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (TEXT.test(entry.name)) result.push(path);
  }
  return result;
}

const tokenise = text => new Set(text.toLowerCase().match(/[a-z0-9][a-z0-9._/-]*/g) ?? []);
const corpus = [];
for (const path of (await walk(ROOT)).sort()) {
  const id = relative(ROOT, path);
  if (ROUTES.test(id)) corpus.push({ path: id, tokens: tokenise(await readFile(path, 'utf8')) });
}

// Queries are phrased as a newcomer would ask them. The expected path is a
// reachable authority, not merely a file containing one keyword. Top-five
// retrieval catches index drift while remaining independent of a search service.
const queries = [
  { id: 'semantic-command-boundary', terms: 'canonical mechanics semantic contracts validators', expected: 'packages/core/README.md' },
  { id: 'safe-device-run', terms: 'device live lease abort qualification', expected: 'apps/device/README.md' },
  { id: 'evidence-replay', terms: 'evidence replay result hash manifest', expected: 'docs/evidence/README.md' },
  { id: 'architecture-ownership', terms: 'architecture dependency direction package', expected: 'docs/architecture/DEPENDENCY-GRAPH.md' },
  { id: 'research-operation', terms: 'research experiment candidate evaluator statistics', expected: 'packages/propose/README.md' },
];

const search = query => {
  const terms = tokenise(query.terms);
  return corpus.map(item => ({
    path: item.path,
    score: [...terms].reduce((score, term) => score + (item.tokens.has(term) ? 1 : 0), 0),
  })).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
};

const results = queries.map(query => {
  const ranked = search(query);
  const top = ranked.slice(0, 5);
  assert.ok(top.some(item => item.path === query.expected),
    `${query.id}: ${query.expected} not in top five (${top.map(item => item.path).join(', ')})`);
  return { id: query.id, expected: query.expected, top };
});
console.log(JSON.stringify({ schema: 'retrieval-benchmark-v1', corpus: corpus.length, queries: results }, null, 2));
console.log(`retrieval: ${results.length}/${queries.length} newcomer queries reach their expected authority in top five`);
