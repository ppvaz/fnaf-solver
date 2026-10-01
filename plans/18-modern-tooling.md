# Modern tooling that pays for a documented failure

**Status:** proposed 2026-08-28. Nine mandatory packages, each independently
shippable and each tied to an incident this repository already paid for. No
package adds a runtime dependency to the trainer or a build step to the page.

## Why this plan exists

Plan 07 consolidated the instruments the repository *has*. This plan adds
tooling the repository *lacks*, and the bar for inclusion is the same one
`CLAUDE.md` sets for everything else: a favourable idea is not a result until it
is tied to something that already went wrong. Every package below names that
incident. Nothing here is "best practice" for its own sake.

The constraints are real and non-negotiable:

- **No `node_modules`.** The engine and its suite run on bare `node` with no
  `package.json`. Anything for the JS side is either a `tsc`-only check (no
  emit, no bundler) or a single vendored file with a recorded provenance.
- **Explainability over accuracy.** The hand-built classifiers are auditable
  frame by frame, and `CLAUDE.md` values that. No package replaces one with an
  opaque model.
- **Instruments are not a pipeline.** Any new `tools/device` script is wired
  into `grade-run.sh` and pinned by `test-grade-run-coverage.mjs` in the same
  commit, or it does not land.
- **Retractions stay.** A package that closes as a recorded negative closes;
  the reasoning is kept.

## Package 1 — `shellcheck` in CI, with the documented footguns as fixtures

**Incident.** `CLAUDE.md` records three shell bugs that reached a recorded
night: `cmd | tr ... | grep -q` reading false under `pipefail` (skipped the
Bluetooth-audio guard twice, two nights of silence); `dumpsys window | grep -m1
mCurrentFocus` matching the transient `null`; `GRADE_RUN=1` grading `"$OUT.mp4"`
when every aborted run writes `"$OUT-aborted.mp4"` (a step that "silently grades
nothing"). 51 tracked `.sh` files, zero static analysis.

**Work.**
- Add `shellcheck` (pinned) as a CI step over every tracked `.sh`. Each script
  passes clean or carries an inline `# shellcheck disable=SCxxxx` with a
  one-line reason.
- Add a `bats` (or plain-shell) regression that reproduces each of the three
  footguns and asserts the fixed behaviour: the `grep -q` streaming guard via a
  herestring, the multi-line `mCurrentFocus` match, the missing-input step that
  must fail loudly.

**Done when.** Reintroducing `adb ... | tr ... | grep -q` as a streaming guard
fails CI at the line; every tracked `.sh` is `shellcheck`-clean or annotated;
the three fixtures are in the suite.

**Critical-tier foundation landed 2026-08-30.** Sourced driver fragments now
declare their Bash context, the one ShellCheck parse/expansion error in the
menu regression is fixed, and the production `dumpsys`/focus guards no longer
use an early-exit `grep -q` pipeline. `test-shell-footguns.sh` reproduces the
pipefail/SIGPIPE failure, the multiline-focus case, and loud missing-input
grading. CI pins ShellCheck `v0.10.0` and runs its error tier. The broader
warning/style cleanup and full clean-tier claim remain open.

## Package 2 — Type-check the engine with `tsc --checkJs`, no emit

**Incident.** The `night = 6` default that "would have priced a Night 3 plan
against Night 6's AI table," and the single `throw` that conflated *reachable*
(from the sourced `C.canAct` table) with *sampled* (one seed happened to show
it). Both are discriminated-union bugs that a structural type would have made
unrepresentable.

**Work.**
- `tsconfig.json` with `checkJs: true`, `strict: true`, `noEmit: true`,
  scoped to `src/*.js` and the engine-side `tools/*.mjs` (not the browser
  drivers).
- JSDoc `@typedef`s for the load-bearing shapes: a `Plan` that *requires*
  `night`, an `AiTable` indexed by night, the semantic action layer from
  plan 16 package 1.
- `tsc --noEmit` runs in CI and in `node tools/test.ts --engine`.

**Done when.** A plan object without `night`, or a `night = 6 ??` default in a
downstream consumer, is a compile error; the engine suite stays green; no
`.js`→`.ts` rename and no bundler enters the tree.

## Package 3 — A statistical-honesty helper, wired into the gates

**Incident.** The shipped Night 6 plan was quoted as "46/100 under human slack"
from 2026-08-25; over 1200 seeds it was 449/1200 = 37.4% against a 40% contract,
"with only five of twelve 100-seed blocks clearing it" (binomial SE 4.8 points).
Separately, "a detector reporting 22 thuds ... all 22 were false positives" —
`CLAUDE.md` §"Numbers need their control".

**Work.**
- A small module (`packages/review/src/stat.mjs` + a Python twin): Wilson score interval,
  required-N for a target half-width, two-proportion test.
- `human-gate.mjs` and every `*test.mjs --assert` print `rate [lo, hi] n=…`
  and refuse a bare pass/fail verdict when the interval straddles the contract
  bar — they report `INCONCLUSIVE(n too small)` instead.
- Backfill: re-quote the six-night ladder and the death-census splits in
  `PROGRESS.md` and `CLAUDE.md` with their intervals.

**Done when.** No `*test.mjs --assert` or gate can emit a rate without its
interval; a contract-straddling result is `INCONCLUSIVE`, never silently a
pass; the ladder in the docs carries intervals.

**Foundation landed 2026-08-30.** `packages/review/src/stat.mjs` and its Python twin now
provide Wilson intervals, bounded required-N planning, two-proportion z tests,
and explicit PASS/FAIL/INCONCLUSIVE contract verdicts. `test-stat.mjs`
cross-checks both implementations. `human-gate.mjs` and the night matrix now
use the interval-aware verdict and print the interval; the remaining work is
to migrate the other assertion CLIs and backfill every historical ladder and
death-census quotation.

## Package 4 — A minimal property-based harness for the engine invariants

**Incident.** Worst-case seeds are currently found by brute-force `--worst`
scans that report *a* failing seed, not a minimal one. `Sim.snapshot()/restore()`
bit-identity, RNG determinism, and "Night 1 cannot arm Balloon Boy" (the fact
one `throw` got wrong) are asserted only on fixed or swept seeds.

**Work.**
- A ~150-line local generator+shrinker (or one vendored single-file library
  with its version and hash recorded in `tools/TOOLS.md`), no `node_modules`.
- Express as properties, with automatic shrink to a minimal failing seed:
  snapshot/restore round-trips bit-identically after N random actions; two runs
  on the same seed produce identical frame traces; the reachable-threat set on
  Night 1 never includes Balloon Boy for any seed.
- Wired into `--engine`.

**Done when.** Each property runs in the engine suite and, on an injected
regression, prints a minimal failing seed rather than the first one hit.

**Bounded foundation landed 2026-08-30.** `packages/source/test/propertytest.ts` runs a
reproducible 64-seed campaign without a dependency, shrinks a failing seed to
the first failing seed in that campaign, and covers snapshot/restore
bit-identity plus continuation, same-seed event determinism, and the sourced
Night-1 exclusion of Balloon Boy. It is wired into the engine suite. Broader
randomized state/action generation and a larger proof campaign remain open.

## Package 5 — On-device input-dispatch trace (`atrace` / Perfetto)

**Incident.** The entire 240 → 133 → "33 ms contacts register" sequence in
[`docs/device/HID-MULTITOUCH.md`](../docs/device/HID-MULTITOUCH.md) is inferred
from *rendered video* — button-highlight walks at 60 fps. `CLAUDE.md` still
carries the open item: the last-flash mechanism "is not yet established ... the
control that separates 'never sent' from 'sent and swallowed' is the HID
trace," and even that only audits what the phone was *sent*.

**Work.**
- `packages/play/bin/probe/atrace-input.sh` (or a Perfetto config) capturing `input`,
  `view`, `sched` around a run; `packages/play/bin/probe/inputtrace.py` that reports each
  `MotionEvent`'s dispatch timestamp and the `Choreographer` frame it landed on,
  from the device's own trace.
- Cross-check against `dumpsys SurfaceFlinger --latency` for frame timing that
  needs no video decode.
- Wired into `grade-run.sh` and `test-grade-run-coverage.mjs`.

**Done when.** One recorded camera sweep has every camera-select `MotionEvent`
placed on its landing frame from the device trace, and `HID-MULTITOUCH.md`
carries the dated result — confirming or refuting that a 33 ms contact at
133 ms spacing produces a distinct accepted event.

**Spike result, 2026-08-28 (Moto g56 5G, `<serial>`, Android 16 / SDK 36,
`user` build, `ro.debuggable=0`).** The gating question — can the `shell` user
capture input dispatch without root — is answered **yes**. `adb shell perfetto
-t 6s -b 32mb input view wm gfx sched freq sync` wrote a 767 KB trace with the
`linux.ftrace` source active (`sched_switch` present) and the full input path
readable:

- `publishMotionEvent(inputChannel=<pkg>/<activity>, action=DOWN)` — the
  per-channel dispatch point, one slice per receiving window;
- `deliverInputEvent src=0x1002 eventTimeNano=648565000000 id=0x5524c741` —
  nanosecond event time and a stable event id;
- `prepareDispatchCycleLocked(inputChannel=…, id=0x…)` /
  `startDispatchCycleLocked` / `finishDispatchCycle` — the `id` is the
  correlation key between a dispatched event and the cycle that consumed it;
- `Choreographer#doFrame <frameId>` with `onVsync` — the frame side.

Injected events (`input tap`) show `deviceId=-1`, so a real `/system/bin/hid`
contact is distinguishable from an injected one in the same trace. FNaF 2 is
installed as `com.scottgames.fnaf2`.

**Next.** Host-side parsing needs Perfetto `trace_processor` (the `perfetto`
pip package's `TraceProcessor`, or the prebuilt `trace_processor_shell` —
pin whichever in Package 9). Then: capture one real camera sweep from
`trial.sh`, join `deliverInputEvent.eventTimeNano` → `finishDispatchCycle` →
the enclosing `doFrame`, and check whether each 33 ms / 133 ms selection
produces its own consumed event on its own frame.

**Host/capture foundation landed 2026-08-30.** `packages/play/bin/probe/atrace-input.sh`
now brackets a device command with a flush-safe phone-side Perfetto trace,
refuses to overwrite evidence, defaults to all-app ATrace categories, and can
optionally retain a `SurfaceFlinger --latency` dump. `inputtrace.py` queries
the resulting trace without making `trace_processor` a repository dependency;
it correlates enclosing or equal-cardinality chronological app delivery
slices, event IDs, device-vs-injected identity, and candidate frame landing,
and exits `3` on no app events. `grade-run.sh` reports and grades the artifact
when present, while the parser has phone-free coverage and the wrapper's
shell boundary is syntax-checked.

**Live follow-up, not closure (2026-08-30).** Three Continue/Night 2
select-only probes produced valid Perfetto files and video-visible light
attempts, but the video gate accepted only 4/5 sweeps in the first probe and
0/1 in each of the two shorter probes. None of those traces contained app
`MotionEvent` dispatch/delivery rows; `inputtrace.py` therefore reports
`NO APP EVENTS` rather than treating the video as dispatch proof. The earlier
2026-08-28 positive trace remains recorded above. Reproduce that positive
capture configuration, then join direct-HID events to actual frame-timeline
landings before closing Package 5.

## Package 6 — A `scrcpy` capture path, priced against `screencap`

**Incident.** `screencap` costs 225 ms against "roughly 680 ms free" per cycle;
adding one every four cycles "was enough to truncate the wind and collapse the
box from 52% to 10%." Separately, the withdrawn `sweepcheck.py` result and the
`camtrace.py` fps ambiguity both came from decoding a recording at a *guessed*
frame rate.

**Work.**
- `tools/device/scrcpy-capture.sh` producing a timestamped H.264 stream;
  a sampler that feeds `camtrace.py` / `sweepcheck.py` from real PTS rather
  than an assumed fps.
- Measure the marginal cost of a frame sample against the cycle budget and
  against `screencap`.
- Wired into `grade-run.sh` and its coverage test.

**Done when.** A night can be graded from a scrcpy recording with no
`screencap` in the cycle, the fps-decode ambiguity in the two analyzers is gone
(native PTS), and the cost lands in `HID-MULTITOUCH.md` /
[`docs/device/ON-DEVICE-VALIDATION.md`](../docs/device/ON-DEVICE-VALIDATION.md).
If scrcpy's own capture latency or jitter makes it unusable for timing work,
that is the recorded negative that closes this package.

## Package 7 — Pin the Python toolchain (`uv` + `ruff` + type-check) in CI

**Incident.** CI installs Pillow with an inline `pip install pillow==12.3.0`
because "the runner image ships no Pillow ... a red build that said nothing
about the code." 61 Python instruments, no lockfile, no lint, no type-check —
against a codebase whose failure mode is a classifier silently reading the
wrong thing.

**Work.**
- `pyproject.toml` + `uv.lock` pinning Pillow, `mmfparser`, and anything else
  imported; CI runs `uv sync` in place of the inline pip line.
- `ruff check` and a type-check (`pyright` or `mypy`, pinned) over
  `tools/**/*.py`; each passes or carries an annotated ignore.

**Done when.** CI builds the Python environment from the lockfile; `ruff` and
the type-check are CI steps; the inline `pip install` is deleted.

## Package 8 — Executable documentation: `test-docs.mjs` checks quoted numbers

**Incident.** `CLAUDE.md` §"Retractions stay" exists because conclusions here go
stale and *contradict* the running code — the withdrawn 240 ms figure was
"stale by two days"; a music-box constant was wrong by 3.3×; a gate row was
"authored stale on the day the file was created." `test-docs.mjs` already checks
that links resolve; it does not check that numbers do.

**Work.**
- A tag convention in prose:
  `<!-- check: node tools/device/deathchart.mjs --night=6 -> foxy 342 +/-15 -->`.
- `test-docs.mjs` (or a sibling in `--engine`) runs the command and asserts the
  range. Withdrawn/retracted notes are exempt by construction — they are dated
  history, not live claims.
- Tag the highest-churn claims first: the six-night ladder, the death-census
  splits, the `windtrace` box floor.

**Done when.** Moving a sourced constant that shifts the ladder turns CI red at
the doc line quoting the old number; retraction blocks are never flagged.

## Package 9 — A devcontainer / Nix flake pinning the whole toolchain

**Incident.** The global working agreement says "Docker is the dev
environment"; this project does not follow it, and CI has hit `ModuleNotFound`
(Pillow) and would hit "javac moved" if the JDK were unpinned. Every device
number also assumes one host's `adb`/`ffmpeg`.

**Work.**
- `.devcontainer/` (or `flake.nix`) pinning node 22, python 3.12, JDK 17,
  `adb`, `ffmpeg`, `scrcpy`, `shellcheck`, `ruff`, `uv`.
- CI derives its versions from the same pin.

**Done when.** From a clean checkout inside the container,
`node tools/test.ts --engine`, `packages/play/bin/companion/test-query-companion.sh` and
`packages/play/bin/companion/test-soak-companion.sh` all pass; CI and local report the same
tool versions.

## Suggested execution order

1. **Package 1 (`shellcheck`)** and **Package 5 (input trace)** first — they
   address currently-open items, not hardening. Package 1 is a day; Package 5
   answers the `DEVICE_SPACING_MS` mechanism question that three retractions
   have circled.
2. **Package 2 (`tsc`)** and **Package 7 (`uv`/`ruff`)** next — static safety
   nets, no behaviour change, low risk.
3. **Package 3 (stats)** and **Package 8 (executable docs)** — they enforce
   `CLAUDE.md` rules that are currently cultural.
4. **Package 6 (`scrcpy`)** and **Package 4 (PBT)** — larger, and each may close
   as a recorded negative.
5. **Package 9 (devcontainer)** last — it pins whatever the earlier packages
   settled on.

## Done when

- every tracked `.sh` is statically checked and the three documented footguns
  have regression fixtures;
- the engine type-checks, and a plan without a named night does not compile;
- no gate or `--assert` tool emits a rate without its confidence interval;
- the engine invariants (snapshot identity, determinism, Night-1 reachability)
  are property-checked with shrinking;
- the phone's own input-dispatch trace has answered whether a 33 ms / 133 ms
  camera selection is accepted, dated into `HID-MULTITOUCH.md`;
- a night can be graded without a `screencap` in the cycle, or scrcpy is a
  recorded negative for timing;
- CI builds both toolchains from lockfiles and runs `ruff` + both type-checks;
- `test-docs.mjs` fails on a stale quoted number, not only a broken link;
- the three canonical checks pass from a clean checkout inside the pinned
  container.
