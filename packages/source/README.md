# `@sixam/source`

Truth, in [ADR 0002](../../docs/decisions/0002-kernel-contexts-vocabulary.md)'s
contexts: each game's Rulebook data, Sim rules and controls, and the
cross-game clockwork they share. It moved out of `@sixam/core` in migration
steps D1 and D4 ([Plan 27](../../plans/27-pivot-and-rebrand.md)'s move map),
and it imports only [`@sixam/kernel`](../kernel/README.md)
(`tools/architecture-test.js`).

| Path | What it is |
|---|---|
| `src/games/fnaf1/`, `fnaf3/`, `fnaf4/` | the game's Rulebook data (`fnafN.ts`), its Sim (`sim-fnafN.ts`), its source movement graph (`graph.json`) and its control catalog (`controls.ts`); `index.ts` is the game's barrel, `@sixam/source/fnafN` |
| `src/games/fnaf2/` | FNaF 2's plant model (`plant-model.ts`, `config.ts`, `rng.ts`; the Sim's options, constants and mechanisms in `plant-options.ts`, `plant-constants.ts`, `plant-office.ts`, `plant-hall.ts`, `plant-units.ts`, `plant-sheet.ts` and `plant-puppet.ts`, installed on `Sim.prototype` by `plant-model.ts`; the clocks and contact state the full-06 replays measured in `movement-clock.ts`, `contact-input.ts`, `attack-animation.ts` and `blackout-clock.ts`), the `PlantModel` facade (`plant.ts`), the reduced model, seed recovery, its night in the shared shape (`fnaf2.ts`) and its control catalog with the artifact action table (`controls.ts`); `index.ts`, `@sixam/source/fnaf2`, exports exactly what `@sixam/core/mechanics` did |
| `src/clockwork/` | the package root, `@sixam/source`: the nights registry (`games.ts`) and night model, the Fusion RNG (`rng.ts`), the control catalogs' registry and shape, the vocabularies generated from them, and the contract validators generated from them (`validateControlCommand`, `deviceProfileGame`, `resolveDeviceProfile`) |
| `src/truth/` | Truth's reading of a game's own event sheet (Plan 28 step 5), pure: the tabular event-text dump parsed into fields (`dump.ts`), the handful of engine ACE numbers it names (`engine.ts`), the per-build handle scramble K by object-type agreement (`handles.ts`), and the events and object queries (`query.ts`); `@sixam/source/truth/read` |
| `decompile/truth.mjs` | the host side, `@sixam/source/truth`: finds the caller's own dump through the untracked `decompile/local-vault.json` or `$SIXAM_TRUTH_VAULT`, refuses naming the decode when there is none, and decodes a local APK or CCN with the local CTFAK dumper; the MCP `truth` tool and `npm run review -- truth` call it. No dump, decoded text or game asset is tracked: the tests build a synthetic dump from the dumper's grammar at run time |
| `test/` | the sourced draw-order and Sim contract tests, the control catalog and `semantic-control-v1` tests, the truth tests (`truth.test.js`, over a synthetic dump), and their fixtures; all in `npm run test:contracts` |
| `decompile/` | the decompile and read chain (was `tools/dump/`): the CTFAK event-text dumper and its Docker image, `regen-dump.sh`, the sheet readers (`readdump.py`, `nightmap.py`, `aimap.py`, `coverage.py`), `extract-samples.sh` and their tests; its [`README.md`](decompile/README.md) is the tool index `tools/test-docs.mjs` holds them to. Two comments still name `tools/dump/`: one in `src/games/fnaf2/config.js`, whose bytes are frozen, and one in `src/games/fnaf3/fnaf3.js`, which another session is editing |

Any file under `src/games/` is importable as `@sixam/source/games/<game>/<file>`,
for a caller that wants one module's exact namespace (propose's controllers read
FNaF 2's `config.ts` that way).

**TypeScript.** Since 2026-09-30 the sources are TypeScript that Node runs
by type stripping (Pedro: "runtime .ts"; `tools/ts-migrate.mjs`), checked at the
strictness they had as JavaScript (`typecheck:js`), to be tightened later. The
browser gets them with their types erased (`apps/trainer/test/strip-types.mjs`).

**The model sources.** `src/games/fnaf2/plant-model.ts`, `config.ts`
and `rng.ts` moved byte for byte and stay together, because `plant-model.ts`
imports the other two by `./`. `MODEL_SOURCES` in
`packages/source/recompile/model-draw-trace.mjs` lists those three first and
then every module `plant-model.ts` reaches by a relative import (the 2026-09-30
splits), and hashes the whole list into new records. A retained bracket-sweep
result names the first three by their old paths and sha256; its check
(`packages/propose/bin/recompile/test-phone-input-bracket-sweep.mjs`) finds each
old path's bytes in that path's git history and requires the record to name, by
file stem and in order, the files the current list begins with, so it depends
neither on where they live, nor on `.js` becoming `.ts`, nor on modules split
out after it was computed.
`src/clockwork/rng.js` is the cross-game name for the RNG and
re-exports FNaF 2's file until migration step D2 splits the plant model.

Every importer names this package directly: the last ones, five
`tools/recompile` modules and the engine sources a bundle hashes, were
repointed on 2026-09-30, and `@sixam/core`'s shims were removed with them.

## Scripts

Entry points and checks that lived in `tools/` until the ADR 0002 layout
moved them here, with the description their tool index gave them.

| Script | Kind | What it does |
|---|---|---|
| `packages/source/test/sourcetest.mjs` | check | Direct assertions for sourced engine rules and reachable input states, keyed to event-sheet groups. Runs first in the engine suite so a wrong mechanism cannot hide behind unchanged population statistics. |
| `packages/source/test/seed-recovery.mjs` | report/module | Stock-APK RNG hypothesis CLI: turns a device-time or host-marker window into low-16-bit seed candidates, filters exact roll observations, and replays sourced event observations through the simulator. It reports candidates only; it never authorizes device actions. |
| `packages/source/test/seed-recoverytest.mjs` | check | Phone-free regression for timestamp wrap, host/device marker windows, full-space roll filtering, event replay, and candidate-count bounds. |
| `packages/source/test/propertytest.mjs` | check | Dependency-free bounded property gate: shrinks a failing campaign seed, checks `Sim.snapshot()`/`restore()` identity and continuation, compares same-seed event traces, and proves Night 1 never arms Balloon Boy. |
| `packages/source/test/test-night-models.mjs` | check | Checks the four night models against figures derived independently of them: FNaF 1's published table and 8:55 night, FNaF 2's `config.js` round-trip, FNaF 3's handset-measured 240 s Night 1, and the roll arithmetic. |
| `packages/source/test/simtest.mjs` | check | Canonical headless engine/mechanics regressions, plus the coach's per-step grading contract (a measured window may only tighten a lesson's tolerance, and must grade lopsidedly). `--sweep` also drives perfect Minus 7 over 200 seeds. |
