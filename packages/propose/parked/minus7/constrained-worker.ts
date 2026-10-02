// Worker task for constrainedsearch.mjs.  It deliberately delegates to the
// same recipe -> devicePlan -> jitterPlan -> replay path as paramsearch.ts;
// workers provide CPU parallelism around the engine, never a second engine.
import { evalParams } from './paramsearch.ts';
import type { Params } from './paramsearch.ts';

export function evaluateNight({ candidateId, params, night, runs, shape, seedStart = 1 }: {
  candidateId: string, params: Params, night: number, runs: number, shape: string, seedStart?: number,
}) {
  const result = evalParams(params, [night], runs, shape, seedStart);
  return { candidateId, night, result: result.nights[night], ok: result.ok,
           error: result.error ?? null };
}
