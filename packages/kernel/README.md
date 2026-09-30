# `@sixam/kernel`

The shared kernel of [ADR 0002](../../docs/decisions/0002-kernel-contexts-vocabulary.md),
holding only the types that have a consumer today. Every context shares them,
and they change only by a later ADR.

| Type | What it is | Consumer today |
|---|---|---|
| `Unknown` | `UNKNOWN(reason)`: a value with a reason, never a default (principle 2) | every other type; the pack lift |
| `Interval` | `{lo, hi}`, a value known only to lie between two bounds | `Outcome`'s `Death.at` (Ms from the night's origin) |
| `ClaimLevel` | `MODEL_ONLY \| FIXTURE \| DEVICE_MEASURED`, closed | the promotions query (promoted claims, MODEL_ONLY winners) |
| `SourceLabel` | `SOURCED \| CALIBRATED \| MEASURED \| INFERRED \| MODEL \| UNKNOWN(reason)`, closed | the `UNKNOWN(reason)` value the lift writes |
| `Outcome` | `SixAM \| Death{by, how, rule, at} \| Timeout \| Aborted(why) \| Invalid(why) \| UNKNOWN`, plus `wouldDie[]` | `GameRun.reportedOutcome` |
| `GameRun` | one night played once: spec, venue, runMode, clocks, before/night/after events, reported outcome, witnesses, custody `{class: complete \| recovered, lost[]}` | `packages/review` lifts every committed run pack into one |
| `Annotation` | `{subject, instrument@version, class \| measure \| tag, value, inputs, by, status: standing \| superseded \| retracted}`, with a wide subject | the promotions query writes one per `PROMOTED_BY` edge |
| `ClaimEnvelope` (`claim-envelope-v1`) | an answer: `{claim, label, target, cite[], status, supersededBy, notMeasured[], reproducer}`, or a refusal `{refused: true, rule, because, cite[], remedy}`. `label` is a `ClaimLevel`, a named `SourceLabel` or `UNKNOWN(reason)`, never missing or bare; a claim holding any UNKNOWN value must name what it does not measure. v1 under ADR 0002 ("the claim envelope until Plan 28 lands"), registered in `packages/core/contracts/register.json` | the fnaf-solver MCP verbs and resources, `npm run review`, and `npm run evidence -- show\|promotions --envelope` |

The two label enums never promote one another. `GameRun.spec`, `venue` and
`clocks` carry the source record's own fields, or `UNKNOWN(reason)`, until
RunSpec, VenueIdentity and ClockTrace enter the kernel.

Compile-time shapes are in `src/types.ts` (the strict `typecheck:ts` lane);
the frozen enums, constructors (`unknown`, `interval`, `sixAm`, `death`,
`timeout`, `aborted`, `invalid`) and validators (`validateClaimLevel`,
`validateSourceLabel`, `validateInterval`, `validateOutcome`,
`validateGameRun`, `validateAnnotation`), and the claim envelope's constructors and validator
(`claimEnvelope`, `refusalEnvelope`, `validateClaimEnvelope`, `unknownsIn`, `src/claim-envelope.js`) are
in `src/index.js`.

## Contracts and Time (from `@sixam/core`, ADR 0002 migration D1)

| Path | What it is |
|---|---|
| `src/contracts/` (`@sixam/kernel/contracts`) | the runtime validators of the versioned plain-data contracts every context shares: clock refs, profiles, qualification v1/v2, venue identity, check and binding, the campaign result and save proof, telemetry, session manifest, artifact refs, `canonicalJson` and `stableHash`; compile-time shapes in `src/contracts/types.ts` |
| `contracts/register.json` | the contract register: every contract id, its owner, kind and validator ([`contracts/README.md`](contracts/README.md)) |
| `src/time/` (`@sixam/kernel/time`) | `Interval`, the declared clock of every campaign timestamp (`event-clocks.js`), the bounded fact link (`fact-link.js`, `fact-message-v1`) and the clock port (`ports.js`) |

The validators generated from the per-game control catalogs
(`validateControlCommand`, `deviceProfileGame`, `resolveDeviceProfile`) stay
beside the catalogs, outside the kernel, because the kernel imports nothing.
`@sixam/core/contracts`, `/telemetry` and `/timing` re-export all of this as
compatibility shims until their removal gates
([`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json)).

Public API: the package root, `./contracts` and `./time`. Dependencies: none,
and it imports nothing in the repository -- no workspace, no relative path out
of itself, no Node built-in; every package may import it
(`tools/architecture-test.js`). Tests: `test/kernel.test.js` in `test:unit`;
`test/claim-envelope.test.js`, the claim envelope's contract test, and
`test/venue-identity.test.js` in `test:contracts`.
