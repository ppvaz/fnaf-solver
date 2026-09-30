# `@sixam/core`

What is left of the canonical core while ADR 0002's contexts take it apart:
Play's host-free half -- the Sim observer (sensing), estimation and the phase
clock -- the bench transport trace, and training. Later migration steps move
them to Play, Review and the trainer ([Plan 27](../../plans/27-pivot-and-rebrand.md),
the layout in ADR 0002).

Public entry points are `.`, `/mechanics`, `/control`, `/sensing`,
`/estimation`, `/timing`, `/telemetry`, `/training`, and `/contracts`.

**Moved out, with shims (ADR 0002 migrations D1, D4, M8).** The contracts, the
contract register and the kernel's Time live in
[`@sixam/kernel`](../kernel/README.md); each game's Rulebook data, Sim and
controls, and the cross-game clockwork (nights registry, RNG, control
catalogs and vocabulary, and the validators generated from them), live in
[`@sixam/source`](../source/README.md); the policy IR and observation language,
FNaF 2's controllers and Minus Toys cycle machinery, and the FNaF 1, 3 and 4
policies live in [`@sixam/propose`](../propose/README.md). `/contracts`,
`/mechanics`, `/control`, `/telemetry` and `/timing` still export every name
they did (checked name by name), re-exporting the new owners: compatibility
shims registered in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json), each
with its removal gate. New code imports `@sixam/kernel/contracts`,
`@sixam/kernel/time`, `@sixam/source`, `@sixam/source/fnaf2`,
`@sixam/propose/policy` and `@sixam/propose/fnaf2` directly.
`src/mechanics/` also keeps symbolic links named `plant-model.js`, `config.js`
and `rng.js` to FNaF 2's model sources, because
`tools/recompile/model-draw-trace.mjs` looks for the model beside this barrel.

Core depends on the kernel and source only, and has no knowledge of DOM,
shell, devices, transports, or trainer presentation. Applications select those
adapters at their composition roots. The one exception is the `/control` shim,
which re-exports `@sixam/propose` for `tools/device/minus-toys-plan.mjs` (its
bytes are hashed into every Minus Toys bundle) and two `tools/recompile`
modules; `tools/architecture-test.js` admits that re-export because the shim
is registered as owned by propose, and refuses any other core import of it.

Commands: use the root `test:core`, `test:contracts`, and `typecheck` lanes.
Core's own modules are tested by `tools/belieftest.mjs`,
`tools/estimatortest.mjs`, `tools/phaseclocktest.mjs`,
`tools/benchtracetest.mjs` and the training checks; it has no `test/` folder
since the cycle and night-policy tests moved with their code to
`packages/propose/test`.
Non-responsibilities: browser UI, device profiles/transports, shell execution,
policies, and evidence promotion.
