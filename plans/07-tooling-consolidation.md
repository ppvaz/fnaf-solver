# Tooling consolidation and contract cleanup

**Status:** correctness-contract pass complete, audited 2026-08-23.
Remaining shared-infrastructure refactors are queued for an opportune change in
their subsystem. The canonical current inventory is
[`tools/README.md`](../tools/README.md) (split per directory from `tools/TOOLS.md` on 2026-09-25).

## Why this plan exists

The repository gained simulator probes, browser drivers, Android experiments,
source-dump readers, and a device-local visual classifier over several research
passes. An all-tools inventory found a few false contracts and stale statements,
plus repeated infrastructure that could make later agents fix or recreate only
one copy. This file records that debt without presenting planned interfaces as
if they already exist.

## Remote branch consolidation (2026-08-23)

`origin/worktree-bb-cost-recheck` was audited commit by commit rather than
merged wholesale. Its isolated engine suite passed before selection.

Preserved:

- the reachable input gates, 97 direct sourced-rule assertions, and narrow
  BB→Foxy `pilottest --assert` regression;
- the Puppet's sourced 16/20 roll, with a new direct assertion the remote
  commit itself lacked;
- the external AI-table mapper and its Night-6 2-AM calibration constraint;
- `phasesweep`, `periodicsweep`, and `flicksweep` as explicit negative reports,
  with stale conclusions/comments corrected.

Deliberately not merged:

- `regionmean*`, `regiontime*`, `regionbench`, `ventcal`, and `ventregion`: the
  multi-process shell classifier failed all fourteen live probes and is
  superseded by the bounded native `screencheck` pipeline;
- `goldenscan.py`: it had no known-positive frame and therefore no validated
  decision boundary; the `SCM1` calibration/holdout pipeline replaces it;
- `inputtest.sh`: it depends on the omitted region scripts and has weaker focus/
  lifecycle guards than the current device harness;
- `nightsweep.mjs`: it labels a run Night 6 without modeling the extracted
  per-hour AI table, so its comparison is not authoritative;
- the remote `trial.sh` change: it passes an unused `BB_PERIOD` argument
  into the device shell and implements no response.

These exclusions are conclusions, not a backlog. Reopen one only if a future
need is not served by the retained tools and its stated flaw is fixed first.

## Priority 0: correctness and documentation contracts

### 1. Make `phasetest` capable of failing

**Completed 2026-08-23:** its exit status now includes collected expectation and
console failures, matching the other browser checks. A browser-suite run remains
the verification gate before the consolidation branch is pushed.

The audit found `phasetest.mjs` in the judged browser-check group while its
normal completion path always called `process.exit(0)`, allowing printed
`FAILURES` to pass the suite.

The exit contract now matches `lessontest`, `caltest`, and `lightcheck`; the
runner uses the process status rather than treating output text as a verdict.

### 2. Correct the browser concurrency documentation

**Completed 2026-08-23:** the README now distinguishes concurrent engine checks
from serial-by-default browser checks and documents `--parallel` as the opt-in.

The README said browser checks run concurrently. The canonical runner executes
them serially by default because real-time grading becomes unreliable under
contention; only `--parallel` opts in. Keep `tools/test.ts` authoritative and
make the README describe that behavior.

### 3. Bring device-visual documentation up to current evidence

**Completed 2026-08-23:** `ON-DEVICE-SCREEN-CHECKS.md` describes the
12,680-byte classifier/model pipeline and measured latency. The broader
`ON-DEVICE-VALIDATION.md` now consolidates the remote BB-cost research,
superseded shell prototype, corrected BB→Foxy chain, Night-6 target
availability, and current native path.

`ON-DEVICE-SCREEN-CHECKS.md` and the corresponding section of
`ON-DEVICE-VALIDATION.md` predate the connected-phone and model-classifier work.
At audit time they retained several contradicted statements:

- the helper is described as 6.6 KB; the classifier-enabled ARM64 build measured
  12,680 bytes;
- the phone is described as disconnected and Android latency unmeasured;
- the template classifier is described as a future fallback even though the
  `SCM1` builder, native classifier, replay check, and device benchmark exist;
- the retained CAM 10 example associates the 1,952-bps positive with CAM 04,
  while the measured positive was CAM 10 selected and CAM 04 measured zero;
- `ON-DEVICE-VALIDATION.md` broadly says interactive driving is impossible,
  which remains true for host round trips but not for the measured device-local
  `screencap | classify` branch.

Replace these with the dated measurements and preserve the still-open evidence.
BB now has labeled/holdout and live-branch evidence; Golden Freddy still needs
an independent positive holdout. Do not add Toy Bonnie calibration to the
Minus 7 path: CAM 04 already stalls him, so that visual check is redundant.

### 4. Align the `screenstate.py` Pillow contract

**Completed 2026-08-23:** Pillow is now imported only after `--adb-fast` has
exited, so the raw-scanline watchdog no longer depends on it.

The audit found that `screenstate.py` imported Pillow at module load, including
in `--adb-fast` mode, even though the raw-scanline path does not decode PNG.
The lazy import leaves that safety watchdog with fewer dependencies.

## Priority 1: consolidation that prevents drift

### 5. Make `tools/TOOLS.md` the only detailed inventory

**Completed 2026-08-23:** the README retains the suite and common focused runs,
then delegates complete command discovery to `tools/TOOLS.md`.

The audit found a partial per-tool command catalog in the README that duplicated
the canonical index and would omit new device/dump tools unless maintained in
parallel. The README now keeps only suite entry points and common examples.

### 6. Extract the repeated Chrome DevTools harness

`browsertest`, `caltest`, `lessontest`, `lightcheck`, and `phasetest` independently
implement Chrome startup, target polling, WebSocket RPC, evaluation, exception
collection, temporary profiles, and cleanup. `chrome.mjs` currently centralizes
only binary discovery and flags.

Extend the shared browser layer with a small session helper. Preserve per-tool
ports or allocate collision-free ports, always remove temporary profiles, and
retain each script's explicit expectation list and real-time waits. Verify every
browser check both alone and through the serial canonical runner before removing
the copies.

### 7. Share the Android trial lifecycle and guards

`trial.sh` and `trial-maskcamp.sh` duplicate game launch, focus checks,
screen-state polling, recording shutdown, and cleanup, but their safeguards have
already diverged. Extract only stable lifecycle primitives into a sourced shell
module: exact-device/focus verification, guarded launch, HUD wait, recording
finalization, and exact-PID cleanup.

Keep strategy scheduling in the individual scripts. Shell traps and background
process ownership are load-bearing; prove lost-focus, non-night, interrupted-run,
and normal-completion behavior before adopting a shared module.

### 8. Share screen-model input parsing

`build-screen-model.py` and `replay-screen-model.py` duplicate `LABEL=PATH`
discovery, label validation, recursive `.raw`/`.png` selection, and part of frame
decoding. Move those format contracts into a small local Python module if either
tool next changes. Keep model feature extraction in the builder and classifier
execution/confusion reporting in replay.

## Priority 2: consolidate only if the duplication grows

`grade-minus7.py`, `camtrace.py`, `windpct.py`, and `find-events.py` all invoke
ffmpeg and scan frame sequences, but their resolutions, pixel formats, smoothing,
and evidence semantics differ. A shared decoder might save code, but a premature
generic vision framework would make these calibrated reports harder to audit.
Extract it only after another analyzer needs the same exact decode/run primitive.

## Intentional overlap — do not merge by default

- `screenstate.py` is a coarse host-side safety watchdog; `screencheck` is a
  bounded device-local classifier for reaction-time branches.
- Simulator policy probes encode intentionally different strategy hypotheses.
  Reuse `bbtest` bots and `pool.mjs`, but do not hide each policy's schedule in a
  generalized controller solely to reduce line count.
- The freestanding `screencheck-start.S` and syscall layer deliberately avoid an
  APK, root, libc, and Android runtime dependencies.
- Post-run video analysis and live raw-screenshot classification validate
  different boundaries and should remain independently testable.

## Suggested execution order

1. ~~Fix the `phasetest` verdict and contradictory docs.~~
2. ~~Trim the README's duplicate catalog after the canonical index settles.~~
3. Extract the browser session helper during the next browser-test change.
4. Extract device lifecycle helpers only alongside watchdog tests.
5. Share model input parsing when the model format or accepted inputs next evolve.

## Done when

- every command labeled **check** can be made to exit nonzero through a controlled
  failing assertion;
- README, validation docs, and `tools/TOOLS.md` agree with executable behavior and
  dated device evidence;
- detailed tool discovery has one canonical index;
- browser and device lifecycle duplication is either consolidated with regression
  coverage or explicitly retained with a current reason;
- no shared extraction weakens timing, focus, cleanup, overwrite, or game-content
  safety boundaries.
