// Deterministic Arcade Lab progression primitives for Plan 24 P3A.
// Presentation is intentionally separate from exercise truth and the skill
// model. Censored outcomes do not count as misses, break a streak, or award a
// correctness score.

import { stableHash } from '@sixam/kernel/contracts';
import { validateExercise } from './training/index.ts';
import { finite, freeze, isInteger, isList, validatorsFor } from './validate.ts';
const kit = validatorsFor('arcade lab');
// Annotated, so the checker knows a call to it does not return.
const fail: (message: string) => never = kit.fail;
const { object, text } = kit;

/** One player's local progression through a set. */
interface ArcadeProgress {
  schema: typeof ARCADE_PROGRESS_SCHEMA;
  version: 1;
  playerId: string;
  setId: string;
  createdAtMs: number;
  updatedAtMs: number;
  scored: number;
  correct: number;
  combo: number;
  bestCombo: number;
  censored: number;
  completed: number;
}

export const ARCADE_PROGRESS_SCHEMA = 'arcade-lab-progress-v1';
export const ARCADE_SET_SCHEMA = 'arcade-lab-set-v1';

const clone = <T>(value: T) => structuredClone(value);

function number(name: string, value: unknown, { min = 0, max = Infinity } = {}) {
  if (!finite(value) || value < min || value > max)
    fail(`${name} is outside its numeric bounds`);
  return value;
}

function integer(name: string, value: unknown) {
  if (!isInteger(value) || value < 0) fail(`${name} must be a non-negative integer`);
  return value;
}

function orderKey(seed: unknown, id: unknown) {
  return stableHash(`${text('seed', seed, 128)}:${text('exerciseId', id, 128)}`);
}

/**
 * Deterministically order frozen exercises without changing their semantic data.
 */
export function makeArcadeSet({ id, seed, exercises, surface = 'campaign' }: { id?: string, seed?: string, exercises?: unknown, surface?: string } = {}) {
  text('set.id', id);
  text('set.seed', seed, 128);
  if (!['campaign', 'rhythm-highway', 'threat-constellation', 'replay'].includes(surface))
    fail('set.surface is invalid');
  if (!isList(exercises) || exercises.length === 0) fail('set.exercises are required');
  const values = exercises.map(exercise => validateExercise(exercise));
  const ids = new Set(values.map(exercise => exercise.id));
  if (ids.size !== values.length) fail('set exercises must be unique');
  const ordered = values.sort((a, b) => orderKey(seed, a.id).localeCompare(orderKey(seed, b.id)) ||
    a.id.localeCompare(b.id))
    .map(exercise => exercise.id);
  return freeze({ schema: ARCADE_SET_SCHEMA, id, seed, surface, exerciseIds: ordered,
    count: ordered.length, seedHash: stableHash(`${seed}:${ordered.join(',')}`) });
}

/**
 * Create per-player local progression; it has no cross-player merge path.
 */
export function makeArcadeProgress({ playerId, setId, createdAtMs = 0 }: { playerId?: string, setId?: string, createdAtMs?: number } = {}) {
  text('progress.playerId', playerId, 128);
  text('progress.setId', setId, 128);
  number('progress.createdAtMs', createdAtMs);
  return freeze({ schema: ARCADE_PROGRESS_SCHEMA, version: 1, playerId, setId,
    createdAtMs, updatedAtMs: createdAtMs, scored: 0, correct: 0, combo: 0,
    bestCombo: 0, censored: 0, completed: 0 });
}

function validateProgress(input: unknown) {
  const value = object('progress', input);
  if (value.schema !== ARCADE_PROGRESS_SCHEMA || value.version !== 1)
    fail('progress schema/version is unsupported');
  text('progress.playerId', value.playerId, 128);
  text('progress.setId', value.setId, 128);
  number('progress.createdAtMs', value.createdAtMs);
  number('progress.updatedAtMs', value.updatedAtMs);
  for (const field of ['scored', 'correct', 'combo', 'bestCombo', 'censored', 'completed'])
    integer(`progress.${field}`, value[field]);
  // Every field was checked above.
  const progress = value as unknown as ArcadeProgress;
  if (progress.correct > progress.scored || progress.combo > progress.bestCombo)
    fail('progress counters are inconsistent');
  return progress;
}

export function validateArcadeProgress(input: unknown) {
  return freeze(clone(validateProgress(input)));
}

/** Apply one semantic grade; censored items are progression-neutral. */
export function applyArcadeGrade(progressInput: unknown, grade: unknown, atMs: unknown) {
  const progress = validateProgress(progressInput);
  const result = object('grade', grade);
  const at = number('atMs', atMs, { min: progress.updatedAtMs });
  const next = { ...clone(progress), updatedAtMs: at };
  if (result.status === 'CENSORED') {
    next.censored += 1;
  } else if (result.status === 'SCORED') {
    next.scored += 1;
    next.completed += 1;
    if (result.correct) { next.correct += 1; next.combo += 1; next.bestCombo = Math.max(next.bestCombo, next.combo); }
    else next.combo = 0;
  } else fail('grade status is unsupported');
  return validateArcadeProgress(next);
}

export function exportArcadeProgress(progressInput: unknown) {
  return JSON.stringify(validateProgress(progressInput)) + '\n';
}

export function resetArcadeProgress(progressInput: unknown, createdAtMs: number | null = null) {
  const progress = validateProgress(progressInput);
  return makeArcadeProgress({ playerId: progress.playerId, setId: progress.setId,
    createdAtMs: createdAtMs ?? progress.updatedAtMs });
}
