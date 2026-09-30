/**
 * Outcome (ADR 0002 kernel): SixAM | Death{by, how, rule, at} | Timeout |
 * Aborted(why) | Invalid(why) | UNKNOWN, plus wouldDie[] for non-lethal runs.
 * Venues report an outcome; Review decides it (principle 3). Death `at` is Ms
 * from the night's origin.
 */
import { fail, isRecord, isText, isUnknown } from './labels.ts';
import { validateInterval } from './time/interval.ts';
import type { DeathCause, Outcome } from './types.ts';

export const OUTCOME_KINDS = Object.freeze(['SixAM', 'Death', 'Timeout', 'Aborted', 'Invalid', 'UNKNOWN']);
const FIELDS = Object.freeze({
  SixAM: ['kind', 'wouldDie'], Death: ['kind', 'by', 'how', 'rule', 'at'], Timeout: ['kind', 'wouldDie'],
  Aborted: ['kind', 'why'], Invalid: ['kind', 'why'], UNKNOWN: ['kind', 'reason'],
});

const knownText = (value: unknown, label: string) => {
  if (!isText(value) && !isUnknown(value)) fail(`${label} must be text or UNKNOWN(reason)`);
};

function validateCause(cause: any, label: string): DeathCause {
  if (!isRecord(cause)) fail(`${label} must be an object`);
  for (const field of ['by', 'how', 'rule']) knownText(cause[field], `${label}.${field}`);
  if (isText(cause.rule) && !/^g\d+$/.test(cause.rule)) fail(`${label}.rule must name an event group g###`);
  if (!isUnknown(cause.at)) validateInterval(cause.at);
  return cause;
}

export function validateOutcome(value: any): Outcome {
  if (!isRecord(value) || !OUTCOME_KINDS.includes(value.kind)) fail(`an outcome's kind must be one of ${OUTCOME_KINDS.join(', ')}`);
  const extra = Object.keys(value).filter(key => !FIELDS[value.kind].includes(key));
  if (extra.length) fail(`a ${value.kind} outcome has no ${extra.join(', ')}`);
  if (value.kind === 'UNKNOWN' && !isUnknown(value)) fail('an UNKNOWN outcome needs its reason');
  if ((value.kind === 'Aborted' || value.kind === 'Invalid') && !isText(value.why)) fail(`${value.kind} needs why`);
  if (value.kind === 'Death') validateCause(value, 'Death');
  if (value.wouldDie !== undefined) {
    if (!Array.isArray(value.wouldDie)) fail('wouldDie must be a list');
    value.wouldDie.forEach((cause, index) => validateCause(cause, `wouldDie[${index}]`));
  }
  return value;
}

const frozen = value => validateOutcome(Object.freeze(value));
export const sixAm = (wouldDie?: DeathCause[]) => frozen({ kind: 'SixAM', ...(wouldDie ? { wouldDie: Object.freeze([...wouldDie]) } : {}) });
export const death = ({ by, how, rule, at }: DeathCause) => frozen({ kind: 'Death', by, how, rule, at });
export const timeout = (wouldDie?: DeathCause[]) => frozen({ kind: 'Timeout', ...(wouldDie ? { wouldDie: Object.freeze([...wouldDie]) } : {}) });
export const aborted = (why: string) => frozen({ kind: 'Aborted', why });
export const invalid = (why: string) => frozen({ kind: 'Invalid', why });
