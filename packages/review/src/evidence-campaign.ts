// The phone's own nights, read by the evidence index.
//
// Every live night the device campaign plays leaves artifacts/campaign-*/result.json: a wrapper
// { mode, status, result } around a validated device-campaign-result-v1 whose attempts carry the
// executor's terminal and a campaign-proof-v1 hash. Until 2026-09-18 `npm run evidence -- list`
// did not read that shape, so it reported 132 campaign directories as UNRECOGNIZED_ARTIFACT and
// zero DEVICE_MEASURED runs -- every Night 1-7 win on the phone was invisible to the index and to
// the Plan 12 gate. These functions are pure so the CLI and its test share them.
import { validateCampaignResult } from '@sixam/kernel/contracts';
import { isRecord } from '@sixam/kernel';

export const CAMPAIGN_RESULT_SCHEMA = 'device-campaign-result-v1';

/** A retained result.json: the CLI's mode and status around the campaign's result, or the error it threw. */
export interface CampaignWrapper {
  readonly status?: unknown;
  readonly mode?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
  readonly plan12Gate?: { readonly status?: unknown } | null;
  readonly [field: string]: unknown;
}

// cli.js retains this envelope when a campaign throws before returning its
// validated result. Preserve the negative and its original error; it supplies
// no measured terminal and can never satisfy promotion.
const isCampaignError = (wrapper: { status?: unknown, mode?: unknown, result?: unknown, error?: unknown } | null | undefined) => wrapper?.status === 'ERROR'
  && (wrapper.mode === 'live' || wrapper.mode === 'dry-run') && wrapper.result === undefined
  && typeof wrapper.error === 'string' && wrapper.error.trim().length > 0;

/** @param wrapper parsed result.json */
export const isCampaignResult = (wrapper: unknown): wrapper is CampaignWrapper => {
  const fields = isRecord(wrapper) ? wrapper : undefined;
  return (isRecord(fields?.result) && fields.result.schema === CAMPAIGN_RESULT_SCHEMA) || isCampaignError(fields);
};

/**
 * One index row for a campaign directory. A live campaign is DEVICE_MEASURED: its attempts are
 * the executor's own reads of the phone. Anything else (a dry run, a fixture) is FIXTURE.
 * @param id directory name
 * @param wrapper parsed result.json
 */
export function campaignEntry(id: string, wrapper: CampaignWrapper) {
  if (isCampaignError(wrapper)) return {
    id, kind: 'device-campaign', outcome: 'ERROR', claimLevel: 'UNKNOWN',
    nights: [], attempts: [], error: wrapper.error,
  };
  const result = validateCampaignResult(wrapper.result);
  const attempts = result.attempts.map(a => ({
    attempt: a.attempt ?? null, night: a.night ?? null, status: a.status ?? null,
    terminal: a.terminal?.outcome ?? null, proofHash: a.proofHash ?? null,
  }));
  const won = attempts.some(a => a.status === 'WIN' && a.terminal === 'sixam' && a.proofHash);
  // A WIN status without the sixam terminal and its proof is reported as such, never as a WIN.
  const last = attempts.at(-1);
  return {
    id, kind: 'device-campaign',
    outcome: won ? 'WIN' : last?.status === 'WIN' ? 'UNPROVEN_WIN' : (last?.status ?? result.state),
    claimLevel: wrapper.mode === 'live' ? 'DEVICE_MEASURED' : 'FIXTURE',
    nights: result.completedNights, attempts,
  };
}

/**
 * The Plan 12 gate's four checks for a campaign directory, the same four the CLI applies to
 * sessions and device bundles. The attestation is never inferred from the other checks: it is
 * written over a committed run pack (`npm run evidence -- attest`, by a person or, since Pedro's
 * 2026-09-27 delegation, an agent that re-derived every other check), so a campaign directory
 * without one is refused with every other check reported.
 * @param wrapper parsed result.json
 * @param files names present in the campaign directory
 */
export function campaignPromotionChecks(wrapper: CampaignWrapper, files: readonly string[]) {
  const entry = campaignEntry('check', wrapper);
  return {
    offlineEvidence: entry.claimLevel === 'DEVICE_MEASURED',
    terminalPass: entry.outcome === 'WIN',
    manifestComplete: ['result.json', 'events.jsonl', 'request.json'].every(name => files.includes(name)),
    plan12Attestation: wrapper.plan12Gate?.status === 'PASS',
  };
}
