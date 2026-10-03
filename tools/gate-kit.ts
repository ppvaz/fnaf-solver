// What the quality gates share: the files a gate scans, the frozen set it never
// scans, and the ratchet that holds recorded debt in tools/quality-baseline.json.
//
// A ratchet lets a gate land on a tree that already carries the debt it
// measures: what was there when the gate landed is recorded with its count, a
// new finding fails, and a recorded one that shrank or went away fails too
// until its entry is lowered or removed, so the record only ever shrinks and
// never goes stale. An entry is a count (debt recorded when its section landed,
// covered by the section's `why`) or `{count, why}` for one accepted since.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE = 'tools/quality-baseline.json';

// Records frozen byte for byte (CLAUDE.md, ADR 0002): never edited, so never scanned.
export const FROZEN = [/^docs\/evidence\//, /^docs\/chronicle\//, /^tools\/recompile\/results\//, /^plans\/archive\//];

/**
 * Tracked files plus untracked ones git does not ignore, so a new file is
 * judged before it is committed; frozen records and deleted paths are left out.
 */
/**
 * The environment with every GIT_* variable removed, for a gate that runs git in a
 * scratch repository. A git hook or `git rebase -x` exports GIT_DIR, and git honours
 * it over the working directory and `-C`: run with it, a fixture's `git init`,
 * `config`, `add` and `commit` write into the caller's repository instead of the
 * scratch one (on 2026-10-03 a gate under `rebase -x` replaced a worktree's index with
 * its two fixture files, and another committed its fixture history onto HEAD).
 */
export function gitFreeEnv(env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));
}

export function repoFiles(root: string = ROOT) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.split('\0').filter(Boolean))]
    .filter(path => !FROZEN.some(pattern => pattern.test(path)))
    .filter(path => existsSync(join(root, path)) && statSync(join(root, path)).isFile())
    .sort();
}

export function loadBaseline(section: string, root: string = ROOT) {
  const record = JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
  if (record.schema !== 'quality-baseline-v1') throw new Error(`${BASELINE}: schema must be quality-baseline-v1`);
  const found = record[section];
  if (!found) throw new Error(`${BASELINE} has no "${section}" section`);
  if (typeof found.why !== 'string' || !found.why.trim()) throw new Error(`${BASELINE} ${section}: the section needs a why`);
  return found;
}

/**
 * Compare what a gate found with its recorded debt.
 *
 * @returns one line per failure, empty when the tree matches the record
 */
export function ratchet(found: Map<string, {count: number, detail?: string}>, baseline: {entries: Record<string, number | {count: number, why: string}>}): string[] {
  const failures = [];
  const recorded = new Map(Object.entries(baseline.entries ?? {}).map(([key, entry]) => {
    if (typeof entry === 'number') return [key, entry];
    if (!entry || typeof entry.why !== 'string' || !entry.why.trim() || !Number.isInteger(entry.count))
      failures.push(`${key}: a baseline entry is a count or {count, why} with a reason`);
    return [key, entry?.count];
  }));
  for (const [key, { count, detail }] of found) {
    const allowed = recorded.get(key);
    if (allowed === undefined) failures.push(`${key}: new${detail ? ` (${detail})` : ''}`);
    else if (count > allowed) failures.push(`${key}: grew from ${allowed} to ${count}${detail ? ` (${detail})` : ''}`);
    else if (count < allowed) failures.push(`${key}: shrank from ${allowed} to ${count}; lower its entry in ${BASELINE}`);
  }
  for (const key of recorded.keys())
    if (!found.has(key)) failures.push(`${key}: gone; remove its entry from ${BASELINE}`);
  return failures;
}

/**
 * Print a gate's verdict and set the exit code.
 */
export function report(gate: string, failures: string[], summary: string) {
  if (!failures.length) {
    console.log(`${gate}: ${summary}`);
    return;
  }
  console.error(`${gate}: ${failures.length} finding(s)`);
  for (const line of failures) console.error(`  ${line}`);
  process.exitCode = 1;
}
