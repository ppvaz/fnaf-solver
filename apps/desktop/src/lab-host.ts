// What the lab reads of this host and checkout: processes, git, the state directories, and the
// phone's host-side records (the Companion queue, device leases, overnight windows). lab.ts
// composes it into the verbs, and lab-doctor.ts checks it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { type Unknown, isRecord, unknown } from '@sixam/kernel';
import { mainCheckout } from '../../../packages/play/bin/phone/local-profile.ts';

export const QUEUE_TOOL = 'apps/lab/companion-queue.sh';
/** A PENDING job older than this is stale (the operators note's doctor table: "older than 72 h"). */
export const STALE_PENDING_HOURS = 72;
/** How long `lsof` may take to list working directories before the answer is UNKNOWN. */
const LSOF_TIMEOUT_MS = 10_000;
const HOUR = 3600 * 1000;

export const lines = (text: string | null | undefined) => (text ?? '').split('\n').map(line => line.trimEnd()).filter(Boolean);
export const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
export const iso = (date: Date) => date.toISOString();
export const hoursBetween = (from: Date, to: Date) => Math.round(((to.getTime() - from.getTime()) / HOUR) * 10) / 10;
export const mtime = (path: string) => { try { return statSync(path).mtime; } catch { return null; } };
const withoutGit = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(env).filter(([name]) => !name.startsWith('GIT_')));

/** A Companion queue job, as companion-queue.py lists it. */
export interface QueueJob {
  readonly id: string, readonly kind: string, readonly state: string, readonly night?: number | null, readonly winner?: string | null,
  readonly createdAt?: string | null, readonly startedAt?: string | null, readonly finishedAt?: string | null,
  readonly cancelledAt?: string | null, readonly result?: unknown,
}
/** The queue as status and doctor read it; status drops the raw jobs. */
export interface QueueView {
  jobs: number, byState: Record<string, number>,
  pending: { id: string, kind: string, night: number | null, winner: string | null, createdAt: string | null | undefined, ageHours: number | null, stale: boolean }[],
  running: { id: string, kind: string, startedAt: string | null }[], staleAfterHours: number, jobsRaw?: QueueJob[],
}
/** An overnight window, as overnight-window.py records it. */
interface WindowRecord {
  readonly window?: { readonly openedAt?: string, readonly closedAt?: string }, readonly outcome?: string, readonly reason?: string,
  readonly morning?: { readonly summary?: string, readonly nights?: unknown[] },
}
/** A device lock's owner record, as companion_device_lock.py writes it. */
interface LockOwner { readonly pid: number, readonly host: string | null, readonly acquiredAt: number | null }

/** A lock file's owner, or null when it holds no record with a pid (empty, unreadable or malformed). */
function lockOwner(path: string): LockOwner | null {
  let record: unknown;
  try { record = readJson(path); } catch { return null; }
  if (!isRecord(record)) return null;
  const { pid } = record;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return null;
  return { pid, host: typeof record.host === 'string' ? record.host : null,
    acquiredAt: typeof record.acquiredAt === 'number' ? record.acquiredAt : null };
}

/** `git worktree list --porcelain`, one row per worktree. */
export function parseWorktrees(text: string) {
  return text.split('\n\n').map(block => block.split('\n').filter(Boolean)).filter(rows => rows.length).map(rows => {
    const row = { path: null as string | null, head: null as string | null, branch: null as string | null, locked: false, prunable: false, detached: false };
    for (const line of rows) {
      const [key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'worktree') row.path = value;
      else if (key === 'HEAD') row.head = value;
      else if (key === 'branch') row.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'locked') row.locked = true;
      else if (key === 'prunable') row.prunable = true;
      else if (key === 'detached') row.detached = true;
    }
    return row;
  });
}
type Worktree = ReturnType<typeof parseWorktrees>[number];
/** A worktree whose block named its path, as git's always does. */
export type Placed = Worktree & { path: string };

/**
 * This host: available memory and resident processes from /proc, each process's working directory
 * from /proc or, where there is none (macOS), from `lsof`, and a pid's liveness from signal 0.
 */
export const PROC_HOST = Object.freeze({
  availableMb() {
    const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(readFileSync('/proc/meminfo', 'utf8'));
    return match ? Math.round(Number(match[1]) / 1024) : null;
  },
  processes() {
    const out = [];
    for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
      try {
        const status = readFileSync(`/proc/${pid}/status`, 'utf8');
        const rss = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
        if (rss) out.push({ pid: Number(pid), name: /^Name:\s+(.*)$/m.exec(status)?.[1] ?? '?', rssMb: Math.round(Number(rss[1]) / 1024) });
      } catch { /* gone, or another user's */ }
    }
    return out;
  },
  /** Every readable process's working directory, or null when this host cannot list them. */
  cwds(): string[] | null {
    if (existsSync('/proc/self/cwd')) {
      const out = [];
      for (const pid of readdirSync('/proc').filter(name => /^\d+$/.test(name))) {
        try { out.push(readlinkSync(`/proc/${pid}/cwd`)); } catch { /* gone, or another user's */ }
      }
      return out;
    }
    // A partial listing would call a worktree unused that a process is inside, so anything but a clean exit is no answer.
    const result = spawnSync('lsof', ['-a', '-d', 'cwd', '-Fn'], { encoding: 'utf8', timeout: LSOF_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) return null;
    return result.stdout.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
  },
  /** Whether `pid` names a running process; EPERM is a live process another user owns. */
  alive(pid: number) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  },
});
export type LabHost = typeof PROC_HOST;

/** One checkout on this host, and where its state lives. */
export function labContext({ root, env, now, host }: { root: string, env: NodeJS.ProcessEnv, now: () => Date, host: LabHost }) {
  const cleanEnv = withoutGit(env);
  /** git in the checkout; with allowFail, a failed command answers null instead of throwing. */
  function git(args: string[], options?: { cwd?: string, allowFail?: false }): string;
  function git(args: string[], options: { cwd?: string, allowFail: boolean }): string | null;
  function git(args: string[], { cwd = root, allowFail = false }: { cwd?: string, allowFail?: boolean } = {}) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: cleanEnv, maxBuffer: 256 * 1024 * 1024 });
    if (result.status === 0) return result.stdout;
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')}: ${(result.stderr || result.error?.message || '').trim()}`);
  }
  const mainRoot = () => mainCheckout(root);
  const stateDir = () => (env.CUE_HELPER_STATE_DIR ? resolve(env.CUE_HELPER_STATE_DIR) : join(mainRoot(), 'captures/cue-helper'));
  return {
    root, env, cleanEnv, now, host, git, mainRoot, stateDir,
    lockDir: () => (env.CUE_HELPER_LOCK_DIR ? resolve(env.CUE_HELPER_LOCK_DIR) : join(stateDir(), 'locks')),
    windowDir: () => (env.FNAF_WINDOW_DIR ? resolve(env.FNAF_WINDOW_DIR) : join(mainRoot(), 'artifacts/overnight-windows')),
    pushGateBase: () => env.FNAF2_PUSH_GATE_TMP ?? join(env.HOME ?? homedir(), '.cache/fnaf2-pushgate-tmp'),
  };
}
export type LabContext = ReturnType<typeof labContext>;

/** The phone's host-side state: the Companion queue, the device leases and the overnight windows. */
export function phoneState(context: LabContext, queueOverride?: () => { jobs: QueueJob[] }) {
  const { root, cleanEnv, now, host } = context;

  function queueJobs() {
    if (queueOverride) return queueOverride();
    const result = spawnSync('python3', [join(root, 'apps/lab/companion-queue.py'), 'list', '--json'],
      { cwd: root, encoding: 'utf8', env: cleanEnv, timeout: 30000 });
    if (result.status !== 0) throw new Error((result.stderr || result.error?.message || 'no output').trim().split('\n').at(-1));
    // What companion-queue.py list --json prints.
    return JSON.parse(result.stdout) as { jobs: QueueJob[] };
  }

  function queue(): QueueView | Unknown {
    let jobs: QueueJob[];
    try { jobs = queueJobs().jobs; } catch (error) { return unknown(`the queue could not be listed: ${(error as Error).message}`); }
    const at = now();
    const byState: Record<string, number> = {};
    for (const job of jobs) byState[job.state] = (byState[job.state] ?? 0) + 1;
    const age = (job: QueueJob) => (job.createdAt ? hoursBetween(new Date(job.createdAt), at) : null);
    const pending = jobs.filter(job => job.state === 'PENDING').map(job => ({ id: job.id, kind: job.kind, night: job.night ?? null,
      winner: job.winner ?? null, createdAt: job.createdAt, ageHours: age(job), stale: (age(job) ?? 0) > STALE_PENDING_HOURS }));
    const running = jobs.filter(job => job.state === 'RUNNING').map(job => ({ id: job.id, kind: job.kind, startedAt: job.startedAt ?? null }));
    return { jobs: jobs.length, byState, pending, running, staleAfterHours: STALE_PENDING_HOURS, jobsRaw: jobs };
  }

  function leases() {
    const dir = context.lockDir();
    const rows = existsSync(dir) ? readdirSync(dir).filter(name => /^device-.*\.lock$/.test(name)).sort().map(name => {
      const owner = lockOwner(join(dir, name));
      if (!owner || !host.alive(owner.pid)) return { file: name, held: false, pid: null, host: null, acquiredAt: null };
      return { file: name, held: true, pid: owner.pid, host: owner.host,
        acquiredAt: owner.acquiredAt === null ? null : iso(new Date(owner.acquiredAt * 1000)) };
    }) : [];
    return { dir, leases: rows, held: rows.filter(row => row.held).length,
      rule: 'a lease is held while the pid its owner record names is alive; the record is read, the lock is never taken' };
  }

  function windows() {
    const dir = context.windowDir();
    const records = existsSync(dir) ? readdirSync(dir).flatMap(name => {
      // What overnight-window.py wrote.
      try { return [{ id: name, ...(readJson(join(dir, name, 'window.json')) as WindowRecord) }]; } catch { return []; }
    }) : [];
    const rows = records.map(record => ({ id: record.id, openedAt: record.window?.openedAt ?? null, closedAt: record.window?.closedAt ?? null,
      outcome: record.outcome ?? null, reason: record.reason ?? null, summary: record.morning?.summary ?? null,
      nights: record.morning?.nights ?? [] })).sort((a, b) => String(a.openedAt).localeCompare(String(b.openedAt)));
    const restoreDir = join(context.stateDir(), 'overnight-window');
    const pendingRestores = existsSync(restoreDir) ? readdirSync(restoreDir).filter(name => name.startsWith('pending-restore-')) : [];
    return { dir, records: rows.length, last: rows.at(-1) ?? null, all: rows, pendingRestores };
  }

  return { queue, leases, windows };
}
