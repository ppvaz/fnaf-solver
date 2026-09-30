# `packages/adapters` (moved into `@sixam/play`)

The transports, clocks and detection rules that lived here are in
[`@sixam/play`](../play/README.md) since ADR 0002's Play move. This folder is no
longer a workspace; nothing imports it.

One path is kept: `src/button-strokes.js`, a symbolic link to
`packages/play/src/sensors/fnaf2/button-strokes.js`. The retained
`tools/recompile/results/full06-responses-20260928.json` records the response
rule's source as `packages/adapters/src/button-strokes.js` with its sha256, and
`tools/recompile/test-phone-encounter-replay.mjs` reads that path and compares.
It is registered as `adapters.button-strokes-link` in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json), with
its removal gate.
