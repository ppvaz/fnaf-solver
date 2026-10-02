// tools/commit-identity.ts and its place in .githooks/commit-msg and .githooks/pre-push.
//
// Every refused address below is invented (example.com and the like): the gate
// exists so that no real one is published again.
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGACY, allowedAddress, parseIdent, pushRanges, refusal, scan } from './commit-identity.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'commit-identity.ts');
const GOOD = 'Hook Test <42+hook-test@users.noreply.github.com>';
const BAD = 'Someone <someone@example.com>';
const ZERO = '0'.repeat(40);
let checks = 0;

// 1. The address rule.
for (const email of ['226608806+ppvaz@users.noreply.github.com', 'ppvaz@users.noreply.github.com',
  '41898282+github-actions[bot]@users.noreply.github.com'])
  assert.ok(allowedAddress(email), `refused a noreply address: ${email}`);
for (const email of ['someone@example.com', 'ppvaz@gmail.com', 't@t', '', 'x@noreply.github.com',
  'ppvaz@users.noreply.github.com.example.com', 'a b@users.noreply.github.com', 'ppvaz@USERS.noreply.github.com.evil'])
  assert.ok(!allowedAddress(email), `allowed ${JSON.stringify(email)}`);
assert.deepEqual(parseIdent('A B <a@b> 1727740800 -0300'), { name: 'A B', email: 'a@b' });
assert.equal(parseIdent('no address'), null);
checks += 3;

// 2. This repository's history: every commit noreply, LEGACY excepted, and LEGACY
// holds only commits that are here and would be refused (it may only shrink).
// Every ident this test reads is well-formed.
const identOf = (text: string) => parseIdent(text) as NonNullable<ReturnType<typeof parseIdent>>;
const history = scan(['HEAD'], ROOT);
assert.ok(history.checked > 1000, `only ${history.checked} commits reachable: a shallow clone? CI checks out with fetch-depth: 0`);
assert.deepEqual(history.offenders, [], refusal(history.offenders, 'the history'));
for (const [sha, why] of LEGACY) {
  const ident = execFileSync('git', ['log', '-1', '--format=%an <%ae>|%cn <%ce>', sha], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.ok(ident.split('|').some(part => !allowedAddress(identOf(part).email)), `${sha} (${why}) is noreply now: drop it from LEGACY`);
}
checks += 2;

// 3. The hooks, in a scratch repository: commit-msg on the identity a commit
// would record, pre-push on every pushed commit, rebase-made ones included.
const repo = mkdtempSync(join(tmpdir(), 'commit-identity-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env }).trim();
const sh = (file: string, args: string[], input?: string) => spawnSync('sh', [file, ...args], { cwd: repo, encoding: 'utf8', env, input });
try {
  git('init', '-q', '-b', 'master');
  git('config', 'user.name', identOf(GOOD).name);
  git('config', 'user.email', identOf(GOOD).email);
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', join(repo, '.git', 'hooks')); // no hooks while the fixture is built
  const commit = (name: string, ...extra: string[]) => { writeFileSync(join(repo, name), `${name}\n`); git('add', name); git('commit', '-q', '-m', name, ...extra); return git('rev-parse', 'HEAD'); };
  const one = commit('one');
  const two = commit('two', `--author=${BAD}`);
  git('checkout', '-q', '-b', 'side', one);
  const three = commit('three');

  // commit-msg: the configured identity, then --author, then a bad user.email.
  const msg = join(repo, 'MSG');
  writeFileSync(msg, 'Subject\n');
  const hook = join(ROOT, '.githooks', 'commit-msg');
  assert.equal(sh(hook, [msg]).status, 0, `hook refused a noreply identity: ${sh(hook, [msg]).stderr}`);
  const author = spawnSync('sh', [hook, msg], { cwd: repo, encoding: 'utf8', env: { ...env, GIT_AUTHOR_NAME: 'Someone', GIT_AUTHOR_EMAIL: 'someone@example.com' } });
  assert.equal(author.status, 1, 'hook let an --author address through');
  assert.match(author.stderr, /commit identity: refused -- this commit[\s\S]*author: Someone <someone@example\.com>/);
  git('config', 'user.email', 'someone@example.com');
  const committer = sh(hook, [msg]);
  assert.equal(committer.status, 1, 'hook let a configured address through');
  assert.match(committer.stderr, /committer: Hook Test <someone@example\.com>/);
  assert.match(committer.stderr, /git config user\.email <id>\+<login>@users\.noreply\.github\.com/);
  git('config', 'user.email', identOf(GOOD).email);
  checks += 3;

  // pre-push ranges: a new branch publishes what no remote has; an update, what the remote lacks.
  assert.deepEqual(pushRanges(`refs/heads/master ${two} refs/heads/master ${ZERO}\n`, repo), [[two, '--not', '--remotes']]);
  assert.deepEqual(pushRanges(`refs/heads/master ${two} refs/heads/master ${one}\n`, repo), [[`${one}..${two}`]]);
  assert.deepEqual(pushRanges(`(delete) ${ZERO} refs/heads/old ${one}\n`, repo), [], 'a deletion publishes nothing');
  assert.deepEqual(pushRanges(`refs/heads/master ${two} refs/heads/master ${'f'.repeat(40)}\n`, repo), [[two, '--not', '--remotes']],
    'a remote tip this clone never fetched falls back to what no remote has');
  checks += 1;

  // pre-push itself: it refuses before the push gate runs, and hands the gate the same lines.
  const prePush = join(ROOT, '.githooks', 'pre-push');
  const refused = sh(prePush, ['origin', 'url'], `refs/heads/master ${two} refs/heads/master ${one}\n`);
  assert.equal(refused.status, 1, 'pre-push let a foreign address through');
  assert.match(refused.stderr, /commit identity: refused -- the push[\s\S]*author: Someone <someone@example\.com>  \(two\)/);
  assert.doesNotMatch(refused.stdout + refused.stderr, /push-gate:/, 'the push gate ran after a refusal');
  const deletion = sh(prePush, ['origin', 'url'], `(delete) ${ZERO} refs/heads/old ${one}\n`);
  assert.equal(deletion.status, 0, deletion.stderr);
  assert.match(deletion.stdout, /push-gate: nothing to validate/, 'the gate did not get the ref lines');
  const clean = spawnSync(process.execPath, [TOOL, '--push'], { cwd: repo, encoding: 'utf8', env, input: `refs/heads/side ${three} refs/heads/side ${one}\n` });
  assert.equal(clean.status, 0, clean.stderr);
  checks += 3;

  // With the real hooks installed, a rebase still replays the foreign commit,
  // because git runs no commit-msg for it; pre-push is what refuses it.
  git('config', 'core.hooksPath', join(ROOT, '.githooks'));
  git('rebase', '-q', '--onto', 'side', one, 'master');
  const replayed = git('rev-parse', 'master');
  assert.notEqual(replayed, two, 'the rebase made a new commit');
  assert.equal(git('log', '-1', '--format=%ae', replayed), 'someone@example.com', 'the replayed commit kept its author');
  const rebased = spawnSync(process.execPath, [TOOL, '--push'], { cwd: repo, encoding: 'utf8', env, input: `refs/heads/master ${replayed} refs/heads/master ${three}\n` });
  assert.equal(rebased.status, 1, 'a rebased foreign commit got through');
  assert.match(rebased.stderr, /author: Someone <someone@example\.com>  \(two\)/);
  const historyCli = spawnSync(process.execPath, [TOOL, '--history'], { cwd: repo, encoding: 'utf8', env });
  assert.equal(historyCli.status, 1, '--history let the scratch history through');
  checks += 2;
} finally {
  rmSync(repo, { recursive: true, force: true });
}

// 4. Both hooks run it, and test:unit runs this gate.
assert.match(readFileSync(join(ROOT, '.githooks', 'commit-msg'), 'utf8'), /tools\/commit-identity\.ts" --hook \|\| exit 1/);
assert.ok(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts['test:unit'].includes('node tools/test-commit-identity.ts'),
  'test:unit does not run tools/test-commit-identity.ts');
checks += 1;

console.log(`commit identity: ${checks} checks pass (${history.checked} commits noreply, ${LEGACY.size} legacy; ` +
  'commit-msg refuses --author and user.email, pre-push refuses before the gate and catches a rebased commit)');
