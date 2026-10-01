// Policy-program IR validation and canonicalization (Plan 21 package 1).
// The IR is intentionally finite plain data: it describes reviewed actions
// and observations, never shell commands or arbitrary callbacks.

import { PACKAGES, catalogAcceptsControl, controlCatalogFor } from '@sixam/source';
import { validateBranch } from './observation-language.ts';
import type { Branch } from './observation-language.ts';
import { isList, isOneOf, isRecord } from '@sixam/kernel';

export const POLICY_SCHEMA = 'policy-v1';
export const PHASE_KINDS = Object.freeze(['idle', 'setup', 'repeat', 'finish', 'observe'] as const);

type Game = keyof typeof PACKAGES;
/** One timed contact a phase authors: a control of its game, at a time inside the phase. */
export interface PolicyAction {
  readonly action: string;
  readonly atMs?: number;
  readonly offsetMs?: number;
  readonly contactMs?: number;
  readonly [field: string]: unknown;
}
/** A span of the night: what runs in it, what it may branch on, and what it records. */
interface PhaseFields {
  readonly id: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly actions?: readonly PolicyAction[];
  readonly branches?: readonly Branch[];
  readonly observations?: readonly { readonly fact: string, readonly maxAgeMs: number, readonly confidenceFloor: number }[];
  readonly [field: string]: unknown;
}
/** The repeat body, which runs once per positive period. */
export interface RepeatPhase extends PhaseFields { readonly kind: 'repeat'; readonly periodMs: number }
/** A phase of each kind; only the repeat body has a period. */
export type PolicyPhase = RepeatPhase | (PhaseFields & { readonly kind: Exclude<(typeof PHASE_KINDS)[number], 'repeat'>, readonly periodMs?: number });
/** policy-v1: a finite program of phases over one game's controls, with its proof obligations. */
export interface PolicyProgram {
  readonly schema: 'policy-v1';
  readonly metadata: { readonly id: string, readonly nights: readonly number[], readonly game?: string, readonly [field: string]: unknown };
  readonly phases: readonly PolicyPhase[];
  readonly proof: { readonly seeds: readonly unknown[], readonly traceEquivalence: boolean, readonly [field: string]: unknown };
  readonly [field: string]: unknown;
}

// A policy names its game in `metadata.game` (fnaf1..fnaf4). Every policy-v1
// written before the IR took a game is FNaF 2's, so an absent game means
// FNaF 2 and those programs keep their canonical bytes.
const DEFAULT_GAME = 'fnaf2';

// An action names a control in its game's catalog (@sixam/source,
// games/<game>/controls.js): a control id, a simulator name the catalog keeps,
// or a stated camera. FNaF 2's IR predates the catalog and spells three
// actions its own way. Those spellings are stored in every canonical policy
// and hashed into its artifact (ADR 0002 principle 9), so they are mapped
// here, never renamed. `light` and `hall` are FNaF 2 simulator names the
// catalog accepts as spelled.
const STORED_ACTIONS: Readonly<Partial<Record<Game, Readonly<Record<string, string>>>>> = Object.freeze({
  fnaf2: Object.freeze({ cam9: 'cam:9', cam11: 'cam:11', ventl: 'leftVentLight' }),
});

const finite = (value: unknown): value is number => Number.isFinite(value);
const isGame = (value: unknown): value is Game => typeof value === 'string' && Object.hasOwn(PACKAGES, value);

/** The game `program` is written for: its `metadata.game`, or `fnaf2` when it names none. */
export function policyGame(program: unknown): Game {
  const metadata = isRecord(program) && isRecord(program.metadata) ? program.metadata : undefined;
  const game = metadata?.game ?? DEFAULT_GAME;
  if (!isGame(game))
    throw new TypeError(`policy metadata.game ${JSON.stringify(game)} is not a registered game ` +
      `(${Object.keys(PACKAGES).join(', ')})`);
  return game;
}

function actionControl(action: string, game: Game) {
  const stored = STORED_ACTIONS[game];
  return stored && Object.hasOwn(stored, action) ? stored[action] : action;
}

function sorted(value: unknown): unknown {
  if (isList(value)) return value.map(sorted);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
}

export function canonicalPolicy(program: unknown) {
  return JSON.stringify(sorted(program)) + '\n';
}

function checkAction(action: unknown, label: string, catalog: ReturnType<typeof controlCatalogFor>, game: Game) {
  if (!isRecord(action) || typeof action.action !== 'string' ||
      !catalogAcceptsControl(catalog, actionControl(action.action, game)))
    throw new TypeError(`${label} has an unsupported action: ` +
      `${JSON.stringify(isRecord(action) ? action.action : action)} is not a ${catalog.title} control`);
  const time = action.atMs ?? action.offsetMs;
  if (!finite(time) || time < 0) throw new TypeError(`${label} needs a non-negative time`);
  if (action.contactMs !== undefined &&
      (!finite(action.contactMs) || action.contactMs <= 0))
    throw new TypeError(`${label} has invalid contactMs`);
}

export function validatePolicy(program: unknown): PolicyProgram {
  if (!isRecord(program) || program.schema !== POLICY_SCHEMA)
    throw new TypeError('policy schema mismatch');
  if (!isRecord(program.metadata) || typeof program.metadata.id !== 'string' ||
      !isList(program.metadata.nights) || !program.metadata.nights.length)
    throw new TypeError('policy metadata is incomplete');
  const game = policyGame(program);
  const catalog = controlCatalogFor(PACKAGES[game]);
  if (!isList(program.phases) || !program.phases.length)
    throw new TypeError('policy needs phases');
  let previousEnd = 0;
  for (const [index, phase] of program.phases.entries()) {
    const label = `phase ${index}`;
    if (!isRecord(phase) || !isOneOf(PHASE_KINDS, phase.kind) ||
        typeof phase.id !== 'string' || !finite(phase.startMs) ||
        !finite(phase.endMs) || phase.startMs < previousEnd ||
        phase.endMs < phase.startMs)
      throw new TypeError(`${label} has invalid bounds or kind`);
    if (phase.kind === 'repeat' &&
        (!finite(phase.periodMs) || phase.periodMs <= 0))
      throw new TypeError(`${label} repeat needs a positive periodMs`);
    for (const [actionIndex, action] of (isList(phase.actions) ? phase.actions : []).entries())
      checkAction(action, `${label} action ${actionIndex}`, catalog, game);
    // An observation-conditioned branch is the only construct that may read a
    // fact and change what runs. Validating it here means no consumer of the
    // IR -- interpreter, device compiler, search -- can be handed a branch
    // that reads an excluded fact or acts faster than the measured read.
    if (phase.branches !== undefined) {
      if (!isList(phase.branches))
        throw new TypeError(`${label} branches must be an array`);
      if (phase.kind !== 'repeat' && phase.branches.length)
        throw new TypeError(`${label} branches are only defined inside a repeat body`);
      for (const branch of phase.branches) validateBranch(branch);
    }
    for (const [observationIndex, observation] of (isList(phase.observations) ? phase.observations : []).entries()) {
      if (!isRecord(observation) || typeof observation.fact !== 'string' ||
          !finite(observation.maxAgeMs) || observation.maxAgeMs < 0 ||
          !finite(observation.confidenceFloor) || observation.confidenceFloor < 0 ||
          observation.confidenceFloor > 1)
        throw new TypeError(`${label} observation ${observationIndex} is invalid`);
    }
    previousEnd = phase.endMs;
  }
  if (!isRecord(program.proof) || !isList(program.proof.seeds) ||
      typeof program.proof.traceEquivalence !== 'boolean')
    throw new TypeError('policy proof obligations are incomplete');
  return program as unknown as PolicyProgram;
}

export function roundTripPolicy(program: unknown): PolicyProgram {
  validatePolicy(program);
  return JSON.parse(canonicalPolicy(program));
}
