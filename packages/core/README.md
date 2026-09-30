# `@sixam/core`

Canonical, evidence-labelled Android mechanics and semantic control contracts.
The package owns the deterministic plant model, policy IR, reduced model,
estimation foundations, clocks, and versioned data validators.

Public entry points are `.`, `/mechanics`, `/control`, `/sensing`,
`/actuation`, `/estimation`, `/timing`, `/telemetry`, `/training`, and
`/contracts`. Core has
no runtime dependencies and no knowledge of DOM, shell, devices, transports,
or trainer presentation. Applications select those adapters at their
composition roots.

`PlantModel` is the semantic facade; `Sim` remains available as the exact
concrete model for source-equivalence tests and model research.

Commands: use the root `test:core`, `test:contracts`, and `typecheck` lanes.
Artifacts: contract fixtures and the generated contract/specification catalogs.
Non-responsibilities: browser UI, device profiles/transports, shell execution,
and evidence promotion.
