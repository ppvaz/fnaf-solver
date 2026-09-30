// The solver interface's verbs and resources (Plan 28 steps 2-4; ADR 0002: "one verb table and
// one set of query functions" for every door -- the MCP server, the review CLI, and a later wiki
// or desk).
//
// Every answer is a claim-envelope-v1: a claim with its label, target, citations, status, what it
// does not measure and the command that reproduces it, or a refusal with its rule, reason,
// citation and remedy. Nothing here writes: `promote` proposes an edge or refuses, and never
// writes an attestation or an edge (Plan 28: "the moment proof.promote succeeds without a human,
// every label becomes worthless"). No verb takes a tap, a coordinate, a shell command or a
// rebuild. State is never written as prose (ADR 0002 principle 4): `describe` is a join over the
// registers registers.mjs reads, and each of Plan 28's four gaps is a query. `truth` (step 5) is
// Source's reading of the caller's own local dump (@sixam/source/truth): it ships the decoder, not
// the decoded data, and refuses, naming the decode, where no dump is configured.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_CATALOGS } from '@sixam/source';
import { NO_LOCAL_DUMP, VAULT_ENV, VAULT_FILE, createTruth } from '@sixam/source/truth';
import { canonicalJson } from '@sixam/kernel/contracts';
import { REPOSITORY_TARGET, claimEnvelope, isRefusal, isUnknown, refusalEnvelope, unknown, validateClaimEnvelope } from '@sixam/kernel';
import { videoTerminal } from './evidence-cohort.mjs';
import { ATTESTATION_FILE, PACKS_DIR, packPromotionChecks, readPack, trackedWinners } from './evidence-pack.mjs';
import { GRAPH_FILE, PROMOTION_EDGE, derivePromotion, readGraph, recordPromotion } from './evidence-promotion.mjs';
import { FNAF2, ONE_CLEAR, PLAN12, levelLabel, promotionsQueryEnvelope } from './envelopes.mjs';
import { liftPack } from './pack-lift.mjs';
import { queryPromotions } from './promotions-query.mjs';
import { CHECKS, RULE_CITES, checkUnknownAsNumber } from './refusals.mjs';
import { ARCHIVED_ROUTES, CHRONICLE_ATTRIBUTION, CHRONICLE_DIR, CHRONICLE_SCHEMA_MODULE, COMMAND_REGISTRY,
  CONTRACT_REGISTER, CONTROL_CATALOG_DIR, GAMES, controlCatalogFile, catalogUnknowns, chronicleLabel, gameKey, isNegative, packDirectories,
  readArchivedRoutes, readChronicle, readCommandRegistry, readContracts, readPackRow, readPacks, resolveGame } from './registers.mjs';

export const SURFACE_DOC = 'docs/device/COMPANION-MCP.md';
export const PLAN28 = 'plans/28-solver-interface.md';

/** The verbs, by the name every door calls them. */
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

const PACK_ID = /^[\w.-]+$/;
const shellQuote = text => `'${String(text).replaceAll("'", "'\\''")}'`;
const tally = (items, key) => items.reduce((counts, item) => {
  const value = key(item);
  counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}, /** @type {Record<string, number>} */ ({}));
const sorted = counts => Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));

/** A caller's argument refused: the rule, what was wrong, and what is accepted. */
const badArgument = (because, remedy) => refusalEnvelope({ rule: 'invalid-argument', because, cite: [SURFACE_DOC], remedy });
const gameRefusal = game => badArgument(`${JSON.stringify(game ?? null)} is not a registered game`,
  `name one of ${GAMES.map(item => `${item.alias} (${item.package})`).join(', ')}`);

/** One label for a list: the label every row shares, or UNKNOWN naming the mix. */
function sharedLabel(labels, what) {
  const keys = [...new Set(labels.map(label => (isUnknown(label) ? 'UNKNOWN' : label)))];
  if (keys.length === 1 && keys[0] !== 'UNKNOWN') return labels[0];
  if (!labels.length) return unknown(`no ${what} match, so there is no label to carry`);
  return unknown(`the ${what} carry ${keys.length > 1 ? `different labels (${keys.sort().join(', ')})` : 'UNKNOWN labels'}; each row carries its own`);
}

/** Stat fingerprint of the committed winners, to know when a cached compile is stale. */
function winnersKey(root) {
  const dir = join(root, 'tools', 'device');
  return readdirSync(dir).filter(name => name.endsWith('-winner.json')).sort()
    .map(name => { const stat = statSync(join(dir, name)); return `${name}:${stat.size}:${stat.mtimeMs}`; }).join('|');
}

/**
 * The surface over one checkout.
 * @param {{root: string, winners?: () => Map<string, string>, truth?: ReturnType<typeof createTruth>}} options `winners`
 *   overrides the committed-winner compile (tests pass a precomputed map); `truth` the local-dump reader
 */
export function createSolver({ root, winners: winnersOverride, truth: truthOverride }) {
  const truth = truthOverride ?? createTruth({ root });
  let cache = null;
  /** trackedWinners compiles every committed winner (~7 s); it is kept until a winner file changes. */
  const winners = () => {
    if (winnersOverride) return winnersOverride();
    const key = winnersKey(root);
    if (cache?.key !== key) cache = { key, winners: trackedWinners(root) };
    return cache.winners;
  };

  // --- describe ------------------------------------------------------------------------------

  /** Plan 28's four gaps, each as a query over the registers and this surface's own verb table. */
  function gaps(pkg, gamePacks, graphEdges) {
    const contracts = readContracts(root).contracts.map(item => item.id);
    const registered = contracts.includes('claim-envelope-v1');
    const registry = readCommandRegistry(root);
    const emitterIds = new Set(ENVELOPE_EMITTERS.map(command => command.split(' ')[2]));
    const custody = tally(gamePacks, pack => (pack.valid ? pack.custody.kind : 'invalid'));
    const complete = custody.original ?? 0;
    const local = truth.status(pkg);
    return [
      { gap: 1, name: 'The envelope is not shared',
        query: `claim-envelope-v1 in ${CONTRACT_REGISTER}; the commands of ${COMMAND_REGISTRY} this surface lists as emitters`,
        registered, emitters: ENVELOPE_EMITTERS,
        commandsWithoutEnvelope: registry.commands.filter(id => !emitterIds.has(id)).length, commands: registry.commands.length,
        holds: !registered ? true : 'partly' },
      { gap: 2, name: 'Truth has no programmatic surface',
        query: `a truth.* or rulebook verb in this surface's VERBS; this game's local dump in ${VAULT_FILE} or $${VAULT_ENV}`,
        verbs: VERBS, localDump: local.configured, holds: !VERBS.some(verb => verb === 'rulebook' || verb.startsWith('truth')),
        ...(local.configured ? {} : { notMeasured: [NO_LOCAL_DUMP] }) },
      { gap: 3, name: 'No coverage map', query: 'describe in this surface\'s VERBS', holds: !VERBS.includes('describe') },
      { gap: 4, name: 'Custody is incomplete and promotion is empty',
        query: `this game's packs in ${PACKS_DIR} by custody kind, and its ${PROMOTION_EDGE} edges in ${GRAPH_FILE}`,
        packs: gamePacks.length, custody: sorted(custody), promotionEdges: graphEdges,
        holds: gamePacks.length === 0 || graphEdges === 0 ? true : complete === gamePacks.length ? false : 'partly' },
    ];
  }

  /** @param {{game?: string}} args */
  function describe({ game } = {}) {
    const named = resolveGame(game);
    if (!named) return gameRefusal(game);
    const pkg = named.package;
    const catalog = CONTROL_CATALOGS[pkg];
    const notMeasured = [];

    // The control catalog (D5).
    const catalogUnknownFacts = catalogUnknowns(catalog);
    notMeasured.push(...catalogUnknownFacts.map(item => `control ${item.control} ${item.field}: ${item.value}`));
    const controls = {
      register: `${CONTROL_CATALOG_DIR} (${catalog.schema})`,
      label: unknown('control-catalog-v1 carries no evidence label per fact; each catalog names where its facts were read in sources'),
      count: catalog.controls.length, ids: catalog.controls.map(item => item.id), cameras: catalog.cameras.range,
      runsThroughCampaignExecutor: Boolean(catalog.artifactActions), sources: catalog.sources, unknownFacts: catalogUnknownFacts.length,
    };

    // The contract register: it has no game dimension; two contracts bind a game through its catalog.
    const register = readContracts(root);
    const scoped = [{ id: 'semantic-control-v1', basis: "validates this game's controls against its control catalog" },
      ...(catalog.artifactActions ? [{ id: 'device-executor-v1', basis: "validates artifact actions against this game's action table" }] : [])];
    const contracts = {
      register: CONTRACT_REGISTER, registered: register.contracts.length,
      gameScoped: scoped.map(item => ({ ...item, conformanceFixtures: register.contracts.find(contract => contract.id === item.id)?.conformanceFixtures })),
      others: unknown(`contract-register-v1 records no game dimension, so which of the other ${register.contracts.length - scoped.length} contracts bind this game is not registered`),
    };
    notMeasured.push(`which of the other ${register.contracts.length - scoped.length} registered contracts bind this game: the register has no game dimension`);

    // The chronicle: the entries attributed to this game (v2 names it; v1 is read as FNaF 2).
    const chronicle = readChronicle(root);
    let chronicleView;
    let refuted;
    const entries = chronicle.entries.filter(entry => entry.target === pkg);
    if (entries.length) {
      const newest = entries.map(entry => entry.date).sort().at(-1);
      const labelledUnknown = entries.filter(entry => entry.label === 'UNKNOWN');
      chronicleView = {
        register: CHRONICLE_DIR, attribution: CHRONICLE_ATTRIBUTION, entries: entries.length,
        checkpoints: [...new Set(entries.map(entry => entry.checkpoint))], newest,
        byLabel: sorted(tally(entries, entry => entry.label)), byKind: sorted(tally(entries, entry => entry.kind)),
        byStatus: sorted(tally(entries, entry => entry.status)),
        labelledUnknown: labelledUnknown.map(entry => ({ id: entry.id, label: chronicleLabel(entry) })),
      };
      notMeasured.push(`anything the chronicle holds for ${named.title} after ${newest}, its newest entry`,
        ...labelledUnknown.map(entry => `chronicle ${entry.id}: ${entry.title} (labelled UNKNOWN)`));
      refuted = entries.filter(isNegative).map(entry => ({ id: entry.id, date: entry.date, kind: entry.kind, status: entry.status,
        supersededBy: entry.supersededBy, label: chronicleLabel(entry), title: entry.title, sources: entry.sources }));
    } else {
      chronicleView = unknown(`${CHRONICLE_ATTRIBUTION}; none to ${pkg}`);
      refuted = unknown(`the chronicle attributes no entry to ${pkg}, and ${ARCHIVED_ROUTES} names routes, not games`);
      notMeasured.push(`what has been learned or refuted about ${named.title}: the chronicle attributes no entry to it`);
    }

    // Packs, promotions, and what the phone has confirmed.
    const packs = readPacks(root);
    const gamePacks = packs.filter(pack => gameKey(pack.game) === pkg);
    const invalid = packs.filter(pack => !pack.valid);
    if (invalid.length) notMeasured.push(...invalid.map(pack => `${pack.id}: ${pack.error}`));
    const graph = readGraph(root);
    const graphEdges = graph.edges.filter(edge => edge.type === PROMOTION_EDGE);
    const gameEdges = graphEdges.filter(edge => gamePacks.some(pack => `run.${pack.id}` === edge.to));
    const outcomes = tally(gamePacks.flatMap(pack => {
      try { return liftPack(root, pack.id).runs; } catch { return []; }
    }), run => run.reportedOutcome.kind);
    let phone;
    if (!gamePacks.length) {
      phone = unknown(`no run pack in ${PACKS_DIR} is attributed to ${pkg}`);
      notMeasured.push(`anything the phone has shown for ${named.title}: no run pack is attributed to it`);
    } else if (pkg === FNAF2) {
      const result = queryPromotions(root, { winners: winners() });
      const executorWins = gamePacks.filter(pack => pack.outcome === 'WIN');
      phone = {
        rule: `a ${PROMOTION_EDGE} edge in ${GRAPH_FILE} that re-derives from its pack, attestation and committed winner (Plan 12)`,
        label: 'DEVICE_MEASURED', consistent: result.consistent,
        promotedClaims: Object.entries(result.edges.byClaim).map(([claim, runs]) => ({ claim, runs })),
        promotedRuns: result.edges.matched, attestedBy: result.edges.byAttester, custodyOfPromoted: result.edges.byCustody,
        packs: gamePacks.length, reportedOutcomes: sorted(outcomes), executorWins: executorWins.length,
        executorWinsNotPromoted: executorWins.filter(pack => !pack.promoted).map(pack => pack.id),
        modelOnlyWinners: { label: result.open.modelOnlyWinners.claimLevel, files: result.open.modelOnlyWinners.winners.map(item => item.file),
          of: result.open.modelOnlyWinners.of },
        untrackedWinnerDebt: result.open.untrackedWinnerDebt.summary,
      };
      notMeasured.push(ONE_CLEAR,
        ...(result.consistent ? [] : [`which promotions stand: ${GRAPH_FILE} and the derivation from the packs disagree (npm run review -- query promotions)`]),
        ...phone.executorWinsNotPromoted.map(id => `${id}: an executor 6 AM without a promotion edge`),
        ...phone.modelOnlyWinners.files.map(file => `${file} on the phone: no run pack names it (MODEL_ONLY)`),
        ...result.open.untrackedWinnerDebt.entries.filter(item => !item.committed)
          .map(item => `a committed winner for the Night ${item.night ?? 'UNKNOWN'} anchor binding ${item.hash}`));
    } else {
      let gate;
      try { derivePromotion(root, gamePacks[0].id, new Map()); gate = null; } catch (error) { gate = error.message; }
      phone = {
        packs: gamePacks.length, reportedOutcomes: sorted(outcomes),
        claimLevels: sorted(tally(gamePacks, pack => pack.claimLevel ?? 'UNKNOWN')),
        promotion: unknown(gate ? `the promotion gate refuses this game's packs: ${gate}` : 'no pack of this game is promoted'),
      };
      notMeasured.push(`a promotion for ${named.title}: ${gate ?? 'none recorded'}`);
    }
    if ((outcomes.UNKNOWN ?? 0) > 0) notMeasured.push(`the reported outcome of ${outcomes.UNKNOWN} of this game's lifted runs`);

    const gapRows = gaps(pkg, gamePacks, gameEdges.length);
    notMeasured.push(...gapRows.filter(row => row.holds !== false).map(row => `Plan 28 gap ${row.gap} (${row.name}) holds${row.holds === true ? '' : ' partly'}`),
      ...gapRows.flatMap(row => row.notMeasured ?? []));

    return claimEnvelope({
      claim: {
        game: pkg, title: named.title, alias: named.alias,
        question: 'what the registers hold about this game, at what label, what the phone has confirmed, and what is UNKNOWN',
        controls, contracts, chronicle: chronicleView, phone, refuted, gaps: gapRows,
      },
      label: unknown('a coverage map joins registers of several labels; each section carries its own'),
      target: pkg,
      cite: [CONTROL_CATALOG_DIR, CONTRACT_REGISTER, CHRONICLE_DIR, CHRONICLE_SCHEMA_MODULE, PACKS_DIR, GRAPH_FILE, ARCHIVED_ROUTES, PLAN28],
      status: 'standing', supersededBy: null, notMeasured,
      reproducer: `npm run review -- describe ${named.alias}`,
    });
  }

  // --- query ---------------------------------------------------------------------------------

  const limitOf = limit => (Number.isInteger(limit) && limit > 0 ? limit : null);
  const matches = (text, fields) => !text || fields.some(field => String(field ?? '').toLowerCase().includes(text.toLowerCase()));
  const reproduce = (what, args) => ['npm run review -- query', what,
    ...Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== false)
      .map(([key, value]) => (value === true ? `--${key}` : `--${key} ${shellQuote(value)}`))].join(' ');

  function queryChronicle({ game, text, kind, negative, limit }) {
    const named = game === undefined ? null : resolveGame(game);
    if (game !== undefined && !named) return gameRefusal(game);
    const chronicle = readChronicle(root);
    const scoped = !named || chronicle.entries.some(entry => entry.target === named.package);
    const rows = chronicle.entries.filter(entry => (!named || entry.target === named.package) && (!kind || entry.kind === kind) &&
      (!negative || isNegative(entry)) && matches(text, [entry.id, entry.title, entry.body, entry.measured, ...entry.tags]));
    const shown = rows.slice(0, limitOf(limit) ?? rows.length).map(entry => ({ ...entry, label: chronicleLabel(entry), chronicleLabel: entry.label }));
    const notMeasured = [
      ...(named && !scoped ? [`${named.title}: ${CHRONICLE_ATTRIBUTION}; none to ${named.package}`] : []),
      ...(shown.length < rows.length ? [`${rows.length - shown.length} more matching entries beyond the limit`] : []),
      ...shown.filter(entry => isUnknown(entry.label)).map(entry => `${entry.id}: labelled UNKNOWN`),
      `anything after ${chronicle.entries.map(entry => entry.date).sort().at(-1)}, the chronicle's newest entry`,
    ];
    return claimEnvelope({
      claim: { query: 'chronicle', attribution: CHRONICLE_ATTRIBUTION, filters: { game: named?.package ?? null, text: text ?? null,
        kind: kind ?? null, negative: Boolean(negative) }, matched: rows.length, entries: shown },
      label: sharedLabel(shown.map(entry => entry.label), 'chronicle entries'),
      target: named?.package ?? REPOSITORY_TARGET, cite: [CHRONICLE_DIR, CHRONICLE_SCHEMA_MODULE],
      status: 'standing', supersededBy: null, notMeasured,
      reproducer: reproduce('chronicle', { game, text, kind, negative, limit }),
    });
  }

  function queryPacks({ game, text, limit }) {
    const named = game === undefined ? null : resolveGame(game);
    if (game !== undefined && !named) return gameRefusal(game);
    const rows = readPacks(root).filter(pack => (!named || gameKey(pack.game) === named.package) && matches(text, [pack.id]))
      .map(({ files, ...pack }) => ({ ...pack, label: pack.valid ? levelLabel(pack.claimLevel, `${pack.id}'s pack`) : unknown(`${pack.id} fails its integrity check`) }));
    const shown = rows.slice(0, limitOf(limit) ?? rows.length);
    return claimEnvelope({
      claim: { query: 'packs', filters: { game: named?.package ?? null, text: text ?? null }, matched: rows.length,
        byGame: sorted(tally(rows, pack => gameKey(pack.game))), byOutcome: sorted(tally(rows, pack => String(pack.outcome))),
        byCustody: sorted(tally(rows, pack => pack.custody?.kind ?? 'invalid')), promoted: rows.filter(pack => pack.promoted).length,
        packs: shown },
      label: sharedLabel(shown.map(pack => pack.label), 'packs'),
      target: named?.package ?? REPOSITORY_TARGET, cite: [PACKS_DIR, GRAPH_FILE],
      status: 'standing', supersededBy: null,
      notMeasured: [
        ...(shown.length < rows.length ? [`${rows.length - shown.length} more matching packs beyond the limit`] : []),
        ...shown.filter(pack => pack.custody?.lost?.length).map(pack => `${pack.id}: lost ${pack.custody.lost.join(', ')}`),
        ...shown.filter(pack => !pack.valid || isUnknown(pack.game)).map(pack => `${pack.id}: ${pack.error ?? 'its game'}`),
      ],
      reproducer: reproduce('packs', { game, text, limit }),
    });
  }

  function queryContracts({ text, limit }) {
    const register = readContracts(root);
    const rows = register.contracts.filter(item => matches(text, [item.id, item.owner, item.kind, item.validator]));
    const shown = rows.slice(0, limitOf(limit) ?? rows.length);
    return claimEnvelope({
      claim: { query: 'contracts', register: CONTRACT_REGISTER, schema: register.schema, filters: { text: text ?? null },
        matched: rows.length, contracts: shown },
      label: unknown('the contract register is a repository record: it states what each boundary validates, not a measurement of a game'),
      target: REPOSITORY_TARGET, cite: [CONTRACT_REGISTER, 'docs/architecture/generated/contract-specifications.json'],
      status: 'standing', supersededBy: null,
      notMeasured: ['whether a validator is exercised on a phone: its conformance fixtures run on the host',
        ...(shown.length < rows.length ? [`${rows.length - shown.length} more matching contracts beyond the limit`] : [])],
      reproducer: reproduce('contracts', { text, limit }),
    });
  }

  /** @param {{what?: string, game?: string, text?: string, kind?: string, negative?: boolean, limit?: number}} args */
  function query(args = {}) {
    const { what } = args;
    if (what === 'promotions') return promotionsQueryEnvelope(queryPromotions(root, { winners: winners() }));
    if (what === 'chronicle') return queryChronicle(args);
    if (what === 'packs') return queryPacks(args);
    if (what === 'contracts') return queryContracts(args);
    return badArgument(`${JSON.stringify(what ?? null)} is not a query`, `name one of ${QUERIES.join(', ')}`);
  }

  // --- review: read-only instruments over one pack --------------------------------------------

  /** @param {string} id */
  function loadPack(id) {
    if (typeof id !== 'string' || !PACK_ID.test(id) || id.startsWith('.')) return { refusal: badArgument('a pack id is letters, digits, dots, dashes and underscores', 'name a directory under docs/evidence/runs') };
    if (!packDirectories(root).includes(id)) return { refusal: badArgument(`no committed pack is named ${id}`, 'query packs lists them') };
    const row = readPackRow(root, id);
    if (!row.valid) return { refusal: refusalEnvelope({ rule: 'pack-integrity', because: `${id} fails its integrity check: ${row.error}`,
      cite: [`${PACKS_DIR}/${id}/pack.json`], remedy: 'a pack whose files no longer match their sha256 is not read; restore it from git' }) };
    return { row, lifted: liftPack(root, id), dir: join(root, PACKS_DIR, id) };
  }

  /** @param {{pack?: string, instrument?: string}} args */
  function review({ pack, instrument } = {}) {
    if (!INSTRUMENTS.includes(/** @type {string} */ (instrument)))
      return badArgument(`${JSON.stringify(instrument ?? null)} is not an instrument`, `name one of ${INSTRUMENTS.join(', ')}`);
    const loaded = loadPack(/** @type {string} */ (pack));
    if (loaded.refusal) return loaded.refusal;
    const { row, lifted, dir } = loaded;
    const where = `${PACKS_DIR}/${row.id}`;
    const label = levelLabel(row.claimLevel, `${row.id}'s pack`);
    const target = row.game;
    const base = { instrument, pack: row.id, game: row.game, gameBasis: row.gameBasis };
    const envelope = (claim, notMeasured, cite = [`${where}/pack.json`]) => claimEnvelope({
      claim: { ...base, ...claim }, label, target, cite, status: 'standing', supersededBy: null, notMeasured,
      reproducer: `npm run review -- review ${row.id} ${instrument}`,
    });
    const lostNotes = row.custody.lost.map(name => `${name}: lost with this pack's custody (${row.custody.kind})`);

    if (instrument === 'custody')
      return envelope({
        packSha256: row.packSha256, custody: row.custody,
        runs: lifted.runs.map(run => ({ id: run.id, custody: run.custody, witnesses: run.witnesses.length,
          witnessKinds: sorted(tally(run.witnesses, witness => witness.kind)) })),
      }, lostNotes);

    if (instrument === 'outcome') {
      const video = videoTerminal(dir, row.files);
      return envelope({
        rule: 'venues report outcomes; review decides them (ADR 0002 principle 3): this reads the venue\'s report and, beside it, a video grade the pack carries',
        packOutcome: row.outcome, nights: row.nights,
        reported: lifted.runs.map(run => ({ id: run.id, reportedOutcome: run.reportedOutcome, runMode: run.runMode })),
        videoGrade: video ?? unknown('the pack carries no video grade (run/grade.log TERMINAL line or run/timeline.json)'),
      }, [...lostNotes, ...(video ? [] : ['the decided outcome: no video grade in the pack, so only the venue\'s report is read']),
        ...lifted.runs.filter(run => isUnknown(run.reportedOutcome)).map(run => `${run.id}: its reported outcome (${run.reportedOutcome.reason})`)],
      [`${where}/pack.json`, ...(video ? [`${where}/${video.source}`] : [])]);
    }

    if (instrument === 'promotion-checks') {
      let derived;
      try { derived = derivePromotion(root, row.id, winners()); } catch (error) {
        return envelope({ checks: unknown(`derivePromotion refuses this pack: ${error.message}`) },
          [`the Plan 12 checks: ${error.message}`], [`${where}/pack.json`, PLAN12]);
      }
      const packed = readPack(dir);
      const checks = packPromotionChecks(packed, winners());
      return envelope({
        checks, derived: derived.verified.map(item => ({ check: item.check, pass: item.pass, ...(item.pass ? {} : { failed: item.detail.failed }) })),
        claim: derived.claim, custody: derived.custody, promoted: row.promoted,
      }, [...lostNotes, ...Object.entries(checks).filter(([, pass]) => !pass).map(([check]) => `${check}: fails`),
        ...(row.promoted ? [ONE_CLEAR] : ['promotion: no PROMOTED_BY edge binds this pack'])],
      [`${where}/pack.json`, PLAN12, ...(packed.attestation ? [`${where}/${ATTESTATION_FILE}`] : [])]);
    }

    // death-time: a number, so every operand must be one.
    const deaths = lifted.runs.filter(run => run.reportedOutcome.kind === 'Death');
    if (!deaths.length)
      return envelope({ deaths: [], reported: lifted.runs.map(run => ({ id: run.id, reportedOutcome: run.reportedOutcome.kind })) },
        ['a death time: no run in this pack reports a death']);
    for (const run of deaths) {
      const { at } = run.reportedOutcome;
      const numbers = checkUnknownAsNumber(isUnknown(at) ? { 'Death.at': at } : { 'Death.at.lo': at.lo, 'Death.at.hi': at.hi },
        { operation: `the death time of ${run.id}` });
      if (numbers.refused) {
        const video = videoTerminal(dir, row.files);
        return refusalEnvelope({ ...numbers, cite: [...numbers.cite, `${where}/pack.json`],
          remedy: `${numbers.remedy}. Review decides a death's time from an independent witness${video
            ? ` (this pack's ${video.source} reads ${video.outcome}${video.detail ? ` -- ${video.detail}` : ''}; its clock is the recording's, not the night's origin)`
            : ' (a graded video: tools/device/grade-run.sh)'}` });
      }
    }
    return envelope({ deaths: deaths.map(run => ({ id: run.id, at: run.reportedOutcome.at, unit: 'ms from the night origin' })) }, lostNotes);
  }

  // --- promote: a proposal or a refusal, never a write -----------------------------------------

  /** @param {{pack?: string}} args */
  function promote({ pack } = {}) {
    const loaded = loadPack(/** @type {string} */ (pack));
    if (loaded.refusal) return loaded.refusal;
    const { row, dir } = loaded;
    const where = `${PACKS_DIR}/${row.id}`;
    const cite = [`${where}/pack.json`, PLAN12, GRAPH_FILE];
    let derived;
    try { derived = derivePromotion(root, row.id, winners()); } catch (error) {
      return refusalEnvelope({ rule: 'plan12-promotion', because: `${row.id} cannot be promoted: ${error.message}`, cite,
        remedy: 'no promotion gate reads this kind of run; a gate for it is new work, not a promotion' });
    }
    const packed = readPack(dir);
    const checks = { ...packPromotionChecks(packed, winners()),
      claimIdentity: derived.verified.find(item => item.check === 'claimIdentity')?.pass ?? false };
    const failing = Object.entries(checks).filter(([, pass]) => !pass).map(([check]) => check);
    if (failing.length) {
      const onlyAttestation = failing.length === 1 && failing[0] === 'plan12Attestation';
      const details = derived.verified.filter(item => !item.pass).flatMap(item => (item.detail.failed ?? []).map(reason => `${item.check}: ${reason}`));
      return refusalEnvelope({ rule: 'plan12-promotion',
        because: `Plan 12 refuses ${row.id}: ${failing.join(', ')} ${failing.length === 1 ? 'fails' : 'fail'}${details.length ? ` (${details.slice(0, 4).join('; ')})` : ''}`,
        cite: [...cite, ...(packed.attestation ? [`${where}/${ATTESTATION_FILE}`] : [])],
        remedy: onlyAttestation
          ? 'an attestation is written by a person, or by this repository\'s agents under Pedro\'s 2026-09-27 delegation through ' +
            '`npm run evidence -- attest`, which re-derives every check; this interface never writes one'
          : 'the failing checks are properties of the run and its custody; no call of this interface can change them' });
    }
    const graph = readGraph(root);
    const { edge } = recordPromotion({ schema: 'claim-evidence-v1', version: 1, nodes: [], edges: [] },
      { id: row.id, claim: derived.claim, digest: packed.digest, attestation: packed.attestation, custody: derived.custody,
        nights: packed.pack.nights ?? [] });
    const recorded = graph.edges.find(item => item.type === PROMOTION_EDGE && item.to === edge.to) ?? null;
    return claimEnvelope({
      claim: { proposal: PROMOTION_EDGE, pack: row.id, edge, checks,
        inGraph: !recorded ? 'NOT_RECORDED' : canonicalJson(recorded) === canonicalJson(edge) ? 'ALREADY_RECORDED' : 'DIFFERS',
        approval: 'this interface proposes an edge and never writes an attestation or an edge (Plan 28); recording one is ' +
          '`npm run evidence -- promote`, over an attestation a person or the delegated agents wrote' },
      label: 'DEVICE_MEASURED', target: FNAF2,
      cite: [...cite, `${where}/${ATTESTATION_FILE}`], status: 'standing', supersededBy: null,
      notMeasured: [ONE_CLEAR, ...derived.custody.lost.map(name => `${name}: lost with this pack's custody (${derived.custody.kind})`)],
      reproducer: `npm run review -- promote ${row.id}`,
    });
  }

  // --- check: the refusals, on a statement a caller is about to make ---------------------------

  /** @param {{rule?: string, [key: string]: any}} args */
  function check(args = {}) {
    const { rule, ...input } = args;
    if (!Object.hasOwn(CHECKS, /** @type {string} */ (rule)))
      return badArgument(`${JSON.stringify(rule ?? null)} is not a refusal rule`, `name one of ${Object.keys(CHECKS).join(', ')}`);
    const result = CHECKS[/** @type {keyof typeof CHECKS} */ (rule)](input);
    if (isRefusal(result)) return result;
    const subject = rule === 'seed-floor' ? { seeds: input.seeds, wins: input.wins ?? null, heldOut: input.heldOut ?? null }
      : rule === 'directional-reuse' ? { constant: input.constant, use: input.use }
        : rule === 'capabilities-first' ? { instrument: input.instrument, capabilitiesRecordedAt: input.capabilities?.recordedAt ?? null }
          : { operation: input.operation ?? null, operands: Object.keys(input.operands ?? {}) };
    const target = resolveGame(input.game)?.package ?? REPOSITORY_TARGET;
    return claimEnvelope({
      claim: { rule, passed: true, subject },
      label: unknown('passing a refusal rule measures nothing: the statement it guarded stands or falls on its own evidence'),
      target, cite: [...RULE_CITES[/** @type {keyof typeof RULE_CITES} */ (rule)]], status: 'standing', supersededBy: null,
      notMeasured: [...result.notMeasured, 'the statement itself: a rule check is not evidence for it'],
      reproducer: `npm run review -- check ${rule} ${shellQuote(JSON.stringify(input))}`,
    });
  }

  // --- truth: the game's own event sheet, from the caller's local dump -------------------------

  /** @param {{op?: string, [key: string]: any}} args decode {path, game} | events {game, query} | object {game, name | handle} */
  const truthVerb = (args = {}) => truth.call(args);

  // --- resources -----------------------------------------------------------------------------

  /** @param {string} uri */
  function readResource(uri) {
    if (String(uri ?? '').startsWith('fnaf://truth/')) return truth.readUri(uri);
    if (uri === 'fnaf://chronicle') {
      const chronicle = readChronicle(root);
      return claimEnvelope({
        claim: { attribution: CHRONICLE_ATTRIBUTION, checkpoints: chronicle.checkpoints.map(({ entries, ...checkpoint }) => ({ ...checkpoint,
          entries: entries.map(entry => ({ ...entry, label: chronicleLabel(entry), chronicleLabel: entry.label })) })) },
        label: sharedLabel(chronicle.entries.map(chronicleLabel), 'chronicle entries'), target: REPOSITORY_TARGET,
        cite: [CHRONICLE_DIR, CHRONICLE_SCHEMA_MODULE], status: 'standing', supersededBy: null,
        notMeasured: [`anything after ${chronicle.entries.map(entry => entry.date).sort().at(-1)}, the chronicle's newest entry`,
          ...chronicle.entries.filter(entry => entry.label === 'UNKNOWN').map(entry => `${entry.id}: labelled UNKNOWN`),
          'each checkpoint outlook is its own date\'s view, not the current state'],
        reproducer: 'npm run review -- resource fnaf://chronicle',
      });
    }
    if (uri === 'fnaf://evidence/graph') {
      const graph = readGraph(root);
      return claimEnvelope({
        claim: graph, label: sharedLabel(graph.nodes.filter(node => node.kind === 'Claim').map(node => levelLabel(node.claimLevel, node.id)), 'claim nodes'),
        target: REPOSITORY_TARGET, cite: [GRAPH_FILE], status: 'standing', supersededBy: null,
        notMeasured: [ONE_CLEAR, 'whether each edge still re-derives from its pack: npm run review -- query promotions checks that'],
        reproducer: 'npm run review -- resource fnaf://evidence/graph',
      });
    }
    if (uri === 'fnaf://contracts') return { ...queryContracts({}), reproducer: 'npm run review -- resource fnaf://contracts' };
    if (uri === 'fnaf://refuted') {
      const chronicle = readChronicle(root);
      const negatives = chronicle.entries.filter(isNegative).map(entry => ({ id: entry.id, date: entry.date, game: entry.target,
        kind: entry.kind, status: entry.status, supersededBy: entry.supersededBy, label: chronicleLabel(entry), title: entry.title,
        body: entry.body, sources: entry.sources }));
      const archived = readArchivedRoutes(root);
      return claimEnvelope({
        claim: { rule: `chronicle entries of kind ${['refutation', 'retraction', 'negative'].join(', ')} or not standing; and the rows of ` +
          `${ARCHIVED_ROUTES} "${archived.heading ?? 'Archived routes'}", parked unless a row says refuted`,
        attribution: CHRONICLE_ATTRIBUTION, chronicle: negatives, archivedRoutes: archived.routes },
        label: sharedLabel(negatives.map(entry => entry.label), 'negative results'), target: REPOSITORY_TARGET,
        cite: [CHRONICLE_DIR, ARCHIVED_ROUTES], status: 'standing', supersededBy: null,
        notMeasured: [`anything refuted after ${chronicle.entries.map(entry => entry.date).sort().at(-1)}, the chronicle's newest entry`,
          ...negatives.filter(entry => isUnknown(entry.label)).map(entry => `${entry.id}: labelled UNKNOWN`)],
        reproducer: 'npm run review -- resource fnaf://refuted',
      });
    }
    const controls = /^fnaf:\/\/game\/([^/]+)\/controls$/.exec(uri ?? '');
    if (controls) {
      const game = resolveGame(controls[1]);
      if (!game) return gameRefusal(controls[1]);
      const catalog = CONTROL_CATALOGS[game.package];
      const unknowns = catalogUnknowns(catalog);
      return claimEnvelope({
        claim: catalog, label: unknown('control-catalog-v1 carries no evidence label per fact; each catalog names where its facts were read in sources'),
        target: game.package, cite: [controlCatalogFile(game.alias), 'docs/architecture/generated/control-catalog.json'],
        status: 'standing', supersededBy: null,
        notMeasured: unknowns.length ? unknowns.map(item => `control ${item.control} ${item.field}: ${item.value}`)
          : ['nothing the catalog writes as UNKNOWN'],
        reproducer: `npm run review -- resource fnaf://game/${game.package}/controls`,
      });
    }
    return null;
  }

  const listResources = () => [...RESOURCES, ...GAMES.map(game => ({ uri: `fnaf://game/${game.package}/controls`,
    name: `${game.title} controls`, description: `${game.title}'s control-catalog-v1.` }))];

  /** Every answer is checked against claim-envelope-v1 on its way out. */
  const checked = fn => (...args) => validateClaimEnvelope(fn(...args));
  return {
    describe: checked(describe), query: checked(query), review: checked(review), promote: checked(promote), check: checked(check),
    truth: checked(truthVerb),
    /** @param {string} uri */
    readResource: uri => { const value = readResource(uri); return value === null ? null : validateClaimEnvelope(value); },
    listResources, resourceTemplates: () => [...RESOURCE_TEMPLATES],
    /** The committed-winner compile this surface caches, for another door on the same checkout (the lab). */
    winners,
  };
}

