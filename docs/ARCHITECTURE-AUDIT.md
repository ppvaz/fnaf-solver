# Architecture audit, 2026-08-26

A survey for cross-cutting structural problems of the same weight as the two the
repository owner had already found himself: `plans/15` (the same game fact is
re-taught per capture method) and `plans/14` (every device number describes one
handset). Both have one shape — *a thing that should be defined once is instead
re-derived per context, and nothing detects when the contexts disagree.*

This document reports the others. It fixes nothing.

Ranked by expected cost to the mission: **clearing all campaign nights and
Night 7 10/20 on a stock Android phone.** Findings 9–10 do not affect that
mission and are marked so they can be deprioritised rather than silently
carried.

Line numbers in `trial.sh` were read on 2026-08-26 while other streams
were editing it; they may have shifted by a few lines. Every other citation was
verified directly.

---

## 1. The model gate passes on its seed block, not on the model

**Measured, not inferred.** `human-gate.mjs` evaluates the plan on seeds
1..`GATE_RUNS` with `GATE_RUNS = 100` (`packages/propose/bin/plans/human-gate.mjs:45,108`).
`test-human-gate.mjs:77-79` asserts the shipped Night 6 plan clears
`GATE_MIN_SURVIVAL = 0.40` on exactly that block, and CI runs it.

I replayed the shipped plan through the same `jitterPlan` + `replay` path the
gate uses, varying only the seed block:

| seeds | survived |
|---|---|
| **1–100 (the gate's own block)** | **46/100 — passes** |
| 101–200 | 36/100 — fails |
| 201–300 | 29/100 — fails |
| 301–400 | 27/100 — fails |
| 401–500 | 53/100 — passes |
| 501–600 | 39/100 — fails |
| 601–1200 | 219/600 |
| **pooled 1–1200** | **449/1200 = 37.4%** |

The 46/100 in CLAUDE.md reproduces exactly, which confirms the harness is
faithful. But the plan's true rate under the gate's own error model is **37.4%
(95% CI roughly 34.7–40.1%), below the 40% contract.** Ten of twelve blocks
fail it. The route passes because the gate looks at one of the two blocks that
happen to clear.

This is the repository's own "Numbers need their control" lesson applied to the
single number that authorises touching the phone. CLAUDE.md calls the gate
"absolute, no override" and says it "grounds **every current device route**".
It currently grounds a route that does not meet its own bar.

Two smaller things fall out of the same file. `human-gate.mjs:25-27` states that
`0.40` is "the replay contract `test-runner-plan.mjs` already holds" — but
`test-runner-plan.mjs:196-212` requires `survived === RUNS`, i.e. 300/300 at zero
jitter. Two different contracts, one cited as the provenance of the other. And
`recipe.mjs`'s `TEMPLATE_SEED = 7` (`recipe.mjs:152`) is inside the gate's
evaluation block, so the plan is cut from a night it is then graded on.

**Cost:** the highest of anything here. Every device claim downstream inherits
it, and Plan 12's ladder starts from a gate that is not measuring what it says.

**Recommendation: quick fix.** Raise `GATE_RUNS` to at least 1000, and have the
gate print the survival interval rather than a bare fraction. Expect
`test-human-gate.mjs` to go red — that is the correct outcome and the real
finding. Move `TEMPLATE_SEED` outside the gate block while you are there.

**Resolved 2026-08-26.** `GATE_RUNS` is now 1200. The widened gate first did go
red at 449/1200. The route then restored an omitted Foxy reset by carrying the
first post-read hall contact on the existing `maskraise` row; the same fixed
sample is now **673/1200 = 56.1%**, with the 40% contract unchanged. The old
block table remains above as the evidence for widening the sample.

*Negative control, so nobody re-derives it:* I checked whether the contiguous
block 1..100 is a biased sample of the Fusion LCG's state space. It is not. The
map `s -> (s*31415+1) mod 2^16` decomposes into exactly 4 cycles of 16,384, and
seeds 1..100 hit them 25/25/25/25 — identical to the spread seeds
`i*2246822519` the search tools use (`packages/propose/parked/minus7/cyclesearch.mjs:87`). The seed block
is unbiased; it is simply too small.

---

## 2. The alive/dead predicate has four copies, and they have already diverged

`screenstate.py` was corrected **today** (2026-08-26): the night predicate had a
false positive on the "HELP WANTED" newspaper that FNaF 2 plays when a New Game
starts, because it is bright everywhere and clears the flashlight-meter test.
The fix is `GLOBAL_BRIGHT_MAX = 80.0` plus two extra scanlines (rows 500/700),
and the docstring records it at `packages/play/src/sensors/screencap/screenstate.py:1-25,36-42`.

The predicate exists in four places. Only two got the fix:

| copy | location | brightness guard |
|---|---|---|
| A | `screenstate.py:92-93` (`--adb-fast`) | **yes** |
| B | `screenstate.py:137-138` (PNG path) | **yes** |
| C | `grade-night.py:66-70` | **no** |
| D | `death-census.py:53-55` | **no** |

Copy C's docstring reads, verbatim: `"""screenstate.py's live predicate, frame
for frame."""` It is not, as of today. It samples no global-brightness rows at
all.

`grade-night.py` is what `grade-run.sh:110-115` labels **"survival (the only
number that is a run length)"** — the instrument that exists *because* nights
6-36 and 6-37 were reported at 163 s and 153 s and graded at 26.0 s and 72.2 s.
And `screenstate.py`'s own docstring names why the gap became reachable:
*"plans/13 needs that route for the fresh-save ladder."*

So the moment the campaign runner presses New Game — which the mission requires
for every story night — the authoritative survival number will count the
newspaper cutscene as a running night. That is the 163 s failure recurring
inside the tool written to prevent it, on the exact route the next mission phase
depends on.

Copies A and B also disagree on box extents inside the same file (maskbar
1004–1044 vs 1000–1045; flash 45–85 vs 40–95), despite `screenstate.py:17-19`
claiming "both paths answer alike". Nothing tests any of it: `test-screenstate.py`
exercises only copy B, and `--adb-fast` — the live watchdog path — is never run.

**Cost:** very high, and it fires on the next thing the mission does.

**Recommendation: quick fix.** Port `GLOBAL_BRIGHT_MAX` to `grade-night.py` and
`death-census.py`, reconcile the two box sets in `screenstate.py`, and add one
fixture-based test asserting all four copies answer alike — including the
newspaper frame. The structural half (one fact, four sensor-bound readers) is
already `plans/15`'s package 3; this is the drift that cannot wait for it.

**Resolved 2026-08-26 (`8a9925b`), and the count above was wrong: there were
five copies, not four.** `nightpredicate.py` holds the rule in fractions of the
frame and the caller supplies a sampler. It had already taken over
`grade-night.py` and `screenstate.py`'s PNG path, and `plans/PROGRESS.md`
recorded this finding as resolved on that basis. It was not. Two callers still
stated the rule, and the worse of them is one this document undercounted:

- **`screenstate.py`'s `--adb-fast` path** — copy A, the *live* watchdog that
  decides whether the phone is still in a night — kept its own thresholds. The
  table above lists copy A as having the guard, which was true of the guard and
  false of the rule. It is the copy this finding itself noted "is never run".
- **`death-census.py`** kept the pre-guard form, so it read the New Game
  newspaper as a running night. Harmless over the `n6-night-*` corpus and wrong
  on the fresh-save route `plans/13` needs.

Both now evaluate `nightpredicate.is_night`. The fast path additionally refuses
at startup when its hand-picked scanlines stop covering a region of the rule —
which is exactly how the global-brightness rows came to be missing from it.
`screenstate.py` and `death-census.py` guard their main under `__name__`,
because neither could be imported: importing `screenstate.py` ran it and
blocked on stdin, which is *why* the live path had no test.

`test-screenstate.py` now asserts all four callers agree at both geometries and
forbids any other file in `tools/device` from restating the rule's thresholds.
That structural half is what found copy A — the agreement test alone would not
have, because nothing was calling the live path to disagree with.

---

## 3. `grade-run.sh` prints "every instrument passed" for instruments that measured nothing

The pipeline exists because a grading step graded a file that did not exist and
read as coverage. Seven paths through it still do:

- **`missing` is dead.** `grade-run.sh:54-56` computes it and never reads it
  (verified by grep; the only other hits are prose). A missing HID trace prints
  `hid trace: MISSING`, then `grade-run.sh:130-143` silently skips both the
  input-defect auditor and `desync-scan.py` — the two instruments CLAUDE.md
  singles out as the only ones that see the monitor desync that "inverts the
  rest of the night". `fail` is never set. Verdict: every instrument passed.
- **`sweepcheck.py:96-111`** appends a sweep only when the light actually
  exceeded threshold. If it never did, `sweeps == []`, `ok(0) < len(0)` is
  false, and it prints `summary: 0/0 sweeps flashed all of 10,4,7` and exits 0.
  The one answer this tool must not pass. No test covers it — there is no
  `test-sweepcheck.py`.
- **`camtrace.py`** can only exit non-zero via `--expected`
  (`camtrace.py:126-127`), which `grade-run.sh:148` does not pass. The "camera
  selections" step cannot fail.
- **`packages/propose/parked/minus7/cue/detect.py:279-284`** places the `if not refs` guard *before* the
  `--only` filter. `scan-night.sh:79` always passes `--only 17`. If `s0017.wav`
  is missing while other refs are present, `refs` is empty after the filter and
  nothing re-checks; the scan prints a complete, correctly formatted bang report
  — `(0 of 0 band candidates confirmed)`, `(nothing above threshold)` — from
  zero comparisons, and exits 0. CLAUDE.md trains the reader to read that zero
  as "no bang above about −12 dB". This is the 22-false-positive lesson with the
  sign flipped.
- **`windpct.py:129-131`** and **`grade-minus7.py:142-145`** return 0 on "no
  music box detected" / "0 camera intervals".
- **`grade-run.sh:32-34`** has no `*)` arm, so `--require-second` or
  `--require-seconds=420` silently drops the only flag that turns the survival
  step into a gate.
- **`trial.sh:760`** discards `grade-run.sh`'s exit status with `|| true`.

`test-grade-run-coverage.mjs` enforces that every instrument is *wired in*. It
does not enforce that a step can *fail*, which is where all of the above live.

**Cost:** high. This is the layer every published device number is read off.

**Recommendation: package in `plans/07`.** Plan 07's own "Done when" already
states the contract — *"every command labeled **check** can be made to exit
nonzero through a controlled failing assertion"* — and the audit shows it is
false for at least four instruments while the plan is marked "correctness pass
complete". The package is: give every instrument a zero-measurement refusal,
make `grade-run.sh` fail on a skipped step rather than omit it, and extend
`test-grade-run-coverage.mjs` to assert each step is reachable-failing.

---

## 4. `desync-scan.py`'s alignment returns its own search bound

`tools/device/desync-scan.py:223-243`. `align()` sweeps candidate offsets and
keeps the best `(hits, -err)`. There is no `hits == 0` guard and no interiority
check, and the comparison at line 241 is strict — so when nothing lines up,
every candidate scores `(0, 0.0)`, `best` stays at the first one, and the
function returns `anchor - 0.4 s`: **the lower search bound, presented as a
measured offset.**

Reachable two ways: `presses()` collects both monitor and mask rows, so a
mask-only trace yields an empty `monitor_times` while `scan()`'s guard still
passes; and a badly desynced run produces no edge inside the 0.15–0.65 s lag
window by construction — precisely the case the tool is for.

A 400 ms phantom offset shifts every window by more than the 367 ms flip
animation the whole method is built around. `off` is the sole time base for
`walk()`, `window_state()`, `blame()` and `strip()`, and `grade-run.sh:141-143`
runs this as a gate. CLAUDE.md: *"only `desync-scan.py` says what the game
did."*

This is the same shape as the displacement matcher caught today returning its
own search bound.

The irony is that this file abstains correctly everywhere else — `window_state`
requires ≥3 samples and an 80% majority or returns `None`; `cams()` maps
`hall-candidate` to `None` with the reasoning in the docstring. The alignment is
the one step with no refusal. A second, smaller instance sits at line 307:
`return missing[0] if missing else suspects[0]` names a lost press even when
every suspect landed.

**Cost:** high — it is the highest-authority instrument the repo owns.

**Recommendation: quick fix.** Refuse when `hits == 0` or when the winning
offset saturates the search bound, and return `None`/exit 3 with a reason rather
than a number. Add "the divergence is real but unattributable" as an outcome of
`blame()`.

**Resolved 2026-08-26.** `align()` now refuses a trace with no monitor presses,
a recording with no confident state edges, zero press/edge matches, or an
optimum on either search boundary. `scan()` reports the alignment as `UNKNOWN`
and exits 2 before walking or attributing any interval. `blame()` now returns no
culprit when every suspect has a plausible edge, and the report distinguishes
that from “no divergence”. The built-in suite covers all three former invented-
offset cases, an interior positive control, and the unattributable divergence.

---

## 5. The screen-model builder's defaults produce a classifier that cannot say `unknown`

`tools/device/build-screen-model.py:199-200` defaults `--max-score 255` and
`--min-margin 0`. `screencheck.c:528` refuses with
`best_score > model_max_score || margin < model_min_margin`. Template scores are
bounded at 255 and `margin` is unsigned, so under the defaults **both halves of
the refusal are unsatisfiable** — the live classifier can only ever emit a class
label.

`replay-screen-model.py` cannot catch it: it treats the output as an opaque
label and will happily print "all N holdout frames classified correctly" for a
model incapable of refusing. SCM1 binaries are gitignored and carry no
provenance, so there is no post-hoc audit of which models were built this way.

The documented invocations do pass thresholds
(`ON-DEVICE-SCREEN-CHECKS.md:140`, `ON-DEVICE-VALIDATION.md:583`), and
`test-screencheck.py` passes 20/5 — so the shipped models are fine. The defect
is that the *default* is "never refuse" and nothing declines to write such a
model. A never-refusing BB left-opening model turns every ambiguous frame into a
confident `empty`, no mask, and the documented **0/3000** BB-blind
configuration — while the run log reads normally.

**Cost:** high if it ever fires; currently latent.

**Recommendation: quick fix.** Make `--max-score`/`--min-margin` required, or
refuse to write a model whose thresholds cannot produce `unknown`, and have
`replay-screen-model.py` assert the model has a reachable abstain band. This is
the same check `title-observe.py:105-115` already performs on its own model
(`title-model-has-no-undecided-band`) — the pattern exists, it just was not
applied here.

---

## 6. Device constants are transcribed across three languages, and one already disagrees

The runner is shell, the emitter and the actuator model are JS, the graders are
Python, and shell cannot import JS. So every device constant is re-typed. The
repo knows: `trial.sh` carries the comment *"Designing to the floor is
how a 20 and a 33 end up meaning the same thing in two files and then quietly
stop agreeing"* — sixteen lines above one of the four copies of `33`.

| constant | copies |
|---|---|
| `FUSION_POLL_MS = 33` | `recipe.mjs:456`, `actuator.mjs:107`, `trial.sh`, **and `test-recipe.mjs:224`** — the test that gates the emitter holds its own copy, plus bare `33` literals at :184 and :199 |
| contact floor `100` | `recipe.mjs:20`, `test-hid-trace.mjs:22`, `actuator.mjs:106`, `test-device-input-gaps.mjs:65`, `trial.sh` ×2, `hid-sweep-probe.{mjs,sh}` |
| `MONITOR_ANIM_DOWN_MS = 367` | `actuator.mjs:105`, `trial.sh`, `test-device-input-gaps.mjs:63` — all hand-computed from `src/config.js:336` (22 frames). Note `test-device-input-gaps.mjs:55` **does** assert the derived UP value against `C.MONITOR_ANIM_UP`; DOWN, eight lines later, is a bare literal with no equivalent check, and `actuator.mjs` already imports `C` |
| mask→monitor seam `180` | `recipe.mjs:358` (`MASK_RAISE_GAP_MS`), `actuator.mjs:66` (`SEAM_SAFE_MS`), plus literals in `test-recipe.mjs:140` and `test-runner-plan.mjs:149` |
| lateness band 110–300 | `actuator.mjs:89-90` and `latenesssweep.mjs:84-85`, the latter labelled "actuator.mjs default band" and not importing it |

All of these currently agree. **One does not.** The HID axis transform
`rawX = (1080 − y) * 20 / 9` has three implementations with three rounding
rules: `hid-sweep-probe.ts:17` uses `Math.round`, `desync-scan.py:58` uses `//`
(floor), and `trial.sh` uses shell truncation. Computed over the real tap
table, they differ by one unit wherever the product is non-integral:

```
y=78  (TAP_MUTE)  exact 2226.67  JS 2227  Python/shell 2226   MISMATCH
y=730 (newGame)   exact  777.78  JS  778  Python/shell  777   MISMATCH
y=640 (sixthNight) exact 977.78  JS  978  Python/shell  977   MISMATCH
```

So the probe that measures what the phone accepts and the auditor that decides
what the game did are keyed to different coordinates for three of the taps.
Nothing compares them; `test-hid-sweep-probe.ts` tests only the JS copy.

Two adjacent traps worth naming in the same breath:

- `trial.sh` assigns `SWEEP_LIGHT_LEAD_MS=0` **twice** (lines 1798 and
  1869), each with its own justification comment. `test-plan-interpreter.sh:24-25`
  reads runner constants with `grep -m1`, so it asserts against line 1798 while
  the runtime value comes from line 1869 — under a header comment claiming
  *"Device constants come from the runner, never restated here."*
- The Companion read cost is **59 ms in some call sites and 42 ms in others**,
  in the runner, the actuator and two docs. `actuator.mjs:108-111` states the
  conflict openly and picks the pessimistic one; nothing else does.

**Cost:** moderate today (one live rounding disagreement), high as soon as any
timing constant is retuned — and PROGRESS names actuator lateness as the very
next thing to retune.

**Partly resolved 2026-08-26, and the rounding half was bigger than measured
above.** The table in this finding checks only `rawX` and only three taps. Run
over the whole coordinate set — `coords.sh`'s taps plus `desync-scan.py`'s
camera table, 39 points — and including the `rawY = x * 9 / 20` axis this
finding never checked, **24 of 39 coordinates disagreed**, not three. Among
them `cam11`, which `hid-sweep-probe.ts` actually sweeps: the probe that
measures what the phone accepts was sending a coordinate the runner never
sends, while the auditor that decides what the game did was keyed to a third.

`hid-sweep-probe.ts` now floors. The runner wins the tie because it is what
presses the phone, and the auditor must match the runner or it attributes
presses to the wrong control.

`packages/play/bin/phone/test-screen-map.ts` holds all three implementations to one
answer, evaluating the shell and Python forms in their own interpreters over
the real tables rather than restating them. It also pins the *truncation*, so
the check cannot be satisfied by changing all three copies to round together —
which would silently re-aim every coordinate this project has calibrated.

This is the shape this document's own closing section names as the sanctioned
answer: `sourcetest.mjs:533`'s second Fusion LCG, asserted bit-exact against
`src/rng.js`, is "the one duplication in the repository that is a *control*
rather than a hazard … the pattern findings 2 and 6 are missing." Shell cannot
import JS, so for a cross-language constant the control **is** the fix.

**Still open, and blocked rather than deferred:** the *timing* constants
(`FUSION_POLL_MS`, the 100 ms contact floor, `MONITOR_ANIM_DOWN_MS`, the 180 ms
seam, the lateness band) are still hand-copied, and closing them means editing
`trial.sh`, which was carrying a live device run. `test-plan-interpreter.sh`
reading runner constants by `grep -m1` is part of the same knot: the reason the
constants live in the runner at all is that the runner is the only thing all
three languages can read, and it can only be read by grepping it. A
`constants.sh` both the runner and the test source would break that knot, and
is the natural first cut of the file-size split recorded in the follow-up audit
below.

**Recommendation: package in `plans/14`.** Plan 14 already owns "every
device-facing number" and its package 2 makes a profile "the single source for
the values `coords.sh` currently hardcodes". Extend its packages 1–2 to cover
the *timing* constants and, critically, to name the mechanism it currently does
not mention: how a shell runner, a JS emitter and a Python grader read one
table. A second plan here would fight plan 14 for the same files.

---

## 7. Three test gates run nowhere, and four exclusions cite them as their justification

`test-grade-run-coverage.mjs:82` exempts any file named `test-*` on the stated
grounds "suite gates, run by tools/test.mjs". That comment is an unverified
assumption and it is false for five files:

| file | in `tools/test.mjs`? | in CI? |
|---|---|---|
| `test-session-manifest.sh` | **no** | **no** |
| `test-select-adb.sh` | **no** | **no** |
| `test-screencheck.py` | **no** | **no** |
| `test-query-companion.sh` | no | yes |
| `test-soak-companion.sh` | no | yes |

And the `EXCLUDED` reason strings name exactly those three as why a script is
not an instrument:

- `session-manifest.py` — *"gated by test-session-manifest.sh"*
- `session.sh` — *"gated by test-session-manifest.sh"*
- `select-adb.sh` — *"transport helper, gated by test-select-adb.sh"*
- `replay-screen-model.py` — *"(test-screencheck.py drives it)"*

So a script drops out of coverage by citing a gate that no automated run
executes. The reason strings are free text; nothing parses them, nothing checks
the named gate exists or runs. `session-manifest.py` and `session.sh` landed
today as plan 09's producer slice, and `grade-run.sh:88-90` gates the whole run
on the manifest they produce.

Second, narrower hole: the scan is `readdirSync(HERE)` — `tools/device` only.
`tools/cue/` is not subject to the rule, which is where finding 3's `detect.py`
lives and where CLAUDE.md's purest "instrument nobody runs" example came from.

**Cost:** moderate, and self-compounding — this is the one mechanism CLAUDE.md
points to as "this is now enforced".

**Recommendation: quick fix.** Have `test-grade-run-coverage.mjs` read
`tools/test.mjs`'s registry and CI's workflow, and fail when a `test-*` file is
in neither. Extend the directory scan to `tools/cue` and `tools/dump`.

**Resolved 2026-08-26.** Three of the five orphans had been wired in without
this finding being updated; `test-select-adb.sh` and `test-screencheck.py` had
not, and both still stood as the cited justification for an exclusion. Both are
registered in `tools/test.mjs` and both passed on the first run.

The `test-*` skip is no longer a `continue` under an unverified comment. The
gate reads `tools/test.mjs` and `.github/workflows/ci.yml` and fails on any
gate in neither, and — the half the recommendation did not name — it now
**resolves every `test-*` file an exclusion reason cites** and fails when that
gate does not exist or does not run. The reasons were free text that nothing
parsed, which is the mechanism that let four of them cite dead gates. The
directory scan covers `tools/cue` and `tools/dump`, with twelve sibling
exclusions written for the scripts there.

*Worth recording, because it is the finding in miniature:* the first version of
the "does this gate run?" check used a substring match, and its positive
control failed — a **comment** in `tools/test.mjs` naming `test-select-adb.sh`
satisfied the check while the registry entry was deleted. It now parses
registry entries only, for the same reason `grade-run.sh` is read
invocation-lines-only. A check a mention can satisfy measures documentation.

Not resolved by this, and left as its own finding: whether a step can be made
to *fail* (finding 3). Coverage and reachability are still different questions.

---

## 8. "The device runs nothing the model gate has not passed" is not true

CLAUDE.md states this as absolute, no override. Three things sit outside it:

- **`trial-maskcamp.sh` is a second device runner that never calls the gate.**
  It presses via `adb shell input swipe` from a hand-written inline schedule
  (`trial-maskcamp.sh:121-139`). No `human-gate.mjs`, no `HUMAN_FLOOR_MS`.
  `test-grade-run-coverage.mjs` excuses it as `'run launcher'`.
- **~370 lines of inline schedule remain in `trial.sh`** — the
  `HID_LEFT_SURVIVAL` route and the "Calibration opening" fallthrough, full of
  `press_at $((base + N))` literals. They are unreachable only because the host
  hardcodes two positional arguments, and **no test asserts those literals.**
  Meanwhile `test-runner-plan.mjs:21-22` slices its "no schedule literals in the
  driver" check to end exactly where those blocks begin, so the check runs on the
  one block that has none.
- **`test-human-gate.mjs:106-108`'s "no inline schedule fallback" check asserts
  that a prose phrase is absent** from the runner. Deleting the comment satisfies
  it. It says nothing about whether inline schedules exist. They do.

Related, and cheap: `PLAN_CONTACT_MS` and `PLAN_SPACING_MS` are parsed, threaded
to the device, **never read**, and then written into the v1 session manifest as
provenance. `validate-session.py` gates the manifest's shape, not whether its
`env` block describes the run.

**Cost:** moderate. The gate's coverage claim is load-bearing for Plan 12's
ladder, and a claim that is false in prose is worse than one that is merely
narrow.

**Recommendation: quick fix.** Delete the two dead inline routes, widen
`test-runner-plan.mjs`'s slice to the whole file, replace the prose-absence
check with a structural one, and either gate `trial-maskcamp.sh` or retire it.
Then restate CLAUDE.md's rule to match what is enforced — the live-press
exceptions (`monitor-verify`, `monitor-resync`, mute) are legitimate and should
be named rather than glossed.

**Partly resolved 2026-08-26.** Three of the five are done:

- **The dead inline routes are deleted** — 378 lines, `trial.sh` 3174 →
  2796. They were doubly unreachable: the host hardcodes `HID_LEFT_SURVIVAL=0`
  *and* the `NIGHT6_LEFT` block above them ends in `exit 0`. Nothing in the
  deleted region defined a function, so it was pure straight-line schedule.
- **`test-runner-plan.mjs` now scans the whole driver**, delimited by the
  heredoc rather than by `indexOf` of the block it was supposed to be checking.
  Verified as a positive control: run against the pre-deletion file, the widened
  scan reports the literals the old slice missed. It also forbids the
  `HID_LEFT_SURVIVAL` *branch* from returning, while leaving the positional
  parsed so both sides stay aligned on the wire.
- **The prose-absence check is structural**, matching the emitted
  `--device-plan "--night=$STORY_NIGHT"` invocation rather than the absence of a
  sentence that deleting a comment would have satisfied.

**Two remain, and one is new.**

- `trial-maskcamp.sh` is still ungated. It is an experiment harness rather than
  a policy pilot, and `run-batch.sh` plus four documents depend on it, so it was
  not retired on one session's judgement. It needs a decision: gate, port, or
  retire.
- `press_at`/`hold_at` still carry dead `async-swipe`/`fast-swipe` actuator
  arms, unreachable because the host pins `PRESS_MODE=hid-multi`
  (`trial.sh:194-196`). They decide *how* a press is delivered rather
  than *when*, so they are not a second copy of the schedule; removing them is
  its own change, deliberately not bundled with the schedule deletion.
- **New, and it makes this finding worse rather than better:** the live floor
  now stands down on the gated route (`NIGHT6_LEFT=1`), because its 350 ms
  scalar aborted the accepted plan at its own 120 ms compound boundary — a real
  device run died exactly that way (`RUN-TELEMETRY.md` §10). The scheduled
  presses are priced by the model gate, so that is defensible. But the
  *reactive* presses — `monitor-verify`, `monitor-resync`, `monitor-resync-2` —
  are in no plan, and are now priced by **nothing at all**. They inherit
  `MONITOR_ANIM_DOWN` (367 ms) of forced wait, which clears the old 350 ms floor
  by coincidence of the corrector's design rather than by any check.

  **Measured 2026-08-26: that margin is 50 ms.** The corrective `monitor-verify`
  lands 400 ms after the press before it, against the 350 ms floor that no
  longer runs. `test-plan-interpreter.sh` now pins it, so shortening the
  corrector's wait by 51 ms fails locally instead of delivering an unpriced
  press on the phone. Pinning is not pricing: the real fix is to route reactive
  presses through a check that knows they are unplanned, which needs the device
  in the loop and was deliberately not attempted blind.

CLAUDE.md's rule is restated to say all of this, which was the fifth item.

---

## Note: the tick rate is asserted twice and measured never

Not a finding of its own, because PROGRESS already names it as the next action —
but worth recording before that work starts.

The simulator runs at **60 FPS** (`src/config.js:23`), and every sourced
duration, camera stall, fuse and animation frame count is in 60ths.
`SOURCE-DUMP-GUIDE.md:316` calls it "the 60 fps assumption";
`ANDROID-SOURCE-STATUS.md:554` labels a derived figure `[INFERRED — sourced
constants, assumed 60 fps]`. The device side asserts **30 Hz** — "one 30 Hz
Fusion poll is 33 ms" — in `recipe.mjs`, `actuator.mjs`, `trial.sh`,
`HID-MULTITOUCH.md:659` and six tests, as though sourced. I could not find where
that 30 Hz was measured or derived.

They may both be right (render rate and touch poll are different things), but
nothing in the repo says so, and the difference is load-bearing in both
directions: at 60 Hz the emitter's enforced 33 ms gaps spend twice the cycle
budget they need, and the mission is short of exactly that budget; at 30 Hz a
"one-frame phase island" is not a thing a phone can land on. PROGRESS's next
step should establish the number before pricing anything against it.

Separately, and cheap to fix while there: `recipe.mjs` imports `C` but hardcodes
the literal `60` for frame↔ms conversion at lines 50, 256, 279, 390 and 597,
while `actuator.mjs:135-136` correctly uses `C.FPS`. And no instrument reads a
recording's real frame rate — there is no `ffprobe` anywhere in the repo.
`grade-run.sh` passes `--fps 60` to two graders, `camtrace.py` defaults to 30,
and `desync-scan.py` decodes at 30/20/4. A 30 fps default already produced one
withdrawn figure; the fix applied was to pass `--fps 60` at the call site, which
left the defaults in place.

---

## Findings that do **not** affect the mission

Recorded so they can be dropped rather than carried:

- **`pilottest.mjs:29-35`'s `OPENING` table** is a byte-for-byte copy of a dead
  `fast-swipe` branch and is stale against the shipped route. CLAUDE.md already
  flags `pilottest` as a research model, so this is documented drift — but the
  file's own header still asserts it replays "that exact table". A comment fix.
- **`packages/propose/parked/minus7/cue/evaluate.py:102-113`** takes an argmax with no threshold on a
  control window that by construction contains no cue. Offline harness; its
  docstring flags the false positives.
- **`grid-signature.py:156-159`** derives its abstain band from the frames the
  model was built on. It marks the result `PROVISIONAL` and `cmd_test` prints
  "NOT VALIDATED", so the caveat travels.
- **`collect-cue-audio.sh`** accepts `0` rounds and reports success, where its
  siblings `soak-companion.sh:20` and `bench-screencheck.sh:21` both guard
  `-gt 0`. **`extract-samples.sh:31-40`** has an unreachable diagnostic branch
  (`unzip -Z1` exits 11 under `set -e` before the check). Both are on the audio
  path, which is an optional sensor.
- **`menu.sh:124`** has the exact `sed | head -1` SIGPIPE geometry CLAUDE.md
  documents, latent only because its one call site is `|| return 3`, which masks
  `set -e` for the function body. Worth a herestring before someone calls it
  directly.
- **The `grep -q` SIGPIPE class is otherwise clean.** Every pipeline in the repo
  ending in `grep -q`, `head`, `tail` or `read` was checked; the guards are
  correct, and the four `grep -m1 mCurrentFocus` sites all pin the package
  inside the pattern, which is the behaviour the rule asks for. Do not "fix"
  them.

## Deliberate overlap, checked and left alone

`plans/07`'s "Intentional overlap — do not merge by default" and
`FNAF-BOT-IMPLEMENTATION-COMPARISON.md` both hold up. In particular:
`screenstate.py` vs `screencheck` is a genuine watchdog/classifier split;
`sourcetest.mjs:533`'s second Fusion LCG is the one duplication in the
repository that is a *control* rather than a hazard — it is asserted bit-exact
against `src/rng.js` over 20,000 draws, and it is the pattern findings 2 and 6
are missing.

---

# Second pass, 2026-08-26: legibility, maintainability, coherence

The audit above hunts *correctness* hazards. This pass asks the other three
questions, and starts by checking the record above against the tree — because
the first thing it found is that the record was wrong in both directions.

Everything below was verified directly, and the engine suite was green
(`node tools/test.mjs --engine`) before and after.

## What the records got wrong about themselves

**Both tracking documents disagreed with the tree, and with each other.** This
is the failure this repository rates highest, because a wrong record is worse
than a missing one: a reader trusts "resolved" and stops looking.

- `PROGRESS.md` said audit findings "1, 2 and 4 are resolved". Finding 2 was
  not. It is now, and this document's finding 2 carries the correction —
  including that the count of four copies was itself wrong. There were five,
  and the one this document listed as already fixed was `screenstate.py`'s
  live `--adb-fast` watchdog, which nothing had ever run.
- `PROGRESS.md`'s resume block — the first thing a cold session reads — said
  the tree was dirty and the suite red on an in-flight source pass. That pass
  had landed in `47dcd1b`; the tree was clean and every check passed. Plan 13's
  next gate was pointed at a reconciliation that had already happened.
- `PROGRESS.md` listed two `trial.sh` defects as "found and not fixed"
  while citing, eight lines above, the commit that fixed them (`98eb7ff`).
- The headline read `29 of 89` in the header and `29/88` two screens down.
- Finding 7 above had had three of its five orphan gates wired in with nothing
  recorded, so the document overstated the problem while `PROGRESS` understated
  it.

None of these were hard to find. Nothing recomputes any of them, which is the
whole point: **the parts of this repository that are checked stay true, and the
parts that are asserted drift.** Every fix in this pass is therefore a gate,
not just a correction.

## 11. The indexes had drifted, and nothing recomputed them

`docs/README.md` routes "Find the right command" to `tools/TOOLS.md`, which was
**missing 47 of 137 tool scripts.** Among them `grade-run.sh` — the one command
CLAUDE.md says to run before quoting any number off a device run — plus
`grade-night.py` ("the only number that is a run length") and `desync-scan.py`
("only `desync-scan.py` says what the game did"). `docs/README.md` was itself
missing 5 of 32 pages, one being `HID-MULTITOUCH.md`: 26 inbound references,
and the page CLAUDE.md's read-before-concluding table points at for any device
claim.

This is CLAUDE.md's "an instrument nobody runs is a comment" one layer up — an
instrument nobody can *find*. `test-grade-run-coverage.mjs` gates wiring;
nothing gated discoverability.

`ONE-PIXEL-VISION.md` also linked three files under gitignored `captures/` that
exist for no reader and that no script regenerates.

**Resolved.** `tools/test-docs.mjs` checks that every link resolves, every
`docs/` page is indexed, and every tool script has a **table entry**. A mention
in prose is not an entry — the first version of that check used a substring
match and passed on tools that had no row, which is exactly how the drift hid.

## 12. Gates that ran nowhere, cited as the reason not to check

Finding 7's remainder, plus a mechanism it did not name. Exclusion reasons in
`test-grade-run-coverage.mjs` are free text and **nothing parsed them**, so a
script could drop out of coverage by citing a gate that did not exist or did
not run — and four did.

**Resolved.** The gate now resolves every `test-*` file a reason cites and
fails when it does not exist or is registered nowhere; the `test-*` skip reads
`tools/test.mjs` and `ci.yml` instead of asserting in a comment; and the
directory scan covers `tools/cue` and `tools/dump`, which were outside the rule
entirely — the source of CLAUDE.md's own purest example.

*The instructive part:* the first version used a substring match and its
positive control failed, because a **comment** in `tools/test.mjs` naming
`test-select-adb.sh` satisfied the check while the registry entry was deleted.
A check a mention can satisfy measures documentation.

## 13. `trial.sh` is 2934 lines against a 2000-line ceiling — OPEN

The global working agreement sets ~2000 lines as a hard ceiling. The runner is
**47% over it**, it is the file that touches the phone, and it has exactly one
section header in its whole length. It shed 378 dead lines this week and is
still over. Nothing enforces the ceiling.

Four seams are already near-separable: session/watchdog lifecycle, the HID
primitives, the timing helpers, and the plan interpreter (the one block that is
already fenced with a header).

The strongest argument for starting is not the line count. It is that
`test-plan-interpreter.sh` reads the runner's constants **by grepping the shell
file** and lifts its functions out by `awk`. That is not a test harness reaching
into an implementation by choice — it is the only interface the file offers,
and it is why `grep -m1` once asserted against a constant defined twice. A
`constants.sh` that both the runner and the test source would delete that
coupling, and is also the first cut of finding 6's timing half.

**Not attempted, and the reason is not judgement:** a device run was live in
`trial.sh` for the duration of this pass, and bash reads scripts
incrementally — editing one mid-run corrupts execution. Deferred deliberately,
with the seams named so the next session does not re-derive them.

## 14. `tools/device` is 83 scripts in one flat directory — PARTLY ADDRESSED

Probes, graders, builders, libraries, launchers, helpers and tests are all
siblings, and the taxonomy that should be the directory structure exists
instead as ~40 free-text reason strings in `test-grade-run-coverage.mjs`'s
exclusion map: *builder, probe, library, launcher, helper, grader*. Those
categories are real and consistently used.

**What was done:** the reasons are now *parsed* rather than trusted, which
closes the defect they actually caused (finding 12).

**What was deliberately not done:** the physical move. Relocating 83 files
would touch `grade-run.sh`'s paths, `tools/test.mjs`, CI, four documents and
the coverage gate's own scan, in a repository with a second session actively
committing to it. That is not a surgical refactor, and the legibility gain is
smaller than the merge risk. Recorded here so it is a decision rather than an
oversight.

## 15. What is healthy, stated so it is not "fixed" later

The `src/` boundary is clean and enforced by use: 20 tools import
`../src/config.js`, and nothing in `src/` reaches into `tools/`. The simulator
is a library the device stack consumes, one-way. That is the part of this
architecture that is working, and it is why the JS half of finding 6 was never
the problem — only the half that crosses a language boundary shell cannot see
across.

## Still open after this pass

- **The runner's size** (13), blocked on the live device run.
- **Timing constants across three languages** (finding 6's remainder), blocked
  on the same file. The coordinate half is closed.
- **The Fusion touch-poll rate** — asserted 30 Hz in eight places, measured
  never, while the engine runs at 60 FPS. Moved to
  `HID-MULTITOUCH.md` §"Open: the tick rate is asserted twice and measured
  never", because it had fallen out of *both* tracking documents: this document
  filed it as a note deferring to `PROGRESS`, and `PROGRESS` stopped naming it.
  The *recording*-rate half is closed — `grade-run.sh` now probes with
  `ffprobe` and refuses a capture that is not the rate its graders assume.
- **Findings 3, 5, 9, 10 above**, untouched by this pass.

## Status, 2026-09-25

Appended rather than edited in place, because other pages cite this one by line.

- **Finding 13, the runner's size** — resolved by removal: `trial.sh`, its
  launcher and its 12 stages left the tree on 2026-09-25
  ([`ARCHIVED-ROUTES.md`](ARCHIVED-ROUTES.md)). The campaign executor that
  replaced it was split the same day (`hid-schedule.js`, `device-shell.js`,
  `control-effect.js`), and what remains open of that split is
  [`LEG-004`](architecture/LEGIBILITY-FOLLOWUPS.md).
- **Finding 6's remainder, timing constants across three languages** — the
  shell copy left with the runner; `test-screen-map.ts` holds the coordinate
  transform to one answer in the transport and the Companion.
- **Finding 5, the screen-model builder** — moot: the screencheck classifier
  and its builder were retired with the fixture service path.
- **Finding 14, `tools/device` as one flat directory** — its index is now
  [`../tools/device/README.md`](../tools/device/README.md), split per
  directory from `tools/TOOLS.md`; the directory itself is still flat.
- **Findings 3, 9, 10 and the tick rate** — unchanged by this pass.

