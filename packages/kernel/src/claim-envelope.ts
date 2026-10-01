/**
 * claim-envelope-v1 (Plan 28 step 1; ADR 0002 lists the claim envelope as v1,
 * expected to move until Plan 28 lands): the one shape every answer of the
 * solver interface takes, so a caller can tell a measured number from a
 * plausible one without reading the tool that produced it.
 *
 * An answer is either a claim:
 *
 *   {schema, claim, label, target, cite[], status, supersededBy, notMeasured[], reproducer}
 *
 * or a refusal of a known-bad move:
 *
 *   {schema, refused: true, rule, because, cite[], remedy}
 *
 * `label` is one of the kernel's closed enums -- a ClaimLevel or a named
 * SourceLabel -- or UNKNOWN(reason). Nothing is defaulted: a missing label, a
 * bare "UNKNOWN", or a claim that carries an UNKNOWN value while `notMeasured`
 * names nothing is refused (ADR 0002 principle 2). The two enums stay what
 * they are: a label is never read as the other enum's value.
 * CONTRACT:claim-envelope-v1.
 */
import { fail, isClaimLevel, isOneOf, isRecord, isSourceLabel, isText, isUnknown } from './labels.ts';
import type { ClaimEnvelope, EnvelopeLabel, RefusalEnvelope } from './types.ts';

export const CLAIM_ENVELOPE_SCHEMA = 'claim-envelope-v1';
export const ENVELOPE_STATUSES = Object.freeze(['standing', 'superseded', 'retracted'] as const);
export const CLAIM_FIELDS: readonly string[] = Object.freeze(['schema', 'claim', 'label', 'target', 'cite', 'status', 'supersededBy',
  'notMeasured', 'reproducer']);
export const REFUSAL_FIELDS: readonly string[] = Object.freeze(['schema', 'refused', 'rule', 'because', 'cite', 'remedy']);
/** The target of an answer about the repository's own registers rather than one game. */
export const REPOSITORY_TARGET = 'repository';

/** A game is named by its Android package, the one thing that identifies it (Plan 26), optionally @version. */
const GAME_TARGET = /^com\.scottgames\.[a-z0-9]+(?:@\S+)?$/;
/** An UNKNOWN written as text: bare, or the control catalogs' `UNKNOWN(reason)`. */
const UNKNOWN_TEXT = /^UNKNOWN(?:\(.*\))?$/s;
const CITE = /^\S+$/;
const RULE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isEnvelopeLabel = (value: unknown): value is EnvelopeLabel => isClaimLevel(value) || isSourceLabel(value);

export function validateEnvelopeLabel(value: unknown): EnvelopeLabel {
  if (value === undefined || value === null) fail('an envelope needs a label: a ClaimLevel, a SourceLabel, or UNKNOWN(reason)');
  if (value === 'UNKNOWN') fail('an envelope label UNKNOWN needs its reason: write unknown(reason)');
  if (!isEnvelopeLabel(value))
    fail(`an envelope label must be a ClaimLevel, a SourceLabel or UNKNOWN(reason), not ${JSON.stringify(value)}`);
  return value;
}

/**
 * Every UNKNOWN value inside `value`: a kernel UNKNOWN(reason), and text written `UNKNOWN` or
 * `UNKNOWN(reason)`, each with the path it sits at.
 */
export function unknownsIn(value: unknown, path: string = ''): {path: string, reason: string | null}[] {
  if (isUnknown(value)) return [{ path, reason: value.reason }];
  if (typeof value === 'string') {
    if (!UNKNOWN_TEXT.test(value)) return [];
    const reason = value.match(/^UNKNOWN\((.*)\)$/s)?.[1] ?? null;
    return [{ path, reason: reason && reason.trim() ? reason : null }];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => unknownsIn(item, `${path}[${index}]`));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => unknownsIn(item, path ? `${path}.${key}` : key));
  return [];
}

export const isRefusal = (value: unknown): value is RefusalEnvelope => isRecord(value) && value.refused === true;

function validateCite(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.length || !value.every(item => typeof item === 'string' && CITE.test(item)))
    fail(`${label}.cite lists at least one path, URI, commit or register entry, each without whitespace`);
}

function validateRefusal(value: Record<string, unknown>): RefusalEnvelope {
  const extra = Object.keys(value).filter(key => !REFUSAL_FIELDS.includes(key));
  const missing = REFUSAL_FIELDS.filter(key => !(key in value));
  if (extra.length || missing.length)
    fail(`a refusal envelope has exactly ${REFUSAL_FIELDS.join(', ')}${missing.length ? `; missing ${missing.join(', ')}` : ''}` +
      `${extra.length ? `; unexpected ${extra.join(', ')}` : ''}`);
  if (!isText(value.rule) || !RULE.test(value.rule)) fail('a refusal names its rule in kebab-case');
  if (!isText(value.because)) fail('a refusal says because what');
  validateCite(value.cite, 'a refusal');
  if (!isText(value.remedy)) fail('a refusal names its remedy');
  return value as unknown as RefusalEnvelope;
}

function validateClaim(value: Record<string, unknown>): ClaimEnvelope {
  const extra = Object.keys(value).filter(key => !CLAIM_FIELDS.includes(key));
  const missing = CLAIM_FIELDS.filter(key => !(key in value));
  if (extra.length || missing.length)
    fail(`a claim envelope has exactly ${CLAIM_FIELDS.join(', ')}${missing.length ? `; missing ${missing.join(', ')}` : ''}` +
      `${extra.length ? `; unexpected ${extra.join(', ')}` : ''}`);
  if (value.claim === undefined) fail('a claim envelope carries its claim');
  validateEnvelopeLabel(value.label);
  if (!(isUnknown(value.target) || value.target === REPOSITORY_TARGET || (typeof value.target === 'string' && GAME_TARGET.test(value.target))))
    fail(`an envelope target is a game's package (com.scottgames.<game>[@version]), "${REPOSITORY_TARGET}", or UNKNOWN(reason)`);
  validateCite(value.cite, 'a claim envelope');
  if (!isOneOf(ENVELOPE_STATUSES, value.status)) fail(`an envelope status is one of ${ENVELOPE_STATUSES.join(', ')}`);
  if (value.supersededBy !== null && !isText(value.supersededBy)) fail('supersededBy is null or names what replaced the claim');
  if (value.status === 'superseded' && !isText(value.supersededBy)) fail('a superseded claim names what superseded it');
  if (value.status === 'standing' && value.supersededBy !== null) fail('a standing claim names no successor');
  if (!Array.isArray(value.notMeasured) || !value.notMeasured.every(isText)) fail('notMeasured lists what the answer does not measure, as text');
  const unknowns = unknownsIn(value.claim, 'claim');
  if (unknowns.length && !value.notMeasured.length)
    fail(`the claim carries UNKNOWN at ${unknowns.slice(0, 3).map(item => item.path).join(', ')}${unknowns.length > 3 ? ', ...' : ''}, ` +
      'so notMeasured must name what is not measured');
  if (!isText(value.reproducer)) fail('an envelope names the command that reproduces it');
  return value as unknown as ClaimEnvelope;
}

/**
 * A claim or a refusal, checked; anything else is refused.
 */
export function validateClaimEnvelope(value: unknown): ClaimEnvelope | RefusalEnvelope {
  if (!isRecord(value)) fail('a claim envelope is an object');
  if (value.schema !== CLAIM_ENVELOPE_SCHEMA) fail(`a claim envelope's schema is ${CLAIM_ENVELOPE_SCHEMA}`);
  if ('refused' in value) {
    if (value.refused !== true) fail('refused is true or absent');
    return validateRefusal(value);
  }
  return validateClaim(value);
}

/**
 * A claim envelope from its eight fields, every one given; nothing is defaulted.
 */
export const claimEnvelope = (fields: Omit<ClaimEnvelope, 'schema'>): ClaimEnvelope => (validateClaimEnvelope({ schema: CLAIM_ENVELOPE_SCHEMA, ...fields }) as ClaimEnvelope);

/**
 * A refusal: the rule, because what, where the rule is written, and the remedy.
 */
export const refusalEnvelope = ({ rule, because, cite, remedy }: {rule: string, because: string, cite: string[], remedy: string}): RefusalEnvelope =>
  (validateClaimEnvelope({ schema: CLAIM_ENVELOPE_SCHEMA, refused: true, rule, because, cite, remedy }) as RefusalEnvelope);
