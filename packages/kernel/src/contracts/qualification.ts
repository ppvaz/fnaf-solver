/**
 * Qualification: the retained verdict the campaign preflight binds to a
 * winner and an engine. `qualification-v1` binds those two hashes and not
 * the handset; `qualification-v2` is v1 plus `venue`, the venue-identity-v1
 * it was measured on, with at least the handset hash and the build
 * fingerprint read. Both are read; v2 is what `bindQualificationVenue`
 * writes. Any drift of a v2's venue demotes it from QUALIFIED to CANDIDATE
 * (ADR 0002, principle 12). Nothing persists that demotion: it is reported
 * by `qualificationStanding` every time the venue is observed.
 * CONTRACT:qualification-v1. CONTRACT:qualification-v2.
 */
import { compareVenueIdentity, validateVenueIdentity } from './venue-identity.ts';

export const QUALIFICATION_SCHEMAS = Object.freeze(['qualification-v1', 'qualification-v2']);
export const QUALIFICATION_LIFECYCLES = Object.freeze(['QUALIFIED', 'CANDIDATE']);

// Retained-run contracts. They lived in packages/runtime beside the fixture
// scheduler and supervisor until 2026-09-25; the campaign preflight, the
// artifact runner and the evidence index read them, so they belong in core.
export function validateQualification(value) {
  if (!value || !QUALIFICATION_SCHEMAS.includes(value.schema) || typeof value.policyHash !== 'string' ||
      typeof value.modelHash !== 'string' || !Number.isInteger(value.sampleCount) || value.sampleCount < 1 ||
      !['PASS', 'FAIL', 'INCONCLUSIVE'].includes(value.verdict) ||
      typeof value.evidenceId !== 'string' || value.evidenceId.length === 0)
    throw new TypeError('qualification is incomplete');
  if (value.schema === 'qualification-v2') {
    try {
      validateVenueIdentity(value.venue, { requireKnown: true, label: 'qualification.venue' });
    } catch (error) {
      throw new TypeError(`qualification is incomplete: ${error.message}`);
    }
  }
  return value;
}

/**
 * Write a qualification-v2 from a v1 and the venue it was measured on. Only a
 * v1 is accepted: a v2 already names its venue, and a new venue is a new
 * qualification, not an edit of the old one.
 * @param qualification a qualification-v1
 * @param venue the venue-identity-v1 recorded by that run's preflight
 */
export function bindQualificationVenue(qualification: any, venue: any) {
  validateQualification(qualification);
  if (qualification.schema !== 'qualification-v1')
    throw new TypeError(`qualification ${qualification.evidenceId} already binds a venue; re-qualify to bind another`);
  const bound = { ...qualification, schema: 'qualification-v2', venue };
  return Object.freeze(validateQualification(bound));
}

/**
 * Where a qualification stands on the observed venue.
 */
export function qualificationStanding({ qualification, observed = null }: {qualification: any, observed?: any}) {
  validateQualification(qualification);
  const earned = qualification.verdict === 'PASS' && qualification.claimLevel === 'DEVICE_MEASURED';
  if (qualification.schema === 'qualification-v1') {
    return Object.freeze({
      evidenceId: qualification.evidenceId, schema: qualification.schema,
      lifecycle: earned ? 'QUALIFIED' : 'CANDIDATE', venue: 'UNBOUND', demoted: false, demotedFrom: null,
      check: null,
      message: 'qualification-v1 binds no venue identity: unbound; the observed venue is recorded, not compared',
    });
  }
  const check = compareVenueIdentity({ observed, bindings: [
    { source: 'qualification', id: qualification.evidenceId, identity: qualification.venue },
  ] });
  const demoted = earned && check.status === 'DRIFT';
  return Object.freeze({
    evidenceId: qualification.evidenceId, schema: qualification.schema,
    lifecycle: earned && !demoted ? 'QUALIFIED' : 'CANDIDATE', venue: check.status,
    demoted, demotedFrom: demoted ? 'QUALIFIED' : null, check,
    message: demoted ? `demoted QUALIFIED -> CANDIDATE: ${check.message}` : check.message,
  });
}
