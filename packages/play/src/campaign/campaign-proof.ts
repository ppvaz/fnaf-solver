/**
 * Positive lifecycle and save proof for an unattended campaign.
 * CONTRACT:campaign-proof-v1.
 */
import { AI_DIALS, PUPPET_AI } from '@sixam/source/fnaf2';
import { stableHash, validateSaveProof } from '@sixam/kernel/contracts';
import { isRecord } from '@sixam/kernel';
import { makeCustomNightConfig, validateCustomNightConfig } from './custom-night.ts';
import type { Dials } from './custom-night.ts';

const CAMPAIGN_PROOF_SCHEMA = 'campaign-proof-v1';

/** What a proof is checked against: the night, its mode, and Night 7's configuration. */
interface ProofTarget {
  readonly night: number;
  readonly mode: string;
  readonly custom?: unknown;
}

function fail(message: string): never { throw new TypeError(`campaign proof: ${message}`); }

function exactDials(value: unknown, expected: Dials) {
  if (!isRecord(value)) return false;
  return AI_DIALS.every(dial => value[dial] === expected[dial]);
}

/** Reject death, disappearance, and generic "finished" statuses. */
function validateSixAmProof(value: unknown, target: ProofTarget | null | undefined) {
  if (!isRecord(value) || value.outcome !== 'sixam' || value.sixAm !== true)
    fail('terminal proof is not a positive 6 AM observation');
  if (value.night !== target?.night) fail('terminal proof has the wrong night identity');
  if (value.identity !== target?.mode) fail('terminal proof has the wrong mode identity');
  if (value.positive !== true) fail('terminal proof lacks a positive frame/transition observation');
  return value;
}

function validateCustomReadback(value: unknown, target: ProofTarget | null | undefined) {
  const expected = validateCustomNightConfig(target?.custom ?? makeCustomNightConfig());
  if (!isRecord(value) || value.status !== 'PASS' || value.puppet !== PUPPET_AI ||
      !exactDials(value.dials, expected.dials))
    fail('Custom Night readback does not match all ten dials and Puppet 15');
  return value;
}

/** Build the immutable proof row attached to a completed attempt. */
export function makeAttemptProof({ target, attempt, terminal, terminalVerification, save, customReadback }: {target: ProofTarget, attempt: number,
  terminal: unknown, terminalVerification: unknown, save: unknown, customReadback?: unknown}) {
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
