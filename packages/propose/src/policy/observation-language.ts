// The observation-conditioned branch language (Plan 05 package 6b, the half
// Plan 21 package 7's invention campaign needs before it can run).
//
// Plan 21's policy-v1 grammar can only express an unconditional schedule:
// idle/setup/repeat/finish/observe, with `observations` that are recorded and
// never read. Plans 05, 06 and 16 closed the unconditional space by recorded
// negative. What is left is programs that BRANCH on something the controller
// can actually see, so this module defines what "can actually see" means as
// data, not as prose.
//
// Two rules the rest of this file exists to enforce:
//
//  1. A fact may appear in a branch only if the cost of reading it is
//     MEASURED. An unmeasured read cost is `UNKNOWN` and the fact is excluded
//     -- never given a plausible number (PROJECT-CHARTER.md).
//  2. A branch may only demand a decision the measured budget can supply. A
//     branch whose first action starts sooner after its observation than one
//     measured read takes is refused, not rounded down.
//
// This module is a definition and a validator. It claims nothing about whether
// any branch survives a model gate, and nothing about device readiness: every
// fact below is `classifier: 'UNCALIBRATED'` today, so `deviceAdmissibleFacts()`
// is empty and stays empty until Plan 15 lands a calibrated pairing.
import * as C from '@sixam/source/games/fnaf2/config.ts';
import { FACTS, OBSERVE_INTERVAL } from '@sixam/play/sim';
import { isList, isOneOf, isRecord } from '@sixam/kernel';

export const OBSERVATION_LANGUAGE_SCHEMA = 'observation-language-v1';
export const BRANCH_SCHEMA = 'observation-branch-v1';

/** The one value a missing or ambiguous measurement is allowed to take. */
export const UNKNOWN = 'UNKNOWN';

// --- The measured observation budget -------------------------------------
//
// `docs/device/ON-DEVICE-VALIDATION.md` §"The projection path measures 59 ms",
// reproduced by `packages/play/bin/companion/query-companion.sh latency`: 60 samples timed
// inside one device shell against the device's own clock, p50 48.8 ms,
// p95 59.5 ms, p99 60.8 ms, max 66.9 ms. That is a DEVICE_MEASURED read of the
// the Companion's already-classified watchlist, and it is the same cost for every
// fact the watchlist serves -- one read returns the whole visual snapshot
// (`Observer._sample`).
export const VISUAL_READ_COST_MS = 59.5;
export const VISUAL_READ_COST_SOURCE =
  'docs/device/ON-DEVICE-VALIDATION.md "The projection path measures 59 ms for the same observation (2026-08-24)"';

// `Observer.OBSERVE_INTERVAL` frames between reads, at the engine's frame rate.
// This is the modelled cadence the sensor was given, not a second measurement.
export const VISUAL_CADENCE_MS = (OBSERVE_INTERVAL / C.FPS) * 1000;
export const VISUAL_CADENCE_SOURCE =
  'packages/play/src/venues/sim/observer.ts OBSERVE_INTERVAL (~15 Hz, the measured device cadence)';

// The g56's audio path is unmeasured and the ARM/HIT/MISS protocol that would
// measure it does not exist (`plans/08-audio-cue-controller.md` §"The latency
// budget an early-unmask would need"). `Observer.audioLatencyFrames` defaults
// to 12 frames "~200 ms" -- a modelling knob, not a measurement -- so the
// audio channel's read cost is UNKNOWN and its facts are excluded here.
export const AUDIO_READ_COST_SOURCE =
  'plans/08-audio-cue-controller.md "The g56\'s audio path is unmeasured, and the ARM/HIT/MISS protocol to measure it does not exist"';

// The host round trip is NOT measured. `Observer.readDelayFrames` defaults to
// 0 and its header calls it a model of host round-trip latency; the bench
// trace that would carry a real one is host-only today
// (`packages/review/src/measure/bench-trace.ts`). So the budget below is
// valid for a DEVICE-LOCAL reader only. A host-mediated controller may not
// claim it.
export const HOST_ROUND_TRIP_MS = UNKNOWN;
export const HOST_ROUND_TRIP_SOURCE =
  'packages/play/src/venues/sim/observer.ts readDelayFrames (knob, default 0); packages/review/src/measure/bench-trace.ts is host-only';

// Every fact below is served by a classifier whose threshold is NOT calibrated
// on the projection scaler (`docs/device/ON-DEVICE-VALIDATION.md`: "the
// classifier threshold on this path is not calibrated"), and no per-fact cue
// model is provisioned (`packages/play/profiles/` carries lifecycle/title/intro
// card only). Read cost is a transport property and is measured; correctness
// is a calibration property and is not. They are kept as separate fields so a
// search may use the first without anyone claiming the second.
const UNCALIBRATED = 'UNCALIBRATED';

// The control state a fact needs before the sensor will return OBSERVED at
// all, transcribed from `Observer._sample`'s own refusal reasons. This is a
// read PRECONDITION, not a cost: a branch on `boxPie` is only answerable while
// the monitor is up on the box camera, so a planner that ignores it is
// planning on UNKNOWN.
const visual = (id: string, precondition: string, refusals: readonly string[]) => ({
  fact: id,
  channel: 'visual' as const,
  readCostMs: VISUAL_READ_COST_MS,
  readCostSource: VISUAL_READ_COST_SOURCE,
  cadenceMs: VISUAL_CADENCE_MS,
  cadenceSource: VISUAL_CADENCE_SOURCE,
  precondition,
  refusals: Object.freeze([...refusals]),
  classifier: UNCALIBRATED,
  admissible: true as const,
  exclusion: null,
});

const audio = (id: string) => ({
  fact: id,
  channel: 'audio' as const,
  readCostMs: UNKNOWN,
  readCostSource: AUDIO_READ_COST_SOURCE,
  cadenceMs: UNKNOWN,
  cadenceSource: AUDIO_READ_COST_SOURCE,
  precondition: UNKNOWN,
  refusals: Object.freeze(['audio-dropped']),
  classifier: UNCALIBRATED,
  admissible: false as const,
  exclusion: 'read-cost-unmeasured',
});
/** A fact's priced read: measured costs when admissible, UNKNOWN (and excluded) when not. */
type BudgetEntry = Readonly<ReturnType<typeof visual> | ReturnType<typeof audio>>;

const ENTRIES = [
  visual('blackout', 'none', ['read-dropped']),
  visual('amHour', 'none', ['read-dropped']),
  visual('monitorUp', 'monitor-not-animating', ['read-dropped', 'monitor-animating']),
  visual('maskOn', 'mask-not-animating', ['read-dropped', 'mask-animating']),
  visual('boxPie', 'monitor-up-on-box-camera', ['read-dropped', 'box-not-on-screen']),
  visual('cameraSelected', 'monitor-up-single-highlight',
    ['read-dropped', 'cams-not-up', 'multiple-camera-highlight']),
  visual('cameraHighlights', 'monitor-up', ['read-dropped', 'cams-not-up']),
  visual('splitArmed', 'monitor-up', ['read-dropped', 'cams-not-up']),
  visual('leftOpening', 'office-visible-not-blacked-out',
    ['read-dropped', 'opening-not-in-view']),
  visual('ventLightL', 'office-visible', ['read-dropped', 'office-not-in-view']),
  audio('bbVent'),
  audio('bbVentId'),
  // The identity-free marker-122 thud. Same channel, same detector, same
  // unmeasured read cost as the Balloon Boy classification -- it is literally
  // the same waveform (`C.THUD_SAMPLE`) with the `who` discrimination that the
  // audio does not carry left off. It is priced here so nothing can branch on
  // it without the exclusion being visible, and it stays inadmissible for the
  // constrained search until Plan 08's latency measurement exists.
  audio('ventThud'),
  audio('ventThudId'),
  audio('ventThudAge'),
  audio('mangleStatic'),
  audio('mangleStaticCam'),
];

const freezeEntry = (entry: BudgetEntry): BudgetEntry => Object.freeze({ ...entry });

/** Per-fact observation budget, keyed by fact name. */
export const OBSERVATION_BUDGET: Readonly<Record<string, BudgetEntry>> = Object.freeze(Object.fromEntries(
  ENTRIES.map(entry => [entry.fact, freezeEntry(entry)])));

// The budget must cover the sensor exactly: a fact the Observer can return but
// the budget does not price is a fact a search could reach for without anyone
// having decided what it costs.
{
  const priced = Object.keys(OBSERVATION_BUDGET);
  const facts: readonly string[] = FACTS;
  const missing = facts.filter(fact => !priced.includes(fact));
  const extra = priced.filter(fact => !facts.includes(fact));
  if (missing.length || extra.length)
    throw new Error(`observation budget does not cover the sensor: missing ${missing}, extra ${extra}`);
}

/** Facts a branch may condition on: read cost measured, so the cost is known. */
export function admissibleFacts() {
  return Object.values(OBSERVATION_BUDGET)
    .filter(entry => entry.admissible).map(entry => entry.fact).sort();
}

/** Facts excluded from the language, with the reason each is excluded. */
export function excludedFacts() {
  return Object.values(OBSERVATION_BUDGET).filter(entry => !entry.admissible)
    .map(entry => ({ fact: entry.fact, exclusion: entry.exclusion }))
    .sort((a, b) => a.fact.localeCompare(b.fact));
}

/**
 * Facts whose device pairing is calibrated. Empty today, deliberately: read
 * cost is measured but no FACTS classifier is calibrated on the projection
 * path, so no branch below is device-promotable yet (Plan 15).
 */
export function deviceAdmissibleFacts() {
  return Object.values(OBSERVATION_BUDGET)
    .filter(entry => entry.admissible && entry.classifier !== UNCALIBRATED)
    .map(entry => entry.fact).sort();
}

/**
 * Worst-case age of an admissible fact at a decision point: a full sample
 * interval may have just elapsed, and the read itself takes its own cost.
 */
export function worstCaseFactAgeMs(fact: string): number | typeof UNKNOWN {
  const entry = OBSERVATION_BUDGET[fact];
  if (!entry || !entry.admissible) return UNKNOWN;
  return entry.cadenceMs + entry.readCostMs;
}

/** Earliest an action may follow the observation it was decided on. */
export function earliestReactionMs(fact: string): number | typeof UNKNOWN {
  const entry = OBSERVATION_BUDGET[fact];
  if (!entry || !entry.admissible) return UNKNOWN;
  return entry.readCostMs;
}

// --- Predicates -----------------------------------------------------------
//
// A fact is `{ state: 'OBSERVED', value }` or `{ state: 'UNKNOWN', reason }`.
// Every predicate here is total over that pair, so a branch can never take an
// arm because a refusal was silently read as a value.
export const PREDICATE_OPS = Object.freeze(['observed-equals', 'observed-in', 'unknown'] as const);

/** A total test over one fact reading: OBSERVED with a value, OBSERVED among values, or UNKNOWN. */
interface Predicate {
  readonly op: (typeof PREDICATE_OPS)[number];
  readonly fact: string;
  readonly value?: unknown;
  readonly values?: readonly unknown[];
}
/** An arm's action, timed from the decision point. */
interface BranchAction {
  readonly offsetMs: number;
  readonly [field: string]: unknown;
}
/** observation-branch-v1: read one admissible fact, then act on one of two arms. */
export interface Branch {
  readonly schema: 'observation-branch-v1';
  readonly id: string;
  readonly atMs: number;
  readonly observe: { readonly fact: string, readonly maxAgeMs: number, readonly confidenceFloor: number };
  readonly predicate: Predicate;
  readonly then: readonly BranchAction[];
  readonly otherwise: readonly BranchAction[];
  readonly [field: string]: unknown;
}

const finite = (value: unknown): value is number => Number.isFinite(value);

function fail(message: string): never { throw new TypeError(`observation language: ${message}`); }

export function validatePredicate(predicate: unknown): Predicate {
  if (!isRecord(predicate)) fail('predicate must be an object');
  if (!isOneOf(PREDICATE_OPS, predicate.op))
    fail(`predicate op must be one of ${PREDICATE_OPS.join(', ')}`);
  if (typeof predicate.fact !== 'string' || !Object.hasOwn(OBSERVATION_BUDGET, predicate.fact))
    fail(`predicate reads an unknown fact ${predicate.fact}`);
  const entry = OBSERVATION_BUDGET[predicate.fact];
  if (!entry) fail(`predicate reads an unknown fact ${predicate.fact}`);
  if (!entry.admissible)
    fail(`predicate reads excluded fact ${predicate.fact} (${entry.exclusion})`);
  if (predicate.op === 'observed-equals') {
    if (!Object.hasOwn(predicate, 'value')) fail('observed-equals needs a value');
  } else if (predicate.op === 'observed-in') {
    if (!isList(predicate.values) || !predicate.values.length)
      fail('observed-in needs a non-empty values array');
  } else if (Object.hasOwn(predicate, 'value') || Object.hasOwn(predicate, 'values')) {
    fail('unknown takes no value');
  }
  return predicate as unknown as Predicate;
}

/** Evaluate a validated predicate against a `{ state, value }` fact reading. */
export function evaluatePredicate(input: unknown, reading: unknown) {
  const predicate = validatePredicate(input);
  const observed = isRecord(reading) && reading.state === 'OBSERVED';
  if (predicate.op === 'unknown') return !observed;
  if (!observed) return false;
  // observed-in was checked to carry a non-empty values list.
  return predicate.op === 'observed-equals'
    ? reading.value === predicate.value
    : (predicate.values ?? []).includes(reading.value);
}

// --- Branches -------------------------------------------------------------

function branchArm(actions: unknown, label: string) {
  if (!isList(actions) || !actions.length) fail(`${label} needs at least one action`);
  let previous = -Infinity;
  for (const [index, action] of actions.entries()) {
    if (!isRecord(action)) fail(`${label} action ${index} is not an object`);
    if (!finite(action.offsetMs) || action.offsetMs < 0)
      fail(`${label} action ${index} needs a non-negative offsetMs from the decision point`);
    if (action.offsetMs < previous) fail(`${label} actions are not ordered by time`);
    previous = action.offsetMs;
  }
  return (actions[0] as BranchAction).offsetMs;
}

/**
 * Validate one observation-conditioned branch against the measured budget.
 *
 * `atMs` is the decision point relative to the enclosing repeat period; arm
 * action `offsetMs` values are relative to that decision point.
 */
export function validateBranch(branch: unknown): Branch {
  if (!isRecord(branch) || branch.schema !== BRANCH_SCHEMA)
    fail(`branch schema must be ${BRANCH_SCHEMA}`);
  if (typeof branch.id !== 'string' || !branch.id)
    fail('branch needs a string id');
  if (!finite(branch.atMs) || branch.atMs < 0)
    fail('branch needs a non-negative decision time');
  const observe = branch.observe;
  if (!isRecord(observe)) fail('branch needs an observe clause');
  if (typeof observe.fact !== 'string' || !Object.hasOwn(OBSERVATION_BUDGET, observe.fact))
    fail(`branch observes an unknown fact ${observe.fact}`);
  const fact = observe.fact;
  const entry = OBSERVATION_BUDGET[fact];
  if (!entry) fail(`branch observes an unknown fact ${observe.fact}`);
  if (!entry.admissible)
    fail(`branch observes excluded fact ${observe.fact} (${entry.exclusion}); its read cost is ${UNKNOWN}`);
  if (!finite(observe.maxAgeMs) || observe.maxAgeMs < 0)
    fail('branch observe.maxAgeMs must be finite and non-negative');
  const maxAgeMs = observe.maxAgeMs;
  if (!finite(observe.confidenceFloor) ||
      observe.confidenceFloor < 0 || observe.confidenceFloor > 1)
    fail('branch observe.confidenceFloor must be in [0,1]');
  if (!isRecord(branch.predicate) || branch.predicate.fact !== observe.fact)
    fail('branch predicate must read the fact the branch observes');
  validatePredicate(branch.predicate);

  // Rule 1: the freshness the branch demands must be reachable. A branch that
  // wants a fact younger than one sample interval plus one read is asking the
  // measured sensor for something it cannot deliver.
  // Both costs are numbers here: an inadmissible fact was refused above.
  const worstAge = worstCaseFactAgeMs(fact);
  if (typeof worstAge === 'number' && maxAgeMs < worstAge)
    fail(`branch ${branch.id} demands ${fact} within ${maxAgeMs}ms; the measured budget delivers ${worstAge}ms worst case`);

  // Rule 2: the reaction must be schedulable. Nothing can act on a read before
  // the read has finished.
  const thenAt = branchArm(branch.then, `branch ${branch.id} then`);
  const otherwiseAt = branchArm(branch.otherwise, `branch ${branch.id} otherwise`);
  const reaction = earliestReactionMs(fact);
  if (typeof reaction === 'number' && Math.min(thenAt, otherwiseAt) < reaction)
    fail(`branch ${branch.id} acts ${Math.min(thenAt, otherwiseAt)}ms after its observation; the measured read costs ${reaction}ms`);
  return branch as unknown as Branch;
}

/** The whole language definition as plain data, for a search report header. */
export function observationLanguage() {
  return {
    schema: OBSERVATION_LANGUAGE_SCHEMA,
    branchSchema: BRANCH_SCHEMA,
    predicateOps: [...PREDICATE_OPS],
    hostRoundTripMs: HOST_ROUND_TRIP_MS,
    hostRoundTripSource: HOST_ROUND_TRIP_SOURCE,
    admissible: admissibleFacts(),
    excluded: excludedFacts(),
    deviceAdmissible: deviceAdmissibleFacts(),
    budget: structuredClone(OBSERVATION_BUDGET),
  };
}
