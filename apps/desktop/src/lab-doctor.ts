// The lab's doctor: what is broken on this host and checkout, each finding with the command that
// fixes it. It prints each remedy and runs none; the only thing it removes is the throwaway
// worktree it builds for the catalog check (lab.ts serves it as `doctor` and `lab.doctor`).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BINDINGS_DIR, type Unknown, isUnknown, unknown } from '@sixam/kernel';
import { PROFILE_PATH, profilePaths } from '../../../packages/play/bin/phone/local-profile.ts';
import { laneCommand, linkDependencies } from './lane-kit.ts';
import { type LabContext, type Placed, type QueueView, QUEUE_TOOL, STALE_PENDING_HOURS, hoursBetween, lines, mtime,
  parseWorktrees } from './lab-host.ts';

/** An agent worktree idle this long, unlocked and with no process inside, is orphaned. */
const AGENT_WORKTREE_IDLE_HOURS = 24;
/** Below this much available memory, a heavy process makes the next heavy command an OOM risk. */
const MEMORY_FLOOR_MB = 1536;
/** A process holding this much resident memory is heavy. */
const HEAVY_RSS_MB = 1024;
/** What CI diffs after `npm run catalog && npm run chronicle` (ci.yml, "Documentation and catalog links"). */
const GENERATED_DIRS = Object.freeze(['docs/architecture/generated', 'docs/portal']);
export const CATALOG_COMMANDS = Object.freeze(['npm run catalog', 'npm run chronicle']);

/** One doctor check: what it asked, and yes, no or UNKNOWN. */
export interface Check { id: string, what: string, ok: boolean | Unknown, detail?: unknown }

const inUse = (cwds: readonly string[], path: string) => cwds.some(cwd => cwd === path || cwd.startsWith(`${path}/`));

/** Whether the generated catalogs at `sha` match what the catalog commands regenerate, in a throwaway worktree. */
function catalogDrift({ root, cleanEnv, git }: LabContext, sha: string, catalogCommands: readonly string[]): { ok: boolean | Unknown, files?: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'fnaf-lab-catalog-'));
  rmSync(dir, { recursive: true, force: true });
  try {
    git(['worktree', 'add', '--detach', dir, sha]);
  } catch (error) { return { ok: unknown(`a worktree at ${sha.slice(0, 7)} could not be built: ${(error as Error).message}`) }; }
  try {
    if (existsSync(join(root, 'node_modules')) && existsSync(join(root, 'package-lock.json')) && existsSync(join(dir, 'package-lock.json')))
      linkDependencies(dir, root);
    for (const command of catalogCommands) {
      const result = spawnSync('sh', ['-c', laneCommand(command)], { cwd: dir, encoding: 'utf8', env: cleanEnv });
      if (result.status !== 0)
        return { ok: unknown(`${command} failed in a clean worktree at ${sha.slice(0, 7)}: ${`${result.stdout}${result.stderr}`.trim().split('\n').at(-1)}`) };
    }
    const changed = lines(git(['status', '--porcelain', '--', ...GENERATED_DIRS], { cwd: dir })).map(line => line.slice(3));
    return { ok: changed.length === 0, files: changed };
  } finally {
    git(['worktree', 'remove', '--force', dir], { allowFail: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every doctor check over one checkout, and a finding with its remedy for each one that failed. */
export function runDoctor(context: LabContext, queue: () => QueueView | Unknown,
  { catalog = true, catalogCommands = CATALOG_COMMANDS }: { catalog?: boolean, catalogCommands?: readonly string[] } = {}) {
  const { root, env, git, host } = context;
  const checks: Check[] = [];
  const findings: { id: string, finding: string, remedy: string }[] = [];
  const check = (id: string, what: string, ok: boolean | Unknown, detail: unknown = null) => { checks.push({ id, what, ok, ...(detail ? { detail } : {}) }); };
  const find = (id: string, finding: string, remedy: string) => findings.push({ id, finding, remedy });
  const at = context.now();

  // Hooks.
  const hooksPath = git(['config', '--get', 'core.hooksPath'], { allowFail: true })?.trim() || null;
  const hooksOk = !!hooksPath && existsSync(join(resolve(root, hooksPath), 'commit-msg'));
  check('hooks-path', 'core.hooksPath names the repository hooks', hooksOk, hooksPath);
  if (!hooksPath) find('hooks-path', 'core.hooksPath is unset: git runs neither the commit-msg hook nor the pre-push gate',
    'git config core.hooksPath .githooks');
  else if (!hooksOk) find('hooks-path', `core.hooksPath is ${hooksPath}, which holds no commit-msg hook`, 'git config core.hooksPath .githooks');

  // Stale PENDING queue jobs.
  const jobs = queue();
  if (isUnknown(jobs)) check('stale-pending', `no PENDING queue job is older than ${STALE_PENDING_HOURS} h`, jobs);
  else {
    const stale = jobs.pending.filter(job => job.stale);
    check('stale-pending', `no PENDING queue job is older than ${STALE_PENDING_HOURS} h`, stale.length === 0);
    for (const job of stale) find('stale-pending', `queue job ${job.id} (${job.kind}) has been PENDING for ${job.ageHours} h`,
      `${QUEUE_TOOL} cancel ${job.id} --reason stale`);
  }

  // Worktrees: push-gate's orphans, and idle agent worktrees.
  let cwds: string[] | null;
  try { cwds = host.cwds(); } catch { cwds = null; }
  const noCwds = unknown('this host lists no process working directories, so no worktree can be called unused');
  // A worktree whose directory is gone has no process inside; any other is unused only if the listing says so.
  const unused = (path: string) => (!existsSync(path) ? true : cwds === null ? null : !inUse(cwds, path));
  const worktrees = parseWorktrees(git(['worktree', 'list', '--porcelain']) ?? '');
  const base = context.pushGateBase();
  const gateDirs = existsSync(base) ? readdirSync(base).filter(name => name.startsWith('fnaf2-push-gate-')).map(name => join(base, name)) : [];
  const gateRegistered = worktrees.filter((row): row is Placed => Boolean(row.path?.startsWith(`${base}/`)));
  const gatePaths = [...new Set([...gateDirs, ...gateRegistered.map(row => row.path)])].sort();
  const gateOrphans = gatePaths.filter(path => unused(path) === true);
  check('push-gate-worktrees', `no orphaned push-gate worktree under ${base}`,
    gatePaths.some(path => unused(path) === null) ? noCwds : gateOrphans.length === 0);
  for (const path of gateOrphans) {
    const registered = gateRegistered.find(row => row.path === path);
    find('push-gate-worktrees', `${path} is a push-gate worktree no running process is inside`,
      registered ? (existsSync(path) ? `git worktree remove --force ${path}` : 'git worktree prune') : `rm -r ${path}`);
  }
  const agents = worktrees.filter((row): row is Placed => Boolean(row.path && /\/\.claude\/worktrees\/agent-[^/]+$/.test(row.path) && resolve(row.path) !== root));
  const idle: { row: (typeof agents)[number], hours: number | null }[] = [];
  let undecided = false;
  for (const row of agents) {
    if (row.locked) continue;
    if (row.prunable || !existsSync(row.path)) { idle.push({ row, hours: null }); continue; }
    let admin: string | null = null;
    try { admin = resolve(row.path, readFileSync(join(row.path, '.git'), 'utf8').trim().replace(/^gitdir:\s*/, '')); } catch { admin = null; }
    const dirOf = admin;
    const times = [row.path, ...(dirOf ? ['HEAD', 'index', 'logs/HEAD'].map(name => join(dirOf, name)) : [])].map(mtime)
      .filter((time): time is Date => Boolean(time));
    const last = new Date(Math.max(...times.map(time => time.getTime())));
    const hours = hoursBetween(last, at);
    if (hours <= AGENT_WORKTREE_IDLE_HOURS) continue;
    const free = unused(row.path);
    if (free === null) undecided = true;
    else if (free) idle.push({ row, hours });
  }
  check('agent-worktrees', `no unlocked agent worktree idle over ${AGENT_WORKTREE_IDLE_HOURS} h`, undecided ? noCwds : idle.length === 0);
  for (const { row, hours } of idle)
    find('agent-worktrees', hours === null ? `${row.path} is registered but gone (prunable)`
      : `${row.path} (${row.branch ?? 'detached'}) is unlocked, idle ${hours} h, and no process is inside`,
    hours === null ? 'git worktree prune' : `git worktree remove ${row.path}   (git refuses a worktree that holds changes; inspect it then)`);

  // Workspace links.
  const modules = join(root, 'node_modules');
  const stale = existsSync(join(modules, '@fnaf2-1020'));
  const missing = !existsSync(join(modules, '@sixam'));
  check('node-modules', 'node_modules links the @sixam scope and not the retired @fnaf2-1020 one', !stale && !missing);
  if (stale) find('node-modules', 'node_modules still links the retired @fnaf2-1020 scope', 'npm ci');
  if (missing) find('node-modules', 'node_modules has no @sixam scope, so the workspaces do not resolve', 'npm ci');

  // The local device profile.
  const profiles = profilePaths({ env, root });
  const profile = profiles.find(path => existsSync(path)) ?? null;
  check('local-profile', `a local device profile (${PROFILE_PATH}) exists`, Boolean(profile), profile);
  if (!profile) find('local-profile', `no local device profile: looked at ${profiles.join(', ')}`,
    'node packages/play/bin/phone/local-profile.ts set <serial>   (`adb devices -l` lists it; the file is gitignored)');

  // Generated-catalog drift at HEAD, in a clean worktree like push-gate's.
  const sha = git(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true })?.trim();
  if (!catalog) check('catalog-drift', 'the generated catalogs at HEAD match what the catalog and chronicle regenerate',
    unknown('not computed here: it builds a temporary worktree (npm run lab -- doctor)'));
  else if (!sha) check('catalog-drift', 'the generated catalogs at HEAD match what the catalog and chronicle regenerate', unknown('no HEAD'));
  else {
    const drift = catalogDrift(context, sha, catalogCommands);
    check('catalog-drift', 'the generated catalogs at HEAD match what the catalog and chronicle regenerate', drift.ok,
      drift.files?.length ? drift.files : null);
    // A drift verdict carries the files it found.
    if (drift.ok === false) find('catalog-drift', `HEAD ${sha.slice(0, 7)}'s generated catalogs are stale: ${(drift.files as string[]).join(', ')}`,
      `${CATALOG_COMMANDS.join(' && ')}, then commit ${GENERATED_DIRS.join(' and ')}`);
  }

  // Memory.
  let available: number | null = null;
  let heavy: ReturnType<typeof host.processes> = [];
  try {
    available = host.availableMb();
    heavy = host.processes().filter(item => item.rssMb >= HEAVY_RSS_MB).sort((a, b) => b.rssMb - a.rssMb);
  } catch { available = null; }
  if (available === null) check('memory', `at least ${MEMORY_FLOOR_MB} MB available, or no heavy process`, unknown('/proc/meminfo is not readable here'));
  else {
    const low = available < MEMORY_FLOOR_MB && heavy.length > 0;
    check('memory', `at least ${MEMORY_FLOOR_MB} MB available, or no process over ${HEAVY_RSS_MB} MB`, !low,
      { availableMb: available, heavy: heavy.slice(0, 3) });
    if (low) find('memory', `${available} MB available while ${heavy.slice(0, 3).map(item => `${item.name} (pid ${item.pid}, ${item.rssMb} MB)`).join(', ')} run`,
      'wait for it to finish, or run heavy commands one at a time under ' +
      'systemd-run --user --scope -q -p MemoryMax=2500M -p MemorySwapMax=3G -- <command>');
  }

  // Winners that live outside git.
  const untracked = lines(git(['ls-files', '--others', '--exclude-standard', '--', ':(glob)**/*-winner.json']));
  const ignored = lines(git(['ls-files', '--others', '--ignored', '--exclude-standard', '--',
    ':(glob)artifacts/**/*-winner.json', `:(glob)${BINDINGS_DIR}/*/*-winner.json`]));
  const loose = [...new Set([...untracked, ...ignored])].sort();
  check('untracked-winner', 'every *-winner.json is tracked', loose.length === 0);
  for (const file of loose) find('untracked-winner', `${file} is not tracked: it cannot be re-run on another machine`,
    `commit it as ${BINDINGS_DIR}/<game>/campaign-night<N>-<name>-winner.json in the commit that uses it (CLAUDE.md; test-fact-register.ts)`);

  return { checks, findings };
}
