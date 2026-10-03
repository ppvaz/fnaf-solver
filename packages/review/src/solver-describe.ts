// The solver's describe verb: a join over the registers for one game -- its controls, the
// contracts that bind it, the chronicle's entries for it, what the phone has confirmed, its
// refuted routes, and Plan 28's gaps -- with every section at its own label.
import { controlCatalogFor } from '@sixam/source';
import { NO_LOCAL_DUMP, VAULT_ENV, VAULT_FILE } from '@sixam/source/truth';
import { claimEnvelope, isList, unknown } from '@sixam/kernel';
import { sortedCounts as sorted, tally } from './counts.ts';
import { FNAF2, ONE_CLEAR } from './envelopes.ts';
import { PACKS_DIR } from './evidence-pack.ts';
import { GRAPH_FILE, PROMOTION_EDGE, derivePromotion, readGraph } from './evidence-promotion.ts';
import { liftPack } from './pack-lift.ts';
import { queryPromotions } from './promotions-query.ts';
import { ARCHIVED_ROUTES, CHRONICLE_ATTRIBUTION, CHRONICLE_DIR, CHRONICLE_SCHEMA_MODULE, COMMAND_REGISTRY, CONTRACT_REGISTER,
  CONTROL_CATALOG_DIR, catalogUnknowns, chronicleLabel, gameKey, isNegative, readChronicle, readCommandRegistry, readContracts,
  readPacks, resolveGame } from './registers.ts';
import { ENVELOPE_EMITTERS, PLAN28, gameRefusal } from './solver-shared.ts';
import type { SolverContext, ValidPackRow } from './solver-shared.ts';

/** Plan 28's four gaps, each as a query over the registers and this surface's own verb table. */
function gaps({ root, truth }: SolverContext, pkg: string, gamePacks: readonly ValidPackRow[], graphEdges: number) {
  const contracts = readContracts(root).contracts.map(item => item.id);
  const registered = contracts.includes('claim-envelope-v1');
  const registry = readCommandRegistry(root);
  const emitterIds = new Set(ENVELOPE_EMITTERS.map(command => command.split(' ')[2]));
  const custody = tally(gamePacks, pack => pack.custody.kind);
  const complete = custody.original ?? 0;
  const local = truth.status(pkg);
  return [
    { gap: 1, name: 'The envelope is not shared',
      query: `claim-envelope-v1 in ${CONTRACT_REGISTER}; the commands of ${COMMAND_REGISTRY} this surface lists as emitters`,
      registered, emitters: ENVELOPE_EMITTERS,
      commandsWithoutEnvelope: registry.commands.filter(id => !emitterIds.has(id)).length, commands: registry.commands.length,
      holds: !registered ? true : 'partly' },
    // Gaps 2 and 3 were closed by building this surface: they are not measured, they are this code.
    { gap: 2, name: 'Truth has no programmatic surface', holds: false,
      closedBy: `the truth verb of this surface; this game's local dump is read from ${VAULT_FILE} or $${VAULT_ENV}`,
      localDump: local.configured, ...(local.configured ? {} : { notMeasured: [NO_LOCAL_DUMP] }) },
    { gap: 3, name: 'No coverage map', holds: false, closedBy: 'the describe verb of this surface, which is answering' },
    { gap: 4, name: 'Custody is incomplete and promotion is empty',
      query: `this game's packs in ${PACKS_DIR} by custody kind, and its ${PROMOTION_EDGE} edges in ${GRAPH_FILE}`,
      packs: gamePacks.length, custody: sorted(custody), promotionEdges: graphEdges,
      holds: gamePacks.length === 0 || graphEdges === 0 ? true : complete === gamePacks.length ? false : 'partly' },
  ];
}

export function describe(context: SolverContext, { game }: {game?: string} = {}) {
  const { root, winners } = context;
  const named = resolveGame(game);
  if (!named) return gameRefusal(game);
  const pkg = named.package;
  const catalog = controlCatalogFor(pkg);
  const notMeasured: string[] = [];

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
  // An invalid pack's game is UNKNOWN, so no game's packs include one.
  const gamePacks = packs.flatMap(pack => pack.valid && gameKey(pack.game) === pkg ? [pack] : []);
  const invalid = packs.flatMap(pack => pack.valid ? [] : [pack]);
  if (invalid.length) notMeasured.push(...invalid.map(pack => `${pack.id}: ${pack.error}`));
  const graph = readGraph(root);
  const graphEdges = graph.edges.filter(edge => edge.type === PROMOTION_EDGE);
  const gameEdges = graphEdges.filter(edge => gamePacks.some(pack => `run.${pack.id}` === edge.to));
  const outcomes = tally(gamePacks.flatMap(pack => {
    try { return liftPack(root, pack.id).runs; } catch (error) {
      // A pack that does not lift is named, not left out of the counts in silence.
      notMeasured.push(`${pack.id}'s outcome: the pack does not lift (${(error as Error).message})`);
      return [];
    }
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
    // Why this game's unpromoted packs are refused: each one's failing checks, re-derived.
    const refusals = tally(gamePacks.filter(pack => !pack.promoted).flatMap(pack => {
      try {
        return [...new Set(derivePromotion(root, pack.id, winners()).verified.filter(item => !item.pass)
          .flatMap(item => isList(item.detail.failed) ? item.detail.failed.map(reason => String(reason)) : [`${item.check} fails`]))];
      } catch (error) { return [`${pack.id}: ${(error as Error).message}`]; }
    }), reason => reason);
    const gate = Object.keys(refusals).length ? Object.entries(refusals).sort((a, b) => b[1] - a[1])
      .map(([reason, packs]) => `${reason} (${packs} pack${packs === 1 ? '' : 's'})`).join('; ') : null;
    const promotedHere = gamePacks.filter(pack => pack.promoted);
    phone = {
      packs: gamePacks.length, reportedOutcomes: sorted(outcomes),
      claimLevels: sorted(tally(gamePacks, pack => pack.claimLevel ?? 'UNKNOWN')),
      promotion: promotedHere.length
        ? { rule: `a ${PROMOTION_EDGE} edge in ${GRAPH_FILE} whose pack re-derives (Plan 12's checks, read from this game's runner packs)`,
          label: 'DEVICE_MEASURED', promotedRuns: promotedHere.map(pack => pack.id), promotedClaims: [...new Set(promotedHere.map(pack => pack.promoted))],
          attestedBy: sorted(tally(promotedHere, pack => pack.attestedBy ?? 'UNKNOWN')) }
        : unknown(gate ? `the promotion gate refuses this game's packs: ${gate}` : 'no pack of this game is promoted'),
    };
    if (!promotedHere.length) notMeasured.push(`a promotion for ${named.title}: ${gate ?? 'none recorded'}`);
    else notMeasured.push(ONE_CLEAR);
  }
  if ((outcomes.UNKNOWN ?? 0) > 0) notMeasured.push(`the reported outcome of ${outcomes.UNKNOWN} of this game's lifted runs`);

  const gapRows = gaps(context, pkg, gamePacks, gameEdges.length);
  notMeasured.push(...gapRows.filter(row => row.holds !== false).map(row => `Plan 28 gap ${row.gap} (${row.name}) holds${row.holds === true ? '' : ' partly'}`),
    ...gapRows.flatMap(row => ('notMeasured' in row ? row.notMeasured : undefined) ?? []));

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
