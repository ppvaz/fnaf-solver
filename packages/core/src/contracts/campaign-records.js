/**
 * Validators for the two records a device campaign retains and the evidence
 * index reads back: the campaign result and an attempt's save proof. They
 * moved here from apps/device (campaign.js, campaign-proof.js) on 2026-09-29,
 * verbatim, so that `@sixam/review` can read a retained campaign without
 * importing the app that played it (ADR 0002: Review never imports Play).
 * apps/device re-exports them unchanged; the messages are the ones the app
 * threw, because evidence and attestations quote them.
 * CONTRACT:device-campaign-result-v1 CONTRACT:campaign-proof-v1
 */

export const CAMPAIGN_STATES = Object.freeze([
  'IDLE', 'PREFLIGHT', 'MENU', 'INTRO_VERIFY', 'ACTIVE',
  'CUSTOM_VERIFY', 'TERMINAL_VERIFY', 'RETRY_VERIFY', 'SAVE_VERIFY', 'HOLD', 'ABORTED', 'COMPLETE',
]);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failCampaign = message => { throw new TypeError(`campaign: ${message}`); };
const failProof = message => { throw new TypeError(`campaign proof: ${message}`); };
const text = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) failCampaign(`${label} must be a non-empty string`);
  return value;
};

export function validateCampaignResult(value) {
  if (!isRecord(value) || value.schema !== 'device-campaign-result-v1' || value.version !== 1)
    failCampaign('result schema/version mismatch');
  if (!CAMPAIGN_STATES.includes(value.state)) failCampaign('result state is invalid');
  text(value.specHash, 'result.specHash');
  if (!Array.isArray(value.completedNights) || !Array.isArray(value.attempts) || !Array.isArray(value.events))
    failCampaign('result attempts/events are required');
  if (value.completedNights.some(night => !Number.isInteger(night) || night < 1 || night > 7))
    failCampaign('result completedNights contains an unsupported night');
  return value;
}

export function validateSaveProof(value, target) {
  if (target?.night === 6) {
    if (!isRecord(value) || value.observed !== true ||
        (value.cursorNight !== 7 && value.customNightVisible !== true))
      failProof('Night 6 save proof must positively observe cursor Night 7 or Custom Night visibility');
  } else if (target?.night === 7) {
    if (!isRecord(value) || value.menuReturned !== true || value.customCompleted !== true || value.observed !== true)
      failProof('Custom Night save proof must positively observe the completed menu return');
  } else if (target?.night >= 1 && target?.night <= 4) {
    // Story Nights 1..4 roll directly into the next night's gameplay on the
    // target build. The observed next-night office is the save advancement
    // proof; there is no title screen to inspect between the two nights.
    if (!isRecord(value) || value.observed !== true || value.nextNightStarted !== true)
      failProof(`Story Night ${target?.night} save proof must positively observe the next-night roll-through`);
  } else if (!isRecord(value) || value.observed !== true || value.menuReturned !== true ||
      value.continueVisible !== true ||
      (target?.night === 5 && value.sixthNightVisible !== true && value.cursorNight !== 6)) {
    failProof(`Story Night ${target?.night} save proof must positively observe the menu return and save advancement`);
  }
  return value;
}
