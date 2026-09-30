// Convert the current Night 1 Minimal Minus Toys plan into Plan 21's policy IR.
import { build, KNOBS0 } from '../../packages/propose/bin/plans/minus-toys-plan.mjs';
import { DOUBLE_GLITCH_CAMERA_PAIRS } from '../../packages/play/bin/probe/arm-verification.mjs';
import { FNAF2_CONTROL_VOCABULARY as V } from '@sixam/source';
import { POLICY_SCHEMA, validatePolicy } from '@sixam/propose/policy';

const rowAction = (row, defaultContactMs = 33) => {
  const [at, kind, action, duration] = row;
  // The policy IR predates the device vocabulary split and intentionally keeps
  // the simulator's context-dependent action names. Translate at this single
  // boundary; emitted device plans remain explicit physical controls.
  const policyAction = action === V.cameraFeedLight ? 'light'
    : action === V.hallLight ? 'hall'
      : action === V.leftVentLight ? 'ventl' : action;
  if (kind === 'camdrop')
    return { atMs: at, action: 'monitor', mode: 'camdrop', leadMs: row[2],
             durationMs: row[3], tailMs: row[4], contactMs: defaultContactMs };
  return { atMs: at, action: policyAction,
           mode: kind, ...(kind === 'hold' || kind === 'hall'
             ? { durationMs: duration } : {}), contactMs: duration || defaultContactMs };
};

export function minimalPolicy(knobs = {}) {
  const k = { ...KNOBS0, minimal: true, ...knobs };
  const built = build(k);
  const setup = built.opening.map(row => rowAction(row, k.contactMs));
  const repeat = built.loop.map(row => ({ ...rowAction(row, k.contactMs), offsetMs: row[0] }));
  // Repeat rows use offsetMs; remove the absolute source field to keep the IR
  // unambiguous for a future semantic interpreter.
  repeat.forEach(action => delete action.atMs);
  const finish = built.finish.map(row => rowAction(row, k.contactMs));
  const policy = {
    schema: POLICY_SCHEMA,
    metadata: {
      id: 'minus-toys-minimal-night1', family: 'minus-toys', nights: [1],
      setupTarget: 'minus-toys-split',
      armVerify: true,
      armVerifyCameras: [...DOUBLE_GLITCH_CAMERA_PAIRS.minusToys],
      sourceDependencies: ['@sixam/core/mechanics', 'packages/propose/bin/plans/minus-toys-plan.mjs'],
      calibrationProfile: 'moto-g56-v207-landscape',
    },
    phases: [
      { id: 'idle', kind: 'idle', startMs: 0, endMs: k.minArmAtMs, actions: [] },
      { id: 'setup', kind: 'setup', startMs: k.minArmAtMs, endMs: k.minLoopStartMs,
        actions: setup },
      { id: 'repeat', kind: 'repeat', startMs: k.minLoopStartMs, endMs: k.minStopAtMs,
        periodMs: k.minPeriodMs, actions: repeat },
      { id: 'finish', kind: 'finish', startMs: k.minStopAtMs, endMs: k.minStopAtMs,
        actions: finish },
      { id: 'observe', kind: 'observe', startMs: k.minStopAtMs, endMs: k.minObserveUntilMs,
        actions: [], observations: [{ fact: 'splitArmed', maxAgeMs: 1000,
          confidenceFloor: 1, control: false }] },
    ],
    proof: { seeds: ['minus-toys-minimal-normal'], deviceContactFloorMs: k.contactMs,
      traceEquivalence: true, terminalObservationUntilMs: k.minObserveUntilMs },
  };
  return validatePolicy(policy);
}
