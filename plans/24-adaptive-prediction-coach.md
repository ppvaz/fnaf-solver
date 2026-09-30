# Adaptive prediction coach and contextual microtraining

**Status: proposed 2026-09-01, expanded with Arcade Lab embodiments.** Turn
qualified quiet windows into short, state-conditioned prediction exercises
without weakening the Cue Helper's critical-cue, touch-passthrough, evidence,
or fail-closed contracts. The same exercises may also power the browser
trainer's campaign, a rhythm-highway mode, and a spatial hit-circle mode. This
is a training plan, not authorization for game input and not a claim that a
prompt is safe during a live 10/20 run.

## Goal

Train the player's `perception -> prediction -> decision` loop from the real
belief state rather than present unrelated FNaF trivia:

```text
qualified facts -> belief snapshot -> activity gate -> exercise candidate
                                             |                 |
                                             |                 v
                                             |        prompt -> commitment
                                             |                 |
                                             +------ outcome <-+
                                                        |
                                                        v
                                               player-skill model
                                                        |
                                                        v
                                             later exercise selection
```

The coach has two distinct surfaces:

| Surface | During a live run | Response contract |
|---|---|---|
| passive prediction HUD | only after live safety qualification | no touch target; the player may mentally commit and see a short reveal |
| measured microtrainer | replay, practice, or a separately qualified companion input | explicit timestamped answer used for scoring |

Plan 23's stock-game overlay remains one `FLAG_NOT_FOCUSABLE |
FLAG_NOT_TOUCHABLE` window. It must not become an interactive overlay. A future
explicit response channel must be a declared `TrainingResponsePort` (for
example, the existing trainer or a companion device), with measured clock and
transport latency. Accessibility interception, hidden screen-wide touch
capture, and repurposing a game control as a quiz answer are out of scope.

## Exercise contract

Every exercise is an immutable, replayable record derived from a qualified
belief snapshot:

```text
Exercise {
  id, kind, sourceSessionId, beliefSequence,
  createdAt, promptAt, commitDeadline, revealDeadline,
  eligibility: {activityGateVersion, profileId, factIds},
  question: {target, choices, horizonMs},
  commitment: {choice, committedAt, responsePort} | null,
  resolution: {outcome, occurredAt, evidenceFactIds} | CENSORED,
  disposition: COMPLETED | CANCELLED | EXPIRED | UNRESOLVED
}
```

Presentation and attempt data are deliberately separate from the exercise:

```text
ExerciseAttempt {
  exerciseId, rendererId, rendererVersion, sessionId,
  shownAt, commitment, resolutionDisposition,
  motor: {inputEvents, pathLength, timingError} | null,
  score: {prediction, recognition, timing, execution} | null
}
```

This lets the classic trainer, rhythm highway, and spatial renderer replay the
same frozen question and independently evidenced outcome. A renderer cannot
change the choices, horizon, deadline, resolution, censoring, or correctness.
Motor execution and subject-matter judgment remain separate score dimensions:
a correct prediction with a sloppy tap is still a correct prediction, and a
perfectly timed wrong answer is still wrong. Aggregate reports may present
both, but may not collapse them into a scientifically meaningless accuracy.

The prompt freezes the prediction target and horizon. Later belief changes can
cancel it, but cannot silently rewrite the question or expected answer. The
resolver uses subsequently observed, independently qualified facts; it does
not score the policy's own prediction as ground truth. A session end, stale
sensor, ambiguous event ordering, missed observation window, or safety
cancellation produces `CENSORED`/`CANCELLED`, never an incorrect player answer.

Percentages may be shown only when they are calibrated probabilities for the
matching game, AI, device, sensor, and belief-model profile. Otherwise the UI
uses an ordinal statement such as `most likely: right vent` or shows no
prediction. A heuristic score or simulator frequency must not be printed with
a percent sign.

## Exercise families

### Prediction

Ask which qualified threat/event is most likely to occur first inside a fixed
horizon. Competing events and `none in horizon` are explicit outcomes. A
`MASK NEXT? YES / NO` prompt is valid only when `NEXT`, the horizon, and the
observable resolution event have machine-readable definitions.

### Recognition

Show a short crop from a retained, labeled observation and ask which state or
character it contained. Do not copy a current live ROI back over the game:
that can obscure the source, contaminate MediaProjection, and turn a quiet
window into a visual interruption. Live crops remain disabled; recognition
starts in the trainer/replay surface with profile-bound examples and an
`UNKNOWN` choice.

### Timing

Ask for a coarse time-to-action bucket, with bucket boundaries declared in the
exercise version. Resolution compares against the first qualified action
deadline, not merely the next detected animation. Samples whose deadline was
already inside measured perception/render/response latency are ineligible.

### Strategy micro-simulation

Present two bounded actions over a frozen state, such as `MASK NOW` versus
`ONE MORE FLASH`, and resolve them with the exact simulator or retained branch
evidence. This family begins offline. It cannot appear live until both options
are known not to masquerade as an imperative cue and the counterfactual label
passes the same sourced/assumed and model-only discipline as Plans 11, 12, 16,
20, and 21.

## Arcade Lab: three training embodiments

These are optional offline/replay surfaces in `apps/trainer`, not three new
belief models. All consume the exercise and attempt contracts above, use the
same adaptive scheduler, and resolve from the same evidence. They may be
presented as an `ARCADE LAB` drawer or as discoverable bonus modes after the
corresponding lesson is introduced; they must never be secret enough that
accessibility users cannot find them, nor gate the core curriculum behind a
score or streak.

### Campaign — the browser trainer's native game

Preserve and generalize the trainer's strongest existing game loop: lesson
ladder, pattern preview, coach hints, graded inputs, combo, clean-pass streak,
milestones, retry, and post-run mistakes. Prediction exercises become short
missions inside that loop rather than a separate quiz UI. Early missions can
show choices and generous commitment windows; later missions fade hints,
introduce `UNKNOWN`/abstain, mix state families, and reserve unseen encounters
for a final run.

Progression unlocks presentation variety, remix sets, and personal-best
challenges—not claims of strategy validity. Stars or ranks must be derived from
declared components such as prediction correctness, timing, and clean
execution. Censored/cancelled exercises award no correctness score and never
break a streak. Local progress supports reset/export and does not become game
evidence.

### Rhythm Highway — Guitar Hero-shaped temporal practice

Render upcoming action or observation opportunities as color-coded notes
moving toward a hit line, extending the trainer's existing `Lane`, action
glyphs, tolerance windows, pop judgments, combo, and clean-pass flash. This is
the natural high-density mode for timing exercises and fixed routines:

- action lanes retain the trainer's control colors (`monitor`, `mask`, `light`,
  `cam`, and `wind`), while a hold note represents a real declared hold;
- prediction exercises use a clearly different fork/chord vocabulary: commit
  to one outcome before the line, then reveal the evidenced event after the
  horizon rather than asking the player to execute the predicted action;
- recognition notes may carry retained labeled crops only in replay/practice;
  live captured imagery never becomes a moving note over the stock game; and
- charts are generated from versioned exercise/routine data, not hand-authored
  timing that can drift from the underlying contract.

Scroll speed and note spacing communicate only time until the declared
commitment/action deadline. They must not imply threat probability, urgency, or
detector confidence. Difficulty may reduce lookahead or hinting only inside the
exercise's valid response budget; it may not tighten the evidence horizon,
rewrite a tolerance window, or turn an impossible deadline into a miss.

### Threat Constellation — osu!-shaped spatial practice

Render choices as hit circles on a stable office/camera schematic. An approach
ring closes over the declared commitment window; numbered circles can teach a
known sequence, and a slider can teach a genuine continuous/held motion such
as a calibrated sweep or wind path. This mode is strongest for recognition,
left/right localization, camera-route recall, and rapid state-to-control
mapping. It may measure first-touch latency, misses, cursor/finger travel, and
confusion between regions without pretending those are prediction accuracy.

Spatial placement must be semantic and profile-bound. A right-vent answer
appears at the right-vent region; layouts must not shuffle locations merely to
manufacture difficulty. Approach-ring size/rate expresses response time only,
never confidence or probability. No current live frame is copied into the
playfield, and this interactive renderer is never hosted in Plan 23's
touch-passthrough overlay.

### Shared game-feel and accessibility contract

- One daily/remix seed may select exercises deterministically for reproducible
  comparisons, but no retention mechanic may bias safety claims or holdout
  evaluation.
- Combo, rank, sound, particles, haptics, and screen shake are replaceable
  feedback adapters. Correctness and attempt records do not depend on them.
- Every mode supports keyboard/switch input, non-color labels, scalable text,
  muted audio, haptics-off, and reduced-motion/static-timeline rendering.
- A presentation-invariance test replays one attempt through all renderers and
  proves identical choice, deadline, disposition, and semantic score.
- The scheduler may recommend the embodiment in which a weakness is easiest to
  isolate, but proficiency in one renderer does not silently unlock live mode.

## Activity gate

Low average activity is not sufficient. The gate must bound the chance that a
prompt overlaps the time needed to perceive and execute a critical action:

```text
eligible =
  screen == FNAF2_NIGHT qualified
  && belief fresh and internally consistent
  && no critical cue active or cooling down
  && conservativeRiskUpperBound(critical within quietHorizon) <= profileLimit
  && quietHorizon >= prompt + reveal + cancelP99 + humanRecoveryBudget
  && overlay/capture/response capabilities qualified
```

`quietHorizon`, `profileLimit`, and all latency budgets are versioned profile
values established by replay and device measurement, not the initial 1-2 s
idea copied into production. Uncertainty widens the risk bound; missing inputs
close the gate.

The arbiter priority is fixed:

```text
critical cue  >  exercise cancellation  >  passive HUD  >  exercise prompt
```

Any transition toward danger, stale/unknown belief, screen identity loss,
capture loss, lifecycle interruption, or a higher-priority cue cancels the
exercise immediately. Cancellation clears both prompt and reveal. The measured
belief-change-to-clear p99 must fit inside the profile's cancellation budget.
A cancelled prompt cannot reappear until a cooldown and a new stable quiet
window have both completed.

## Adaptive coach

The player-skill model is a leaf consumer of completed exercise records. It
does not feed detector confidence, belief, policy, or the activity gate. It
tracks performance by exercise version and state family, including:

- prediction accuracy and confusion matrix;
- false-mask and missed-threat rates with explicit denominators;
- timing-bucket error and late commitments;
- per-region reads such as left/right vent and blackout timing;
- cancellation, timeout, and abstention rates; and
- probability calibration (Brier score and reliability bins) when the player
  reports confidence, rather than accuracy being called calibration.

Adaptive selection may increase practice for a weak state only within caps for
repetition, recent exposure, prompt frequency, and state coverage. The
scheduler records its selection probability so evaluation can distinguish
improvement from an easier or biased sample mix. Reports require minimum sample
counts and show uncertainty; a handful of prompts cannot name a stable
`weakest read`.

## Packages

### P1 — replayable exercise and outcome contracts — FOUNDATION LANDED (2026-09-02)

- Add versioned `Exercise`, `Commitment`, `Resolution`, and cancellation reason
  schemas with pure validators.
- Define event ordering, horizons, competing outcomes, censoring, and clock
  domains.
- Persist source belief/fact identifiers without embedding mutable runtime
  objects or treating a prediction as its own label.
- Add deterministic replay tests for completed, cancelled, expired, ambiguous,
  and unobserved outcomes.

`@sixam/trainer/training` (was `@sixam/core/training`) now owns frozen `exercise-v1`, `commitment-v1`,
`resolution-v1`, `exercise-cancellation-v1`, `exercise-event-v1`, and
`exercise-attempt-v1` records. `replayExercise()` requires a prompt-first,
monotonic event stream, freezes the question and deadlines, checks declared
competing outcomes against the question choices, and keeps independently
evidenced resolution separate from player commitment. Late commitments,
duplicate/reordered events, missing evidence, and clock mismatches are
refused; cancellation and expiry produce `CENSORED` outcomes. The deterministic
`tools/exercisetest.mjs` lane covers completed, cancelled, expired, unresolved,
and ambiguous-cancellation cases. Activity gating, scoring, and live rendering
remain later packages.

### P2 — conservative activity-gate evaluator — FOUNDATION LANDED (2026-09-02)

- Build a pure gate over immutable belief/risk/latency snapshots.
- Make unknown, stale, conflict, unsupported profile, and capability loss
  explicit refusal reasons.
- Property-test that raising risk or latency cannot turn a refusal into an
  admission, and that a critical cue always preempts an exercise.
- Replay retained sessions to measure false-quiet admissions before rendering
  any prompt live.

The pure `activity-gate-v1` evaluator now accepts only a positively qualified
`FNAF2_NIGHT` screen, fresh and consistent belief, clear critical state,
profile-bounded risk, a sufficiently long quiet horizon, and all three
overlay/capture/response capabilities. Unknown, stale, conflicting, cooling,
over-limit, short-horizon, profile-mismatch, and unqualified inputs retain
stable refusal reasons. The profile carries versioned risk and prompt/reveal,
cancellation, and human-recovery budgets; the gate sums those budgets rather
than importing a fixed latency guess. `tools/activitygatetest.mjs` proves
critical-cue priority and that increasing risk or measured cancellation latency
cannot turn a refusal into an admission. This is an offline evaluator only;
the retained false-quiet corpus and live prompt gate remain open.

### P3 — offline/replay microtrainer — FOUNDATION LANDED (2026-09-02)

- Implement prediction and timing first in `apps/trainer`, using retained
  state snapshots and resolved future facts.
- Add recognition only from labeled, profile-bound retained crops; always
  permit `UNKNOWN`/abstain.
- Add strategy micro-sims only from versioned exact-simulator cases with visible
  evidence provenance and `MODEL_ONLY` labeling where applicable.
- Retain prompt, commitment, resolution, latency, and scheduler provenance in
  Plan 09-compatible session records.

`apps/trainer/src/microtrainer.js` now provides a DOM-free replay boundary over
the core exercise contracts. Prediction exercises require an independently
evidenced future fact; timing exercises classify a declared deadline against
declared buckets and refuse deadlines already inside the measured response
budget; recognition requires a retained, profile-bound crop, carries its
artifact hash and label provenance, and always adds `UNKNOWN`; strategy cases
require an exact-simulator result with visible `MODEL_ONLY` provenance. The
immutable `microtrainer-session-v1` artifact retains prompt, commitment,
resolution, latency, scheduler, source-fact, artifact, and split metadata, and
replays to the same semantic grade. `tools/microtrainertest.mjs` covers scored,
censored, abstention, timing-budget, provenance, and session-replay paths.
This is the offline factory/session foundation; trainer UI integration,
retained corpus loaders, and Plan 09 real-session joins remain open.

### P3A — Arcade Lab campaign and shared renderer boundary — FOUNDATION LANDED (2026-09-02)

- Extract the current trainer's lesson, combo, streak, milestone, and report
  concepts behind an `ExerciseRenderer`/`ExerciseAttempt` boundary without
  replacing its proven touch-drill behavior.
- Add prediction missions and mixed replay sets to the familiar lesson ladder;
  keep correctness, timing, and motor execution visibly separate.
- Add deterministic seeds, local personal bests, reset/export, and an explicit
  `ARCADE LAB` entry so the bonus modes are delightful but discoverable.
- Prove that cancelled/censored items neither score nor break progression.

`apps/trainer/src/renderers.js` now defines the shared campaign,
Rhythm Highway, and Threat Constellation renderer descriptors. Frozen views
carry the same choices and deadlines, expose keyboard/switch/reduced-motion,
muted-audio, haptics-off, non-color, scalable-text, and optional-pointer
capabilities, and retain only recognition artifact references rather than raw
media. `apps/trainer/src/arcade-lab.js` provides deterministic seeded sets and
local per-player progress with reset/export; censored outcomes do not score or
break combo. `tools/renderertest.mjs` and `tools/arcadelabtest.mjs` prove
semantic invariance and progression neutrality. The shipped trainer now has a
discoverable, explicitly `FIXTURE / PRACTICE` Arcade Lab drawer with local
answer flow, progress export/reset, and a built-page smoke check. The drawer
is an offline prediction fixture, not a retained/live corpus surface; lesson-
ladder integration and actual rhythm/spatial canvases remain open for the
pilot stages below.

### P3B — Rhythm Highway chart foundation — FOUNDATION LANDED (2026-09-02)

- Reuse `Lane`, `glyphFor`, measured tolerance windows, hold-note rendering,
  and coach judgments before introducing new chart machinery.
- Generate charts from exercise/routine records and add a visually distinct
  prediction fork with commit-then-reveal behavior.
- Test dense-note collision, device refresh-rate variance, audio/haptic offset,
  reduced motion, and deadlines near renderer/response latency limits.
- Start with timing and fixed-routine sets; add prediction charts only after
  presentation-invariance and censoring tests pass.

`apps/trainer/src/rhythm-highway.js` now derives deterministic chart records
from a frozen exercise and routine steps carrying declared canonical timing
windows. It reuses the trainer's `glyphFor` semantics, lays notes into lanes
with a hold-aware minimum gap, refuses unrenderable dense collisions, retains
bounded audio/haptic offsets, and adds a commit-then-reveal prediction fork
without its outcome. `tools/rhythmhighwaytest.mjs` covers deterministic layout,
hold notes, collision refusal, window reuse, offsets, and outcome exclusion.
The real canvas pilot still needs refresh-rate/audio-offset/reduced-motion UX
qualification and measured player trials.

### P3C — Threat Constellation pilot

- Define profile-bound semantic anchors for office, vents, cameras, and answer
  regions; never randomize the meaning of space.
- Implement hit circles, numbered sequences, and genuine hold/slider gestures
  against retained exercises, with pointer-path telemetry kept optional.
- Start with recognition/localization and state-to-control mapping, then test
  multi-choice prediction only when the choice geometry does not leak the
  answer.
- Qualify keyboard/switch alternatives, reduced motion, non-color labels, and
  touch-target sizing alongside pointer play.

`apps/trainer/src/threat-constellation.js` now provides the phone-free spatial
layout foundation. It binds every semantic anchor and ordered gesture to one
profile, enforces a minimum touch radius, supports tap/hold/slider records,
requires keyboard/switch/reduced-motion/non-color/scalable-text alternatives,
and marks pointer-path telemetry optional. Recognition layouts retain only the
profile-bound source artifact reference; profile mismatches, unknown anchors,
and raw-media fields refuse. `tools/threatconstellationtest.mjs` covers these
boundaries. The actual hit-circle canvas, retained-corpus localization, and
measured gesture qualification remain open.

### P4 — player-skill model and adaptive scheduler — FOUNDATION LANDED (2026-09-02)

- Produce per-state metrics with denominators, uncertainty, and selection-bias
  metadata.
- Select exercises from observed weak states without allowing the skill model
  to affect run safety or game-state belief.
- Reserve holdout exercises/sessions so adaptation and evaluation do not score
  the same examples as both training and proof.
- Provide reset/export controls; never merge different players or profiles by
  default.

`apps/trainer/src/adaptive-coach.js` now consumes only validated
`microtrainer-session-v1` records. It keeps per-player/profile metrics separate,
counts censored exposure without putting it in the correctness denominator,
reports Wilson 95% intervals and selection-probability means, and stores
holdout results in a separate bucket that never trains the model. The adaptive
selector ranks candidates by conservative lower-bound weakness, excludes
holdout candidates, records its conditional selection probability, and applies
recent-state and per-session caps. Export, reset, duplicate-session, and
profile-binding paths are deterministic and immutable. `tools/adaptivecoachtest.mjs`
covers these boundaries. This remains a replay-only skill consumer; it cannot
feed safety, belief, live prompting, or device policy.

### P5 — passive live prediction pilot

- Extend Plan 23's expiring snapshot with an optional, lower-priority
  non-interactive exercise card and explicit cancellation reason.
- Start with mental `commit before reveal`; do not report human accuracy when
  no commitment was captured.
- Prove z-order preemption, clear latency, capture-feedback isolation, resource
  impact, and no degradation of critical-cue latency.
- Compare prompted and no-prompt quiet windows for player action latency,
  errors, missed cues, and run abandonment before calling the feature helpful.

### P6 — measured commitment pilot

- Introduce a `TrainingResponsePort` only on replay/practice or through a
  separately qualified companion surface.
- Synchronize clocks, retain round-trip/commit latency, de-duplicate responses,
  and reject answers outside the deadline.
- Keep companion loss and late responses from affecting the run HUD, policy,
  or gate.
- Promote explicit live commitments only after P5 shows no material cognitive
  or timing harm and Plan 23's overlay gates remain green.

## Acceptance criteria

The plan is complete only when:

1. every scored answer replays to the same frozen question and independently
   evidenced outcome;
2. stale, conflicting, ambiguous, interrupted, or unobserved cases are censored
   rather than scored against the player;
3. the activity gate admits no known critical-overlap case in the retained
   qualification corpus and its residual risk is reported, not assumed zero;
4. a critical cue preempts and clears a prompt within the measured profile
   budget without delaying the cue;
5. the stock-game overlay remains non-interactive and every explicit response
   comes through a declared, qualified response port;
6. displayed percentages have profile-matched calibration evidence;
7. adaptive reports include denominators, uncertainty, and scheduler bias, and
   holdout evaluation remains separate from training;
8. a controlled practice study finds no material regression in action latency,
   critical errors, or run completion before live measured mode is described
   as usable;
9. campaign, Rhythm Highway, and Threat Constellation produce identical
   semantic grading for the same frozen attempt, while reporting motor/timing
   dimensions separately; and
10. every Arcade Lab mode remains operable with reduced motion and without
    sound, haptics, color-only meaning, or precision pointer input.

## Dependencies

- Plan 23 owns the overlay window, rendering lifecycle, geometry, expiry,
  touch-through, self-capture, and critical-cue priority.
- Plan 20 owns belief, uncertainty, risk, and action-deadline semantics. This
  plan consumes them and cannot redefine a quiet state inside the UI.
- Plan 09 owns retained multimodal sessions and replay-compatible records.
- Plans 11 and 21 own policy/counterfactual semantics used by strategy
  micro-sims; model outputs retain their evidence labels.
- Plan 14 owns device/layout/latency profiles.
- Plan 12 owns promotion claims. Practice gains, a clean pilot, or prediction
  accuracy alone do not establish a 10/20 result.
