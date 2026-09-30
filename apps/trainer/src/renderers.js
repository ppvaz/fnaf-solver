// Shared renderer boundary for Plan 24 P3A/P3B/P3C.
//
// Renderers receive a frozen exercise and return a semantic view model. They
// never receive the live game surface or a mutable belief object. A renderer's
// motor/timing telemetry is stored in ExerciseAttempt; it cannot rewrite the
// question or independently choose the outcome.

import { validateExercise, validateExerciseAttempt } from '@sixam/core/training';
import { makeMicrotrainerAttempt, gradeMicrotrainerAttempt } from './microtrainer.js';
import { freeze, validatorsFor } from './validate.js';
const { fail, object, text } = validatorsFor('renderer');

export const RENDERER_SCHEMA = 'exercise-renderer-v1';
export const RENDERER_VIEW_SCHEMA = 'exercise-render-view-v1';
export const RENDERER_IDS = Object.freeze(['campaign', 'rhythm-highway', 'threat-constellation']);
export const RENDERER_CAPABILITIES = Object.freeze([
  'keyboard', 'switch', 'reduced-motion', 'muted-audio', 'haptics-off',
  'non-color-labels', 'scalable-text', 'precision-pointer-optional',
]);

const clone = value => structuredClone(value);

function list(name, values) {
  if (!Array.isArray(values) || values.length === 0 ||
      values.some(value => typeof value !== 'string' || value.length === 0))
    fail(`${name} must be a non-empty string array`);
  if (new Set(values).size !== values.length) fail(`${name} must be unique`);
  return values;
}

function validateAccessibility(input) {
  const value = object('renderer.accessibility', input);
  for (const capability of RENDERER_CAPABILITIES) {
    if (value[capability] !== true) fail(`renderer.accessibility.${capability} is required`);
  }
  return value;
}

/** Validate a renderer without importing DOM or presentation implementation code. */
export function validateRenderer(input) {
  const value = object('renderer', input);
  if (value.schema !== RENDERER_SCHEMA) fail(`renderer schema must be ${RENDERER_SCHEMA}`);
  if (!RENDERER_IDS.includes(value.id)) fail('renderer.id is not registered');
  text('renderer.version', value.version, 64);
  if (!Array.isArray(value.kinds) || value.kinds.some(kind =>
      !['prediction', 'recognition', 'timing', 'strategy'].includes(kind)))
    fail('renderer.kinds contains an unsupported exercise kind');
  list('renderer.kinds', value.kinds);
  text('renderer.presentation', value.presentation, 96);
  validateAccessibility(value.accessibility);
  return freeze(clone(value));
}

export const RENDERERS = Object.freeze({
  campaign: {
    schema: RENDERER_SCHEMA, id: 'campaign', version: '1',
    kinds: ['prediction', 'recognition', 'timing', 'strategy'], presentation: 'lesson-ladder',
    accessibility: Object.fromEntries(RENDERER_CAPABILITIES.map(capability => [capability, true])),
  },
  'rhythm-highway': {
    schema: RENDERER_SCHEMA, id: 'rhythm-highway', version: '1',
    kinds: ['prediction', 'recognition', 'timing', 'strategy'], presentation: 'linear-hit-line',
    accessibility: Object.fromEntries(RENDERER_CAPABILITIES.map(capability => [capability, true])),
  },
  'threat-constellation': {
    schema: RENDERER_SCHEMA, id: 'threat-constellation', version: '1',
    kinds: ['prediction', 'recognition', 'timing', 'strategy'], presentation: 'semantic-office-map',
    accessibility: Object.fromEntries(RENDERER_CAPABILITIES.map(capability => [capability, true])),
  },
});

function rendererFor(input) {
  return validateRenderer(typeof input === 'string' ? RENDERERS[input] : input);
}

/** Build a renderer view that freezes question/deadlines and never embeds raw media. */
export function makeRendererView(exerciseInput, rendererInput) {
  const exercise = validateExercise(exerciseInput);
  const renderer = rendererFor(rendererInput);
  if (!renderer.kinds.includes(exercise.kind)) fail('renderer does not support this exercise kind');
  const sourceCrop = exercise.eligibility.sourceCrop;
  return freeze({
    schema: RENDERER_VIEW_SCHEMA, renderer: { id: renderer.id, version: renderer.version },
    exerciseId: exercise.id, kind: exercise.kind, target: exercise.question.target,
    choices: clone(exercise.question.choices),
    timing: {
      promptAtMs: exercise.promptAtMs, commitDeadlineMs: exercise.commitDeadlineMs,
      revealDeadlineMs: exercise.revealDeadlineMs, horizonMs: exercise.question.horizonMs,
    },
    recognition: sourceCrop ? {
      artifactId: sourceCrop.artifactId, sha256: sourceCrop.sha256,
      profileId: sourceCrop.profileId, split: sourceCrop.split,
    } : null,
    accessibility: clone(renderer.accessibility),
  });
}

/**
 * Create an attempt through the shared renderer contract, without scoring motor behavior as correctness.
 * @param {any} options
 */
export function makeRendererAttempt({ exercise, renderer, sessionId, shownAtMs,
  commitment = null, motor = null } = {}) {
  const value = validateExercise(exercise);
  const descriptor = rendererFor(renderer);
  const view = makeRendererView(value, descriptor);
  const attempt = makeMicrotrainerAttempt({
    exercise: value, rendererId: descriptor.id, rendererVersion: descriptor.version,
    sessionId, shownAtMs, commitment, motor,
  });
  return freeze({ view, attempt });
}

/** Prove presentation invariance for the same frozen attempt across renderers. */
export function compareRendererAttempts(exerciseInput, attempts) {
  const exercise = validateExercise(exerciseInput);
  if (!Array.isArray(attempts) || attempts.length < 2) fail('at least two renderer attempts are required');
  const rows = attempts.map(attempt => {
    const value = validateExerciseAttempt(attempt);
    if (value.exerciseId !== exercise.id) fail('renderer attempt targets another exercise');
    const renderer = rendererFor(value.rendererId);
    if (renderer.version !== value.rendererVersion) fail('renderer version is not registered');
    const grade = gradeMicrotrainerAttempt(exercise, value);
    return { rendererId: value.rendererId, rendererVersion: value.rendererVersion, grade };
  });
  const semantic = JSON.stringify(rows[0].grade);
  if (rows.some(row => JSON.stringify(row.grade) !== semantic))
    fail('renderer semantic grades diverge for one frozen attempt');
  return freeze({ exerciseId: exercise.id, invariant: true, grade: rows[0].grade, renderers: rows });
}
