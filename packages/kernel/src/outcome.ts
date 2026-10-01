/**
 * Outcome (ADR 0002 kernel): SixAM | Death{by, how, rule, at} | Timeout |
 * Aborted(why) | Invalid(why) | UNKNOWN, plus wouldDie[] for non-lethal runs.
 * Venues report an outcome; Review decides it (principle 3). Death `at` is Ms
 * from the night's origin.
 */
import { fail, isOneOf, isRecord, isText, isUnknown } from './labels.ts';
import { validateInterval } from './time/interval.ts';
import type { DeathCause, Outcome } from './types.ts';

export const OUTCOME_KINDS = Object.freeze(['SixAM', 'Death', 'Timeout', 'Aborted', 'Invalid', 'UNKNOWN'] as const);
const FIELDS: Readonly<Record<Outcome['kind'], readonly string[]>> = Object.freeze({
  SixAM: ['kind', 'wouldDie'], Death: ['kind', 'by', 'how', 'rule', 'at'], Timeout: ['kind', 'wouldDie'],
  Aborted: ['kind', 'why'], Invalid: ['kind', 'why'], UNKNOWN: ['kind', 'reason'],
});

const knownText = (value: unknown, label: string) => {
  if (!isText(value) && !isUnknown(value)) fail(`${label} must be text or UNKNOWN(reason)`);
};

function validateCause(cause: unknown, label: string): DeathCause {
  if (!isRecord(cause)) fail(`${label} must be an object`);
  for (const field of ['by', 'how', 'rule']) knownText(cause[field], `${label}.${field}`);
  if (isText(cause.rule) && !/^g\d+$/.test(cause.rule)) fail(`${label}.rule must name an event group g###`);
  if (!isUnknown(cause.at)) validateInterval(cause.at);
  return cause as unknown as DeathCause;
}

export function validateOutcome(value: unknown): Outcome {
  if (!isRecord(value) || !isOneOf(OUTCOME_KINDS, value.kind)) fail(`an outcome's kind must be one of ${OUTCOME_KINDS.join(', ')}`);
  const fields = FIELDS[value.kind];
  const extra = Object.keys(value).filter(key => !fields.includes(key));
  if (extra.length) fail(`a ${value.kind} outcome has no ${extra.join(', ')}`);
  if (value.kind === 'UNKNOWN' && !isUnknown(value)) fail('an UNKNOWN outcome needs its reason');
  if ((value.kind === 'Aborted' || value.kind === 'Invalid') && !isText(value.why)) fail(`${value.kind} needs why`);
  if (value.kind === 'Death') validateCause(value, 'Death');
  if (value.wouldDie !== undefined) {
    if (!Array.isArray(value.wouldDie)) fail('wouldDie must be a list');
    value.wouldDie.forEach((cause, index) => validateCause(cause, `wouldDie[${index}]`));
  }
  return value as unknown as Outcome;
}

const frozen = (value: Outcome) => validateOutcome(Object.freeze(value));
export const sixAm = (wouldDie?: DeathCause[]) => frozen({ kind: 'SixAM', ...(wouldDie ? { wouldDie: Object.freeze([...wouldDie]) } : {}) });
export const death = ({ by, how, rule, at }: DeathCause) => frozen({ kind: 'Death', by, how, rule, at });
export const timeout = (wouldDie?: DeathCause[]) => frozen({ kind: 'Timeout', ...(wouldDie ? { wouldDie: Object.freeze([...wouldDie]) } : {}) });
export const aborted = (why: string) => frozen({ kind: 'Aborted', why });
export const invalid = (why: string) => frozen({ kind: 'Invalid', why });
