/**
 * Custom Night configuration and calibration contract.
 *
 * The game does not expose a stable accessibility tree for the dial screen,
 * so coordinates and readback regions must come from one measured guided
 * session.  This module intentionally contains no guessed coordinates.
 * CONTRACT:custom-night-config-v1.
 */
import { AI_DIALS, AI_10_20, PUPPET_AI } from '@sixam/core/mechanics';

export const CUSTOM_NIGHT_SCHEMA = 'custom-night-config-v1';
export const CUSTOM_NIGHT_CALIBRATION_SCHEMA = 'custom-night-calibration-v1';
export const CUSTOM_NIGHT_MODEL_SCHEMA = 'custom-night-model-v1';
// The measured Custom Night controls accept one rendered frame of contact at
// 60 fps.  This is a UI contact default; the separately qualified gameplay
// timing constants remain owned by the night-driver calibration.
export const CUSTOM_NIGHT_CONTACT_MS = 17;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`custom night: ${message}`); };
const text = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
};
const point = (value, label) => {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y) ||
      value.x < 0 || value.y < 0) fail(`${label} must be a non-negative x/y point`);
  return value;
};
const box = (value, label) => {
  if (!isRecord(value) || !Number.isInteger(value.x) || !Number.isInteger(value.y) ||
      !Number.isInteger(value.width) || !Number.isInteger(value.height) ||
      value.x < 0 || value.y < 0 || value.width < 1 || value.height < 1)
    fail(`${label} must be a non-empty x/y/width/height region`);
  return value;
};

export function validateCustomNightConfig(value) {
  if (!isRecord(value) || value.schema !== CUSTOM_NIGHT_SCHEMA || value.version !== 1)
    fail('configuration schema/version mismatch');
  if (!isRecord(value.dials)) fail('dials are required');
  for (const dial of AI_DIALS) {
    if (!Number.isInteger(value.dials[dial]) || value.dials[dial] < 0 || value.dials[dial] > AI_10_20)
      fail(`dials.${dial} must be an integer in 0..${AI_10_20}`);
  }
  const extras = Object.keys(value.dials).filter(dial => !AI_DIALS.includes(dial));
  if (extras.length) fail(`unknown dials: ${extras.join(',')}`);
  if (value.puppet !== PUPPET_AI) fail(`puppet must be ${PUPPET_AI}`);
  return value;
}

/** Make the reviewed 10/20 configuration without any UI assumptions. */
/** @param {Record<string, number>} dials */
export function makeCustomNightConfig(dials = Object.fromEntries(AI_DIALS.map(dial => [dial, AI_10_20]))) {
  return validateCustomNightConfig({ schema: CUSTOM_NIGHT_SCHEMA, version: 1,
    dials: { ...dials }, puppet: PUPPET_AI });
}

function readbackFields(fields, label) {
  if (!isRecord(fields)) fail(`${label} must be an object`);
  for (const dial of AI_DIALS) {
    const item = fields[dial];
    if (!isRecord(item)) fail(`${label}.${dial} is required`);
    box(item.box, `${label}.${dial}.box`);
    if (!Number.isInteger(item.maxValue) || item.maxValue < 0 || item.maxValue > AI_10_20)
      fail(`${label}.${dial}.maxValue must be an integer in 0..${AI_10_20}`);
  }
  return fields;
}

/**
 * Validate calibration produced by the guided preflight.  Every dial has an
 * increment control and a readback box; a calibration without either is not a
 * usable Custom Night setup and must not reach a live port.
 */
/** @param {any} value @param {{targetBuild?: string}} options */
export function validateCustomNightCalibration(value, { targetBuild } = {}) {
  if (!isRecord(value) || value.schema !== CUSTOM_NIGHT_CALIBRATION_SCHEMA || value.version !== 1)
    fail('calibration schema/version mismatch');
  text(value.build, 'calibration.build');
  if (targetBuild !== undefined && value.build !== targetBuild)
    fail(`calibration.build must match ${targetBuild}`);
  if (!isRecord(value.menu) || value.menu.target !== 'customNight') fail('menu.customNight target is required');
  point(value.menu.point, 'menu.point');
  if (!Number.isInteger(value.menu.holdMs) || value.menu.holdMs < 1 || value.menu.holdMs > 1000)
    fail('menu.holdMs must be an integer in 1..1000');
  point(value.start?.point, 'start.point');
  if (!Number.isInteger(value.start?.holdMs) || value.start.holdMs < 1 || value.start.holdMs > 1000)
    fail('start.holdMs must be an integer in 1..1000');
  if (!isRecord(value.dials)) fail('dial calibration is required');
  for (const dial of AI_DIALS) {
    const item = value.dials[dial];
    if (!isRecord(item)) fail(`dials.${dial} calibration is required`);
    point(item.increment, `dials.${dial}.increment`);
    point(item.decrement, `dials.${dial}.decrement`);
    if (item.holdMs !== undefined &&
        (!Number.isInteger(item.holdMs) || item.holdMs < 1 || item.holdMs > 1000))
      fail(`dials.${dial}.holdMs must be an integer in 1..1000`);
  }
  readbackFields(value.readback, 'readback');
  text(value.titleModel, 'titleModel');
  text(value.configModel, 'configModel');
  return value;
}

const modelPoint = (value, label) => {
  if (!Array.isArray(value) || value.length !== 2 ||
      !Number.isInteger(value[0]) || !Number.isInteger(value[1]))
    fail(`${label} must be a two-element integer point`);
  if (value[0] < 0 || value[1] < 0 || value[0] >= 2400 || value[1] >= 1080)
    fail(`${label} must be inside the 2400x1080 screen`);
  return value;
};

const modelBox = (value, label) => {
  if (!Array.isArray(value) || value.length !== 4 ||
      !value.every(Number.isInteger) || value[0] < 0 || value[1] < 0 ||
      value[2] < 1 || value[3] < 1 || value[0] + value[2] > 2400 || value[1] + value[3] > 1080)
    fail(`${label} must be a bounded [x,y,width,height] region`);
  return value;
};

/** Validate the measured Custom Night screen model used by preset/dial ports. */
/** @param {any} value @param {{targetBuild?: string}} options */
export function validateCustomNightModel(value, { targetBuild } = {}) {
  if (!isRecord(value) || value.schema !== CUSTOM_NIGHT_MODEL_SCHEMA || value.version !== 1)
    fail('screen model schema/version mismatch');
  text(value.build, 'screen model build');
  if (targetBuild !== undefined && value.build !== targetBuild)
    fail(`screen model build must match ${targetBuild}`);
  if (!Array.isArray(value.geometry) || value.geometry.length !== 2 ||
      value.geometry[0] !== 2400 || value.geometry[1] !== 1080)
    fail('screen model geometry must be 2400x1080');
  if (!isRecord(value.controls)) fail('screen model controls are required');
  for (const control of ['presetPrevious', 'presetNext', 'start', 'back']) {
    const item = value.controls[control];
    if (!isRecord(item)) fail(`screen model controls.${control} is required`);
    modelPoint(item.point, `screen model controls.${control}.point`);
    if (!Number.isInteger(item.holdMs) || item.holdMs < 1 || item.holdMs > 1000)
      fail(`screen model controls.${control}.holdMs must be an integer in 1..1000`);
  }
  if (!isRecord(value.dials)) fail('screen model dials are required');
  for (const dial of AI_DIALS) {
    const item = value.dials[dial];
    if (!isRecord(item)) fail(`screen model dials.${dial} is required`);
    text(item.label, `screen model dials.${dial}.label`);
    modelPoint(item.increment, `screen model dials.${dial}.increment`);
    modelPoint(item.decrement, `screen model dials.${dial}.decrement`);
    if (!isRecord(item.readback)) fail(`screen model dials.${dial}.readback is required`);
    modelBox(item.readback.box, `screen model dials.${dial}.readback.box`);
    if (item.readback.maxValue !== AI_10_20)
      fail(`screen model dials.${dial}.readback.maxValue must be ${AI_10_20}`);
  }
  if (!Array.isArray(value.presets) || value.presets.length < 1)
    fail('screen model presets are required');
  const ids = new Set();
  for (const [index, preset] of value.presets.entries()) {
    if (!isRecord(preset)) fail(`screen model presets.${index} must be an object`);
    text(preset.id, `screen model presets.${index}.id`);
    if (ids.has(preset.id)) fail(`duplicate preset id: ${preset.id}`);
    ids.add(preset.id);
    text(preset.label, `screen model presets.${index}.label`);
    if (!isRecord(preset.dials)) fail(`screen model presets.${index}.dials is required`);
    for (const dial of AI_DIALS) {
      if (!Number.isInteger(preset.dials[dial]) || preset.dials[dial] < 0 || preset.dials[dial] > AI_10_20)
        fail(`screen model presets.${index}.dials.${dial} must be an integer in 0..${AI_10_20}`);
    }
  }
  text(value.defaultPreset, 'screen model defaultPreset');
  if (!ids.has(value.defaultPreset)) fail('screen model defaultPreset is not in presets');
  if (!isRecord(value.presetCycle) || value.presetCycle.wrap !== true)
    fail('screen model presetCycle.wrap must be true');
  return value;
}

const sameDialValues = (left, right) => isRecord(left) && isRecord(right) &&
  AI_DIALS.every(dial => left[dial] === right[dial]);
const validDialValues = value => isRecord(value) && AI_DIALS.every(dial =>
  Number.isInteger(value[dial]) && value[dial] >= 0 && value[dial] <= AI_10_20);

function presetWithDials(model, dials) {
  return model.presets.find(preset => sameDialValues(preset.dials, dials))?.id;
}

/**
 * Select a named preset through the measured loopable arrow pair. The caller
 * supplies a fresh readback after every contact; no preset index is assumed.
 * @param {{preset?: string|{id:string}, model?: any, tap?: Function, readback?: Function,
 *   direction?: 'next'|'previous'|'auto', maxSteps?: number, targetBuild?: string}} options
 */
export async function selectCustomNightPreset({ preset, model, tap, readback,
  direction = 'auto', maxSteps, targetBuild } = {}) {
  validateCustomNightModel(model, { targetBuild });
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
  if (sameDialValues(initial.dials, target.dials))
    return { status: 'PASS', preset: presetId, dials: { ...target.dials }, steps: 0, readback: initial };

  let stepDirection = direction;
  const currentId = initial.preset ?? presetWithDials(model, initial.dials);
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
/** @param {{targetBuild?: string}} options */
export function guidedCalibrationSteps({ targetBuild } = {}) {
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
 * @param {{target?: any, calibration?: any, targetBuild?: string, tap?: Function, readback?: Function, maxSteps?: number, wrap?: boolean}} options
 */
export async function configureCustomNight({ target, calibration, targetBuild, tap, readback,
  maxSteps = AI_DIALS.length * AI_10_20, wrap = false } = {}) {
  const expected = makeCustomNightConfig(target?.dials);
  validateCustomNightCalibration(calibration, { targetBuild });
  if (typeof tap !== 'function' || typeof readback !== 'function')
    throw new TypeError('custom night configuration requires tap and readback ports');
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 400)
    throw new TypeError('custom night maxSteps must be an integer in 1..400');
  const initial = await readback({ phase: 'before', expected });
  if (!isRecord(initial) || initial.status !== 'PASS' || !isRecord(initial.dials))
    throw new Error('custom night initial readback is not confirmed');
  const cyclic = wrap === true || calibration.dialWrap === 'cyclic';
  let steps = 0;
  for (const dial of AI_DIALS) {
    if (!Number.isInteger(initial.dials[dial]) || initial.dials[dial] < 0 || initial.dials[dial] > AI_10_20)
      throw new Error(`custom night initial readback is invalid for ${dial}`);
    const difference = expected.dials[dial] - initial.dials[dial];
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
  if (!isRecord(finalReadback) || finalReadback.status !== 'PASS' || finalReadback.puppet !== PUPPET_AI ||
      AI_DIALS.some(dial => finalReadback.dials?.[dial] !== expected.dials[dial]))
    throw new Error('custom night final readback does not match the requested 10/20 configuration');
  return { status: 'PASS', dials: { ...expected.dials }, puppet: PUPPET_AI,
    readback: { status: 'PASS', dials: { ...finalReadback.dials }, puppet: finalReadback.puppet }, steps };
}
