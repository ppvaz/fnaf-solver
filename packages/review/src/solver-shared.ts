// What every solver verb shares: the verb, query, instrument and resource tables, the refusal a
// bad argument gets, and the context a verb reads the checkout through (solver.ts builds it).
import { refusalEnvelope, unknown, isUnknown } from '@sixam/kernel';
import type { EnvelopeLabel } from '@sixam/kernel';
import type { createTruth } from '@sixam/source/truth';
import { GAMES } from './registers.ts';
import type { readPackRow } from './registers.ts';

/** What a verb reads: the checkout, the caller's local-dump reader, and the cached committed-winner compile. */
export interface SolverContext {
  readonly root: string;
  readonly truth: ReturnType<typeof createTruth>;
  readonly winners: () => Map<string, string>;
}

export type PackRow = ReturnType<typeof readPackRow>;
export type ValidPackRow = Extract<PackRow, { valid: true }>;

export const SURFACE_DOC = 'docs/device/COMPANION-MCP.md';
export const PLAN28 = 'plans/28-solver-interface.md';

/** The verbs, by the name every door calls them. */
/** The name the solver interface is served under (the stdio MCP server, apps/desktop/src/companion-mcp.ts). */
export const SOLVER_SERVER_NAME = 'fnaf-solver';
export const VERBS = Object.freeze(['describe', 'query', 'review', 'promote', 'check', 'truth']);
export const QUERIES = Object.freeze(['promotions', 'packs', 'chronicle', 'contracts']);
export const INSTRUMENTS = Object.freeze(['custody', 'outcome', 'promotion-checks', 'death-time']);
/** Commands that emit claim-envelope-v1: this surface's verbs through the review CLI, and the two retrofitted tools. */
export const ENVELOPE_EMITTERS = Object.freeze([...VERBS.map(verb => `npm run review -- ${verb}`),
  'npm run review -- query promotions --envelope', 'npm run evidence -- promotions --envelope', 'npm run evidence -- show --envelope']);

/** The read-only resources: fixed URIs, and one template per game. */
export const RESOURCES = Object.freeze([
  { uri: 'fnaf://chronicle', name: 'chronicle', description: 'Every chronicle checkpoint and entry, with its label and status.' },
  { uri: 'fnaf://evidence/graph', name: 'evidence graph', description: 'docs/evidence/graph.json: claims, runs and PROMOTED_BY edges.' },
  { uri: 'fnaf://contracts', name: 'contracts', description: 'The contract register, each contract with its conformance fixtures.' },
  { uri: 'fnaf://refuted', name: 'refuted', description: 'Negative results: chronicle refutations, retractions, negatives and superseded entries, each with its game, and the parked routes of docs/ARCHIVED-ROUTES.md.' },
]);
export const RESOURCE_TEMPLATES = Object.freeze([
  { uriTemplate: 'fnaf://game/{pkg}/controls', name: 'game controls', description: "One game's control-catalog-v1 (D5), by Android package." },
  { uriTemplate: 'fnaf://truth/{game}/frame/{frame}/group/{group}', name: 'event group',
    description: "One event group of the caller's own local dump, parsed into fields (truth events over a frame and a group)." },
]);

export const PACK_ID = /^[\w.-]+$/;

export const shellQuote = (text: unknown) => `'${String(text).replaceAll("'", "'\\''")}'`;

/** A caller's argument refused: the rule, what was wrong, and what is accepted. */
export const badArgument = (because: string, remedy: string) => refusalEnvelope({ rule: 'invalid-argument', because, cite: [SURFACE_DOC], remedy });
export const gameRefusal = (game: unknown) => badArgument(`${JSON.stringify(game ?? null)} is not a registered game`,
  `name one of ${GAMES.map(item => `${item.alias} (${item.package})`).join(', ')}`);

/** One label for a list: the label every row shares, or UNKNOWN naming the mix. */
export function sharedLabel(labels: readonly EnvelopeLabel[], what: string): EnvelopeLabel {
  const keys = [...new Set(labels.map(label => (isUnknown(label) ? 'UNKNOWN' : label)))];
  if (keys.length === 1 && keys[0] !== 'UNKNOWN') return labels[0];
  if (!labels.length) return unknown(`no ${what} match, so there is no label to carry`);
  return unknown(`the ${what} carry ${keys.length > 1 ? `different labels (${keys.sort().join(', ')})` : 'UNKNOWN labels'}; each row carries its own`);
}

