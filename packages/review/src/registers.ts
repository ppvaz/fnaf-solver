// The registers the solver interface projects, read as the repository holds them.
//
// Plan 28: the interface is "a read-mostly projection of registers this repository already
// generates". Each reader below opens one register and returns it with the path it read, and
// none writes. Where a register has no field for a question -- a chronicle-entries-v1 entry has no
// game, the contract register no game dimension -- the reader says so as UNKNOWN(reason) rather than
// guessing, and the rule that attributes a record to a game is named beside the attribution.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_PACKAGES, controlCatalogFor } from '@sixam/source';
import { isList, isRecord, isUnknown, unknown } from '@sixam/kernel';
import type { EnvelopeLabel } from '@sixam/kernel';
import type { ControlDescriptor } from '@sixam/kernel/contracts';
import { KINDS, ROUTES, RUNGS, SCHEMAS, V1_GAME, checkCorpus, readEntries } from './chronicle-schema.ts';
import type { ChronicleCheckpoint } from './chronicle-schema.ts';
import { PACKS_DIR, attestationStatus, packCustody, packEntry, readPack } from './evidence-pack.ts';
import type { RunPack } from './evidence-pack.ts';
import { GRAPH_FILE, PROMOTION_EDGE, readGraph } from './evidence-promotion.ts';
import { jsonObject, listOrEmpty, objectOrNull } from './records.ts';
import type { JsonObject } from './records.ts';

export const CHRONICLE_DIR = 'docs/chronicle/entries';
export const CHRONICLE_SCHEMA_MODULE = 'packages/review/src/chronicle-schema.ts';
export const CONTRACT_REGISTER = 'packages/kernel/contracts/register.json';
export const CONTRACT_SPECIFICATIONS = 'docs/architecture/generated/contract-specifications.json';
export const COMMAND_REGISTRY = 'docs/architecture/generated/command-registry.json';
export const ARCHIVED_ROUTES = 'docs/ARCHIVED-ROUTES.md';
export const CONTROL_CATALOG_DIR = 'packages/source/src/games';
/** A registered game's control catalog, `packages/source/src/games/<alias>/controls.js`. */
export const controlCatalogFile = (alias: string) => `${CONTROL_CATALOG_DIR}/${alias}/controls.js`;

const readJson = (root: string, path: string) => jsonObject(readFileSync(join(root, path), 'utf8'), path);
/** A register row that names itself by a string id. */
const isIdentified = (item: unknown): item is JsonObject & { readonly id: string } => isRecord(item) && typeof item.id === 'string';

// --- games ---------------------------------------------------------------------------------

/** A registered game by its package, with the short name its catalog title gives it ("FNaF 2" -> fnaf2). */
export const GAMES = Object.freeze(GAME_PACKAGES.map(pkg => Object.freeze({
  package: pkg, title: controlCatalogFor(pkg).title, alias: controlCatalogFor(pkg).title.toLowerCase().replace(/\s+/g, ''),
})));

/** The game a caller names by package or short name, or null. */
export const resolveGame = (game: unknown) => GAMES.find(item => item.package === game || item.alias === game) ?? null;

/** Games whose nights run through the campaign executor: those whose catalog has an artifact action table. */
export const executorGames = () => GAMES.filter(game => controlCatalogFor(game.package).artifactActions);

// --- the chronicle -------------------------------------------------------------------------

/**
 * A chronicle-entries-v2 entry names its game. A chronicle-entries-v1 entry has no game field,
 * and its route and rung vocabularies (ROUTES, RUNGS in packages/review/src/chronicle-schema.ts) are FNaF 2's
 * -- Minus 7 to 10/20, and Plan 12's FNaF 2 ladder -- so every v1 entry is attributed to FNaF 2,
 * and to no other game, by that rule.
 */
export const CHRONICLE_GAME = 'com.scottgames.fnaf2';
export const CHRONICLE_ATTRIBUTION = 'a chronicle-entries-v2 entry names its game; chronicle-entries-v1 has no game field, and its ' +
  `ROUTES and RUNGS vocabularies (${CHRONICLE_SCHEMA_MODULE}) are FNaF 2's, so every v1 entry is attributed to ${CHRONICLE_GAME}`;
/** The kinds that record a negative result. */
export const NEGATIVE_KINDS = Object.freeze(['refutation', 'retraction', 'negative']);

/**
 * Every checkpoint and entry, checked by the chronicle's own corpus rules; a corpus that fails
 * them is refused rather than served. Each entry carries its game (v1 entries read as fnaf2) and
 * `target`, that game's package; an entry a v2 correction supersedes reads as superseded, and
 * `storedStatus` keeps what its frozen file says (readEntries in packages/review/src/chronicle-schema.ts).
 */
export function readChronicle(root: string) {
  const names = readdirSync(join(root, CHRONICLE_DIR)).filter(name => name.endsWith('.json')).sort();
  const files = names.map(name => ({ file: `${CHRONICLE_DIR}/${name}`, ...readJson(root, `${CHRONICLE_DIR}/${name}`) }));
  const problems = checkCorpus(files);
  if (problems.length) throw new Error(`the chronicle fails its own checks: ${problems.slice(0, 3).join('; ')}`);
  // checkCorpus is the chronicle's validator: every checkpoint passed it.
  const checkpoints = files as unknown as ChronicleCheckpoint[];
  const entries = readEntries(checkpoints).map(entry => ({ ...entry, target: resolveGame(entry.game)?.package ?? CHRONICLE_GAME }));
  return { schemas: SCHEMAS, v1Game: V1_GAME, checkpoints, entries, rungs: RUNGS, routes: ROUTES, kinds: KINDS };
}

/**
 * A chronicle label in kernel words: DEVICE_MEASURED, MODEL_ONLY and FIXTURE are ClaimLevels, the
 * other four named labels are SourceLabels, and the chronicle's bare UNKNOWN becomes UNKNOWN(reason).
 */
// checkCorpus admits only LABELS_V2, each a ClaimLevel or a named SourceLabel besides UNKNOWN.
export const chronicleLabel = (entry: {id: string, label: string, title: string}): EnvelopeLabel => entry.label === 'UNKNOWN'
  ? unknown(`chronicle entry ${entry.id} is labelled UNKNOWN: ${entry.title}`) : entry.label as EnvelopeLabel;

/** Is the entry a negative result: a refutation, retraction or negative, or no longer standing? */
export const isNegative = (entry: { readonly kind: string, readonly status: string }) => NEGATIVE_KINDS.includes(entry.kind) || entry.status !== 'standing';

// --- archived routes -------------------------------------------------------------------------

/**
 * The rows of docs/ARCHIVED-ROUTES.md's "Archived routes" table. The page's own rule: a route
 * listed there is parked, not refuted, unless its row says so.
 */
export function readArchivedRoutes(root: string) {
  const text = readFileSync(join(root, ARCHIVED_ROUTES), 'utf8');
  const section = text.split(/^## /m).find(part => part.startsWith('Archived routes'));
  if (!section) return { heading: null, routes: [] };
  const heading = section.split('\n')[0].trim();
  const rows = section.split('\n').filter(line => line.startsWith('|')).map(line => line.slice(1, -1).split(' | ').map(cell => cell.trim()));
  const [header, , ...body] = rows;
  if (!header || header[0] !== 'Route') return { heading, routes: [] };
  return {
    heading,
    routes: body.map(cells => ({ route: cells[0], paths: cells[1], lastCommit: cells[2], results: cells[3],
      status: /\brefuted\b/i.test(cells.join(' ')) ? 'refuted' : 'parked' })),
  };
}

// --- contracts -----------------------------------------------------------------------------

/** The contract register, each contract with its conformance fixtures from the generated specifications. */
export function readContracts(root: string) {
  const register = readJson(root, CONTRACT_REGISTER);
  const { contracts } = register;
  if (!isList(contracts) || !contracts.every(isIdentified)) throw new Error(`${CONTRACT_REGISTER} lists a contract with no id`);
  const specifications = existsSync(join(root, CONTRACT_SPECIFICATIONS))
    ? listOrEmpty(readJson(root, CONTRACT_SPECIFICATIONS).specifications).map(objectOrNull) : [];
  const fixtures = new Map(specifications.map(spec => [spec?.contractId, spec?.conformanceFixtures ?? []]));
  return {
    schema: register.schema, owner: register.owner,
    contracts: contracts.map((item): Readonly<Record<string, unknown>> & { id: string, conformanceFixtures: unknown } => ({ ...item,
      conformanceFixtures: fixtures.get(item.id) ?? unknown(`${CONTRACT_SPECIFICATIONS} lists no fixture for ${item.id}; run npm run catalog`) })),
  };
}

/** The command ids and tool ids of the generated command registry. */
export function readCommandRegistry(root: string) {
  const { commands, tools } = readJson(root, COMMAND_REGISTRY);
  if (!isList(commands) || !commands.every(isIdentified) || !isList(tools) || !tools.every(isIdentified))
    throw new Error(`${COMMAND_REGISTRY} lists a command or tool with no id`);
  return { commands: commands.map(item => item.id), tools: tools.map(item => item.id) };
}

// --- control catalogs ----------------------------------------------------------------------

const CATALOG_UNKNOWN = /^UNKNOWN\(/;

/**
 * Every fact a control catalog writes as UNKNOWN(reason), as {control, field, value}.
 */
export function catalogUnknowns(catalog: { readonly controls: readonly ControlDescriptor[], readonly cameras?: unknown }) {
  const found: { control: unknown, field: string, value: string }[] = [];
  const visit = (control: unknown, path: string, value: unknown) => {
    if (typeof value === 'string' && CATALOG_UNKNOWN.test(value)) found.push({ control, field: path, value });
    else if (value && typeof value === 'object' && !Array.isArray(value))
      for (const [key, item] of Object.entries(value)) visit(control, path ? `${path}.${key}` : key, item);
  };
  for (const control of catalog.controls) {
    const { id, aliases, actions, ...facts } = control;
    visit(id, '', facts);
    if (typeof actions === 'string') visit(id, 'actions', actions);
  }
  if (catalog.cameras && typeof catalog.cameras === 'object') visit('cameras', '', catalog.cameras);
  return found;
}

// --- run packs -----------------------------------------------------------------------------

/**
 * The game a pack was played on, and the basis for saying so: a runner's pack names its
 * target package; a campaign pack that kept request.json names its target; any other campaign
 * pack was played by the campaign executor, which runs only the games whose catalog has an
 * artifact action table -- attributed when exactly one does.
 */
export function packGame(dir: string, loaded: {pack: RunPack, files: readonly string[]}) {
  const { pack, files } = loaded;
  if (pack.kind === 'fnaf1-run') {
    const target = isRecord(pack.target) ? pack.target.package : undefined;
    const game = resolveGame(target);
    return game ? { game: game.package, basis: 'pack.json target.package' }
      : { game: unknown(`the runner's pack names target ${JSON.stringify(target ?? null)}, not a registered game`), basis: null };
  }
  if (files.includes('request.json')) {
    const request = jsonObject(readFileSync(join(dir, 'request.json'), 'utf8'), 'request.json');
    const named = objectOrNull(objectOrNull(request.spec)?.target)?.package
      ?? String(objectOrNull(request.profile)?.targetBuild ?? '').split(':')[0];
    const game = resolveGame(named);
    if (game) return { game: game.package, basis: 'request.json spec.target.package' };
  }
  const executor = executorGames();
  return executor.length === 1
    ? { game: executor[0].package, basis: 'a campaign pack: the campaign executor (device-executor-v1) runs only games whose ' +
      `control catalog has an artifact action table, and only ${executor[0].package}'s does` }
    : { game: unknown(`a campaign pack without request.json, and ${executor.length} games have an artifact action table`), basis: null };
}

/** The graph's PROMOTED_BY edges by the run node they bind. */
export const promotionEdges = (root: string) => new Map(readGraph(root).edges.filter(edge => edge.type === PROMOTION_EDGE).map(edge => [edge.to, edge] as const));

/** The committed pack ids, in directory order. */
export const packDirectories = (root: string) => readdirSync(join(root, PACKS_DIR)).sort();

/**
 * One committed pack, read through its integrity check, with its game, index entry, custody,
 * attestation and the PROMOTED_BY edge that binds it (if any). A pack that fails its check is
 * returned with the failure, never dropped.
 * @param edges promotionEdges(root)
 */
export function readPackRow(root: string, id: string, edges: ReturnType<typeof promotionEdges> = promotionEdges(root)) {
  const dir = join(root, PACKS_DIR, id);
  let loaded;
  try { loaded = readPack(dir); } catch (error) {
    const message = (error as Error).message;
    return { id, game: unknown(`the pack fails its integrity check: ${message}`), valid: false as const, error: message };
  }
  const { game, basis } = packGame(dir, loaded);
  const fnaf1 = loaded.pack.kind === 'fnaf1-run';
  const entry = fnaf1 ? null : packEntry(id, loaded);
  const edge = edges.get(`run.${id}`) ?? null;
  const attestation = attestationStatus(loaded.attestation, loaded.digest);
  return {
    id, valid: true as const, game, gameBasis: basis, kind: fnaf1 ? 'fnaf1-run' : 'device-campaign',
    // A campaign pack has an index entry; a runner's pack has none.
    outcome: entry ? entry.outcome : (isRecord(loaded.pack.outcome) ? loaded.pack.outcome.ended ?? null : null),
    claimLevel: entry ? entry.claimLevel ?? null : loaded.pack.claimLevel ?? null,
    nights: entry ? entry.nights ?? loaded.pack.nights ?? null : null,
    custody: packCustody(loaded.pack), packSha256: loaded.digest,
    attestedBy: attestation?.valid ? attestation.by : null,
    promoted: edge && edge.packSha256 === loaded.digest ? edge.from : null,
    files: loaded.files,
  };
}

/** Every committed pack, as readPackRow reads it. */
export function readPacks(root: string) {
  const edges = promotionEdges(root);
  return packDirectories(root).map(id => readPackRow(root, id, edges));
}

export const gameKey = (value: unknown) => (isUnknown(value) ? 'UNKNOWN' : value);

export { GRAPH_FILE, PACKS_DIR };
