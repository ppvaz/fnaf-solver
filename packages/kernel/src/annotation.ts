/**
 * Annotation (ADR 0002 kernel, frozen): {subject, instrument@version,
 * class | measure | tag, value, inputs: Hash[], by, status}. The subject may be
 * a GameRun, a set of them, a Census, a rule g###, a policy, a calibration or a
 * chronicle entry. Status is standing, superseded (by another) or retracted;
 * a retraction stays discoverable.
 */
import { fail, isOneOf, isRecord, isText } from './labels.ts';
import type { Annotation } from './types.ts';

export const ANNOTATION_KINDS = Object.freeze(['class', 'measure', 'tag'] as const);
export const ANNOTATION_STATUSES = Object.freeze(['standing', 'superseded', 'retracted'] as const);
export const SUBJECT_KINDS = Object.freeze(['GameRun', 'GameRuns', 'Census', 'Rule', 'Policy', 'Calibration', 'ChronicleEntry'] as const);
const FIELDS: readonly string[] = Object.freeze(['subject', 'instrument', 'value', 'inputs', 'by', 'status', 'supersededBy', ...ANNOTATION_KINDS]);
/** A content hash as the repository writes them: sha256 hex, or the fnv1a stableHash of kernel/contracts. */
const HASH = /^(?:[0-9a-f]{64}|fnv1a-[0-9a-f]{8})$/;

function validateSubject(subject: unknown) {
  if (!isRecord(subject) || !isOneOf(SUBJECT_KINDS, subject.kind)) fail(`an annotation's subject kind must be one of ${SUBJECT_KINDS.join(', ')}`);
  if (subject.kind === 'GameRuns') {
    if (Object.keys(subject).some(key => key !== 'kind' && key !== 'ids') || !Array.isArray(subject.ids) ||
        !subject.ids.length || !subject.ids.every(isText))
      fail('a GameRuns subject is {kind, ids} with at least one id');
    return;
  }
  if (Object.keys(subject).some(key => key !== 'kind' && key !== 'id') || !isText(subject.id)) fail(`a ${subject.kind} subject is {kind, id}`);
  if (subject.kind === 'Rule' && !/^g\d+$/.test(subject.id)) fail('a Rule subject names an event group g###');
}

export function validateAnnotation(value: unknown): Annotation {
  if (!isRecord(value)) fail('an annotation is an object');
  const extra = Object.keys(value).filter(key => !FIELDS.includes(key));
  if (extra.length) fail(`an annotation has no ${extra.join(', ')}`);
  validateSubject(value.subject);
  if (!isText(value.instrument) || !/^[^@\s]+@[^@\s]+$/.test(value.instrument)) fail('an annotation names its instrument as name@version');
  const kinds = ANNOTATION_KINDS.filter(kind => kind in value);
  if (kinds.length !== 1 || !isText(value[kinds[0]])) fail('an annotation is exactly one of a class, a measure or a tag, by name');
  if (!('value' in value)) fail('an annotation carries a value');
  if (!Array.isArray(value.inputs) || !value.inputs.every(hash => typeof hash === 'string' && HASH.test(hash)))
    fail('an annotation lists the content hash of every input');
  if (!isText(value.by)) fail('an annotation names who wrote it');
  if (!isOneOf(ANNOTATION_STATUSES, value.status)) fail(`an annotation's status is one of ${ANNOTATION_STATUSES.join(', ')}`);
  if ((value.status === 'superseded') !== isText(value.supersededBy)) fail('supersededBy is named exactly when the status is superseded');
  return value as unknown as Annotation;
}
