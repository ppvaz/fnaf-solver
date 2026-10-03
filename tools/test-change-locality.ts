#!/usr/bin/env node
// Pins tools/change-locality.ts: which paths are contexts, when a commit needs
// a `Contexts:` line, and that `.githooks/commit-msg` runs it.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { contextOf, localityVerdict, scanCommits } from './change-locality.ts';

assert.equal(contextOf('packages/play/src/campaign/planted.js'), 'play');
assert.equal(contextOf('apps/trainer/src/planted.js'), 'apps/trainer');
assert.equal(contextOf('android/companion/src/com/ppvaz/fnafcompanion/NightRunner.java'), 'companion');
assert.equal(contextOf('tools/gate-kit.ts'), 'tools');
for (const registration of ['package.json', 'CLAUDE.md', 'docs/architecture/generated/import-graph.json', 'tools/quality-baseline.json',
  'plans/ROADMAP.md', 'packages/play/README.md', 'docs/evidence/runs/x/pack.json'])
  assert.equal(contextOf(registration), null, `${registration} is registration, not a context`);

const three = ['packages/source/src/a.js', 'packages/propose/src/b.js', 'packages/play/src/c.js', 'package.json'];
assert.equal(localityVerdict(three.slice(0, 2), 'Subject').ok, true, 'two contexts need no reason');
assert.equal(localityVerdict(three, 'Subject\n\nbody').ok, false, 'three contexts without a reason must be refused');
assert.equal(localityVerdict(three, 'Subject\n\nContexts: too short').ok, false, 'a token reason must be refused');
assert.equal(localityVerdict(three, '# Contexts: a commented line is not the message\nSubject').ok, false);
assert.equal(localityVerdict(three,
  'Subject\n\nContexts: the control id rename is a stored-name change every reader must follow').ok, true);
assert.deepEqual(localityVerdict(three, 'x').contexts, ['play', 'propose', 'source']);

const hook = readFileSync(new URL('../.githooks/commit-msg', import.meta.url), 'utf8');
assert.match(hook, /tools\/change-locality\.ts/, 'the commit-msg hook must run the change-locality check');

// Rebase and cherry-pick never run commit-msg, so pre-push reads every pushed commit again.
const prePush = readFileSync(new URL('../.githooks/pre-push', import.meta.url), 'utf8');
assert.match(prePush, /tools\/change-locality\.ts" --push/, 'the pre-push hook must check the pushed commits');
{
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'change-locality-')));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'master');
    git('config', 'user.email', 'planted@users.noreply.github.com');
    git('config', 'user.name', 'Planted');
    git('commit', '-q', '--allow-empty', '-m', 'Base');
    const base = git('rev-parse', 'HEAD');
    const commit = (message: string) => {
      for (const path of three) { mkdirSync(join(repo, dirname(path)), { recursive: true }); writeFileSync(join(repo, path), `${message}\n`); }
      git('add', '-A');
      git('commit', '-q', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    const bare = commit('Touch three contexts with no reason');
    commit('Touch three contexts again\n\nContexts: a planted change that states why it crosses all three');
    const { checked, offenders } = scanCommits([`${base}..HEAD`], repo);
    assert.equal(checked, 2, 'both pushed commits are read');
    assert.deepEqual(offenders.map(item => item.sha), [bare], 'only the unexplained three-context commit is refused');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}
console.log('change-locality: contexts, the three-context limit, the Contexts: line, the commit-msg hook and the pushed range are pinned');
