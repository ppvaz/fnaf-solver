# Tool index

Read this before adding a script. Search these indexes and `rg` the existing
tools, then extend the closest tool when possible. The generated command catalog
under `docs/architecture/generated/` is the machine-readable command authority;
these pages are the narrative inventory, one per directory:

- this page: suite, build, simulator, search, browser and evidence tools in
  `tools/` itself and its small subdirectories (`model/`, `minus7/`, `minustoys/`);
- [`device/README.md`](device/README.md): everything that runs a night on the
  phone, observes it, or grades what it recorded;
- [`packages/source/decompile/README.md`](../packages/source/decompile/README.md): the Android source-dump extraction and
  readers.

`tools/test-docs.mjs` holds each script to a row in the index of its own
directory, or of the nearest parent that has one.

Known false contracts, stale documentation, and worthwhile consolidation work
are tracked separately in
[`plans/07-tooling-consolidation.md`](../plans/07-tooling-consolidation.md). Check
that plan before creating shared infrastructure; this index describes what
exists now, not proposed replacements.

Two labels matter:

- **check** asserts an outcome and exits nonzero when it fails;
- **report** prints evidence for a person to interpret and is not a verdict.

Anything marked **device action** sends input to the connected Android device.
Confirm the device, focus, screen state, coordinates, and selected night before
running it. Captures and extracted game content are local evidence, not repo
assets.

## Quick chooser

| Need | Use this first |
|---|---|
| See which README routes this machine is ready for | `npm run probe` (`apps/desktop/src/probe.js`) |
| Run the maintained test suite | `node tools/test.mjs` |
| Check only simulator regressions | `node tools/test.mjs --engine` |
| Include exhaustive model sweeps too | `node tools/test.mjs --engine --extended` |
| Check the built page in Chrome | `node tools/test.mjs --browser` |
| See non-asserting policy diagnostics too | `node tools/test.mjs --reports` |
| Serve or make the self-contained trainer | `npm run serve:trainer`, `npm run build:trainer` (the trainer's own tools and tests: [`apps/trainer/README.md`](../apps/trainer/README.md)) |
| Test the canonical or BB-aware strategy | `packages/source/test/simtest.mjs`, `packages/propose/parked/minus7/reactive-pilot.mjs` |
| Compare policy families under execution error | `packages/propose/parked/minus7/policytest.mjs` |
| Explore a strategy or cycle | `packages/propose/parked/minus7/cyclesearch.mjs` |
| Run a night on the phone | `npm run night -- fnaf2\|fnaf1\|fnaf1-custom\|fnaf1-winner ... --live --confirm-live` (`apps/desktop/src/night.js`), which runs that game's runner -- for FNaF 2 [`packages/play/bin/phone/night-run.sh`](device/README.md): records, runs the campaign, grades, packs the evidence, resets the game -- and packs FNaF 1 runs when they end. Without `--live --confirm-live` every runner is a dry run (ADR 0002). The handset serial comes from `FNAF_SERIAL` or the untracked local profile: `node packages/play/bin/phone/local-profile.mjs set <serial>` once per host |
| Analyze a recorded phone trial | `grade-minus7.py`, `camtrace.py`, `windpct.py`, `find-events.py` |
| Inspect the Android event-sheet dump | [`packages/source/decompile/readdump.py`, `packages/source/decompile/coverage.py`](../packages/source/decompile/README.md) |

Paths in the tables are relative to the repository root.

## Suite, build, and development entry points

| Tool | Kind | Purpose and interface |
|---|---|---|
| `tools/test-evidence-cli.mjs` | check | Runs `tools/evidence.js` itself against committed packs of each custody kind (original, recovered, result lost, FNaF 1): `why`, `show`, `diff` and `replay` read the pack, a lost `result.json` is named rather than thrown, a misspelled id is refused with the three nearest ids (and `attest` with the nearest packs), and `promotions` prints `promotionSummary` byte for byte; under `--envelope`, `show` and `promotions` wrap exactly that output in a valid `claim-envelope-v1`. Until 2026-09-29 `why` and `diff` failed with a raw ENOENT on every committed pack. `test:unit`. |
| `tools/test.mjs` | check runner | Canonical entry point. `--engine` is the edit-time headless tier; add `--extended` for campaign-wide and timing-margin model sweeps (the default full suite includes them; no CI step does). `--list` prints every entry as JSON with whether the given flags select it, and runs nothing. Every child has an individual watchdog (180 s default; 240–900 s for named heavy model gates; 360 s browser), bounded concurrency, and start/live-output/finish progress; `--browser` and `--reports` select their groups; `--parallel` opts into concurrent timing-sensitive browser checks. It builds `dist/` and starts the dev server when needed. |
| `tools/push-gate.mjs` | check | Runs the CI job's lanes against the commits being pushed, in a throwaway `git worktree` at each commit rather than in the working tree -- a dirty tree gives a different answer for `catalog` plus `git diff --exit-code` than CI's clean clone does, which is how a missing `command-registry.json` row stayed red online for a day. Runs every lane even after one fails, and re-runs a failed lane's `&&` chain command by command so a second failure hidden behind the first is named. Refuses to run when its lane list has drifted from `.github/workflows/ci.yml`. `--stdin` reads git's pre-push ref lines; with no arguments it validates `HEAD`. Install as a hook with `git config core.hooksPath .githooks`. A red lane is fixed, never pushed past the hook (CLAUDE.md forbids bypassing one): the closing lines name each failed lane with the command that reproduces it, and `npm run push-gate -- SHA` re-runs the gate on that commit. A machine without docker gets a loud SKIP for the ShellCheck lane, not a pass, and so does one whose docker refuses to bind-mount the worktree: `mounts denied` is a fact about the host's file sharing, not about the commit, so calling it a FAIL invites a `--no-verify` past a lane nobody actually ran. The worktree base is `FNAF2_PUSH_GATE_TMP`, default `~/.cache/fnaf2-pushgate-tmp`, and deliberately NOT `TMPDIR`: Docker Desktop does not share `/tmp` here, so the gate passed when a person exported a TMPDIR by hand and failed when git's pre-push hook ran the same gate with the environment git gives it. It picks its own base now. Lanes run on an isolated CI-like Python (`FNAF2_CI_PYTHON`, default `~/.cache/fnaf2-ci-py312`) whose version and packages must equal `ci.yml`'s setup-python version and pip pins; without one it reports CI Python dependencies as unverified, never passed. Each command runs in a systemd user scope capped at `MemoryMax=3G` (`PUSH_GATE_MEMORY_MAX` overrides, `off` disables), so an out-of-memory kill takes the lane, not the session running the gate; without a user manager (CI) commands run unscoped. Each validated commit appends a `push-gate-run-v1` line (sha, `--full`, failed and skipped lanes, time, host) to the main checkout's gitignored `artifacts/lab/push-gate.jsonl` (`FNAF_LAB_DIR` names another directory), which `npm run lab -- status` reads to say whether the gate ran on HEAD; a record that cannot be written never changes the verdict. `linkDependencies` is exported for the lab's catalog worktree. |
| `tools/test-push-gate.mjs` | check | Imports `tools/push-gate.mjs` without running it and pins its closing lines: every failed lane is named with the command that reproduces it (the ci.yml step, or the ShellCheck step's script), and no user-facing string in the gate or the `.githooks` hooks suggests bypassing a hook -- until 2026-09-29 the gate ended a red run with "push with --no-verify to send them anyway". The scan first catches a planted suggestion and passes a comment that explains the rule. `test:unit`. It also pins the lane memory ceiling: the scope wrapper, quoting through it, and `off`; the run record's path and lines; and scans the lab (`apps/desktop/src/lab.mjs`, `cli.mjs`) for the bypass too. |
| `tools/chrome.mjs` | internal module | Shared Chrome discovery and DevTools flags for browser tools: the trainer's browser checks in `apps/trainer/test/`, `tools/test.mjs --browser` and `tools/device/deathchart.mjs`. `$CHROME` overrides discovery; reuse this instead of adding another locator. |
| `tools/architecture-test.js` | check | Package-boundary gate over each module's syntax tree (the pinned `typescript` parser, no new dependency): static imports, aliased and namespace re-exports, dynamic `import()` (a computed specifier is refused in a guarded package), `require()` and TS import types. Rules: the kernel imports nothing; source imports only the kernel; source, the kernel, propose's policy and game modules and the modules that left core (play's Sim venue, player and clocks, review's measure, the trainer's training) read no host global; play (`packages/play`) imports only itself, the kernel, source and Node built-ins, and nothing in a package imports play but propose; propose's `src/` imports the kernel, source, play and review and never the device shell (`child_process`, `net`, `dgram`); its command lines and parked work (`bin/`, `parked/`) may start processes but import no application or `tools/` module, and make a computed import only where `COMPUTED_IMPORTS` says why; nothing in a package imports propose; review never imports `packages/play`, `packages/propose` or an application (ADR 0002: Review never imports Play or Propose); production packages import no test or report module; only the named device runners compose the HID transport. Planted violations (a dynamic import, a template-literal import, an aliased re-export, `require` through `createRequire`, a comment that looks like an import) run first and must be caught. `test:unit`. |
| `tools/generate-catalog.js` | generator | Generates checked-in import, command, contract, protocol, adapter, test, and duplicate-responsibility inventories under `docs/architecture/generated/`. |
| `tools/evidence.js` | evidence CLI | Lists, shows, diffs, replays, and causally explains retained bundles. `pack <campaign or night-run label> [--replace]` writes a frame-free run pack (`packages/review/src/evidence-pack.mjs`); Every reading (`list`, `show`, `diff`, `replay`, `why`, `promote`) takes `artifacts/<id>` first and then the committed pack `docs/evidence/runs/<id>`, so it works on a clean checkout; what a recovered pack lost is named rather than thrown, and an unknown id is refused with the three nearest ids. `why` prints a campaign's or pack's event rows verbatim with its custody; `diff` of two campaigns or packs compares their text file by file and lists what either side lost. `attest <pack> --by agent --note TEXT` (or `--by human --name NAME`) re-derives every other Plan 12 check from the pack and writes its `plan12-attestation.json`, refusing on any failure (`packages/review/src/evidence-promotion.mjs`; agents may since Pedro's 2026-09-27 delegation). `promote <pack>` records an accepted pack as a `PROMOTED_BY` edge in `docs/evidence/graph.json` and writes nothing for a refused one; for sessions, bundles and campaign directories it still only proposes review. `promotions` reports every pack against the gate and the graph, per night, with an evidence ID. `list` and `show` print each pack's custody (and what it lost), who attested, and its promotion edge. `show <id> --envelope` and `promotions --envelope` print the same object as the `claim` of a `claim-envelope-v1` (Plan 28 step 1: the record's claim level as `label`, what custody lost and what is not promoted under `notMeasured`); without the flag the output is unchanged byte for byte. |

| `tools/test-docs.mjs` | check | Keeps the two indexes honest: every relative markdown link resolves, every relative `href`/`src` in a tracked HTML page (the portal under `docs/portal/`, the trainer's root `index.html`) resolves and none is site-absolute, every page under `docs/` is listed in `docs/README.md`, and every tool script has a **table entry** in this file -- a mention in prose is not an entry, which is what let this drift to 47 missing scripts and 5 missing pages. A link into gitignored output is a failure, not an exemption. |
| `tools/test-companion-name.mjs` | check | In `test:unit`. Pedro, 2026-09-30: the phone's app is the Companion. Refuses, with file and line, any tracked or untracked-but-not-ignored file (and any path) that still uses the app's old name outside its stored names (ADR 0002 principle 9: contract and schema ids, the `com.fnaf2.cuehelper.*` wire names, the `FnafCueHelper` log tag, the `CUE_HELPER` label and the lease/queue/operator variables, record keys, sensor and check ids, `captures/cue-helper/`), each family with its reason in `STORED`. Not scanned: the frozen set, hash-bound profiles, models and strategy sources, two sources a retained record pins by sha256, stored-format fixtures, history and dated plan prose (`UNSCANNED`). Twelve planted cases run first. |
| `tools/test-no-serial.mjs` | check | In `test:unit`. Pedro, 2026-09-29 (ADR 0002, decision 8): the handset serial is read from an untracked local profile with no default. Refuses, listing each file, any tracked or untracked-but-not-ignored file that names the campaign handset's serial, outside the frozen set (`docs/evidence/`, `docs/chronicle/`, `tools/recompile/results/`, `plans/archive/`, `tools/device/*-winner.json`) and an allowlist of 14 calibration and measurement records, each with its reason and exact count (so an allowlisted record cannot gain one either). Also refuses unless `tools/device/local-profile.json` is gitignored and untracked. Docs use `<serial>`, fixtures a fake such as `FAKE0001`, code `packages/play/bin/phone/local-profile.mjs`. |
| `tools/test-sibling-paths.js` | check | In `test:unit`. Refuses any literal path a script builds from its own directory (`new URL('x', import.meta.url)`, `join(HERE, 'x')`, `` `${HERE}x` ``, `HERE / "x"`, `"$HERE/x"`) that names nothing, a glob there that matches nothing, and one that climbs out of the repository; git-ignored targets are runtime outputs. A move rewrites imports and repo-rooted paths but not these: d2585a30 left windtrace.mjs and deathchart.mjs asking for recipe.mjs beside themselves. Planted cases for each idiom. |
| `tools/test-mistake-register.mjs [--explain]` | check | CLAUDE.md's mistake registers, where a machine can hold them (ROADMAP S7). **Item 13:** every tracked test file (`tools/**/test-*`, `tools/*test.mjs`, `packages/*/test/*.test.js`, `apps/*/test/*.test.js`, `android/*/test.sh`, and each `*Test.java` its `test.sh` actually executes, not merely compiles) is reached from a `ci.yml` step -- through `npm run` scripts and `node tools/test.mjs --gates`, read with the runner's own `--list` -- or is exempt one file at a time with a reason, in this file or in `tools/test.mjs`'s BACKLOG; a stale exemption fails. **Item 5:** every script path a `package.json` script, a CI step or a `tools/test.mjs` entry names exists, and every `npm run X` names a defined script. **Item 12:** `run-report.mjs` calls four MISSING of five a blind observer below five positive reads and an actuator gap at five. **Items 7 and 9** stay `test-seam-slack.mjs`'s; this only requires every gate a register item relies on to be CI-reached. Each check first catches a planted violation. `--explain` prints what reaches every test. |
| `tools/dump-text-check.mjs MSGFILE \| --log N` | check | ADR 0002 decision 12, "cite, never quote": exits 1 when a commit message copies decompiled event-sheet text, naming each line, the signature it matched, and how to cite instead (`g###`, a dump file and line, a paraphrase). The signature is the dumpers' field grammar, never object names: the tabular `C/A OT NUM OI` rows, records and `NN:Loader:` parameters, `[i]ot=,num=,oi=` expression items, the CTFAK-rendered `IF/DO ... (COMPARISON{...})` lines, and `readdump.py`'s rows and headers. Comment lines and the `git commit -v` diff are ignored. `.githooks/commit-msg` runs it before every other rule; `PEDRO-OK` does not waive it. `--log N` reports what it would have refused over the last N messages (0 of 1060 on 2026-09-29). |
| `tools/test-dump-text-check.mjs` | check | Synthetic fixtures only, written from the dumpers' grammar: each signature catches its own dump-shaped lines, prose with `g###`, file:line citations, arrows and code passes, comments and the scissors diff are dropped, the refusal names the line and the citation form, and the hook refuses a dump line even with `PEDRO-OK` and nothing staged. |
| `tools/media-manifest.json` | data | Every tracked image, video and audio file, each with a class (`game-clip`, `diagram`, `icon`, `ui-art`, `font-preview`) and a `shows` line written by someone who opened it. The only `game-clip` entries are the two README clips of ADR 0002 decision 6. |
| `tools/test-media.mjs` | check | The media gate (ADR 0002 decision 6): fails when a tracked (or new, unstaged) media file has no manifest entry, when an entry names a file that is not there, has an unknown class or no `shows`, when there are more than 2 `game-clip` entries or one outside the written exception, or when a clip exceeds 4,000,000 bytes. Each failure says what to do. Each check first catches a planted violation. |
| `tools/retrieval-benchmark.mjs` | check | Runs a small deterministic newcomer-query benchmark over the maintained README/architecture/evidence routes and requires each expected authority in the top five; it measures route discoverability, not claim truth or semantic search quality. |

## Simulator checks and reports

| Tool | Kind | Purpose and interface |
|---|---|---|

The canonical runner judges only the explicit engine-check invocations in
`tools/test.mjs`, including the `--assert` forms of the reactive and stock
device pilots.
Policy scripts remain reports when invoked without an assertion contract.


## Strategy search and worker infrastructure

| Tool | Kind | Purpose and interface |
|---|---|---|

## Browser checks

The trainer's browser checks, its dev server and bundler, and its trace tools
live with the trainer in `apps/trainer/test/`, indexed in
[`apps/trainer/README.md`](../apps/trainer/README.md). They use Node's built-in
WebSocket and Chrome's DevTools Protocol, with no Puppeteer dependency. Prefer
`node tools/test.mjs --browser` (`npm run test:trainer`), which builds `dist/`,
starts the dev server when needed and runs them in turn; each check also accepts
a page URL when a focused run is useful.

## Evidence and device-adjacent tools

The phone's own tools are in [`device/README.md`](device/README.md). These live
in `tools/` because they read what a device night left behind, or check the
policy and HID layers a device plan is compiled through.

The campaign reader, the run-pack writer and reader, the Plan 12 attestation
and promotion, and the cohort computation moved to
[`packages/review`](../packages/review/README.md) on 2026-09-29, with their
tests; `tools/evidence.js` below composes them as `npm run evidence`.

| Tool | Kind | Purpose and interface |
|---|---|---|

## Game simulator censuses

The dump readers these are checked against are in [`packages/source/decompile/README.md`](../packages/source/decompile/README.md).

| Tool | Kind | Purpose and interface |
|---|---|---|
| `tools/rebuild-options-census.mjs [--jobs J] [--count N] [--out FILE] [--date YYYY-MM-DD] [--suffix LETTER] [--checkpoint DIR] [--assemble DIR] [--options FILE]` | report | Every committed winner-v1 binding on its Nights 1-6, the Night 7 binding k3 and the Night 7 preset schedule (`PRESET_KNOBS`, `golden-freddy`, won only with the split armed) scored under three model option sets on the same seeds: `default`, `rebuild` (`tools/recompile/sourced-rebuild-model-options.json`, under which the model matches the rebuilt runtime on no-input Nights 1-5) and `rebuild-no-cam-markers` (the same without the disputed `footstepCamMarkers`). Options are merged into each Sim's constructor through a scoped setter, so constructor-read options are exact, and every replay checks its Sim carries the set. Design block seeds 1..N, held-out block the first N seeds outside `winner-census.mjs` `designBlock()`; each set is paired with the default seed by seed (exact McNemar) and a row is MOVED when both blocks shift the same way at p < 0.05. Bindings with identical replays are scored once. `--checkpoint` lets a killed block resume; `--assemble DIR` writes the record from a stopped run's checkpoints, every unfinished subject a NOT_RUN row with no figures. `--options FILE` scores a dated snapshot of the set, which the record names; `--suffix b` names a second record on the same date `rebuild-options-census-YYYYMMDDb`. Writes an `evidence-record-v1`; MODEL_ONLY, no default changes. |
| `tools/test-rebuild-options-census.mjs` | check | Holds every committed `docs/evidence/rebuild-options-census-YYYYMMDD[x].json` to the tree without re-running it, each against the options file it names: the option file, option sets and both seed blocks as scored, each binding's file and plan hash, every row's counts, p values and verdicts recomputed from its own paired counts, the option scope reaching the constructor and not leaking past it, and for each distinct replay and set the first listed held-out loss and first discordant seed each way replaying as recorded. `test:unit`. |

## Archived toolchains

The ESP32 audio bridge and its host tools, and the Plan 05 invention engine
(`tools/invent/`) left the tree on 2026-09-24. The in-engine recompile
toolchain left with them and came back on 2026-09-27 for ROADMAP S2b:
[`tools/recompile/README.md`](recompile/README.md) indexes it. [`docs/ARCHIVED-ROUTES.md`](../docs/ARCHIVED-ROUTES.md) names the
tag that holds them and how to restore one.

## Generated files and dependencies

- `dist/`, `captures/`, `artifacts/`, raw screenshots and classifier models
  are generated/local and ignored.
- Node tools use built-in modules; Chrome browser checks expect Node 22 and a
  Chrome binary (or `$CHROME`).
- Recorded-video analysis requires `ffmpeg`; PNG screen tools require Pillow.
- Device tools require `adb`, the owned Android game, the calibrated landscape
  layout, and exactly one intended device unless the script explicitly gains a
  serial selector.
- Dump regeneration additionally requires Docker and a prepared CTFAK checkout.

## Adding or changing a tool

1. Search this index and existing implementations with `rg`; extend an
   existing entry point or shared module when the responsibility overlaps.
2. Decide whether the result is an asserting **check**, a human-read **report**,
   an internal module, or a state-changing **device action**. Make the exit
   behavior match the label.
3. Reuse `chrome.mjs`, `pool.mjs`, `screenstate.py` or `coords.sh` instead of
   duplicating browser, parallel, device guard or coordinate infrastructure.
4. For device actions, validate inputs, focus, and screen state; refuse unsafe
   overwrite; use a device-side monotonic schedule for timed sequences.
5. Add or update the entry in the index of the script's directory in the same
   change, including its interface, side effects, dependencies, and whether it
   is safe to run unattended.
