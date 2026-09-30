/**
 * Compile-time shapes of the ADR 0002 kernel
 * (docs/decisions/0002-kernel-contexts-vocabulary.md), holding only the types
 * that have a consumer today. Runtime values and validators live beside these
 * types (index.js). The kernel imports nothing, everything may import it, and
 * it changes only by a later ADR.
 */

/** UNKNOWN is a value with a reason, never a default (ADR 0002 principle 2). */
export interface Unknown {
  readonly kind: 'UNKNOWN';
  readonly reason: string;
}

/** A value known only to lie between `lo` and `hi`, both included, in the unit its field names. */
export interface Interval {
  readonly lo: number;
  readonly hi: number;
}

/** How far a claim has been carried. A closed enum; the levels never promote one another. */
export type ClaimLevel = 'MODEL_ONLY' | 'FIXTURE' | 'DEVICE_MEASURED';

/** Where a number came from. A closed enum; UNKNOWN carries its reason. */
export type NamedSourceLabel = 'SOURCED' | 'CALIBRATED' | 'MEASURED' | 'INFERRED' | 'MODEL';
export type SourceLabel = NamedSourceLabel | Unknown;

/** A death: who, by which mechanism, under which rule (`g###`), and when (Ms from the night's origin). */
export interface DeathCause {
  readonly by: string | Unknown;
  readonly how: string | Unknown;
  readonly rule: string | Unknown;
  readonly at: Interval | Unknown;
}

export interface SixAM {
  readonly kind: 'SixAM';
  /** Deaths the run survived, for a non-lethal run. */
  readonly wouldDie?: readonly DeathCause[];
}
export interface Death extends DeathCause {
  readonly kind: 'Death';
}
export interface Timeout {
  readonly kind: 'Timeout';
  readonly wouldDie?: readonly DeathCause[];
}
export interface Aborted {
  readonly kind: 'Aborted';
  readonly why: string;
}
export interface Invalid {
  readonly kind: 'Invalid';
  readonly why: string;
}
/** How a night ended. A venue reports one; Review decides it (principle 3). */
export type Outcome = SixAM | Death | Timeout | Aborted | Invalid | Unknown;

export type RunMode = 'dry' | 'shadow' | 'replay' | 'live';

/** How a run's record reached the repository, and what did not. */
export type CustodyClass = 'complete' | 'recovered';
export interface Custody {
  readonly class: CustodyClass | Unknown;
  readonly lost: readonly string[];
}

/** A record of the run named by content hash: a retained text file, a recording, a frame. */
export interface Witness {
  readonly name: string;
  readonly sha256: string;
  readonly kind: string;
}

/** A VenueIdentity field whose move refuses a bound run and demotes a qualification (principle 12). */
export type VenueDriftField =
  | 'package' | 'versionName' | 'versionCode' | 'firstInstallTime' | 'lastUpdateTime'
  | 'buildFingerprint' | 'securityPatch' | 'handsetHash';
/** Recorded and compared, reported when it moves, never refused. */
export type VenueNoteField = 'companionVersion' | 'timeZone';
export type VenueField = VenueDriftField | VenueNoteField;

/**
 * VenueIdentity: the world under a phone venue, measured at preflight and
 * stored as `venue-identity-v1` (`validateVenueIdentity`,
 * `./contracts/venue-identity.js`). Each field is read off the phone, or null
 * with its reason in `unknown` (principle 2). The handset is `handsetHash`,
 * `sha256-` and the first 16 hex of sha256 over the serial; a record that
 * carries the serial is refused (decision 8). v1 does not yet carry the
 * ADR's runtime, placement and instrumentation as fields; adding them is a
 * new version that readers lift v1 into.
 */
export interface VenueIdentity {
  readonly schema: 'venue-identity-v1';
  /** The Android package that was queried: always named. */
  readonly package: string;
  readonly versionName: string | null;
  readonly versionCode: string | null;
  /** dumpsys's local wall-clock `yyyy-MM-dd HH:mm:ss`, read in `timeZone`. */
  readonly firstInstallTime: string | null;
  readonly lastUpdateTime: string | null;
  readonly buildFingerprint: string | null;
  /** `ro.build.version.security_patch`, `yyyy-MM-dd`. */
  readonly securityPatch: string | null;
  readonly handsetHash: string | null;
  readonly companionVersion: string | null;
  readonly timeZone: string | null;
  /** The reason for each field that is null; absent when every field was read. */
  readonly unknown?: Readonly<Partial<Record<VenueField, string>>>;
}

/**
 * One night played once. `spec` and `clocks` carry the source record's own
 * fields until RunSpec and ClockTrace enter the kernel; `venue` carries the
 * preflight's venue-check-v1, whose `observed` is a VenueIdentity.
 */
export interface GameRun {
  readonly id: string;
  readonly spec: Readonly<Record<string, unknown>> | Unknown;
  readonly venue: Readonly<Record<string, unknown>> | Unknown;
  readonly runMode: RunMode | Unknown;
  readonly clocks: readonly Readonly<Record<string, unknown>>[] | Unknown;
  readonly before: readonly unknown[] | Unknown;
  readonly night: readonly unknown[] | Unknown;
  readonly after: readonly unknown[] | Unknown;
  readonly reportedOutcome: Outcome;
  readonly witnesses: readonly Witness[];
  readonly custody: Custody;
}

/** What an annotation is about: a run, a set of runs, a census, a rule `g###`, a policy, a calibration or a chronicle entry. */
export type AnnotationSubject =
  | { readonly kind: 'GameRun'; readonly id: string }
  | { readonly kind: 'GameRuns'; readonly ids: readonly string[] }
  | { readonly kind: 'Census'; readonly id: string }
  | { readonly kind: 'Rule'; readonly id: string }
  | { readonly kind: 'Policy'; readonly id: string }
  | { readonly kind: 'Calibration'; readonly id: string }
  | { readonly kind: 'ChronicleEntry'; readonly id: string };

export type AnnotationStatus = 'standing' | 'superseded' | 'retracted';

interface AnnotationBase {
  readonly subject: AnnotationSubject;
  /** `name@version` of the instrument that wrote it. */
  readonly instrument: string;
  readonly value: unknown;
  /** Content hashes of everything it read. */
  readonly inputs: readonly string[];
  readonly by: string;
  readonly status: AnnotationStatus;
  /** When superseded: the annotation that replaces it. */
  readonly supersededBy?: string;
}
/** A class, a measure or a tag an instrument wrote about a subject: exactly one of the three. */
export type Annotation =
  | (AnnotationBase & { readonly class: string })
  | (AnnotationBase & { readonly measure: string })
  | (AnnotationBase & { readonly tag: string });

/**
 * An envelope's label: one of the two closed enums, or UNKNOWN(reason). The enums stay distinct;
 * a label is never read as the other enum's value.
 */
export type EnvelopeLabel = ClaimLevel | SourceLabel;
export type EnvelopeStatus = 'standing' | 'superseded' | 'retracted';

/**
 * claim-envelope-v1 (Plan 28; v1 under ADR 0002): an answer with what it is worth, what it is
 * about, where it was read, whether it stands, what it does not measure, and how to reproduce it.
 */
export interface ClaimEnvelope {
  readonly schema: 'claim-envelope-v1';
  readonly claim: unknown;
  readonly label: EnvelopeLabel;
  /** A game's Android package (optionally `@version`), `repository`, or UNKNOWN(reason). */
  readonly target: string | Unknown;
  readonly cite: readonly string[];
  readonly status: EnvelopeStatus;
  readonly supersededBy: string | null;
  readonly notMeasured: readonly string[];
  readonly reproducer: string;
}

/** A known-bad move refused: the rule, because what, where the rule is written, and the remedy. */
export interface RefusalEnvelope {
  readonly schema: 'claim-envelope-v1';
  readonly refused: true;
  readonly rule: string;
  readonly because: string;
  readonly cite: readonly string[];
  readonly remedy: string;
}
