#!/usr/bin/env node
/** CI guard for stable contract, graph, ADR, and evidence references. */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const SKIP = new Set(['.git', 'node_modules', 'captures', 'artifacts', 'dist', '__pycache__']);
const sourceExtensions = /\.(?:md|txt|js|mjs|ts|py|sh|c|S|json)$/;

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const path = join(directory, entry.name);
    // A nested checkout (a git worktree under .claude/worktrees/ has a `.git`
    // file) is another tree with its own register: an agent's unfinished
    // contract there failed this check on master (2026-09-27).
    if (entry.isDirectory() && existsSync(join(path, '.git'))) continue;
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (sourceExtensions.test(entry.name)) result.push(path);
  }
  return result;
}

const register = JSON.parse(await readFile(join(ROOT, 'packages/core/contracts/register.json'), 'utf8'));
const allowed = {
  CONTRACT: new Set(register.contracts.map(item => item.id)),
  ADR: new Set((await readdir(join(ROOT, 'docs/decisions'))).filter(name => name.endsWith('.md')).map(name => name.replace(/\.md$/, ''))),
  CLAIM: new Set(),
  EVIDENCE: new Set(),
};
const graph = JSON.parse(await readFile(join(ROOT, 'docs/evidence/graph.json'), 'utf8'));
for (const node of graph.nodes ?? []) {
  if (node.id.startsWith('claim.')) allowed.CLAIM.add(node.id.slice('claim.'.length));
  if (node.kind === 'Run') allowed.EVIDENCE.add(node.id);
}

let references = 0;
const failures = [];
for (const path of await walk(ROOT)) {
  const text = await readFile(path, 'utf8');
  for (const [kind, pattern] of Object.entries({
    CONTRACT: /CONTRACT:([a-z0-9-]+)/gi,
    ADR: /ADR:([0-9]{4}-[a-z0-9-]+)/gi,
    CLAIM: /CLAIM:([a-z0-9._-]+)/gi,
    EVIDENCE: /EVIDENCE:([a-z0-9._-]+)/gi,
  })) {
    for (const match of text.matchAll(pattern)) {
      references += 1;
      if (!allowed[kind].has(match[1])) failures.push(`${path.replace(`${ROOT}/`, '')}: unknown ${kind} ${match[1]}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`references: ${references} stable IDs resolve`);
