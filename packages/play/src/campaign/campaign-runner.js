/**
 * Bounded campaign orchestration above CampaignStateMachine.
 *
 * Every physical operation is an injected port. This runner decides when a
 * port may be called and when its result is accepted; it never selects an ADB
 * command, coordinate, policy, or transport. That keeps the same campaign
 * usable with fixtures and with an externally qualified device executor.
 * CONTRACT:device-campaign-v1.
 */
import { CampaignStateMachine, validateCampaignSpec } from './campaign.js';
import { makeAttemptProof } from './campaign-proof.js';

const required = (ports, name) => {
  if (typeof ports?.[name] !== 'function') throw new TypeError(`campaign runner requires ${name} port`);
  return ports[name];
};

export class DeviceCampaignRunner {
  /** @param {{spec?: any, machine?: any, ports?: any}} options */
  constructor({ spec, machine, ports } = {}) {
    this.spec = validateCampaignSpec(spec);
    this.machine = machine ?? new CampaignStateMachine({ spec: this.spec });
    this.ports = ports ?? {};
    for (const name of ['preflight', 'menu', 'intro', 'executeAttempt', 'terminal', 'terminalVerification', 'save', 'retryReady'])
      required(this.ports, name);
    if (this.spec.nights.some(target => target.mode === 'custom')) required(this.ports, 'customNight');
  }

  async run() {
    const { machine, ports } = this;
    let failed = false;
    try {
      machine.startPreflight();
      const preflight = await ports.preflight({ spec: this.spec });
      machine.acceptPreflight(preflight);
      if (machine.state === 'HOLD') return machine.result();

      while (machine.state !== 'COMPLETE') {
        const target = machine.target;
        const menu = await ports.menu({ target, spec: this.spec, attempt: machine.attempt + 1 });
        machine.acceptMenu(menu);
        if (machine.state === 'HOLD') return machine.result();

        let customReadback = null;
        if (target.mode === 'custom') {
          const configured = await ports.customNight({ target, spec: this.spec });
          machine.acceptCustomConfiguration(configured);
          customReadback = configured.readback;
          if (machine.state === 'HOLD') return machine.result();
        }

        const intro = await ports.intro({ target, spec: this.spec });
        machine.acceptIntro(intro);
        if (machine.state === 'HOLD') return machine.result();

        machine.beginAttempt();
        const execution = await ports.executeAttempt({ target, attempt: machine.attempt, spec: this.spec });
        const terminal = await ports.terminal({ target, execution, spec: this.spec });
        machine.acceptTerminal(terminal);

        if (machine.state === 'RETRY_VERIFY') {
          // A terminal observer is authoritative for the campaign state even
          // when the device-local executor's own poll missed the short
          // game-over/static transition. Stop the HID before waiting for the
          // title, otherwise a buffered schedule can keep pressing the menu.
          await ports.stopAttempt?.({ target, execution, terminal, reason: 'terminal-retry' });
          const retryReady = await ports.retryReady({ target, execution, spec: this.spec });
          machine.acceptRetry(retryReady);
          if (machine.state === 'HOLD' || machine.state === 'ABORTED') return machine.result();
          continue;
        }
        if (machine.state !== 'TERMINAL_VERIFY') {
          await ports.stopAttempt?.({ target, execution, terminal, reason: machine.state });
          return machine.result();
        }

        // Six AM also ends the authored schedule before the save/menu proof
        // starts. A successful terminal must not leak touches into the title.
        await ports.stopAttempt?.({ target, execution, terminal, reason: 'terminal-proof' });
        const terminalVerification = await ports.terminalVerification({ target, execution, terminal, spec: this.spec });
        machine.acceptTerminalVerification(terminalVerification);
        if (machine.state !== 'SAVE_VERIFY') return machine.result();
        const save = await ports.save({ target, execution, terminal, spec: this.spec });
        const proof = makeAttemptProof({ target, attempt: machine.attempt, terminal: { ...terminal, positive: true },
          terminalVerification, save, customReadback });
        machine.acceptSave({ ...save, proofHash: proof.proofHash });
        if (machine.state === 'HOLD' || machine.state === 'ABORTED') return machine.result();
      }
      return machine.result();
    } catch (error) {
      failed = true;
      machine.abort(`campaign-port-failure: ${error.message}`);
      try { await ports.cleanup?.(error); } catch { /* cleanup must not hide the original failure */ }
      throw error;
    } finally {
      try { await ports.releaseAll?.(); }
      catch (error) { if (!failed) throw error; }
    }
  }
}
