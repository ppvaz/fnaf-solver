/**
 * Campaign-specific readiness gate. Basic ADB readiness is not enough for an
 * unattended multi-night run: this also checks the measured Custom Night UI,
 * a bound full-night artifact, proof adapters, and a qualified local runner.
 *
 * The device preflight's `venue-identity` check is copied in with the rest,
 * so a drifted venue refuses here too. `qualification-venue` then says where
 * the qualification stands on the observed venue: a qualification-v1 is
 * unbound and only recorded; a qualification-v2 whose venue drifted is
 * demoted from QUALIFIED to CANDIDATE and refuses (ADR 0002, principle 12).
 * The demotion is reported, not persisted: it is re-derived every preflight.
 * CONTRACT:device-campaign-preflight-v1. CONTRACT:qualification-v2.
 */
import { validateQualification, qualificationStanding } from '@sixam/kernel/contracts';
import { stableHash } from '@sixam/kernel/contracts';
import { preflightVenue } from './adb-bridge.ts';
import { validateCustomNightCalibration } from './custom-night.ts';
import { validateCampaignSpec } from './campaign.ts';
import { isList, isRecord } from '@sixam/kernel';

export const CAMPAIGN_PREFLIGHT_SCHEMA = 'device-campaign-preflight-v1';
/** One gate of the campaign preflight; the device preflight's own checks are copied in with the same shape. */
interface CampaignCheck {
  readonly id: string;
  readonly status: string;
  readonly detail: unknown;
}
const check = (id: string, status: string, detail: unknown): CampaignCheck => Object.freeze({ id, status, detail });

/**
 * @param qualification a validated qualification
 * @param device the device preflight record
 */
function qualificationVenueCheck(qualification: unknown, device: unknown) {
  const observed = preflightVenue(device)?.observed ?? null;
  const standing = qualificationStanding({ qualification, observed });
  if (standing.venue === 'UNBOUND') return check('qualification-venue', 'PASS', standing.message);
  const detail = { lifecycle: standing.lifecycle, demotedFrom: standing.demotedFrom,
    venue: standing.venue, message: standing.message, drift: standing.check.drift,
    remedy: standing.check.remedy };
  if (standing.venue === 'DRIFT') return check('qualification-venue', 'FAIL', detail);
  if (standing.venue === 'UNKNOWN') return check('qualification-venue', 'HOLD', detail);
  return check('qualification-venue', 'PASS', standing.message);
}

function statusOf(checks: readonly CampaignCheck[]) {
  if (checks.some(item => item.status === 'FAIL')) return 'FAIL';
  if (checks.some(item => item.status === 'HOLD' || item.status === 'UNKNOWN')) return 'HOLD';
  return 'READY';
}

/**
 * Evaluate all campaign gates without opening a transport or sending input.
 * The result is deliberately useful as the output of one guided preflight.
 */
export function evaluateCampaignPreflight({ spec, device, profile, calibration,
  bundle, qualification, allowSaveReset = false, machineOnly = false, executor }: {spec?: unknown,
  device?: { readonly status?: string, readonly reason?: unknown, readonly serial?: string | null, readonly checks?: readonly CampaignCheck[] },
  profile?: { readonly limits?: { readonly dryRunOnly?: boolean } }, calibration?: unknown,
  bundle?: { readonly plans?: readonly { readonly night: number, readonly timing?: unknown, readonly sha256?: string }[],
    readonly machine?: { readonly claimLevel?: string }, readonly artifact?: { readonly winnerHash?: string, readonly engineHash?: string } } | null,
  qualification?: unknown, allowSaveReset?: boolean, machineOnly?: boolean,
  executor?: { readonly terminal?: boolean, readonly save?: boolean, readonly portsReady?: boolean, readonly deviceLocal?: boolean }} = {}) {
  const campaign = validateCampaignSpec(spec);
  const checks: CampaignCheck[] = [];
  const deviceChecks = isList(device?.checks) ? device.checks : [];
  checks.push(...deviceChecks);
  if (device?.status !== 'READY') checks.push(check('adb-campaign-device', device?.status ?? 'HOLD', device?.reason ?? 'device-preflight-not-ready'));
  else checks.push(check('adb-campaign-device', 'PASS', device.serial));

  const custom = campaign.nights.find(target => target.mode === 'custom');
  if (custom) {
    if (!calibration) checks.push(check('custom-menu-calibration', 'HOLD', 'guided calibration artifact is missing'));
    else {
      try {
        const measured = validateCustomNightCalibration(calibration, { targetBuild: campaign.target.build });
        checks.push(check('custom-menu-calibration', 'PASS', measured.schema));
      } catch (error) { checks.push(check('custom-menu-calibration', 'FAIL', (error as Error).message)); }
    }
  }

  const boundNights = new Set(isList(bundle?.plans) ? bundle.plans.map(plan => plan.night) : []);
  for (const target of campaign.nights) {
    const plan = bundle?.plans?.find(item => item.night === target.night);
    if (!plan) checks.push(check(`night-${target.night}-artifact`, 'HOLD', 'full-night compiled artifact is not bound'));
    else if (stableHash(plan.timing) !== stableHash(target.timing))
      checks.push(check(`night-${target.night}-artifact`, 'FAIL', 'artifact timing does not match campaign timing'));
    else checks.push(check(`night-${target.night}-artifact`, 'PASS', plan.sha256 ?? 'compiled'));
  }
  if (boundNights.size !== campaign.nights.length) checks.push(check('campaign-artifacts', 'HOLD', 'one artifact per requested night is required'));

  const proof = isRecord(executor) && executor.terminal === true && executor.save === true;
  checks.push(check('terminal-proof', proof ? 'PASS' : 'HOLD', proof ? '6 AM and save proof ports declared' : 'terminal and save proof ports are not composed'));
  checks.push(check('campaign-ports', executor?.portsReady === true ? 'PASS' : 'HOLD',
    executor?.portsReady === true ? 'all ordered campaign ports declared' : 'one or more ordered campaign ports are missing'));

  const machineClaim = bundle?.machine?.claimLevel === 'MODEL_ONLY';
  if (machineOnly) {
    checks.push(check('machine-only-ack', machineClaim ? 'PASS' : 'FAIL', machineClaim
      ? 'explicit MODEL_ONLY machine-input experiment; human/qualification promotion suppressed'
      : 'machine-only mode requires a MODEL_ONLY bundle'));
  } else if (profile?.limits?.dryRunOnly === true) checks.push(check('qualified-live-profile', 'HOLD', 'resolved profile is marked dryRunOnly'));
  else if (!qualification) checks.push(check('qualified-live-profile', 'HOLD', 'DEVICE_MEASURED qualification artifact is missing'));
  else {
    try {
      const qualified = validateQualification(qualification);
      checks.push(check('qualified-live-profile', qualified.verdict === 'PASS' && qualified.claimLevel === 'DEVICE_MEASURED' ? 'PASS' : 'FAIL', {
        verdict: qualified.verdict, claimLevel: qualified.claimLevel,
      }));
      if (bundle?.artifact) {
        const bound = qualified.policyHash === bundle.artifact.winnerHash &&
          qualified.modelHash === bundle.artifact.engineHash;
        checks.push(check('qualification-binding', bound ? 'PASS' : 'FAIL', bound ? 'bundle winner/model hashes match' : 'qualification is not bound to bundle winner/model'));
      }
      checks.push(qualificationVenueCheck(qualification, device));
    } catch (error) { checks.push(check('qualified-live-profile', 'FAIL', (error as Error).message)); }
  }
  if (campaign.nights[0]?.menuTarget === 'newGame') {
    checks.push(check('save-reset-capability', allowSaveReset ? 'PASS' : 'HOLD', allowSaveReset
      ? 'explicit fresh-story start authorization present'
      : 'fresh-story start requires --allow-save-reset'));
  }
  checks.push(check('device-local-scheduler', executor?.deviceLocal === true ? 'PASS' : 'HOLD',
    executor?.deviceLocal === true ? 'full-night timing is device-local' : 'host round-trip scheduler is not accepted'));
  return Object.freeze({ schema: CAMPAIGN_PREFLIGHT_SCHEMA, version: 1, status: statusOf(checks),
    serial: device?.serial ?? null, checks, readyForUnattended: statusOf(checks) === 'READY' });
}
