/**
 * Custom Night configuration and calibration contract.
 *
 * The game does not expose a stable accessibility tree for the dial screen,
 * so coordinates and readback regions must come from one measured guided
 * session.  This module intentionally contains no guessed coordinates.
 * CONTRACT:custom-night-config-v1.
 */
import { AI_DIALS, AI_10_20, PUPPET_AI } from '@sixam/source/fnaf2';
import { isList, isRecord } from '@sixam/kernel';

/** An AI level per Custom Night dial (`AI_DIALS`). */
export type Dials = Readonly<Record<string, number>>;
/** custom-night-config-v1: the ten dials and the Puppet. */
export interface CustomNightConfig {
  readonly schema: 'custom-night-config-v1';
  readonly version: 1;
  readonly dials: Dials;
  readonly puppet: number;
}
interface Point {
  readonly x: number;
  readonly y: number;
}
interface Box extends Point {
  readonly width: number;
  readonly height: number;
}
/** custom-night-calibration-v1: the guided session's measured points and readback boxes. */
export interface CustomNightCalibration {
  readonly schema: 'custom-night-calibration-v1';
  readonly version: 1;
  readonly build: string;
  readonly menu: { readonly target: 'customNight', readonly point: Point, readonly holdMs: number };
  readonly start: { readonly point: Point, readonly holdMs: number };
  readonly dials: Readonly<Record<string, { readonly increment: Point, readonly decrement: Point, readonly holdMs?: number }>>;
  readonly readback: Readonly<Record<string, { readonly box: Box, readonly maxValue: number }>>;
  readonly titleModel: string;
  readonly configModel: string;
  readonly dialWrap?: string;
}
type ScreenPoint = readonly [number, number];
type ScreenControl = { readonly point: ScreenPoint, readonly holdMs: number };
/** custom-night-model-v1: the measured screen, its presets and how they cycle. */
interface CustomNightModel {
  readonly schema: 'custom-night-model-v1';
  readonly version: 1;
  readonly build: string;
  readonly controls: Readonly<Record<'presetPrevious' | 'presetNext' | 'start' | 'back', ScreenControl>>;
  readonly presets: readonly { readonly id: string, readonly label: string, readonly dials: Dials }[];
  readonly defaultPreset: string;
  readonly [field: string]: unknown;
}
/** The physical tap port: one contact on a measured point. */
export type Tap = (request: { readonly point: Point, readonly holdMs: number, readonly [field: string]: unknown }) => Promise<unknown> | unknown;
/** The visual read port: what the dial screen shows now. */
type Readback = (request: Readonly<Record<string, unknown>>) => Promise<unknown> | unknown;

export const CUSTOM_NIGHT_SCHEMA = 'custom-night-config-v1';
export const CUSTOM_NIGHT_CALIBRATION_SCHEMA = 'custom-night-calibration-v1';
export const CUSTOM_NIGHT_MODEL_SCHEMA = 'custom-night-model-v1';
// The measured Custom Night controls accept one rendered frame of contact at
// 60 fps.  This is a UI contact default; the separately qualified gameplay
// timing constants remain owned by the night-driver calibration.
export const CUSTOM_NIGHT_CONTACT_MS = 17;

function fail(message: string): never { throw new TypeError(`custom night: ${message}`); }
const isInteger = (value: unknown): value is number => Number.isInteger(value);
const text = (value: unknown, label: string) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
};
const point = (value: unknown, label: string) => {
  if (!isRecord(value) || !isInteger(value.x) || !isInteger(value.y) ||
      value.x < 0 || value.y < 0) fail(`${label} must be a non-negative x/y point`);
  return value;
};
const box = (value: unknown, label: string) => {
  if (!isRecord(value) || !isInteger(value.x) || !isInteger(value.y) ||
      !isInteger(value.width) || !isInteger(value.height) ||
      value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1)
    fail(`${label} must be a non-empty x/y/width/height region`);
  return value;
};
/** An integer AI level in 0..20. */
const dialLevel = (value: unknown): value is number => isInteger(value) && value >= 0 && value <= AI_10_20;

export function validateCustomNightConfig(value: unknown): CustomNightConfig {
  if (!isRecord(value) || value.schema !== CUSTOM_NIGHT_SCHEMA || value.version !== 1)
    fail('configuration schema/version mismatch');
  const dials = value.dials;
  if (!isRecord(dials)) fail('dials are required');
  for (const dial of AI_DIALS) {
    if (!dialLevel(dials[dial]))
      fail(`dials.${dial} must be an integer in 0..${AI_10_20}`);
  }
  const extras = Object.keys(dials).filter(dial => !AI_DIALS.includes(dial));
  if (extras.length) fail(`unknown dials: ${extras.join(',')}`);
  if (value.puppet !== PUPPET_AI) fail(`puppet must be ${PUPPET_AI}`);
  return value as unknown as CustomNightConfig;
}

/** Make the reviewed 10/20 configuration without any UI assumptions. */
export function makeCustomNightConfig(dials: Dials = Object.fromEntries(AI_DIALS.map(dial => [dial, AI_10_20]))) {
  return validateCustomNightConfig({ schema: CUSTOM_NIGHT_SCHEMA, version: 1,
    dials: { ...dials }, puppet: PUPPET_AI });
}

function readbackFields(fields: unknown, label: string) {
  if (!isRecord(fields)) fail(`${label} must be an object`);
  for (const dial of AI_DIALS) {
    const item = fields[dial];
    if (!isRecord(item)) fail(`${label}.${dial} is required`);
    box(item.box, `${label}.${dial}.box`);
    if (!dialLevel(item.maxValue))
      fail(`${label}.${dial}.maxValue must be an integer in 0..${AI_10_20}`);
  }
  return fields;
}

/**
 * Validate calibration produced by the guided preflight.  Every dial has an
 * increment control and a readback box; a calibration without either is not a
 * usable Custom Night setup and must not reach a live port.
 */
export function validateCustomNightCalibration(value: unknown, { targetBuild }: {targetBuild?: string} = {}): CustomNightCalibration {
  if (!isRecord(value) || value.schema !== CUSTOM_NIGHT_CALIBRATION_SCHEMA || value.version !== 1)
    fail('calibration schema/version mismatch');
  text(value.build, 'calibration.build');
  if (targetBuild !== undefined && value.build !== targetBuild)
    fail(`calibration.build must match ${targetBuild}`);
  const menu = value.menu;
  if (!isRecord(menu) || menu.target !== 'customNight') fail('menu.customNight target is required');
  point(menu.point, 'menu.point');
  if (!isInteger(menu.holdMs) || menu.holdMs < 1 || menu.holdMs > 1000)
    fail('menu.holdMs must be an integer in 1..1000');
  const start = isRecord(value.start) ? value.start : {};
  point(start.point, 'start.point');
  if (!isInteger(start.holdMs) || start.holdMs < 1 || start.holdMs > 1000)
    fail('start.holdMs must be an integer in 1..1000');
  const dials = value.dials;
  if (!isRecord(dials)) fail('dial calibration is required');
  for (const dial of AI_DIALS) {
    const item = dials[dial];
    if (!isRecord(item)) fail(`dials.${dial} calibration is required`);
    point(item.increment, `dials.${dial}.increment`);
    point(item.decrement, `dials.${dial}.decrement`);
    if (item.holdMs !== undefined &&
        (!isInteger(item.holdMs) || item.holdMs < 1 || item.holdMs > 1000))
      fail(`dials.${dial}.holdMs must be an integer in 1..1000`);
  }
  readbackFields(value.readback, 'readback');
  text(value.titleModel, 'titleModel');
  text(value.configModel, 'configModel');
  return value as unknown as CustomNightCalibration;
}

const modelPoint = (value: unknown, label: string) => {
  if (!isList(value) || value.length !== 2 ||
      !isInteger(value[0]) || !isInteger(value[1]))
    fail(`${label} must be a two-element integer point`);
  if (value[0] < 0 || value[1] < 0 || value[0] >= 2400 || value[1] >= 1080)
    fail(`${label} must be inside the 2400x1080 screen`);
  return value;
};

const modelBox = (value: unknown, label: string) => {
  if (!isList(value) || value.length !== 4 ||
      !value.every(isInteger) || value[0] < 0 || value[1] < 0 ||
      value[2] < 1 || value[3] < 1 || value[0] + value[2] > 2400 || value[1] + value[3] > 1080)
    fail(`${label} must be a bounded [x,y,width,height] region`);
  return value;
};

/** Validate the measured Custom Night screen model used by preset/dial ports. */
export function validateCustomNightModel(value: unknown, { targetBuild }: {targetBuild?: string} = {}): CustomNightModel {
  if (!isRecord(value) || value.schema !== CUSTOM_NIGHT_MODEL_SCHEMA || value.version !== 1)
    fail('screen model schema/version mismatch');
  text(value.build, 'screen model build');
  if (targetBuild !== undefined && value.build !== targetBuild)
    fail(`screen model build must match ${targetBuild}`);
  const geometry = value.geometry;
  if (!isList(geometry) || geometry.length !== 2 ||
      geometry[0] !== 2400 || geometry[1] !== 1080)
    fail('screen model geometry must be 2400x1080');
  const controls = value.controls;
  if (!isRecord(controls)) fail('screen model controls are required');
  for (const control of ['presetPrevious', 'presetNext', 'start', 'back']) {
    const item = controls[control];
    if (!isRecord(item)) fail(`screen model controls.${control} is required`);
    modelPoint(item.point, `screen model controls.${control}.point`);
    if (!isInteger(item.holdMs) || item.holdMs < 1 || item.holdMs > 1000)
      fail(`screen model controls.${control}.holdMs must be an integer in 1..1000`);
  }
  const dials = value.dials;
  if (!isRecord(dials)) fail('screen model dials are required');
  for (const dial of AI_DIALS) {
    const item = dials[dial];
    if (!isRecord(item)) fail(`screen model dials.${dial} is required`);
    text(item.label, `screen model dials.${dial}.label`);
    modelPoint(item.increment, `screen model dials.${dial}.increment`);
    modelPoint(item.decrement, `screen model dials.${dial}.decrement`);
    const readback = item.readback;
    if (!isRecord(readback)) fail(`screen model dials.${dial}.readback is required`);
    modelBox(readback.box, `screen model dials.${dial}.readback.box`);
    if (readback.maxValue !== AI_10_20)
      fail(`screen model dials.${dial}.readback.maxValue must be ${AI_10_20}`);
  }
  const presets = value.presets;
  if (!isList(presets) || presets.length < 1)
    fail('screen model presets are required');
  const ids = new Set<unknown>();
  for (const [index, preset] of presets.entries()) {
    if (!isRecord(preset)) fail(`screen model presets.${index} must be an object`);
    text(preset.id, `screen model presets.${index}.id`);
    if (ids.has(preset.id)) fail(`duplicate preset id: ${preset.id}`);
    ids.add(preset.id);
    text(preset.label, `screen model presets.${index}.label`);
    const levels = preset.dials;
    if (!isRecord(levels)) fail(`screen model presets.${index}.dials is required`);
    for (const dial of AI_DIALS) {
      if (!dialLevel(levels[dial]))
        fail(`screen model presets.${index}.dials.${dial} must be an integer in 0..${AI_10_20}`);
    }
  }
  text(value.defaultPreset, 'screen model defaultPreset');
  if (!ids.has(value.defaultPreset)) fail('screen model defaultPreset is not in presets');
  if (!isRecord(value.presetCycle) || value.presetCycle.wrap !== true)
    fail('screen model presetCycle.wrap must be true');
  return value as unknown as CustomNightModel;
}

const sameDialValues = (left: unknown, right: unknown) => isRecord(left) && isRecord(right) &&
  AI_DIALS.every(dial => left[dial] === right[dial]);
const validDialValues = (value: unknown) => isRecord(value) && AI_DIALS.every(dial => dialLevel(value[dial]));

function presetWithDials(model: CustomNightModel, dials: unknown) {
  return model.presets.find(preset => sameDialValues(preset.dials, dials))?.id;
}

/**
 * Select a named preset through the measured loopable arrow pair. The caller
 * supplies a fresh readback after every contact; no preset index is assumed.
 */
export async function selectCustomNightPreset({ preset, model: input, tap, readback,
  direction = 'auto', maxSteps, targetBuild }: {preset?: string|{id:string}, model?: unknown, tap?: Tap, readback?: Readback, direction?: 'next'|'previous'|'auto', maxSteps?: number, targetBuild?: string} = {}) {
  const model = validateCustomNightModel(input, { targetBuild });
  if (typeof tap !== 'function' || typeof readback !== 'function')
    throw new TypeError('custom night preset selection requires tap and readback ports');
  if (!['next', 'previous', 'auto'].includes(direction))
    throw new TypeError('custom night preset direction must be next, previous, or auto');
  const presetId = typeof preset === 'string' ? preset : preset?.id;
  text(presetId, 'preset');
  const targetIndex = model.presets.findIndex(item => item.id === presetId);
  if (targetIndex < 0) throw new Error(`custom night preset is not measured: ${presetId}`);
  const target = model.presets[targetIndex];
  const initial = await readback({ phase: 'before-preset', expected: target.dials, preset: presetId });
  if (!isRecord(initial) || initial.status !== 'PASS' || !isRecord(initial.dials) ||
      !validDialValues(initial.dials))
    throw new Error('custom night preset initial readback is not confirmed');
  const shown = typeof initial.preset === 'string' ? initial.preset : undefined;
  if (sameDialValues(initial.dials, target.dials))
    return { status: 'PASS', preset: presetId, dials: { ...target.dials }, steps: 0, readback: initial };

  let stepDirection = direction;
  const currentId = initial.preset === undefined || initial.preset === null ? presetWithDials(model, initial.dials) : shown;
  if (stepDirection === 'auto' && currentId) {
    const currentIndex = model.presets.findIndex(item => item.id === currentId);
    if (currentIndex >= 0) {
      const forward = (targetIndex - currentIndex + model.presets.length) % model.presets.length;
      const backward = (currentIndex - targetIndex + model.presets.length) % model.presets.length;
      stepDirection = backward < forward ? 'previous' : 'next';
    } else stepDirection = 'next';
  } else if (stepDirection === 'auto') stepDirection = 'next';
  const control = model.controls[stepDirection === 'previous' ? 'presetPrevious' : 'presetNext'];
  const budget = maxSteps ?? model.presets.length;
  if (!Number.isInteger(budget) || budget < 1 || budget > 400)
    throw new TypeError('custom night preset maxSteps must be an integer in 1..400');
  for (let steps = 1; steps <= budget; steps += 1) {
    await tap({ preset: presetId, direction: stepDirection,
      point: { x: control.point[0], y: control.point[1] }, holdMs: control.holdMs });
    const observed = await readback({ phase: 'after-preset', expected: target.dials,
      preset: presetId, steps });
    if (isRecord(observed) && observed.status === 'PASS' && sameDialValues(observed.dials, target.dials))
      return { status: 'PASS', preset: presetId, dials: { ...target.dials }, steps, readback: observed };
  }
  throw new Error(`custom night preset ${presetId} was not reached within ${budget} steps`);
}

/** The exact operator checklist needed to create the one missing artifact. */
export function guidedCalibrationSteps({ targetBuild }: {targetBuild?: string} = {}) {
  return Object.freeze([
    `Verify the installed package is com.scottgames.fnaf2 at ${targetBuild ?? 'the target build'}.`,
    'Verify landscape/full display, perspective effect, controller size, and language settings match the device profile.',
    'Capture and label the title screen with Custom Night visible; record its measured target point and title-model threshold.',
    'Open Custom Night and record increment/decrement points for every ten named dials.',
    'Record one readback box and digit threshold for every dial; do not infer positions from neighbouring rows.',
    'Record the Start point and hold duration, then perform one readback-only 10/20 configuration check.',
    'Persist the calibration artifact and rerun campaign preflight; no game input is allowed before every check is PASS.',
  ]);
}

/**
 * Set all ten dials from an observed starting state using only calibrated
 * increment/decrement points, then require a fresh full readback. The caller
 * owns the physical tap and visual-read ports; this routine owns the bounded
 * state transition and cannot silently assume that a dial started at zero.
 */
export async function configureCustomNight({ target, calibration: input, targetBuild, tap, readback,
  maxSteps = AI_DIALS.length * AI_10_20, wrap = false }: {target?: { readonly dials?: Dials } | null, calibration?: unknown, targetBuild?: string, tap?: Tap, readback?: Readback, maxSteps?: number, wrap?: boolean} = {}) {
  const expected = makeCustomNightConfig(target?.dials);
  const calibration = validateCustomNightCalibration(input, { targetBuild });
  if (typeof tap !== 'function' || typeof readback !== 'function')
    throw new TypeError('custom night configuration requires tap and readback ports');
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 400)
    throw new TypeError('custom night maxSteps must be an integer in 1..400');
  const initial = await readback({ phase: 'before', expected });
  const shown = isRecord(initial) ? initial.dials : undefined;
  if (!isRecord(initial) || initial.status !== 'PASS' || !isRecord(shown))
    throw new Error('custom night initial readback is not confirmed');
  const cyclic = wrap === true || calibration.dialWrap === 'cyclic';
  let steps = 0;
  for (const dial of AI_DIALS) {
    const level = shown[dial];
    if (!dialLevel(level))
      throw new Error(`custom night initial readback is invalid for ${dial}`);
    const difference = expected.dials[dial] - level;
    const range = AI_10_20 + 1;
    const forwardSteps = (difference + range) % range;
    const backwardSteps = (-difference + range) % range;
    const useForward = cyclic ? forwardSteps <= backwardSteps : difference >= 0;
    const pointToTap = useForward ? calibration.dials[dial].increment : calibration.dials[dial].decrement;
    const stepsForDial = cyclic ? (useForward ? forwardSteps : backwardSteps) : Math.abs(difference);
    for (let step = 0; step < stepsForDial; step += 1) {
      steps += 1;
      if (steps > maxSteps) throw new Error('custom night configuration exceeded the step budget');
      await tap({ dial, point: pointToTap, holdMs: calibration.dials[dial].holdMs ?? CUSTOM_NIGHT_CONTACT_MS });
    }
  }
  const finalReadback = await readback({ phase: 'after', expected });
  const finalDials = isRecord(finalReadback) && isRecord(finalReadback.dials) ? finalReadback.dials : {};
  if (!isRecord(finalReadback) || finalReadback.status !== 'PASS' || finalReadback.puppet !== PUPPET_AI ||
      AI_DIALS.some(dial => finalDials[dial] !== expected.dials[dial]))
    throw new Error('custom night final readback does not match the requested 10/20 configuration');
  return { status: 'PASS', dials: { ...expected.dials }, puppet: PUPPET_AI,
    readback: { status: 'PASS', dials: { ...finalDials }, puppet: finalReadback.puppet }, steps };
}
