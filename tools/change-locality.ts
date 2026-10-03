#!/usr/bin/env node
// Change locality (ADR 0002, principle 8): an ordinary extension touches one
// implementation, one registration and its tests. A commit whose staged code
// spans three or more contexts is either a real cross-cutting change or a
// leak -- a feature that needs five contexts to land means an owner is wrong.
// So such a commit states why, in a `Contexts:` line of its message, or is
// split. Documentation, plans, evidence, generated catalogs and root files
// (manifests, lockfile, agent instructions) are registration, not a context.
// `.githooks/commit-msg` runs this on every commit, and `.githooks/pre-push` on every pushed commit (rebase
// and cherry-pick skip commit-msg); PEDRO-OK does not waive it, because the line is one anyone can write.
//
//   node tools/change-locality.ts MSGFILE    exit 0 when local or explained, 1 otherwise
//   node tools/change-locality.ts --push     the same over git's pre-push ref lines on stdin
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pushRanges } from './commit-identity.ts';

export const LIMIT = 3;
const MIN_REASON = 20;

// Records every change may have to touch, whatever its context: paying a
// ratchet's debt lowers an entry here, and that is registration, not a third
// context (the first integration through this gate tripped on it).
const REGISTRATION = new Set(['tools/quality-baseline.json']);

/** The context a staged path belongs to, or null for registration. */
export function contextOf(path: string) {
  if (/^docs\/|^plans\//.test(path) || /\.md$/.test(path) || !path.includes('/') || REGISTRATION.has(path)) return null;
  const pkg = path.match(/^packages\/([^/]+)\//);
  if (pkg) return pkg[1];
  const app = path.match(/^apps\/([^/]+)\//);
  if (app) return `apps/${app[1]}`;
  if (path.startsWith('android/')) return 'companion';
  if (path.startsWith('tools/')) return 'tools';
  return null;
}

export function localityVerdict(paths: string[], message: string) {
  const contexts = [...new Set(paths.map(contextOf).filter((context): context is string => context !== null))].sort();
  if (contexts.length < LIMIT) return { ok: true, contexts };
  const reason = message.split('\n').filter(line => !line.startsWith('#'))
    .map(line => line.match(/^Contexts:\s*(.*)$/)?.[1]?.trim()).find(Boolean);
  return { ok: Boolean(reason && reason.length >= MIN_REASON), contexts, reason: reason ?? null };
}

/** Every commit REVS names (rev-list arguments), read as committed: its changed paths and its message. */
export function scanCommits(revs: readonly string[], cwd = process.cwd()) {
  const git = (args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  const shas = git(['rev-list', '--no-merges', ...revs]).split('\n').filter(Boolean);
  const offenders: { sha: string, subject: string, contexts: string[] }[] = [];
  for (const sha of shas) {
    const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', sha]).split('\0').filter(Boolean);
    const message = git(['log', '-1', '--format=%B', sha]);
    const verdict = localityVerdict(paths, message);
    if (!verdict.ok) offenders.push({ sha, subject: message.split('\n')[0], contexts: verdict.contexts });
  }
  return { checked: shas.length, offenders };
}

const advice = () => {
  console.error('  - split it so each commit stays inside one or two contexts, or');
  console.error(`  - add a line "Contexts: <why this change must cross them>" (${MIN_REASON}+ characters) to the message.`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--push') {
    // Rebase and cherry-pick never run commit-msg: .githooks/pre-push reads each commit the push publishes.
    const offenders = pushRanges(readFileSync(0, 'utf8')).flatMap(revs => scanCommits(revs).offenders);
    for (const { sha, subject, contexts } of offenders)
      console.error(`change locality: ${sha.slice(0, 10)} (${subject}) spans ${contexts.length} contexts (${contexts.join(', ')}) with no Contexts: line.`);
    if (offenders.length) { advice(); process.exit(1); }
  } else {
    const message = readFileSync(process.argv[2], 'utf8');
    const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    const verdict = localityVerdict(staged, message);
    if (!verdict.ok) {
      console.error(`change locality: this commit's code spans ${verdict.contexts.length} contexts ` +
        `(${verdict.contexts.join(', ')}; ADR 0002 principle 8).`);
      advice();
      process.exit(1);
    }
  }
}
