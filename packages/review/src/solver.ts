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
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { controlCatalogFor } from '@sixam/source';
import { createTruth } from '@sixam/source/truth';
import { canonicalJson } from '@sixam/kernel/contracts';
import { REPOSITORY_TARGET, claimEnvelope, isRecord, isRefusal, isUnknown, refusalEnvelope, unknown, validateClaimEnvelope } from '@sixam/kernel';
import { videoTerminal } from './evidence-cohort.ts';
import { ATTESTATION_FILE, PACKS_DIR, packIds, packPromotionChecks, readPack, trackedWinners, winnerFiles } from './evidence-pack.ts';
import { sortedCounts as sorted, tally } from './counts.ts';
import { GRAPH_FILE, PROMOTION_EDGE, derivePromotion, fnaf1PromotionChecks, readGraph, recordPromotion } from './evidence-promotion.ts';
import { ONE_CLEAR, PLAN12, levelLabel, promotionsQueryEnvelope } from './envelopes.ts';
import { liftPack } from './pack-lift.ts';
import { queryPromotions } from './promotions-query.ts';
import { CHECKS, RULE_CITES, checkUnknownAsNumber } from './refusals.ts';
import { describe } from './solver-describe.ts';
import { ENVELOPE_EMITTERS, INSTRUMENTS, PACK_ID, PLAN28, QUERIES, RESOURCES, RESOURCE_TEMPLATES, SURFACE_DOC, VERBS, badArgument,
  gameRefusal, shellQuote, sharedLabel } from './solver-shared.ts';
import type { PackRow, SolverContext, ValidPackRow } from './solver-shared.ts';
import { ARCHIVED_ROUTES, CHRONICLE_ATTRIBUTION, CHRONICLE_DIR, CHRONICLE_SCHEMA_MODULE, CONTRACT_REGISTER, GAMES,
  controlCatalogFile, catalogUnknowns, chronicleLabel, gameKey, isNegative, readArchivedRoutes, readChronicle, readContracts,
  readPackRow, readPacks, resolveGame } from './registers.ts';

export { ENVELOPE_EMITTERS, INSTRUMENTS, PLAN28, QUERIES, RESOURCES, RESOURCE_TEMPLATES, SURFACE_DOC, VERBS };

/** Stat fingerprint of the committed winners, to know when a cached compile is stale. */
function winnersKey(root: string) {
  return winnerFiles(root)
    .map(file => { const stat = statSync(join(root, file)); return `${file}:${stat.size}:${stat.mtimeMs}`; }).join('|');
}

/**
 * The surface over one checkout.
 * @param options `winners`
 * overrides the committed-winner compile (tests pass a precomputed map); `truth` the local-dump reader
 */
export function createSolver({ root, winners: winnersOverride, truth: truthOverride }: {root: string, winners?: () => Map<string, string>, truth?: ReturnType<typeof createTruth>}) {
  const truth = truthOverride ?? createTruth({ root });
  let cache: { key: string, winners: Map<string, string> } | null = null;
  /** trackedWinners compiles every committed winner (~7 s); it is kept until a winner file changes. */
  const winners = () => {
    if (winnersOverride) return winnersOverride();
    const key = winnersKey(root);
    if (cache?.key !== key) cache = { key, winners: trackedWinners(root) };
    return cache.winners;
  };
  const context: SolverContext = { root, truth, winners };

  // --- query ---------------------------------------------------------------------------------

  const limitOf = (limit: unknown) => (typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : null);
  const matches = (text: string | undefined, fields: readonly unknown[]) =>
    !text || fields.some(field => String(field ?? '').toLowerCase().includes(text.toLowerCase()));
  const reproduce = (what: string, args: Readonly<Record<string, unknown>>) => ['npm run review -- query', what,
    ...Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== false)
      .map(([key, value]) => (value === true ? `--${key}` : `--${key} ${shellQuote(value)}`))].join(' ');

  function queryChronicle({ game, text, kind, negative, limit }: { game?: string, text?: string, kind?: string, negative?: boolean, limit?: number }) {
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

  function queryPacks({ game, text, limit }: { game?: string, text?: string, limit?: number }) {
    const named = game === undefined ? null : resolveGame(game);
    if (game !== undefined && !named) return gameRefusal(game);
    // A row without its file list: a valid row drops it, an invalid one never had one.
    const withoutFiles = (row: PackRow) => (row.valid ? (({ files: _files, ...pack }) => pack)(row) : row);
    const rows = readPacks(root).filter(pack => (!named || gameKey(pack.game) === named.package) && matches(text, [pack.id]))
      .map(withoutFiles)
      .map(pack => ({ ...pack, label: pack.valid ? levelLabel(pack.claimLevel, `${pack.id}'s pack`) : unknown(`${pack.id} fails its integrity check`) }));
    const shown = rows.slice(0, limitOf(limit) ?? rows.length);
    return claimEnvelope({
      claim: { query: 'packs', filters: { game: named?.package ?? null, text: text ?? null }, matched: rows.length,
        byGame: sorted(tally(rows, pack => gameKey(pack.game))), byOutcome: sorted(tally(rows, pack => String(pack.outcome))),
        byCustody: sorted(tally(rows, pack => (pack.valid ? pack.custody.kind : 'invalid'))), promoted: rows.filter(pack => pack.valid && pack.promoted).length,
        packs: shown },
      label: sharedLabel(shown.map(pack => pack.label), 'packs'),
      target: named?.package ?? REPOSITORY_TARGET, cite: [PACKS_DIR, GRAPH_FILE],
      status: 'standing', supersededBy: null,
      notMeasured: [
        ...(shown.length < rows.length ? [`${rows.length - shown.length} more matching packs beyond the limit`] : []),
        ...shown.flatMap(pack => (pack.valid && pack.custody.lost.length ? [`${pack.id}: lost ${pack.custody.lost.join(', ')}`] : [])),
        ...shown.filter(pack => !pack.valid || isUnknown(pack.game)).map(pack => `${pack.id}: ${(pack.valid ? undefined : pack.error) ?? 'its game'}`),
      ],
      reproducer: reproduce('packs', { game, text, limit }),
    });
  }

  function queryContracts({ text, limit }: { text?: string, limit?: number }) {
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

  function query(args: {what?: string, game?: string, text?: string, kind?: string, negative?: boolean, limit?: number} = {}) {
    const { what } = args;
    if (what === 'promotions') return promotionsQueryEnvelope(queryPromotions(root, { winners: winners() }));
    if (what === 'chronicle') return queryChronicle(args);
    if (what === 'packs') return queryPacks(args);
    if (what === 'contracts') return queryContracts(args);
    return badArgument(`${JSON.stringify(what ?? null)} is not a query`, `name one of ${QUERIES.join(', ')}`);
  }

  // --- review: read-only instruments over one pack --------------------------------------------

  function loadPack(id: string): { refusal: ReturnType<typeof refusalEnvelope> }
    | { row: ValidPackRow, lifted: ReturnType<typeof liftPack>, dir: string } {
    if (typeof id !== 'string' || !PACK_ID.test(id) || id.startsWith('.')) return { refusal: badArgument('a pack id is letters, digits, dots, dashes and underscores', 'name a directory under docs/evidence/runs') };
    if (!packIds(root).includes(id)) return { refusal: badArgument(`no committed pack is named ${id}`, 'query packs lists them') };
    const row = readPackRow(root, id);
    if (!row.valid) return { refusal: refusalEnvelope({ rule: 'pack-integrity', because: `${id} fails its integrity check: ${row.error}`,
      cite: [`${PACKS_DIR}/${id}/pack.json`], remedy: 'a pack whose files no longer match their sha256 is not read; restore it from git' }) };
    return { row, lifted: liftPack(root, id), dir: join(root, PACKS_DIR, id) };
  }

  function review({ pack, instrument }: {pack?: string, instrument?: string} = {}) {
    if (!INSTRUMENTS.includes((instrument as string)))
      return badArgument(`${JSON.stringify(instrument ?? null)} is not an instrument`, `name one of ${INSTRUMENTS.join(', ')}`);
    const loaded = loadPack((pack as string));
    if ('refusal' in loaded) return loaded.refusal;
    const { row, lifted, dir } = loaded;
    const where = `${PACKS_DIR}/${row.id}`;
    const label = levelLabel(row.claimLevel, `${row.id}'s pack`);
    const target = row.game;
    const base = { instrument, pack: row.id, game: row.game, gameBasis: row.gameBasis };
    const envelope = (claim: Readonly<Record<string, unknown>>, notMeasured: string[], cite = [`${where}/pack.json`]) => claimEnvelope({
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
        ...lifted.runs.flatMap(run => (isUnknown(run.reportedOutcome) ? [`${run.id}: its reported outcome (${run.reportedOutcome.reason})`] : []))],
      [`${where}/pack.json`, ...(video ? [`${where}/${video.source}`] : [])]);
    }

    if (instrument === 'promotion-checks') {
      let derived;
      try { derived = derivePromotion(root, row.id, winners()); } catch (error) {
        const message = (error as Error).message;
        return envelope({ checks: unknown(`derivePromotion refuses this pack: ${message}`) },
          [`the Plan 12 checks: ${message}`], [`${where}/pack.json`, PLAN12]);
      }
      const packed = readPack(dir);
      const checks = promotionChecks(packed, row.id);
      return envelope({
        checks, derived: derived.verified.map(item => ({ check: item.check, pass: item.pass, ...(item.pass ? {} : { failed: item.detail.failed }) })),
        claim: derived.claim, custody: derived.custody, promoted: row.promoted,
      }, [...lostNotes, ...Object.entries(checks).filter(([, pass]) => !pass).map(([check]) => `${check}: fails`),
        ...(row.promoted ? [ONE_CLEAR] : ['promotion: no PROMOTED_BY edge binds this pack'])],
      [`${where}/pack.json`, PLAN12, ...(packed.attestation ? [`${where}/${ATTESTATION_FILE}`] : [])]);
    }

    // death-time: a number, so every operand must be one.
    const deaths = lifted.runs.flatMap(run => {
      const outcome = run.reportedOutcome;
      return outcome.kind === 'Death' ? [{ id: run.id, at: outcome.at }] : [];
    });
    if (!deaths.length)
      return envelope({ deaths: [], reported: lifted.runs.map(run => ({ id: run.id, reportedOutcome: run.reportedOutcome.kind })) },
        ['a death time: no run in this pack reports a death']);
    for (const run of deaths) {
      const { at } = run;
      const numbers = checkUnknownAsNumber(isUnknown(at) ? { 'Death.at': at } : { 'Death.at.lo': at.lo, 'Death.at.hi': at.hi },
        { operation: `the death time of ${run.id}` });
      if (numbers.refused) {
        const video = videoTerminal(dir, row.files);
        return refusalEnvelope({ ...numbers, cite: [...numbers.cite, `${where}/pack.json`],
          remedy: `${numbers.remedy}. Review decides a death's time from an independent witness${video
            ? ` (this pack's ${video.source} reads ${video.outcome}${video.detail ? ` -- ${video.detail}` : ''}; its clock is the recording's, not the night's origin)`
            : ' (a graded video: packages/review/bin/grade/grade-run.sh)'}` });
      }
    }
    return envelope({ deaths: deaths.map(run => ({ id: run.id, at: run.at, unit: 'ms from the night origin' })) }, lostNotes);
  }

  // Plan 12's checks for a pack: the campaign's for FNaF 2, fnaf1-promotion.ts's reading of a FNaF 1 runner pack.
  const promotionChecks = (packed: ReturnType<typeof readPack>, id: string) => (packed.pack.kind === 'fnaf1-run' ? fnaf1PromotionChecks(root, id, packed) : packPromotionChecks(packed, winners()));

  // --- promote: a proposal or a refusal, never a write -----------------------------------------

  function promote({ pack }: {pack?: string} = {}) {
    const loaded = loadPack((pack as string));
    if ('refusal' in loaded) return loaded.refusal;
    const { row, dir } = loaded;
    const where = `${PACKS_DIR}/${row.id}`;
    const cite = [`${where}/pack.json`, PLAN12, GRAPH_FILE];
    let derived;
    try { derived = derivePromotion(root, row.id, winners()); } catch (error) {
      return refusalEnvelope({ rule: 'plan12-promotion', because: `${row.id} cannot be promoted: ${(error as Error).message}`, cite,
        remedy: 'no promotion gate reads this kind of run; a gate for it is new work, not a promotion' });
    }
    const packed = readPack(dir);
    const checks = { ...promotionChecks(packed, row.id),
      claimIdentity: derived.verified.find(item => item.check === 'claimIdentity')?.pass ?? false };
    const failing = Object.entries(checks).filter(([, pass]) => !pass).map(([check]) => check);
    if (failing.length) {
      const onlyAttestation = failing.length === 1 && failing[0] === 'plan12Attestation';
      const details = derived.verified.filter(item => !item.pass)
        .flatMap(item => ((item.detail.failed ?? []) as readonly string[]).map(reason => `${item.check}: ${reason}`));
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
      // claimIdentity passed, so a claim was derived.
      { id: row.id, claim: derived.claim as NonNullable<typeof derived.claim>, digest: packed.digest, attestation: packed.attestation, custody: derived.custody,
        nights: packed.pack.nights ?? [] });
    const recorded = graph.edges.find(item => item.type === PROMOTION_EDGE && item.to === edge.to) ?? null;
    return claimEnvelope({
      claim: { proposal: PROMOTION_EDGE, pack: row.id, edge, checks,
        inGraph: !recorded ? 'NOT_RECORDED' : canonicalJson(recorded) === canonicalJson(edge) ? 'ALREADY_RECORDED' : 'DIFFERS',
        approval: 'this interface proposes an edge and never writes an attestation or an edge (Plan 28); recording one is ' +
          '`npm run evidence -- promote`, over an attestation a person or the delegated agents wrote' },
      label: 'DEVICE_MEASURED', target: row.game,
      cite: [...cite, `${where}/${ATTESTATION_FILE}`], status: 'standing', supersededBy: null,
      notMeasured: [ONE_CLEAR, ...derived.custody.lost.map(name => `${name}: lost with this pack's custody (${derived.custody.kind})`)],
      reproducer: `npm run review -- promote ${row.id}`,
    });
  }

  // --- check: the refusals, on a statement a caller is about to make ---------------------------

  function check(args: {rule?: string, [key: string]: unknown} = {}) {
    const { rule, ...input } = args;
    if (!Object.hasOwn(CHECKS, (rule as string)))
      return badArgument(`${JSON.stringify(rule ?? null)} is not a refusal rule`, `name one of ${Object.keys(CHECKS).join(', ')}`);
    const result = CHECKS[(rule as keyof typeof CHECKS)](input);
    if (isRefusal(result)) return result;
    const subject = rule === 'seed-floor' ? { seeds: input.seeds, wins: input.wins ?? null, heldOut: input.heldOut ?? null }
      : rule === 'directional-reuse' ? { constant: input.constant, use: input.use }
        : rule === 'capabilities-first' ? { instrument: input.instrument,
          capabilitiesRecordedAt: (isRecord(input.capabilities) ? input.capabilities.recordedAt : undefined) ?? null }
          // The check refused any operands that are not a non-empty record.
          : { operation: input.operation ?? null, operands: Object.keys(input.operands as object) };
    const target = resolveGame(input.game)?.package ?? REPOSITORY_TARGET;
    return claimEnvelope({
      claim: { rule, passed: true, subject },
      label: unknown('passing a refusal rule measures nothing: the statement it guarded stands or falls on its own evidence'),
      target, cite: [...RULE_CITES[(rule as keyof typeof RULE_CITES)]], status: 'standing', supersededBy: null,
      notMeasured: [...result.notMeasured, 'the statement itself: a rule check is not evidence for it'],
      reproducer: `npm run review -- check ${rule} ${shellQuote(JSON.stringify(input))}`,
    });
  }

  // --- truth: the game's own event sheet, from the caller's local dump -------------------------

  /** @param args decode {path, game} | events {game, query} | object {game, name | handle} */
  const truthVerb = (args: {op?: string, [key: string]: unknown} = {}) => truth.call(args);

  // --- resources -----------------------------------------------------------------------------

  function readResource(uri: string) {
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
        claim: graph, label: sharedLabel(graph.nodes.filter(node => node.kind === 'Claim').map(node => levelLabel(node.claimLevel, String(node.id))), 'claim nodes'),
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
      const catalog = controlCatalogFor(game.package);
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
  const checked = <A extends unknown[]>(fn: (...args: A) => unknown) => (...args: A) => validateClaimEnvelope(fn(...args));
  return {
    describe: checked((args?: {game?: string}) => describe(context, args)), query: checked(query), review: checked(review), promote: checked(promote), check: checked(check),
    truth: checked(truthVerb),
    readResource: (uri: string) => { const value = readResource(uri); return value === null ? null : validateClaimEnvelope(value); },
    listResources, resourceTemplates: () => [...RESOURCE_TEMPLATES],
    /** The committed-winner compile this surface caches, for another door on the same checkout (the lab). */
    winners,
  };
}

