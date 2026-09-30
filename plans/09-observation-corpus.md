# Stock-device observation corpus and replay contract

**Status: package 1 complete; package 2 foundation implemented, real-phone
validation open (2026-09-02).** The read-only
[`OBSERVATION-CORPUS-INVENTORY.md`](../docs/device/OBSERVATION-CORPUS-INVENTORY.md)
records the 2026-08-26 inventory baseline for every producer and retained
artifact family. Its findings of a missing manifest, missing durable PCM
`startNs` sidecar, and missing BB holdout are historical baseline findings, not
the current producer contract. **Package 2's contract and producer slices
landed 2026-08-26**: versioned schemas, a standard-library validator, synthetic
fixtures, and shared session/monotonic-origin handling in `trial.sh`, Cue Helper
collection, and calibration capture. Every exit path now emits a manifest.
Package 2 stays open on one item only: no manifest from a real phone run has
been validated yet. Fixture records do not close that gate.

The repository has useful labeled visual sets, night recordings, HID traces,
projection snapshots, and PCM captures, but they
are collected and evaluated by subsystem. This plan gives them one session and
replay contract. It does not replace the existing SCM1 or cue evaluators.

## Goal

Make every observation that can change a live action reproducible offline.
Calibration, holdout, timing, provenance, and controller decisions should be
replayable without the phone or commercial game.

The first contract covers three kinds of evidence:

1. **lifecycle:** title/menu, live night, death/static, 6 AM/win, focus loss;
2. **actuator state:** monitor up/down/in transition, mask on/off/in transition,
   selected camera, vent light accepted or `nolight`;
3. **policy observations:** BB left opening, Golden Freddy guards, clock/epoch,
   and the audio cues already scoped by
   [`08-audio-cue-controller.md`](08-audio-cue-controller.md).

## Why this is separate from plan 08

Plan 08 owns audio-source mapping, detector design, IPC, latency, and the rules
for promoting a cue into a decision. This plan owns the shared **recording and
replay envelope** used by audio, visual, lifecycle, and action-verification
models. Audio work should emit the same session identifiers and decision records
without being reimplemented here.

## Current evidence to preserve

- SCM1 building/replay already separates calibration and holdout directories.
- The BB left-opening boundary has a held-out model and live-loop use.
- Golden Freddy has only provisional positive evidence and must stay fail-safe.
- Projection `GRID` and single-value reads have similar measured cost; their
  pixels are a different sensor from raw `screencap` and need their own labels.
- Audio and projection frames share `System.nanoTime()` inside the cue helper.
- `grade-run.sh` already centralizes survival, trace, camera, wind, desync, and
  optional audio reports.
- A 1–3% one-second cue-read tail was traced to orphaned loops and fixed. Corpus
  metadata must retain tail latency and lifecycle faults, not only valid reads.

## Session format

Raw captures remain ignored. Commit a schema, examples with synthetic data, and
aggregate reports; do not commit game imagery or audio.

Each session manifest should contain:

```text
schema version
session id and start/end monotonic timestamps
game package, version/build, night/configuration
device, display geometry, orientation, projection geometry
runner commit and dirty-tree flag
controller/policy version
sensor/model names and hashes
capture commands and relevant environment switches
terminal outcome and its evidence
artifact paths, sizes, hashes, clocks, and truncation flags
```

Each observation/decision record should contain:

```text
timestamp and source clock
sensor and model version
requested label set
value, score/margin, or UNKNOWN reason
valid-from / valid-until interval
controller state before the read
decision and deadline influenced by the read
action result or terminal outcome
link to the source frame/window when retained
```

Use JSON Lines for ordered records and a versioned JSON manifest. A schema
version change must fail old replay explicitly rather than silently reinterpret
fields.

## Work packages

### 1. Inventory and normalize existing captures — complete 2026-08-26

- Enumerate current ignored capture layouts and every producer/consumer.
- Define which artifacts are authoritative versus derived.
- Add a read-only migration/index command; do not rename or rewrite old captures
  automatically.
- Mark unlabeled, ambiguous, truncated, post-death, or clock-incomparable data as
  such. Never infer a positive label from a filename alone.

**Gate:** the index explains every retained artifact or marks it unusable with a
reason, and does not expose tokens or device-specific secrets.

**Result:** complete. The inventory classifies primary observations,
emitted-action records, derived evidence, models, operational metadata, eight
clock/alignment domains, producer/consumer joins, label provenance, split
discipline, retention, and the exact minimum schema fields. Existing files were
read but not renamed or rewritten. `tools/device/index-observations.py` makes
the path/authority/family inventory reproducible; synthetic tests enforce its
strict-mode and read-only contracts.

### 2. Introduce the manifest and event schema — contract and producer slices landed 2026-08-26; package open on one item

- Add schema validation and synthetic fixtures.
- Give `trial.sh`, cue-helper capture, SCM1 collection, and `grade-run.sh`
  one session ID and monotonic origin.
- Record model hashes, not merely model filenames.
- Preserve raw source timestamps; derived alignment belongs in a report field.

**Gate:** a deliberately malformed, mixed-build, stale-model, or cross-clock
session fails validation.

**Result (partial — no completion credit).** The gate as written is met, and
nothing else in this package is.

Shipped: [`schema/session-manifest-v1.json`](../tools/device/schema/session-manifest-v1.json)
and [`schema/session-events-v1.json`](../tools/device/schema/session-events-v1.json)
carry all twelve minimum field groups from the inventory, including named clock
domains with explicit alignment edges, authority class, artifact hash, label
provenance and split role, model authorization with its holdout report,
lifecycle outcome with independent evidence, helper identity and faults, and
redaction. [`validate-session.py`](../tools/device/validate-session.py) is
standard-library only and interprets those schema files rather than restating
them, so a field added to a schema cannot go unchecked.
[`test-validate-session.py`](../tools/device/test-validate-session.py) proves
two synthetic sessions pass and that nine defects each fail with their *own*
reason: `schema-version-unsupported`, `mixed-game-builds`,
`artifact-hash-missing`, `model-stale`, `model-unauthorized`,
`clock-alignment-missing`, `false-win-evidence`,
`secret-in-commit-safe-metadata`, and `event-out-of-order`. A validator that
rejects everything with one generic error is indistinguishable from one that
rejects everything, so distinctness is the assertion, not rejection.
`grade-run.sh` calls it, and says in as many words when a run has no manifest
rather than grading a file that is not there.

The secret check is a commit-safety lint against the shapes the inventory names
(credential-shaped keys, absolute private paths, a live helper token), not a
general secret scanner — it makes no claim about shapes it was not told about.

**Result (producer slice, 2026-08-26).** Every producer now writes one.

[`session-manifest.py`](../tools/device/session-manifest.py) is the emitter and
[`session.sh`](../packages/play/bin/phone/session.sh) is the threading: `fnaf_session_begin`
latches one id and one `time.monotonic()` origin, exports them, and every later
call — including a helper started *inside* a run — reads them back rather than
deriving a second identity from a filename. `trial.sh` begins the session
before the game is launched and closes it from `cleanup`, which is trapped on
`EXIT` with `INT`/`TERM` routed through it, so a watchdog abort, a classifier
threat stop, a menu failure and an operator's Ctrl-C all finalize. The outcome
on the success path is `unknown`, never `win`: completing the planned cycles
says nothing about whether the game was alive, and only `grade-run.sh` can
answer that. `grade-run.sh` now runs from inside `cleanup`, after the manifest
exists — grading before it would have reported every successful run as
unmanifested.

Three properties the emitter enforces rather than documents:

- **hashes, not filenames.** `record artifact file=…` and `record model file=…`
  hash the bytes on disk; a path that does not exist becomes an
  `artifact-absent` fault event, never an entry. Frame sets are directories, so
  they are hashed as the sorted `(name, sha256)` listing.
- **raw clocks kept raw.** The device epoch latch is stamped on the host clock
  and carries the device's own `epoch_ms` verbatim as `source_t`; a measured
  `device_shell_wall_ms → host_monotonic_ms` edge, bracketed by the host clock
  and carrying its round-trip as `residual`, is what relates them. Without that
  edge the same event is refused. Where no origin exists — the helper's PCM has
  no `startNs` sidecar — the artifact declares no clock domain at all instead of
  asserting one.
- **models are `fail-safe`, not `live-decision`.** BB-left, CAM 05 and
  Golden-Freddy classifiers can only stop a run, never cause an action, and none
  has a retained holdout report — which is what keeps them out of
  `live-decision` until package 4 gives them one. `authorized_for_game_build` is
  the build `coords.sh` was calibrated on, so a phone carrying another build
  makes every model stale, loudly, in the manifest.

[`test-session-manifest.sh`](../packages/play/bin/phone/test-session-manifest.sh) drives
the real shell entry points under a mock adb: a session validates end to end;
its artifact digests match independently computed ones; an absent capture is a
fault; an aborted session finalizes with exactly one matching terminal event;
credential-shaped keys, absolute private paths and keys the schema does not
define are refused at record time; and finalize keeps the spool when the
manifest does not validate, which is how `grade-run.sh` can now report a
session that failed to describe itself instead of one that was never started.
Two controls keep the clock claim honest: with no device-clock read the domain
is undeclared and the cross-clock event fails `unknown-clock-domain`, and
deleting only the alignment edge from the manifest that *did* pass breaks it
with `clock-alignment-missing`.

Still open, and the only reason this package is not closed: **no manifest from
a real device run has been validated.** The producers were written while the
phone belonged to another stream, so everything above is proven against a mock
adb and synthetic artifacts. The next run on hardware closes it — the manifest
is emitted unconditionally and `grade-run.sh` validates it as step 0, so the
confirmation costs nothing extra. Also not done here: the event stream records
lifecycle transitions and faults only. Per-press observation and decision
records are device-side and belong with package 3's replay entry point.

### 3. Build one replay entry point

The replay command should:

- run the relevant visual/audio/lifecycle classifiers;
- reproduce `UNKNOWN` and deadline-expired results;
- compare recorded and current classifications;
- optionally feed ordered observations to the pure policy interface from plan
  10 without emitting device input;
- print a confusion matrix and transition/decision diff;
- exit nonzero on a declared regression contract.

Keep SCM1 and cue-specific evaluators authoritative for their math. The shared
entry point orchestrates them and normalizes results rather than hiding them
behind a new generic classifier.

### 4. Enforce session-level calibration and holdout splits

- Split by complete capture session, device/build, and sensor path.
- Forbid adjacent windows from one recording appearing in both sets.
- Report sample counts, session counts, false positives, false negatives,
  unknowns, and 95% binomial bounds.
- Derive acceptable error rates from a policy failure-injection sweep; do not
  select a convenient generic accuracy threshold.

**Gate:** every action-driving model has a named holdout contract. A model with
insufficient positives remains shadow-only or fail-safe regardless of aggregate
accuracy.

### 5. Add lifecycle and action-state labels

Prioritize labels by their ability to close the loop:

1. live night versus death/static versus 6 AM/win;
2. monitor stable up/down versus transition/unknown;
3. mask stable on/off versus transition/unknown;
4. vent light accepted versus `nolight`;
5. selected-camera identity where the policy depends on it;
6. threat-specific models already justified by the simulator.

For terminal state, false win is never acceptable. A terminal `UNKNOWN` stops
input and preserves evidence; it must not be converted to retry or success.

### 6. Soak and fault replay

Exercise projection revocation, helper death, stale token, focus loss, truncated
recording, clock discontinuity, full queue, late result, missing model, and
controller interruption. Retain the fault as a first-class observation.

**Gate:** no fault can silently become `empty`, `safe`, `night`, or `win`.

## Deliverables

- versioned manifest/event schemas and synthetic fixtures;
- capture index/migration report;
- one orchestration/replay command with a documented exit contract;
- session-split detector reports for each promoted observation;
- integration in `grade-run.sh` and the canonical tool index;
- updated device documentation describing which models are shadow, fail-safe,
  or action-authorized.

## Done when

- one retained run can be replayed from sensor inputs through policy decisions
  without a connected phone;
- every action-driving observation names its model hash, holdout, latency
  distribution, validity interval, and `UNKNOWN` behavior;
- terminal state is independently graded and cannot confuse an aborted/title
  recording with survival;
- a detector or policy change produces an explicit replay diff;
- raw commercial-game media and credentials remain outside git.

## Non-goals

- building a universal computer-vision framework;
- replacing SCM1, cue features, or post-run graders with one opaque model;
- using modified-game internal state as production input;
- collecting more data before the session and label contract exists.
