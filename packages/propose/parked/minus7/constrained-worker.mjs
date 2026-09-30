// Worker task for constrainedsearch.mjs.  It deliberately delegates to the
// same recipe -> devicePlan -> jitterPlan -> replay path as paramsearch.mjs;
// workers provide CPU parallelism around the engine, never a second engine.
import { evalParams } from './paramsearch.mjs';

export function evaluateNight({ candidateId, params, night, runs, shape, seedStart = 1 }) {
  const result = evalParams(params, [night], runs, shape, seedStart);
  return { candidateId, night, result: result.nights[night], ok: result.ok,
           error: result.error ?? null };
}
