# `@sixam/core`

What is left of the canonical core after ADR 0002's context moves: registered
compatibility shims and nothing else. Every module here re-exports the context
that now owns it, with the export set the subpath had before the move (checked
name by name), and each is registered in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json) with
its removal gate.

| Subpath | Now owned by | Why it stays |
|---|---|---|
| `/contracts` | [`@sixam/kernel/contracts`](../kernel/README.md) and three catalog-generated validators from `@sixam/source` | hand-run commands and docs still name it (`core.contracts-shim`) |
| `/mechanics` | [`@sixam/source/fnaf2`](../source/README.md) | `tools/device/minus-toys-plan.mjs`, `recipe.mjs` and `tools/model/hid-device-pilot.mjs`, whose bytes every bundle hashes into `engine.sourceSha256`, and `tools/recompile` import it (`core.mechanics-shim`) |
| `/control` | `@sixam/source` (vocabulary, catalogs) and [`@sixam/propose`](../propose/README.md) `/policy` and `/fnaf2` | `minus-toys-plan.mjs` and two `tools/recompile` modules import it (`core.control-*-shim`) |
| `/sensing` | [`@sixam/play/sim`](../play/README.md) (the Sim observer) | `minus-toys-plan.mjs` imports it (`core.sensing-shim`) |

`src/mechanics/` also keeps symbolic links named `plant-model.js`, `config.js`
and `rng.js` to FNaF 2's model sources in `@sixam/source`, because
`tools/recompile/model-draw-trace.mjs` looks for the model beside that barrel
(`core.model-source-link.*`).

**Removed in the Play move**, because nothing imported them once their
importers were repointed: `/estimation` (now `@sixam/play/player`), `/timing`
(the phase clock, now `@sixam/play/clocks`; `ClockPort` has been
`@sixam/kernel/time` since D1), `/telemetry` (the bench trace, now
`@sixam/review/measure`; the fact link and event clocks are
`@sixam/kernel/time`), `/training` (now the trainer's own
`apps/trainer/src/training`, `@sixam/trainer/training`) and the `.` barrel.

`tools/architecture-test.js` (rule `core`) lets core import only itself, source
and the kernel, and lets a shim registered as owned by `@sixam/propose` or
`@sixam/play` re-export its owner and nothing else. Nothing new is added here:
new code imports the owning package.
