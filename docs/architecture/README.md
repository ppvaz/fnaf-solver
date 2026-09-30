# Current architecture

The repository is a private npm-workspaces monorepo organised by the five
contexts of [ADR 0002](../decisions/0002-kernel-contexts-vocabulary.md), each in
one charter layer, over a shared kernel:

| Context | Layer | In today's code |
|---|---|---|
| Source | Truth | `@sixam/source` (each game's Rulebook data, Sim and controls; the nights registry, night model, RNG, control vocabulary and the validators generated from the catalogs); `packages/source/decompile`, `tools/recompile` |
| Propose | Decision | `@sixam/propose` (the policy language, FNaF 2's controllers and cycle machinery, FNaF 1, 3 and 4's policies); `@sixam/research`; the winner bindings and plan generators in `tools/device` |
| Play | Embodiment | `apps/device` (the campaign, the one composition root that plays a night), `@sixam/adapters` (transports, clocks, fitted rules), the Companion (`android/companion`); `@sixam/core` keeps Play's host-free half (sensing, estimation, the phase clock), the bench trace and training until they move |
| Review | Proof | `@sixam/review` (run packs, Plan 12 attestation and promotion, cohorts, the pack lift to `GameRun`, and `npm run review` queries); the grade pipeline in `tools/device` |
| Teach | Understanding | `apps/trainer` |

`@sixam/kernel` holds the kernel types that have a consumer today --
`Interval`, `ClaimLevel`, `SourceLabel`, `Outcome`, `GameRun` with custody, and
`Annotation` -- with the contracts, the contract register and Time (the event
clocks, the fact link, the clock port), and imports nothing. `@sixam/source`
imports only the kernel. The Source is canonical: where the model
and the game's dump disagree, the dump is right and the model is fixed.

```text
owned Android build -> Source (dump -> Rulebook -> night model; recompile)
                          -> Propose (policies, winners, censuses)
                          -> Play (the campaign on the phone; the trainer's person)
                          -> Review (packs, grades, promotions, queries)
                     every run -> a committed pack -> a claim that names its label
```

Venues report outcomes; Review decides them, and a claim, a promotion or a
status is a query (`npm run evidence -- promotions`,
`npm run review -- query promotions`). Semantic commands never contain
coordinates, shell text, ADB commands, or HID bytes; the HID transport is
composed only by the named device runners. The imports run
`kernel <- source <- play <- propose -> review -> source`
([dependency direction](DEPENDENCY-GRAPH.md)), and `tools/architecture-test.js`
enforces it over each module's syntax tree.

Retired on 2026-09-25, and not part of this architecture: the runtime package
(`packages/runtime`), the fixture device control service built on it, the
adapter capability registry with its actuator, sensor and detector ports, and
the `screencheck` classifier ([archived routes](../ARCHIVED-ROUTES.md)). None of
them played a night.

The [generated catalogs](generated/README.md) are executable views of current
package, command, contract, protocol, test, and responsibility data.
The [architecture legibility follow-up register](LEGIBILITY-FOLLOWUPS.md)
tracks open risks affecting human and agent comprehension, with evidence and
acceptance checks for each item.
The [workspaces ADR](../decisions/0001-workspaces-and-core.md) records why the
development bootstrap is `npm ci` and why core/trainer have no runtime tools;
[ADR 0002](../decisions/0002-kernel-contexts-vocabulary.md) records the kernel,
the contexts and the vocabulary.
The [compatibility inventory](COMPATIBILITY.md) names every remaining legacy or
transitional path, its replacement owner, and removal gate. The generated
[`legacy-paths.json`](generated/legacy-paths.json) view is checked for stale
paths; the former root source shims are gone.
