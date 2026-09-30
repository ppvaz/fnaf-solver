# Architecture and developer-experience refactor

**Status:** proposed 2026-08-31; amended 2026-09-29 by
[ADR 0002](../docs/decisions/0002-kernel-contexts-vocabulary.md) (below).
Architectural umbrella over Plans 07, 09–16, 18, and 20–21. This plan changes
ownership, interfaces, naming, navigation, and tooling without changing the
canonical Android target or weakening any evidence or promotion gate.
[`22-STATUS.md`](22-STATUS.md) holds the per-package status.

## Amendment (2026-09-29, ADR 0002, migration M5b)

ADR 0002 froze a kernel, five contexts (Source, Propose, Play, Review, Teach)
and a vocabulary, and settled this plan's principles. What changes here:

- **Principle 1 is rewritten: the Source is canonical.** The game's compiled
  logic is the authority, and the model derived from it serves it.
- **Principles 2 and 5 are dropped** (Pedro, 2026-09-29, ADR 0002 decision 14),
  and **principle 8 is dropped**, replaced by ADR 0002 principle 7: no sandbox;
  claim-bearing cohorts and censuses are pre-registered, and diagnostic sweeps
  name the explanation they test. `research/sandbox/` is deleted in the same
  change. Principles 3, 4, 6, 7 and 9 are kept. The original text of all nine
  is in `git show 861eac9:plans/22-architecture-and-developer-experience-refactor.md`.
- **The runtime and `DeviceControlService` are retired.** The composition this
  plan designed first -- a `DeviceControlService` over `packages/runtime`'s
  scheduler and supervisor, built by the device composition roots -- never
  played a night and was removed on 2026-09-25 (`6d78c7e`), and the adapter
  capability registry, the actuator/sensor/detector ports and `packages/screencheck`
  that only it used went the same day (`903ffab`). The campaign executor
  (`apps/desktop/src/device-cli.js campaign`, `apps/device/src/cli.js` until ADR
  0002's Play move) is the one path onto a phone.
  `docs/ARCHIVED-ROUTES.md` says how to restore any of it.
- **The package layout gains `kernel` and `review`, and a future `source`.**
  `@sixam/kernel` holds the ADR 0002 kernel types that have a consumer
  today and imports nothing; `@sixam/review` holds the evidence tools
  (moved from `tools/` in M5a) and the queries over them; `packages/source`
  (migration M6) will take the Source's code out of `core`. The dependency
  rule below is ADR 0002's, enforced by `tools/architecture-test.js`.

The sections below keep their original text where it still holds and say where
it does not; the work packages keep theirs, with a dated note where they name
something retired.

## Outcome

A new contributor should be able to understand the project in minutes:

```text
owned Android evidence -> canonical mechanics model -> policy research
                                                   -> human trainer
                                                   -> stock-device controller
                                                   -> in-APK controller
                         every path -> replay, telemetry, grading, honest claim
```

The repository becomes a small npm-workspaces monorepo whose canonical package
is `@sixam/core`. The trainer is one application of the model, not the
owner of it. Search is a first-class research method. Sensors, estimators,
controllers, actuators, clocks, transports, and experiment artifacts have
explicit contracts and conventional automation names. A device run is composed
from declared adapters and a versioned profile instead of discovered through a
large shell program and environment-variable combinations.

The refactor is complete only when both statements are true:

1. A general reader can identify the vision, mission, scope, current products,
   and evidence limits from the root README without first understanding Minus 7
   or the device harness.
2. A developer can run one documented bootstrap, test the model, build the
   trainer, inspect a policy, and run a complete no-phone device dry-run from a
   clean checkout using a handful of root commands.

### Decisions at a glance

| Question | Decision |
|---|---|
| Canonical source | The Source: the game's compiled logic, read through the dump into one Rulebook per game (in code `@sixam/source` since 2026-09-30); every other context consumes it (amended 2026-09-29) |
| Repository | private npm-workspaces `@sixam/*` monorepo |
| Main implementation language | strict TypeScript for new/extracted long-lived host/core code; gradual JS migration |
| Other languages | Python analysis, thin shell boundaries, Android Java, firmware/native C, entry assembly, toolchain-only C# |
| Duplicate implementations | common semantic ports + capability-specific adapters + conformance suites |
| Device piloting | versioned profiles and run bundles through the campaign executor (`device:campaign`); no inferred modes/coordinates. The `DeviceControlService` first planned here was retired on 2026-09-25 (`6d78c7e`) |
| Agent actuation | optional bounded MCP adapter over the service; never the real-time control loop |
| Testing | fast deterministic unit/contract/affected lanes; slow simulation, real-time, and live-device lanes explicit |
| Exploration | no sandbox (ADR 0002 principle 7, 2026-09-29): claim-bearing cohorts and censuses are pre-registered; diagnostic sweeps name the explanation they test |
| Documentation | repo-owned narrative plus generated catalogs, reverse source links, and static wiki-like portal |
| Knowledge retrieval | lexical/generated indexes + lightweight typed claim/evidence graph; optional benchmarked RAG later |
| Change locality | implementation + one registry + conformance tests; scattered backend branches are a design failure |

## Why this plan exists

The repository grew as an evidence-bearing research notebook. That produced
strong local reasoning and many independently useful instruments, but the
structure now communicates the wrong architecture:

- `src/` mixes the canonical mechanics model, policy/control foundations, and
  browser-only trainer code. Tooling imports `src/`, so the least general
  application appears to own the whole program.
- `tools/` mixes tests, reports, controller synthesis, timing optimization,
  model probes, device characterization, host orchestration, remote execution,
  and native helpers under one generic name.
- `tools/device/trial.sh` is 1,815 lines before its twelve generated remote
  fragments. It combines configuration, validation, plan selection, model
  gating, building, deployment, session recording, process lifecycle, and
  hardware execution.
- Equivalent roles have multiple implementations but no common map: ADB tap
  and HID actuate controls; screencap and MediaProjection sense the display;
  cue-helper and A2DP expose different audio/visual signals; simulator and
  hardware clocks have different time bases. These alternatives appear as
  branches and scripts rather than adapters with declared capabilities.
- Terms such as `fact`, `cue`, `observer`, `driver`, `capture`, `policy`, and
  `event` carry overlapping meanings. In particular, the current `Observer`
  models sampling, detector behavior, transport delay, audio events, dropout,
  and controller-visible state behind one name.
- Markdown carries onboarding, architecture, command discovery, configuration,
  evidence, incident history, research results, and project management. It is
  difficult to distinguish current executable truth from retained history.
- Generated binaries and calibrated models are correctly ignored, but a clean
  checkout cannot demonstrate the complete device workflow with fixtures. The
  main operational path is therefore discoverable only by reading and owning
  local artifacts.

This is an information-architecture and dependency-direction problem, not an
argument for discarding the existing science or rewriting every language into
JavaScript.

## Architectural principles

### 1. The Source is canonical; applications are leaves

*Rewritten 2026-09-29 (ADR 0002).* The game's own compiled logic is the
authority. The Source context acquires it, decompiles it, reads it and derives
one Rulebook per game -- the night model and the Sim's `[SOURCED gN]` rules --
and recompiles it into a runnable binary, along the identity chain APK -> CCN ->
dump -> Rulebook and CCN + patch -> binary. Where the model and the dump
disagree, the dump is right and the model is fixed. In code the derived
mechanics, semantic actions, observations, policies and evidence-labelled
constants lived in `@sixam/core`; since 2026-09-30 each game's Rulebook data,
Sim and controls live in `@sixam/source` (migration D1/D4), the contracts and
Time in `@sixam/kernel`, and core keeps the policy language, sensing and
estimation until they move. Propose, Play, Review and Teach consume Source; it
imports only the kernel, and never an application, adapter, shell
command, DOM API, or device implementation.

### 2. (Dropped 2026-09-29)

*Dropped by Pedro (ADR 0002, decision 14).* It was "One program, several
embodiments". ADR 0002's five contexts and its venue grid take its place.

### 3. Alternatives implement ports; capability differences remain visible

ADB tap and HID may both implement the actuator port, but the interface must
not pretend they have the same contact, multitouch, clock, latency, or
verification properties. Screencap and MediaProjection may both contribute
visual measurements, but their raw geometry, cadence, latency, calibration,
and contention remain explicit.

### 4. The abstraction begins at semantics, not at commands

A controller requests `press mask`, `select CAM 10`, or `hold wind`. It does
not emit coordinates, `adb` commands, HID report bytes, or shell callbacks.
Sensors produce timestamped measurements or explicit unknowns. They do not
silently answer policy questions.

### 5. (Dropped 2026-09-29)

*Dropped by Pedro (ADR 0002, decision 14).* It was "Research may remain
plural; its method is shared". Declared work in ADR 0002 is an Experiment,
which names its competing explanations, or a Census over a named population;
a negative result stays a first-class result under the charter.

### 6. Executable contracts own current behavior

Code and schemas define behavior; tests define invariants; CLI `--help` and
workspace scripts define commands; Markdown explains purpose, operation,
decisions, evidence, and history. A large prose table is not the canonical
registry for executable tools.

### 7. Migrate by characterization and equivalence

Do not combine a semantic change with a package move. Preserve old imports and
commands temporarily through explicit compatibility shims, compare semantic
traces, then delete the shims at a named gate. No evidence claim changes merely
because a file moved.

### 8. (Dropped 2026-09-29)

*Dropped, replaced by ADR 0002 principle 7:* no sandbox. Claim-bearing cohorts
and censuses are pre-registered; diagnostic sweeps name the explanation they
test. It was "Structured core, permissive edge", with a `research/sandbox/`
tree that production could not import; that directory held one archived
probe's notes and was deleted on 2026-09-29, the notes moving to
`docs/ARCHIVED-ROUTES.md`.

### 9. Optimize for change locality

A simple concept should have one owner. Adding an actuator, sensor, detector,
experiment operation, or device profile must not require edits to unrelated
controllers, a prose tool table, multiple shell branches, and several copies
of constants. Prefer registry entries, data-driven composition, subpath
exports, and contract conformance suites over distributed `if backend === ...`
logic. As a review heuristic, an ordinary extension should touch one owned
implementation area, one registration point, and its tests/fixtures. More than
three ownership areas requires an architectural explanation or a boundary
improvement.

## Target monorepo

Use npm workspaces because the JavaScript already runs as ES modules and the
packages must change atomically. This does not require publishing packages or
adding runtime dependencies. Commit `package-lock.json` and make `npm ci` the
single clean-checkout bootstrap: it creates the workspace links required for
bare `@sixam/*` imports and installs a pinned TypeScript/tooling set. Core
and trainer retain zero runtime dependencies unless a later ADR changes that;
the root development install is disposable and is never shipped with either
application. Preserve a documented bare-Node core/legacy test path during the
migration for offline diagnosis, but do not invent a custom resolver merely to
avoid the conventional workspace bootstrap.

```text
fnaf2-1020/                     (amended 2026-09-29: ADR 0002 contexts in brackets)
  package.json
  README.md
  CONTRIBUTING.md
  CLAUDE.md

  packages/
    kernel/                     @sixam/kernel    [kernel] ADR 0002 kernel types with a
      src/                      consumer today (Interval, ClaimLevel, SourceLabel, Outcome,
                                GameRun, Annotation): types.ts + validators; imports nothing

    source/                     @sixam/source    [source] since 2026-09-30 (migration D1/D4)
      src/games/fnaf1..4/      Rulebook data, Sim, controls, movement graph
      src/clockwork/           nights registry, night model, RNG, control catalogs and vocabulary
      decompile/               the decompile and read chain (was tools/dump)
      test/                    the sourced draw-order and Sim contract tests
                                (later: acquire, derive, recompile; the identity chain, M6)

    core/                       @sixam/core      registered compatibility shims only
      src/
        control/               shim over source's vocabulary and propose's policy language
        sensing/               shim over @sixam/play/sim
        mechanics/, contracts/ compatibility shims over source and the kernel

    play/                       @sixam/play      [play] since 2026-09-30 (the Play move)
      src/campaign/            the executor, campaign state machine, runner, ports,
                                HID schedule, device shell, night anchor
      src/coach/               the teach feed
      src/venues/phone/        HID, Cue Helper and Companion-status transports
      src/venues/sim/          the Sim observer
      src/phone/               clocks, night onset, control anchor and exclusion, venue parser
      src/sensors/fnaf2/       DEPRECATED grid/luma rules, to be converted
      src/player/, src/clocks/ the estimator; the phase clock
      test/                    the transport, rule and campaign tests

    adapters/                   (moved into play) one registered link, button-strokes.js

    propose/                    @sixam/propose   [propose] since 2026-09-30 (migration M8)
      src/policy/              the policy IR, observation language and ports
      src/games/               FNaF 2's controllers and cycle machinery; FNaF 1/3/4 policies
      src/strategies/          Minus 3, Minus Toys, right-vent camp
      src/experiment/          experiment.js, seeds.js, families/, cli.js (npm run research)
      experiments/             the named experiment specs
      parked/minus7/           Minus 7, kept on purpose
      test/                    cycle, night-policy, experiment and alias tests

    research/                   @sixam/research  compatibility shim: seeds.js and
                                strategies/minus-3.js re-export propose for hash-bound tools

    review/                     @sixam/review    [review]
      src/                      run packs, Plan 12 attestation and promotion, cohorts,
                                the pack lift to GameRun, and queries (npm run review)
      src/measure/             the bench transport trace

  apps/
    trainer/                    @sixam/trainer   [teach]
      src/                      UI, audio, input, lane, curriculum
      src/training/            the exercise and activity-gate records

    desktop/                    @sixam/desktop   the one composition root
      src/                      device-cli.js (npm run device:*), the fnaf-solver MCP
                                server, the lab verbs (npm run lab)

    device/                     (moved) profiles/ only: stored hashes cite the path

  docs/
    architecture/
    decisions/
    evidence/
    research/
    operations/

  plans/
```

Retired on 2026-09-25 and not part of the layout: `packages/runtime` (the
fixture scheduler and supervisor, `6d78c7e`) and `packages/screencheck` (the
on-device classifier, `903ffab`), with the `apps/device/remote/` shell executor
this plan first drew.

Do not make every adapter a workspace. Subpath exports such as
`@sixam/adapters/actuator-hid` preserve boundaries without producing dozens
of packages. Split a subpackage only when it has an independent release,
toolchain, or dependency boundary.

### Dependency rule

*Amended 2026-09-29: ADR 0002's rule, in today's names.*

```text
kernel <- source <- play <- propose -> review -> source

  kernel   @sixam/kernel     imports nothing; every package may import it
  source   @sixam/source     imports only itself and the kernel
  play     packages/play          imports only the kernel and source
  propose  packages/propose, packages/research   imported by nothing but the applications
  review   packages/review        never imports play or propose
  teach    apps/trainer           source and the kernel
  apps     apps/desktop, apps/trainer   composition roots: may import any package
```

- `kernel` has no dependency and imports nothing in the repository: no
  workspace, no relative path out of itself, no Node built-in.
- `core` holds only registered shims and imports only itself, source and the
  kernel; its `/control` shim may re-export propose and its `/sensing` shim
  play.
- `play` imports only itself, the kernel, source and Node built-ins; nothing in
  a package imports it but propose. `apps/desktop` is the one composition root
  that plays a night; it composes play and a resolved profile.
- `propose` imports the kernel, source, play and review, and explicit
  simulation and error models, but never core, an application, `tools/` or a
  live shell (`child_process`, `net`, `dgram`). `research` is its compatibility shim: its registered modules only
  re-export propose.
- `review` imports core and the kernel and never `packages/play`, an
  application, `packages/adapters`, `packages/propose` or `packages/research`. It still reaches
  `tools/device/bundle.mjs` to compile a committed winner to its bundle hash;
  that edge closes when `tools/device` is sorted by context (migration M9).
- `trainer` depends on source, the kernel and browser-local presentation only.

`tools/architecture-test.js` enforces the rule over each module's syntax tree
(the pinned `typescript` parser): static imports, re-exports, dynamic
`import()`, `require()`, with planted violations that must be caught.

## Reconnaissance baseline

This proposal is grounded in the repository as it exists on 2026-08-31, not
only in the desired package diagram. The inventory found 105 `.mjs`, 81
`.py`, 57 `.sh`, 23 `.js`, 15 Java, four C, one assembly, and one C# source
file. Approximate source volume is 19.8k lines of MJS, 16.1k Python, 10.1k
shell, 7.2k JS, 6.1k Java, and 2.1k C. There are 66 Markdown files totalling
about 28.1k lines, of which about 16.2k are under `docs/` and 9.4k under
`plans/`.

The important implementation findings are:

- `src/engine.js` is the real canonical plant model, with `press`, `release`,
  `tick`, snapshot/restore, terminal state, and frame-stamped events. Its
  public mutable truth state is also consumed directly, so a narrow
  `PlantModel` facade and a separate privileged truth-sensor contract are
  needed before moving it.
- `tools/policy.mjs` defines a useful but implicit controller API—`reset` and
  `step` plus tap/hold/press/release scheduling—but `PolicyRun` also owns
  observation privilege, timing, simulated actuation faults, and reporting.
  Those are separate runtime services.
- `policy-v1`, `belief-v1`, `estimator-v1`, `reduced-v1`, and `cycle-v1`
  already contain the beginnings of the target contracts. Validation and
  supported action semantics are split across core and device files.
- `tools/device/recipe.mjs` compiles a simulation-derived schedule to an
  undocumented line language consumed by shell. `trial/01-arguments.sh`
  accepts roughly fifty positional values, and `trial.sh` assembles twelve
  remote shell fragments. This is the largest untyped interface in the
  project and the source of repeated agent inference.
- ADB, HID, screencap, MediaProjection, cue-helper, A2DP, PCM, simulator truth,
  and screencheck already exist as distinct implementations. Their shared
  roles are not represented by ports, while backend-specific assumptions are
  distributed across scripts, profiles, comments, and tests.
- `screencheck.c` is used as a native detector. It consumes an Android-style
  raw RGBA stream or host RGBA fixture, supports stats/count/match/classify,
  reads SCM1 models, writes fixed text, and uses exit statuses 0/2/3. The C is
  justified by its freestanding phone-side performance boundary; its process
  protocol is what needs formalization.
- The cue-helper exposes a bounded authenticated text protocol and several
  UDP channels. `fact-message-v1` and the 28-byte PCM header are implemented
  independently in JS, Python, Java, and C. One schema and cross-language
  golden vectors must replace semantic duplication.
- The session manifest and event stream already capture targets, clocks,
  artifacts, models, decisions, actions, outcomes, helper state, and
  redaction. They should be evolved, not replaced.
- Research code imports runtime values from files named as tests, including
  `DEFAULT_CYCLE`, `SEARCH_KNOBS`, and exported `run` functions. Several
  experiments mutate shared knobs. Production concepts must move into
  libraries; tests may import production code, never the reverse.
- `tools/test.mjs --engine`, described as the fast feedback lane, launched a
  very large concurrent group and had emitted no individual verdict after a
  measured 185 seconds when the reconnaissance run was stopped. Browser tests
  use fixed sleeps up to 58 seconds and grade real-time interactions under
  host scheduling load. The current suite itself documents load-dependent
  trainer results.
- The source fact index, Android group map, observation manifests, artifact
  hashes, and evidence labels already form a strong basis for structured
  knowledge navigation. A second manually maintained truth system would make
  this worse.

P0 must turn this baseline into checked-in generated inventories: import
graph, command registry, test/timing registry, protocol registry, adapter
registry, and duplicate-responsibility map. The inventory is a migration map,
not a permanent new bureaucracy.

## Language and file policy

The project needs several implementation languages because it crosses browser,
host analysis, Android, ESP32, freestanding native, and external-toolchain
boundaries. It does not need several languages to express orchestration and
domain policy. Reduce the general-purpose center to TypeScript/JavaScript;
retain boundary languages where their runtime or ecosystem earns their cost.

### TypeScript decision

Types would materially help this project. The most common failures are not
arithmetic mistakes; they are ambiguous records, invalid mode combinations,
units and clock confusion, optional capabilities, cross-layer imports, and
several implementations drifting from the same concept. Use strict TypeScript
for all **new or materially extracted long-lived code** in `core`, `runtime`,
`adapters`, `research` libraries, and the device composition root. TypeScript
replaces JavaScript in those ownership areas; it is not an additional parallel
implementation.

Adopt it incrementally:

1. Define plain-data contract types and runtime schemas first. Static types do
   not validate JSON, shell output, sockets, or Python/Java/C producers.
2. Enable `allowJs`, `checkJs`, strict checking, and generated declarations so
   existing `.js` can cross the package boundary during migration.
3. Write extracted modules as `.ts`; keep temporary `.js`/`.mjs` compatibility
   shims thin and delete them at P9.
4. Prefer erasable structural types, tagged unions, explicit units, and
   immutable inputs. Avoid decorators, TypeScript enums, namespace patterns,
   and type-level cleverness that hides the runtime shape.
5. Keep core runtime validation dependency-light. Select a schema tool in an
   ADR only after prototyping emitted JSON Schema and cross-language fixtures.

The type checker belongs in the fast lane and must complete within seconds.
Do not convert C, Java, Python analysis, shell, or C# merely to increase a
TypeScript percentage.

### One file, one contract

Every source file begins with a short role comment or module docstring when its
purpose is not obvious. It states responsibility, public inputs/outputs,
side effects, clock/unit assumptions, and safety consequences. Organize files
in this order: imports; public types/schema identifiers; constants; private
pure helpers; public API; optional CLI `main`. A CLI entry point parses and
renders; it does not own reusable logic. Tests mirror the owned module and use
behavioral names. Large-file review thresholds are 400 lines for general code,
250 for shell, and 700 for platform integration—not automatic failures, but a
required decomposition review.

### TypeScript and JavaScript

- Use `.ts` for owned package modules and `.js` ESM only for small dependency-
  free entry points or unmigrated code. With root `"type": "module"`, stop
  creating `.mjs`; it conveys no additional boundary.
- Use kebab-case file names, named exports, package `exports`, tagged unions,
  and explicit `Result`/typed errors at recoverable boundaries. Never export
  mutable global search knobs.
- Core code may not access DOM, filesystem, subprocess, environment, wall
  clock, or network APIs. Inject ports and clocks.
- Put reusable code under `src/`, CLI adapters under `bin/`, fixtures under
  `test/fixtures/`, and tests beside or mirroring `src/`. A file named
  `*test*` must never be a production dependency.

### Python

- Keep Python for offline media, signal, statistical, corpus, and artifact
  analysis where its ecosystem is valuable. Consolidate the 81 scripts into a
  few `src/`-layout packages with `pyproject.toml` and thin CLI modules.
- Use module docstrings, `from __future__ import annotations`, type hints,
  dataclasses for records, `pathlib`, explicit `main(argv)`, and standard/
  third-party/local import groups. Separate pure transforms from subprocess,
  filesystem, and network effects.
- Do not use path/import hacks or duplicate protocol constants. Load versioned
  schemas and golden fixtures. Python does not orchestrate the whole runtime.

### Shell

- Host wrappers use Bash, `#!/usr/bin/env bash`, `set -euo pipefail`, quoted
  arrays, functions, and a short `main`. Phone-side scripts target the declared
  Android `sh`/mksh subset, use `set -eu`, avoid Bashisms, and receive a single
  validated config/artifact rather than dozens of positional parameters.
- Shell owns build glue and operations that must run beside `adb`, `/dev/hidg`,
  or the phone clock. It never owns strategy, policy selection, rich JSON
  parsing, schema validation, or domain constants. Run ShellCheck in its own
  fast lane with the correct dialect.

### Java

- Java remains the Android helper language; do not introduce Kotlin during
  this refactor. Use one public class per file and immutable value objects.
- `Activity` owns UI and permissions, `Service` owns lifecycle and composition,
  protocol codecs own wire records, and detector classes remain Android-free
  where possible. Thread and callback ownership must be explicit.
- Split the current 2,388-line `CaptureService` and 1,338-line `MainActivity`
  by those responsibilities, retaining host-JVM tests for pure components.

### C and assembly

- C remains for ESP32 firmware and `screencheck`. Public contracts live in
  headers, implementations in `.c`; use fixed-width types, bounded buffers,
  validated version/length fields, explicit status returns, and one owner for
  wire constants. ESP32 task boundaries are separate modules.
- The freestanding screencheck build may use its constrained local types but
  must test its ABI and output grammar on the host.
- Assembly is only the documented freestanding entry/ABI shim. It may not
  accumulate detector or protocol policy.

### C#, HTML, CSS, JSON, JSONL, and Markdown

- C# stays isolated to the CTFAK plugin/toolchain boundary and emits a
  versioned derived artifact. It does not own the domain model.
- HTML is the trainer's semantic shell; CSS owns presentation and design
  tokens. Neither stores mechanics, policy, or evidence constants.
- JSON/JSONL carry versioned profiles, schemas, manifests, commands, events,
  traces, and results. Use stable IDs, canonical serialization where hashed,
  explicit units, and strict validation. JSON is not handwritten prose.
- Markdown owns explanation, decisions, evidence narratives, operations, and
  plans. Evidence records state authority, claim level, source IDs,
  limitations, reproduction, and retractions; ADRs state context, decision,
  and consequences; package READMEs state API and non-responsibilities.

## Conventional automation vocabulary

Use these names in code, schemas, CLIs, and package paths. The glossary is a
contract, not a documentation-only translation.

| Term | Meaning here |
|---|---|
| **Plant** | The system being controlled: the real FNaF process, or `Sim` as its evidence-labelled plant model. |
| **Reference / trajectory** | Desired control schedule or target behavior over time. |
| **Controller / control law** | Chooses semantic commands from a reference and current estimate. A strategy policy is a controller. |
| **Supervisory controller** | Selects modes, applies safety/interlock rules, handles desync, and may inhibit commands. |
| **Sensor** | Acquires a raw physical/digital signal: screencap, MediaProjection, A2DP PCM, direct game state. |
| **Signal processor / detector** | Converts raw frames or audio into features, classifications, or measurements. |
| **Measurement / observation** | Timestamped sensor-derived value with quality, validity, and provenance. |
| **Estimator / observer** | Updates controller state or belief from measurements and known commands. `Observer` has this narrow control-theory meaning. |
| **State estimate** | The controller's uncertain view of plant state, distinct from simulator truth. |
| **Control command** | Semantic requested actuation: press, release, select, hold. |
| **Actuator** | Applies commands to the plant: ADB input, HID, simulated delivery, or in-process injection. |
| **Actuation result** | Accepted, rejected, failed, or unknown outcome with send/landing/verification timestamps. |
| **Clock / time base** | Host monotonic, device uptime, game frame, audio phase, or simulator time plus declared mapping uncertainty. |
| **Transport** | Carries bytes or records: adb, USB/HID, socket, A2DP. It is not itself a sensor or actuator. |
| **Event** | A timestamped occurrence or transition, such as BB arrival or command rejection. A sampled value is a measurement, not an event. |
| **Telemetry** | Append-only measurements, commands, results, lifecycle events, and timing needed to reconstruct a run. |
| **Calibration** | Evidence binding sensor/actuator parameters to a device, build, geometry, and validity range. |
| **Disturbance / fault model** | Lateness, dropout, contention, seam loss, false detection, or other modeled deviation. |
| **Interlock** | A condition that refuses unsafe or invalid execution before or during a run. |

### Current-to-target naming map

| Current name | Target role/name |
|---|---|
| `Sim` | `PlantModel` implementation; retaining `Sim` as the concrete class is acceptable. |
| policy objects | controllers or control laws implementing `Controller`. |
| `Observer` | split into sensor model, detector model, and estimator. |
| `fact` | measurement when sampled; domain event when an occurrence; state estimate when inferred. |
| `fact-link` | measurement/telemetry transport. |
| `DeviceActuator` | simulated actuator/fault model unless it physically applies commands; do not imply live hardware. |
| `screencheck` | native signal processor used by a visual sensor adapter. |
| `trial.sh` | experiment executor compatibility launcher. |
| remote trial `driver` | remote actuator executor. Avoid “driver” unless it is a device/transport driver. |
| `preflight` | capability validator and safety interlock. |
| `grade-run` | experiment evaluator. |
| device `recipe` | trajectory/policy compiler. |
| model gate | simulation qualification gate. |

## Core data contracts

Use versioned plain-data objects, canonical serialization, runtime validation,
and strict TypeScript types, with JSDoc/`checkJs` across unmigrated modules.
Types are adopted at owned boundaries rather than by a bulk conversion. Every
wire or retained artifact has a schema version.

### Control command

```js
{
  schema: 'control-command-v1',
  id: 'cmd-42',
  action: { kind: 'press', control: 'mask' },
  requestedAt: { clock: 'game-frame', value: 720 },
  deadline: { clock: 'device-monotonic-ms', value: 12100 },
  source: { controller: 'minus7', policyHash: '...' }
}
```

Coordinates, shell text, HID bytes, and transport commands are forbidden in
the core action schema. Adapter-specific extensions live in adapter plans and
must not change the semantic command.

### Measurement

```js
{
  schema: 'measurement-v1',
  id: 'measurement-91',
  signal: 'left-opening',
  state: 'OBSERVED',
  value: 'bb',
  confidence: 0.94,
  observedAt: { clock: 'device-monotonic-ms', value: 12000 },
  receivedAt: { clock: 'host-monotonic-ms', value: 12231 },
  validUntil: { clock: 'device-monotonic-ms', value: 12480 },
  source: {
    sensor: 'screencap',
    detector: 'scm1',
    model: 'bb-left',
    calibrationProfile: 'runtime-gh'
  }
}
```

An unavailable or ambiguous read is the same envelope with `state: 'UNKNOWN'`
and a required reason. Unknown is never converted to a plausible negative by
an adapter.

### Actuation result

```js
{
  schema: 'actuation-result-v1',
  commandId: 'cmd-42',
  status: 'ACCEPTED',
  backend: 'hid-multi',
  sentAt: { clock: 'device-monotonic-ms', value: 12127 },
  verifiedAt: null,
  uncertaintyMs: 16
}
```

`REQUESTED`, `SENT`, `ACCEPTED`, `VERIFIED`, `REJECTED`, `FAILED`, and
`UNKNOWN` are distinct states. A legal HID report proves only `SENT`; it does
not prove the game accepted the control.

### Capability descriptor

Every adapter reports machine-readable capabilities and constraints:

```js
{
  adapter: 'actuator-hid-multi',
  actions: ['press', 'release', 'hold'],
  supportsMultitouch: true,
  maxContacts: 2,
  minimumContactMs: 33,
  minimumGapMs: 33,
  clock: 'device-monotonic-ms',
  latencyModel: 'g56-hid-2026-08-27',
  verification: 'external'
}
```

Policy compilation and qualification consume capabilities; they do not branch
on adapter names.

### Profile and calibration binding

A versioned profile composes a run:

```json
{
  "schema": "device-profile-v1",
  "name": "moto-g56-hid-screencap",
  "targetBuild": "com.scottgames.fnaf2:2.0.7+26",
  "clock": "device-uptime",
  "actuator": "hid-multi",
  "visualSensor": "screencap",
  "visualDetector": "scm1",
  "audioSensor": "a2dp-authority",
  "geometry": "g56-landscape-v1",
  "calibrations": {
    "left-opening": "runtime-gh",
    "actuator-timing": "g56-hid-2026-08-27"
  }
}
```

Environment variables may supply secrets, ephemeral endpoints, and explicit
one-run overrides. They are not the primary configuration model. The resolved
profile, overrides, adapter versions, hashes, and qualification result are
printed before actuation and retained in the session manifest.

### Contract specification standard

Every public, wire, process, and retained-artifact contract has one canonical
specification beside its owning package. It includes:

- stable contract ID, version, status, owner, purpose, and non-purpose;
- producers, consumers, dependency direction, fields, variants, units, ranges,
  identity, and canonical encoding;
- clock, ordering, concurrency, deadline, cancellation, and idempotency rules;
- capability, calibration, evidence scope, and preconditions;
- unknown, partial, invalid, timeout, rejection, and fail-closed behavior;
- effects, interlocks, persistence, redaction, compatibility, and deprecation;
- executable validation, conformance tests, and cross-language golden vectors.

TypeScript interfaces check code within one compilation graph. JSON Schema or
a deliberately small grammar validates runtime, retained, process, and
cross-language data. A boundary contract is incomplete if only one exists.

### Contract register and interface boundaries

| ID | Owner and boundary | Required invariant |
|---|---|---|
| `plant-model-v1` | core; runtime/research call reset, semantic apply, advance, snapshot/restore, and event/terminal queries | deterministic for model hash + options + seed + command trace; private truth is not a normal controller observation |
| `semantic-control-v1` | core; controller/supervisor output, scheduler/actuator input | semantic intent only; no coordinate, shell, HID, ADB, or transport encoding; stable command ID and explicit requested/deadline clocks |
| `policy-program-v1` | core; author/search to interpreter/compiler | finite validated phases/actions, observation privilege and capabilities declared; canonical hash survives equivalent serialization |
| `controller-v1` | core; runtime invokes controller | consumes reference + state estimate + logical time and returns commands/rationale; no I/O, direct sensor, wall clock, or actuator knowledge |
| `trajectory-v1` | runtime; compiler to scheduler/executor | ordered semantic commands with deadlines and policy hash; target encoding is a derived hashed artifact, never policy authority |
| `qualification-v1` | runtime/research; evaluator to run interlock | binds policy, model, fault/profile, seeds, sample, statistics, controls, verdict, and expiry; never implies device success |
| `raw-sample-v1` | adapters; sensor to detector/artifact store | format, dimensions/rate, acquisition clock, source, loss, and calibration context mandatory; payload may be content-addressed |
| `measurement-v1` | core; detector/source to estimator/telemetry | observed/received clocks, provenance, validity, confidence, and explicit unknown; missing is never false |
| `detector-v1` | adapters; raw sample to measurement | accepted formats/geometries/calibrations and model hash declared; invalid input rejected, not coerced |
| `state-estimate-v1` | core; estimator to controller/supervisor | observed, predicted, unknown, stale, and contradictory states remain distinct with uncertainty and evidence references |
| `supervisor-v1` | runtime/core; proposed to approved/rejected commands | deterministic interlock decisions and reason codes; recovery is bounded and declared |
| `clock-v1` | core; every timed contract | named monotonic domain, value/unit; mappings carry uncertainty and validity; wall time is metadata, not scheduling authority |
| `actuator-v1` | core port/adapters; approved command to result | capability checked, command ID idempotent per session, overlap declared, abort/release bounded; send does not imply physical acceptance |
| `capability-v1` | adapters; registry/profile/preflight | machine-readable controls, timing, concurrency, formats, transports, and limitations; absence fails closed |
| `calibration-v1` | adapters/evidence; profile binding | device/build/geometry/implementation hashes, method, sample, uncertainty, validity, expiry, and evidence artifacts named |
| `device-profile-v1` | device app; composition input | references registered adapters/calibrations; resolved profile immutable and retained; overrides explicit and hashed |
| `telemetry-event-v1` | runtime; components to append-only session log | event/session/type/component, clocks, causal IDs and redaction present; no silent mutation |
| `session-manifest-v1` | runtime; run to grader/index | binds target, resolved profile, artifacts, models, controller, clock alignments, lifecycle, outcome, redaction, and hashes |
| `experiment-spec-v1` | research; CLI to executor | operation/hypothesis, candidate space, evaluator, model/profile, seeds/sample/stopping rule, objectives, controls, artifacts, and claim ceiling |
| `experiment-result-v1` | research; executor to index/report/review | structured verdict and metrics first; reproducer and provenance mandatory; prose and plots are derived |
| `trainer-trace-v1` | trainer; recorder to analysis | scenario/model, stimuli, semantic actions, clocks, grading, consent/redaction; never device evidence |
| `artifact-ref-v1` | runtime/research; records to store | content hash, media type/schema, producer, size, retention/redaction, and locator; path alone is not identity |
| `claim-evidence-v1` | evidence; knowledge index | stable IDs, typed edges, evidence labels, source locations, support/refutation/supersession; generators cannot promote claims |

Existing physical and process boundaries receive explicit codecs:

- **`screencheck-process-v1`:** documented Android raw-header/RGBA or host
  fixture input, SCM1 version and ROI, versioned stdout grammar, stderr logs,
  and distinct usage/geometry versus data/model failure statuses.
- **`cue-helper-control-v1`:** authenticated bounded ASCII request/response on
  loopback TCP 49707 or the abstract socket. Current operations are `GET`,
  `GRID`, `WATCH`, and `READ`; stale removed operation parsing is deleted.
- **`fact-message-v1`:** bounded NDJSON measurements/events with sequence,
  state, value/reason, confidence, source, calibration, clocks, and latency
  bounds. JS/TS, Python, Java, and C share valid/invalid golden fixtures.
- **`pcm-udp-v1`:** the existing 28-byte little-endian header owns magic,
  version, channels, format/rate, sequence, capture time, and payload length;
  receivers expose gaps and reject incompatible versions.
- **`hid-executor-v1`:** a versioned trajectory/command stream in, JSONL
  command/result/mark events out, with semantic IDs, 12-byte report evidence,
  device-clock timing, release state, and abort result. A legal report proves
  send, not game acceptance.
- **`device-executor-v1`:** replaces the roughly fifty-position shell
  boundary. One resolved run bundle contains profile, policy/trajectory hashes,
  semantic control map, coordinates, calibration, endpoints, safety limits,
  and expected artifacts. The executor verifies the bundle and emits the
  session stream.

Protocol implementations may be plural; protocol ownership is singular.
Generated bindings are optional, but golden-vector conformance is mandatory
when a format crosses JS/TS, Python, Java, or C.

## Ports and adapters

Define narrow ports owned by core/application semantics:

```js
Sensor.capabilities()
Sensor.sample(request) -> RawSample

Detector.detect(rawSample) -> Measurement
Estimator.update(measurements, actuationResults, time) -> StateEstimate
Controller.step(reference, stateEstimate, time) -> ControlCommand[]
Supervisor.review(commands, stateEstimate, capabilities) -> ApprovedCommand[]
Scheduler.dispatch(command, clock) -> ActuationResult
Actuator.apply(command) -> ActuationResult
Telemetry.append(record)
ArtifactStore.retain(artifact)
```

Do not force every physical path through a raw-frame interface. A sensor that
already emits a calibrated measurement may implement a composed
`MeasurementSource`; its provenance must still name acquisition and detection.

### Actuator adapters

- `AdbTapActuator`: simple, serialized, host-mediated, limited timing and hold
  semantics.
- `HidActuator`: report-level contacts, multitouch, device-side scheduling, and
  explicit release semantics.
- `SimActuator`: exact or injected-fault delivery into `Sim`; clearly labelled
  as a model, not a hardware claim.
- future `InApkActuator`: same-process action application with its own
  capability and verification contract.

Each adapter passes a shared actuator conformance suite plus backend-specific
tests. The shared suite tests semantic requirements, rejection, ordering,
timestamps, and capability honesty; it does not impose the lowest common
physical denominator.

### Device control service and actuator MCP

*Retired 2026-09-25 (`6d78c7e`).* The service below was built as a fixture
path, never played a night, and was removed with `packages/runtime`; the
campaign executor is the one path onto a phone, and the Cue Helper MCP
(`apps/desktop/src/cue-helper-mcp.mjs`) is the agent surface that stays. The
section is kept as the design that was tried.

Introduce one local `DeviceControlService` over the actuator, sensor,
scheduler, profile, session, and safety contracts. It owns device selection,
exclusive session lease, resolved profile, semantic-to-physical mapping,
preflight, bounded execution, emergency release/abort, and retained results.
The CLI, dry-run harness, and any agent integration are clients of this same
service. An AI agent must never infer input mode, display geometry, coordinates,
contact timing, ports, or calibration from prior conversation; the service
returns them from validated registries and profiles or refuses the operation.

An optional **actuator MCP server is recommended as a P5 deliverable**, but it
is an agent-facing orchestration adapter—not the scheduler, hard real-time
protocol, or source of device truth. Expose semantic, bounded tools such as:

```text
devices.list
profiles.list / profiles.resolve
device.capabilities
device.preflight
session.start / session.status / session.abort
sensor.sample
actuator.apply
trajectory.execute
artifacts.list / artifacts.read
```

Mutating calls require a session lease, profile/hash, idempotency key, bounded
deadline, maximum action count/duration, and explicit dry-run/live mode.
`trajectory.execute` hands a validated bundle to the local executor and returns
immediately with a run ID; it does not stream every frame through MCP. Raw tap
coordinates and arbitrary shell execution are excluded from the normal tool
surface. Every call emits telemetry, live mode is visibly identified, abort is
always available, and MCP failure causes bounded release/cleanup. This makes
agent operation discoverable and repeatable without making an LLM part of the
control loop.

### Sensor and detector adapters

```text
ScreencapSensor ------> SCM1 / ROI detectors --------> Measurements
MediaProjectionSensor -> grid / pixel detectors ------> Measurements
A2dpSensor -----------> audio cue detectors ----------> Measurements
CueHelperSensor ------> declared feature detector ----> Measurements
SimTruthSensor ---------------------------------------> privileged oracle only
```

Raw sources and detectors are independently swappable only when their declared
geometry, format, and calibration match. A detector trained on screencap is not
silently valid for MediaProjection. `SimTruthSensor` is an upper-bound research
control and may never be selected by a production device profile.

### Timing

Make clock domains values, not comments. Policies may use game frames;
schedulers use monotonic deadlines; adapters return their native timestamps;
calibrations map between domains with uncertainty. No controller uses
`Date.now()` directly. Re-anchoring applies only at declared safe boundaries.

## Control architecture

### Open-loop control

```text
reference trajectory -> scheduler -> actuator -> plant
```

Use this for the scheduled portion of Minus 7 and other fixed programs.

### Closed-loop and supervisory control

```text
plant -> sensor -> detector -> estimator -> controller -> supervisor
  ^                                                         |
  +-------------------- actuator <- scheduler <--------------+
```

Use this for threat responses, desync recovery, belief-state cycle selection,
and safety interlocks. The scheduled base policy and reactive supervisor remain
separate so a correction cannot silently rewrite the qualified trajectory.

The policy IR from Plan 21 is the canonical finite controller representation.
The runtime interprets it. Simulator and device compilation must continue to
pass semantic equivalence. Arbitrary shell or JavaScript callbacks are not part
of the policy language.

## Research and search architecture

Search is not generic tooling. It is the project's experimental method and a
first-class consumer of core.

### Search scopes and names

| Research operation | Existing examples | General goal |
|---|---|---|
| **Controller synthesis** | `strategysearch`, `gatesearch`, policy grammar search | Find viable control laws in a declared structural/action space. |
| **Trajectory/parameter optimization** | `cyclesearch`, `paramsearch`, `geometrysearch` | Optimize timings, schedule geometry, and controller parameters. |
| **Model discrimination / hypothesis probe** | `androidstalltest`, `n7probe`, family probes | Determine which proposed mechanism or policy outcome follows from the declared model. |
| **Robustness and sensitivity analysis** | `latenesssweep`, `phasesweep`, `i10latency`, `flicksweep` | Quantify margins, knees, and response to one or more disturbances. |
| **System identification / device characterization** | HID spacing, contact, sensor latency probes | Measure plant-interface parameters and calibrate an adapter/profile. |
| **Conformance/regression test** | `simtest`, `policytest`, equivalence tests | Protect an existing contract. These are tests, not searches. |

Rename CLIs toward the operation they perform while keeping temporary aliases.
“Search” alone is not a sufficient scope.

### Shared experiment contract

```text
ExperimentSpec
  -> CandidateGenerator
  -> Evaluator(core plant + policy + declared fault/adapter models)
  -> Objectives and Constraints
  -> Aggregator/statistics
  -> ResultArtifact + human report
```

An experiment specification declares:

- target build and plant-model hash;
- controller/policy family and candidate space;
- observation privilege and sensor budget;
- actuator/fault profile;
- seeds, sample size, confidence contract, and stopping rule;
- objectives, hard constraints, baselines, and negative controls;
- retained artifacts and claim level.

Candidate generation may be exhaustive enumeration, grid sweep, hill climb,
beam search, Monte Carlo, or Pareto search. Evaluation does not depend on the
generator. One shared worker pool executes pure evaluations.

Results are structured before they are rendered:

```js
{
  schema: 'experiment-result-v1',
  operation: 'controller-synthesis',
  verdict: 'KNOWN_NEGATIVE',
  candidate: { cameras: [6, 7] },
  objectives: { survivalRate: 0 },
  sample: { firstSeed: 1, count: 1200 },
  confidence: { method: 'wilson', level: 0.95 },
  failureModes: { 'withering-freddy-uncovered': 873 },
  modelHash: '...',
  claimLevel: 'MODEL_ONLY'
}
```

Allowed high-level statuses include `CANDIDATE`, `ROBUST`, `KNOWN_NEGATIVE`,
`MODEL_ONLY`, `DEVICE_MEASURED`, and `INCONCLUSIVE`. Plan 12 remains the
authority for promotion beyond these descriptive statuses.

Search code must not import trainer UI or live device shell internals. Hardware
characterization uses adapter ports and emits calibration evidence; it does not
become a policy search merely because it explores several parameter values.

## Evidence without paperwork

Evidence is an automatic product of supported work, not a second narrative task
performed after the command finishes. Any supported command capable of printing
a claim, comparison, rate, timing, or promotion-relevant verdict must emit a
versioned machine-readable result and a stable evidence/run ID in the same
execution. A quotable number without that result reference is an incomplete
command, not an invitation for the operator to transcribe it into Markdown.

The runtime fills everything it can know: session identity, operation, Git
state, resolved model/policy/profile and hashes, seeds/sample/stopping rule,
clock mappings, capabilities, calibrations, semantic inputs/events, controls,
artifacts, evaluator version, verdict, and claim ceiling. Humans supply only
meaning automation cannot infer safely: experiment intent or hypothesis,
consent/retention choice for sensitive media, and an explicit request to propose
promotion. Grading and promotion consume the retained result; they never ask a
human to re-enter its numbers.

Every completed command prints a concise terminal record such as:

```text
result=KNOWN_NEGATIVE claim=MODEL_ONLY evidence=run-20260831-0042
```

The evidence CLI makes retained work useful during ordinary diagnosis:

```sh
npm run evidence -- list
npm run evidence -- show RUN_ID
npm run evidence -- diff RUN_A RUN_B
npm run evidence -- replay RUN_ID
npm run evidence -- why RUN_ID
npm run evidence -- promote RUN_ID
```

`why` follows causal IDs through measurement -> estimate -> controller decision
-> supervision -> actuation -> outcome and exposes UNKNOWN, rejection, dropout,
and unverified boundaries. `promote` only proposes the existing result to Plan
12's gate; it cannot raise the claim ceiling itself.

Retention is graduated rather than universal:

1. Ordinary unit/edit-loop results are ephemeral and concise.
2. Named experiments and regressions retain structured results, fixed inputs,
   and a reproducer.
3. Device runs and promotion candidates retain the complete manifest,
   telemetry, calibration binding, grading, and artifact hashes.
4. Promoted claims and known negatives commit a small claim/result record and
   content references; large or sensitive media remains in the authorized
   artifact store under declared retention and redaction.

Record semantic transitions and causal references by default, not indiscriminate
raw streams. Large media and high-rate samples are separate content-addressed
artifacts. Generated indexes discover bundles and propose missing graph edges;
humans approve authoritative claim, promotion, supersession, and retraction
edges. Evidence tooling is accepted only when it shortens replay, comparison,
or failure diagnosis as well as preserving proof.

## Documentation and repository front door

Markdown remains the correct medium for narrative evidence and research, but
not for every kind of truth.

### Root README contract

The root README is a landing page, not the complete research corpus. Its first
screen answers:

1. What is this? An evidence-driven study of the modern Android FNaF 2 target.
2. Why does it exist? To understand, derive, embody, and prove control of 10/20.
3. What is in scope? Android source evidence, canonical model, policy research,
   trainer, stock-device control, in-APK research, and proof artifacts.
4. What is not claimed? PC equivalence, device-general calibration, or a live
   controller result above its evidence rung.
5. Where should I go? Routes for a player, researcher, model developer, device
   developer, and reviewer.

It then shows the five charter layers—Truth, Understanding, Decision,
Embodiment, Proof—as the repository map. The trainer is named as the current
public application under Understanding, never as the canonical source or the
whole mission.

The README keeps only:

- vision, mission, canonical target, and scope;
- a compact system map and current-status summary;
- five root commands;
- persona-based navigation;
- claim/evidence warning;
- links to package and evidence documentation.

### Documentation ownership

```text
README.md                       vision, scope, status, navigation
CONTRIBUTING.md                 clean-checkout developer workflow
CLAUDE.md                       concise repository operating discipline
packages/*/README.md            package responsibility and public API
docs/architecture/              current dependency and data-flow truth
docs/decisions/                 short architectural decision records
docs/evidence/android/          source/decompile evidence
docs/evidence/device/           calibration and run evidence
docs/research/                  hypotheses, campaigns, negative results
docs/operations/                procedures with safety consequences
plans/                          future work and completion gates
```

### `CLAUDE.md` operating contract

Retain a root `CLAUDE.md` after the refactor, but change its job. It is the
short operating constitution that a human or coding agent reads at the start
of work, not an incident archive, architecture manual, command catalog, or
second copy of executable configuration. It protects the disciplines most
likely to be lost when code becomes easier to move:

- the canonical Android target and the five-layer charter;
- evidence labels and Plan 12's prohibition on silent claim promotion;
- package ownership and dependency direction, including the sandbox one-way
  rule and the ban on production imports from tests/reports;
- characterize -> change -> compare -> switch -> remove-shim migration order;
- dry-run by default, explicit live-device mode, resolved profiles, bounded
  actuation, retained telemetry, and fail-safe abort/release;
- required controls for numbers, explicit UNKNOWN/failure states, and the rule
  that retractions and known negatives remain discoverable;
- the session-finish obligation: run the affected gates, update the structured
  result/progress record, reference its generated evidence ID rather than
  writing a parallel evidence log, and state exactly what remains open.

The file links to the charter, current architecture, generated command and
contract catalogs, evidence policy, operations safety page, and
`plans/PROGRESS.md`; it does not reproduce their tables or current values.
Dated incident narratives in the present file move to the owning evidence,
research, operations, or ADR record before their old text is shortened. A
small checked-in set of especially costly prohibited shortcuts may remain when
the concise rule cannot be derived safely from a catalog, but each carries a
stable incident/evidence ID rather than an unindexed chronology.

Keep `CLAUDE.md` curated and short enough to read at the beginning of every
session. CI validates its links and stable IDs. Changes to it receive the same
review as an architecture or safety contract, and generated tooling must never
overwrite it.

Move historical incident narratives out of operational code comments when the
code is next touched. Code comments explain the current invariant and link to a
decision/evidence record for chronology. Retractions and negative results are
never deleted.

Detailed command discovery moves from the manually maintained `tools/TOOLS.md`
table to workspace scripts, CLI `--help`, and a small machine-readable command
registry if cross-command indexing is still needed. A generated catalog may be
published from that registry; prose is not its source of truth.

Configuration, capabilities, schemas, calibration bindings, and tool status
become structured data. Markdown explains them but does not duplicate their
authoritative values.

### Knowledge architecture: index first, graph where relationships matter

Do not create a separately edited wiki. It would become a second mutable truth
beside Git. Generate a **wiki-like static documentation portal** from repository
Markdown, package docs, contract/schema registries, claim/evidence records,
command metadata, and source annotations. It is versioned with the code,
reviewable in pull requests, searchable locally, and publishable as static
pages. The root README remains its front door.

Use layered retrieval, each layer derived from canonical repository data:

1. `rg` and editor language indexes for exact source/prose lookup.
2. Generated catalogs for packages, concepts, contracts, protocols, commands,
   adapters, capabilities, profiles, calibrations, experiments, tests, and
   artifacts.
3. Session/result indexing from manifests and JSONL. A local SQLite full-text
   database is acceptable as an ignored reproducible cache; Git JSON/JSONL and
   content-addressed artifacts remain canonical.
4. A lightweight typed claim/evidence graph for questions that lexical search
   cannot answer safely.
5. Optional semantic retrieval only after the deterministic layers have a
   measured failure case.

The graph is versioned records, not a required Neo4j service. Useful nodes are
`Concept`, `Claim`, `Mechanic`, `SourceGroup`, `Constant`, `ModelRule`, `Test`,
`Policy`, `Experiment`, `Run`, `Artifact`, `Adapter`, `Calibration`,
`DeviceProfile`, and `Outcome`. Useful edges include `SOURCED_BY`,
`IMPLEMENTED_BY`, `TESTED_BY`, `ASSUMES`, `CALIBRATED_BY`, `EVALUATED_ON`,
`PRODUCED`, `SUPPORTS`, `REFUTES`, `SUPERSEDES`, and `PROMOTED_BY`. Existing
source-fact indexes and observation manifests seed it. Humans curate
authoritative claims and edges; generators may detect references and propose
missing links but may not infer evidence promotion.

### Comments are indexed knowledge, not hidden knowledge

Keep local explanations in code when proximity matters. Any comment that is
the only explanation of a cross-package invariant, protocol choice, sourced
mechanic, safety constraint, calibration assumption, or historical correction
must carry a stable reference such as `CONTRACT:hid-executor-v1`,
`CLAIM:android.g779.empty-hall`, `ADR:0007`, or `EVIDENCE:runtime-gh`.
The documentation portal generates reverse links from those references:

```text
concept/claim page -> explanation and authority
                   -> implementing source locations
                   -> contracts and tests
                   -> evidence, experiments, runs, and retractions
```

The comment owns the local “why this code is shaped this way”; the linked
contract/evidence/ADR owns the shared context. CI rejects unknown IDs and can
report cross-package invariants that have no documentation thread. Generated
source locations are indexes, not hand-maintained Markdown file/line tables.

### RAG decision

Do **not** make RAG a core project dependency now. At 28k Markdown lines plus
structured indexes, deterministic search and typed relationships are cheaper,
reproducible, and safer for evidence-sensitive work. Embedding retrieval can
be stale, opaque about omissions, and especially dangerous when nearby text
contains retracted or differently scoped claims.

A later local read-only assistant may add hybrid lexical/semantic retrieval if
it beats the deterministic index on a checked-in benchmark of newcomer,
architecture, protocol, mechanic, evidence, and operational questions. It
must return stable source IDs and links, expose index version, keep authority
and retraction metadata, and never be used as a test oracle, promotion gate, or
canonical store. RAG is therefore an optional view over the knowledge system,
not the knowledge system itself.

## Developer command surface

The root package is private and uses the project scope consistently:

```json
{
  "name": "fnaf2-1020",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"]
}
```

The README presents five safe, non-live front-door commands after bootstrap:

```sh
npm ci
npm test
npm run build:trainer
npm run serve:trainer
npm run research -- --help
npm run device:dry-run -- --profile fixture-hid-screencap
```

The full supported surface also includes focused and explicitly live commands,
documented outside the README's first screen:

```sh
npm run test:core
npm run evidence -- list
npm run device:run -- --profile moto-g56-hid-screencap --policy minus7
npm run device:grade -- RUN_NAME
```

`npm ci` is required for canonical cross-workspace package resolution and the
pinned development toolchain. Runtime dependencies remain a separate decision:
none enters core or trainer without an ADR. Keep the documented bare-Node
offline/core path through the compatibility period. The trainer may gain a
build step only if the decision is explicit and the published static artifact
remains reproducible. A workspace layout does not by itself justify a bundler
or framework.

A clean checkout includes fixture profiles, fake ADB/HID transports, synthetic
sensor samples, and non-proprietary model fixtures sufficient for
`device:dry-run`. Real game assets, recordings, and calibrated local models
remain ignored and separately authorized.

## Testing and hypothesis-iteration architecture

The suite must protect evidence without making every edit pay for every
campaign. Classify tests by contract and cost; do not call statistical sweeps,
real-time browser rehearsals, and hardware qualification “unit tests.”

| Lane | Purpose | Determinism and target |
|---|---|---|
| `test:unit` | pure functions, reducers, codecs, validators, controller decisions | hermetic; fixed clock/RNG; sub-second target, 2 s budget |
| `test:contracts` | port conformance and cross-language protocol golden vectors | fixtures/fakes only; under 10 s |
| `test:core` | plant characterization and short seeded semantic traces | deterministic shards; under 15 s on a developer machine |
| `test:affected` | package graph selects unit/contract tests affected by the change | default watch/edit loop; under 10 s |
| `test:simulation` | population checks, robustness margins, properties, exhaustive sweeps | fixed seeds/sample; parallel workers with per-case results; CI or explicit local run |
| `test:trainer` | DOM/UI state, rendering, trainer trace and accessibility | virtual game clock for behavior; under 30 s |
| `test:browser:realtime` | minimal browser/timing smoke tests that genuinely require wall time | isolated resources, event waits, explicit tolerance; nightly/release |
| `test:device:dry` | composition, executor, profiles, fake ADB/HID/sensors, cleanup | hermetic fixture device; under 30 s |
| `test:device:bench` | attached-device capability/calibration/latency characterization | opt-in, device/profile labelled; produces evidence, not generic pass/fail |
| `test:device:qualification` | bounded live policy/pilot and promotion gates | explicit operator/live mode; retained session artifacts; never ordinary CI |

Rules for eliminating flakes and latency:

- Inject logical clocks, RNGs, transports, sensors, and temporary artifact
  stores. Unit tests never sleep, bind a well-known port, discover local
  devices, depend on Chrome scheduling, or share mutable search knobs.
- Replace browser `sleep(47000)`-style synchronization with virtual-time
  advancement or observable state/event waits. Keep only a tiny real-time
  calibration smoke lane because virtual time cannot prove scheduler behavior.
- Split production exports out of `bbtest.mjs`, `hidpilottest.mjs`, and other
  test/report files. Each test gets fresh immutable experiment parameters.
- Stream each test result as it completes, impose declared per-test timeouts,
  record duration history, show the slowest tests, and fail on orphaned child
  processes. Buffering the entire group makes a hang indistinguishable from
  productive work.
- Parallelize CPU-pure simulation in a bounded worker pool. Do not parallelize
  tests contending for Chrome, ports, ADB, USB, audio, or a physical device.
- A retry cannot turn red into green. CI may rerun a failure once only to
  classify and quarantine a known flake; both outcomes are retained and the
  lane remains non-green until an owner fixes or explicitly removes the gate.
- Statistical assertions declare model hash, seed schedule, sample size,
  confidence/stopping contract, and expected range. Small invariant fixtures
  catch coding regressions; campaigns establish scientific margins.
- Cache only content-addressed build/model artifacts. Never cache a verdict
  whose complete inputs are not in its key.

During P0, run every current test in isolation at least three times and record
duration, shared-resource use, fixed sleeps, subprocesses, and failures. This
produces a test manifest with owner, lane, contracts covered, timeout, fixtures,
and required capabilities. The measured 185-second no-verdict `--engine` run
sets the baseline; P9 must demonstrate the targets above or document a narrow
exception with evidence.

## Work packages

### P0 — Characterize and freeze boundaries

- Record the current import graph, supported commands, test groups, generated
  remote-driver trace, policy/plan hashes, and representative simulator result
  artifacts.
- Generate the language/line inventory, duplicate-responsibility map, contract
  and protocol register, adapter registry, and test manifest with isolated
  duration/flakiness measurements. Identify production imports from test files,
  mutable global experiment parameters, copied wire constants, and stale
  protocol branches.
- Add architectural tests that fail on browser globals in proposed core
  modules, direct device-shell imports from research, and unregistered live
  actuation.
- Select equivalence fixtures for Minus 7, standard Minus Toys, Minimal Minus
  Toys, one reactive branch, one known-negative search, and one screencheck
  classification.

**Done when:** an intentional semantic perturbation fails at least one fixture,
and every later move has a before/after contract. No files move in P0.

### P1 — Establish the front door and workspace command surface

- Add the private root workspace and package manifests without changing module
  locations.
- Commit the npm lockfile, pin TypeScript and other admitted development tools,
  and make `npm ci` create the canonical workspace links. Retain a documented
  bare-Node compatibility lane until P9.
- Expose wrappers for the existing suite, trainer build, research commands,
  device dry-run, device execution, and grading.
- Rewrite the root README to the contract above and reduce CONTRIBUTING to one
  clean-checkout path plus links.
- Add the system map and persona routes before changing internal paths.
- Add strict shared TypeScript/check-JS configuration and fast type checking,
  but do not convert files mechanically before their ownership is settled.
- Establish `test:unit`, `test:contracts`, `test:affected`, and explicit slow
  lane commands; stream individual verdicts and enforce per-test timeouts.

**Done when:** a newcomer can explain the five-layer mission and find each
major subsystem from the README; every existing canonical command is reachable
through a documented root command; the old direct commands still work.

This package intentionally supersedes Plan 18's blanket “no `node_modules`” and
no-`package.json` constraints for development. The replacement is narrower and
testable: a committed lockfile, pinned development-only tools, no shipped
`node_modules`, no runtime dependency in trainer/core without an ADR, and no
trainer build-system tax merely because workspaces exist.

### P2 — Extract `@sixam/core` and make the trainer a leaf

- Move mechanics, RNG, evidence-labelled configuration, policy IR, reduced
  model, belief/estimation, cycle planning, and semantic controller contracts
  into core subdomains.
- Split trainer presentation configuration from sourced mechanics and
  device/profile constraints.
- Move UI, browser input, audio, assets, lane, curriculum, coaching display,
  and browser entry point to `apps/trainer`.
- Update tools to import package exports, not trainer paths.
- Retain temporary `src/*.js` re-exports with deprecation comments.
- Extract production concepts currently exported by test files and replace
  mutable `SEARCH_KNOBS`-style globals with immutable experiment inputs.
- Author materially extracted stable modules in strict TypeScript while
  preserving JS compatibility exports during the bounded migration.

**Done when:** core imports and tests under Node with no DOM stubs; the trainer
build and browser suite remain equivalent; no research/device module imports
`@sixam/trainer`; every old `src` shim has a named removal owner.

### P3 — Land automation contracts and vocabulary

- Implement and validate command, measurement, event, state-estimate,
  actuation-result, capability, clock, calibration, and profile schemas.
- Split the existing simulated `Observer` into sensor models, detector models,
  and estimator inputs without changing its baseline traces.
- Narrow `fact-link` into a versioned measurement/telemetry transport or
  provide an explicit compatibility codec.
- Rename public APIs according to the glossary; retain aliases only at package
  boundaries.
- Publish every register entry using the contract specification standard,
  including JSON/runtime validation, clock/unit semantics, error behavior,
  compatibility policy, and conformance fixtures.
- Consolidate fact/PCM/cue-helper/screencheck/HID/device-executor protocol
  constants and add cross-language golden valid/invalid vectors.

**Done when:** the same controller runs against truth, simulated measurements,
and fixture device measurements without changing its API; unknown measurements
cannot be mistaken for negatives; terms in public code match the glossary.

### P4 — Wrap every current sensor and actuator as an adapter

- Implement ADB, HID, simulated, screencap, MediaProjection/cue-helper, A2DP,
  and clock adapters around existing behavior.
- Separate acquisition from detection and require calibration compatibility.
- Add shared conformance suites and adapter-specific fixtures.
- Add an adapter registry that reports status, capabilities, required artifacts,
  calibration scope, and claim level.
- Make a new implementation local: its module, registry entry, profile fixture,
  and conformance test. Remove backend switch statements from controllers and
  research code.

**Done when:** selecting ADB versus HID or screencap versus MediaProjection is a
profile change; policy and controller code do not branch on those backend
names; a mismatched detector/sensor calibration is refused.

### P5 — Extract the runtime and retire `trial.sh` as architecture

- Move host-side argument parsing, resolved configuration, qualification,
  building, deployment, session manifest, lifecycle, cleanup, and error
  reporting into `@sixam/device` and runtime services.
- Keep phone-side shell only for operations that must execute near Android:
  device monotonic scheduling, HID writes, local screencap/classification, and
  bounded cleanup.
- Make the remote executor consume only compiled, hashed policy/trajectory
  artifacts and profiles.
- Express reactive actions through the same command/supervisor/actuator
  contracts as scheduled actions and price them explicitly.
- Turn `trial.sh` into a short compatibility launcher, then remove it after
  command and trace equivalence.
- Introduce `DeviceControlService`; make CLI and dry-run clients of it (done, then
  retired on 2026-09-25 in `6d78c7e`: it never played a night). Replace
  inferred coordinates/modes and positional shell arguments with resolved,
  validated, hashed run bundles.
- Make dry and live execution emit their result/evidence ID automatically;
  grading consumes that bundle and never requires configuration or measured
  values to be re-entered.
- Add the optional actuator MCP as a bounded semantic orchestration adapter
  over that service, with leases, idempotency, live/dry mode, telemetry, and
  fail-safe abort. Keep scheduling and the control loop outside MCP.

**Done when:** the host orchestration is testable with fake transports; the
remote shell contains no strategy selection or duplicated policy constants;
fixture and live composition use the same runtime; every actuation is tied to
an approved command and retained result.

### P6 — Consolidate research around the experiment contract

- Inventory every `*search*`, `*sweep*`, `*probe*`, and policy report by the
  research taxonomy above.
- Extract candidate generation, pure evaluation, worker-pool execution,
  statistics, rejection reasons, and artifact rendering.
- Port controller synthesis, cycle optimization, one robustness sweep, one
  model probe, and one device-characterization experiment as reference cases.
- Emit structured results first and derive console/Markdown/graph reports from
  them.
- Require every claim-producing experiment command to create its evidence ID
  and result bundle automatically. Implement `evidence show`, `diff`, `replay`,
  and causal `why` over the reference experiment cases.
- Preserve legacy commands as aliases until the old and new result artifacts
  match on fixed seeds.
- Establish the graduated `research/sandbox` -> named experiment -> shared
  library -> runtime promotion path so probes remain cheap without becoming
  accidental infrastructure. (Superseded 2026-09-29: no sandbox, ADR 0002
  principle 7; `research/sandbox/` is deleted.)

**Done when:** a search algorithm can be changed without rewriting evaluation;
all promoted findings name model/profile/hash/sample/confidence/control; a
known-negative campaign replays from its artifact; regression tests are no
longer presented as searches.

### P7 — Reorganize native screencheck without rewriting it

- Move the C source, AArch64 entry shim, build, benchmark, and host conformance
  test into the screencheck workspace.
- Define stdin/stdout framing and classification output as a detector adapter
  contract.
- Retain the freestanding libc-free build and its no-APK/no-root property.

**Done when:** screencheck builds and tests independently; the device visual
adapter can substitute a fixture process; no core or controller module knows
that the implementation is C.

### P8 — Restructure documentation and machine-readable inventories

- Move current architecture, decisions, evidence, research, and operations to
  their target owners using redirects/links before deleting old paths.
- Replace command/tool-table enforcement with executable command registration
  and generated discovery.
- Convert capabilities, profiles, calibration bindings, schema versions, and
  adapter maturity to structured manifests.
- Keep plans as plans and move completed current behavior into package or
  architecture documentation.
- Refactor the root `CLAUDE.md` into the concise operating contract above.
  Relocate its dated incident history to owning evidence/research/operations
  records without deleting retractions, then validate every retained stable
  reference and link.
- Add stable concept/claim/contract/evidence IDs to cross-cutting source
  comments and validate them. Generate reverse source/test/evidence links.
- Create the layered indexes and lightweight claim/evidence graph, then publish
  a wiki-like static portal from repository truth. Do not create a separately
  edited wiki or mandatory RAG service.
- Complete the evidence CLI with `list` and gated `promote`; apply the graduated
  retention policy and generate proposed graph edges from retained bundles
  without granting generators promotion authority.
- Define a retrieval benchmark before considering an optional local hybrid
  lexical/semantic assistant.

**Done when:** README and package docs describe the current system without
reconstructing it from plans; `CLAUDE.md` states the repository discipline
without duplicating executable registries or serving as an incident archive;
operational procedures contain only current steps; history and retractions
remain searchable; CI detects unregistered commands, unknown stable IDs, and
broken documentation links.

### P9 — Remove compatibility surface and audit the result

- Remove `src` re-exports, old CLI aliases, duplicated environment variables,
  inline policy schedules, and obsolete tool-index entries only after their
  gates pass.
- Run the complete engine, browser, research fixture, device dry-run, shell,
  Python, and native suites.
- Re-run the architecture audit for dependency direction, terminology,
  capability honesty, clean-checkout workflow, and evidence traceability.
- Demonstrate the fast-lane budgets, isolate real-time and live-device gates,
  and resolve/quarantine every known flake without making retries authoritative.
- Measure change locality by adding one fixture actuator and detector without
  edits to controller policy, shell branches, or hand-maintained doc tables.

**Done when:** no production path depends on compatibility shims; there is one
canonical import and command for each supported responsibility; the audit has
no unexplained cross-layer dependency.

## Migration sequence and controls

Execute P0 and P1 first. P2 and P3 establish ownership and contracts. P4 may
then wrap implementations without changing them. P5 is the highest-risk
extraction and waits for those adapters and characterization fixtures. P6 and
P7 can proceed in parallel after P2/P3. P8 follows stable ownership; P9 is last.

For every migrated component:

1. Capture current behavior and artifact hashes.
2. Add or identify the contract test.
3. Move or wrap without semantic edits.
4. Run old and new paths on identical fixtures/seeds.
5. Compare semantic outputs, not incidental log formatting.
6. Switch the canonical import/command.
7. Keep a compatibility shim for one bounded phase.
8. Delete the shim only after repository-wide search and full-suite proof.

Do not rename all files at once. `git` can follow moves, but reviewers and
future evidence work cannot audit a semantic rewrite hidden inside one.

## Non-goals

- No rewrite of the sourced mechanics model solely to fit a fashionable
  framework.
- No conversion of C, Python, or device shell whose runtime boundary makes the
  language appropriate.
- No generic lowest-common-denominator sensor or actuator that hides measured
  differences.
- No micro-package per script or adapter.
- No mandatory trainer framework, bundler, database, message broker, or cloud
  service.
- No deletion of negative results, retractions, evidence ledgers, or run
  artifacts because navigation changes.
- No claim promotion from a refactor, a simulation equivalence check, or a new
  abstraction.
- No attempt to finish every existing research plan before architecture work
  can begin; migrated and legacy components may coexist behind explicit
  boundaries.

## Additional recommendations from reconnaissance

- Give each application one visible composition root. Core modules define
  behavior; only trainer/device/research entry points select concrete adapters,
  profiles, storage, and clocks.
- Add `experimental`, `supported`, `deprecated`, and `retired` lifecycle states
  plus an owner to commands, adapters, protocols, profiles, and experiments.
  Compatibility code needs an expiry condition; otherwise the refactor only
  adds a second architecture.
- Adopt explicit unit types (`Frame`, `Milliseconds`, `DeviceUptimeMs`, ROI,
  pixels, samples/second) at the TypeScript boundary. The clock contract is not
  enough if bare numbers can still be interchanged.
- Make replay the default diagnostic primitive. A device failure should yield
  a self-describing bundle that can replay detector, estimator, controller,
  supervisor, and scheduler decisions without reconnecting the device.
- Establish a dependency budget through ADRs: a new runtime dependency must
  state the boundary it owns, security/offline consequences, generated output,
  and removal path. Do not recreate framework sprawl while fixing file sprawl.
- Separate “unsupported,” “not calibrated,” “unknown measurement,” “transport
  failed,” “command rejected,” and “command unverified.” A generic failure or
  false value destroys the exact information needed to debug flaky pilots.
- Treat device actuation as a safety/security boundary even for local research:
  least-privilege endpoints, no arbitrary shell in agent APIs, secrets outside
  manifests, explicit live mode, exclusive lease, bounded action budgets, and
  guaranteed release/cleanup.
- Remove stale branches and duplicate implementations after equivalence rather
  than keeping them as permanent reassurance. Retained research history belongs
  in artifacts and docs; unreachable runtime code is not a knowledge archive.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Moving the engine changes browser or Node module behavior | P0 equivalence fixtures, dependency-free ES modules, temporary re-exports. |
| A generic adapter erases timing/calibration differences | Capability and calibration schemas; backend-specific conformance tests. |
| Host refactor changes the physical input stream | Compare compiled policy, remote plan, HID report, and mocked executor traces before live use. |
| Documentation reorganization destroys evidence context | Redirect/link first; preserve retractions and dated research; never bulk-delete history. |
| Workspaces introduce dependency/build overhead | Keep the pinned root development toolchain small; enforce a lockfile and dependency budget; keep core/trainer runtime dependencies empty unless separately admitted. |
| The root development install is mistaken for a runtime dependency | Commit the lockfile; classify dependencies by workspace; keep core/trainer runtime dependencies empty unless an ADR and acceptance gate approve one. |
| New names obscure established evidence references | Compatibility aliases and a current-to-target glossary; update links mechanically only after canonical ownership settles. |
| Research framework homogenizes distinct hypotheses | Share execution/provenance contracts, not candidate semantics; retain per-experiment candidate spaces and controls. |
| Profiles become another unvalidated configuration layer | Runtime schema validation, printed resolved profile, artifact hashes, capability/interlock checks, retained manifest. |
| TypeScript creates a build/tooling tax before clarifying ownership | Types/contracts first, `allowJs` migration, one pinned toolchain, no bulk conversion, fast type-check budget. |
| A permissive research sandbox leaks into runtime | Retired with the sandbox (2026-09-29, ADR 0002 principle 7). |
| Test sharding hides shared-state failures | Fresh immutable inputs, isolated resources, deterministic reruns, and a separate bounded integration lane. |
| MCP is mistaken for a real-time or trusted actuator | The service MCP left with `DeviceControlService` on 2026-09-25; the Cue Helper MCP queues bounded jobs and never runs the control loop; the executor owns deadlines and safety. |
| Wiki/RAG becomes another authority | Static portal and indexes are generated from Git truth; semantic retrieval remains optional, cited, benchmarked, and non-authoritative. |
| `CLAUDE.md` becomes another stale manual or loses hard-won discipline | Keep it concise and curated, link to canonical registries, validate stable IDs, and move chronology without deleting its evidence or retractions. |
| Registries become scattered edit points | Each concept has one owning registry; other catalogs and documentation are generated views. |

## Final acceptance gates

### Legibility

- In the root README's first screen, a newcomer can state the canonical target,
  vision, mission, five program layers, current products, and evidence limits.
- The repository map places trainer, research, and device embodiments beside
  one another under core.
- Every package README answers responsibility, public API, dependencies,
  commands, artifacts, and explicit non-responsibilities.
- A new human or agent can read `CLAUDE.md` once and identify the claim,
  dependency, migration, live-device safety, evidence-retention, and
  session-finish rules; every linked ID resolves to its canonical owner.

### Developer experience

- After the single documented `npm ci` bootstrap, a clean checkout can run
  `npm test`, build/serve the trainer, execute a representative model
  experiment, and complete the campaign dry run over a committed winner
  (`device:dry-run` was retired with the fixture path on 2026-09-25) without
  proprietary assets or a phone.
- Root commands and CLI help are authoritative; command discovery does not
  require reading a giant Markdown inventory.
- Failures identify the package, contract, missing capability/artifact, and
  remediation instead of surfacing as an unrelated shell exit.
- Unit/type feedback meets the 2-second budget; affected and contract feedback
  meets the 10-second budget; statistical, real-time browser, and live-device
  qualification are explicit lanes rather than default edit tax.
- No production module imports a test/report file or mutable global experiment
  knobs. Adding a fixture adapter demonstrates the change-locality budget.

### Architecture

- `@sixam/core` imports no trainer, adapter, device, DOM, shell, or host
  process API; `@sixam/kernel` imports nothing; `@sixam/review`
  imports no Play or Propose package.
- Trainer, research, and device code import core through package exports.
- All live/simulated sensors and actuators are selected through registered
  adapters with honest capabilities and calibration scope.
- Policies contain semantic actions only; physical encoding is adapter-owned.
- Sensor acquisition, detection, estimation, control, scheduling, actuation,
  verification, and telemetry are distinguishable in code and traces.
- Every public/wire/process contract in the register has one owner, runtime
  validation or grammar, error/clock/unit/version rules, and conformance tests.
- Device operation resolves input mode, coordinates, timing, and calibration
  from a retained profile; neither a human nor an agent reconstructs them from
  prose or conversation.

### Research and evidence

- Every search/sweep/probe is classified by research operation and produces a
  versioned result artifact with model/profile/hash/sample/statistical context.
- Every supported command that prints a quotable claim, comparison, rate,
  timing, or verdict also prints a stable evidence ID and retains its structured
  result without manual transcription.
- `evidence show`, `diff`, `replay`, and `why` make named experiment and device
  bundles usable for diagnosis; `promote` invokes rather than bypasses Plan 12.
- Search winners remain model candidates until Plan 12 promotion evidence.
- A device run retains resolved profile, policy/plan hashes, measurements,
  commands, actuation results, lifecycle events, and grading references.
- Existing sourced claims, negative controls, and known-negative results remain
  reproducible after the move.
- (Superseded 2026-09-29, ADR 0002 principle 7.) There is no sandbox:
  claim-bearing cohorts and censuses are pre-registered, and diagnostic sweeps
  name the explanation they test.
- Comments containing cross-cutting knowledge resolve to stable documentation,
  contract, claim, ADR, or evidence IDs; the generated portal provides reverse
  links to implementations and tests.
- Exact search, generated registries, artifact/session indexes, and the typed
  claim/evidence graph answer the retrieval benchmark without a mandatory RAG
  or separately maintained wiki.

## Relationship to existing plans

- **Plan 07:** its correctness findings remain; this plan replaces opportunistic
  local consolidation with explicit package and port ownership.
- **Plans 09 and 15:** their observation corpus and sensor independence become
  the measurement, calibration, and sensor/detector contracts here.
- **Plans 10, 19, and 20:** their controller work becomes the closed-loop
  runtime, estimator, controller, and supervisor layers.
- **Plans 11, 16, and 21:** their policy comparison, constrained search, policy
  IR, and equivalence gates become the research and controller-synthesis
  contracts here.
- **Plan 12:** remains the sole claim-promotion ladder; architecture does not
  promote evidence.
- **Plan 14:** device profiles and calibration portability become the profile
  and capability contract here.
- **Plan 17:** in-APK observation/actuation becomes another embodiment and
  adapter set, not a separate model.
- **Plan 18:** its incident-driven checks remain required. This plan permits a
  private workspace/package structure while preserving the no-unjustified-
  dependency and no-unjustified-build-step rules.

This plan owns the dependency direction, vocabulary, interfaces, repository
navigation, and migration mechanics. Existing plans continue to own their
scientific questions and promotion gates.
