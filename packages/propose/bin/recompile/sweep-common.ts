// What every predeclared phone-night sweep shares: its command line, its predeclaration (hashed as read), the
// measured-seed check, and a worker pool whose workers run only for the tool that started them.
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

export const sha256 = (bytes: BinaryLike) => createHash('sha256').update(bytes).digest('hex');

/** A sweep's command line: its predeclaration, how many workers, and where its record goes. */
export interface SweepArgs { readonly predeclaration: string, readonly workers: number, readonly out?: string }
/** What every sweep's predeclaration names: its id, the night and its measured seed, and its inputs' sha256. */
export interface SweepPredeclaration {
  readonly id: string, readonly night: string, readonly seed: number, readonly inputs?: Readonly<Record<string, string>>;
}
/** A night's inputs as the check reads them: the measured seed and each input's sha256. */
export interface SweepInputs { readonly measuredSeed: number, readonly hashes: Readonly<Record<string, string | null>> }

/** `--predeclaration FILE [--workers N] [--out FILE]`, refusing anything else. */
export function sweepArgs(argv: readonly string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--predeclaration', '--workers', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.predeclaration) throw new Error('--predeclaration is required');
  // --predeclaration was checked just above, and nothing else is accepted.
  return { ...args, workers: Number(args.workers ?? Math.max(1, Math.min(6, cpus().length - 2))) } as SweepArgs;
}

/** The predeclaration, its sha256, and the night's inputs, refused when the measured seed or an input hash moved. */
export function predeclared<P extends SweepPredeclaration = SweepPredeclaration, I extends SweepInputs = SweepInputs>(
  path: string, inputs: (night: string) => I) {
  const bytes = readFileSync(path);
  const pre: P = JSON.parse(bytes.toString('utf8'));
  const inp = inputs(pre.night);
  if (inp.measuredSeed !== pre.seed) throw new Error(`${pre.night}'s measured seed is ${inp.measuredSeed}, not the predeclared ${pre.seed}`);
  for (const [k, v] of Object.entries(pre.inputs ?? {})) if (inp.hashes[k] !== v) throw new Error(`input ${k} changed since the predeclaration`);
  return { pre, inp, record: { path, sha256: sha256(bytes), id: pre.id } };
}

/** Items split over `workers` workers of the module at `moduleUrl`, each started with { tool, ...data, chunk }. */
export function fanOut<T, R>(moduleUrl: string, tool: string, data: object, items: readonly T[], workers: number) {
  const chunks = Array.from({ length: workers }, (_, w) => items.filter((_, k) => k % workers === w));
  // Each worker posts its chunk's results.
  return Promise.all(chunks.filter((c) => c.length).map((chunk) => new Promise<R[]>((done, fail) => {
    const worker = new Worker(fileURLToPath(moduleUrl), { workerData: { tool, ...data, chunk } });
    worker.on('message', done); worker.on('error', fail);
    worker.on('exit', (code) => { if (code) fail(new Error(`${tool} worker exited ${code}`)); });
  }))).then((parts) => parts.flat());
}
