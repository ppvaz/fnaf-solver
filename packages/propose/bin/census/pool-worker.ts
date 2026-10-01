// Worker half of packages/propose/bin/census/pool.ts. Holds imported task modules for the life of
// the process so a search pays each module's import cost once, not once per
// batch.
import { parentPort } from 'node:worker_threads';

const modules = new Map();

parentPort.on('message', async ({ id, mod, fn, batch }) => {
  try {
    let m = modules.get(mod);
    if (!m) { m = await import(mod); modules.set(mod, m); }
    const task = m[fn];
    if (typeof task !== 'function')
      throw new Error(`${mod} does not export a function named ${fn}`);
    parentPort.postMessage({ id, values: batch.map(o => task(o)) });
  } catch (err) {
    parentPort.postMessage({ id, error: err.stack || String(err) });
  }
});
