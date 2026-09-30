# `@sixam/core`

Canonical, evidence-labelled Android mechanics and semantic control contracts.
The package owns the deterministic plant model, policy IR, reduced model,
estimation foundations, the phase clock, and the bench transport trace.

Public entry points are `.`, `/mechanics`, `/control`, `/sensing`,
`/estimation`, `/timing`, `/telemetry`, `/training`, and `/contracts`.

**Moving out (ADR 0002, [Plan 27](../../plans/27-pivot-and-rebrand.md)).** The
contracts, the contract register and the kernel's Time (the fact link, the
event clocks, the clock port) live in [`@sixam/kernel`](../kernel/README.md)
since migration step D1. `/contracts`, `/telemetry` and `/timing` still export
every name they did, re-exporting the kernel's by name: they are compatibility
shims registered in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json), each
with its removal gate. New code imports `@sixam/kernel/contracts` and
`@sixam/kernel/time`. The three validators generated from the control catalogs
(`validateControlCommand`, `deviceProfileGame`, `resolveDeviceProfile`) are in
`src/contracts/control-contracts.js` until the catalogs move.

Core depends on the kernel only, and has no knowledge of DOM, shell, devices,
transports, or trainer presentation. Applications select those adapters at
their composition roots.

`PlantModel` is the semantic facade; `Sim` remains available as the exact
concrete model for source-equivalence tests and model research.

Commands: use the root `test:core`, `test:contracts`, and `typecheck` lanes.
Artifacts: contract fixtures and the generated contract/specification catalogs.
Non-responsibilities: browser UI, device profiles/transports, shell execution,
and evidence promotion.
