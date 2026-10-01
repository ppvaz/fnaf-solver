/**
 * Compose a reviewed campaign from named UI, proof, and device-local ports.
 * The composition root is the only place that binds a bundle to execution;
 * campaign logic never receives coordinates, ADB verbs, or strategy text.
 */
import { makeCampaignExecutionRequest, validateCampaignBundle } from './campaign-bundle.ts';
import type { CampaignBundle } from './campaign-bundle.ts';
import { DeviceCampaignRunner } from './campaign-runner.ts';
import type { CampaignPorts } from './campaign-runner.ts';
import { validateCampaignSpec } from './campaign.ts';
import type { ExecutorRequest } from './artifact-executor.ts';

const required = (value: unknown, name: string) => {
  if (typeof value !== 'function') throw new TypeError(`campaign composition requires ${name} port`);
  return value;
};

export function composeCampaignPorts(options: {spec: unknown, bundle: CampaignBundle, profile: unknown,
  artifact?: { winnerHash?: string, engineHash?: string, profileHash?: string },
  devicePreflight: CampaignPorts['preflight'], menu: CampaignPorts['menu'], customNight?: CampaignPorts['customNight'],
  intro: CampaignPorts['intro'], terminal: CampaignPorts['terminal'], terminalVerification: CampaignPorts['terminalVerification'],
  save: CampaignPorts['save'], retryReady: CampaignPorts['retryReady'], armMode?: string,
  restartAfterAbort?: (reason: unknown) => unknown,
  localExecutor: { execute(request: ExecutorRequest): unknown, abort(reason: string): unknown, releaseAll(): unknown }}) {
  const { spec, bundle, profile, artifact = {}, devicePreflight, menu, customNight,
    intro, terminal, terminalVerification, save, retryReady, armMode, restartAfterAbort,
    localExecutor } = options ?? {};
  validateCampaignBundle({ spec, plans: bundle?.plans });
  for (const [name, port] of Object.entries({ devicePreflight, menu, intro, terminal,
    terminalVerification, save, retryReady })) required(port, name);
  if (validateCampaignSpec(spec).nights.some(target => target.mode === 'custom')) required(customNight, 'customNight');
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
      try { await localExecutor.abort(`campaign-cleanup: ${(reason as Error | undefined)?.message ?? 'campaign stopped'}`); }
      finally {
        try { await localExecutor.releaseAll(); }
        finally { await restartAfterAbort?.(reason); }
      }
    },
  } satisfies CampaignPorts;
  return Object.freeze({ ports, runner: new DeviceCampaignRunner({ spec, ports }), deviceLocal: true });
}
