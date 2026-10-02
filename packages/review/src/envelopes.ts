// claim-envelope-v1 around the evidence tools' existing outputs (Plan 28 step 1).
//
// The tools keep printing their own shape by default -- other tools parse it -- and print it
// wrapped in the envelope when asked (`--envelope`). The wrapped value is the tool's output
// unchanged, as `claim`; the envelope adds what it is worth (`label`), what it is about, where it
// was read, and what it does not measure. The MCP server's `query promotions` uses the same
// wrapper, so a caller gets one answer however it asks.
import { claimEnvelope, isClaimLevel, isList, isRecord, refusalEnvelope, unknown, unknownsIn } from '@sixam/kernel';
import type { Unknown } from '@sixam/kernel';
import { PACKS_DIR } from './evidence-pack.ts';
import { GRAPH_FILE } from './evidence-promotion.ts';

export const PLAN12 = 'plans/12-end-to-end-evidence-campaign.md';
export const FNAF2 = 'com.scottgames.fnaf2';
/** What a promotion never measures (CLAUDE.md, S1: "A promotion is one clear, not a reliability claim"). */
export const ONE_CLEAR = 'reliability: a promotion is one clear on the phone, not a rate';

/**
 * A claim level as an envelope label: a ClaimLevel, or UNKNOWN(reason) naming what was there.
 */
export const levelLabel = (level: unknown, where: string) => (isClaimLevel(level) ? level
  : level === 'UNKNOWN' ? unknown(`${where} records its claim level as UNKNOWN, with no reason`)
    : unknown(`${where} records claim level ${JSON.stringify(level ?? null)}, which is not a ClaimLevel`));

/**
 * `npm run review -- query promotions --envelope`: the query as the claim, DEVICE_MEASURED for
 * the promoted edges it re-derives, and S1's open items as what it does not measure. A graph that
 * disagrees with the derivation is refused, not wrapped.
 */
export function promotionsQueryEnvelope(result: ReturnType<typeof import('./promotions-query.ts').queryPromotions>) {
  if (!result.consistent) {
    const { edges, lift } = result;
    const faults = [
      ...(lift.failures.length ? [`${lift.failures.length} packs fail to lift`] : []),
      ...(edges.differing.length ? [`${edges.differing.length} edges differ`] : []),
      ...(edges.notInGraph.length ? [`${edges.notInGraph.length} derived edges are not in the graph`] : []),
      ...(edges.onlyInGraph.length ? [`${edges.onlyInGraph.length} graph edges re-derive from nothing`] : []),
      ...(edges.duplicatedInGraph ? [`${edges.duplicatedInGraph} graph edges are duplicated`] : []),
      ...(edges.refused.length ? [`${edges.refused.length} attested packs no longer re-derive`] : []),
      ...(edges.notSixAm.length ? [`${edges.notSixAm.length} promoted runs report no 6 AM`] : []),
    ];
    return refusalEnvelope({ rule: 'promotion-graph-agreement',
      because: `${GRAPH_FILE} and the derivation from the committed packs disagree: ${faults.join('; ')}`,
      cite: [GRAPH_FILE, PACKS_DIR, PLAN12],
      remedy: 'read the lists in `npm run review -- query promotions`; an edge its pack no longer supports is retracted, never kept' });
  }
  const { open, lift } = result;
  const unknownOutcomes = lift.reportedOutcomes.UNKNOWN ?? 0;
  const unknownCustody = lift.custody.UNKNOWN ?? 0;
  return claimEnvelope({
    claim: result, label: 'DEVICE_MEASURED', target: FNAF2,
    cite: [GRAPH_FILE, PACKS_DIR, 'packages/propose/bindings/fact-register.ts', PLAN12],
    status: 'standing', supersededBy: null,
    notMeasured: [
      ONE_CLEAR,
      ...open.modelOnlyWinners.winners.map(item => `${item.file} on the phone: no run pack names it, so it stands MODEL_ONLY`),
      ...open.untrackedWinnerDebt.entries.filter(item => !item.committed)
        .map(item => `a committed winner for the Night ${item.night ?? 'UNKNOWN'} anchor binding ${item.hash}`),
      ...(unknownOutcomes ? [`the reported outcome of ${unknownOutcomes} of ${lift.gameRuns} lifted runs, UNKNOWN in their packs`] : []),
      ...(unknownCustody ? [`the custody class of ${unknownCustody} lifted runs`] : []),
    ],
    reproducer: 'npm run review -- query promotions',
  });
}

/**
 * `npm run evidence -- promotions --envelope`: the per-night summary as the claim.
 */
export function promotionSummaryEnvelope(summary: ReturnType<typeof import('./evidence-promotion.ts').promotionSummary>) {
  return claimEnvelope({
    claim: summary, label: 'DEVICE_MEASURED', target: FNAF2,
    cite: [GRAPH_FILE, PACKS_DIR, PLAN12, `evidence:${summary.evidenceId}`],
    status: 'standing', supersededBy: null,
    notMeasured: [
      ONE_CLEAR,
      ...summary.refusedWins.map(item => `${item.id}: an executor 6 AM that is not promoted (${item.failing.join(', ')} fail)`),
      ...summary.staleEdges.map(item => `${item.id}: a recorded edge that no longer holds (${item.reason})`),
      ...Object.entries(summary.nights).filter(([night]) => night === 'fnaf1')
        .map(([, row]) => `${row.packs} FNaF 1 packs: no Plan 12 gate reads a FNaF 1 run`),
    ],
    reproducer: 'npm run evidence -- promotions',
  });
}

/**
 * `npm run evidence -- show ID --envelope`: what `show` prints, as the claim, at the claim level
 * the run's own record carries.
 * @param shown the object show prints
 */
export function showEnvelope(id: string, shown: Readonly<Record<string, unknown>>,
  { target, source, claimLevel }: {target: string | Unknown, source: string, claimLevel: unknown}) {
  const custody = isRecord(shown.custody) ? shown.custody : null;
  const lost = isList(custody?.lost) ? custody.lost : [];
  return claimEnvelope({
    claim: shown, label: levelLabel(claimLevel, `${id}'s record`), target,
    cite: [source, ...(shown.promotion ? [GRAPH_FILE] : [])],
    status: 'standing', supersededBy: null,
    notMeasured: [
      ...lost.map(name => `${name}: lost with this run's custody (${custody?.kind})`),
      ...(shown.outcome === 'WIN' && !shown.promotion ? ['promotion: this run holds no PROMOTED_BY edge'] : []),
      ...(shown.kind === 'fnaf1-run' && !shown.promotion ? ['promotion: this runner\'s night holds no PROMOTED_BY edge'] : []),
      ...(claimLevel === 'DEVICE_MEASURED' ? [] : ['the phone: this record is not a live device measurement']),
      ...unknownsIn(shown).map(item => `${item.path || 'the record'}: UNKNOWN${item.reason ? ` (${item.reason})` : ''}`),
    ],
    reproducer: `npm run evidence -- show ${id}`,
  });
}
