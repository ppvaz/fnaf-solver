// Small offline Arcade Lab surface for Plan 24 P3A.
//
// The shipped demo uses fixture-labelled replay exercises so the interaction
// path is usable without a retained phone corpus. It goes through the same
// renderer, attempt, and semantic-grade boundaries as future loaded sessions;
// it never reads or overlays the live game.

import {
  gradeMicrotrainerAttempt,
  makePredictionExercise,
  makeReplaySnapshot,
} from './microtrainer.ts';
import { makeRendererAttempt } from './renderers.ts';
import {
  applyArcadeGrade,
  exportArcadeProgress,
  makeArcadeProgress,
  makeArcadeSet,
  resetArcadeProgress,
  validateArcadeProgress,
} from './arcade-lab.ts';

const STORAGE_KEY = 'm7.arcade.progress';
const PROFILE_ID = 'arcade-fixture-profile-v1';
const SET_ID = 'arcade-fixture-set-v1';
const SCHEDULER = Object.freeze({
  policyId: 'arcade-fixture-v1', policyVersion: '1', selectionProbability: 1,
  seed: 'arcade-fixture-v1',
});

const SPECS = Object.freeze([
  { id: 'fixture-hall-01', target: 'next-hall-state', outcome: 'THREAT', stateFamily: 'hall-threat' },
  { id: 'fixture-hall-02', target: 'next-hall-state', outcome: 'CLEAR', stateFamily: 'hall-clear' },
  { id: 'fixture-hall-03', target: 'next-hall-state', outcome: 'THREAT', stateFamily: 'hall-threat' },
]);

function clone(value) { return structuredClone(value); }

function fixtureSpec(spec, index) {
  const atMs = index * 1000;
  const snapshot = makeReplaySnapshot({
    id: `fixture-snapshot-${spec.id}`, sessionId: 'arcade-fixture-source',
    beliefSequence: index + 1, clock: 'host-monotonic-ms', atMs,
    profileId: PROFILE_ID, activityGateVersion: 'activity-gate-v1',
    factIds: [`fixture-before-${spec.id}`], stateFamily: spec.stateFamily, split: 'practice',
  });
  return { ...spec, snapshot, choices: ['CLEAR', 'THREAT'], horizonMs: 500,
    futureFact: { schema: 'resolution-v1', outcome: spec.outcome, occurredAtMs: atMs + 300,
      evidenceFactIds: [`fixture-after-${spec.id}`] } };
}

function readProgress() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    return raw ? validateArcadeProgress(raw) : makeArcadeProgress({
      playerId: 'local-player', setId: SET_ID, createdAtMs: Date.now(),
    });
  } catch {
    return makeArcadeProgress({ playerId: 'local-player', setId: SET_ID, createdAtMs: Date.now() });
  }
}

function writeProgress(progress) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); } catch { /* local-only storage may be unavailable */ }
}

export class ArcadeLab {
  declare root: any;
  declare progress: any;
  declare index: number;
  declare answered: boolean;
  declare sessionId: string;
  declare specs: any[];
  declare set: any;
  constructor(root) {
    this.root = root;
    this.progress = readProgress();
    this.index = 0;
    this.answered = false;
    this.sessionId = `arcade-${Date.now()}`;
    this.specs = SPECS.map(fixtureSpec);
    this.set = makeArcadeSet({ id: SET_ID, seed: 'arcade-daily-fixture-v1',
      exercises: this.specs.map(spec => makePredictionExercise({ ...spec, id: spec.id, scheduler: SCHEDULER }).exercise),
      surface: 'campaign' });
    this.bind();
  }

  bind() {
    this.root.addEventListener('click', event => {
      const target = (event.target as any);
      const answer = target.closest?.('[data-arcade-answer]')?.dataset.arcadeAnswer;
      if (answer) { this.answer(answer); return; }
      if (target.closest?.('#btn-arcade-next')) this.next();
      if (target.closest?.('#btn-arcade-reset')) this.reset();
      if (target.closest?.('#btn-arcade-export')) this.export();
    });
  }

  open() {
    this.progress = readProgress();
    this.index = 0;
    this.answered = false;
    this.render();
  }

  render() {
    const specId = this.set.exerciseIds[this.index];
    const spec = this.specs.find(item => item.id === specId);
    const title = this.root.querySelector('#arcade-title');
    const meta = this.root.querySelector('#arcade-meta');
    const prompt = this.root.querySelector('#arcade-prompt');
    const choices = this.root.querySelector('#arcade-choices');
    const feedback = this.root.querySelector('#arcade-feedback');
    const record = this.root.querySelector('#arcade-record');
    const next = this.root.querySelector('#btn-arcade-next');
    record.textContent = `LOCAL BESTS · ${this.progress.correct}/${this.progress.scored} correct · best ${this.progress.bestCombo}× · censored ${this.progress.censored}`;
    if (!spec) {
      title.textContent = 'SET COMPLETE';
      meta.textContent = `FIXTURE PRACTICE · ${this.progress.correct}/${this.progress.scored} correct · BEST ${this.progress.bestCombo}×`;
      prompt.textContent = 'Censored items would leave this progression unchanged.';
      choices.innerHTML = '';
      feedback.textContent = '';
      feedback.className = 'arcade-feedback';
      next.textContent = 'Run fixture set again';
      next.hidden = false;
      return;
    }
    title.textContent = `MISSION ${this.index + 1} / ${this.set.count}`;
    meta.textContent = `ARCADE LAB · FIXTURE / PRACTICE · ${spec.stateFamily}`;
    prompt.textContent = `What is the independently resolved ${spec.target}?`;
    choices.innerHTML = spec.choices.map(choice =>
      `<button class="arcade-choice" data-arcade-answer="${choice}">${choice}</button>`).join('');
    for (const button of choices.querySelectorAll('[data-arcade-answer]')) button.disabled = this.answered;
    feedback.textContent = this.answered ? feedback.textContent : '';
    feedback.className = this.answered ? feedback.className : 'arcade-feedback';
    next.hidden = !this.answered;
    next.textContent = this.index + 1 === this.set.count ? 'Finish set' : 'Next mission';
  }

  answer(choice) {
    if (this.answered) return;
    const specId = this.set.exerciseIds[this.index];
    const spec = this.specs.find(item => item.id === specId);
    if (!spec || !spec.choices.includes(choice)) return;
    const commitment = { schema: 'commitment-v1', choice,
      committedAtMs: spec.snapshot.atMs + 100, responsePort: 'arcade-keyboard' };
    const made = makePredictionExercise({ ...spec, id: spec.id, scheduler: SCHEDULER, commitment });
    const attempt = makeRendererAttempt({ exercise: made.replay, renderer: 'campaign',
      sessionId: this.sessionId, shownAtMs: spec.snapshot.atMs, commitment }).attempt;
    const grade = gradeMicrotrainerAttempt(made.replay, attempt);
    if (grade.status !== 'SCORED') return;
    this.progress = applyArcadeGrade(this.progress, grade, Date.now());
    writeProgress(this.progress);
    this.answered = true;
    const feedback = this.root.querySelector('#arcade-feedback');
    feedback.textContent = grade.correct ? `CORRECT · ${grade.outcome}` : `MISS · evidence says ${grade.outcome}`;
    feedback.className = grade.correct ? 'good' : 'bad';
    this.root.querySelectorAll('[data-arcade-answer]').forEach(button => { button.disabled = true; });
    this.root.querySelector('#btn-arcade-next').hidden = false;
  }

  next() {
    if (!this.answered && this.index < this.set.count) return;
    if (this.index >= this.set.count - 1) this.index = this.set.count;
    else { this.index += 1; this.answered = false; }
    this.render();
  }

  reset() {
    this.progress = resetArcadeProgress(this.progress, Date.now());
    writeProgress(this.progress);
    this.index = 0; this.answered = false; this.render();
  }

  export() {
    const area = this.root.querySelector('#arcade-export');
    area.value = exportArcadeProgress(this.progress);
    area.hidden = false; area.select?.();
    try { void navigator.clipboard?.writeText(area.value).catch(() => {}); }
    catch { /* clipboard is optional */ }
  }
}
