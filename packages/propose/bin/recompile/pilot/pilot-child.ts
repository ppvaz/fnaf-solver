// pilot.ts run as a child process for one seed, read one way by every tool that drives it (batch.ts, search.ts,
// fnaf4-run-seed.ts): its exit code and output once its streams close, its summary line checked, the save it left,
// and what went wrong when something did. A crash or a summary that cannot be read is a failure the caller reports,
// never a quiet null.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from '@sixam/kernel';
import type { PilotSummary } from './pilot.ts';
import { iniKeys } from './record.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PILOT = join(HERE, 'pilot.ts');

/** A pilot child's exit code and its whole stdout and stderr. */
export function spawnPilot(args: readonly string[]): Promise<{ readonly code: number | null, readonly out: string, readonly err: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [PILOT, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    // 'close', not 'exit': a child's last stdout chunk can arrive after its
    // exit event, and a summary that lists every task start is long enough to
    // be cut off (seed 50005, 2026-09-30, read as a night that never started).
    child.on('close', (code) => done({ code, out, err }));
  });
}

/** A pilot run's summary line, checked: its exit, updates, runtime and last play tick (outcome and starts as written). */
export function pilotSummary(value: unknown): PilotSummary {
  const exit = isRecord(value) ? value.exit : undefined;
  if (!isRecord(value) || !(exit === null || typeof exit === 'number' || typeof exit === 'string') ||
      !Number.isInteger(value.updates) || typeof value.runtime !== 'string' ||
      !(value.lastPlayTick === null || Number.isInteger(value.lastPlayTick)))
    throw new TypeError(`not a pilot summary: ${JSON.stringify(value)?.slice(0, 160)}`);
  return value as unknown as PilotSummary;
}

/** What batch and search give a child: the game, its binary, assets and save, and the policy with its knobs. */
export interface PilotChildOptions {
  readonly game: string, readonly binary: string, readonly assets: string, readonly save: string, readonly policy: string;
  readonly knobs: Readonly<Record<string, unknown>>;
}
/** How a batch or search child ended: its summary, the failure when there is none to trust, and the save it left. */
export interface PilotChildRun {
  readonly summary: PilotSummary | null, readonly failure: string | null, readonly save: Readonly<Record<string, string>>;
}

/** One seed of a batch or search: the night to `--stop-frame 5`, killed on a loss, from `--run DIR`, plus `extra`. */
export async function runPilotChild(o: PilotChildOptions, seed: number, dir: string, saveName: string,
  { extra = [], tailLines = 3 }: { extra?: readonly string[], tailLines?: number } = {}): Promise<PilotChildRun> {
  const { code, out, err } = await spawnPilot(['--game', o.game, '--run', dir, '--binary', o.binary, '--assets', o.assets,
    '--save', o.save, '--policy', o.policy, '--seed', String(seed), '--max-ticks', '30000',
    '--stop-frame', '5', '--no-trace', '--kill-on-loss', '--knobs', JSON.stringify({ ...o.knobs, quiet: true }), ...extra]);
  const savePath = join(dir, saveName);
  const save = existsSync(savePath) ? iniKeys(readFileSync(savePath, 'utf8')) : {};
  if (code !== 0) return { summary: null, failure: `exit ${code}: ${err.trim().split('\n').slice(-tailLines).join(' | ')}`, save };
  const last = out.trim().split('\n').at(-1) ?? '';
  try {
    return { summary: pilotSummary(JSON.parse(last)), failure: null, save };
  } catch (error) {
    return { summary: null, failure: `no summary line: ${(error as Error).message}`, save };
  }
}

/** The win keys (`section.key=value`) a save does not hold. */
export const missingWinKeys = (save: Readonly<Record<string, string>>, winKeys: readonly string[]) =>
  winKeys.filter((key) => save[key.split('=')[0]] !== key.split('=')[1]);
