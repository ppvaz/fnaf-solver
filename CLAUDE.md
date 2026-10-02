# Repository operating contract

This is an evidence-bearing study of the modern Android FNaF 2 target. Keep
the five charter layers—Truth, Understanding, Decision, Embodiment, Proof—and
never silently promote a model or fixture result. Plan 12 owns promotion;
known negatives and retractions remain discoverable.

Ownership is directional: `@sixam/source` owns each game's mechanics (Rulebook
data, Sim, controls) and imports only the kernel; `@sixam/kernel` holds the ADR
0002 kernel types, the semantic contracts and Time, and imports nothing;
`@sixam/propose` owns the policy language, the controllers and the cycle
machinery over them, the strategies and the experiments, imports the kernel,
source, play and review, and is imported by nothing but the applications;
`@sixam/play` owns
the phone's transports, clocks, night onset and detection rules (the FNaF 2
grid/luma rules deprecated), the campaign executor and its supervision, the Sim
observer, the player's estimator and the phase clock, and imports only the
kernel and source;
`apps/desktop` is the one composition root (the device command line, the
`fnaf-solver` MCP server and the lab verbs) and, with the trainer, a leaf;
`@sixam/review` reads the evidence and never imports play, an application,
propose or research (`tools/architecture-test.ts`). There is no sandbox
(ADR 0002 principle 7): claim-bearing cohorts and censuses are pre-registered,
and diagnostic sweeps name the explanation they test. Production never
imports tests, reports, mutable search knobs, DOM, shell, or device details
into core.

For a migration use characterize -> contract test -> change -> compare semantic
traces -> switch -> remove shim. Use explicit units/clocks and `UNKNOWN` for
missing or ambiguous measurements. A send is not game acceptance.

Device work is dry-run by default. Use a resolved, hashed profile, capability
preflight, exclusive lease, bounded commands/deadlines, retained telemetry, and
fail-safe release/abort. Never infer mode, geometry, coordinates, timing, ports,
or calibration from prose or conversation. No arbitrary shell is exposed to an
agent.

Start with `npm ci` and run affected gates plus the campaign dry run over a
committed winner (the CI step of that name: `npm run device:emit` then
`npm run device:campaign -- --bundle DIR --nights N`, no phone). Before
pushing run `npm run push-gate`, which runs the CI lanes against the pushed
commit in a throwaway worktree; the working tree is a different measurement
from CI's clean clone. `git config core.hooksPath .githooks` makes it automatic.
Finish by updating the structured progress/result record, citing its generated
evidence ID, and stating exactly what remains open; do not create a parallel
handwritten evidence log.

## The path (Pedro, 2026-09-25)

Every plan and thread is taken, within what is possible, to its last
consequence: a verified solver for the Clickteam build-296 night games, with
FNaF 2 at 10/20 as the primary target. The steps, what closes each, the
boundaries, and the gates that were loosened or archived for it are in
[`plans/ROADMAP.md`](plans/ROADMAP.md): S1 custody and the first promotion
edge, S2 encounter-level fidelity (same-phase twin on the phone, clean-room
recompile on the host), S3 the ceiling from a census over policies, S4 a
controller at that ceiling on the phone, S5 the human route, S6 the method on
four games and the solver interface, S7 the lab running itself. A gate that is
superseded, obsolete, or competes with the path is loosened or archived, and
recorded in that file's table.

## Consequence lock (active 2026-09-06, loosened 2026-09-25)

A commit is **consequential** if it retains a verifiable record that closes or
advances a step of the path: device evidence or a run pack, a promotion, a
frame-traced twin or trace-equivalence record, a census that names its policy
family and held-out block, or code a gate exercises in the Companion, the
controller, the trainer or the solver interface. Docs and plans alone —
and gates, benchmarks, scaffolding, refactors that close no step — are
**bookkeeping**. A host-side record never stands in for a device claim: the
labels still do not promote one another.

- The `commit-msg` hook refuses commits that touch only bookkeeping paths
  (`docs/`, `plans/`, `*.md`) unless the same commit stages evidence under
  `artifacts/` or `docs/evidence/`, or the message carries `EVIDENCE:<path>`
  naming evidence from a prior commit.
- `PEDRO-OK` in a commit message is the human-only override. Agents never
  write it and never bypass hooks (`--no-verify`, `commit -n`).
- Start every session by naming the step it will move and the artifact it aims
  to produce. If that artifact cannot be produced this session, say so and
  stop — no substitute work that closes no step.
- If device work is blocked because the phone is absent or locked, enqueue a
  Companion job (`cue.queue.enqueue`) and end the device work there.
- When a route is refuted on device, the next commit is the next route's
  physical test or a decision request to Pedro — never further documentation
  of the refutation.
- End every session by reporting the consequential:bookkeeping commit ratio.
- A binding that wins on the phone, or that gets an `ANCHOR_AIMS` entry, is
  committed as `packages/propose/bindings/<game>/campaign-night<N>-<name>-winner.json`
  in the same commit (`test-fact-register.ts` refuses otherwise). Winners lived in
  `tools/device/` until 2026-09-30 (Pedro: "Move to propose/bindings"); records
  written before then keep that path, and their readers follow the file through
  git's renames. `artifacts/` is
  gitignored: a winner that lives only there cannot be re-run on another
  machine, and on 2026-09-15 the k3 Night 7 bundle could not be rebuilt from
  the evidence records' knob deltas.

The 2026-09-06 standing directive ("laser-focus on 6 AM successes on-device;
nothing outranks the next graded run bundle") is replaced by the path. Its
target survives in it: promotion of what is won is S1 and comes first, Night 7
reliability is S4. Nights 1-7 have all reached 6 AM on the phone; the best
Night 7 cohort is k3's 8 of 10, and since 2026-09-27, 47 won nights carry a
Plan 12 promotion edge (S1 below).

**S1 — the first promotion edges (2026-09-27).** `npm run evidence -- pack
<run>` commits a live night's text evidence to `docs/evidence/runs/<run>/` with
every frame and recording named by sha256 only, and `night-run.sh` packs each
campaign it runs: commit the directory. `list`, `show`, `promote` and
`promotions` read packs on any checkout. Campaign directories that are gone are
recovered from the night-run's `campaign.log`, which captured the CLI's event
rows and printed result byte for byte (9 of 9 and 7 of 7 on the campaigns that
still have both, `docs/evidence/custody-recovery-20260925.json`); such a pack
names its custody and what is lost. **Pedro's decisions, 2026-09-27:** a
recovered pack is accepted fully ("Accept fully"): it passes `manifestComplete`
and still names what it lost. And agents may write `plan12-attestation.json`
("i give agents full permission, this is bullshit bureaucracy that is impeding
progress"), but only through `npm run evidence -- attest <run> --by agent --note
"<session>"`, which re-derives every other check from the pack, refuses on any
failure, and writes `plan12-attestation-v2` naming its author and each check
verified with its inputs' sha256. The delegation covers attestations only;
`PEDRO-OK` and the hook rules above stand. `promote` then records a
`PROMOTED_BY` edge in `docs/evidence/graph.json` naming who attested and the
custody. **Promoted:** 47 of the 48 executor-proven 6 AMs among the 180 packs
(`plan12-promotions-fnv1a-baa38db1`, `docs/evidence/plan12-promotions-20260927.json`):
Nights 1-4 two each, Night 5 seven, Night 6 eight, and Night 7 24: 21 at 10/20,
one at BB+Foxy 20, two at BB+Golden 20. 36 of them are recovered custody. All
were attested by an agent under the delegation. Refused: the Night 7 4/20 Minus
3 win `night7-n7-420-minimal-m3`, because its winner is held back
(`test-seam-slack.ts` refuses its 0 ms margin) and its pack holds no dial
readback. Every death, lost result and FNaF 1 run is refused too, and the
video-only 6 AMs `night5-anchor4` and `night5-perfetto1` fail `terminalPass`.
A promotion is one clear, not a reliability claim. `npm run review -- query
promotions` re-derives every edge and S1's open items below from the packs, the
attestations and the winners, and checks them against `graph.json`. **S1's
closing condition holds since 2026-09-30:** every one of the 25 committed
`winner-v1` bindings is named by a run pack, and they rebuild
(`test-winners-rebuild.ts`). `campaign-toys-night5-winner.json` was packed on
the phone that day (`d659cd62`, a death). The MODEL_ONLY
`campaign-night1-minus7-winner.json` was retired to
`packages/propose/bindings/fnaf2/retired/` (Pedro: "minus 7 at night 1?
that dumb, remove it immediately. night 1 has a specifically baked minimal
input schedule that should be the canonical one"): Night 1's canonical binding
is `campaign-night1-minimal-winner.json`. The Minus 7 binding the phone ran on
2026-09-19 (`campaign-night1-minus7-n1-first-winner.json`) is retired beside it
("yes retire"); its promotion stands on custody, which reads retired bindings
too. Still open beside S1: no k2 or k3 video exists on this machine by name or
by content hash.
`UNTRACKED_WINNER_DEBT` is 1 of 1: Night 6 `a`, whose winner was found but no
longer rebuilds.

## Types (Pedro, 2026-10-01: "Real types everywhere")

- No explicit `any`, anywhere. Strict mode refuses an implicit `any` but not a
  written one, so `tools/test-type-debt.ts` counts written `any` and `x!` per
  area: an area without a `typeDebt` entry in `tools/quality-baseline.json`
  carries none (`packages/kernel/src`, `packages/source/src`,
  `packages/source/recompile`, `packages/source/decompile`,
  `packages/play/src`, `packages/play/games`, `packages/play/bin`,
  `packages/propose/src`, `packages/propose/bin`, `packages/propose/bindings`,
  `packages/propose/parked`, `packages/review/src`, `packages/review/bin`,
  `packages/review/venue-grid`, `apps/wiki` with its test, `apps/trainer/src`,
  `apps/desktop/src`, `apps/desktop/bin`, `packages/kernel/test`,
  `packages/source/test`, `packages/propose/test`, `packages/review/test`,
  `packages/play/test`, `apps/desktop/test` and `apps/trainer/test` so far),
  and the others only shrink.
  The pass that wrote `any` to get there (`tools/ts-strict.ts`, 7a8393f0) is retired.
- A validator takes `unknown`, narrows it with the kernel's guards (`isRecord`,
  `isList`, `isOneOf`, `isText`, `fail(): never`, `@sixam/kernel` labels) and
  ends with `return value as unknown as T`: the one assertion where a checked
  record becomes its type. `Array.isArray` narrows to `any[]`; use `isList`.
- Python stays only where Chowdren, numpy or Pillow forces it (Pedro,
  2026-10-02: "treat the unforced Python the way you are treating the host
  shell"; Pillow: "Keep Pillow in Python"). Every other script is characterized,
  ported to TypeScript, compared and switched, as the host shell scripts are
  (ported one at a time, their dry runs characterized and compared); seedpin
  moves into the Companion. The Python that stays is held to `mypy --strict
  --disallow-any-explicit` per script directory (`tools/python_types.py`),
  counted per area by `tools/test-python-types.ts` against `pythonTypes`. A
  Python 2 source stops mypy for its whole directory (its count was 1 while six
  Python 3 scripts beside it went unchecked), so each file that runs under 2.7
  is named in `python_types.py`'s `PYTHON2` with what runs it, and the driver
  refuses any other error that stops mypy (exit 2) rather than count the
  directory. An unstaged deletion did the same, so it checks only files on disk.
- Types never name `HidWireTransport` outside the device runners
  `tools/architecture-test.ts` lists, not even in `import type`: that gate
  counts the identifier. Type a contact port by the methods it calls.
- A union narrows on `kind` only where every member's `kind` is a literal: an
  inferred return widens `kind: 'x'` to `string` (write `'x' as const`), and
  one member typed `string` absorbs the others' literals.
- A `let` that only a callback assigns is narrowed to its initializer: declare
  it `let x = null as T | null`, or every later read is `null` (or `never`) to
  the checker.
- A module both lanes check (the lenient `tsconfig.js.json` reaches it through
  an importer) must also type-check without `strictNullChecks`, where
  `x === null` narrows nothing: return the literal (`return null`).
- A declaration another module reads as text keeps its text: Review's
  `roadmap.ts` matches `const REGISTER_GATES = [` in
  `tools/test-mistake-register.ts`, so that table is typed through an alias,
  and an annotation on its declaration broke `lab-queries.test.ts`.

## Sensors and on-device code (Pedro, 2026-09-24/25 — start here, not with the old sensors)

- **A detector reads small regions of native frames.** The Companion copies
  registered rectangles' raw pixels out of every MediaProjection frame
  (`REGION`, `NativeRegions.java`; host `openRegions()`, `native-regions.ts`)
  and whole native frames on request (`SNAP`, `native-frame.ts`) for title and
  menu screens. The rule that decides lives on the host, over those pixels.
- **Discontinued, never a starting point:** luma/mean-luma reducers, the 20x9
  point-sampled grid (`GRID`, `ScreenStats`, grid-fitted rules), and full-display
  `screencap`. Existing users are to be converted (FNaF 2's pipeline after
  recalibration), not extended.
- **Where they are still justified**, and only there: a luminance change IS the
  phenomenon (blackout, fade, a flash's timing) — computed over native region
  pixels, never the grid; per-pixel brightness thresholds for text glyphs; reading
  the 20x9 `grid_hex` already retained in old evidence; `screencap` only while the
  helper cannot run (before consent, after a crash) or as an independent witness.
- **A screenrecord cost the old helper half its frames** (75 -> 37 distinct of
  150 REGION reads even at 1200x540, 2 Mbps; 2026-09-25), on Companion 15, whose
  capture thread was saturated (0.93 of a core). Companion 16 processes 60.0 fps
  under the same recording at the FNaF 2 menu on a third of a core
  (`companion-capture-cpu-d9ecf3eadaba659a`); REGION reads under a recording, and
  a recorded night, are not re-measured. A closed-loop night that records itself
  must still survive a starved capture; `420-c` did not at full size.
- **Measure the Companion that is installed, not the one in the tree.** Compare
  `dumpsys package com.ppvaz.fnafcompanion` versionCode with `build.sh`'s
  `--version-code`: the phone ran 15 for six days after the tree moved to 16, so
  every capture number of that week, and the first profile of 2026-10-01, is
  the old helper's.
- **Everything that runs on the phone lives in the Companion**
  (`android/companion`). No separate APKs; a new on-device feature is a Companion
  feature. `packages/play/bin/companion/companion-setup.sh` drives install and projection
  consent by named UI controls.

## Quality gates and the method (Pedro, 2026-09-30)

Executable, in `test:unit` or the commit hook: ambient entropy in replayable
modules (`tools/architecture-test.ts`), the 2,000-line ceiling, dead code,
copied code, TODOs without an owner, change locality (`Contexts:` line for
three or more contexts), and a GitHub noreply author and committer address on
every commit (`tools/commit-identity.ts`, also at pre-push). The first four are ratchets over
`tools/quality-baseline.json`: never add an entry to turn a gate green; add one
only as `{count, why}` naming why the finding is accepted, and lower or remove
entries as debt is paid.

The lanes are data (Pedro, 2026-10-02: the `&&` chains "look historical"):
`tools/lanes.json` names each lane's node test files and its other steps, and
`npm run test:<lane>` is `node tools/lanes.ts <lane>`, which runs the files
through `node --test`, one process each, and names every failure rather than
stopping at the first. `--only TEXT` runs a subset. A gate that asks what a
lane runs reads the table through `readLanes` (`packages/review/src/lanes.ts`),
not `package.json`'s command lines.

What no gate can run, before implementing:
- Classify the task (research, bug, feature, refactor, qualification). If you
  cannot say what is known, from which evidence, what would refute it and the
  smallest experiment that could, it is research, not implementation.
- Search the code's own vocabulary before claiming something is absent (the
  double-camera glitch is `split`/`arm` in code), and never read a verdict off
  output cut by `head`.
- Stop when two independent results contradict the premise, the signal is
  unobservable, three fixes fail for one reason, or the change would duplicate a
  source of truth. Do not work around a failed premise. DISPROVEN, BLOCKED and
  INCONCLUSIVE are results.
- A loss is attributed in order: execution before strategy
  (`npm run review -- query audit`), planned against landed inputs before the
  model, and the actuator is blamed only when the planned execution would have
  won. UNKNOWN is an attribution.
- An experiment that proves a point is written up, then production is designed;
  experiment code is not renamed and shipped.

## Mistake register (2026-09-06 — check before acting; never repeat)

Each entry below cost a live attempt or a false diagnosis on 2026-09-06.

1. **Read a tool's own usage before the first invocation.** Sibling scripts
   differ in shape: `title-observe.py` reads the frame on **stdin** (a
   positional path argument is silently ignored and yields
   `unknown=unreadable-frame`), while `intro_card.py` takes a positional
   frame path. Never assume a uniform CLI across a directory.
2. **An observation-based rule must cite the measured row that backs it.**
   The title model's own table says the Continue band reads present
   (0.0264+) on *fresh* saves — Continue is always rendered on build 26.
   A "Continue visible means a save exists" refusal was wrong and blocked
   a live run. Before encoding any gate on an observation, re-read the
   calibration artifact that measured it.
3. **Operator statements are context, not premises.** "Fresh install" still
   required observing the save cursor before building the flow on it; the
   observed cursor was Night 1 with a rendered save. Observe the device
   state that a flow depends on; never encode an unobserved state.
4. **Re-derive every deadline when a port crosses executors.** A 15 s
   terminal wait was tuned for the machine lane (whose program blocks
   through the night) and starved the artifact lane (whose schedule returns
   while the game clock can trail by a minute). Port reuse is not timing
   reuse.
5. **Never report a test PASS you did not see print.** A wrong test path
   (`tools/test-bundle.ts` vs `packages/propose/test/test-bundle.ts`) failed
   silently behind `> /dev/null 2>&1 && echo` twice before being caught.
   Confirm the file exists and the pass line is in the output before
   claiming green.
6. **Every aborted live attempt leaves the game mid-night.** After any
   abort or user kill, drive the device to a known state (game over ->
   menu) and verify it with the title observer before starting new work or
   ending the session.

## Mistake register (2026-09-11 — the floors, and the instruments)

Each entry below cost a wrong diagnosis or a wasted device run on 2026-09-11.

7. **A floor is anchored to a measurement plus a named margin, never to the
   route it protects.** `MONITOR_MASK_READY_MS` was defined as
   `MONITOR_ANIM_DOWN_MS + MIN_CONTACT_MS` = 400 with the comment "which is the
   +400 ms timing used by the Night 5 route" — and the route presses at exactly
   +400. `400 < 400` is false, so the one check that could have caught it passed
   in silence, and `test-artifact-animation-gates.ts` pinned that boundary as
   correct. A constant defined as *what we already do* is a tautology that
   survives review because it looks derived. On the phone that zero cost about
   one cycle in eight. `test-seam-slack.ts` now refuses a plan that clears any
   timing floor by less than 33 ms, and refuses a floor that does not stand that
   far above its own measurement.

8. **Ask the phone what it offers before proposing an instrument.** Run
   `npm run device:capabilities`. An agent proposed capturing Android input
   dispatch to explain a lost press, wired `atrace-input.sh` into the harness
   and spent a full night on it before learning this handset advertises
   `android.inputmethod` and no `android.input.inputevent` — so `inputtrace.py`
   had no app dispatch source and correctly reported NO APP DISPATCH SLICES.
   `plans/PROGRESS.md` had already recorded the same negative on 2026-08-30.

9. **A measurement in a comment is not a gate.** The native frame trace behind
   the mask timing (button absent through 322 ms, faint at ~337 ms, fully
   visible at ~382.5 ms) lived only in a comment while the constant carried the
   route. If a number decides behaviour, put it where a check reads it.

10. **A number measured in one direction does not transfer to the other.**
    `actuator.mjs`'s seam table ("at 180 ms or more, 0 of 17 lost") is a MONITOR
    press after a MASK press. The Night 5 defect is the reverse order. The same
    error was made twice in one session: a `maskTicks: 4` band label was read as
    "widen the mask window", and the model then scored a wider window identically
    at every phase, refuting it.

11. **Read a tool's own computed output before deriving the same quantity by
    hand.** `phase-reconstruct.ts` already reports `model.lossBands`. An agent
    instead ran `minus-toys-margin.ts`'s `edge()`, which stops at the first
    failure and is valid only for a contiguous basin, and published a "408 ms
    cliff" for a response that is banded and periodic — condemning a 1320 ms run
    the model actually scores 3000/3000.

12. **An absent observation is evidence only when the rule has read the positive
    state in the same run.** `monitorUp->true` graded MISSING on 4 of 5 cycles
    while the monitor rule read `true` twice in 266 samples: that is a blind
    detector, not a lost press. `run-report.mjs` now refuses to call a miss
    systematic below five positive reads of that target.

13. **A gate registered only in a lane CI does not run is not a gate.**
    `test-grade-run-coverage.mjs` sat in `tools/test.ts`'s ENGINE group, which
    only `npm run test:legacy:engine` invokes and which CLAUDE.md itself
    describes as holding intentionally red controls. It had been failing on 11
    scripts, `phase-reconstruct.ts` among them — which is exactly why two
    sessions ran that by hand. Structural gates belong in `npm run test:unit`.

## Mistake register (2026-09-30 — the moves)

Each entry below broke a gate, a test or a replay during the ADR 0002 moves.

14. **A move rewrites what names a path, not what builds one.** A `git mv` plus
    a rewrite of imports and repo-rooted mentions left references built from a
    script's own location broken across three moves: `new URL('x',
    import.meta.url)`, `join(HERE, 'x')`, `${HERE}x`, `HERE / "x"` and
    `"$HERE/x"`; a glob that then matched nothing (grade-run.sh's death-cause
    models); `readdirSync(HERE)` that then listed nothing, so two tests passed
    over zero winners; an import placed before its `sys.path` insert; a
    regex-escaped path. `tools/test-sibling-paths.ts` refuses the literal forms.
    A listing, a template or a string inside another language still has to be
    read, and a test that finds nothing to check must fail. A file-extension
    filter moves with the files too: the fact register read only `.js`, so from
    the TypeScript move it found no producer and its gate passed over none.

15. **A path inside a pinned record names that record's tree, not this
    checkout.** A winner's `sources` keys, `fnaf1-winner.ts`'s `RUNNER` and the
    lane a pinned tree imports are where each file stood at the pinned commit;
    rewriting them to the new location made every FNaF 1 replay refuse
    (`test-fnaf1-winner.ts`). A record pinned by sha256 keeps its bytes too,
    and its readers follow the file instead. A predeclaration pins its tool's
    and sources' sha256 (`tool`, `sources`) and its run refuses any drift:
    before editing a file one names, find its `resultRecord`; while that is
    not committed, the edit blocks the predeclared run.

Canonical routes: [charter](PROJECT-CHARTER.md),
[architecture](docs/architecture/README.md),
[contracts](docs/architecture/generated/contract-register.json),
[commands](docs/architecture/generated/command-registry.json),
[evidence policy](docs/evidence/README.md),
[device safety](docs/operations/DEVICE-SAFETY.md),
[device capabilities](packages/play/bin/phone/capabilities.ts),
[progress](plans/PROGRESS.md). The full legacy campaign is explicit as
`npm run test:legacy:engine`; intentionally red scientific controls are not
part of the green edit lane. Historical incident notes remain in
[`docs/operations/CLAUDE-HISTORY.txt`](docs/operations/CLAUDE-HISTORY.txt).
