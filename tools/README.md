# Tool index

Read this before adding a script. Search these indexes and `rg` the existing
tools, then extend the closest tool when possible. The generated command catalog
under `docs/architecture/generated/` is the machine-readable command authority;
these pages are the narrative inventory, one per directory:

- this page: the repository's gates (suite, catalog, docs, push-gate and the
  registers) and the few tools that still sit in `tools/`;
- [`device/README.md`](device/README.md): what is left at that path, the
  overnight window's forwarder and the untracked local profile;
- each package's and application's README (its `## Scripts` table): every script
  that left `tools/` for its context under the ADR 0002 layout, among them the
  phone's runners and sensors (Play), the censuses, plans and parked Minus 7 work
  (Propose) and the grade pipeline (Review);
- [`packages/source/decompile/README.md`](../packages/source/decompile/README.md) and
  [`packages/source/recompile/README.md`](../packages/source/recompile/README.md): the
  source-dump extraction and readers, and the rebuild toolchain. The rebuild's
  records stay frozen in `tools/recompile/results/`.

`tools/test-docs.ts` holds each script to a row in the index of its own
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
| See which README routes this machine is ready for | `npm run probe` (`apps/desktop/src/probe.ts`) |
| Run the maintained test suite | `node tools/test.ts` |
| Check only simulator regressions | `node tools/test.ts --engine` |
| Include exhaustive model sweeps too | `node tools/test.ts --engine --extended` |
| Check the built page in Chrome | `node tools/test.ts --browser` |
| See non-asserting policy diagnostics too | `node tools/test.ts --reports` |
| Serve or make the self-contained trainer | `npm run serve:trainer`, `npm run build:trainer` (the trainer's own tools and tests: [`apps/trainer/README.md`](../apps/trainer/README.md)) |
| Test the canonical or BB-aware strategy | `packages/source/test/simtest.ts`, `packages/propose/parked/minus7/reactive-pilot.ts` |
| Compare policy families under execution error | `packages/propose/parked/minus7/policytest.ts` |
| Explore a strategy or cycle | `packages/propose/parked/minus7/cyclesearch.ts` |
| Run a night on the phone | `npm run night -- fnaf2\|fnaf1\|fnaf1-custom\|fnaf1-winner ... --live --confirm-live` (`apps/desktop/src/night.ts`), which runs that game's runner -- for FNaF 2 [`packages/play/bin/phone/night-run.sh`](../packages/play/README.md#running-a-night): records, runs the campaign, grades, packs the evidence, resets the game -- and packs FNaF 1 runs when they end. Without `--live --confirm-live` every runner is a dry run (ADR 0002). The handset serial comes from `FNAF_SERIAL` or the untracked local profile: `node packages/play/bin/phone/local-profile.ts set <serial>` once per host |
| Analyze a recorded phone trial | `grade-minus7.py`, `camtrace.py`, `windpct.py`, `find-events.py` |
| Inspect the Android event-sheet dump | [`packages/source/decompile/readdump.py`, `packages/source/decompile/coverage.py`](../packages/source/decompile/README.md) |

Paths in the tables are relative to the repository root.

## Suite, build, and development entry points

| Tool | Kind | Purpose and interface |
|---|---|---|
| `tools/test.ts` | check runner | Canonical entry point. `--engine` is the edit-time headless tier; add `--extended` for campaign-wide and timing-margin model sweeps (the default full suite includes them; no CI step does). `--list` prints every entry as JSON with whether the given flags select it, and runs nothing. Every child has an individual watchdog (180 s default; 240–900 s for named heavy model gates; 360 s browser), bounded concurrency, and start/live-output/finish progress; `--browser` and `--reports` select their groups; `--parallel` opts into concurrent timing-sensitive browser checks. It builds `dist/` and starts the dev server when needed. |
| `tools/push-gate.ts` | check | Runs the CI job's lanes against the commits being pushed, in a throwaway `git worktree` at each commit rather than in the working tree -- a dirty tree gives a different answer for `catalog` plus `git diff --exit-code` than CI's clean clone does, which is how a missing `command-registry.json` row stayed red online for a day. Runs every lane even after one fails, and re-runs a failed lane's `&&` chain command by command so a second failure hidden behind the first is named. Refuses to run when its lane list has drifted from `.github/workflows/ci.yml`. `--stdin` reads git's pre-push ref lines; with no arguments it validates `HEAD`. Install as a hook with `git config core.hooksPath .githooks`. A red lane is fixed, never pushed past the hook (CLAUDE.md forbids bypassing one): the closing lines name each failed lane with the command that reproduces it, and `npm run push-gate -- SHA` re-runs the gate on that commit. A machine without docker gets a loud SKIP for the ShellCheck lane, not a pass, and so does one whose docker refuses to bind-mount the worktree: `mounts denied` is a fact about the host's file sharing, not about the commit, so calling it a FAIL invites a `--no-verify` past a lane nobody actually ran. The worktree base is `FNAF2_PUSH_GATE_TMP`, default `~/.cache/fnaf2-pushgate-tmp`, and deliberately NOT `TMPDIR`: Docker Desktop does not share `/tmp` here, so the gate passed when a person exported a TMPDIR by hand and failed when git's pre-push hook ran the same gate with the environment git gives it. It picks its own base now. Lanes run on an isolated CI-like Python (`FNAF2_CI_PYTHON`, default `~/.cache/fnaf2-ci-py312`) whose version and packages must equal `ci.yml`'s setup-python version and pip pins; without one it reports CI Python dependencies as unverified, never passed. Each command runs in a systemd user scope capped at `MemoryMax=3G` (`PUSH_GATE_MEMORY_MAX` overrides, `off` disables), so an out-of-memory kill takes the lane, not the session running the gate; without a user manager (CI) commands run unscoped. Each validated commit appends a `push-gate-run-v1` line (sha, `--full`, failed and skipped lanes, time, host) to the main checkout's gitignored `artifacts/lab/push-gate.jsonl` (`FNAF_LAB_DIR` names another directory), which `npm run lab -- status` reads to say whether the gate ran on HEAD; a record that cannot be written never changes the verdict. `linkDependencies` is exported for the lab's catalog worktree. |
| `tools/test-push-gate.ts` | check | Imports `tools/push-gate.ts` without running it and pins its closing lines: every failed lane is named with the command that reproduces it (the ci.yml step, or the ShellCheck step's script), and no user-facing string in the gate or the `.githooks` hooks suggests bypassing a hook -- until 2026-09-29 the gate ended a red run with "push with --no-verify to send them anyway". The scan first catches a planted suggestion and passes a comment that explains the rule. `test:unit`. It also pins the lane memory ceiling: the scope wrapper, quoting through it, and `off`; the run record's path and lines; and scans the lab (`apps/desktop/src/lab.ts`, `cli.mjs`) for the bypass too. |
| `tools/chrome.ts` | internal module | Shared Chrome discovery and DevTools flags for browser tools: the trainer's browser checks in `apps/trainer/test/`, `tools/test.ts --browser` and `apps/desktop/bin/deathchart.ts`. `$CHROME` overrides discovery; reuse this instead of adding another locator. |
| `tools/architecture-test.ts` | check | Package-boundary gate over each module's syntax tree (the pinned `typescript` parser, no new dependency): static imports, aliased and namespace re-exports, dynamic `import()` (a computed specifier is refused in a guarded package), `require()` and TS import types. Rules: the kernel imports nothing; source imports only the kernel; source, the kernel, propose's policy and game modules and the modules that left core (play's Sim venue, player and clocks, review's measure, the trainer's training) read no host global; play (`packages/play`) imports only itself, the kernel, source and Node built-ins, and nothing in a package imports play but propose; propose's `src/` imports the kernel, source, play and review and never the device shell (`child_process`, `net`, `dgram`); its command lines and parked work (`bin/`, `parked/`) may start processes but import no application or `tools/` module, and make a computed import only where `COMPUTED_IMPORTS` says why; nothing in a package imports propose; review never imports `packages/play`, `packages/propose` or an application (ADR 0002: Review never imports Play or Propose); production packages import no test or report module; only the named device runners compose the HID transport; and the host-free modules read no ambient entropy (`Math.random()`, `Date.now()`, an argument-less `new Date()`), so a model, policy or estimator gives one input one answer -- the two tolerated draws, an unseeded Sim's natural seed (`plant-options.js`, `rng.js`), are counted in `AMBIENT_ENTROPY_TOLERATED` with their reasons; the Sim observer's silent fallback to `Math.random()` was removed on 2026-09-30, and it now refuses a noise rate without a seeded generator. Planted violations (a dynamic import, a template-literal import, an aliased re-export, `require` through `createRequire`, a comment that looks like an import) run first and must be caught. `test:unit`. |
| `tools/affected-test.ts [--files] [PATH...]` | check runner | `npm run test:affected`. Selects and runs the smallest deterministic set of checks for a change: the paths given, or else every unstaged, staged and untracked file in the working tree. It always adds the architecture and references gates, then each lane the paths reach (Source's contracts and mechanics, the winners' rebuild, the device executor and campaign, the policy language, the evidence tools). An edit-time lane; CI and the push-gate still run every lane. |
| `tools/validate-references.ts` | check | In `test:unit`. Every stable ID the repository text cites -- a contract, a graph node, an ADR, an evidence record -- resolves to its register entry, its ADR file or its record, so a renamed or retired ID cannot stay cited. Nested checkouts (an agent's worktree) are skipped. |
| `tools/generate-catalog.ts` | generator | Generates checked-in import, command, contract, protocol, adapter, test, and duplicate-responsibility inventories under `docs/architecture/generated/`. |
| `tools/ts-migrate.ts DIR [--dry]` | migration | Moves a directory's JavaScript sources to TypeScript that Node runs by type stripping (Pedro, 2026-09-30: "runtime .ts", package by package, leaves first; the kernel went first). While the files are still JavaScript it moves each JSDoc type onto its declaration (`@param`, `@returns`, `@template`, `@type`, casts as `as`, `@typedef` with its `@property` tags as an exported `type`) and declares the fields a class assigns, with the types the JavaScript checker already gave them; a JSDoc type is copied as written unless it uses syntax TypeScript does not read (`*`, `?T`, `T=`, `Array.<T>`, `Object`, nested `opts.x`), when the checker's reading is written instead. Then it `git mv`s each file to `.ts`, turns JSDoc import types into `import type`, drops the moved types from the JSDoc (its prose stays), and points every relative specifier and the package's `exports` at the `.ts` files. It changes no runtime code, and lists what it could not rewrite: paths built as strings, and types the checker could only print as `any`. TypeScript's own `annotateWithTypeFromJSDoc` codefix was tried first and wrote a one-parameter arrow's parameter type as its return type. |
| `tools/test-ts-migrate.ts` | check | Runs `ts-migrate.ts` on a fixture repository planting every case a migration got wrong (a cast arrow, a one-parameter arrow, a predicate, a constructor-assigned field, a prototype-installed member, `@this`, a call that leaves a parameter out, an open-literal read, a promise resolved with nothing) and holds the result to typecheck at JavaScript's strictness and to run under type stripping as the JavaScript did: no own field appears early, a prototype setter still fires. `test:unit`. |

| `tools/test-docs.ts` | check | Keeps the two indexes honest: every relative markdown link resolves, every relative `href`/`src` in a tracked HTML page (the portal under `docs/portal/`, the trainer's root `index.html`) resolves and none is site-absolute, every page under `docs/` is listed in `docs/README.md`, and every tool script has a **table entry** in this file -- a mention in prose is not an entry, which is what let this drift to 47 missing scripts and 5 missing pages. A link into gitignored output is a failure, not an exemption. |
| `tools/test-companion-name.ts` | check | In `test:unit`. Pedro, 2026-09-30: the phone's app is the Companion. Refuses, with file and line, any tracked or untracked-but-not-ignored file (and any path) that still uses the app's old name outside its stored names (ADR 0002 principle 9: contract and schema ids, the `com.fnaf2.cuehelper.*` wire names, the `FnafCueHelper` log tag, the `CUE_HELPER` label and the lease/queue/operator variables, record keys, sensor and check ids, `captures/cue-helper/`), each family with its reason in `STORED`. Not scanned: the frozen set, hash-bound profiles, models and strategy sources, two sources a retained record pins by sha256, stored-format fixtures, history and dated plan prose (`UNSCANNED`). Twelve planted cases run first. |
| `tools/test-no-serial.ts` | check | In `test:unit`. Pedro, 2026-09-29 (ADR 0002, decision 8): the handset serial is read from an untracked local profile with no default. Refuses, listing each file, any tracked or untracked-but-not-ignored file that names the campaign handset's serial, outside the frozen set (`docs/evidence/`, `docs/chronicle/`, `tools/recompile/results/`, `plans/archive/`, `tools/device/*-winner.json`) and an allowlist of 14 calibration and measurement records, each with its reason and exact count (so an allowlisted record cannot gain one either). Also refuses unless `tools/device/local-profile.json` is gitignored and untracked. Docs use `<serial>`, fixtures a fake such as `FAKE0001`, code `packages/play/bin/phone/local-profile.ts`. |
| `tools/test-sibling-paths.ts` | check | In `test:unit`. Refuses any literal path a script builds from its own directory (`new URL('x', import.meta.url)`, `join(HERE, 'x')`, `` `${HERE}x` ``, `HERE / "x"`, `"$HERE/x"`) that names nothing, a glob there that matches nothing, and one that climbs out of the repository; git-ignored targets are runtime outputs. A move rewrites imports and repo-rooted paths but not these: d2585a30 left windtrace.ts and deathchart.ts asking for recipe.mjs beside themselves. Planted cases for each idiom. |
| `tools/test-mistake-register.ts [--explain]` | check | CLAUDE.md's mistake registers, where a machine can hold them (ROADMAP S7). **Item 13:** every tracked test file (`tools/**/test-*`, `tools/*test.ts`, `packages/*/test/*.test.js`, `apps/*/test/*.test.js`, `android/*/test.sh`, and each `*Test.java` its `test.sh` actually executes, not merely compiles) is reached from a `ci.yml` step -- through `npm run` scripts and `node tools/test.ts --gates`, read with the runner's own `--list` -- or is exempt one file at a time with a reason, in this file or in `tools/test.ts`'s BACKLOG; a stale exemption fails. **Item 5:** every script path a `package.json` script, a CI step or a `tools/test.ts` entry names exists, and every `npm run X` names a defined script. **Item 12:** `run-report.mjs` calls four MISSING of five a blind observer below five positive reads and an actuator gap at five. **Items 7 and 9** stay `test-seam-slack.ts`'s; this only requires every gate a register item relies on to be CI-reached. Each check first catches a planted violation. `--explain` prints what reaches every test. |
| `tools/dump-text-check.ts MSGFILE \| --log N` | check | ADR 0002 decision 12, "cite, never quote": exits 1 when a commit message copies decompiled event-sheet text, naming each line, the signature it matched, and how to cite instead (`g###`, a dump file and line, a paraphrase). The signature is the dumpers' field grammar, never object names: the tabular `C/A OT NUM OI` rows, records and `NN:Loader:` parameters, `[i]ot=,num=,oi=` expression items, the CTFAK-rendered `IF/DO ... (COMPARISON{...})` lines, and `readdump.py`'s rows and headers. Comment lines and the `git commit -v` diff are ignored. `.githooks/commit-msg` runs it before every other rule; `PEDRO-OK` does not waive it. `--log N` reports what it would have refused over the last N messages (0 of 1060 on 2026-09-29). |
| `tools/test-dump-text-check.ts` | check | Synthetic fixtures only, written from the dumpers' grammar: each signature catches its own dump-shaped lines, prose with `g###`, file:line citations, arrows and code passes, comments and the scissors diff are dropped, the refusal names the line and the citation form, and the hook refuses a dump line even with `PEDRO-OK` and nothing staged. |
| `tools/commit-identity.ts --hook \| --push \| --history [REV]` | check | Pedro, 2026-09-30: every commit's author and committer address is GitHub's noreply form (`<id>+<login>@users.noreply.github.com`), after a corporate address reached 263 commits and history had to be rewritten (`docs/evidence/history-rewrite-20260930.json`). `--hook` is run by `.githooks/commit-msg` on the identity `git commit` would record (`--author` and `--amend` included; PEDRO-OK does not waive it); `--push` by `.githooks/pre-push`, before the push gate, on every commit the push publishes, because rebase and cherry-pick never run commit-msg; `--history` checks everything reachable from a revision. The refusal names each commit and role, and how to fix the config and the unpushed commits. Two 2026-09-19 `t <t@t>` commits are `LEGACY` and the list may only shrink. |
| `tools/test-commit-identity.ts` | check | In `test:unit`, so CI checks the full history even where no hook is installed. Pins the address rule, that every commit reachable from HEAD passes and every `LEGACY` entry is still needed, that commit-msg refuses a foreign `--author` and `user.email`, that pre-push refuses before the gate runs and hands it the same ref lines, and that a rebase with the real hooks installed replays a foreign commit that pre-push then refuses. Its refused addresses are invented. |
| `tools/media-manifest.json` | data | Every tracked image, video and audio file, each with a class (`game-clip`, `diagram`, `icon`, `ui-art`, `font-preview`) and a `shows` line written by someone who opened it. The only `game-clip` entries are the two README clips of ADR 0002 decision 6. |
| `tools/test-media.ts` | check | The media gate (ADR 0002 decision 6): fails when a tracked (or new, unstaged) media file has no manifest entry, when an entry names a file that is not there, has an unknown class or no `shows`, when there are more than 2 `game-clip` entries or one outside the written exception, or when a clip exceeds 4,000,000 bytes. Each failure says what to do. Each check first catches a planted violation. |
| `tools/gate-kit.ts` | internal module | What the quality gates share: `repoFiles()` (tracked plus untracked-but-not-ignored files, minus the frozen set), `loadBaseline(section)` and `ratchet(found, baseline)` over `tools/quality-baseline.json`, and `report()`. The ratchet lets a gate land on a tree that already carries its debt: what was there is recorded with its count, a new finding fails, and a recorded one that shrank or went away fails until its entry is lowered or removed, so the record only shrinks. An entry is a count (covered by its section's `why`) or `{count, why}` for one accepted since. |
| `tools/quality-baseline.json` | data | The quality gates' recorded debt, one section per gate, each with the date it landed and why. Lower or remove an entry when the debt is paid; add one only as `{count, why}` with the reason the finding is accepted. |
| `tools/test-file-size.ts` | check | In `test:unit`. No source file (`js`, `mjs`, `ts`, `py`, `java`, `sh`, C and C#) passes the working agreement's 2,000-line ceiling; files already over are recorded in `quality-baseline.json` (`fileSize`) at their length and may only shrink, and a file past 1,800 is named without failing so its split is planned while cheap. Landed 2026-09-30 with one file over: `plant-model.js` at 2,719. Planted cases first. |
| `tools/test-todo-refs.ts` | check | In `test:unit`. Every `TODO`, `FIXME`, `XXX` or `HACK` in a comment names the work that closes it -- `(Plan N)`, `(S1)`..`(S7)`, `(ADR NNNN)` or `(#issue)` -- so a marker is a pointer a query can count, not a promise nobody holds. The tree had none on 2026-09-30, so there is no baseline. Planted cases first. |
| `tools/test-dead-code.ts [--list]` | check | In `test:unit`. No dead code in the libraries (`packages/*/src`, `apps/*/src`): every module is loaded by something -- a static, dynamic or `require` import, a re-export, a path string that resolves to it (`new URL`, a spawned script), or a `package.json`, shell, Python, YAML or HTML file naming it -- and every name it exports is imported by something, directly or through `export *` and `export { a as b } from`; a module loaded whole (namespace or dynamic import, a path string) uses all its names, and tests count as users. Entry scripts (`bin/`, tools, tests) are not judged. Specifiers resolve through the workspaces' `exports` maps. Landed 2026-09-30 with 2 orphan modules (the kernel's `types.ts`, propose's root barrel) and 140 unused exports recorded in `quality-baseline.json` (`deadCode`); `--list` prints every finding. Planted cases first. |
| `tools/test-duplication.ts [--list]` | check | In `test:unit`. No block copied between two files: a clone is a run of 6 or more consecutive normalised lines (trimmed; blank, comment-only, punctuation-only and import lines dropped) that two files share. Tests, fixtures and frozen records are not scanned. Each pair of files is one finding, counted in shared lines; a pair whose copies are intended -- independent readings, as ADR 0002's venue grid wants -- is recorded as `{count, why}`. Landed 2026-09-30 with 30 pairs recorded in `quality-baseline.json` (`duplication`); `--list` prints each pair with its first shared line. Planted cases first. |
| `tools/change-locality.ts MSGFILE` | check | ADR 0002 principle 8, run by `.githooks/commit-msg` on every commit: staged code in three or more contexts (each package, each application, the Companion, `tools/`) needs a `Contexts: <why>` line of 20+ characters in the message, or the commit is split. Docs, plans, evidence, generated catalogs, root files and `tools/quality-baseline.json` are registration, not contexts. `PEDRO-OK` does not waive it. |
| `tools/test-change-locality.ts` | check | In `test:unit`. Pins which paths are contexts, the three-context limit, the `Contexts:` line (a token reason and a commented line are refused) and that the hook runs the check. |
| `tools/retrieval-benchmark.ts` | check | Runs a small deterministic newcomer-query benchmark over the maintained README/architecture/evidence routes and requires each expected authority in the top five; it measures route discoverability, not claim truth or semantic search quality. |

## Simulator checks and reports

| Tool | Kind | Purpose and interface |
|---|---|---|

The canonical runner judges only the explicit engine-check invocations in
`tools/test.ts`, including the `--assert` forms of the reactive and stock
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
`node tools/test.ts --browser` (`npm run test:trainer`), which builds `dist/`,
starts the dev server when needed and runs them in turn; each check also accepts
a page URL when a focused run is useful.

## Evidence and device-adjacent tools

None are left in `tools/`. The phone's own tools are in
[`packages/play/README.md`](../packages/play/README.md).

The campaign reader, the run-pack writer and reader, the Plan 12 attestation
and promotion, and the cohort computation moved to
[`packages/review`](../packages/review/README.md) on 2026-09-29, with their
tests; `apps/desktop/src/evidence.ts` composes them as `npm run evidence`
([`apps/desktop/README.md`](../apps/desktop/README.md)).

| Tool | Kind | Purpose and interface |
|---|---|---|

## Game simulator censuses

The dump readers these are checked against are in [`packages/source/decompile/README.md`](../packages/source/decompile/README.md).

| Tool | Kind | Purpose and interface |
|---|---|---|

## Archived toolchains

The ESP32 audio bridge and its host tools, and the Plan 05 invention engine
(`tools/invent/`) left the tree on 2026-09-24. The in-engine recompile
toolchain left with them and came back on 2026-09-27 for ROADMAP S2b:
[`packages/source/recompile/README.md`](../packages/source/recompile/README.md) indexes it. [`docs/ARCHIVED-ROUTES.md`](../docs/ARCHIVED-ROUTES.md) names the
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
3. Reuse `chrome.ts`, `pool.ts`, `screenstate.py` or `coords.sh` instead of
   duplicating browser, parallel, device guard or coordinate infrastructure.
4. For device actions, validate inputs, focus, and screen state; refuse unsafe
   overwrite; use a device-side monotonic schedule for timed sequences.
5. Add or update the entry in the index of the script's directory in the same
   change, including its interface, side effects, dependencies, and whether it
   is safe to run unattended.
