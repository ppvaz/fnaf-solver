# Contributing

This repository publishes derived knowledge about the modern Android target;
never commit game assets, decompiled content, recordings, secrets, or local
calibrations. The one written exception (Pedro, 2026-09-29) is the README's two
gameplay clips, `docs/img/night7-teach-panel-cycle22.gif` and
`docs/img/fnaf1-420-teach-panel-bonnie.gif`: at most two clips, each at most
4,000,000 bytes, and the exception covers no other game media. Preserve
evidence labels, negative results, controls, and retractions.

## Clean-checkout workflow

```sh
npm ci
npm test
npm run build:trainer
npm run device:emit -- --winner packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json --out /tmp/k3
npm run device:campaign -- --bundle /tmp/k3 --nights 7 --profile hid-mediaprojection
```

Use `npm run test:unit` for boundary checks, `npm run test:contracts` for
ports/codecs, and `npm run test:core` for the legacy exact-model lane. Slow
simulation, browser real-time, bench, and qualification lanes are explicit;
retries never turn a red gate green.

Core owns mechanics and semantic commands. Runtime schedules and supervises.
Adapters own physical capability, calibration, and transport differences.
Trainer, research, and device are application leaves. New device behavior must
be profile-selected and fixture-tested before any live lane.

For migrations, characterize -> add a contract test -> change -> compare
semantic traces -> switch the canonical path -> remove the compatibility shim
at a named gate. Keep core free of DOM, filesystem, shell, network, wall-clock,
and device imports. See [`CLAUDE.md`](CLAUDE.md) and the
[architecture docs](docs/architecture/README.md).
