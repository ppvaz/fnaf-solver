/**
 * Bounded campaign orchestration above CampaignStateMachine.
 *
 * Every physical operation is an injected port. This runner decides when a
 * port may be called and when its result is accepted; it never selects an ADB
 * command, coordinate, policy, or transport. That keeps the same campaign
 * usable with fixtures and with an externally qualified device executor.
 * CONTRACT:device-campaign-v1.
 */
import { CampaignStateMachine, validateCampaignSpec } from './campaign.ts';
import type { CampaignSpec, CampaignTarget } from './campaign.ts';
import { makeAttemptProof } from './campaign-proof.ts';

/** What one of the machine's accept methods takes: what the matching port returns. */
type Accepts<Method extends keyof CampaignStateMachine> =
  NonNullable<CampaignStateMachine[Method] extends (input: infer Input) => unknown ? Input : never>;
type Port<Input, Output> = (input: Input) => Promise<Output> | Output;
type Night = { target: CampaignTarget, spec: CampaignSpec };

/** Every physical step a campaign takes, injected. */
export interface CampaignPorts {
  preflight: Port<{ spec: CampaignSpec }, Accepts<'acceptPreflight'>>;
  menu: Port<Night & { attempt: number }, Accepts<'acceptMenu'>>;
  customNight?: Port<Night, Accepts<'acceptCustomConfiguration'>>;
  intro: Port<Night, Accepts<'acceptIntro'>>;
  executeAttempt: Port<Night & { attempt: number }, unknown>;
  terminal: Port<Night & { execution: unknown }, Accepts<'acceptTerminal'>>;
  terminalVerification: Port<Night & { execution: unknown, terminal: unknown }, Accepts<'acceptTerminalVerification'>>;
  save: Port<Night & { execution: unknown, terminal: unknown }, Accepts<'acceptSave'>>;
  retryReady: Port<Night & { execution: unknown }, Accepts<'acceptRetry'>>;
  stopAttempt?: Port<{ target: CampaignTarget, execution: unknown, terminal: unknown, reason: string }, unknown>;
  cleanup?: (error: unknown) => unknown;
  releaseAll?: () => unknown;
}

const required = (ports: Partial<CampaignPorts>, name: keyof CampaignPorts) => {
  if (typeof ports?.[name] !== 'function') throw new TypeError(`campaign runner requires ${name} port`);
  return ports[name];
};

export class DeviceCampaignRunner {
  declare spec: CampaignSpec;
  declare machine: CampaignStateMachine;
  declare ports: CampaignPorts;
  constructor({ spec, machine, ports }: {spec?: unknown, machine?: CampaignStateMachine, ports?: Partial<CampaignPorts>} = {}) {
    this.spec = validateCampaignSpec(spec);
    this.machine = machine ?? new CampaignStateMachine({ spec: this.spec });
    const given = ports ?? {};
    for (const name of ['preflight', 'menu', 'intro', 'executeAttempt', 'terminal', 'terminalVerification', 'save', 'retryReady'] as const)
      required(given, name);
    if (this.spec.nights.some(target => target.mode === 'custom')) required(given, 'customNight');
    // Every port a run needs was checked above.
    this.ports = given as CampaignPorts;
  }

  async run() {
    const { machine, ports } = this;
    // Each accept call moves the state; read it fresh rather than let a narrowed read outlive the call.
    const state = () => machine.state;
    let failed = false;
    try {
      machine.startPreflight();
      const preflight = await ports.preflight({ spec: this.spec });
      machine.acceptPreflight(preflight);
      if (state() === 'HOLD') return machine.result();

      while (state() !== 'COMPLETE') {
        const target = machine.target;
        if (!target) throw new Error('campaign runner: no night is current');
        const menu = await ports.menu({ target, spec: this.spec, attempt: machine.attempt + 1 });
        machine.acceptMenu(menu);
        if (state() === 'HOLD') return machine.result();

        let customReadback = null;
        if (target.mode === 'custom' && ports.customNight) {
          const configured = await ports.customNight({ target, spec: this.spec });
          machine.acceptCustomConfiguration(configured);
          customReadback = configured.readback;
          if (state() === 'HOLD') return machine.result();
        }

        const intro = await ports.intro({ target, spec: this.spec });
        machine.acceptIntro(intro);
        if (state() === 'HOLD') return machine.result();

        machine.beginAttempt();
        const execution = await ports.executeAttempt({ target, attempt: machine.attempt, spec: this.spec });
        const terminal = await ports.terminal({ target, execution, spec: this.spec });
        machine.acceptTerminal(terminal);

        if (state() === 'RETRY_VERIFY') {
          // A terminal observer is authoritative for the campaign state even
          // when the device-local executor's own poll missed the short
          // game-over/static transition. Stop the HID before waiting for the
          // title, otherwise a buffered schedule can keep pressing the menu.
          await ports.stopAttempt?.({ target, execution, terminal, reason: 'terminal-retry' });
          const retryReady = await ports.retryReady({ target, execution, spec: this.spec });
          machine.acceptRetry(retryReady);
          if (state() === 'HOLD' || state() === 'ABORTED') return machine.result();
          continue;
        }
        if (state() !== 'TERMINAL_VERIFY') {
          await ports.stopAttempt?.({ target, execution, terminal, reason: state() });
          return machine.result();
        }

        // Six AM also ends the authored schedule before the save/menu proof
        // starts. A successful terminal must not leak touches into the title.
        await ports.stopAttempt?.({ target, execution, terminal, reason: 'terminal-proof' });
        const terminalVerification = await ports.terminalVerification({ target, execution, terminal, spec: this.spec });
        machine.acceptTerminalVerification(terminalVerification);
        if (state() !== 'SAVE_VERIFY') return machine.result();
        const save = await ports.save({ target, execution, terminal, spec: this.spec });
        const proof = makeAttemptProof({ target, attempt: machine.attempt, terminal: { ...terminal, positive: true },
          terminalVerification, save, customReadback });
        machine.acceptSave({ ...save, proofHash: proof.proofHash });
        if (state() === 'HOLD' || state() === 'ABORTED') return machine.result();
      }
      return machine.result();
    } catch (error) {
      failed = true;
      machine.abort(`campaign-port-failure: ${(error as Error).message}`);
      try { await ports.cleanup?.(error); } catch { /* cleanup must not hide the original failure */ }
      throw error;
    } finally {
      try { await ports.releaseAll?.(); }
      catch (error) { if (!failed) throw error; }
    }
  }
}
