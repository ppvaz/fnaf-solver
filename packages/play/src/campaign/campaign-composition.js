/**
 * Compose a reviewed campaign from named UI, proof, and device-local ports.
 * The composition root is the only place that binds a bundle to execution;
 * campaign logic never receives coordinates, ADB verbs, or strategy text.
 */
import { makeCampaignExecutionRequest, validateCampaignBundle } from './campaign-bundle.js';
import { DeviceCampaignRunner } from './campaign-runner.js';

const required = (value, name) => {
  if (typeof value !== 'function') throw new TypeError(`campaign composition requires ${name} port`);
  return value;
};

/**
 * @param {{spec: any, bundle: any, profile: any, artifact?: any,
 *   devicePreflight: Function, menu: Function, customNight?: Function,
 *   intro: Function, terminal: Function, terminalVerification: Function,
 *   save: Function, retryReady: Function, armMode?: string,
 *   restartAfterAbort?: Function,
 *   localExecutor: {execute: Function, abort: Function, releaseAll: Function}}} options
 */
export function composeCampaignPorts(options) {
  const { spec, bundle, profile, artifact = {}, devicePreflight, menu, customNight,
    intro, terminal, terminalVerification, save, retryReady, armMode, restartAfterAbort,
    localExecutor } = options ?? {};
  validateCampaignBundle({ spec, plans: bundle?.plans });
  for (const [name, port] of Object.entries({ devicePreflight, menu, intro, terminal,
    terminalVerification, save, retryReady })) required(port, name);
  if (spec.nights.some(target => target.mode === 'custom')) required(customNight, 'customNight');
  if (!localExecutor || typeof localExecutor.execute !== 'function' ||
      typeof localExecutor.abort !== 'function' || typeof localExecutor.releaseAll !== 'function')
    throw new TypeError('campaign composition requires a device-local executor');

  const ports = {
    preflight: args => devicePreflight(args),
    menu: args => menu(args),
    customNight: customNight ? args => customNight(args) : undefined,
    intro: args => intro(args),
    executeAttempt: ({ target }) => {
      const plan = bundle.plans.find(item => item.night === target.night);
      const request = makeCampaignExecutionRequest({ bundle, plan, profile, mode: 'live', artifact, armMode });
      return localExecutor.execute(request);
    },
    terminal: args => terminal(args),
    terminalVerification: args => terminalVerification(args),
    save: args => save(args),
    retryReady: args => retryReady(args),
    releaseAll: () => localExecutor.releaseAll(),
    cleanup: async reason => {
      try { await localExecutor.abort(`campaign-cleanup: ${reason?.message ?? 'campaign stopped'}`); }
      finally {
        try { await localExecutor.releaseAll(); }
        finally { await restartAfterAbort?.(reason); }
      }
    },
  };
  return Object.freeze({ ports, runner: new DeviceCampaignRunner({ spec, ports }), deviceLocal: true });
}
