# Architecture legibility follow-up register

Status: findings recorded on 2026-09-11; statuses updated 2026-09-29 (LEG-001, 002 and 005
resolved by removal on 2026-09-25; LEG-011 resolved on 2026-09-29). This register
is a backlog for implementation work; an item is only marked resolved with the change that did it.

The scope is human and agent legibility: a contributor should be able to find
the canonical owner, understand the state and safety invariants, and select the
smallest trustworthy validation command without reconstructing the architecture
from history, aliases, and unrelated tools.

The architecture direction ([ADR 0002](../decisions/0002-kernel-contexts-vocabulary.md)):
`kernel` holds the shared kernel types and imports nothing, `core` owns the
Source's model and semantic contracts, `adapters` own physical boundaries,
`play` owns the campaign and its supervision, `apps/desktop` is the one composition root, and `review` reads
the evidence and never imports Play or Propose. (`packages/runtime`, which owned
a fixture temporal dispatcher and supervisor, was removed on 2026-09-25 with the
fixture service path; its retained-run validators moved to `core/contracts`.)
These findings concern the distance between that declared architecture and its
executable surface.

## Triage rules

- `P0` can mis-send input, claim an actuation that did not happen, or produce a
  green validation result for an invalid tree.
- `P1` materially increases the chance of choosing the wrong owner, path, or
  contract during normal work.
- `P2` increases maintenance and navigation cost but does not directly widen a
  device claim.
- An item is closed only when its acceptance checks are implemented and printed
  by the relevant test lane. Documentation alone does not close a code or
  contract finding.

## Findings

### LEG-001 — Make temporal dispatch fail closed (P0)

**Status:** RESOLVED BY REMOVAL (2026-09-25) -- the fixture dispatcher was deleted with the
service path it served; nights are dispatched by the device-local executor's own stream.
**Owner:** `packages/runtime` (removed)
**Evidence:** `packages/runtime/src/scheduler/scheduler.js` line 69 (removed; in git history before 2026-09-25)

An expired command is recorded as `REJECTED`, then the dispatcher continues to
the next command. There is no dependency model that can distinguish an
independent command from a command that assumes the expired toggle or state
transition happened. The audit reproduced a late `mask` followed by a sent
dependent command.

**Acceptance:** the default trajectory policy stops after `REJECTED`, `FAILED`,
or `UNKNOWN`; an explicit, tested independent-command policy is required for
continuation. Add a regression test for an expired prerequisite followed by a
dependent command.

### LEG-002 — Enforce capability/action and physical-binding contracts (P0)

**Status:** RESOLVED BY REMOVAL (2026-09-25) -- the runtime supervisor, the adapter capability
registry and the actuator classes were removed with the fixture service path; the campaign sends
through the HID transport, which `tools/architecture-test.js` now confines to the device runners.
**Owner:** `packages/adapters`
**Evidence:** `supervisor.js` line 20, `registry.js` line 18, `actuators.js` line 59 (all removed)

The supervisor checks the requested control but not `action.kind`, although
the adapter registry declares supported actions. A profile that only declares
`press` accepted `select` in the audit. An unmapped ADB control can fall back to
the fixture result path and report `SENT` without a physical tap.

**Acceptance:** one shared predicate validates adapter, control, action, and
binding; supervisor and every actuator use it; unsupported actions and missing
bindings produce honest `REJECTED`/`FAILED` results. Add conformance tests for
`select` on ADB and for an unmapped control.

### LEG-003 — Make affected validation complete (P0)

**Status:** OPEN -- interim: `packages/review/` (2026-09-29) is mapped to its tests and the
evidence CLI test; every new path is mapped in the change that creates it until the lanes are
generated from one manifest (migration M10).
**Owner:** test infrastructure
**Evidence:** [`affected-test.js` (lines 52 and 65)](../../tools/affected-test.js)

`npm run test:affected` can pass while JavaScript typecheck fails, and changes
under several `tools/device` paths do not select their focused tests. The
affected map is a second, incomplete definition of source ownership.

**Acceptance:** source changes always run the applicable typecheck; every
owned source family has an affected-test mapping; CI proves that a changed
device plan selects its contract test. Generate package scripts, CI lanes, and
the affected runner from one machine-readable test manifest.

### LEG-004 — Split device orchestration by responsibility (P1)

**Status:** PARTIAL (2026-09-25) -- the service is gone with the fixture path; the executor's
schedule compiler, shell renderer and effect grading are their own modules
([`hid-schedule.js`](../../packages/play/src/campaign/hid-schedule.js),
[`device-shell.js`](../../packages/play/src/campaign/device-shell.js),
[`control-effect.js`](../../packages/play/src/campaign/control-effect.js)), moved verbatim: the compiled
schedule, body and script of every committed winner night hash the same before and after (24
characterizations); the uncalled machine compatibility executor was removed. Open: the artifact
executor class (~1100 lines: adb lifecycle, gates, arm, origin) and `modern-campaign-ports.js`.
**Owner:** `packages/play`
**Evidence:** [`adb-device-local-executor.js`](../../packages/play/src/campaign/adb-device-local-executor.js), [`modern-campaign-ports.js` (line 172)](../../packages/play/src/campaign/modern-campaign-ports.js), `service.js` line 1 (removed 2026-09-25)

The local executor combines artifact compilation, shell rendering, ADB process
lifecycle, HID execution, observation, cleanup, and a machine compatibility
executor. Campaign ports combine evidence persistence, menu navigation,
pre-arm promises, lifecycle, and execution. (The fixture service that also
combined leases, profiles, sessions, safety, telemetry, persistence and dispatch
was retired on 2026-09-25.)

**Acceptance:** separate modules for use cases, ports, executors, evidence,
and legacy compatibility. No module should own policy decisions, physical
transport, and evidence persistence at the same time. Each new module gets one
entry point, one owner, and one focused test file.

### LEG-005 — Narrow the public API and isolate legacy paths (P1)

**Status:** RESOLVED BY REMOVAL (2026-09-25) -- the device barrel and the extra composition roots
it exported were deleted; `apps/desktop/src/device-cli.js` (`campaign`) is the one path onto a phone, and
`tools/architecture-test.js` refuses a second `live` command.
**Owner:** `apps/desktop`
**Evidence:** `index.js` line 1 (removed), [`COMPATIBILITY.md` (line 21)](COMPATIBILITY.md)

The device barrel exposes many composition roots, executors, compatibility
facades, and modern paths together. A caller can import an implementation
without an obvious signal that it is legacy or transitional.

**Acceptance:** add an explicit package `exports` map with one canonical live
entry point and named compatibility subpaths. Legacy modules are not exported
from the default surface. Update the compatibility catalog and add an import
test that rejects new code importing legacy paths.

### LEG-006 — Establish one source of truth for contracts and resolved profiles (P1)

**Status:** PARTIAL (2026-09-29) -- the kernel types are defined once, `packages/kernel/src/types.ts`
beside the validators that check them (`kernel.test.js`), and `packages/review` validates every lifted
`GameRun` and every promotion `Annotation` against them (M5b). The profile half is done (D5):
`RawDeviceProfile` is the stored `device-profile-v1`, `ResolvedDeviceProfile<G>` carries the game
dimension in `targetBuild`, and `resolveDeviceProfile` checks the control map and limits against that
game's control catalog; the game is derived, so no profile file changed and every bundle hashes as
before. `profile-game.test.js` and `control-catalog.test.js` print it in `npm run test:contracts`.
Open: one canonical schema source for the register's other contracts, deep experiment validation
(seeds, claim levels, nested samples), capability relationships, and the lax JS check.
**Owner:** `packages/kernel` (the contracts), `packages/source` (the catalog-generated validators), `packages/play`
**Evidence:** [`types.ts` (line 152)](../../packages/kernel/src/contracts/types.ts), [`index.js`](../../packages/kernel/src/contracts/index.js), `registry.js` line 69 (removed 2026-09-25)

Compile-time types, JavaScript validators, the contract register, and generated
catalogs do not fully describe the same shapes. `DeviceProfile` omits fields
added by profile resolution, while experiment validators accept only shallow
top-level structure. The JavaScript check is also configured with `strict:
false` and `noImplicitAny:
false`.

**Acceptance:** define `RawDeviceProfile` and `ResolvedDeviceProfile`; choose a
canonical schema source; generate or mechanically compare types, validators,
and catalogs; validate seed values, claim levels, nested samples, and profile
capability relationships. Remove broad `any` escapes from boundary objects.

### LEG-007 — Centralize the semantic control catalog (P1)

**Status:** PARTIAL (2026-09-29) -- D5 made the catalog per game: `control/catalog/` holds one
`control-catalog-v1` per game (FNaF 1-4, 26 descriptors), each control with its id, aliases, action
kinds, touch binding, preconditions and observed fact, `UNKNOWN(reason)` where unmeasured. Generated
from it: the vocabulary exports, `semantic-control-v1`'s per-game check (`validateControlCommand(c,
{ game })`; the game-less form is the union it always was), the profile control-map check, and
`docs/architecture/generated/control-catalog.json`. The FNaF 2 rules the artifact executor held
(`camdrop`, `observe-left`, the sweep and arm cameras, the first wind) are FNaF 2's artifact action
table in the cartridge; the executor reads the table for the profile's game. Open: adapter
capabilities are not generated from it (`control-exclusion.js`, `button-strokes.js` and
`calibration-state-rule.js` still name FNaF 2 controls), and `hid-schedule.js`'s macros are FNaF 2's,
guarded to that game rather than read from the table.
**Owner:** `packages/source` (the catalogs, since ADR 0002 migration D4)
**Evidence:** [`define.js` (line 135)](../../packages/source/src/clockwork/control-catalog.js), [`fnaf2.js` (line 40)](../../packages/source/src/games/fnaf2/controls.js), [`artifact-executor.js` (line 42)](../../packages/play/src/campaign/artifact-executor.js), `service.js` line 17 (removed 2026-09-25)

The canonical vocabulary coexists with legacy aliases and repeated camera
lists. `service.js`, the artifact executor, the adapter registry, and the
compile-time types do not expose one obviously authoritative control catalog.

**Acceptance:** create a descriptor for every semantic control containing its
canonical ID, aliases, allowed action kinds, adapter bindings, state
preconditions, and observation requirements. Generate validators, profile
checks, adapter capabilities, and documentation from that catalog.

### LEG-008 — Give `tools/device` a physical taxonomy (P1)

**Status:** OPEN
**Owner:** device tooling
**Evidence:** [`COMPATIBILITY.md` (line 19)](COMPATIBILITY.md)

The directory currently contains about 190 files with mixed roles: probes,
graders, emitters, runners, tests, transitional scripts, and historical
implementations. The lifecycle is documented, but the filesystem does not make
the canonical path apparent.

**Acceptance:** group tools by role and lifecycle, for example `observe`,
`calibrate`, `compile`, `grade`, `test`, and `legacy`; provide one README and
one canonical invocation per group; keep compatibility wrappers visibly thin.

### LEG-009 — Make research result timing and terminal semantics explicit (P2)

**Status:** OPEN
**Owner:** `packages/propose` (was `packages/research`)
**Evidence:** [`experiment.js` (line 160)](../../packages/propose/src/experiment/experiment.js), [`cli.js` (line 44)](../../packages/propose/src/experiment/cli.js)

`makeResultPayload()` promotes the terminal state of the first evaluation to
the whole experiment, and the CLI uses that value as the result event time.
Multi-seed or multi-candidate experiments do not necessarily have one terminal
frame.

**Acceptance:** keep terminal state per evaluation; expose an explicit aggregate
time or frame interval for the experiment; make the manifest event use that
aggregate field and add a multi-evaluation regression test.

### LEG-010 — Finish and verify the seed-cohort boundary (P1, current-tree item)

**Status:** OPEN — confirm after the current dirty research changes settle
**Owner:** `packages/propose` (was `packages/research`), device plan consumers
**Evidence:** current-tree path `packages/propose/src/experiment/seeds.js:64` (not yet
versioned in this audit commit), [`minus-3-plan.mjs` (line 211)](../../tools/device/minus-3-plan.mjs)

The current working tree fails JavaScript typecheck because the explicit
`seeds` option is not typed. The escape hatch also does not enforce the same
uint32/uniqueness rules as the canonical generator. Some consumers record the
golden salt even when an explicit seed array was supplied, which can misstate
provenance.

**Acceptance:** type the complete options object; validate explicit cohorts;
add focused seed tests; record derivation as `golden`, `explicit`, or
`explicit-range` instead of inferring it from a salt field.

### LEG-011 — Upgrade the architectural guard from regex heuristics (P2)

**Status:** RESOLVED (2026-09-29) -- every import check in
[`architecture-test.js`](../../tools/architecture-test.js) now reads the module's syntax tree
through the pinned `typescript` parser (no new dependency): static imports, aliased and namespace
re-exports, dynamic `import()` (a computed specifier is refused in a guarded package), `require()`
and TS import types, resolved to the workspace or directory they land in. The host-global,
search-knob and HID-transport scans read the tree too. Planted fixtures run first and must be
caught: a dynamic import, a template-literal import, a computed import, an aliased re-export, a
namespace re-export and import, `require` through `createRequire`, and a comment and a string
that only look like imports (which the regexes misread). The same change adds the rule that
`packages/review` never imports `apps/device`, `packages/adapters` or `packages/research`.
**Owner:** architecture tooling
**Evidence:** [`architecture-test.js`](../../tools/architecture-test.js) (`moduleReferences`, `RULES`, the planted fixtures)

The guard strips strings and finds imports with regular expressions. It is a
useful fast check, but it is not a complete parser and should not be the only
enforcement of package direction.

**Acceptance:** use an AST-based dependency rule or explicitly document the
guard as advisory and add a slower parser-backed lane for CI. Include dynamic
import and aliasing cases in the fixture suite.

### LEG-012 — Separate durable agent rules from dated operational history (P2)

**Status:** OPEN
**Owner:** project documentation
**Evidence:** [`AGENTS.md` (lines 94 and 121)](../../AGENTS.md)

The agent instruction file combines stable project invariants, commit policy,
device objectives, and a dated mistake register. This is useful operational
context but makes the canonical instruction surface harder to scan and easier
to misapply. The managed ai-memory block must remain intact.

**Acceptance:** keep stable rules and routing in `AGENTS.md`; move dated
lessons and detailed runbooks to linked documentation; add a short “when this
applies” label to each non-managed section.

## Existing validation snapshot

The following checks passed during the audit but do not close the findings:

- `node tools/architecture-test.js`
- `node tools/test-docs.mjs`
- `node tools/validate-references.js`
- `npm run test:affected`

`npm run typecheck` currently fails in `packages/propose/src/experiment/seeds.js`; that
failure belongs to the current working tree and should be rechecked after the
pending seed changes are finalized.
