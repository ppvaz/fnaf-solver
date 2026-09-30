// The registers the solver interface projects, read as the repository holds them.
//
// Plan 28: the interface is "a read-mostly projection of registers this repository already
// generates". Each reader below opens one register and returns it with the path it read, and
// none writes. Where a register has no field for a question -- the chronicle has no game, the
// contract register no game dimension -- the reader says so as UNKNOWN(reason) rather than
// guessing, and the rule that attributes a record to a game is named beside the attribution.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_CATALOGS, GAME_PACKAGES } from '@sixam/core/control';
import { isUnknown, unknown } from '@sixam/kernel';
import { ENTRIES_SCHEMA, KINDS, ROUTES, RUNGS, checkCorpus } from '../../../tools/chronicle-schema.mjs';
import { PACKS_DIR, attestationStatus, packCustody, packEntry, readPack } from './evidence-pack.mjs';
import { GRAPH_FILE, PROMOTION_EDGE, readGraph } from './evidence-promotion.mjs';

export const CHRONICLE_DIR = 'docs/chronicle/entries';
export const CHRONICLE_SCHEMA_MODULE = 'tools/chronicle-schema.mjs';
export const CONTRACT_REGISTER = 'packages/kernel/contracts/register.json';
export const CONTRACT_SPECIFICATIONS = 'docs/architecture/generated/contract-specifications.json';
export const COMMAND_REGISTRY = 'docs/architecture/generated/command-registry.json';
export const ARCHIVED_ROUTES = 'docs/ARCHIVED-ROUTES.md';
export const CONTROL_CATALOG_DIR = 'packages/source/src/games';
/** A registered game's control catalog, `packages/source/src/games/<alias>/controls.js`. */
export const controlCatalogFile = alias => `${CONTROL_CATALOG_DIR}/${alias}/controls.js`;

const readJson = (root, path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

// --- games ---------------------------------------------------------------------------------

/** A registered game by its package, with the short name its catalog title gives it ("FNaF 2" -> fnaf2). */
export const GAMES = Object.freeze(GAME_PACKAGES.map(pkg => Object.freeze({
  package: pkg, title: CONTROL_CATALOGS[pkg].title, alias: CONTROL_CATALOGS[pkg].title.toLowerCase().replace(/\s+/g, ''),
})));

/** The game a caller names by package or short name, or null. @param {unknown} game */
export const resolveGame = game => GAMES.find(item => item.package === game || item.alias === game) ?? null;

/** Games whose nights run through the campaign executor: those whose catalog has an artifact action table. */
export const executorGames = () => GAMES.filter(game => CONTROL_CATALOGS[game.package].artifactActions);

// --- the chronicle -------------------------------------------------------------------------

/**
 * The chronicle has no game field. Its route and rung vocabularies (ROUTES, RUNGS in
 * tools/chronicle-schema.mjs) are FNaF 2's -- Minus 7 to 10/20, and Plan 12's FNaF 2 ladder --
 * so every entry is attributed to FNaF 2, and to no other game, by that rule.
 */
export const CHRONICLE_GAME = 'com.scottgames.fnaf2';
export const CHRONICLE_ATTRIBUTION = 'chronicle-entries-v1 has no game field; its ROUTES and RUNGS vocabularies ' +
  `(${CHRONICLE_SCHEMA_MODULE}) are FNaF 2's, so every entry is attributed to ${CHRONICLE_GAME}`;
/** The kinds that record a negative result. */
export const NEGATIVE_KINDS = Object.freeze(['refutation', 'retraction', 'negative']);

/**
 * Every checkpoint and entry, checked by the chronicle's own corpus rules; a corpus that fails
 * them is refused rather than served.
 * @param {string} root
 */
export function readChronicle(root) {
  const names = readdirSync(join(root, CHRONICLE_DIR)).filter(name => name.endsWith('.json')).sort();
  const checkpoints = names.map(name => ({ file: `${CHRONICLE_DIR}/${name}`, ...readJson(root, `${CHRONICLE_DIR}/${name}`) }));
  const problems = checkCorpus(checkpoints);
  if (problems.length) throw new Error(`the chronicle fails its own checks: ${problems.slice(0, 3).join('; ')}`);
  const entries = checkpoints.flatMap(checkpoint => checkpoint.entries.map(entry => ({ ...entry, checkpoint: checkpoint.checkpoint,
    file: checkpoint.file })));
  return { schema: ENTRIES_SCHEMA, checkpoints, entries, rungs: RUNGS, routes: ROUTES, kinds: KINDS };
}

/**
 * A chronicle label in kernel words: DEVICE_MEASURED is a ClaimLevel, the other four named
 * labels are SourceLabels, and the chronicle's bare UNKNOWN becomes UNKNOWN(reason).
 * @param {{id: string, label: string, title: string}} entry
 */
export const chronicleLabel = entry => entry.label === 'UNKNOWN'
  ? unknown(`chronicle entry ${entry.id} is labelled UNKNOWN: ${entry.title}`) : entry.label;

/** Is the entry a negative result: a refutation, retraction or negative, or no longer standing? */
export const isNegative = entry => NEGATIVE_KINDS.includes(entry.kind) || entry.status !== 'standing';

// --- archived routes -------------------------------------------------------------------------

/**
 * The rows of docs/ARCHIVED-ROUTES.md's "Archived routes" table. The page's own rule: a route
 * listed there is parked, not refuted, unless its row says so.
 * @param {string} root
 */
export function readArchivedRoutes(root) {
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

/** The contract register, each contract with its conformance fixtures from the generated specifications. @param {string} root */
export function readContracts(root) {
  const register = readJson(root, CONTRACT_REGISTER);
  const specifications = existsSync(join(root, CONTRACT_SPECIFICATIONS)) ? readJson(root, CONTRACT_SPECIFICATIONS).specifications : [];
  const fixtures = new Map(specifications.map(spec => [spec.contractId, spec.conformanceFixtures ?? []]));
  return {
    schema: register.schema, owner: register.owner,
    contracts: register.contracts.map(item => ({ ...item,
      conformanceFixtures: fixtures.get(item.id) ?? unknown(`${CONTRACT_SPECIFICATIONS} lists no fixture for ${item.id}; run npm run catalog`) })),
  };
}

/** The command ids and tool ids of the generated command registry. @param {string} root */
export function readCommandRegistry(root) {
  const registry = readJson(root, COMMAND_REGISTRY);
  return { commands: registry.commands.map(item => item.id), tools: registry.tools.map(item => item.id) };
}

// --- control catalogs ----------------------------------------------------------------------

const CATALOG_UNKNOWN = /^UNKNOWN\(/;

/**
 * Every fact a control catalog writes as UNKNOWN(reason), as {control, field, value}.
 * @param {any} catalog
 */
export function catalogUnknowns(catalog) {
  const found = [];
  const visit = (control, path, value) => {
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
 * The game a pack was played on, and the basis for saying so: a FNaF 1 runner's pack names its
 * target package; a campaign pack that kept request.json names its target; any other campaign
 * pack was played by the campaign executor, which runs only the games whose catalog has an
 * artifact action table -- attributed when exactly one does.
 * @param {string} dir @param {{pack: any, files: string[]}} loaded
 */
export function packGame(dir, loaded) {
  const { pack, files } = loaded;
  if (pack.kind === 'fnaf1-run') {
    const game = resolveGame(pack.target?.package);
    return game ? { game: game.package, basis: 'pack.json target.package' }
      : { game: unknown(`the FNaF 1 runner's pack names target ${JSON.stringify(pack.target?.package ?? null)}, not a registered game`), basis: null };
  }
  if (files.includes('request.json')) {
    const request = JSON.parse(readFileSync(join(dir, 'request.json'), 'utf8'));
    const named = request?.spec?.target?.package ?? String(request?.profile?.targetBuild ?? '').split(':')[0];
    const game = resolveGame(named);
    if (game) return { game: game.package, basis: 'request.json spec.target.package' };
  }
  const executor = executorGames();
  return executor.length === 1
    ? { game: executor[0].package, basis: 'a campaign pack: the campaign executor (device-executor-v1) runs only games whose ' +
      `control catalog has an artifact action table, and only ${executor[0].package}'s does` }
    : { game: unknown(`a campaign pack without request.json, and ${executor.length} games have an artifact action table`), basis: null };
}

/** The graph's PROMOTED_BY edges by the run node they bind. @param {string} root */
export const promotionEdges = root => new Map(readGraph(root).edges.filter(edge => edge.type === PROMOTION_EDGE).map(edge => [edge.to, edge]));

/** The committed pack ids, in directory order. @param {string} root */
export const packDirectories = root => readdirSync(join(root, PACKS_DIR)).sort();

/**
 * One committed pack, read through its integrity check, with its game, index entry, custody,
 * attestation and the PROMOTED_BY edge that binds it (if any). A pack that fails its check is
 * returned with the failure, never dropped.
 * @param {string} root @param {string} id @param {Map<string, any>} [edges] promotionEdges(root)
 */
export function readPackRow(root, id, edges = promotionEdges(root)) {
  const dir = join(root, PACKS_DIR, id);
  let loaded;
  try { loaded = readPack(dir); } catch (error) {
    return { id, game: unknown(`the pack fails its integrity check: ${error.message}`), valid: false, error: error.message };
  }
  const { game, basis } = packGame(dir, loaded);
  const fnaf1 = loaded.pack.kind === 'fnaf1-run';
  const entry = fnaf1 ? null : packEntry(id, loaded);
  const edge = edges.get(`run.${id}`) ?? null;
  const attestation = fnaf1 ? null : attestationStatus(loaded.attestation, loaded.digest);
  return {
    id, valid: true, game, gameBasis: basis, kind: fnaf1 ? 'fnaf1-run' : 'device-campaign',
    outcome: fnaf1 ? loaded.pack.outcome?.ended ?? null : entry.outcome,
    claimLevel: fnaf1 ? loaded.pack.claimLevel ?? null : entry.claimLevel ?? null,
    nights: fnaf1 ? null : entry.nights ?? loaded.pack.nights ?? null,
    custody: packCustody(loaded.pack), packSha256: loaded.digest,
    attestedBy: attestation?.valid ? attestation.by : null,
    promoted: edge && edge.packSha256 === loaded.digest ? edge.from : null,
    files: loaded.files,
  };
}

/** Every committed pack, as readPackRow reads it. @param {string} root */
export function readPacks(root) {
  const edges = promotionEdges(root);
  return packDirectories(root).map(id => readPackRow(root, id, edges));
}

/** @param {any} value */
export const gameKey = value => (isUnknown(value) ? 'UNKNOWN' : value);

export { GRAPH_FILE, PACKS_DIR };
