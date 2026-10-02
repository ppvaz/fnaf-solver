#!/usr/bin/env node
// Refuse a commit whose author or committer address is not a GitHub noreply
// address (Pedro, 2026-09-30).
//
// The repository is public and every commit publishes both addresses. On
// 2026-09-30 one machine's git config had put a corporate address on 263
// commits, and taking it out meant rewriting and force-pushing history
// (docs/evidence/history-rewrite-20260930.json). The one form allowed is
// GitHub's noreply address, `<id>+<login>@users.noreply.github.com` or the
// older `<login>@users.noreply.github.com`.
//
// It runs in three places, because no one of them sees every way a commit is
// made (measured on git 2.47, 2026-09-30):
//
//   --hook           .githooks/commit-msg, on the identity `git commit` is
//                    about to record. git exports the author to the hook, so
//                    `--author` and `--amend` are seen.
//   --push           .githooks/pre-push, on git's ref lines: every commit being
//                    pushed. Rebase and cherry-pick never run commit-msg, and
//                    they are how a rewritten history gets an old commit back.
//   --history [REV]  test:unit, so CI, which clones with full history: every
//                    commit reachable from REV (default HEAD). A clone without
//                    `core.hooksPath` runs neither hook; CI still goes red.
//
// Two commits of 2026-09-19 were made as `t <t@t>` and are kept (ADR 0002,
// decision 10). LEGACY names them; it may only shrink.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const NOREPLY = /^(?:\d+\+)?[A-Za-z0-9-]+(?:\[bot\])?@users\.noreply\.github\.com$/;
const ZERO = /^0+$/;

export const LEGACY = new Map([
  ['bd98fd4d07cc4bc4defd87801d547da325be18bf', 't <t@t>, 2026-09-19, "root"'],
  ['939f8bd3194e909595d01364569b1357cc6d8dd8', 't <t@t>, 2026-09-19, "root"'],
]);

export const allowedAddress = (email: string) => NOREPLY.test(email);

// `Name <email> 1727740800 -0300` (git var) or `Name <email>` -> { name, email }.
export function parseIdent(ident: unknown) {
  const m = /^(.*?) <([^>]*)>/.exec(String(ident).trim());
  return m ? { name: m[1], email: m[2] } : null;
}

const git = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });

// Every commit `git log REVS` lists, with the roles whose address is refused:
// { checked, offenders: [{ sha, subject, role, ident }] }. LEGACY commits pass.
export function scan(revs: string[], cwd = process.cwd()) {
  const out = git(['log', '--format=%H%x1f%an <%ae>%x1f%cn <%ce>%x1f%s%x1e', ...revs, '--'], cwd);
  const offenders = [];
  let checked = 0;
  for (const record of out.split('\x1e')) {
    const [sha, author, committer, subject] = record.trim().split('\x1f');
    if (!sha) continue;
    checked += 1;
    if (LEGACY.has(sha)) continue;
    for (const [role, ident] of [['author', author], ['committer', committer]]) {
      if (!allowedAddress(parseIdent(ident)?.email ?? '')) offenders.push({ sha, subject, role, ident });
    }
  }
  return { checked, offenders };
}

// git's pre-push lines `<local ref> <local sha> <remote ref> <remote sha>` ->
// the rev-list arguments naming the commits each one would publish.
export function pushRanges(input: unknown, cwd = process.cwd()) {
  const ranges = [];
  for (const line of String(input).split('\n')) {
    const [, local, , remote] = line.trim().split(/\s+/);
    if (!local || ZERO.test(local)) continue; // a deletion publishes nothing
    let known = false;
    if (remote && !ZERO.test(remote)) {
      try {
        execFileSync('git', ['cat-file', '-e', `${remote}^{commit}`], { cwd, stdio: 'ignore' });
        known = true;
      } catch { /* not fetched */ }
    }
    ranges.push(known ? [`${remote}..${local}`] : [local, '--not', '--remotes']);
  }
  return ranges;
}

/** A refused identity: its role and ident, and the commit that carries it when there is one. */
interface Offender { readonly sha?: string, readonly subject?: string, readonly role: string, readonly ident: string }

export function refusal(offenders: readonly Offender[], where: string) {
  const lines = [`commit identity: refused -- ${where} carries an address that is not GitHub's noreply form`];
  for (const o of offenders) lines.push(`  ${o.sha ? `${o.sha.slice(0, 10)} ` : ''}${o.role}: ${o.ident}${o.subject ? `  (${o.subject})` : ''}`);
  lines.push(
    'Allowed: <id>+<login>@users.noreply.github.com (GitHub, Settings > Emails).',
    'Set it for this clone:  git config user.email <id>+<login>@users.noreply.github.com',
    'Then fix what is already committed and not yet pushed:',
    '  the last commit:      git commit --amend --no-edit --reset-author',
    '  several commits:      git rebase -r <base> --exec "git commit --amend --no-edit --reset-author"',
    'A commit already on origin needs a history rewrite: ask Pedro, never force-push on your own.',
  );
  return lines.join('\n');
}

function main(argv: string[]) {
  const [mode, rev] = argv;
  if (mode === '--hook') {
    const offenders = [];
    for (const [role, variable] of [['author', 'GIT_AUTHOR_IDENT'], ['committer', 'GIT_COMMITTER_IDENT']]) {
      const ident = git(['var', variable]).trim().replace(/ \d+ [-+]\d{4}$/, '');
      if (!allowedAddress(parseIdent(ident)?.email ?? '')) offenders.push({ role, ident });
    }
    if (offenders.length) { console.error(refusal(offenders, 'this commit')); return 1; }
    return 0;
  }
  if (mode === '--push') {
    const offenders = pushRanges(readFileSync(0, 'utf8')).flatMap(revs => scan(revs).offenders);
    if (offenders.length) { console.error(refusal(offenders, 'the push')); return 1; }
    return 0;
  }
  if (mode === '--history') {
    const { checked, offenders } = scan([rev || 'HEAD']);
    if (!checked) { console.error('commit identity: no commits to check'); return 1; }
    if (offenders.length) { console.error(refusal(offenders, 'the history')); return 1; }
    console.log(`commit identity: ${checked} commits from ${rev || 'HEAD'} carry noreply addresses (${LEGACY.size} legacy t <t@t> excepted)`);
    return 0;
  }
  console.error('usage: commit-identity.ts --hook | --push (ref lines on stdin) | --history [REV]');
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
