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

The two label enums never promote one another. `GameRun.spec`, `venue` and
`clocks` carry the source record's own fields, or `UNKNOWN(reason)`, until
RunSpec, VenueIdentity and ClockTrace enter the kernel.

Compile-time shapes are in `src/types.ts` (the strict `typecheck:ts` lane);
the frozen enums, constructors (`unknown`, `interval`, `sixAm`, `death`,
`timeout`, `aborted`, `invalid`) and validators (`validateClaimLevel`,
`validateSourceLabel`, `validateInterval`, `validateOutcome`,
`validateGameRun`, `validateAnnotation`) are in `src/index.js`.

Public API: the package root. Dependencies: none, and it imports nothing in the
repository -- no workspace, no relative path out of itself, no Node built-in;
every package may import it (`tools/architecture-test.js`). Test:
`test/kernel.test.js`, in `test:unit`.
