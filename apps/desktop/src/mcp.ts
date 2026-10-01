/**
 * The Companion's MCP surface (./companion-mcp.mjs): setup and
 * the device-work queue, as a closed vocabulary. Raw coordinates, HID input
 * and arbitrary shell are absent. It queues bounded jobs and never runs a
 * control loop; the campaign executor is the one path onto a phone.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { BINDINGS_DIR, WINNER_FILE, isOneOf } from '@sixam/kernel';

const CUE_TOOLS = Object.freeze(['cue.setup', 'cue.queue.enqueue', 'cue.queue.list', 'cue.queue.run']);

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CUE_SETUP = fileURLToPath(new URL('../../../packages/play/bin/companion/companion-setup.sh', import.meta.url));
const CUE_QUEUE = fileURLToPath(new URL('../../../apps/lab/companion-queue.sh', import.meta.url));
const execFile = promisify(execFileCallback);

/** A tool's arguments, as the MCP client sent them. */
type Args = Readonly<Record<string, unknown>>;
interface Failure { readonly ok: false, readonly error: { readonly code: string, readonly message: string } }
interface SetupOptions { screen: 'menu' | 'night', waitSeconds: number, install: boolean, probe: boolean, stop: boolean }
type EnqueueOptions =
  | { kind: 'night', game: string, winner: string, night: number, label: string | undefined, audio: boolean, idempotencyKey: string | undefined }
  | { kind: 'setup' | 'menu-check' | 'night-check', screen: 'menu' | 'night', install: boolean, probe: boolean, idempotencyKey: string | undefined };
/** What a queue or setup script left: its exit code and output. */
interface CueRun { readonly exitCode: number, readonly stdout: string, readonly stderr: string }

const isInteger = (value: unknown): value is number => Number.isInteger(value);
const isKey = (value: unknown): value is string | undefined => value === undefined
  || (typeof value === 'string' && value.length >= 1 && value.length <= 128);

function error(code: string, message: string): Failure { return { ok: false, error: { code, message } }; }

function booleanArg(args: Args, name: string) {
  if (args[name] !== undefined && typeof args[name] !== 'boolean')
    return error('INVALID_ARGUMENT', `${name} must be boolean`);
  return null;
}

function numberArg(args: Args, name: string, { defaultValue, min, max }: { defaultValue: number, min: number, max: number }) {
  const value = args[name] ?? defaultValue;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    return error('INVALID_ARGUMENT', `${name} must be between ${min} and ${max}`);
  return value;
}

function cueSetupArgs(args: Args): SetupOptions | Failure {
  for (const name of ['install', 'probe', 'stop']) {
    const invalid = booleanArg(args, name); if (invalid) return invalid;
  }
  if (args.screen !== undefined && args.screen !== 'menu' && args.screen !== 'night')
    return error('INVALID_ARGUMENT', 'screen must be menu or night');
  const wait = numberArg(args, 'waitSeconds', { defaultValue: 20, min: 1, max: 300 });
  if (typeof wait !== 'number') return wait;
  if (args.stop && (args.install || args.probe))
    return error('INVALID_ARGUMENT', 'stop cannot be combined with install or probe');
  return { screen: args.screen ?? 'menu', waitSeconds: wait,
    install: args.install === true, probe: args.probe === true, stop: args.stop === true };
}

function cueSetupCommand(options: SetupOptions) {
  const command: string[] = [];
  if (options.install) command.push('--install');
  if (options.probe) command.push('--probe');
  if (options.stop) command.push('--stop');
  command.push('--screen', options.screen, '--wait', String(options.waitSeconds));
  return command;
}

const NIGHT_GAMES = Object.freeze(['fnaf2', 'fnaf1', 'fnaf4']);
const NIGHT_LABEL = /^[a-z0-9][a-z0-9-]{0,24}$/;

/**
 * A night job (Pedro, 2026-09-27: "Yes, play nights"): one night of a committed
 * winner file, nothing else. The queue re-validates it (custody, schema, the
 * winner's own night, a fresh emit) and claims it only inside an overnight
 * window; cue.queue.run never plays one.
 */
function cueNightArgs(args: Args): EnqueueOptions | Failure {
  for (const name of ['screen', 'install', 'probe'])
    if (args[name] !== undefined) return error('INVALID_ARGUMENT', `a night job takes no ${name}`);
  if (!isOneOf(NIGHT_GAMES, args.game)) return error('INVALID_ARGUMENT', `game must be one of ${NIGHT_GAMES.join(', ')}`);
  if (typeof args.winner !== 'string' || !WINNER_FILE.test(args.winner))
    return error('INVALID_ARGUMENT', `winner must name a ${BINDINGS_DIR}/<game>/*-winner.json file`);
  if (!isInteger(args.night) || args.night < 1 || args.night > 8)
    return error('INVALID_ARGUMENT', 'night must be an integer 1..8');
  if (args.label !== undefined && (typeof args.label !== 'string' || !NIGHT_LABEL.test(args.label)))
    return error('INVALID_ARGUMENT', 'label is 1-25 lowercase letters, digits and hyphens');
  const invalid = booleanArg(args, 'audio'); if (invalid) return invalid;
  if (!isKey(args.idempotencyKey))
    return error('INVALID_ARGUMENT', 'idempotencyKey must be 1..128 characters');
  return { kind: 'night', game: args.game, winner: args.winner, night: args.night, label: args.label,
    audio: args.audio === true, idempotencyKey: args.idempotencyKey };
}

function cueQueueEnqueueArgs(args: Args): EnqueueOptions | Failure {
  if (args.kind === 'night') return cueNightArgs(args);
  if (!isOneOf(['setup', 'menu-check', 'night-check'] as const, args.kind))
    return error('INVALID_ARGUMENT', 'kind must be setup, menu-check, night-check, or night');
  for (const name of ['game', 'winner', 'night', 'label', 'audio'])
    if (args[name] !== undefined) return error('INVALID_ARGUMENT', `${name} belongs to a night job`);
  for (const name of ['install', 'probe']) {
    const invalid = booleanArg(args, name); if (invalid) return invalid;
  }
  const expectedScreen = args.kind === 'night-check' ? 'night' : 'menu';
  const screen = args.screen ?? expectedScreen;
  if (screen !== 'menu' && screen !== 'night') return error('INVALID_ARGUMENT', 'screen must be menu or night');
  if (args.kind === 'menu-check' && screen !== 'menu') return error('INVALID_ARGUMENT', 'menu-check must target menu');
  if (args.kind === 'night-check' && screen !== 'night') return error('INVALID_ARGUMENT', 'night-check must target night');
  if (args.kind !== 'setup' && (args.install || args.probe))
    return error('INVALID_ARGUMENT', 'install/probe options are available only for setup jobs');
  if (!isKey(args.idempotencyKey))
    return error('INVALID_ARGUMENT', 'idempotencyKey must be 1..128 characters');
  return { kind: args.kind, screen, install: args.install === true, probe: args.probe === true,
    idempotencyKey: args.idempotencyKey };
}

function cueQueueCommand(options: EnqueueOptions) {
  const command = ['enqueue', options.kind];
  if (options.kind === 'night') {
    command.push('--game', options.game, '--winner', options.winner, '--night', String(options.night));
    if (options.label) command.push('--label', options.label);
    if (options.audio) command.push('--audio');
    if (options.idempotencyKey) command.push('--idempotency-key', options.idempotencyKey);
    command.push('--json');
    return command;
  }
  if (options.screen) command.push('--screen', options.screen);
  if (options.install) command.push('--install');
  if (options.probe) command.push('--probe');
  if (options.idempotencyKey) command.push('--idempotency-key', options.idempotencyKey);
  command.push('--json');
  return command;
}

function cueRunOptions(args: Args) {
  const wait = numberArg(args, 'waitSeconds', { defaultValue: 0, min: 0, max: 86400 });
  if (typeof wait !== 'number') return wait;
  const interval = numberArg(args, 'intervalSeconds', { defaultValue: 5, min: 0.1, max: 300 });
  if (typeof interval !== 'number') return interval;
  return { waitSeconds: wait, intervalSeconds: interval };
}

async function runCueCommand(script: string, args: string[], options: { timeoutMs?: number } = {}): Promise<CueRun> {
  try {
    const result = await execFile(script, args, {
      cwd: ROOT, shell: false, env: process.env,
      timeout: options.timeoutMs ?? 360000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  } catch (cause) {
    // execFile rejects with an Error carrying the child's exit code (or a spawn error's code) and output.
    const failure = cause as Error & { code?: number | string, stdout?: string, stderr?: string };
    return {
      exitCode: isInteger(failure.code) ? failure.code : 1,
      stdout: failure.stdout ?? '', stderr: failure.stderr ?? failure.message ?? '',
    };
  }
}

function cueResult(operation: string, result: CueRun) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.exitCode === 75 || output.includes('QUEUE HOLD'))
    return { ok: true as const, operation, status: 'HOLD', exitCode: result.exitCode, output };
  if (result.exitCode !== 0)
    return error(`${operation.toUpperCase().replaceAll('.', '_')}_FAILED`, `${operation} failed (exit ${result.exitCode}): ${output}`);
  return { ok: true as const, operation, status: 'DONE', exitCode: 0, output };
}

/**
 * The Companion host tools are also usable without composing the actuation
 * service. They intentionally remain a closed, safe vocabulary: setup and
 * queue scripts are fixed, and no caller-provided shell, coordinates, or HID
 * input can cross this boundary.
 */
export function createCompanionMcp({ run = runCueCommand }: { run?: typeof runCueCommand } = {}) {
  return {
    tools: () => [...CUE_TOOLS],
    async call(name: string, args: Args = {}) {
      if (!CUE_TOOLS.includes(name)) return error('NOT_FOUND', `tool is not exposed: ${name}`);
      try {
        if (name === 'cue.setup') {
          const options = cueSetupArgs(args);
          if ('ok' in options) return options;
          const result = await run(CUE_SETUP, cueSetupCommand(options), {
            timeoutMs: Math.max(120000, (options.waitSeconds + 120) * 1000),
          });
          return cueResult('cue.setup', result);
        }
        if (name === 'cue.queue.enqueue') {
          const options = cueQueueEnqueueArgs(args);
          if ('ok' in options) return options;
          const result = await run(CUE_QUEUE, cueQueueCommand(options));
          if (result.exitCode !== 0) return cueResult('cue.queue.enqueue', result);
          // What companion-queue.py enqueue --json prints.
          let payload: { job?: unknown, created?: unknown };
          try { payload = JSON.parse(result.stdout); }
          catch { return error('QUEUE_PROTOCOL', 'queue enqueue returned invalid JSON'); }
          const job = payload.job;
          return { ok: true as const, operation: 'cue.queue.enqueue',
            status: payload.created === false ? 'EXISTING' : 'QUEUED', job };
        }
        if (name === 'cue.queue.list') {
          const result = await run(CUE_QUEUE, ['list', '--json']);
          if (result.exitCode !== 0) return cueResult('cue.queue.list', result);
          try { return { ok: true as const, operation: 'cue.queue.list', jobs: (JSON.parse(result.stdout) as { jobs: unknown }).jobs }; }
          catch { return error('QUEUE_PROTOCOL', 'queue list returned invalid JSON'); }
        }
        const options = cueRunOptions(args);
        if ('ok' in options) return options;
        const result = await run(CUE_QUEUE, ['run', '--wait', String(options.waitSeconds), '--interval', String(options.intervalSeconds)], {
          timeoutMs: Math.max(120000, (options.waitSeconds + 120) * 1000),
        });
        return cueResult('cue.queue.run', result);
      } catch (cause) { return error('REJECTED', (cause as Error).message); }
    },
  };
}

