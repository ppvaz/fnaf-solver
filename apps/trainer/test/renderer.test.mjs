import assert from 'node:assert/strict';
import {
  RENDERER_SCHEMA,
  RENDERERS,
  compareRendererAttempts,
  makeRendererAttempt,
  makeRendererView,
  validateRenderer,
} from '../src/renderers.ts';
import {
  makePredictionExercise,
  makeReplaySnapshot,
} from '../src/microtrainer.ts';

const expectThrow = (fn, pattern) => assert.throws(fn, error => !pattern || pattern.test(error.message));
const scheduler = { policyId: 'renderer-test', policyVersion: '1', selectionProbability: 1 };
const snapshot = makeReplaySnapshot({
  id: 'render-snapshot', sessionId: 'render-source', beliefSequence: 1,
  clock: 'host-monotonic-ms', atMs: 100, profileId: 'render-profile',
  activityGateVersion: 'activity-gate-v1', factIds: ['before'], stateFamily: 'hall', split: 'replay',
});
const made = makePredictionExercise({
  id: 'render-exercise', snapshot, target: 'next-state', choices: ['CLEAR', 'THREAT'],
  horizonMs: 400, scheduler,
  futureFact: { schema: 'resolution-v1', outcome: 'THREAT', occurredAtMs: 250,
    evidenceFactIds: ['after'] },
  commitment: { schema: 'commitment-v1', choice: 'THREAT', committedAtMs: 180,
    responsePort: 'keyboard' },
});
const final = made.replay;

for (const id of Object.keys(RENDERERS)) {
  const renderer = validateRenderer(RENDERERS[id]);
  assert.equal(renderer.schema, RENDERER_SCHEMA);
  const view = makeRendererView(final, renderer);
  assert.deepEqual(view.choices, final.question.choices);
  assert.deepEqual(view.timing, {
    promptAtMs: final.promptAtMs, commitDeadlineMs: final.commitDeadlineMs,
    revealDeadlineMs: final.revealDeadlineMs, horizonMs: final.question.horizonMs,
  });
  assert(!Object.hasOwn(view, 'pixels') && !Object.hasOwn(view, 'imageData'),
    'renderer views must not embed raw media');
}

const attempts = Object.keys(RENDERERS).map((renderer, index) => makeRendererAttempt({
  exercise: final, renderer, sessionId: `render-session-${index}`, shownAtMs: 100,
  commitment: final.commitment, motor: { inputEvents: 1, timingErrorMs: index },
}).attempt);
const invariant = compareRendererAttempts(final, attempts);
assert.equal(invariant.invariant, true);
assert.equal(invariant.grade.correct, true);
expectThrow(() => validateRenderer({ ...RENDERERS.campaign,
  accessibility: { ...RENDERERS.campaign.accessibility, keyboard: false },
}), /accessibility.keyboard/);
expectThrow(() => compareRendererAttempts(final, [attempts[0],
  { ...attempts[1], rendererVersion: '999' }]), /version/);

console.log('renderers: campaign/rhythm/spatial frozen views, accessibility, raw-media exclusion, shared attempts, and semantic invariance pass');
