/** Browser composition boundary for the static trainer application. */
export const TRAINER_SCHEMA = 'trainer-trace-v1';
export const trainerInfo = Object.freeze({
  package: '@sixam/trainer',
  responsibility: 'touch presentation, curriculum, audio, and trainer traces',
  canonicalModel: '@sixam/source',
});

export { Coach } from './coach.js';
export {
  MICROTRAINER_SESSION_SCHEMA,
  MICROTRAINER_EVENT_SCHEMA,
  REPLAY_SNAPSHOT_SCHEMA,
  RETAINED_CROP_SCHEMA,
  EXACT_SIMULATOR_CASE_SCHEMA,
  TIMING_BUCKET_SCHEMA,
  UNKNOWN_CHOICE,
  MICROTRAINER_SPLITS,
  MICROTRAINER_SURFACES,
  MicrotrainerIneligibleError,
  makeReplaySnapshot,
  validateReplaySnapshot,
  makePredictionExercise,
  makeRecognitionExercise,
  makeTimingExercise,
  makeStrategyExercise,
  makeMicrotrainerAttempt,
  gradeMicrotrainerAttempt,
  makeMicrotrainerRecord,
  validateMicrotrainerSession,
  makeMicrotrainerSession,
  replayMicrotrainerSession,
} from './microtrainer.js';
export {
  RENDERER_SCHEMA,
  RENDERER_VIEW_SCHEMA,
  RENDERER_IDS,
  RENDERER_CAPABILITIES,
  RENDERERS,
  validateRenderer,
  makeRendererView,
  makeRendererAttempt,
  compareRendererAttempts,
} from './renderers.js';
export {
  ARCADE_PROGRESS_SCHEMA,
  ARCADE_SET_SCHEMA,
  makeArcadeSet,
  makeArcadeProgress,
  validateArcadeProgress,
  applyArcadeGrade,
  exportArcadeProgress,
  resetArcadeProgress,
} from './arcade-lab.js';
