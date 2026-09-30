/**
 * Positive lifecycle and save proof for an unattended campaign.
 * CONTRACT:campaign-proof-v1.
 */
import { AI_DIALS, PUPPET_AI } from '@sixam/core/mechanics';
import { stableHash } from '@sixam/core/contracts';
import { makeCustomNightConfig, validateCustomNightConfig } from './custom-night.js';

export const CAMPAIGN_PROOF_SCHEMA = 'campaign-proof-v1';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`campaign proof: ${message}`); };

function exactDials(value, expected) {
  if (!isRecord(value)) return false;
  return AI_DIALS.every(dial => value[dial] === expected[dial]);
}

/** Reject death, disappearance, and generic "finished" statuses. */
export function validateSixAmProof(value, target) {
  if (!isRecord(value) || value.outcome !== 'sixam' || value.sixAm !== true)
    fail('terminal proof is not a positive 6 AM observation');
  if (value.night !== target?.night) fail('terminal proof has the wrong night identity');
  if (value.identity !== target?.mode) fail('terminal proof has the wrong mode identity');
  if (value.positive !== true) fail('terminal proof lacks a positive frame/transition observation');
  return value;
}

export function validateSaveProof(value, target) {
  if (target?.night === 6) {
    if (!isRecord(value) || value.observed !== true ||
        (value.cursorNight !== 7 && value.customNightVisible !== true))
      fail('Night 6 save proof must positively observe cursor Night 7 or Custom Night visibility');
  } else if (target?.night === 7) {
    if (!isRecord(value) || value.menuReturned !== true || value.customCompleted !== true || value.observed !== true)
      fail('Custom Night save proof must positively observe the completed menu return');
  } else if (target?.night >= 1 && target?.night <= 4) {
    // Story Nights 1..4 roll directly into the next night's gameplay on the
    // target build. The observed next-night office is the save advancement
    // proof; there is no title screen to inspect between the two nights.
    if (!isRecord(value) || value.observed !== true || value.nextNightStarted !== true)
      fail(`Story Night ${target?.night} save proof must positively observe the next-night roll-through`);
  } else if (!isRecord(value) || value.observed !== true || value.menuReturned !== true ||
      value.continueVisible !== true ||
      (target?.night === 5 && value.sixthNightVisible !== true && value.cursorNight !== 6)) {
    fail(`Story Night ${target?.night} save proof must positively observe the menu return and save advancement`);
  }
  return value;
}

export function validateCustomReadback(value, target) {
  const expected = validateCustomNightConfig(target?.custom ?? makeCustomNightConfig());
  if (!isRecord(value) || value.status !== 'PASS' || value.puppet !== PUPPET_AI ||
      !exactDials(value.dials, expected.dials))
    fail('Custom Night readback does not match all ten dials and Puppet 15');
  return value;
}

/** Build the immutable proof row attached to a completed attempt. */
/** @param {{target?: any, attempt?: number, terminal?: any, terminalVerification?: any, save?: any, customReadback?: any}} options */
export function makeAttemptProof({ target, attempt, terminal, terminalVerification, save, customReadback } = {}) {
  validateSixAmProof(terminal, target);
  if (!isRecord(terminalVerification) || terminalVerification.sixAm !== true || terminalVerification.positive !== true)
    fail('terminal verification is incomplete');
  if (target?.night === 7) validateCustomReadback(customReadback, target);
  validateSaveProof(save, target);
  if (!Number.isInteger(attempt) || attempt < 1) fail('attempt must be a positive integer');
  return Object.freeze({ schema: CAMPAIGN_PROOF_SCHEMA, version: 1, night: target.night,
    mode: target.mode, attempt, sixAm: true, terminal: structuredClone(terminal),
    terminalVerification: structuredClone(terminalVerification), save: structuredClone(save),
    customReadback: customReadback ? structuredClone(customReadback) : null,
    proofHash: stableHash({ target, attempt, terminal, terminalVerification, save, customReadback }) });
}
