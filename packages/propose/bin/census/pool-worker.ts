// Worker half of packages/propose/bin/census/pool.ts. Holds imported task modules for the life of
// the process so a search pays each module's import cost once, not once per
// batch.
import { parentPort } from 'node:worker_threads';

const modules = new Map<string, Readonly<Record<string, unknown>>>();
// A worker thread always has its parent's port.
const port = parentPort as NonNullable<typeof parentPort>;

port.on('message', async ({ id, mod, fn, batch }: { id: number, mod: string, fn: string, batch: unknown[] }) => {
  try {
    let m = modules.get(mod);
    if (!m) { m = await import(mod) as Readonly<Record<string, unknown>>; modules.set(mod, m); }
    const task = m[fn];
    if (typeof task !== 'function')
      throw new Error(`${mod} does not export a function named ${fn}`);
    port.postMessage({ id, values: batch.map(o => task(o)) });
  } catch (err) {
    port.postMessage({ id, error: (err as Error).stack || String(err) });
  }
});
