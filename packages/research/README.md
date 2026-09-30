# `@sixam/research` (compatibility shim)

Empty since ADR 0002 migration M8 (2026-09-30). Its experiments, strategies,
seed cohorts, experiment specs and parked Minus 7 live in
[`@sixam/propose`](../propose/README.md), and `npm run research` runs
`packages/propose/src/experiment/cli.js`.

Two subpaths remain, each a one-line re-export of propose, because files
whose bytes a bundle hashes still import them:

| Subpath | Re-exports | Imported by |
|---|---|---|
| `@sixam/research/seeds` (`seeds.js`) | `@sixam/propose/seeds` | `tools/device/minus-toys-plan.mjs`, `tools/device/minus-3-plan.mjs` |
| `@sixam/research/strategies/minus-3` (`strategies/minus-3.js`) | `@sixam/propose/strategies/minus-3` | `tools/device/minus-3-plan.mjs` |

Both importers are engine sources: `tools/device/bundle.mjs` hashes their bytes
into every Minus Toys and Minus 3 bundle's `engine.sourceSha256`, so they are
repointed only in a commit that re-derives every emitted bundle. Each shim is
registered in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json) with
that removal gate, and `tools/architecture-test.js` refuses anything here but a
re-export of propose. New code imports `@sixam/propose`.
