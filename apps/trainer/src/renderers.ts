// Shared renderer boundary for Plan 24 P3A/P3B/P3C.
//
// Renderers receive a frozen exercise and return a semantic view model. They
// never receive the live game surface or a mutable belief object. A renderer's
// motor/timing telemetry is stored in ExerciseAttempt; it cannot rewrite the
// question or independently choose the outcome.

import { validateExercise, validateExerciseAttempt } from './training/index.ts';
import { makeMicrotrainerAttempt, gradeMicrotrainerAttempt } from './microtrainer.ts';
import { among, freeze, isList, validatorsFor } from './validate.ts';
const kit = validatorsFor('renderer');
// Annotated, so the checker knows a call to it does not return.
const fail: (message: string) => never = kit.fail;
const { object, text } = kit;

/** A registered presentation of exercises. */
interface Renderer {
  readonly schema: typeof RENDERER_SCHEMA;
  readonly id: string;
  readonly version: string;
  readonly kinds: readonly string[];
  readonly presentation: string;
  readonly accessibility: Readonly<Record<string, unknown>>;
}

export const RENDERER_SCHEMA = 'exercise-renderer-v1';
const RENDERER_VIEW_SCHEMA = 'exercise-render-view-v1';
const RENDERER_IDS = Object.freeze(['campaign', 'rhythm-highway', 'threat-constellation']);
const RENDERER_CAPABILITIES = Object.freeze([
  'keyboard', 'switch', 'reduced-motion', 'muted-audio', 'haptics-off',
  'non-color-labels', 'scalable-text', 'precision-pointer-optional',
]);

const clone = <T>(value: T) => structuredClone(value);

function list(name: string, values: unknown) {
  if (!isList(values) || values.length === 0 ||
      values.some(value => typeof value !== 'string' || value.length === 0))
    fail(`${name} must be a non-empty string array`);
  if (new Set(values).size !== values.length) fail(`${name} must be unique`);
  return values;
}

function validateAccessibility(input: unknown) {
  const value = object('renderer.accessibility', input);
  for (const capability of RENDERER_CAPABILITIES) {
    if (value[capability] !== true) fail(`renderer.accessibility.${capability} is required`);
  }
  return value;
}

/** Validate a renderer without importing DOM or presentation implementation code. */
export function validateRenderer(input: unknown): Renderer {
  const value = object('renderer', input);
  if (value.schema !== RENDERER_SCHEMA) fail(`renderer schema must be ${RENDERER_SCHEMA}`);
  if (!among(RENDERER_IDS, value.id)) fail('renderer.id is not registered');
  text('renderer.version', value.version, 64);
  if (!isList(value.kinds) || value.kinds.some(kind =>
      !among(['prediction', 'recognition', 'timing', 'strategy'], kind)))
    fail('renderer.kinds contains an unsupported exercise kind');
  list('renderer.kinds', value.kinds);
  text('renderer.presentation', value.presentation, 96);
  validateAccessibility(value.accessibility);
  return freeze(clone(value) as unknown as Renderer);
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

function rendererFor(input: unknown) {
  // A name that is not registered reads undefined (or an inherited member), which validateRenderer refuses.
  return validateRenderer(typeof input === 'string' ? (RENDERERS as Readonly<Record<string, unknown>>)[input] : input);
}

/** Build a renderer view that freezes question/deadlines and never embeds raw media. */
export function makeRendererView(exerciseInput: unknown, rendererInput: unknown) {
  const exercise = validateExercise(exerciseInput);
  const renderer = rendererFor(rendererInput);
  if (!renderer.kinds.includes(exercise.kind)) fail('renderer does not support this exercise kind');
  // A recognition exercise's crop (makeRecognitionExercise); its fields are read as JavaScript reads them.
  const sourceCrop = exercise.eligibility.sourceCrop as Readonly<Record<string, unknown>> | null | undefined;
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
 */
export function makeRendererAttempt({ exercise, renderer, sessionId, shownAtMs,
  commitment = null, motor = null }: {
    exercise?: unknown, renderer?: unknown, sessionId?: string, shownAtMs?: number, commitment?: unknown, motor?: unknown,
  } = {}) {
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
export function compareRendererAttempts(exerciseInput: unknown, attempts: unknown) {
  const exercise = validateExercise(exerciseInput);
  if (!isList(attempts) || attempts.length < 2) fail('at least two renderer attempts are required');
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
