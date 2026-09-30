/**
 * Plan 22 artifact-to-device execution boundary.
 *
 * The host compiler emits semantic, state-conditioned blocks.  This module is
 * the only shape accepted by a device-local executor.  It deliberately does
 * not contain a policy interpreter, strategy selector, coordinate encoder, or
 * legacy transport fallback.
 * CONTRACT:device-executor-v1.
 */
import { stableHash } from '@sixam/core/contracts';
import { CONTROL_VOCABULARY as V, DEVICE_CONTROL_NAMES } from '@sixam/core/control';

export const DEVICE_EXECUTOR_SCHEMA = 'device-executor-v1';
export const ARTIFACT_ACTION_SCHEMA = 'artifact-action-v1';
export const ARTIFACT_BLOCK_SCHEMA = 'artifact-action-block-v1';

const controls = new Set([...DEVICE_CONTROL_NAMES,
  'cam:4', 'cam:5', 'cam:7', 'cam:8', 'cam:9', 'cam:10', 'cam:11']);
const compounds = new Set(['hallvent', 'hallraise', 'maskraise', 'camdrop']);
const actionKinds = new Set(['ensure', 'tap', 'press', 'hold', 'compound', 'sweep-slot', 'observe-left']);
const forbidden = new Set([
  'strategy', 'policy', 'command', 'commands', 'trajectory', 'shell', 'adb',
  'transport', 'report', 'bytes', 'point', 'x', 'y', 'legacy',
]);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`device executor: ${message}`); };
const finite = (value, label, { integer = false, positive = false } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      (integer && !Number.isInteger(value)) || (positive && value <= 0))
    fail(`${label} must be a ${positive ? 'positive ' : ''}${integer ? 'integer' : 'finite number'}`);
  return value;
};
const text = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
};

function validatePlanTiming(timing, path) {
  if (!isRecord(timing)) fail(`${path} timing is missing`);
  for (const key of ['periodMs', 'loopStartMs', 'stopAtMs', 'observeUntilMs', 'idleUntilMs'])
    finite(timing[key], `${path}.${key}`, { integer: true });
  if (timing.phaseOffsetMs !== undefined)
    finite(timing.phaseOffsetMs, `${path}.phaseOffsetMs`, { integer: true });
  if (timing.phaseOffsetMs !== undefined && timing.phaseOffsetMs > 2000)
    fail(`${path}.phaseOffsetMs must be in 0..2000 ms`);
  if (timing.periodMs <= 0) fail(`${path}.periodMs must be positive`);
  if (timing.stopAtMs <= timing.loopStartMs) fail(`${path} stopAtMs must be after loopStartMs`);
  if (timing.observeUntilMs < timing.stopAtMs) fail(`${path} observeUntilMs must cover stopAtMs`);
  if (timing.idleUntilMs > timing.loopStartMs) fail(`${path} idleUntilMs cannot exceed loopStartMs`);
  return timing;
}

function validateArmVerification(value, path) {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(`${path} must be an object`);
  if (!Array.isArray(value.cameras) || value.cameras.length !== 2)
    fail(`${path}.cameras must contain exactly two cameras`);
  const cameras = value.cameras.map((camera, index) => {
    if (typeof camera !== 'string' || !/^cam:(?:[1-9]|1[0-2])$/.test(camera))
      fail(`${path}.cameras[${index}] is not a semantic camera`);
    return camera;
  });
  if (new Set(cameras).size !== cameras.length) fail(`${path}.cameras must be unique`);
  if (typeof value.viewing !== 'string' || !/^cam:(?:[1-9]|1[0-2])$/.test(value.viewing))
    fail(`${path}.viewing is not a semantic camera`);
  if (!cameras.includes(value.viewing)) fail(`${path}.viewing must be one of the highlighted cameras`);
  finite(value.untilMs, `${path}.untilMs`, { integer: true, positive: true });
  const mode = value.mode ?? 'blocking';
  if (!['blocking', 'observe-once'].includes(mode))
    fail(`${path}.mode must be blocking or observe-once`);
  return Object.freeze({ cameras: Object.freeze([...cameras].sort((a, b) =>
    Number(a.slice(4)) - Number(b.slice(4)))), viewing: value.viewing, untilMs: value.untilMs,
    ...(value.mode === undefined ? {} : { mode }) });
}

function rejectForbidden(value, path) {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) fail(`${path}.${key} is not allowed across the device boundary`);
    if (isRecord(child)) rejectForbidden(child, `${path}.${key}`);
    else if (Array.isArray(child)) for (const [index, item] of child.entries()) {
      if (isRecord(item)) rejectForbidden(item, `${path}.${key}[${index}]`);
    }
  }
}

function validateAction(action, path) {
  if (!isRecord(action) || action.schema !== ARTIFACT_ACTION_SCHEMA) fail(`${path} schema mismatch`);
  text(action.id, `${path}.id`);
  text(action.cycle, `${path}.cycle`);
  finite(action.atMs, `${path}.atMs`);
  if (!actionKinds.has(action.kind)) fail(`${path}.kind is unsupported`);
  if (action.kind === 'sweep-slot') {
    if (!/^cam:(?:4|5|7|8|9|10|11)$/.test(action.control ?? '')) fail(`${path}.control is not a semantic camera control`);
    finite(action.selectMs, `${path}.selectMs`, { positive: true });
    finite(action.settleMs, `${path}.settleMs`);
    finite(action.lightMs, `${path}.lightMs`);
  } else if (action.kind === 'compound') {
    if (!compounds.has(action.compound)) fail(`${path}.compound is unsupported`);
    if (!controls.has(action.control)) fail(`${path}.control is unsupported`);
    if (typeof action.requiresMonitorUp !== 'boolean') fail(`${path}.requiresMonitorUp is required`);
    if (action.compound === 'hallvent') {
      if (action.control !== V.hallLight) fail(`${path}.hallvent control must be ${V.hallLight}`);
      if (action.ventControl !== V.rightVentLight) fail(`${path}.hallvent ventControl must be ${V.rightVentLight}`);
    }
    if (action.compound === 'camdrop' && action.control !== V.cameraFeedLight)
      fail(`${path}.camdrop control must be ${V.cameraFeedLight}`);
    if (action.compound === 'hallraise' && action.control !== V.hallLight)
      fail(`${path}.hallraise control must be ${V.hallLight}`);
    if (action.targetMonitorUp !== undefined && typeof action.targetMonitorUp !== 'boolean') fail(`${path}.targetMonitorUp must be boolean`);
    if (action.targetMaskOn !== undefined && typeof action.targetMaskOn !== 'boolean') fail(`${path}.targetMaskOn must be boolean`);
    for (const key of ['durationMs', 'gapMs', 'leadMs', 'tailMs'])
      if (action[key] !== undefined) finite(action[key], `${path}.${key}`);
  } else {
    if (!controls.has(action.control)) fail(`${path}.control is unsupported`);
    if (action.kind === 'ensure') {
      if (action.control !== V.monitor || typeof action.targetMonitorUp !== 'boolean')
        fail(`${path} must be an explicit monitor target`);
    } else if (action.kind === 'observe-left' && action.control !== V.leftVentLight) {
      fail(`${path}.observe-left control must be ${V.leftVentLight}`);
    }
    if (action.requiresMonitorUp !== undefined && typeof action.requiresMonitorUp !== 'boolean')
      fail(`${path}.requiresMonitorUp must be boolean`);
    if (action.targetMaskOn !== undefined && typeof action.targetMaskOn !== 'boolean')
      fail(`${path}.targetMaskOn must be boolean`);
    for (const key of ['durationMs', 'maskGapMs'])
      if (action[key] !== undefined) finite(action[key], `${path}.${key}`);
  }
  rejectForbidden(action, path);
  return action;
}

/** Validate compiled semantic blocks before they can reach a device port. */
/** @param {any[]} blocks @param {{maxActions?: number, maxDurationMs?: number}} options */
export function validateArtifactBlocks(blocks, { maxActions = 64, maxDurationMs = 15000 } = {}) {
  if (!Array.isArray(blocks) || blocks.length === 0) fail('blocks must be a non-empty array');
  finite(maxActions, 'maxActions', { integer: true, positive: true });
  finite(maxDurationMs, 'maxDurationMs', { positive: true });
  let actionCount = 0;
  const lastAtByCycle = new Map();
  for (const [index, block] of blocks.entries()) {
    const path = `blocks[${index}]`;
    if (!isRecord(block) || block.schema !== ARTIFACT_BLOCK_SCHEMA) fail(`${path} schema mismatch`);
    text(block.id, `${path}.id`); text(block.cycle, `${path}.cycle`);
    finite(block.atMs, `${path}.atMs`);
    if (block.night !== undefined) finite(block.night, `${path}.night`, { integer: true, positive: true });
    const cycleKey = `${block.night ?? 0}:${block.cycle}`;
    const lastAt = lastAtByCycle.get(cycleKey) ?? 0;
    if (block.atMs < lastAt) fail(`${path}.atMs moves backwards within ${cycleKey}`);
    lastAtByCycle.set(cycleKey, block.atMs);
    if (!Array.isArray(block.actions) || block.actions.length === 0) fail(`${path}.actions must be non-empty`);
    actionCount += block.actions.length;
    if (actionCount > maxActions) fail(`action count exceeds maxActions ${maxActions}`);
    for (const [actionIndex, action] of block.actions.entries()) {
      validateAction(action, `${path}.actions[${actionIndex}]`);
      if (action.atMs < block.atMs) fail(`${path}.actions[${actionIndex}].atMs precedes its block`);
      const duration = action.kind === 'sweep-slot'
        ? action.selectMs + action.settleMs + action.lightMs
        : action.kind === 'compound'
          ? (action.leadMs ?? 0) + (action.durationMs ?? 0) + (action.tailMs ?? 0) + (action.gapMs ?? 0)
          : action.durationMs ?? 0;
      // `atMs` is an absolute position on the full-night timeline. The
      // profile duration limit applies to the physical macro itself, not to
      // how far into the night that macro is scheduled.
      if (duration > maxDurationMs) fail(`${path}.actions[${actionIndex}] exceeds maxDurationMs ${maxDurationMs}`);
    }
  }
  rejectForbidden({ blocks }, 'request');
  return blocks;
}

function planReferences(manifest, compiledPlans) {
  if (!isRecord(manifest) || typeof manifest.winnerHash !== 'string' || typeof manifest.engineHash !== 'string' ||
      !isRecord(manifest.profile) || typeof manifest.profile.sha256 !== 'string')
    fail('validated manifest identity is incomplete');
  if (!Array.isArray(compiledPlans) || compiledPlans.length === 0) fail('compiled plans are required');
  const manifestPlans = new Map((manifest.plans ?? []).map(plan => [plan.night, plan]));
  return compiledPlans.map((plan, index) => {
    if (!isRecord(plan) || !Number.isInteger(plan.night) || !manifestPlans.has(plan.night))
      fail(`compiled plan ${index} is not bound to the manifest`);
    const source = manifestPlans.get(plan.night);
    if (typeof source.sha256 !== 'string') fail(`manifest plan ${plan.night} hash is incomplete`);
    const timing = validatePlanTiming(plan.timing, `compiled plan ${plan.night}`);
    const armVerification = validateArmVerification(plan.armVerification,
      `compiled plan ${plan.night}.armVerification`);
    if (armVerification && armVerification.untilMs > timing.observeUntilMs)
      fail(`compiled plan ${plan.night}.armVerification.untilMs exceeds observeUntilMs`);
    return { night: plan.night, sha256: source.sha256, timing,
      ...(armVerification ? { armVerification } : {}) };
  });
}

/** Build the transport-neutral request consumed by a device-local executor. */
/** @param {any} options */
export function makeExecutorRequest({ manifest, profile, compiledPlans, mode = 'live', limits = {} } = {}) {
  if (!isRecord(profile) || typeof profile.id !== 'string') fail('resolved profile is required');
  if (mode !== 'live' && mode !== 'dry-run') fail(`unsupported execution mode ${JSON.stringify(mode)}`);
  const planRefs = planReferences(manifest, compiledPlans);
  const blocks = [];
  for (const plan of compiledPlans) {
    for (const cycle of Object.values(plan.cycles ?? {})) {
      if (!isRecord(cycle) || !Array.isArray(cycle.blocks)) fail(`compiled plan ${plan.night} has invalid cycles`);
      for (const block of cycle.blocks) blocks.push({ ...block, night: plan.night });
    }
  }
  const resolvedLimits = {
    maxActions: limits.maxActions ?? profile.limits?.maxActions ?? 64,
    maxDurationMs: limits.maxDurationMs ?? profile.limits?.maxDurationMs ?? 15000,
  };
  if (profile.limits?.maxActions !== undefined && resolvedLimits.maxActions > profile.limits.maxActions)
    fail('maxActions exceeds the profile safety limit');
  if (profile.limits?.maxDurationMs !== undefined && resolvedLimits.maxDurationMs > profile.limits.maxDurationMs)
    fail('maxDurationMs exceeds the profile safety limit');
  validateArtifactBlocks(blocks, resolvedLimits);
  return {
    schema: DEVICE_EXECUTOR_SCHEMA, version: 1, mode,
    artifact: {
      winnerHash: text(manifest.winnerHash, 'artifact.winnerHash'),
      engineHash: text(manifest.engineHash, 'artifact.engineHash'),
      profileHash: text(manifest.profile.sha256, 'artifact.profileHash'),
      profileStableHash: stableHash(profile),
      plans: planRefs,
    },
    profile: structuredClone(profile),
    limits: resolvedLimits,
    blocks,
  };
}

/** Validate an executor request supplied by any caller, including remote IPC. */
export function validateExecutorRequest(request) {
  if (!isRecord(request) || request.schema !== DEVICE_EXECUTOR_SCHEMA || request.version !== 1)
    fail('request schema/version mismatch');
  if (request.mode !== 'live' && request.mode !== 'dry-run') fail('request mode is invalid');
  if (!isRecord(request.artifact)) fail('request artifact identity is missing');
  for (const key of ['winnerHash', 'engineHash', 'profileHash', 'profileStableHash'])
    text(request.artifact[key], `artifact.${key}`);
  if (!/^[a-f0-9]{64}$/.test(request.artifact.profileHash)) fail('artifact.profileHash must be a SHA-256 digest');
  if (!isRecord(request.profile) || typeof request.profile.id !== 'string') fail('request profile is missing');
  if (stableHash(request.profile) !== request.artifact.profileStableHash)
    fail('artifact.profileStableHash does not match the resolved profile');
  if (!Array.isArray(request.artifact.plans) || request.artifact.plans.length === 0)
    fail('artifact plan references are missing');
  for (const [index, plan] of request.artifact.plans.entries()) {
    if (!isRecord(plan) || !Number.isInteger(plan.night) || plan.night < 1 || plan.night > 7 ||
        !/^[a-f0-9]{64}$/.test(plan.sha256)) fail(`artifact.plans[${index}] is invalid`);
    const timing = validatePlanTiming(plan.timing, `artifact.plans[${index}]`);
    const armVerification = validateArmVerification(plan.armVerification,
      `artifact.plans[${index}].armVerification`);
    if (armVerification && armVerification.untilMs > timing.observeUntilMs)
      fail(`artifact.plans[${index}].armVerification.untilMs exceeds observeUntilMs`);
  }
  const planNights = new Set(request.artifact.plans.map(plan => plan.night));
  if (planNights.size !== request.artifact.plans.length) fail('artifact plan references contain duplicate nights');
  if (!isRecord(request.limits)) fail('request limits are missing');
  finite(request.limits.maxActions, 'request.limits.maxActions', { integer: true, positive: true });
  finite(request.limits.maxDurationMs, 'request.limits.maxDurationMs', { positive: true });
  if (request.profile.limits?.maxActions !== undefined && request.limits.maxActions > request.profile.limits.maxActions)
    fail('request maxActions exceeds the profile safety limit');
  if (request.profile.limits?.maxDurationMs !== undefined && request.limits.maxDurationMs > request.profile.limits.maxDurationMs)
    fail('request maxDurationMs exceeds the profile safety limit');
  validateArtifactBlocks(request.blocks, request.limits);
  for (const plan of request.artifact.plans) {
    if (!plan.armVerification) continue;
    const loopStart = Math.max(plan.timing.loopStartMs, plan.timing.idleUntilMs);
    const firstWind = request.blocks
      .filter(block => block.night === plan.night)
      .flatMap(block => block.actions.map(action => ({ action,
        atMs: block.cycle === 'opening' || block.cycle === 'finish'
          ? action.atMs : loopStart + action.atMs })))
      .filter(item => item.action.control === V.wind)
      .map(item => item.atMs)
      .sort((a, b) => a - b)[0];
    if (firstWind === undefined)
      fail(`artifact.plans[${plan.night}].armVerification requires a wind action`);
    if (firstWind <= plan.armVerification.untilMs)
      fail(`artifact.plans[${plan.night}] starts wind before the arm-verification window closes`);
  }
  for (const [index, block] of request.blocks.entries())
    if (!planNights.has(block.night)) fail(`blocks[${index}].night is not bound to an artifact plan`);
  for (const key of ['strategy', 'policy', 'commands', 'trajectory', 'transport', 'legacy'])
    if (Object.hasOwn(request, key)) fail(`request.${key} is not allowed across the device boundary`);
  return request;
}

/**
 * Explicit port wrapper.  A composition module must inject execute/abort/
 * releaseAll; this class never selects a transport and never interprets policy.
 */
export class DeviceArtifactExecutor {
  /** @param {{execute?: Function, abort?: Function, releaseAll?: Function}} options */
  constructor(options = {}) {
    const { execute, abort, releaseAll } = options;
    if (typeof execute !== 'function') throw new TypeError('device executor requires an execute port');
    if (typeof abort !== 'function' || typeof releaseAll !== 'function')
      throw new TypeError('device executor requires abort and releaseAll ports');
    this.port = { execute, abort, releaseAll };
  }

  async execute(request) {
    return this.port.execute(validateExecutorRequest(request));
  }

  abort(reason) { return this.port.abort(reason); }
  releaseAll() { return this.port.releaseAll(); }
}
