// The lane plumbing the push gate and the lab share: a lane's environment without git's, the lane
// memory ceiling, a fresh worktree's node_modules, and the push gate's run record. It lived in
// tools/push-gate.ts, and the lab (apps/desktop/src) imported a tool to reach it; tools now import it here.
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mainCheckout } from '../../../packages/play/bin/phone/local-profile.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// git runs a hook with the repository in its environment (GIT_DIR, and more),
// and every lane inherited it. CI's runner has none of it. On 2026-09-25
// vaulttest.mjs's `git init` in a temp directory therefore reinitialised the
// real repository -- core.bare=true, which stopped every checkout of it from
// working as one -- and its `commit -m root` landed on the pushing worktree's
// branch. A lane gets CI's environment: no GIT_* variables.
export function withoutGit(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));
}


// This host has 7.8 GB, and a rebuild batch in another session can hold most of
// it. On 2026-09-29 the kernel's OOM killer took whole Claude sessions (exit 137)
// while a lane ran beside three 1.5 GB Chowdren processes. Each command now runs
// in a systemd user scope with a ceiling, so the lane is what gets killed, and it
// says so. PUSH_GATE_MEMORY_MAX=off runs unscoped; any other value replaces the
// ceiling. Where no user manager answers (CI's runners), commands run as before.
export const DEFAULT_MEMORY_MAX = '3G';
export const MEMORY_MAX = process.env.PUSH_GATE_MEMORY_MAX || DEFAULT_MEMORY_MAX;
export const SCOPED = MEMORY_MAX !== 'off'
  && spawnSync('systemd-run', ['--user', '--scope', '-q', '--', 'true'], { stdio: 'ignore' }).status === 0;

const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/**
 * The shell command that runs `command` under the lane memory ceiling.
 */
export function laneCommand(command: string, { memoryMax = MEMORY_MAX, scoped = SCOPED }: { memoryMax?: string, scoped?: boolean } = {}) {
  if (!scoped || memoryMax === 'off') return command;
  return `systemd-run --user --scope -q -p MemoryMax=${memoryMax} -p MemorySwapMax=4G -- sh -c ${shellQuote(command)}`;
}

/**
 * Wire `node_modules` in a fresh worktree. The workspace links must point at
 * the WORKTREE's packages: symlinking the main repository's `node_modules`
 * wholesale makes `@sixam/core` resolve back to the working tree, so the
 * gate would type-check and test the code it was built to ignore.
 */
export function linkDependencies(worktree: string, root = ROOT) {
  // The lockfile is what `npm ci` installs from, so an identical lockfile means
  // an identical tree and the existing one can be linked. `package.json` is not
  // the test: it changes whenever a script is added, and reinstalling for that
  // would cost minutes for nothing. `npm run lab -- doctor` links its catalog
  // worktree the same way, from the checkout it runs in.
  const source = join(root, 'node_modules');
  const same = existsSync(source) && readFileSync(join(root, 'package-lock.json'), 'utf8')
    === readFileSync(join(worktree, 'package-lock.json'), 'utf8');
  if (!same) {
    console.log('  the lockfile differs from the working tree; running npm ci');
    execFileSync('npm', ['ci'], { cwd: worktree, stdio: 'inherit', env: withoutGit(process.env) });
    return;
  }
  mkdirSync(join(worktree, 'node_modules'), { recursive: true });
  for (const entry of readdirSync(source)) {
    const target = join(worktree, 'node_modules', entry);
    if (!entry.startsWith('@')) { symlinkSync(join(source, entry), target); continue; }
    // A scope directory holds the workspace links, and those are relative
    // (`../../packages/core`), so copying the link text re-points them at this
    // checkout. Anything else in the scope is a real dependency directory.
    mkdirSync(target, { recursive: true });
    for (const scoped of readdirSync(join(source, entry))) {
      const from = join(source, entry, scoped);
      symlinkSync(lstatSync(from).isSymbolicLink() ? readlinkSync(from) : from, join(target, scoped));
    }
  }
}

// `npm run lab -- status` says whether this gate ran on HEAD, and it reads that
// from here: one line per validated commit, appended to the main checkout's
// gitignored artifacts/lab/push-gate.jsonl (FNAF_LAB_DIR names another
// directory). It is host-wide because a commit's verdict is the same whichever
// worktree ran the gate. A record that cannot be written is reported and never
// changes the verdict.
export const RUN_RECORD_SCHEMA = 'push-gate-run-v1';

export function runRecordPath(env: NodeJS.ProcessEnv = process.env, root: string = ROOT) {
  return env.FNAF_LAB_DIR ? join(resolve(env.FNAF_LAB_DIR), 'push-gate.jsonl') : join(mainCheckout(root), 'artifacts/lab/push-gate.jsonl');
}

/**
 * Append one validated commit's verdict.
 */
export function recordRun({ sha, full, failed, skipped, at = new Date() }: {sha: string, full: boolean, failed: string[], skipped: string[], at?: Date}, path: string = runRecordPath()) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ schema: RUN_RECORD_SCHEMA, sha, full, failed, skipped, at: at.toISOString(), host: hostname() })}\n`);
  return path;
}
