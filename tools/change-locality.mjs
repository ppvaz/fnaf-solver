#!/usr/bin/env node
// Change locality (ADR 0002, principle 8): an ordinary extension touches one
// implementation, one registration and its tests. A commit whose staged code
// spans three or more contexts is either a real cross-cutting change or a
// leak -- a feature that needs five contexts to land means an owner is wrong.
// So such a commit states why, in a `Contexts:` line of its message, or is
// split. Documentation, plans, evidence, generated catalogs and root files
// (manifests, lockfile, agent instructions) are registration, not a context.
// `.githooks/commit-msg` runs this on every commit; PEDRO-OK does not waive it,
// because the line is one anyone can write.
//
//   node tools/change-locality.mjs MSGFILE    exit 0 when local or explained, 1 otherwise
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LIMIT = 3;
const MIN_REASON = 20;

// Records every change may have to touch, whatever its context: paying a
// ratchet's debt lowers an entry here, and that is registration, not a third
// context (the first integration through this gate tripped on it).
const REGISTRATION = new Set(['tools/quality-baseline.json']);

/** The context a staged path belongs to, or null for registration. @param {string} path */
export function contextOf(path) {
  if (/^docs\/|^plans\//.test(path) || /\.md$/.test(path) || !path.includes('/') || REGISTRATION.has(path)) return null;
  const pkg = path.match(/^packages\/([^/]+)\//);
  if (pkg) return pkg[1];
  const app = path.match(/^apps\/([^/]+)\//);
  if (app) return `apps/${app[1]}`;
  if (path.startsWith('android/')) return 'companion';
  if (path.startsWith('tools/')) return 'tools';
  return null;
}

/** @param {string[]} paths @param {string} message */
export function localityVerdict(paths, message) {
  const contexts = [...new Set(paths.map(contextOf).filter(Boolean))].sort();
  if (contexts.length < LIMIT) return { ok: true, contexts };
  const reason = message.split('\n').filter(line => !line.startsWith('#'))
    .map(line => line.match(/^Contexts:\s*(.*)$/)?.[1]?.trim()).find(Boolean);
  return { ok: Boolean(reason && reason.length >= MIN_REASON), contexts, reason: reason ?? null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const message = readFileSync(process.argv[2], 'utf8');
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const verdict = localityVerdict(staged, message);
  if (!verdict.ok) {
    console.error(`change locality: this commit's code spans ${verdict.contexts.length} contexts ` +
      `(${verdict.contexts.join(', ')}; ADR 0002 principle 8).`);
    console.error('  - split it so each commit stays inside one or two contexts, or');
    console.error(`  - add a line "Contexts: <why this change must cross them>" (${MIN_REASON}+ characters) to the message.`);
    process.exit(1);
  }
}
