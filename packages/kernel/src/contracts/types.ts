/**
 * Compile-time shapes for the versioned core contracts.
 * Runtime validation lives beside these types in contracts/index.js.
 */
export type ClockName =
  | 'game-frame'
  | 'simulator-frame'
  | 'device-monotonic-ms'
  | 'host-monotonic-ms'
  | 'audio-sample';

export interface ClockRef {
  readonly clock: ClockName;
  readonly value: number;
}

/** The Android package of each registered game (@sixam/source clockwork/control-registry.js). */
export type GamePackage =
  | 'com.scottgames.fivenightsatfreddys'
  | 'com.scottgames.fnaf2'
  | 'com.scottgames.fnaf3'
  | 'com.scottgames.fnaf4';

/** A fact nobody measured: a value with its reason, never a default (ADR 0002). */
export type Unknown = `UNKNOWN(${string})`;

/** Each game's canonical control ids, as its catalog declares them. Serialized; frozen. */
export interface GameControlIds {
  readonly 'com.scottgames.fivenightsatfreddys':
    'monitor' | 'leftDoor' | 'rightDoor' | 'leftDoorLight' | 'rightDoorLight';
  readonly 'com.scottgames.fnaf2':
    'monitor' | 'mask' | 'cameraFeedLight' | 'hallLight' | 'leftVentLight' | 'rightVentLight' | 'wind';
  readonly 'com.scottgames.fnaf3':
    | 'monitor' | 'audioLure' | 'ventMapToggle' | 'sealVent'
    | 'rebootAudio' | 'rebootCamera' | 'rebootVentilation' | 'rebootAll';
  readonly 'com.scottgames.fnaf4':
    'runLeftDoor' | 'runRightDoor' | 'runCloset' | 'goBack' | 'flashlight' | 'closeDoor';
}

export type GameControl<G extends GamePackage = GamePackage> = GameControlIds[G];
export type CameraControl = `cam:${number}`;
/** FNaF 2's simulator names, which `semantic-control-v1` keeps accepting. */
export type Fnaf2ModelControl = 'light' | 'hall' | 'ventL' | 'ventR';

/** Games whose catalog states a camera range (FNaF 1's ids are UNKNOWN; FNaF 4 has none). */
export type GameWithCameraRange = 'com.scottgames.fnaf2' | 'com.scottgames.fnaf3';

/**
 * A control `semantic-control-v1` accepts for game `G`. Without `G` it is the
 * union over every registered game, which is what `validateControlCommand`
 * checks when it is not given a game.
 */
export type SemanticControl<G extends GamePackage = GamePackage> =
  | GameControl<G>
  | (G extends 'com.scottgames.fnaf2' ? Fnaf2ModelControl : never)
  | (G extends GameWithCameraRange ? CameraControl : never);

/** How one activation of a control reaches the game (`control-anchor.js` anchors). */
export interface ControlBinding {
  readonly adapter: 'touch';
  readonly contact: 'tap' | 'hold' | 'double' | Unknown;
  readonly anchor: 'screen' | 'world' | Unknown;
}

/** The state a control needs before it is pressed. */
export interface ControlPreconditions {
  readonly monitor?: 'up' | 'down';
  readonly mask?: 'off';
  readonly viewing?: CameraControl;
}

export type ArtifactActionKind =
  | 'ensure' | 'tap' | 'press' | 'hold' | 'compound' | 'sweep-slot' | 'observe-left';

/** One semantic control, as a game's catalog describes it (LEG-007). */
export interface ControlDescriptor<G extends GamePackage = GamePackage> {
  readonly id: GameControl<G>;
  /** Input names translated to this id when reading old plans or device maps. */
  readonly aliases: readonly string[];
  /** The simulator action the control drives, where a simulator names one. */
  readonly model?: string | null;
  readonly binding: ControlBinding;
  readonly requires: ControlPreconditions | Unknown;
  /** The fact that confirms the control's effect, e.g. `monitorUp`. */
  readonly observes: string;
  /** Generated from the artifact action table. */
  readonly actions: readonly ArtifactActionKind[] | Unknown;
}

/** The action rules `device-executor-v1` enforces for one game. */
export interface ArtifactActionTable<G extends GamePackage = GamePackage> {
  readonly schema: 'artifact-action-table-v1';
  readonly game: G;
  readonly controls: readonly string[];
  readonly kinds: Readonly<Partial<Record<ArtifactActionKind, { readonly controls: readonly string[] }>>>;
  /** Each compound's pinned fields, e.g. `{ control: 'cameraFeedLight' }`. */
  readonly compounds: Readonly<Record<string, Readonly<Record<string, string>>>>;
  readonly armVerification: { readonly cameras: readonly [number, number]; readonly firstAction: string } | null;
}

export interface ControlCatalog<G extends GamePackage = GamePackage> {
  readonly schema: 'control-catalog-v1';
  readonly game: G;
  readonly title: string;
  readonly controls: readonly ControlDescriptor<G>[];
  readonly cameras: {
    /** `[lo, hi]`, `null` (the game has none) or UNKNOWN (they exist, ids unmapped). */
    readonly range: readonly [number, number] | null | Unknown;
    readonly binding?: ControlBinding;
    readonly requires?: ControlPreconditions | Unknown;
    readonly observes?: string;
  };
  readonly modelControls: readonly string[];
  /** Profile points that are not controls (FNaF 2's phone-call `mute`). */
  readonly auxiliaryPoints: readonly string[];
  readonly artifactActions: ArtifactActionTable<G> | null;
  readonly sources: readonly string[];
}

export type ControlKind = 'press' | 'release' | 'hold' | 'select';

export interface ControlCommand {
  readonly schema: 'control-command-v1';
  readonly id: string;
  readonly action: { readonly kind: ControlKind; readonly control: SemanticControl };
  readonly requestedAt: ClockRef;
  readonly deadline?: ClockRef;
  readonly source: { readonly controller: string; readonly policyHash?: string };
}

/** One `controlMap` entry: a screen point, optionally anchored (control-anchor.js). */
export interface ProfilePoint {
  readonly x: number;
  readonly y: number;
  readonly anchor?: 'screen' | 'world';
  readonly measuredAtPan?: number;
}

export interface DeviceProfileLimits {
  readonly maxActions?: number;
  readonly maxDurationMs?: number;
  readonly dryRunOnly?: boolean;
  readonly qualification?: string;
}

/**
 * A `device-profile-v1` as stored under packages/play/profiles/fnaf2/moto-g56. Its bytes are
 * hashed into every bundle and qualification bound to it, so it never gains a
 * field to carry what can be derived: the game is the package half of
 * `targetBuild`.
 */
export interface RawDeviceProfile {
  readonly schema: 'device-profile-v1';
  readonly id: string;
  readonly name?: string;
  readonly lifecycle?: string;
  readonly targetBuild: string;
  readonly actuator: string;
  readonly visualSensor: string;
  readonly visualDetector: string;
  readonly geometry?: string;
  readonly clock: ClockName;
  readonly calibrations: Record<string, string>;
  readonly controlMap?: Readonly<Record<string, ProfilePoint>>;
  readonly limits?: DeviceProfileLimits;
  /** The `view-scroll-v1` block, where a profile records its office layers. */
  readonly viewScroll?: Readonly<Record<string, unknown>>;
}

/**
 * What `resolveDeviceProfile` returns: the same stored object, checked against
 * its game's control catalog. The game dimension is `G`, carried by
 * `targetBuild` (`com.scottgames.fnaf2:2.0.7+26`) and read with
 * `deviceProfileGame`; the control map may name only that game's controls
 * (`GameControl<G>`), its stated cameras (`cam:N`) and its auxiliary points,
 * which the resolver checks at runtime because the auxiliary points are data.
 */
export interface ResolvedDeviceProfile<G extends GamePackage = GamePackage> extends RawDeviceProfile {
  readonly targetBuild: `${G}:${string}`;
}

/** `deviceProfileGame(profile)`: the profile's game dimension. */
export interface DeviceProfileGame<G extends GamePackage = GamePackage> {
  readonly game: G;
  readonly version: string;
  readonly title: string;
}

/** The pre-D5 name for a stored profile. */
export type DeviceProfile = RawDeviceProfile;

export type BenchTracePath = 'visual' | 'audio';

export interface BenchTraceStage {
  readonly atMs: number;
  readonly [key: string]: unknown;
}

export interface BenchTraceSample {
  readonly id: string;
  readonly path: BenchTracePath;
  readonly sourceEvent: BenchTraceStage;
  readonly fact: BenchTraceStage;
  readonly executorReceipt: BenchTraceStage;
  readonly actuatorCommand: BenchTraceStage;
  readonly observedResult: BenchTraceStage;
}

export interface BenchTransportTrace {
  readonly schema: 'bench-transport-trace-v1';
  readonly id: string;
  readonly profile: string;
  readonly clock: 'device-monotonic-ms' | 'host-monotonic-ms';
  readonly claimLevel: 'MODEL_ONLY' | 'FIXTURE' | 'DEVICE_MEASURED';
  readonly samples: readonly BenchTraceSample[];
  readonly continuation: Record<string, unknown>;
}

export type ExerciseKind = 'prediction' | 'recognition' | 'timing' | 'strategy';
export type ExerciseDisposition = 'COMPLETED' | 'CANCELLED' | 'EXPIRED' | 'UNRESOLVED';

export interface Exercise {
  readonly schema: 'exercise-v1';
  readonly id: string;
  readonly kind: ExerciseKind;
  readonly sourceSessionId: string;
  readonly beliefSequence: number;
  readonly clock: 'host-monotonic-ms' | 'device-monotonic-ms';
  readonly createdAtMs: number;
  readonly promptAtMs: number;
  readonly commitDeadlineMs: number;
  readonly revealDeadlineMs: number;
  readonly eligibility: Record<string, unknown>;
  readonly question: { readonly target: string; readonly choices: readonly string[]; readonly horizonMs: number };
  readonly commitment: Record<string, unknown> | null;
  readonly resolution: Record<string, unknown> | 'CENSORED';
  readonly cancellation: Record<string, unknown> | null;
  readonly disposition: ExerciseDisposition;
}

export interface ExerciseAttempt {
  readonly schema: 'exercise-attempt-v1';
  readonly exerciseId: string;
  readonly rendererId: string;
  readonly rendererVersion: string;
  readonly sessionId: string;
  readonly clock: 'host-monotonic-ms' | 'device-monotonic-ms';
  readonly shownAtMs: number;
  readonly commitment: Record<string, unknown> | null;
  readonly resolutionDisposition: ExerciseDisposition;
  readonly motor: Record<string, unknown> | null;
  readonly score: Record<string, number> | null;
}

export interface ActivityGateProfile {
  readonly schema: 'activity-gate-profile-v1';
  readonly id: string;
  readonly version: string;
  readonly profileLimit: number;
  readonly timing: {
    readonly promptMs: number;
    readonly revealMs: number;
    readonly cancelP99Ms: number;
    readonly humanRecoveryBudgetMs: number;
  };
  readonly requiredCapabilities: readonly ('overlay' | 'capture' | 'response')[];
}

/** How a seed set was derived (experiment-spec-v2). */
export type SeedDerivation =
  | { readonly kind: 'golden'; readonly count: number; readonly salt: number; readonly modulus?: number }
  | { readonly kind: 'explicit'; readonly seeds: readonly number[] }
  | { readonly kind: 'explicit-range'; readonly from: number; readonly to: number };

/** A named seed set, its derivation, and the provenance its seeds stand for (the kernel Seed). */
export interface SeedSet {
  readonly name: string;
  readonly derivation: SeedDerivation;
  readonly provenance: 'natural' | 'pinned' | 'identified';
  readonly bracket?: { readonly lo: number; readonly hi: number };
  readonly count: number;
  /** sha256 of JSON.stringify of the expanded seed list. */
  readonly sha256?: string;
  readonly definition?: string;
}

/** A predicate over the separating observation's named measures. */
export type ExperimentPredicate =
  | { readonly measure: string; readonly op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'; readonly value: number }
  | { readonly all: readonly ExperimentPredicate[] }
  | { readonly any: readonly ExperimentPredicate[] }
  | { readonly not: ExperimentPredicate };

export interface ExperimentExplanation {
  readonly id: string;
  readonly statement: string;
  readonly assumptions: readonly string[];
  readonly predicts: { readonly observation: string; readonly when: ExperimentPredicate };
}

/** experiment-spec-v2: competing explanations, the observation that separates them, and a cohort with a held-out block. */
export interface ExperimentSpecV2 {
  readonly schema: 'experiment-spec-v2';
  readonly id: string;
  readonly purpose: 'census' | 'diagnostic';
  readonly question: string;
  readonly claimLevel: 'MODEL_ONLY' | 'FIXTURE' | 'DEVICE_MEASURED';
  readonly family?: { readonly id: string; readonly description: string; readonly grid: Readonly<Record<string, unknown>> };
  readonly explanations: readonly ExperimentExplanation[];
  readonly separatingObservation: { readonly description: string; readonly measures: readonly string[] };
  readonly cohort: {
    readonly population: { readonly description: string; readonly size: number };
    readonly development: SeedSet;
    readonly heldOut: SeedSet;
  };
  readonly decidingQuery: { readonly text: string; readonly block: 'heldOut' };
  readonly stoppingRule: { readonly kind: 'fixed-sample'; readonly text: string };
  readonly [extra: string]: unknown;
}

/** A rate, with its interval and the method that produced it. */
export interface ExperimentRate {
  readonly name: string;
  readonly successes: number;
  readonly n: number;
  readonly rate: number;
  readonly interval: { readonly lo: number; readonly hi: number };
  readonly method: 'wilson' | 'wilson-bonferroni' | 'exhaustive';
  readonly confidence: number;
  readonly comparisons?: number;
}

/** experiment-result-v2: every explanation tagged ruled-out or surviving, with its evidence. */
export interface ExperimentResultV2 {
  readonly schema: 'experiment-result-v2';
  readonly specId: string;
  readonly specSha256: string;
  readonly claimLevel: 'MODEL_ONLY' | 'FIXTURE' | 'DEVICE_MEASURED';
  readonly observations: { readonly block: 'heldOut'; readonly values: Readonly<Record<string, number>> };
  readonly explanations: readonly {
    readonly id: string;
    readonly status: 'ruled-out' | 'surviving';
    readonly evidence: { readonly holds: boolean; readonly values: Readonly<Record<string, number>>; readonly [extra: string]: unknown };
  }[];
  readonly rates: readonly ExperimentRate[];
  readonly stopped: { readonly rule: string; readonly reached: string };
  readonly [extra: string]: unknown;
}
