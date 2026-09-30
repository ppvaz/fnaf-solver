# `@sixam/propose`

ADR 0002's Propose context (Decision layer): what a player does, and the work
that decides which of those choices to keep.

| Path | Holds | Entry point |
|---|---|---|
| `src/policy/` | the finite policy IR (`CONTRACT:policy-program-v1`), the observation language its branches read, and the controller and supervisor ports (`CONTRACT:controller-v1`) | `@sixam/propose/policy` |
| `src/games/fnaf2/` | FNaF 2's reactive controllers, the reviewed Minus Toys cycle library, its planner, the belief-backed cycle controller and the sourced night policy | `@sixam/propose/fnaf2` |
| `src/games/policy-fnaf{1,3,4}.js` | FNaF 1, 3 and 4's published lines and controls, which `tools/census.mjs` runs | `@sixam/propose/games/policy-fnaf1.js` (each exports its own `POLICIES`) |
| `test/` | the cycle library, planner and controller and the night policy (`test:contracts`) | |

The package root re-exports the policy language and FNaF 2's controllers.

Moved here from `@sixam/core` in migration M8 (2026-09-30), byte for byte but
for their imports. `@sixam/core/control` still exports every name it did, as a
compatibility shim registered in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json)
(`core.control-policy-shim`), because `tools/device/minus-toys-plan.mjs`, whose
bytes every Minus Toys bundle hashes, imports it. New code imports
`@sixam/propose/*`.

**Dependencies** (`tools/architecture-test.js`, rules `propose`,
`propose-test` and `propose-importers`): propose imports the kernel, source,
Play's host-free half that core still holds (`@sixam/core/sensing`,
`@sixam/core/estimation`), review, and Node built-ins. It never reaches the
device shell -- `apps/device`, `packages/adapters`, `tools/`, `child_process`,
`net`, `dgram` -- and never imports `@sixam/core` or `@sixam/core/control`,
which re-export it. Nothing imports propose except the applications and the
registered shims, which may only re-export it. The policy and game modules
keep core's rule: no host or browser global.

Every policy here is a model candidate: it is `MODEL_ONLY` until a device run
of it is packed and promoted under Plan 12, and a census over it is
pre-registered with its family and held-out block (ADR 0002 principle 7).
