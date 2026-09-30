# Contract specifications

Every boundary below is versioned plain data plus a runtime validator and a
conformance fixture. TypeScript interfaces in `src/contracts/types.ts` protect
the local compilation graph; JSON/JSONL grammar and golden vectors protect
shell, Python, Java, C, and retained artifacts.

| Contract | Owner | Unknown/failure rule |
|---|---|---|
| `semantic-control-v1` | core | physical encoding is rejected |
| `measurement-v1` | core | `UNKNOWN` requires a reason and has no value |
| `actuation-result-v1` | core/adapters | send and game acceptance remain separate |
| `capability-v1` | adapters | absent capability fails closed |
| `device-profile-v1` | device | unresolved calibration/map is refused |
| `venue-identity-v1` | core (read by adapters) | closed record; an unread field is `null` with its reason; a raw serial is refused, the handset is `handsetHash` |
| `venue-check-v1` | core | no binding is `UNBOUND` (recorded here; Play's live campaign refuses it); a moved drift field is `DRIFT` and refuses; an unread bound field is `UNKNOWN` and holds |
| `venue-binding-v1` | core | binds a measured identity to a profile or winner; one that names another subject is refused, not ignored |
| `qualification-v1` / `qualification-v2` | core | v1 is still read and binds no venue; v2 adds the `venue` it was measured on, and drift demotes it from `QUALIFIED` to `CANDIDATE` |
| `fact-message-v1` | core telemetry | malformed, oversized, or out-of-order frames are rejected |
| `experiment-spec-v2` / `experiment-result-v2` | propose (validators in the kernel) | fewer than two competing explanations, a prediction over a measure the separating observation does not name, a held-out block that overlaps the development block or shares its name, a seed set whose count or derivation disagree, a query not decided on the held-out block, and an optional-stopping rule are refused; a result must tag every explanation once, surviving exactly when its prediction held, and carry each rate as successes of n with an `Interval` and its method. v1 is still read |
| `bench-transport-trace-v1` | core telemetry | incomplete paths, mixed clocks, and unsafe continuation are rejected |
| `exercise-v1` / `commitment-v1` / `resolution-v1` | core training | questions freeze; commitments and independently evidenced outcomes remain separate |
| `exercise-cancellation-v1` / `exercise-event-v1` / `exercise-attempt-v1` | core training | interruption, deadline, ordering, and presentation data are explicit |
| `activity-gate-v1` / `activity-gate-profile-v1` / `activity-gate-decision-v1` | core training | unknown, stale, risky, short, or unqualified quiet windows refuse |
| `microtrainer-session-v1` | apps/trainer | replayable Plan 09-compatible prompt, response, outcome, latency, scheduler, and source-artifact record; censored exercises do not score |
| `adaptive-skill-model-v1` / `adaptive-selection-v1` | apps/trainer | per-player scores carry denominators, Wilson uncertainty, holdout separation, exposure caps, and selection probability; they cannot affect safety or belief |
| `exercise-renderer-v1` / `arcade-lab-progress-v1` / `rhythm-highway-chart-v1` / `threat-constellation-layout-v1` | apps/trainer | campaign, rhythm, and spatial renderers share frozen exercise semantics and accessibility capabilities; local progression, collision-safe charts, and profile-bound anchors treat censored/ambiguous outcomes as neutral |

The complete register, including process and retained-artifact contracts, is
[`register.json`](register.json). The existing Android, Python, Java, C, and
shell protocol implementations consume these stable IDs during migration;
cross-language changes require matching valid/invalid vectors. The generated
specification catalog is checked in at
[`docs/architecture/generated/contract-specifications.json`](../../../docs/architecture/generated/contract-specifications.json).
