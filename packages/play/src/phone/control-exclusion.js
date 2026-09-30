/**
 * Apply the game's settled control-state exclusion invariant.
 *
 * A raised monitor and a raised mask cannot coexist. A positive observation
 * of one therefore proves the other is down, but a negative observation does
 * not prove the opposite control is up: monitor-down/mask-down is ordinary
 * play. If both controls are reported up, the observations are incoherent
 * (often a pair straddling an animation), so both answers become UNKNOWN.
 * CONTRACT:control-exclusion-v1.
 */

const valid = value => value === null || value === true || value === false;

/**
 * @param {{monitorUp?: boolean|null, maskOn?: boolean|null}} facts
 * @returns {{monitorUp: boolean|null, maskOn: boolean|null,
 *   monitorInference: string|null, maskInference: string|null,
 *   contradiction: boolean, reason: string|null}}
 */
export function reconcileExclusiveControls({ monitorUp = null, maskOn = null } = {}) {
  if (!valid(monitorUp) || !valid(maskOn))
    throw new TypeError('control-exclusion-v1 facts must be boolean or null');

  if (monitorUp === true && maskOn === true) {
    return {
      monitorUp: null,
      maskOn: null,
      monitorInference: null,
      maskInference: null,
      contradiction: true,
      reason: 'mask-monitor-contradiction',
    };
  }

  if (monitorUp === true && maskOn === null) {
    return {
      monitorUp: true,
      maskOn: false,
      monitorInference: null,
      maskInference: 'monitor-up-complement',
      contradiction: false,
      reason: null,
    };
  }

  if (monitorUp === null && maskOn === true) {
    return {
      monitorUp: false,
      maskOn: true,
      monitorInference: 'mask-up-complement',
      maskInference: null,
      contradiction: false,
      reason: null,
    };
  }

  return {
    monitorUp,
    maskOn,
    monitorInference: null,
    maskInference: null,
    contradiction: false,
    reason: null,
  };
}
