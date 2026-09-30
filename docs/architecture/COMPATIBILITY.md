# Compatibility and legacy-path map

This is the bounded migration inventory. Every compatibility or legacy path
has one replacement owner, an explicit removal gate, and a reason it still
exists. No entry is a second semantic authority. The machine-readable view is
generated at [`generated/legacy-paths.json`](generated/legacy-paths.json) from
the registry in `tools/generate-catalog.js`; regenerate it with `npm run
catalog` when a path or gate changes.

Lifecycle meanings:

- **compatibility** — caller-facing alias/facade; new behavior must land in the
  canonical owner only.
- **transitional** — still shared by a current path, but its responsibility is
  scheduled to move behind a package or adapter boundary.
- **legacy** — historical implementation or experiment; diagnosis/replay only,
  never a source of new policy or live claims.

## Device execution paths

| Surface | Lifecycle | Canonical replacement | Removal gate |
|---|---|---|---|
| `tools/device/session.sh` | compatibility | run packs for nights; kept for `collect-cue-audio.sh` and `capture-screen-sample.sh` | those collectors write run packs or retire |
| `tools/device/session-manifest.py` + `validate-session.py` | legacy/transitional | `@sixam/kernel/contracts` manifest validator and evidence CLI | historical shell manifests are indexed and replayable |
| `tools/device/grade-run.sh` | transitional | evidence CLI over content-addressed device bundles | historical video/HID/session artifacts have an equivalent structured grader |
| `tools/device/select-adb.sh` | transitional | injected transport selected by the device composition root | direct-ADB probes become adapters or are explicitly archived |
| `tools/device/coords.sh` | transitional | resolved profile `controlMap` | every device action consumes profile geometry |
| `tools/device/menu.sh` | transitional | calibrated title/menu detector and the campaign state gate | detector evidence and a dry-run fixture cover the menu states |

The historical shell runner, its launcher facade, the artifact runner and the
fixture service path were archived on 2026-09-25
([`../ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)); `apps/device/src/cli.js`
`campaign` is the one path onto a phone.

**Deprecated 2026-09-02.** `legacy-trial.sh` is reference and characterization
input only. It may not produce new evidence on
[Plan 12](../../plans/12-end-to-end-evidence-campaign.md)'s ladder; the modern
path climbs it from Level 1. The runner's own historical results — including
the Night 1 clear `n1-full-1640` — remain citable and remain attributed to it.
Its device gates stay green as characterization tests and are not qualification
of the path that climbs. See the [2026-09-02 roadmap](../../plans/archive/ROADMAP-2026-09-02.md).

## Transitional model and research paths

| Surface | Lifecycle | Canonical replacement | Removal gate |
|---|---|---|---|
| `tools/device/recipe.mjs` | transitional | package-owned winner/device-bundle emitter | bundle compiler no longer imports the tools tree and replay hashes match |
| `tools/device/actuator.mjs` | transitional | stays the model's actuator/error table; the adapter actuator it was to move behind was retired on 2026-09-25 | a package owns the error model and the pilot consumers replay unchanged |
| `tools/device/policy-ir.mjs` | transitional | core policy-program contract and research emitter | P3 vocabulary migration and fixed-seed artifact equivalence |
| `tools/model/stock-device-pilot.mjs` | legacy | structured research experiment with an explicit historical actuator model | historical sweeps replay from retained artifacts |
| `tools/minustoystest.mjs` | compatibility | `npm run research -- minus-toys` | package artifacts and fixed-seed output are equivalent |
| `tools/minus2test.mjs` | compatibility | `npm run research -- minus-two` | package artifacts and fixed-seed output are equivalent |
| `package.json#scripts.test:legacy:engine` | compatibility | `node tools/test.mjs --engine` (canonical engine fixture lane) | bare-Node compatibility lane is no longer needed and P9 is green |

The cue-model provisioner (`tools/device/provision-cue-model.sh`) is also
registered as a legacy path. It remains only to replay historical APK
experiments; current models are content-addressed adapter/profile inputs. The
ESP32 fallback packer (`tools/cue/pack-esp32-cues.py`) was archived with the
firmware on 2026-09-24 — [`../ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md).

The legacy session producer/validator pair has a similarly named but distinct
schema (`fnaf2.session-manifest`) from the runtime `session-manifest-v1`
contract. That distinction is recorded in the generated map so removal cannot
silently strand old manifests or merge two incompatible validators.

## ADR 0002 context moves (Plan 27, migrations D1, D3, D4, M8)

The contracts, the register and Time moved out of `@sixam/core` into
[`@sixam/kernel`](../../packages/kernel/README.md); each game's mechanics and
controls, and the cross-game clockwork, into
[`@sixam/source`](../../packages/source/README.md); the policy language, FNaF
2's controllers and cycle machinery and FNaF 1, 3 and 4's policies into
[`@sixam/propose`](../../packages/propose/README.md), which also absorbed
`@sixam/research`. The core subpaths that named them stay as re-export shims
with their export sets unchanged, and research keeps, with unchanged export
sets, the two subpaths that hash-bound files import, so an importer the move
did not repoint keeps working. `tools/architecture-test.js`
lets a shim registered as owned by `@sixam/propose` re-export propose, and
nothing else in a package import it; the Play move (packages/adapters, the
device campaign and core's last modules into `@sixam/play`) does the same for
a shim owned by `@sixam/play`. `@sixam/core/telemetry`, `/timing`,
`/estimation`, `/training` and the `.` barrel were removed in that move:
their removal gates held once their importers were repointed.

| Surface | Lifecycle | Canonical replacement | Removal gate |
|---|---|---|---|
| `@sixam/core/contracts` (`packages/core/src/contracts/index.js`) | compatibility | `@sixam/kernel/contracts`; the three catalog-generated validators from `@sixam/source` | no tracked module imports a contract from `@sixam/core` |
| `@sixam/core/mechanics` (`packages/core/src/mechanics/index.js`) | compatibility | `@sixam/source/fnaf2` (the same export set) | no tracked module imports it: tools/recompile's importers are repointed by their owner, and the engine-source files a bundle manifest hashes in a commit that re-derives every bundle |
| `packages/core/src/mechanics/{plant-model,config,rng}.js` (symbolic links) | compatibility | `packages/source/src/games/fnaf2/` (the same bytes) | `tools/recompile/model-draw-trace.mjs` finds the model it hashes through `@sixam/source`; the bracket check already reads a record's old paths through their history |
| `@sixam/core/control` (`packages/core/src/control/index.js`) | compatibility | `@sixam/source` for the vocabulary and the catalogs; `@sixam/propose/policy` and `@sixam/propose/fnaf2` for the policy language, FNaF 2's controllers and the cycle machinery (migration M8) | no tracked module imports it: tools/recompile's two importers are repointed by their owner, and `tools/device/minus-toys-plan.mjs`, whose bytes every Minus Toys bundle hashes, in a commit that re-derives every bundle |
| `@sixam/research` (`packages/research/package.json`) | compatibility | `@sixam/propose` (experiments, strategies, seed cohorts, specs, parked Minus 7); `npm run research` runs `packages/propose/src/experiment/cli.js` | both subpath shims below are removed; then the workspace goes |
| `@sixam/research/seeds` (`packages/research/seeds.js`) | compatibility | `@sixam/propose/seeds` | `tools/device/minus-toys-plan.mjs` and `minus-3-plan.mjs`, whose bytes every Minus Toys and Minus 3 bundle hashes, are repointed in a commit that re-derives every bundle |
| `@sixam/research/strategies/minus-3` (`packages/research/strategies/minus-3.js`) | compatibility | `@sixam/propose/strategies/minus-3` | `tools/device/minus-3-plan.mjs` is repointed in a commit that re-derives every bundle |
| `@sixam/core/sensing` (`packages/core/src/sensing/index.js`) | compatibility | `@sixam/play/sim` (the same export set) | `tools/device/minus-toys-plan.mjs`, whose bytes every Minus Toys bundle hashes, is repointed in a commit that re-derives every bundle |
| `packages/adapters/src/button-strokes.js` (symbolic link) | compatibility | `packages/play/src/sensors/fnaf2/button-strokes.js` (the same bytes) | `tools/recompile/phone-encounter-replay.mjs` names the rule source through play, and the retained full06-responses result is checked through the path's history |

## Already removed

The root `src/` compatibility re-exports were removed after the import
equivalence gate. Package and application imports are canonical. Historical
fixtures that mention deleted command names remain negative test inputs and do
not make those commands available again.
