// What every predeclared phone-night sweep shares: its command line, its predeclaration (hashed as read), the
// measured-seed check, and a worker pool whose workers run only for the tool that started them.
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { isRecord } from '@sixam/kernel';

export const sha256 = (bytes: BinaryLike) => createHash('sha256').update(bytes).digest('hex');

/** A power check passed: it planted at least one state and recovered every one. Planting nothing shows no power. */
export const powerCheckPassed = <T>(planted: readonly T[], recovered: (item: T) => boolean) =>
  planted.length > 0 && planted.every(recovered);

/** A sweep's command line: its predeclaration, how many workers, and where its record goes. */
export interface SweepArgs { readonly predeclaration: string, readonly workers: number, readonly out?: string }
/** What every sweep's predeclaration names: its id, the night and its measured seed, and its inputs' sha256. */
export interface SweepPredeclaration {
  readonly id: string, readonly night: string, readonly seed: number, readonly inputs: Readonly<Record<string, string>>;
}
/** A checked predeclaration's shared fields, with the tool's own fields still to be checked. */
export type DeclaredFields = SweepPredeclaration & Readonly<Record<string, unknown>>;
/** A night's inputs as the check reads them: the measured seed and each input's sha256. */
export interface SweepInputs { readonly measuredSeed: number, readonly hashes: Readonly<Record<string, string | null>> }

/** A worker count: a whole number of at least one, since a pool of none scores nothing and a sweep would decide on it. */
export function workerCount(value: unknown) {
  const workers = Number(value);
  if (!Number.isInteger(workers) || workers < 1) throw new Error(`--workers must be a whole number of at least 1, not ${String(value)}`);
  return workers;
}

/** `--predeclaration FILE [--workers N] [--out FILE]`, refusing anything else. */
export function sweepArgs(argv: readonly string[]): SweepArgs {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--predeclaration', '--workers', '--out'].includes(argv[i]) || !argv[i + 1]) throw new Error('see usage at top of file');
    args[argv[i].slice(2)] = argv[i + 1];
  }
  if (!args.predeclaration) throw new Error('--predeclaration is required');
  return { predeclaration: args.predeclaration, workers: workerCount(args.workers ?? Math.max(1, Math.min(6, cpus().length - 2))),
    ...(args.out ? { out: args.out } : {}) };
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * The fields every sweep's predeclaration carries, checked: its id, the night, the measured seed, and the sha256 of each
 * input it reads. One that pins no input cannot show its inputs held between the declaration and the run, so it is refused.
 */
export function checkSweepPredeclaration(value: unknown, where: string): DeclaredFields {
  const refuse = (why: string): never => { throw new Error(`${where}: ${why}`); };
  if (!isRecord(value)) return refuse('a predeclaration is an object');
  const text = (field: unknown) => typeof field === 'string' && field.trim().length > 0;
  if (!text(value.id) || !text(value.night)) refuse('id and night must be text');
  if (!Number.isInteger(value.seed)) refuse('seed must be an integer');
  const { inputs } = value;
  if (!isRecord(inputs) || !Object.keys(inputs).length)
    return refuse('inputs must pin each input the sweep reads by its sha256; a predeclaration that pins none cannot show they held');
  for (const [name, hash] of Object.entries(inputs))
    if (typeof hash !== 'string' || !SHA256.test(hash)) refuse(`inputs.${name} is not a sha256`);
  return value as unknown as DeclaredFields;
}

/**
 * The predeclaration (shared fields checked here, the tool's own by `own`), its sha256, and the night's inputs: refused
 * when the measured seed moved, when the sweep reads an input the predeclaration does not pin, or when a pinned input's
 * hash moved.
 */
export function predeclared<P extends SweepPredeclaration, I extends SweepInputs>(path: string, inputs: (night: string) => I,
  own: (fields: DeclaredFields, where: string) => P) {
  const bytes = readFileSync(path);
  const pre = own(checkSweepPredeclaration(JSON.parse(bytes.toString('utf8')), path), path);
  const inp = inputs(pre.night);
  if (inp.measuredSeed !== pre.seed) throw new Error(`${pre.night}'s measured seed is ${inp.measuredSeed}, not the predeclared ${pre.seed}`);
  for (const [name, hash] of Object.entries(inp.hashes))
    if (hash !== null && !(name in pre.inputs)) throw new Error(`${path}: the sweep reads ${name}, which the predeclaration does not pin`);
  for (const [k, v] of Object.entries(pre.inputs)) if (inp.hashes[k] !== v) throw new Error(`input ${k} changed since the predeclaration`);
  return { pre, inp, record: { path, sha256: sha256(bytes), id: pre.id } };
}

/** Items split over `workers` workers of the module at `moduleUrl`, each started with { tool, ...data, chunk }. */
export function fanOut<T, R>(moduleUrl: string, tool: string, data: object, items: readonly T[], workers: number) {
  if (!Number.isInteger(workers) || workers < 1) return Promise.reject(new Error(`${tool}: ${workers} workers score nothing`));
  const chunks = Array.from({ length: workers }, (_, w) => items.filter((_, k) => k % workers === w));
  // Each worker posts its chunk's results.
  return Promise.all(chunks.filter((c) => c.length).map((chunk) => new Promise<R[]>((done, fail) => {
    const worker = new Worker(fileURLToPath(moduleUrl), { workerData: { tool, ...data, chunk } });
    worker.on('message', done); worker.on('error', fail);
    worker.on('exit', (code) => { if (code) fail(new Error(`${tool} worker exited ${code}`)); });
  }))).then((parts) => parts.flat());
}
