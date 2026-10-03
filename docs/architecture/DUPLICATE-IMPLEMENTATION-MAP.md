# Duplicate implementation map

Where this repository implements the same thing more than once, and what — if
anything — keeps the copies honest.

This is a **cleanup input, not a cleanup verdict**. No entry below is a claim
that a duplicate is wrong: several are deliberate and correctly gated, and the
charter's own layering means the same idea legitimately appears once per layer.
The point is that a cleanup should not have to rediscover the list, and that
the ungated copies are separable from the gated ones.

## Applied 2026-09-08

The first cleanup pass off this page. Each entry keeps its original reasoning
and gains its outcome in place, per the retraction convention in
[`../README.md`](../README.md).

| § | Family | Outcome |
|---|---|---|
| 5, 7, 8 | Device paths | **Resolved by removal, 2026-09-25.** The legacy `trial.sh` lane and its 12 stages, 19 closed probes, the fixture service path (`service.js`, `composition.js`, `modern-composition.js`, `calibration-fixture.js`, `live-seam-composition.js`), the runtime package, the adapter hexagon, screencheck and the machine executor left the tree ([`../ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)). One composition root remains, `modern-campaign-ports.js` behind `cli.js campaign`, and one device executor, `adb-device-local-executor.js` (its schedule, shell and effect halves now `hid-schedule.js`, `device-shell.js`, `control-effect.js`). The rows in §5, §7 and §8 describe the tree before that date |
| — | Removed and archived code | **2026-09-24.** `tools/invent/`, `esp32-audio-authority.py`, `gatesearch`/`gatebot`, `strategysearch` and `knobsweep` left the tree ([`../ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)); rows below that name them describe the tree before that date |
| 1 | Frame ingest | **Resolved.** `camera-` and `watch-calibrate.py` now import the loaders instead of copying them; their dead PIL guards went with them |
| 4 | Calibration CLI | **Resolved for four of five.** `add_common_arguments()` in `monitor-calibrate.py`; `screen-calibrate.py` left alone because it has no gate |
| 13 | Grading census | **Resolved.** The coverage gate reads all three registries and is green; 22 exclusion rows added, one gate registered |
| 16 | Trainer validators | **Resolved.** `apps/trainer/src/validate.ts`; 34 duplicate definitions removed from six modules |
| 17 | `packages/propose/bin/minus-toys/` (was `tools/minustoys/`) | **Decided: keep.** Route-per-directory is deliberate; see the row |
| 19 | Dead citations | **Resolved.** Four files repointed at `plant-model.js` |

Open gaps this pass created or exposed are in §22. Everything else on the page
is untouched and still true.

## How to read it

Every family names the **owner** (the implementation the charter or a contract
puts in charge), the **other implementations**, and the **binding** — the thing
that fails if the copies disagree:

| Binding | Meaning |
|---|---|
| `GATE` | An executable check compares the implementations. Divergence turns a lane red. |
| `COMMENT` | A source comment asks a human to keep them aligned. Divergence is silent. |
| `NONE` | Nothing relates them. Divergence is silent and the reader cannot tell which copy is current. |

`COMMENT` and `NONE` are the cleanup surface. `GATE` families are listed so a
cleanup does not "simplify" away a disciplined pair, and so the four existing
gate patterns (§20) can be reused instead of reinvented.

## Relationship to the generated register

[`generated/duplicate-responsibilities.json`](generated/duplicate-responsibilities.json)
already exists and stays authoritative for **ownership drift** — which package
owns a responsibility that a `tools/` path still implements. It has five
entries and is a hand-maintained constant in `tools/generate-catalog.ts:208`,
so it is "generated" in name only; three of its five rows point at globs
(`tools/*search*`, `tools/*sweep*`, `tools/*probe*`) rather than files.

This page is the complementary axis: **implementation multiplicity** — the same
job done twice in one layer, in two languages, or in three CLI shapes. It names
files. Neither page derives itself from source yet; §21 records the command
that produced this one.

Scope of the survey: 453 tracked `js/mjs/ts/py/sh` files (84,977 lines, 147 of
them test-shaped) plus 39 Java files under `android/companion`. 215 of those
files live in `tools/device`.

---

## 1. Frame ingest and sensor geometry (Python) — binding: `NONE`

Two generations of "turn bytes into a frame, or refuse", live side by side.

- **Owner (gen 2):** `packages/play/src/sensors/screencap/sensor.py` (74 lines) — `NATIVE =
  "screencap-2400x1080"`, a `SENSORS` registry, and `open_frame(source,
  declared)` that raises `SensorMismatch` rather than resizing an
  uncalibrated capture into a plausible answer. Consumed by
  `packages/play/src/sensors/screencap/title-observe.py:55` and `packages/play/src/sensors/screencap/lifecycle-observe.py:46`.
- **Gen 1 library:** `packages/play/bin/calibrate/monitor-calibrate.py:55` declares
  `WIDTH = 2400` / `HEIGHT = 1080` and owns `load_raw` + `load_frame` +
  `paths_for`. `mask-calibrate.py:60` and `screen-calibrate.py:52` **import it
  by path** (`importlib.util.spec_from_file_location`, because the module name
  is hyphenated) and reuse those loaders. That is the sharing pattern, already
  adopted, and `mask-calibrate.py:57` states it: "One fitting algorithm, not
  two: the per-cell worst-case-gap fit, the grid replication and the frame
  loaders all live in monitor-calibrate.py and are imported here."
- **Gen 1 copies:** `packages/play/bin/calibrate/camera-calibrate.py:43` and
  `tools/device/watch-calibrate.py:36` import nothing from it and instead
  re-declare `WIDTH`/`HEIGHT` and re-implement the loaders.

Measured: the `load_raw`/`load_frame`/`paths_for` block is **byte-identical**
between `monitor-calibrate.py` and `camera-calibrate.py` (same MD5);
`watch-calibrate.py` is the same code with type annotations removed. The clone
detector puts 39 identical 7-line windows between the first two.

So this family was half-converged: two of four dependants shared, two copied.

**RESOLVED 2026-09-08.** `camera-calibrate.py` and `watch-calibrate.py` now
load `monitor-calibrate.py` by path and alias `CalibrationError`, `WIDTH`,
`HEIGHT`, `load_raw` and `load_frame` from it; `watch-calibrate.py` also takes
`paths_for`, whose `LABEL_RE` is identical. `camera-calibrate.py` keeps its own
`paths_for` because its labels are `CAM:N`, not free-form names — verified by
hashing the bodies before aliasing, since `paths_for` closes over each module's
`LABEL_RE`. Both files' local PIL guards became dead once the loaders left and
were removed. Net −95 lines; all four calibration gates green.

Still open: whether gen 1 should reach `sensor.py` at all, or whether gen 1 is
the calibration-time reader and gen 2 the run-time reader. Nothing states it.

## 2. Observer command-line shapes — binding: `NONE`

Four input conventions among sibling scripts in one directory:

| Convention | Scripts |
|---|---|
| frame on **stdin only** | `title-observe.py`, `lifecycle-observe.py`, `screenstate.py` (plus its own `--adb-fast` capture path) |
| positional path **or** stdin | `intro_card.py` |
| `LABEL=PATH` corpus via argparse | `monitor-calibrate.py`, `camera-calibrate.py`, `watch-calibrate.py`, `mask-calibrate.py`, `screen-calibrate.py`, `grid-signature.py` |
| bare positional paths | `region-classify.py` (3 frames), `maskraise-grade.py` (video + stream) |

This one has a price on the record: `CLAUDE.md`'s mistake register, entry 1,
is exactly this divergence — a positional path handed to `title-observe.py` is
silently ignored and yields `unknown=unreadable-frame`, which cost a live
attempt. The register's remedy is "read the tool's usage first"; a cleanup
remedy is one shared frame-source argument helper.

## 3. Cross-language spec mirrors — binding: `COMMENT`

The on-device Java helper and the host tools implement the same two numeric
models, aligned by comment only.

- **Pixel watch spec.** Narrowed 2026-09-27: `PixelWatch.defaultSpec()` is
  now only the twelve FNaF 2 camera-button pixels, and `watch-calibrate.py`
  (the luma-entry calibrator) was removed with the luma entries.
  `packages/play/bin/calibrate/camera-calibrate.py` still carries its own copy of the twelve
  coordinates, and `test-camera-calibrate.py` holds it to the camera rule.
- **Phase clock.** Resolved 2026-09-27: the APK's `PhaseClock.java` left with
  the Companion's audio path, so `packages/play/src/clocks/phase-clock.ts`
  (tested by `packages/play/test/phase-clock.test.ts`) is the only implementation.

Cleanup decision: these are the two strongest candidates for the shared-JSONL
vector pattern already used by `packages/kernel/test/contract-vectors.py` (§20).

## 4. Calibration fitters — binding: `COMMENT` (spec) / partial reuse (code)

Five host-side fitters: `monitor-calibrate.py` (424), `camera-calibrate.py`
(304), `watch-calibrate.py` (336), `mask-calibrate.py` (267),
`screen-calibrate.py` (237). Their consumers on the JS side are
`packages/play/src/sensors/fnaf2/monitor-rule.ts`, `camera-rule.js`, and
`calibration-state-rule.js`.

The **fitting algorithm is not duplicated** — see §1: `mask-calibrate.py` and
`screen-calibrate.py` import it from `monitor-calibrate.py`. What is still
copied is the surrounding shell: the argparse block (`--output`, `--sensor-id`,
`--profile-id`, `--min-margin`, `--max-anchors`, `--note`, `--strict`,
`labelled`) and the JSON summary dict, near-verbatim across
`mask-calibrate.py:235`, `screen-calibrate.py:205` and
`monitor-calibrate.py:388` — 32, 28 and 14 shared 7-line windows pairwise. It
reaches the gates too: `test-mask-calibrate.py:38` and
`test-monitor-calibrate.py:30` share 12.

**RESOLVED 2026-09-08 for four of the five.** `add_common_arguments(parser,
sensor_id, profile_id, *, note=True)` in `monitor-calibrate.py` now declares
the six options every fitter spelled identically (`--output`, `--sensor-id`,
`--profile-id`, `--min-margin`, `--note`, `--strict`); each caller keeps its own
extras and its own `labelled` positional, whose metavar differs.
`screen-calibrate.py` was deliberately **not** changed: it is the one fitter
with no gate (§22), so a change to it could not be proven. The JSON summary
dict is still duplicated — it reads the local fit result, so sharing it needs a
small result type first.

## 5. ADB transport — binding: `NONE`, against a stated owner

`CLAUDE.md` gives adapters ownership of transport, and
`packages/play/src/campaign/adb-bridge.ts` (251) is the closed, reviewable port. In
practice **28 tracked files invoke `adb` directly**, led by
`tools/device/legacy-trial.sh` (55 call sites), `trial-maskcamp.sh` (19),
`hid-sweep-probe.sh` (16), `query-companion.sh` and `capture-screen-sample.sh`
(10 each). `packages/play/src/campaign/adb-device-local-executor.ts` (974) holds the
sanctioned device-local path; `packages/play/src/venues/phone/hid.ts` and
`transports/cue-helper.js` hold the codecs and deliberately open nothing.

`legacy-paths.json` already records the legacy runners with removal gates, so
this family is partly tracked — what is not tracked is the long tail of probe
and capture scripts that each re-derive device selection and command shape.

## 6. Device-action shell preamble — binding: `NONE`

The same opening — resolve one serial, refuse to overwrite an output, take the
per-serial lease, re-exec under the lock — is copied across device scripts:

- 17 scripts source `packages/play/bin/phone/select-adb.sh`.
- The `[ ! -e "$OUTPUT" ] || { echo "refusing to overwrite: ...` idiom appears
  in 14 files (8 times inside `legacy-trial.sh` alone, and in five
  `packages/propose/parked/minus7/cue/*.py` scripts).
- The `COMPANION_DEVICE_LOCK_HELD` re-exec through `device-lock-exec.py`
  appears in 4 scripts.

Measured overlap: 11 shared 7-line windows between
`overlay-qualification-observe.sh:36` and `soak-companion.sh:29` — the
output-path, lease, and `adb get-state` preamble verbatim.

## 7. Composition roots — binding: `COMMENT` for the fixture pair, else `NONE`

Four roots that each bind ports to a service, plus two that mirror each other:

| File | Lines | Binds |
|---|---|---|
| `apps/device/src/composition.js` | 42 | profile name → adapters, shared runtime |
| `apps/device/src/modern-composition.js` | 112 | Plan 22 physical seam (HID + Companion transports) |
| `apps/device/src/modern-campaign-ports.js` | 580 | campaign root: title/lifecycle observers + physical ports |
| `apps/device/src/campaign-composition.js` | 52 | reviewed bundle → runner |
| `apps/device/src/calibration-fixture.js` | 80 | offline logical-clock fixture |
| `apps/device/src/live-seam-composition.js` | 118 | "mirrors `calibration-fixture.js`" in `live` mode |

The last pair says so in its own header, and the detector confirms 6 shared
windows. The first four are a genuine question for a cleanup: which is *the*
composition root, and are the others its callers or its rivals?

## 8. Executors, runners, and pilots — binding: partial `GATE`

Host-side schedulers and their simulator twins:

- **Device executors:** `device-local-executor.js` (96),
  `adb-device-local-executor.js` (974), `artifact-executor.js` (296),
  `campaign-runner.js`, `service.js` (443) — all under `apps/device/src`, all
  carrying `device-executor-v1`, which is the binding that makes this
  family legible.
- **Simulator pilots:** `packages/propose/parked/minus7/hid-device-pilot.ts` (962),
  `stock-device-pilot.ts` (412), `reactive-pilot.ts` (344),
  `closed-loop-reclaim.ts` (155). `stock-device-pilot.ts:3` states its
  relationship — it replays `tools/device/trial.sh`'s millisecond table — and
  `hid-device-pilot.mjs:9` states that its CAM 05 policy is "retained as a
  comparison, not the selected" one. Those two headers are the only thing
  ordering the family.
- **Shell runners:** `legacy-trial.sh` (1860), `trial.sh`, `trial-maskcamp.sh`,
  and 12 `tools/device/trial/*.sh` stages. Already in `legacy-paths.json` with
  removal gates.
- Probe near-duplicates: `hid-maskraise-probe.mjs:108` and
  `hid-monitorraise-probe.mjs:134` share 8 windows;
  `tools/device/hid-raise-probe.mjs` is a third variant of the same
  measurement.

## 9. Policy representation — binding: `GATE` inside Plan 21, `NONE` across families

Twelve modules spell "policy", in at least three unrelated vocabularies.

- **policy-v1 IR (gated).** `packages/propose/src/policy/policy-ir.ts` (86) owns
  the schema with `observation-language.js`; `packages/propose/bin/policy/policy-grammar.ts`
  (387), `policy-interpreter.ts` (77), `policy-search.ts` (169),
  `policy-artifact.ts` (142) build on it, and `policy-equivalence.ts` (214)
  is a real compiler-equivalence gate. `packages/propose/bin/policy/policy-ir.ts` (51) is a
  **name collision, not a copy**: it converts one Night 1 plan into the IR.
- **Invention language.** `tools/invent/policy-lang.mjs` (499) — a rule-list
  genome over a privileged simulator surface, explicitly not device-promotable.
  Its header states the duplication outright: first-match-wins "exactly like
  the cascade in `packages/propose/parked/minus7/reactive-policy.ts`'s `decide()`".
- **Reactive rule cascade.** `packages/propose/parked/minus7/reactive-policy.ts` (96).
- **Comparison adapter.** `packages/propose/parked/minus7/policy.ts` (361) and
  `packages/propose/parked/minus7/policybaselines.ts` (532) — the plans/11 observation/action contract.
  `packages/propose/bin/policy/policy-inspect.ts` (12) is the CLI shim.

Cleanup decision: the three vocabularies are probably all warranted (device IR,
privileged genome, comparison adapter) — but nothing says so, and the shared
name is what makes a newcomer read the wrong file.

## 10. Route plan emitters — binding: `NONE` on the shape, `GATE` per route

`packages/propose/bin/plans/minus-toys-plan.ts` (554) and `minus-3-plan.mjs` (239) implement
the *same undeclared interface*: `KNOBS0`, `build()`, `schedule()`,
`replay()`, `emitPlan()`, plus a census entry point (`phaseScan` / `gate`).
`minus3-frame-light.ts` (145) is a third shape for the same job
(`winRows`/`deviceEdges`/`census` with a pinned `EDGES_SHA256`).
`recipe.mjs` (1081) is the older monolith that emits cycle recipes directly,
and `bundle.ts` (546) compiles a winner into the device bundle.

Each route has its own seed census, so the *results* are gated; the *interface*
is not, which is why a fourth route means a fourth hand-written module.

## 11. Plants and transition models — binding: `GATE` (the model to copy)

- `packages/source/src/games/fnaf2/plant-model.ts` (1159) — `class Sim`, the sole
  mechanics authority.
- `plant.js` (44) — semantic facade over it (`plant-model-v1`).
- `reduced-model.js` (334) — deliberately not a second engine; gated against
  seeded `Sim` replays by `packages/propose/test/reducedmodeltest.ts`.
- `packages/propose/parked/minus7/sim.ts` (149) — searchable wrapper: clone, semantic actions,
  privileged view.
- `packages/propose/src/experiment/families/minus-toys.ts`, `minus-two.js` — exact
  evaluators, with `packages/propose/test/legacy-equivalence.test.ts`.

This is the family a cleanup should imitate: four things named like engines,
one authority, an equivalence gate for each derived model.

## 12. Search and sweep harnesses — binding: `NONE`

Roughly twenty independent harnesses over the same engine. Already flagged as
globs in the generated register; named here so they can be triaged:

- `packages/propose/parked/minus7/` (was `tools/minus7/`): `search.mjs` (189), `paramsearch.ts` (239),
  `geometrysearch.ts` (303), `cyclelengthsearch.ts` (129),
  `devicetimesearch.ts` (97), `robustify.ts` (117), `constrained-worker.ts`.
- `tools/invent/`: `search.mjs` (248), `campaign.mjs` (290), `ablate.mjs` (151).
- root: `constrainedsearch.ts` (205), `cyclesearch.ts` (251),
  `gatesearch.mjs` (113), `strategysearch.mjs` (179), `knobsweep.mjs` (133),
  `latenesssweep.ts` (185), `phasesweep.ts` (47), `periodicsweep.ts` (40),
  `flicksweep.ts` (39), `phase-tolerance.ts` (198).
- `packages/propose/bin/policy/policy-search.ts` (169), `gate-worker.ts` (42).
- Owner per the charter: `packages/propose/src/experiment/experiment.ts` with specs under
  `packages/propose/experiments/`.
- Shared execution machinery that already exists: `packages/propose/bin/census/pool.ts` (129) +
  `pool-worker.ts`.

## 13. Grading instruments — binding: `GATE` on coverage only

`packages/review/bin/grade/grade-run.sh` (330) exists **because** this family sprawled; its
header is the best statement of the problem in the repository ("we have a
drawer full of them ... and nothing that runs them"), and it records the false
record that cost: nights 6-36 and 6-37 reported past 2 AM while the retained
frames held a restart card and the death static, because the grading step
graded `$OUT.mp4` while aborts save `$OUT-aborted.mp4`.

Instruments: `grade-night.py` (278), `grade-minus7.py` (159),
`maskraise-grade.py` (526), `death-cause.py` (224), `death-census.py` (145),
`sweepcheck.py` (291), `windpct.py` (156), `camtrace.py` (140),
`screenstate.py` (209), `replay-screen-model.py` (137), plus the `grade`
verb in `apps/desktop/src/device-cli.ts` (was `apps/device/src/cli.js:193`).

**The best existing inventory in the repository is this family's gate.**
`packages/review/bin/grade/test-grade-run-coverage.ts` enforces that every script in
`tools/device`, `packages/source/decompile` and the directories the device and
cue scripts moved to (its `SIBLINGS`) is either invoked by
`grade-run.sh`, a gate the suite runs, or **excluded with a written reason** —
and its `EXCLUDED` map carries ~90 one-line rationales ("simulator layer, gated
by test-actuator.ts"; "charts the model gate's death census for a PLAN ...
a simulator result with no run artifact to read"). A cleanup should read that
map before this page: it is the annotated census of `tools/device`, kept
current by a gate rather than by memory.

Two caveats, both measured on the clean tree at `a8260aa`:

- It is registered only in `tools/test.ts:440`, i.e. the explicit
  `npm run test:legacy:engine` lane — not in `test:contracts`, so the green
  edit lane never runs it.
- Run directly, it **exits 1 with 31 complaints**. 19 are real gaps (scripts
  added since the exclusion list was last extended: `bundle.ts`,
  `mask-calibrate.py`, `screen-calibrate.py`, `minus-3-plan.mjs`,
  `minus3-frame-light.ts`, `artifact-commands.ts`, `artifact-runner.mjs`,
  `emit.ts`, `seed-clock.mjs`, `closed-families.ts`, the five Companion
  entry points, `companion_device_lock.py`, `device-lock-exec.py`,
  `pan-path-capture.py`/`.sh`, `companion-mcp.mjs`, now `apps/desktop/src/`). The other 12 are the gate
  reading the wrong registry: it looks for gate registrations in
  `tools/test.ts` and `.github/workflows/ci.yml`, and 11 of those 12 gates are
  registered in `package.json`'s `test:contracts` /
  `test:device:calibration` instead — which CI does run, by script name. Only
  `test-hid-maskraise-probe.mjs` is genuinely unregistered.

That is itself an instance of this page's subject: two registries for "gates
that run" (`package.json` scripts and `tools/test.ts`), with a checker that
knows one of them.

**RESOLVED 2026-09-08.** `runs()` now reads all three registries
(`tools/test.ts`, `package.json` scripts, `ci.yml`), which retired the eleven
false complaints. `test-hid-maskraise-probe.mjs` — the one genuinely
unregistered gate — passes, and is now registered in `test:device:calibration`
beside its monitorraise sibling. The nineteen unwired scripts gained exclusion
rows whose reasons were each checked against the gate or caller they name;
three of them are honest `GAP:` rows (§22). The gate exits 0: "15 scripts
invoked, 111 exclusions across device/cue/dump, every gate reachable, nothing
unaccounted for".

It stays in the legacy lane by decision (Pedro, 2026-09-08), so it remains
advisory: adding an unwired instrument will not turn `test:contracts` red. Run
it directly, or via `npm run test:legacy:engine`.

While writing those rows the gate caught one of them: a reason that named a
not-yet-existent `test-screen-calibrate.py` was refused, because an exclusion
citing a gate that does not exist is the failure its header describes. The
control works.

## 14. Trace readers — binding: `NONE`

Nine readers of overlapping run telemetry: `clocktrace.mjs` (129),
`drifttrace.mjs` (211), `windtrace.ts` (85), `camtrace.py` (140),
`inputtrace.py` (484), `run-timeline.py` (478), `packages/review/bin/report/bench-trace.ts` (36)
over `packages/review/src/measure/bench-trace.ts`, `apps/trainer/test/tracereport.ts` (115),
`atrace-input.sh`. `run-timeline.py` and `drifttrace.mjs` both join plan
against phone on one clock.

## 15. Audio cue authorities — binding: `NONE`

Three "authority" implementations for one job — decide that a cue happened —
one per transport: `packages/propose/parked/minus7/cue/audio-authority.py` (552),
`bridge-audio-authority.py` (362, removed 2026-09-27), `esp32-audio-authority.py` (345, archived); plus the
phone-side `AudioAnalyzer.java` (365, removed 2026-09-27 with the Companion's audio path). The feature/decision chain behind them
is itself staged across `features.py` (190), `detect.py` (348),
`correlate.py` (177) and `evaluate.py` (250). Its shadow half,
`evaluate-shadow.py` with its window builder and model exporter, retired on
2026-09-30 ([archived routes](../ARCHIVED-ROUTES.md)).

## 16. Trainer bounded-input validator — binding: `NONE`

The same `fail`/`strings`/`freeze`/`object`/`number` validator kit is copied
into `apps/trainer/src/rhythm-highway.js:54` and `threat-constellation.js:52`
(24 shared windows — `strings` and `freeze` are verbatim), with a smaller
overlap between `adaptive-coach.js:24` and `microtrainer.js:46` (7). One
`validate.js` module under `apps/trainer/src` retires all of it.

**Correction: six copies, not two.** The clone detector found the two biggest
overlaps and I read that as the extent of it. Hashing each function body across
all of `apps/trainer/src` found the kit in **six** modules — `adaptive-coach`,
`arcade-lab`, `microtrainer`, `renderers`, `rhythm-highway`,
`threat-constellation` — 34 definitions of nine functions. A window-overlap
count is a lower bound on duplication, not a measure of it.

**RESOLVED 2026-09-08.** `apps/trainer/src/validate.ts` holds `isRecord`,
`finite`, `freeze` and a `validatorsFor(subject, { textMax })` factory for the
prefix-bound `fail`, `object`, `text` and `strings`. `fail` differed only in its
message prefix and `text` only in its cap (160 in two modules, 128 in four), so
both are parameters.

`number` and `integer` were left in place deliberately: their copies disagree on
more than a default — two modules admit negative numbers and bound their
integers, three do neither, and the two `integer` variants raise different
messages. Unifying them would change behaviour, so it is a decision, not a
side effect of de-duplication. `threat-constellation.js` also turned out to
define `strings` and never call it; that copy is simply gone. Net −122 lines
across six modules, with all six gates, the typecheck and the trainer bundle
green.

## 17. Same-name twins and orphans

| Twin | Lines | Verdict |
|---|---|---|
| `packages/review/src/stat.ts` / ~~`packages/review/src/stat.py`~~ | 129 / — | **Removed 2026-10-02.** No Python script imported `stat.py`; its only caller was the parity check in `stat.test.ts`. Unforced Python (CLAUDE.md, "Types"). |
| `packages/propose/bin/policy/closed-families.ts` / `tools/invent/closed-families.ts` | 70 / 134 | Two registers of closed policy families — device-plan surface vs privileged genome surface. Same register, two classifiers. |
| `tools/invent/search.mjs` / `packages/propose/parked/minus7/search.ts` | 248 / 189 | Two constrained searches; see §12. |
| `packages/propose/parked/minus7/cycle.ts` / `packages/propose/bin/minus-toys/cycle.ts` | 244 / 263 | Same shape, different route. `tools/minustoys/` holds **exactly one file**. **Decided 2026-09-08: keep.** One directory per route is the convention; a move would touch importers, the `TOOLS.md` row and the generated catalogs for no behaviour change, and Minus Toys is the live Night 5/6 route. |
| `packages/propose/src/policy/policy-ir.ts` / `packages/propose/bin/policy/policy-ir.ts` | 86 / 51 | Name collision only; see §9. |

## 18. Not duplication (checked, so a cleanup does not "fix" them)

- `packages/play/bin/companion/companion-setup.sh` (12), `companion-queue.sh` (7),
  `pan-path-capture.sh` (17) are thin serial-selecting wrappers that delegate
  to the same-named `.py`. `companion-queue.sh:1` states why it must *not*
  source `select-adb.sh`: enqueue and list have to work with no phone present.
- `packages/play/bin/phone/hid-sweep-probe.ts` / `.sh` are complementary: the `.mjs`
  emits the report stream, the `.sh` drives and measures the phone.
- The four `packages/core/src/*/ports.js` files are one port interface per
  concern (actuation, control, sensing, timing), not four copies.
- `index.ts` barrels across packages.

## 19. Stale authority citations

**RESOLVED 2026-09-08 in code.** `packages/propose/parked/minus7/policy.ts`,
`packages/propose/parked/minus7/constrainedsearch.ts`, `packages/propose/parked/minus7/sim.ts` and
`packages/propose/parked/minus7/search.ts` named `src/engine.js` as the mechanics authority — a
path that no longer exists. All four now name
`packages/source/src/games/fnaf2/plant-model.ts`.

Still open: several docs and plans cite the dead path too, and nothing catches
it. `tools/validate-references.ts` resolves `CONTRACT:`/`ADR:`/`CLAIM:`/
`EVIDENCE:` IDs, not file paths named in prose.

## 20. Remedies this repository has already proven

A cleanup should reuse one of these five rather than invent a sixth:

1. **Extract to one definition with a caller-supplied sampler.**
   `packages/play/src/sensors/screencap/nightpredicate.py` — "Is the office HUD on screen? One
   definition, three callers." Its docstring records the exact failure this map
   is for: the predicate existed in two copies until 2026-08-26, only one copy
   got a correction, and the stale copy still carried the docstring claiming it
   was frame-for-frame identical. The fix expresses boxes as **fractions** so a
   2400x1080 screencap caller and a 1280x576 video caller evaluate one rule.
2. **Cross-language spawn comparison.** `packages/review/test/stat.test.ts` imported the JS
   module and spawned `python3` against `stat.py` in the same test, until `stat.py`, which no
   script used, was removed on 2026-10-02.
3. **Shared JSONL vectors read from both languages.**
   `packages/kernel/test/contract-vectors.py` over `packages/source/test/fixtures/*.jsonl`.
4. **Equivalence gate between a model and its authority.**
   `packages/propose/test/reducedmodeltest.ts` (reduced model vs seeded `Sim`),
   `packages/propose/bin/policy/policy-equivalence.ts` (two compilers of one plan format),
   `packages/propose/test/legacy-equivalence.test.ts`.
5. **Enforced census with written exclusions** — the pattern that keeps an
   inventory from rotting into prose. `packages/review/bin/grade/test-grade-run-coverage.ts`
   (every script is wired, gated, or excluded *with a reason*) and
   `tools/test-docs.ts` (every page indexed, every tool script carries a
   `TOOLS.md` row, no stale row survives a deletion). This is the pattern this
   very page needs applied to it; see §21.

## 21. How this page was derived, and what it does not cover

Derived on 2026-09-08 from a token-window clone detector (normalized
code-bearing lines, 7-line windows, hashes appearing in ≥2 distinct files) over
all 453 tracked `js/mjs/ts/py/sh` files, plus responsibility greps (direct
`adb` invocation, `screencap`, input emission, PNG decode, frame loaders, CLI
shape) and cross-language name matching. Line numbers and counts are against
`a8260aa`, i.e. **before** the 2026-09-08 pass; sections carrying a RESOLVED
note have moved since.

**This page is hand-maintained, which is the weakness it documents.** The
detector was a throwaway script, so nothing recomputes the clone-window
numbers, and nothing notices when a family gains a sixth member. That is the
same failure as the register in
[`generated/duplicate-responsibilities.json`](generated/duplicate-responsibilities.json)
and as the two indexes `tools/test-docs.ts` was written to stop. Promoting the
detector into `tools/` — with its `tools/TOOLS.md` row, and a check that every
family here still has the membership it claims — is the difference between this
page being a map and being a snapshot. Until then, re-derive before trusting a
count.

Not surveyed: `apps/trainer` beyond §16, the `tools/cue` detection chain beyond
§15, the 39-file Java overlay/capture family beyond §3, the 147 test-shaped
files as a family of their own, and `packages/source/decompile` / `tools/recompile`. For
`tools/device` specifically, the `EXCLUDED` map in
`packages/review/bin/grade/test-grade-run-coverage.ts` is a more complete per-script census
than anything here, and it is gate-enforced; read it alongside §13.

Ownership rules that decide most of these questions live in
[`README.md`](README.md) and [`../../CLAUDE.md`](../../CLAUDE.md); shim
lifecycles and removal gates live in [`COMPATIBILITY.md`](COMPATIBILITY.md);
the command surface is [`../../tools/README.md`](../../tools/README.md).

## 22. Open gaps

The 2026-09-08 pass left these named rather than fixed. The first three are
cited by name in `packages/review/bin/grade/test-grade-run-coverage.ts`'s exclusion rows,
which point here — so this list is load-bearing, not a wish list.

- **`packages/play/bin/calibrate/screen-calibrate.py` has no gate.** The only one of the five
  calibrate fitters without one; `test-screencheck.py` drives
  `build-screen-model.py` and `replay-screen-model.py`, not this. It fits a rule
  that adapters consume on device. Because nothing can prove a change to it, it
  was excluded from §4's CLI consolidation — so it is now also the one fitter
  still carrying its own copy of the shared argparse block. A synthetic-frame
  gate modelled on the maskOn fitter's closes both.
- **`tools/device/artifact-runner.mjs` has no gate.** Its only invoker is
  `trial.sh:56`, a compatibility-lifecycle launcher in `legacy-paths.json`. A
  legacy caller is not coverage, so the modern path does not exercise it.
- **`tools/device/seed-clock.mjs` has no gate and no caller** in the
  repository.
- **Docs and plans still cite `src/engine.js`.** §19 fixed the four code files.
  `tools/validate-references.ts` resolves stable IDs, not file paths in prose,
  so nothing catches the rest. A path-reference check would.
- **The calibration JSON summary dict is still duplicated** across the fitters
  (§4). It reads each fitter's own fit result, so sharing it wants a small
  shared result type first.
- **Gen 1 vs `sensor.py`** (§1): whether the calibration fitters should read
  frames through `sensor.py`'s declared-sensor refusal, or whether gen 1 is the
  calibration-time reader and gen 2 the run-time reader, is still unstated.
- **This page does not recompute itself** (§21). That is the gap that makes
  every count above a snapshot.
