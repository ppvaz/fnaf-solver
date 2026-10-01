# Plan 22 closure matrix

**Rows last reconciled against the device record on 2026-09-17.** P5 moved to
`Closed`. **2026-09-29 (ADR 0002, migration M5b):** P3, P4 and P7 rewritten,
because each cited something removed on 2026-09-25 (`packages/runtime`,
`apps/device/test/service.test.js`, `npm run device:dry-run`,
`packages/screencheck`; `6d78c7e`, `903ffab`). Every other row is as it stood on
2026-09-02.

Status is intentionally separate from the plan text and the historical progress
log. `Foundation` means the boundary or scaffold exists; `Closed` means the
plan's stated Done when is evidenced; `Open` means a required gate remains.

| Package | Status | Evidence in this branch | Required closure / remaining gap |
|---|---|---|---|
| P0 — characterize boundaries | Foundation | `npm run catalog`, `node tools/architecture-test.ts`, `node tools/validate-references.ts`, shared contract fixtures | Three isolated duration/flakiness runs and a measured test manifest are still required. |
| P1 — establish workspace/core | Closed | `npm ci`, `npm test`, `npm run typecheck`, package exports and root `src` absence | Keep the clean-checkout bootstrap green. |
| P2 — extract canonical mechanics | Foundation | `packages/core/src/mechanics`, `packages/core/src/control`, `packages/play/src/player`, `node packages/source/test/sourcetest.ts`, `node packages/source/test/simtest.ts`, core boundary audit | Broader controller/trainer equivalence and measured migration fixtures remain open. |
| P3 — define contracts and ports | Foundation | `packages/kernel/contracts/register.json` and the `@sixam/kernel/contracts` validators (moved from `packages/core` by ADR 0002 migration D1); `packages/kernel` (ADR 0002 kernel types with a consumer today: `Interval`, `ClaimLevel`, `SourceLabel`, `Outcome`, `GameRun` with custody, `Annotation`; `packages/kernel/test/kernel.test.ts`), read by `packages/review`'s pack lift and promotions query; shared contract vectors (`packages/kernel/test/contract-vectors.py`) | Ports are named in ADR 0002 and become interfaces only at their third implementation; the scheduler and supervisor ports left with `packages/runtime` (`6d78c7e`) and the actuator, sensor and detector ports with the adapter hexagon (`903ffab`), because no night used them. Open: RunSpec, VenueIdentity, ClockTrace, Fact and Press enter the kernel with their consumers (migrations M6-M8); one schema source for contracts and resolved profiles (LEG-006). |
| P4 — adapters and runtime composition | Foundation | `node packages/play/test/conformance.test.ts` (HID wire, Companion, clocks and the fitted rules the campaign reads); CI's campaign dry run over a committed winner (`npm run device:emit`, then `npm run device:campaign -- --bundle DIR --nights N`); `apps/device/src/cli.js campaign`, the one path onto a phone | The runtime composition this row planned (`DeviceControlService` over `packages/runtime`, and the adapter registry under it) never played a night and was retired on 2026-09-25 (`6d78c7e`, `903ffab`); the campaign executor composes the transports itself. Open: split the executor and the campaign ports by responsibility (LEG-004, migration M7); Sensor and Actuator stay provisional until a third implementation. |
| P5 — device execution | Closed 2026-09-14 | Qualified transport `hid-mediaprojection` (`qualification-hid-mediaprojection-20260907`); bounded temporal execution on every story night and Custom Night 7; real session bundles retained per run under `artifacts/` with their evidence records in `docs/evidence/` | Closed by execution, not by reliability: the only declared cohort is Night 7's at 3 wins in 10 runs, and no Plan 12 promotion edge has been recorded. **The crossover is decided (2026-09-02): the legacy runner is deprecated, so this row was the only path to new ladder evidence — and it carried it.** |
| P6 — research/evidence path | Foundation | Generic reference cases plus real family evaluators for Minus Toys and Minus Two; legacy aliases call the same evaluators; family campaigns emit candidate statistics, terminal causes, trace hashes, artifact refs, and effective replay; `promote` invokes a structured Plan 12 gate; `winner-v1` now compiles into a replay-checked device bundle | Port a broader real synthesis/optimization/robustness campaign set and retain external evidence before closing. |
| P7 — screencheck extraction | Retired 2026-09-25 | `packages/screencheck` and its build, model, replay and benchmark tools were removed in `903ffab` with the adapter hexagon that alone used them (`docs/ARCHIVED-ROUTES.md`; restore with `git checkout 6d78c7e -- <path>`). Detection now reads native regions of MediaProjection frames in the Companion (`NativeRegions.java`) with the rule on the host (`native-regions.mjs`) | None: retired, not closed. A phone-side classifier returns only as a Companion feature (CLAUDE.md, "Sensors and on-device code"). |
| P8 — docs/indexes/evidence | Foundation | generated catalogs, static portal, evidence CLI, hash-checked replay, Plan 12 promotion refusal, claim graph, generated reverse links, five-query retrieval benchmark, `node tools/test-docs.ts` | Promotion remains blocked without external evidence. |
| P9 — compatibility removal/audit | Open | descriptive `tools/model/` pilots, no production test imports, TypeScript shape check plus checked JS (strict migration still open), `test:affected`, bounded progressive runner; **legacy shell lane archived 2026-09-25** (`legacy-trial.sh`, its 13 driver parts, the mask-camp runners, shell preflight, pilot supervisor and the graders that read only their artifacts; [`ARCHIVED-ROUTES.md`](../docs/ARCHIVED-ROUTES.md)) — `grade-run.sh` output on a retained night was unchanged in every live instrument | Apply strict TypeScript to new/materially extracted long-lived modules or document an approved exception; resolve the known red engine gate; fold the artifact lane (`trial.sh` → `artifact-runner.mjs`) and the service/dry-run path into the campaign executor; complete live qualification. |

## Release rule

Plan 22 remains `foundation/phase 1` while any row is `Foundation` or `Open`.
Only a checked-in evidence artifact or an explicitly documented external gate
may change a row to `Closed`; a green scaffold or a CLI refusal is not a
physical qualification result.

## Recheck commands

```sh
npm test
npm run typecheck
npm run test:affected
npm run catalog
node tools/test-docs.ts
npm run device:emit -- --winner packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json --out /tmp/k3
npm run device:campaign -- --bundle /tmp/k3 --nights 7 --profile hid-mediaprojection
npm run research -- model-smoke
npm run evidence -- list
npm run review -- query promotions
```
