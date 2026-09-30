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
 * @param {string} [root]
 */
export function repoFiles(root = ROOT) {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.split('\0').filter(Boolean))]
    .filter(path => !FROZEN.some(pattern => pattern.test(path)))
    .filter(path => existsSync(join(root, path)) && statSync(join(root, path)).isFile())
    .sort();
}

/** @param {string} section @param {string} [root] */
export function loadBaseline(section, root = ROOT) {
  const record = JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
  if (record.schema !== 'quality-baseline-v1') throw new Error(`${BASELINE}: schema must be quality-baseline-v1`);
  const found = record[section];
  if (!found) throw new Error(`${BASELINE} has no "${section}" section`);
  if (typeof found.why !== 'string' || !found.why.trim()) throw new Error(`${BASELINE} ${section}: the section needs a why`);
  return found;
}

/**
 * Compare what a gate found with its recorded debt.
 * @param {Map<string, {count: number, detail?: string}>} found
 * @param {{entries: Record<string, number | {count: number, why: string}>}} baseline
 * @returns {string[]} one line per failure, empty when the tree matches the record
 */
export function ratchet(found, baseline) {
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
 * @param {string} gate @param {string[]} failures @param {string} summary
 */
export function report(gate, failures, summary) {
  if (!failures.length) {
    console.log(`${gate}: ${summary}`);
    return;
  }
  console.error(`${gate}: ${failures.length} finding(s)`);
  for (const line of failures) console.error(`  ${line}`);
  process.exitCode = 1;
}
