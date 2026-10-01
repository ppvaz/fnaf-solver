/**
 * Compile-time shapes of the ADR 0002 kernel
 * (docs/decisions/0002-kernel-contexts-vocabulary.md), holding only the types
 * that have a consumer today. Runtime values and validators live beside these
 * types (index.ts). The kernel imports nothing, everything may import it, and
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
type NamedSourceLabel = 'SOURCED' | 'CALIBRATED' | 'MEASURED' | 'INFERRED' | 'MODEL';
export type SourceLabel = NamedSourceLabel | Unknown;

/** A death: who, by which mechanism, under which rule (`g###`), and when (Ms from the night's origin). */
export interface DeathCause {
  readonly by: string | Unknown;
  readonly how: string | Unknown;
  readonly rule: string | Unknown;
  readonly at: Interval | Unknown;
}

interface SixAM {
  readonly kind: 'SixAM';
  /** Deaths the run survived, for a non-lethal run. */
  readonly wouldDie?: readonly DeathCause[];
}
interface Death extends DeathCause {
  readonly kind: 'Death';
}
interface Timeout {
  readonly kind: 'Timeout';
  readonly wouldDie?: readonly DeathCause[];
}
interface Aborted {
  readonly kind: 'Aborted';
  readonly why: string;
}
interface Invalid {
  readonly kind: 'Invalid';
  readonly why: string;
}
/** How a night ended. A venue reports one; Review decides it (principle 3). */
export type Outcome = SixAM | Death | Timeout | Aborted | Invalid | Unknown;

type RunMode = 'dry' | 'shadow' | 'replay' | 'live';

/**
 * A seed's provenance: the game drew it, it was forced into a bracket, or it was recovered after
 * the fact. Adversarial is an RNG mode, not a seed. Not "origin", which is a night's time zero.
 */
export type SeedProvenance = 'natural' | 'pinned' | 'identified';
export type SeedBelief = 'known' | 'candidates' | 'unknown';
export interface Seed {
  readonly provenance: SeedProvenance;
  /** The window a pinned seed was forced into; only a pinned seed has one. */
  readonly bracket?: Interval;
  readonly belief: SeedBelief;
  /** The seed, when the belief is `known`. */
  readonly value?: number;
  /** The set, when the belief is `candidates`. */
  readonly candidates?: readonly number[];
}

/** How a run's record reached the repository, and what did not. */
type CustodyClass = 'complete' | 'recovered';
interface Custody {
  readonly class: CustodyClass | Unknown;
  readonly lost: readonly string[];
}

/** A record of the run named by content hash: a retained text file, a recording, a frame. */
interface Witness {
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

/** venue-binding-v1: a measured identity bound to a profile or a winner, kept apart from both so neither's hash moves. */
export interface VenueBinding {
  readonly schema: 'venue-binding-v1';
  readonly subject: { readonly kind: 'profile' | 'winner'; readonly id: string };
  readonly identity: VenueIdentity;
  readonly boundBy: string;
  /** `YYYY-MM-DD`. */
  readonly boundAt: string;
  readonly evidenceId: string;
}

/** What binds a run to a venue: a profile's or a winner's venue-binding-v1, or a qualification-v2's own venue. */
export type VenueBindingSource = 'profile' | 'winner' | 'qualification';

/** One identity a run is bound to, and what bound it. */
export interface VenueBound {
  readonly source: VenueBindingSource;
  readonly id: string;
  readonly identity: VenueIdentity;
}

/** A bound field the observed venue reads differently. */
export interface VenueFieldMove {
  readonly field: VenueField;
  readonly from: string;
  readonly to: string;
  readonly source: VenueBindingSource;
  readonly id: string;
}

/** A bound drift field the observed venue could not read, so it cannot be cleared. */
export interface VenueFieldUnread {
  readonly field: VenueField;
  readonly reason: string;
  readonly source: VenueBindingSource;
  readonly id: string;
}

export type VenueCheckStatus = 'UNBOUND' | 'MATCH' | 'DRIFT' | 'UNKNOWN';

/** venue-check-v1: an observed identity compared with every identity the run is bound to. */
export interface VenueCheck {
  readonly schema: 'venue-check-v1';
  readonly status: VenueCheckStatus;
  /** True exactly when the status is DRIFT. */
  readonly refuses: boolean;
  readonly observed: VenueIdentity | null;
  readonly bindings: readonly { readonly source: VenueBindingSource; readonly id: string }[];
  readonly drift: readonly VenueFieldMove[];
  readonly unknown: readonly VenueFieldUnread[];
  /** Note fields that moved: reported, never refused. */
  readonly notes: readonly VenueFieldMove[];
  readonly message: string;
  readonly remedy: string | null;
}

/**
 * A retained qualification verdict, bound to a winner and an engine by their hashes. `qualification-v2` is v1
 * plus the venue it was measured on (`bindQualificationVenue`).
 */
export interface Qualification {
  readonly schema: 'qualification-v1' | 'qualification-v2';
  readonly policyHash: string;
  readonly modelHash: string;
  readonly sampleCount: number;
  readonly verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  readonly evidenceId: string;
  /** Only a DEVICE_MEASURED PASS is QUALIFIED; anything else stands as a CANDIDATE. */
  readonly claimLevel?: ClaimLevel;
  /** A v2's venue, every drift field read. */
  readonly venue?: VenueIdentity;
}

/** A device campaign's state machine (`CAMPAIGN_STATES`). */
export type CampaignState =
  | 'IDLE' | 'PREFLIGHT' | 'MENU' | 'INTRO_VERIFY' | 'ACTIVE' | 'CUSTOM_VERIFY' | 'TERMINAL_VERIFY' | 'RETRY_VERIFY'
  | 'SAVE_VERIFY' | 'HOLD' | 'ABORTED' | 'COMPLETE';

/** campaign-event-v1: one transition or attempt, at the campaign clock's Ms. */
interface CampaignEvent {
  readonly schema: 'campaign-event-v1';
  readonly type: string;
  readonly state: CampaignState;
  readonly at: number;
  readonly data: Readonly<Record<string, unknown>>;
}

/** What the title or the next night showed after a win: the save's advancement (campaign-proof-v1). */
export interface SaveObservation {
  readonly cursorNight?: number;
  readonly customNightVisible?: boolean;
  readonly continueVisible?: boolean;
  readonly sixthNightVisible?: boolean;
  readonly menuReturned?: boolean;
  readonly customCompleted?: boolean;
  readonly nextNightStarted?: boolean;
  readonly observed?: boolean;
}

/**
 * One attempt at one night. The campaign fills it in as the night is played, so every field past its
 * start is absent until that step, and a record retained before a field existed lacks it.
 */
interface CampaignAttempt {
  night: number;
  mode: string;
  attempt: number;
  status: string;
  terminal?: { night?: number; outcome?: string; sixAm: boolean; why?: string };
  terminalVerification?: { sixAm: boolean; positive: boolean };
  save?: SaveObservation;
  customReadback?: Readonly<Record<string, unknown>>;
  proofHash?: string;
  proof?: boolean;
}

/** device-campaign-result-v1: what a campaign retains and the evidence index reads back. */
export interface CampaignResult {
  readonly schema: 'device-campaign-result-v1';
  readonly version: 1;
  readonly specHash: string;
  readonly state: CampaignState;
  readonly targetIndex?: number;
  readonly completedNights: readonly number[];
  readonly attempts: readonly CampaignAttempt[];
  readonly events: readonly CampaignEvent[];
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
type AnnotationSubject =
  | { readonly kind: 'GameRun'; readonly id: string }
  | { readonly kind: 'GameRuns'; readonly ids: readonly string[] }
  | { readonly kind: 'Census'; readonly id: string }
  | { readonly kind: 'Rule'; readonly id: string }
  | { readonly kind: 'Policy'; readonly id: string }
  | { readonly kind: 'Calibration'; readonly id: string }
  | { readonly kind: 'ChronicleEntry'; readonly id: string };

type AnnotationStatus = 'standing' | 'superseded' | 'retracted';

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
type EnvelopeStatus = 'standing' | 'superseded' | 'retracted';

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
