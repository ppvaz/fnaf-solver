/**
 * Semantic PlantModel facade. The legacy Sim remains the exact deterministic
 * implementation; this facade gives runtime and research one stable port.
 * CONTRACT:plant-model-v1 CONTRACT:semantic-control-v1.
 */
import { Sim } from './plant-model.ts';
import { validateControlCommand } from '../../clockwork/control-contracts.ts';
import { FNAF2_PACKAGE } from './controls.ts';

const ACTIONS = new Set(['mask', 'monitor', 'light', 'wind', 'ventL', 'ventR']);
const semanticToLegacy = (control: string) => control.startsWith('cam:') ? `cam:${control.slice(4)}` : control;

export class PlantModel extends Sim {
  apply(input: unknown) {
    // The Sim is FNaF 2's plant, so its commands are checked against FNaF 2's
    // catalog alone: no other game's control or camera reaches it.
    const command = validateControlCommand(input, { game: FNAF2_PACKAGE });
    const control = command.action.control;
    const kind = command.action.kind;
    if (typeof control !== 'string' || !kind) throw new TypeError('plant apply requires a semantic command');
    const legacy = semanticToLegacy(control);
    if (!ACTIONS.has(legacy) && !legacy.startsWith('cam:')) throw new TypeError(`unsupported plant control: ${control}`);
    if (kind === 'press' || kind === 'select') this.press(legacy);
    else if (kind === 'release') this.release(legacy);
    else if (kind === 'hold') this.press(legacy);
    else throw new TypeError(`unsupported command kind: ${kind}`);
    return { commandId: command.id, accepted: this.alive, frame: this.frame };
  }

  advance(targetFrame: number) {
    if (!Number.isInteger(targetFrame) || targetFrame < this.frame) throw new RangeError('target frame must not move backwards');
    while (this.frame < targetFrame && this.alive) this.tick();
    return this.frame;
  }

  terminalState() {
    return Object.freeze({ alive: this.alive, won: this.won, death: this.death, frame: this.frame });
  }

  truthSensor() {
    return Object.freeze({
      schema: 'state-estimate-v1', privilege: 'SIMULATOR_ORACLE', frame: this.frame,
      alive: this.alive, won: this.won, monitor: this.monitor, maskOn: this.maskOn,
      camera: this.viewing, box: this.box, power: this.power,
    });
  }
}
