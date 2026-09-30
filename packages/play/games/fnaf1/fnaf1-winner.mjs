#!/usr/bin/env node
/**
 * Re-run a committed FNaF 1 route winner on the phone exactly as it won.
 *
 *   packages/play/games/fnaf1/fnaf1-winner.mjs --winner packages/propose/bindings/fnaf1/fnaf1-custom-night7-420-grid420-winner.json
 *   packages/play/games/fnaf1/fnaf1-winner.mjs --winner FILE --live --confirm-live [--label NAME]
 *   npm run night -- fnaf1-winner --winner FILE --live --confirm-live [--label NAME]
 *
 * A `fnaf1-route-winner-v1` pins its route by sha256, as the files stood at
 * `sourcesAtCommit`. The tree moves on -- e6de745 changed grid420 and the
 * runner after 420-a won at 3aaf02c -- so the winner's own `command`, run from
 * the tree, executes a route that never won. This materializes the whole tree
 * of that commit from git, checks every file in it against the commit's own
 * blob ids and every pinned file against the winner's sha256, and runs that
 * tree's `fnaf1-custom-run.sh` with the won command's arguments (only the label
 * changes) under THIS checkout's serial lease. The materialized tree's
 * `artifacts` and `captures` are links into this checkout, so the run record,
 * the lease and the helper's endpoint are the ones any other run uses, and
 * `npm run night` packs the run as usual. Each run directory the replay
 * created gets a `replay.json` naming the winner, the commit and the checks.
 *
 * The whole commit runs, not only the pinned files: the runner's import
 * closure (menu probe, adb bridge, HID transport, the Companion port) and the
 * scripts it spawns (title observer, dial reader, teardown) are that commit's
 * too, which is what ran on 2026-09-25. Workspace packages resolve inside the
 * materialized tree, never to this checkout's.
 *
 * Without --live this is the dry run: it materializes, checks, prints the
 * exact command a live replay would execute, and removes the tree. It never
 * runs adb. What it cannot check without the phone -- the installed Companion
 * APK against the winner's `helperApk` -- is reported UNKNOWN, not assumed.
 * A live replay runs only the committed winner file (`winnerCustody`), never
 * an untracked or locally edited one, and only with the winner's detectors
 * file byte for byte; both are refused before any tree is written.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mainCheckout, resolveSerial } from '../../bin/phone/local-profile.mjs';
import { BINDINGS_DIR } from '@sixam/kernel';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../../..');
export const WINNER_SCHEMA = 'fnaf1-route-winner-v1';
export const REPLAY_SCHEMA = 'fnaf1-winner-replay-v1';
/** The runner every FNaF 1 route winner's `command` names, relative to the winner's pinned tree.
 *  It is where the runner stood at the pinned commit, which is the tree a replay runs, so it stays
 *  this path after the runner moved on in this checkout (ADR 0002 principle 9). */
export const RUNNER = 'tools/device/fnaf1-custom-run.sh';
/** Outputs a replay writes into this checkout rather than into the pinned tree. */
export const OUTPUT_LINKS = Object.freeze(['artifacts', 'captures']);
const FULL_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_TOKEN = /^[A-Za-z0-9._,/~:=+-]+$/;
const SERIAL = /^[A-Za-z0-9._:-]+$/;
const LABEL = /^[a-z0-9][a-z0-9-]{0,40}$/;

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Git's own object id for a blob: what `git ls-tree` lists for the file. */
export const gitBlobId = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const git = (root, args, options = {}) => execFileSync('git', ['-C', root, ...args],
  { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...options });
function fail(message) { throw new Error(`fnaf1-winner: ${message}`); }

/** Every committed FNaF 1 route winner, repository-relative. */
export function listWinners(root = ROOT) {
  const dir = join(root, BINDINGS_DIR, 'fnaf1');
  return (existsSync(dir) ? readdirSync(dir) : []).filter((name) => name.endsWith('-winner.json')).sort()
    .map((name) => ({ path: `${BINDINGS_DIR}/fnaf1/${name}`, winner: JSON.parse(readFileSync(join(dir, name), 'utf8')) }))
    .filter(({ winner }) => winner.schema === WINNER_SCHEMA);
}

export function loadWinner(path, root = ROOT) {
  const winner = JSON.parse(readFileSync(resolve(root, path), 'utf8'));
  if (winner.schema !== WINNER_SCHEMA) fail(`${path} is not a ${WINNER_SCHEMA}`);
  const problems = shapeProblems(winner);
  if (problems.length) fail(`${path}: ${problems.join('; ')}`);
  return winner;
}

/** What a winner must state for a replay to be derived from it alone. */
export function shapeProblems(winner) {
  const problems = [];
  if (typeof winner.id !== 'string' || !winner.id) problems.push('no id');
  if (!FULL_SHA.test(String(winner.sourcesAtCommit ?? '')))
    problems.push(`sourcesAtCommit must be a full 40-hex commit id, not ${JSON.stringify(winner.sourcesAtCommit)} ` +
      '(an abbreviation can become ambiguous as history grows)');
  const sources = Object.entries(winner.sources ?? {});
  if (!sources.length) problems.push('no pinned sources');
  for (const [path, hash] of sources) if (!SHA256.test(String(hash))) problems.push(`${path}: pin is not a sha256`);
  if (!sources.some(([path]) => path === RUNNER.replace(/\.sh$/, '.mjs'))) problems.push(`the runner ${RUNNER} is not pinned`);
  if (typeof winner.command !== 'string') problems.push('no command');
  return problems;
}

/** The pinned commit, resolved in this clone -- or why it cannot be. */
export function pinnedCommit(winner, root = ROOT) {
  const commit = String(winner.sourcesAtCommit ?? '');
  if (!FULL_SHA.test(commit)) fail(`${winner.id}: sourcesAtCommit is not a full commit id`);
  try {
    git(root, ['cat-file', '-e', `${commit}^{commit}`]);
  } catch {
    fail(`${winner.id}: commit ${commit} is not in this clone, so its pinned route can be neither checked nor run ` +
      '(a shallow clone? git fetch --unshallow; CI checks out with fetch-depth: 0)');
  }
  return commit;
}

/** Each pinned file as the commit holds it, against the winner's sha256. */
export function pinsAtCommit(winner, root = ROOT) {
  const commit = pinnedCommit(winner, root);
  return Object.entries(winner.sources).map(([path, pinned]) => {
    let atCommit = null;
    try { atCommit = sha256(git(root, ['show', `${commit}:${path}`])); } catch { /* absent at the commit */ }
    return { path, pinned, atCommit, ok: atCommit === pinned };
  });
}

/** The pinned files this checkout's tree no longer holds byte for byte. */
export function routeDrift(winner, root = ROOT) {
  return Object.entries(winner.sources).flatMap(([path, pinned]) => {
    const file = join(root, path);
    const tree = existsSync(file) ? sha256(readFileSync(file)) : null;
    return tree === pinned ? [] : [{ path, pinned, tree }];
  });
}

/** `git ls-tree -r` of a commit: [{mode, type, id, path}]. */
export function commitListing(commit, root = ROOT) {
  return git(root, ['ls-tree', '-r', '-z', '--full-tree', commit]).toString('utf8').split('\0').filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const [mode, type, id] = line.slice(0, tab).split(' ');
      return { mode, type, id, path: line.slice(tab + 1) };
    });
}

/**
 * Every problem between a materialized tree and the commit it claims to be:
 * a missing file, a byte that differs from the commit's blob, a lost or added
 * executable bit, a changed symlink, and a workspace link that resolves
 * outside the tree. Empty means the tree IS the commit, for every tracked file.
 */
export function treeProblems(dir, commit, root = ROOT, listing = commitListing(commit, root)) {
  const problems = [];
  for (const { mode, type, id, path } of listing) {
    const file = join(dir, path);
    if (type !== 'blob') { problems.push(`${path}: a ${type} entry cannot be materialized`); continue; }
    let stat;
    try { stat = lstatSync(file); } catch { problems.push(`${path}: missing`); continue; }
    if (mode === '120000') {
      const target = git(root, ['cat-file', 'blob', id]).toString('utf8');
      if (!stat.isSymbolicLink() || readlinkSync(file) !== target) problems.push(`${path}: symlink differs from the commit`);
      continue;
    }
    if (!stat.isFile()) { problems.push(`${path}: not a regular file`); continue; }
    if (gitBlobId(readFileSync(file)) !== id) problems.push(`${path}: content differs from the commit`);
    if (((stat.mode & 0o111) !== 0) !== (mode === '100755')) problems.push(`${path}: executable bit differs from the commit (${mode})`);
  }
  const links = join(dir, 'node_modules');
  for (const scope of existsSync(links) ? readdirSync(links) : []) {
    const names = scope.startsWith('@') ? readdirSync(join(links, scope)).map((n) => `${scope}/${n}`) : [scope];
    for (const name of names) {
      let at;
      try { at = realpathSync(join(links, name)); } catch { problems.push(`node_modules/${name} resolves to nothing`); continue; }
      if (relative(realpathSync(dir), at).startsWith('..')) problems.push(`node_modules/${name} resolves outside the tree (${at})`);
    }
  }
  return problems;
}

/** Link the tree's workspace packages the way npm does, relative, so each resolves inside the tree. */
function linkWorkspaces(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const pattern of pkg.workspaces ?? []) {
    const star = pattern.match(/^([\w.-]+(?:\/[\w.-]+)*)\/\*$/);
    const parents = star ? readdirSync(join(dir, star[1])).map((name) => `${star[1]}/${name}`) : [pattern];
    for (const workspace of parents) {
      const manifest = join(dir, workspace, 'package.json');
      if (!existsSync(manifest)) continue;
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
      if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(String(name))) fail(`${workspace}: unusable package name ${JSON.stringify(name)}`);
      const link = join(dir, 'node_modules', name);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(relative(dirname(link), join(dir, workspace)), link);
    }
  }
}

/**
 * Write the tree of the winner's commit into `dir` (which must not exist) and
 * prove it: every tracked file matches the commit, every pinned file matches
 * the winner. `outputs` is the checkout whose `artifacts` and `captures` the
 * tree's own are linked to; null leaves them out (a dry run executes nothing).
 */
export function materialize(winner, dir, { root = ROOT, outputs = null } = {}) {
  const commit = pinnedCommit(winner, root);
  const listing = commitListing(commit, root);
  for (const name of OUTPUT_LINKS)
    if (listing.some(({ path }) => path === name || path.startsWith(`${name}/`)))
      fail(`${commit} tracks files under ${name}/, which a replay links to this checkout`);
  mkdirSync(dir);
  const tar = git(root, ['archive', '--format=tar', commit]);
  execFileSync('tar', ['-x', '-f', '-', '-C', dir], { input: tar, maxBuffer: 1 << 20 });
  linkWorkspaces(dir);
  const problems = treeProblems(dir, commit, root, listing);
  const sources = Object.entries(winner.sources).map(([path, pinned]) => {
    const file = join(dir, path);
    const actual = existsSync(file) ? sha256(readFileSync(file)) : null;
    if (actual !== pinned) problems.push(`${path}: the commit holds ${actual ?? 'nothing'}, the winner pins ${pinned}`);
    return [path, actual];
  });
  if (problems.length) fail(`${winner.id}: the tree of ${commit.slice(0, 12)} is not the winner's route:\n  ${problems.join('\n  ')}`);
  if (outputs) {
    for (const name of OUTPUT_LINKS) {
      mkdirSync(join(outputs, name), { recursive: true });
      symlinkSync(join(outputs, name), join(dir, name));
    }
  }
  return { dir, commit, tree: git(root, ['rev-parse', `${commit}^{tree}`]).toString('utf8').trim(),
    files: listing.length, sources: Object.fromEntries(sources) };
}

/** Remove a materialized tree without ever following its links into the checkout. */
export function removeTree(dir) {
  for (const name of OUTPUT_LINKS) {
    const link = join(dir, name);
    try { if (lstatSync(link).isSymbolicLink()) unlinkSync(link); } catch { /* not linked */ }
  }
  rmSync(dir, { recursive: true, force: true });
}

/**
 * The won command's arguments, with only the label changed. The command is a
 * plain word list (no quoting, no shell); anything else is refused rather
 * than interpreted. A leading `~/` is the operator's home, as the shell read it.
 */
export function replayArguments(winner, { label = 'replay', home = homedir() } = {}) {
  if (!LABEL.test(label)) fail('--label is lowercase letters, digits, hyphens');
  const tokens = winner.command.trim().split(/\s+/);
  const unsafe = tokens.filter((token) => !SAFE_TOKEN.test(token));
  if (unsafe.length) fail(`${winner.id}: the command holds shell syntax a replay will not interpret: ${unsafe.join(' ')}`);
  if (tokens[0] !== RUNNER) fail(`${winner.id}: the command runs ${tokens[0]}, not ${RUNNER}`);
  const args = tokens.slice(1).map((token) => (token.startsWith('~/') ? join(home, token.slice(2)) : token));
  const at = args.indexOf('--label');
  if (at < 0) args.push('--label', label); else args[at + 1] = label;
  return args;
}

/**
 * The one process a live replay starts: this checkout's serial lease around
 * the materialized tree's runner, which skips its own lease (the lease it
 * would take lives under its tree's `captures`, i.e. this checkout's, by link).
 */
/**
 * The main checkout, seen from it or from any of its worktrees (it lives in
 * local-profile.mjs since 2026-09-29, beside the profile it also locates).
 * Mirrors companion_device_lock.py's main_checkout().
 */
export { mainCheckout };

/**
 * The serial lease's directory: one for the host, shared by every checkout and
 * worktree (companion_device_lock.py's lock_dir()), so a replay started from a
 * worktree contends with the overnight window's lease, not a private copy.
 */
export function sharedLockDir(root = ROOT, env = process.env) {
  if (env.CUE_HELPER_LOCK_DIR) return env.CUE_HELPER_LOCK_DIR;
  return join(env.CUE_HELPER_STATE_DIR || join(mainCheckout(root), 'captures/cue-helper'), 'locks');
}

export function replayInvocation(winner, { root = ROOT, tree, serial, label, env = process.env, home = homedir() }) {
  if (!SERIAL.test(String(serial))) fail('the serial is invalid');
  const lockDir = sharedLockDir(root, env);
  const args = replayArguments(winner, { label, home });
  return {
    file: 'python3',
    args: [join(root, 'packages/play/src/safety/device-lock-exec.py'), serial, '--',
      'env', 'FNAF1_LEASE_HELD=1', `FNAF_SERIAL=${serial}`, `CUE_HELPER_LOCK_DIR=${lockDir}`, join(tree, RUNNER), ...args],
    cwd: tree,
    env: { ...env, CUE_HELPER_LOCK_DIR: lockDir },
    runnerArgs: args,
  };
}

/** The detectors file the winner ran with, which is never tracked: present and byte-identical, or not. */
export function detectorsCheck(winner, home = homedir()) {
  const pinned = winner.detectors?.sha256 ?? null;
  if (!winner.detectors?.file) return { status: 'NONE', pinned };
  const file = winner.detectors.file.startsWith('~/') ? join(home, winner.detectors.file.slice(2)) : winner.detectors.file;
  if (!existsSync(file)) return { status: 'MISSING', file: winner.detectors.file, pinned };
  const actual = sha256(readFileSync(file));
  return { status: actual === pinned ? 'MATCH' : 'DIFFERS', file: winner.detectors.file, pinned, actual };
}

/**
 * Whether the winner file is the committed one: a live replay runs only a
 * winner whose `command` and pins are what the repository holds, never a
 * local edit of them.
 */
export function winnerCustody(path, root = ROOT) {
  try { git(root, ['ls-files', '--error-unmatch', '--', path]); } catch { return 'UNTRACKED'; }
  try { git(root, ['diff', '--quiet', 'HEAD', '--', path]); } catch { return 'MODIFIED'; }
  return 'COMMITTED';
}

const runDirs = (root) => {
  const dir = join(root, 'artifacts', 'runs');
  return new Set(existsSync(dir) ? readdirSync(dir) : []);
};

function parseArgs(argv) {
  const o = { winner: null, live: false, confirmLive: false, label: 'replay' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--winner') o.winner = argv[++i];
    else if (a === '--live') o.live = true;
    else if (a === '--confirm-live') o.confirmLive = true;
    else if (a === '--label') o.label = argv[++i];
    else fail(`unknown argument ${a}`);
  }
  if (!o.winner) fail('--winner FILE is required (a committed fnaf1-route-winner-v1)');
  if (o.live !== o.confirmLive) fail('a live replay needs both --live and --confirm-live');
  if (!LABEL.test(o.label)) fail('--label is lowercase letters, digits, hyphens');
  return o;
}

async function main(argv) {
  const o = parseArgs(argv);
  const winnerPath = relative(ROOT, resolve(o.winner));
  const winner = loadWinner(winnerPath);
  // FNAF_SERIAL, else the untracked local profile (ADR 0002 decision 8); the
  // winner's `target.device` records the phone it won on and is no default.
  // A dry replay names no phone and prints UNKNOWN in the lease's place.
  let serial = 'UNKNOWN';
  try { ({ serial } = resolveSerial()); } catch (error) { if (o.live) fail(error.message); }
  const detectors = detectorsCheck(winner);
  const custody = winnerCustody(winnerPath);
  const drift = routeDrift(winner);
  if (o.live && custody !== 'COMMITTED')
    fail(`${winnerPath} is ${custody}: a live replay runs only the committed winner, never a local edit of it`);
  if (o.live && detectors.status !== 'MATCH' && detectors.status !== 'NONE')
    fail(`the detectors file is ${detectors.status} (${detectors.file}); the winner ran with sha256 ${detectors.pinned}. ` +
      `Rebuild it: ${(winner.detectors.rebuild ?? []).join(' && ')}`);
  const scratch = mkdtempSync(join(tmpdir(), 'fnaf1-winner-'));
  const tree = join(scratch, 'tree');
  try {
    const built = materialize(winner, tree, { outputs: o.live ? ROOT : null });
    const plan = replayInvocation(winner, { tree, serial, label: o.label });
    const summary = {
      winner: winnerPath, id: winner.id, winnerCustody: custody,
      checkout: git(ROOT, ['rev-parse', 'HEAD']).toString('utf8').trim(), commit: built.commit, tree: built.tree,
      filesMatchingCommit: built.files, pinnedFilesMatching: Object.keys(built.sources).length,
      treeDriftSinceWin: drift.map(({ path }) => path),
      detectors, helperApk: { pinned: winner.helperApk?.sha256 ?? null, installed: 'UNKNOWN(not-checked: needs the phone)' },
    };
    if (!o.live) {
      const executes = `${plan.file} ${plan.args.map((arg) => arg.split(tree).join('<pinned tree>')).join(' ')}`;
      console.log(JSON.stringify({ status: 'DRY_RUN', ...summary, executes }, null, 2));
      return 0;
    }
    console.error(`fnaf1-winner: ${winner.id} at ${built.commit.slice(0, 12)}: all ${built.files} files match the commit, ` +
      `all ${summary.pinnedFilesMatching} pinned files match the winner; running the pinned runner under the ${serial} lease`);
    const before = runDirs(ROOT);
    const ignore = () => {};
    process.on('SIGINT', ignore);
    const status = await new Promise((done, failed) => {
      const child = spawn(plan.file, plan.args, { cwd: plan.cwd, env: plan.env, stdio: 'inherit' });
      child.on('error', failed);
      child.on('close', (code, signal) => done(code ?? (signal ? 128 : 1)));
    }).finally(() => process.off('SIGINT', ignore));
    for (const id of [...runDirs(ROOT)].filter((id) => !before.has(id) && id.startsWith('fnaf1-custom-')).sort()) {
      const record = { schema: REPLAY_SCHEMA, run: id, exitStatus: status, winnerSha256: sha256(readFileSync(join(ROOT, winnerPath))),
        ...summary, runner: RUNNER, runnerArgs: plan.runnerArgs.map((arg) => arg.split(homedir()).join('~')),
        lease: 'this checkout\'s device-lock-exec.py; the pinned runner ran with FNAF1_LEASE_HELD=1' };
      writeFileSync(join(ROOT, 'artifacts', 'runs', id, 'replay.json'), `${JSON.stringify(record, null, 2)}\n`);
      console.error(`fnaf1-winner: ${id} is a replay of ${winner.id}; replay.json written`);
    }
    return status;
  } finally {
    if (existsSync(tree)) removeTree(tree);
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((status) => { process.exitCode = status; },
    (error) => { console.error(error.message); process.exitCode = 2; });
}
