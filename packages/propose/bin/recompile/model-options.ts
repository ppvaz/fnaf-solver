// Constructor-time model options for the Sim, injected through a setter on Sim.prototype.opts that merges
// them into the constructor's own options object: withModelOptions for one call, useModelOptions for a whole
// process (tools/legacy-model.ts). Split out of rebuild-options-census.ts so that a preload can import it
// without that census's import graph, which reaches scripts whose main guard would run at import time.
import { Sim } from '@sixam/source/fnaf2';

type SimOptions = Readonly<Record<string, unknown>>;

let active = null as SimOptions | null;
let installed = false;
function install() {
  if (installed) return;
  if (Object.getOwnPropertyDescriptor(Sim.prototype, 'opts')) throw new Error('Sim.prototype.opts is already defined');
  Object.defineProperty(Sim.prototype, 'opts', {
    configurable: true,
    set(this: object, value: object) {
      Object.defineProperty(this, 'opts', { value: active ? Object.assign(value, active) : value,
        writable: true, configurable: true, enumerable: true });
    },
  });
  installed = true;
}

/** Run `fn` with every Sim constructed inside it carrying `simOptions`. */
export function withModelOptions<T>(simOptions: SimOptions, fn: () => T): T {
  install();
  if (active) throw new Error('withModelOptions does not nest');
  active = Object.keys(simOptions).length ? simOptions : null;
  try { return fn(); } finally { active = null; }
}

/**
 * Every Sim this process constructs from now on carries `simOptions`: withModelOptions for a whole process.
 * tools/legacy-model.ts preloads it for the checks that encode the legacy model.
 */
export function useModelOptions(simOptions: SimOptions) {
  install();
  if (active) throw new Error('useModelOptions: model options are already injected');
  active = simOptions;
}
