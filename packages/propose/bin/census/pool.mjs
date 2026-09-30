// A persistent worker pool for headless night sweeps.
//
// A simulated night is pure: seeded RNG, no shared state, no DOM. So a sweep
// over seeds is embarrassingly parallel, and the only reason the search tools
// were single-threaded is that nothing here span the threads. Measured over
// 4000 nights on a 4-performance-core Mac: 10.6 s serial, 3.9 s across 8
// workers.
//
// Worker startup dominates below roughly a thousand nights, so the pool is
// created once per process and reused across every batch a search issues --
// never per call to a fitness function.
//
// A task is `(mod, fn, optsList)`: each worker imports `mod` once and maps
// `fn` over its share of `optsList`. Both the options and the return value
// cross a structured clone, so tasks take and return plain JSON-shaped data --
// see `summarize` in model/reactive-pilot.mjs for the shape that implies.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

const WORKER_URL = new URL('./pool-worker.mjs', import.meta.url);

// Beyond the physical core count the extra threads only contend, and the
// harness is not the only thing running on the machine.
export const DEFAULT_WORKERS = Math.max(1, Math.min(8, availableParallelism()));
const workerArg = () => {
  const raw = process.argv.find(a => a.startsWith('--workers='));
  if (!raw) return DEFAULT_WORKERS;
  const n = Number(raw.slice('--workers='.length));
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--workers must be a positive integer, got ${raw}`);
  return n;
};
const batchArg = () => {
  const raw = process.argv.find(a => a.startsWith('--pool-batch='));
  if (!raw) return 16;
  const n = Number(raw.slice('--pool-batch='.length));
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--pool-batch must be a positive integer, got ${raw}`);
  return n;
};

export class SimPool {
  constructor({ workers = DEFAULT_WORKERS } = {}) {
    this.size = Math.max(1, workers);
    this.workers = null;   // spawned on first use
    this.nextId = 0;
  }

  spawn() {
    if (this.workers) return;
    this.workers = Array.from({ length: this.size }, () => {
      const w = new Worker(WORKER_URL);
      w.unref();           // a pending pool must not hold the process open
      return w;
    });
  }

  // Map `fn` over `optsList`, returning results in the caller's order.
  // A persistent work queue lets a worker take another batch immediately
  // after an early-death batch.  This matters for candidate searches: a weak
  // candidate's Night 7 jobs often finish much sooner than a survivor's.
  // `--pool-batch=1` is useful when each option is itself a large seed batch;
  // the default amortizes IPC for ordinary short jobs.
  async map(mod, fn, optsList) {
    if (!optsList.length) return [];
    if (this.size === 1) return runSerial(mod, fn, optsList);
    this.spawn();
    const batchSize = batchArg();
    const jobs = [];
    for (let start = 0; start < optsList.length; start += batchSize)
      jobs.push({ start, batch: optsList.slice(start, start + batchSize) });
    const out = new Array(optsList.length);
    let next = 0;
    const runWorker = async (worker) => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const values = await this.send(worker, mod, fn, job.batch);
        values.forEach((v, i) => { out[job.start + i] = v; });
      }
    };
    await Promise.all(this.workers.map(runWorker));
    return out;
  }

  send(worker, mod, fn, batch) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const onMessage = (m) => {
        if (m.id !== id) return;
        worker.off('message', onMessage);
        worker.off('error', onError);
        m.error ? reject(new Error(m.error)) : resolve(m.values);
      };
      const onError = (err) => {
        worker.off('message', onMessage);
        worker.off('error', onError);
        reject(err);
      };
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.postMessage({ id, mod, fn, batch });
    });
  }

  async close() {
    if (!this.workers) return;
    const ws = this.workers;
    this.workers = null;
    await Promise.all(ws.map(w => w.terminate()));
  }
}

async function runSerial(mod, fn, optsList) {
  const m = await import(mod);
  return optsList.map(o => m[fn](o));
}

// The process-wide pool the search tools share. `--serial` forces one thread,
// which is the way to check that a parallel result matches the old one.
let shared = null;
export function pool() {
  if (!shared) {
    shared = new SimPool({
      workers: process.argv.includes('--serial') ? 1 : workerArg(),
    });
  }
  return shared;
}
export const closePool = () => shared ? shared.close() : Promise.resolve();
