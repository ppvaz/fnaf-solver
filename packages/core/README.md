# `@sixam/core`

What is left of the canonical core while ADR 0002's contexts take it apart: the
policy IR and observation language, the controllers and the Minus Toys cycle
machinery, the Sim observer (sensing), estimation, the phase clock, the bench
transport trace, training, and the FNaF 1, 3 and 4 policies
(`src/mechanics/games/policy-fnaf*.js`). Later migration steps move them to
Propose, Play, Review and the trainer ([Plan 27](../../plans/27-pivot-and-rebrand.md),
the layout in ADR 0002).

Public entry points are `.`, `/mechanics`, `/control`, `/sensing`,
`/estimation`, `/timing`, `/telemetry`, `/training`, and `/contracts`.

**Moved out, with shims (ADR 0002 migration D1, D4).** The contracts, the
contract register and the kernel's Time live in
[`@sixam/kernel`](../kernel/README.md); each game's Rulebook data, Sim and
controls, and the cross-game clockwork (nights registry, RNG, control
catalogs and vocabulary, and the validators generated from them), live in
[`@sixam/source`](../source/README.md). `/contracts`, `/mechanics`,
`/control`, `/telemetry` and `/timing` still export every name they did (checked
name by name), re-exporting the new owners: compatibility shims registered in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json), each
with its removal gate. New code imports `@sixam/kernel/contracts`,
`@sixam/kernel/time`, `@sixam/source` and `@sixam/source/fnaf2` directly.
`src/mechanics/` also keeps symbolic links named `plant-model.js`, `config.js`
and `rng.js` to FNaF 2's model sources, because
`tools/recompile/model-draw-trace.mjs` looks for the model beside this barrel.

Core depends on the kernel and source only, and has no knowledge of DOM,
shell, devices, transports, or trainer presentation. Applications select those
adapters at their composition roots.

Commands: use the root `test:core`, `test:contracts`, and `typecheck` lanes.
Tests here: the cycle library, planner and controller and the night policy
(`test/`, in `test:contracts`).
Non-responsibilities: browser UI, device profiles/transports, shell execution,
and evidence promotion.
