# `@sixam/source`

Truth, in [ADR 0002](../../docs/decisions/0002-kernel-contexts-vocabulary.md)'s
contexts: each game's Rulebook data, Sim rules and controls, and the
cross-game clockwork they share. It moved out of `@sixam/core` in migration
steps D1 and D4 ([Plan 27](../../plans/27-pivot-and-rebrand.md)'s move map),
and it imports only [`@sixam/kernel`](../kernel/README.md)
(`tools/architecture-test.js`).

| Path | What it is |
|---|---|
| `src/games/fnaf1/`, `fnaf3/`, `fnaf4/` | the game's Rulebook data (`fnafN.js`), its Sim (`sim-fnafN.js`), its source movement graph (`graph.json`) and its control catalog (`controls.js`); `index.js` is the game's barrel, `@sixam/source/fnafN` |
| `src/games/fnaf2/` | FNaF 2's plant model (`plant-model.js`, `config.js`, `rng.js`), the `PlantModel` facade (`plant.js`), the reduced model, seed recovery, its night in the shared shape (`fnaf2.js`) and its control catalog with the artifact action table (`controls.js`); `index.js`, `@sixam/source/fnaf2`, exports exactly what `@sixam/core/mechanics` did |
| `src/clockwork/` | the package root, `@sixam/source`: the nights registry (`games.js`) and night model, the Fusion RNG (`rng.js`), the control catalogs' registry and shape, the vocabularies generated from them, and the contract validators generated from them (`validateControlCommand`, `deviceProfileGame`, `resolveDeviceProfile`) |
| `test/` | the sourced draw-order and Sim contract tests, the control catalog and `semantic-control-v1` tests, and their fixtures; all in `npm run test:contracts` |
| `decompile/` | the decompile and read chain (was `tools/dump/`): the CTFAK event-text dumper and its Docker image, `regen-dump.sh`, the sheet readers (`readdump.py`, `nightmap.py`, `aimap.py`, `coverage.py`), `extract-samples.sh` and their tests; its [`README.md`](decompile/README.md) is the tool index `tools/test-docs.mjs` holds them to. Two comments still name `tools/dump/`: one in `src/games/fnaf2/config.js`, whose bytes are frozen, and one in `src/games/fnaf3/fnaf3.js`, which another session is editing |

Any file under `src/games/` is importable as `@sixam/source/games/<game>/<file>`,
for a caller that wants one module's exact namespace (core's controllers read
FNaF 2's `config.js` that way).

**The three model sources.** `src/games/fnaf2/plant-model.js`, `config.js`
and `rng.js` moved byte for byte and stay together, because `plant-model.js`
imports the other two by `./`. A retained bracket-sweep result names them by
their old paths and sha256; its check
(`tools/recompile/test-phone-input-bracket-sweep.mjs`) finds each old path's
bytes in that path's git history and matches the files by name, so it no
longer depends on where they live. `packages/core/src/mechanics/` still keeps a
symbolic link for each, because `tools/recompile/model-draw-trace.mjs` looks
for the model it hashes into new records beside the `@sixam/core/mechanics`
barrel. `src/clockwork/rng.js` is the cross-game name for the RNG and
re-exports FNaF 2's file until migration step D2 splits the plant model.

Importers repointed in migration D3 name this package directly. Five
`tools/recompile` modules (another session's) and the three engine-source files
a bundle manifest hashes byte for byte (`tools/device/minus-toys-plan.mjs`,
`tools/device/recipe.mjs`, `tools/model/hid-device-pilot.mjs`) still reach it
through core's compatibility shims
([`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json)).
