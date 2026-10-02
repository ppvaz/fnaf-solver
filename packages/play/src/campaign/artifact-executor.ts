/**
 * Plan 22 artifact-to-device execution boundary.
 *
 * The host compiler emits semantic, state-conditioned blocks.  This module is
 * the only shape accepted by a device-local executor.  It deliberately does
 * not contain a policy interpreter, strategy selector, coordinate encoder, or
 * legacy transport fallback.
 * CONTRACT:device-executor-v1.
 */
import { deviceProfileGame, resolveDeviceProfile } from '@sixam/source';
import { stableHash } from '@sixam/kernel/contracts';
import { artifactActionTableFor } from '@sixam/source';
import { isList, isOneOf, isRecord } from '@sixam/kernel';
import type { ArtifactActionTable, ResolvedDeviceProfile } from '@sixam/kernel/contracts';
import type { NightTiming } from './campaign.ts';

/** One semantic action of a compiled block (artifact-action-v1): what the table admits, and its timing. */
export interface ArtifactAction {
  readonly schema: 'artifact-action-v1';
  readonly id: string;
  readonly cycle: string;
  readonly atMs: number;
  readonly kind: string;
  readonly control: string;
  readonly compound?: string;
  readonly requiresMonitorUp?: boolean;
  readonly targetMonitorUp?: boolean;
  readonly targetMaskOn?: boolean;
  readonly durationMs?: number;
  readonly gapMs?: number;
  readonly leadMs?: number;
  readonly tailMs?: number;
  readonly maskGapMs?: number;
  readonly selectMs?: number;
  readonly settleMs?: number;
  readonly lightMs?: number;
  readonly [field: string]: unknown;
}
/** A sweep slot, whose select, settle and light phases validateAction checked finite. */
export type SweepSlotAction = ArtifactAction & { readonly kind: 'sweep-slot', readonly selectMs: number,
  readonly settleMs: number, readonly lightMs: number };
export const isSweepSlot = (action: ArtifactAction): action is SweepSlotAction => action.kind === 'sweep-slot';
/** artifact-action-block-v1: actions at one point of a cycle, bound to a night once a plan is chosen. */
export interface ArtifactBlock {
  readonly schema: 'artifact-action-block-v1';
  readonly id: string;
  readonly cycle: string;
  readonly atMs: number;
  readonly night?: number;
  readonly actions: readonly ArtifactAction[];
  readonly [field: string]: unknown;
}
/** The camera split a plan verifies before its first wind. */
export interface ArmVerification {
  readonly cameras: readonly string[];
  readonly viewing: string;
  readonly untilMs: number;
  readonly mode?: 'blocking' | 'observe-once';
}
/** A night's plan as a request names it: its hash, its timing, its arm. */
export interface PlanReference {
  readonly night: number;
  readonly sha256: string;
  readonly timing: NightTiming;
  readonly armVerification?: ArmVerification;
}
/** device-executor-v1: everything a device-local executor may run, and nothing it may not. */
export interface ExecutorRequest {
  readonly schema: 'device-executor-v1';
  readonly version: 1;
  readonly mode: 'live' | 'dry-run';
  readonly artifact: {
    readonly winnerHash: string,
    readonly engineHash: string,
    readonly profileHash: string,
    readonly profileStableHash: string,
    readonly plans: readonly PlanReference[],
  };
  readonly profile: ResolvedDeviceProfile;
  readonly limits: { readonly maxActions: number, readonly maxDurationMs: number };
  readonly blocks: readonly ArtifactBlock[];
}

export const DEVICE_EXECUTOR_SCHEMA = 'device-executor-v1';
export const ARTIFACT_ACTION_SCHEMA = 'artifact-action-v1';
export const ARTIFACT_BLOCK_SCHEMA = 'artifact-action-block-v1';

// Which controls an action kind or a compound may name is the game's rule, not
// the transport's. Until D5 FNaF 2's were literals here (`camdrop` holds the
// feed light, `observe-left` reads the left vent, the sweep cameras, the arm's
// CAM 01-12 and its first wind); they now live in the FNaF 2 cartridge's
// artifact action table (@sixam/core/control, catalog/fnaf2.js), and this
// module reads the table for the game its resolved profile targets.
const forbidden = new Set([
  'strategy', 'policy', 'command', 'commands', 'trajectory', 'shell', 'adb',
  'transport', 'report', 'bytes', 'point', 'x', 'y', 'legacy',
]);

function fail(message: string): never { throw new TypeError(`device executor: ${message}`); }
const finite = (value: unknown, label: string, { integer = false, positive = false } = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
      (integer && !Number.isInteger(value)) || (positive && value <= 0))
    fail(`${label} must be a ${positive ? 'positive ' : ''}${integer ? 'integer' : 'finite number'}`);
  return value;
};
const text = (value: unknown, label: string) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
};

/** The artifact action table for the game a resolved profile targets. */
function actionTableOf(profile: unknown, label: string): ArtifactActionTable {
  try { return artifactActionTableFor(deviceProfileGame(profile).game); }
  catch (error) { fail(`${label}: ${(error as Error).message}`); }
}

/** The profile resolved against its game's catalog; the game is refused first, by actionTableOf. */
function resolvedProfileOf(profile: unknown, label: string): ResolvedDeviceProfile {
  try { return resolveDeviceProfile(profile); }
  catch (error) { fail(`${label}: ${(error as Error).message}`); }
}

/** `cam:N` inside the table's arm range. */
function armCamera(camera: unknown, [lo, hi]: readonly [number, number]): camera is string {
  const match = typeof camera === 'string' ? /^cam:(0|[1-9][0-9]*)$/.exec(camera) : null;
  return match !== null && Number(match[1]) >= lo && Number(match[1]) <= hi;
}

function validatePlanTiming(timing: unknown, path: string): NightTiming {
  if (!isRecord(timing)) fail(`${path} timing is missing`);
  const [periodMs, loopStartMs, stopAtMs, observeUntilMs, idleUntilMs] =
    ['periodMs', 'loopStartMs', 'stopAtMs', 'observeUntilMs', 'idleUntilMs'].map(key => finite(timing[key], `${path}.${key}`, { integer: true }));
  const phaseOffsetMs = timing.phaseOffsetMs === undefined ? undefined
    : finite(timing.phaseOffsetMs, `${path}.phaseOffsetMs`, { integer: true });
  if (phaseOffsetMs !== undefined && phaseOffsetMs > 2000)
    fail(`${path}.phaseOffsetMs must be in 0..2000 ms`);
  if (periodMs <= 0) fail(`${path}.periodMs must be positive`);
  if (stopAtMs <= loopStartMs) fail(`${path} stopAtMs must be after loopStartMs`);
  if (observeUntilMs < stopAtMs) fail(`${path} observeUntilMs must cover stopAtMs`);
  if (idleUntilMs > loopStartMs) fail(`${path} idleUntilMs cannot exceed loopStartMs`);
  return timing as unknown as NightTiming;
}

function validateArmVerification(value: unknown, path: string, table: ArtifactActionTable): ArmVerification | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(`${path} must be an object`);
  if (!table.armVerification) fail(`${path}: ${table.game} has no arm verification`);
  const range = table.armVerification.cameras;
  if (!isList(value.cameras) || value.cameras.length !== 2)
    fail(`${path}.cameras must contain exactly two cameras`);
  const cameras = value.cameras.map((camera, index) => {
    if (!armCamera(camera, range))
      fail(`${path}.cameras[${index}] is not a semantic camera`);
    return camera;
  });
  if (new Set(cameras).size !== cameras.length) fail(`${path}.cameras must be unique`);
  const viewing = value.viewing;
  if (!armCamera(viewing, range))
    fail(`${path}.viewing is not a semantic camera`);
  if (!cameras.includes(viewing)) fail(`${path}.viewing must be one of the highlighted cameras`);
  const untilMs = finite(value.untilMs, `${path}.untilMs`, { integer: true, positive: true });
  const mode = value.mode ?? 'blocking';
  if (!isOneOf(['blocking', 'observe-once'] as const, mode))
    fail(`${path}.mode must be blocking or observe-once`);
  return Object.freeze({ cameras: Object.freeze([...cameras].sort((a, b) =>
    Number(a.slice(4)) - Number(b.slice(4)))), viewing, untilMs,
    ...(value.mode === undefined ? {} : { mode }) });
}

function rejectForbidden(value: unknown, path: string) {
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) fail(`${path}.${key} is not allowed across the device boundary`);
    if (isRecord(child)) rejectForbidden(child, `${path}.${key}`);
    else if (isList(child)) for (const [index, item] of child.entries()) {
      if (isRecord(item)) rejectForbidden(item, `${path}.${key}[${index}]`);
    }
  }
}

function validateAction(action: unknown, path: string, table: ArtifactActionTable): ArtifactAction {
  if (!isRecord(action) || action.schema !== ARTIFACT_ACTION_SCHEMA) fail(`${path} schema mismatch`);
  text(action.id, `${path}.id`);
  text(action.cycle, `${path}.cycle`);
  finite(action.atMs, `${path}.atMs`);
  const kinds: Readonly<Record<string, { readonly controls: readonly string[] } | undefined>> = table.kinds;
  const kind = typeof action.kind === 'string' && Object.hasOwn(kinds, action.kind)
    ? kinds[action.kind] : null;
  if (!kind) fail(`${path}.kind is unsupported`);
  if (action.kind === 'sweep-slot') {
    if (!isOneOf(kind.controls, action.control)) fail(`${path}.control is not a semantic camera control`);
    finite(action.selectMs, `${path}.selectMs`, { positive: true });
    finite(action.settleMs, `${path}.settleMs`);
    finite(action.lightMs, `${path}.lightMs`);
  } else if (action.kind === 'compound') {
    const pins = typeof action.compound === 'string' && Object.hasOwn(table.compounds, action.compound)
      ? table.compounds[action.compound] : null;
    if (!pins) fail(`${path}.compound is unsupported`);
    if (!isOneOf(kind.controls, action.control)) fail(`${path}.control is unsupported`);
    if (typeof action.requiresMonitorUp !== 'boolean') fail(`${path}.requiresMonitorUp is required`);
    // The fields this compound pins to one control, in the table's order.
    for (const [field, control] of Object.entries(pins))
      if (action[field] !== control) fail(`${path}.${action.compound} ${field} must be ${control}`);
    if (action.targetMonitorUp !== undefined && typeof action.targetMonitorUp !== 'boolean') fail(`${path}.targetMonitorUp must be boolean`);
    if (action.targetMaskOn !== undefined && typeof action.targetMaskOn !== 'boolean') fail(`${path}.targetMaskOn must be boolean`);
    for (const key of ['durationMs', 'gapMs', 'leadMs', 'tailMs'])
      if (action[key] !== undefined) finite(action[key], `${path}.${key}`);
  } else {
    if (!isOneOf(table.controls, action.control)) fail(`${path}.control is unsupported`);
    if (action.kind === 'ensure') {
      if (!isOneOf(kind.controls, action.control) || typeof action.targetMonitorUp !== 'boolean')
        fail(`${path} must be an explicit monitor target`);
    } else if (!isOneOf(kind.controls, action.control)) {
      fail(`${path}.${action.kind} control must be ${kind.controls.join(' or ')}`);
    }
    if (action.requiresMonitorUp !== undefined && typeof action.requiresMonitorUp !== 'boolean')
      fail(`${path}.requiresMonitorUp must be boolean`);
    if (action.targetMaskOn !== undefined && typeof action.targetMaskOn !== 'boolean')
      fail(`${path}.targetMaskOn must be boolean`);
    for (const key of ['durationMs', 'maskGapMs'])
      if (action[key] !== undefined) finite(action[key], `${path}.${key}`);
  }
  rejectForbidden(action, path);
  return action as unknown as ArtifactAction;
}

/**
 * Validate compiled semantic blocks before they can reach a device port.
 * `table` is the artifact action table of the game the blocks were compiled
 * for (`artifactActionTableFor`); there is no default game.
 */
export function validateArtifactBlocks(blocks: unknown, { maxActions = 64, maxDurationMs = 15000, table = undefined }:
  {maxActions?: number, maxDurationMs?: number, table?: ArtifactActionTable} = {}): readonly ArtifactBlock[] {
  if (!isRecord(table) || !isRecord(table.kinds)) fail('blocks need the artifact action table of their game');
  if (!isList(blocks) || blocks.length === 0) fail('blocks must be a non-empty array');
  finite(maxActions, 'maxActions', { integer: true, positive: true });
  finite(maxDurationMs, 'maxDurationMs', { positive: true });
  let actionCount = 0;
  const lastAtByCycle = new Map<string, number>();
  for (const [index, block] of blocks.entries()) {
    const path = `blocks[${index}]`;
    if (!isRecord(block) || block.schema !== ARTIFACT_BLOCK_SCHEMA) fail(`${path} schema mismatch`);
    text(block.id, `${path}.id`); text(block.cycle, `${path}.cycle`);
    const blockAt = finite(block.atMs, `${path}.atMs`);
    if (block.night !== undefined) finite(block.night, `${path}.night`, { integer: true, positive: true });
    const cycleKey = `${block.night ?? 0}:${block.cycle}`;
    const lastAt = lastAtByCycle.get(cycleKey) ?? 0;
    if (blockAt < lastAt) fail(`${path}.atMs moves backwards within ${cycleKey}`);
    lastAtByCycle.set(cycleKey, blockAt);
    if (!isList(block.actions) || block.actions.length === 0) fail(`${path}.actions must be non-empty`);
    actionCount += block.actions.length;
    if (actionCount > maxActions) fail(`action count exceeds maxActions ${maxActions}`);
    for (const [actionIndex, item] of block.actions.entries()) {
      const action = validateAction(item, `${path}.actions[${actionIndex}]`, table as unknown as ArtifactActionTable);
      if (action.atMs < blockAt) fail(`${path}.actions[${actionIndex}].atMs precedes its block`);
      // A sweep slot's three phases were each checked finite above.
      const duration = action.kind === 'sweep-slot'
        ? (action.selectMs ?? 0) + (action.settleMs ?? 0) + (action.lightMs ?? 0)
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
  return blocks as unknown as readonly ArtifactBlock[];
}

function planReferences(manifest: unknown, compiledPlans: unknown, table: ArtifactActionTable): PlanReference[] {
  if (!isRecord(manifest) || typeof manifest.winnerHash !== 'string' || typeof manifest.engineHash !== 'string' ||
      !isRecord(manifest.profile) || typeof manifest.profile.sha256 !== 'string')
    fail('validated manifest identity is incomplete');
  if (!isList(compiledPlans) || compiledPlans.length === 0) fail('compiled plans are required');
  const listed = isList(manifest.plans) ? manifest.plans : [];
  const manifestPlans = new Map(listed.map(plan => [isRecord(plan) ? plan.night : undefined, isRecord(plan) ? plan : {}]));
  return compiledPlans.map((plan, index) => {
    if (!isRecord(plan) || typeof plan.night !== 'number' || !Number.isInteger(plan.night) || !manifestPlans.has(plan.night))
      fail(`compiled plan ${index} is not bound to the manifest`);
    const source = manifestPlans.get(plan.night) ?? {};
    if (typeof source.sha256 !== 'string') fail(`manifest plan ${plan.night} hash is incomplete`);
    const timing = validatePlanTiming(plan.timing, `compiled plan ${plan.night}`);
    const armVerification = validateArmVerification(plan.armVerification,
      `compiled plan ${plan.night}.armVerification`, table);
    if (armVerification && armVerification.untilMs > timing.observeUntilMs)
      fail(`compiled plan ${plan.night}.armVerification.untilMs exceeds observeUntilMs`);
    return { night: plan.night, sha256: source.sha256, timing,
      ...(armVerification ? { armVerification } : {}) };
  });
}

/** Build the transport-neutral request consumed by a device-local executor. */
export function makeExecutorRequest({ manifest, profile: input, compiledPlans, mode = 'live', limits = {} }: {manifest?: unknown,
  profile?: unknown, compiledPlans?: readonly unknown[], mode?: string, limits?: { maxActions?: number, maxDurationMs?: number }} = {}) {
  if (!isRecord(input) || typeof input.id !== 'string') fail('resolved profile is required');
  if (mode !== 'live' && mode !== 'dry-run') fail(`unsupported execution mode ${JSON.stringify(mode)}`);
  const table = actionTableOf(input, 'resolved profile');
  const profile = resolvedProfileOf(input, 'resolved profile');
  const planRefs = planReferences(manifest, compiledPlans, table);
  const blocks: Record<string, unknown>[] = [];
  for (const plan of compiledPlans ?? []) {
    const fields = isRecord(plan) ? plan : {};
    for (const cycle of Object.values(isRecord(fields.cycles) ? fields.cycles : {})) {
      if (!isRecord(cycle) || !isList(cycle.blocks)) fail(`compiled plan ${fields.night} has invalid cycles`);
      for (const block of cycle.blocks) blocks.push({ ...(isRecord(block) ? block : {}), night: fields.night });
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
  const checked = validateArtifactBlocks(blocks, { ...resolvedLimits, table });
  const manifestFields = manifest as { winnerHash: string, engineHash: string, profile: { sha256: string } };
  return {
    schema: DEVICE_EXECUTOR_SCHEMA, version: 1, mode,
    artifact: {
      winnerHash: text(manifestFields.winnerHash, 'artifact.winnerHash'),
      engineHash: text(manifestFields.engineHash, 'artifact.engineHash'),
      profileHash: text(manifestFields.profile.sha256, 'artifact.profileHash'),
      profileStableHash: stableHash(profile),
      plans: planRefs,
    },
    profile: structuredClone(profile),
    limits: resolvedLimits,
    blocks: checked,
  };
}

/** Validate an executor request supplied by any caller, including remote IPC. */
export function validateExecutorRequest(request: unknown): ExecutorRequest {
  if (!isRecord(request) || request.schema !== DEVICE_EXECUTOR_SCHEMA || request.version !== 1)
    fail('request schema/version mismatch');
  if (request.mode !== 'live' && request.mode !== 'dry-run') fail('request mode is invalid');
  const artifact = request.artifact;
  if (!isRecord(artifact)) fail('request artifact identity is missing');
  const [, , profileHash, profileStableHash] = ['winnerHash', 'engineHash', 'profileHash', 'profileStableHash']
    .map(key => text(artifact[key], `artifact.${key}`));
  if (!/^[a-f0-9]{64}$/.test(profileHash)) fail('artifact.profileHash must be a SHA-256 digest');
  if (!isRecord(request.profile) || typeof request.profile.id !== 'string') fail('request profile is missing');
  const table = actionTableOf(request.profile, 'request profile');
  const profile = resolvedProfileOf(request.profile, 'request profile');
  if (stableHash(profile) !== profileStableHash)
    fail('artifact.profileStableHash does not match the resolved profile');
  if (!isList(artifact.plans) || artifact.plans.length === 0)
    fail('artifact plan references are missing');
  const plans = artifact.plans.map((plan, index): PlanReference => {
    if (!isRecord(plan) || typeof plan.night !== 'number' || !Number.isInteger(plan.night) || plan.night < 1 || plan.night > 7 ||
        typeof plan.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(plan.sha256)) fail(`artifact.plans[${index}] is invalid`);
    const timing = validatePlanTiming(plan.timing, `artifact.plans[${index}]`);
    const armVerification = validateArmVerification(plan.armVerification,
      `artifact.plans[${index}].armVerification`, table);
    if (armVerification && armVerification.untilMs > timing.observeUntilMs)
      fail(`artifact.plans[${index}].armVerification.untilMs exceeds observeUntilMs`);
    return { night: plan.night, sha256: plan.sha256, timing, armVerification };
  });
  const planNights = new Set(plans.map(plan => plan.night));
  if (planNights.size !== plans.length) fail('artifact plan references contain duplicate nights');
  if (!isRecord(request.limits)) fail('request limits are missing');
  const limits = {
    maxActions: finite(request.limits.maxActions, 'request.limits.maxActions', { integer: true, positive: true }),
    maxDurationMs: finite(request.limits.maxDurationMs, 'request.limits.maxDurationMs', { positive: true }),
  };
  if (profile.limits?.maxActions !== undefined && limits.maxActions > profile.limits.maxActions)
    fail('request maxActions exceeds the profile safety limit');
  if (profile.limits?.maxDurationMs !== undefined && limits.maxDurationMs > profile.limits.maxDurationMs)
    fail('request maxDurationMs exceeds the profile safety limit');
  const blocks = validateArtifactBlocks(request.blocks, { ...limits, table });
  // An arm on a table without one was refused by validateArmVerification.
  const firstAction = table.armVerification?.firstAction;
  for (const plan of plans) {
    if (!plan.armVerification) continue;
    const loopStart = Math.max(plan.timing.loopStartMs, plan.timing.idleUntilMs);
    const firstWind = blocks
      .filter(block => block.night === plan.night)
      .flatMap(block => block.actions.map(action => ({ action,
        atMs: block.cycle === 'opening' || block.cycle === 'finish'
          ? action.atMs : loopStart + action.atMs })))
      .filter(item => item.action.control === firstAction)
      .map(item => item.atMs)
      .sort((a, b) => a - b)[0];
    if (firstWind === undefined)
      fail(`artifact.plans[${plan.night}].armVerification requires a ${firstAction} action`);
    if (firstWind <= plan.armVerification.untilMs)
      fail(`artifact.plans[${plan.night}] starts ${firstAction} before the arm-verification window closes`);
  }
  for (const [index, block] of blocks.entries())
    if (block.night === undefined || !planNights.has(block.night)) fail(`blocks[${index}].night is not bound to an artifact plan`);
  for (const key of ['strategy', 'policy', 'commands', 'trajectory', 'transport', 'legacy'])
    if (Object.hasOwn(request, key)) fail(`request.${key} is not allowed across the device boundary`);
  return request as unknown as ExecutorRequest;
}

interface ExecutorPort {
  execute(request: ExecutorRequest): unknown;
  abort(reason?: unknown): unknown;
  releaseAll(): unknown;
}

/**
 * Explicit port wrapper.  A composition module must inject execute/abort/
 * releaseAll; this class never selects a transport and never interprets policy.
 */
export class DeviceArtifactExecutor {
  declare port: ExecutorPort;
  constructor(options: Partial<ExecutorPort> = {}) {
    const { execute, abort, releaseAll } = options;
    if (typeof execute !== 'function') throw new TypeError('device executor requires an execute port');
    if (typeof abort !== 'function' || typeof releaseAll !== 'function')
      throw new TypeError('device executor requires abort and releaseAll ports');
    this.port = { execute, abort, releaseAll };
  }

  async execute(request: unknown) {
    return this.port.execute(validateExecutorRequest(request));
  }

  abort(reason?: unknown) { return this.port.abort(reason); }
  releaseAll() { return this.port.releaseAll(); }
}
