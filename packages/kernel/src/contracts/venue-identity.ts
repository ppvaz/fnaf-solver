/**
 * VenueIdentity: the world under a phone venue, as measured at preflight
 * (ADR 0002, the kernel's VenueIdentity; principle 12, "the world under a
 * venue is measured, not assumed. Drift refuses the run and demotes the
 * qualification"; Pedro's decision 1 of 2026-09-29).
 *
 * On 2026-09-27 the Play Store reinstalled FNaF 2 at 01:34, inside the
 * overnight window, and reset the save. The adb bridge compared only
 * `versionName+versionCode`, which an in-place reinstall of the same build
 * does not move. `lastUpdateTime` does, and so does a new OS build or a
 * different handset, so each of those is a field here.
 *
 * Pure data and comparison. Reading the identity off a phone is the adapter's
 * job (packages/play/src/phone/android-venue.ts); the device app
 * records it at preflight. A field that could not be read is `null` with its
 * reason in `unknown`, never a guess. The raw serial is never stored: the
 * handset is named by `handsetHash`, the first 16 hex of sha256(serial).
 * CONTRACT:venue-identity-v1. CONTRACT:venue-check-v1. CONTRACT:venue-binding-v1.
 */
import type {
  VenueBinding, VenueBindingSource, VenueBound, VenueCheck, VenueCheckStatus, VenueDriftField, VenueField, VenueFieldMove,
  VenueFieldUnread, VenueIdentity, VenueNoteField,
} from '../types.ts';
import { isList, isOneOf, isRecord } from '../labels.ts';

export const VENUE_IDENTITY_SCHEMA = 'venue-identity-v1';
export const VENUE_CHECK_SCHEMA = 'venue-check-v1';
export const VENUE_BINDING_SCHEMA = 'venue-binding-v1';

/** A move in any of these refuses a bound run and demotes a qualification. */
export const VENUE_DRIFT_FIELDS: readonly VenueDriftField[] = Object.freeze([
  'package', 'versionName', 'versionCode', 'firstInstallTime', 'lastUpdateTime',
  'buildFingerprint', 'securityPatch', 'handsetHash',
] as const);
/**
 * Recorded and compared, reported when they move, never refused. The Companion
 * is this project's own instrument and is reinstalled between sessions. The
 * time zone is recorded because dumpsys prints install and update times as
 * local wall-clock strings; a zone change therefore reads as a time drift,
 * which refuses (the safe direction).
 */
export const VENUE_NOTE_FIELDS: readonly VenueNoteField[] = Object.freeze(['companionVersion', 'timeZone'] as const);
export const VENUE_IDENTITY_FIELDS: readonly VenueField[] = Object.freeze([...VENUE_DRIFT_FIELDS, ...VENUE_NOTE_FIELDS]);
export const VENUE_CHECK_STATUSES: readonly VenueCheckStatus[] = Object.freeze(['UNBOUND', 'MATCH', 'DRIFT', 'UNKNOWN'] as const);
export const VENUE_BINDING_SOURCES: readonly VenueBindingSource[] = Object.freeze(['profile', 'winner', 'qualification'] as const);

const DUMPSYS_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** What a read field must look like; anything else is recorded as unread, not guessed. */
export const VENUE_FIELD_PATTERNS: Readonly<Record<VenueField, RegExp>> = Object.freeze({
  package: /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/,
  versionName: /^[^\s]{1,64}$/,
  versionCode: /^\d{1,20}$/,
  firstInstallTime: DUMPSYS_TIME,
  lastUpdateTime: DUMPSYS_TIME,
  buildFingerprint: /^[^\s]{1,256}$/,
  securityPatch: /^\d{4}-\d{2}-\d{2}$/,
  handsetHash: /^sha256-[0-9a-f]{16}$/,
  companionVersion: /^[^\s]{1,64}$/,
  timeZone: /^[A-Za-z0-9_+\-/]{1,64}$/,
});
const GAME_FIELDS = new Set<string>(['package', 'versionName', 'versionCode', 'firstInstallTime', 'lastUpdateTime']);
const OS_FIELDS = new Set<string>(['buildFingerprint', 'securityPatch']);

function fail(message: string): never { throw new TypeError(`venue: ${message}`); }
function bounded(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    fail(`${label} must be a non-empty string of at most ${max} characters`);
  return value;
}

/**
 * Validate a venue-identity-v1 record. It is closed: any other key, and in
 * particular a raw `serial`, is refused. With `requireKnown`, every drift
 * field must be read (a binding cannot bind to an unknown).
 */
export function validateVenueIdentity(value: unknown, { requireKnown = false, label = 'identity' }: {requireKnown?: boolean, label?: string} = {}): VenueIdentity {
  if (!isRecord(value) || value.schema !== VENUE_IDENTITY_SCHEMA) fail(`${label} is not ${VENUE_IDENTITY_SCHEMA}`);
  if (Object.hasOwn(value, 'serial'))
    fail(`${label} carries a raw serial; a venue names its handset only by handsetHash`);
  const allowed = new Set<string>(['schema', 'unknown', ...VENUE_IDENTITY_FIELDS]);
  const extra = Object.keys(value).filter(key => !allowed.has(key));
  if (extra.length) fail(`${label} has undeclared fields: ${extra.join(', ')}`);
  const unknown = value.unknown ?? {};
  if (!isRecord(unknown)) fail(`${label}.unknown must be an object of field -> reason`);
  for (const field of VENUE_IDENTITY_FIELDS) {
    if (!Object.hasOwn(value, field)) fail(`${label}.${field} is missing (null with a reason when unread)`);
    const reading = value[field];
    if (reading === null) {
      bounded(unknown[field], `${label}.unknown.${field}`);
      if (requireKnown && isOneOf(VENUE_DRIFT_FIELDS, field))
        fail(`${label}.${field} is unknown (${unknown[field]}); a binding needs every drift field read`);
    } else {
      if (typeof reading !== 'string' || !VENUE_FIELD_PATTERNS[field].test(reading))
        fail(`${label}.${field} is malformed: ${JSON.stringify(reading)}`);
      if (Object.hasOwn(unknown, field)) fail(`${label}.${field} is read and also listed as unknown`);
    }
  }
  for (const field of Object.keys(unknown))
    if (!isOneOf(VENUE_IDENTITY_FIELDS, field)) fail(`${label}.unknown names an undeclared field ${field}`);
  if (value.package === null) fail(`${label}.package must be named: it is the package that was queried`);
  return value as unknown as VenueIdentity;
}

/**
 * Build a venue-identity-v1 from readings. Each field is a string or null; a
 * null field takes its reason from `reasons` (a missing reason is refused).
 */
export function makeVenueIdentity(readings: Record<string, string | null>, reasons: Record<string, string> = {}): VenueIdentity {
  const record: Record<string, unknown> = { schema: VENUE_IDENTITY_SCHEMA };
  const unknown: Record<string, string> = {};
  for (const field of VENUE_IDENTITY_FIELDS) {
    const reading = readings?.[field] ?? null;
    record[field] = reading;
    if (reading === null) unknown[field] = reasons[field] ?? fail(`${field} is unread and has no reason`);
  }
  if (Object.keys(unknown).length) record.unknown = unknown;
  return Object.freeze(validateVenueIdentity(record));
}

/**
 * Validate a venue-binding-v1: a measured identity bound to a profile or a
 * winner. It is a separate record so that binding a venue changes neither a
 * profile's sha256 nor a committed winner. A qualification binds its venue
 * itself (qualification-v2).
 */
export function validateVenueBinding(value: unknown): VenueBinding {
  if (!isRecord(value) || value.schema !== VENUE_BINDING_SCHEMA) fail(`binding is not ${VENUE_BINDING_SCHEMA}`);
  if (!isRecord(value.subject) || !isOneOf(['profile', 'winner'], value.subject.kind))
    fail('binding.subject.kind must be profile or winner');
  bounded(value.subject.id, 'binding.subject.id');
  validateVenueIdentity(value.identity, { requireKnown: true, label: 'binding.identity' });
  bounded(value.boundBy, 'binding.boundBy');
  if (typeof value.boundAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.boundAt))
    fail('binding.boundAt must be a YYYY-MM-DD date');
  bounded(value.evidenceId, 'binding.evidenceId');
  return value as unknown as VenueBinding;
}

/**
 * Select the identities a run is bound to. A qualification-v2 binds through
 * its own `venue`; a venue-binding-v1 applies when its subject is this run's
 * profile or winner, and one that names another subject is refused rather
 * than ignored. The qualification's schema is checked by validateQualification,
 * which callers run first.
 */
export function venueBindingsFor({ profileId = null, winnerHash = null, qualification = null, bindings = [] }:
  {profileId?: string | null, winnerHash?: string | null, qualification?: {schema: string, evidenceId: string, venue?: unknown} | null,
    bindings?: readonly unknown[]} = {}): VenueBound[] {
  if (!isList(bindings)) fail('bindings must be an array of venue-binding-v1 records');
  const selected: VenueBound[] = [];
  if (qualification?.schema === 'qualification-v2') {
    const identity = validateVenueIdentity(qualification.venue, { requireKnown: true, label: 'qualification.venue' });
    selected.push({ source: 'qualification', id: qualification.evidenceId, identity });
  }
  for (const record of bindings) {
    const binding = validateVenueBinding(record);
    const { kind, id } = binding.subject;
    const own = kind === 'profile' ? profileId : winnerHash;
    if (own === null || own === undefined)
      fail(`venue binding ${binding.evidenceId} names ${kind} ${id}, and this run has no ${kind} to match it`);
    if (own !== id)
      fail(`venue binding ${binding.evidenceId} names ${kind} ${id}; this run uses ${kind} ${own}`);
    selected.push({ source: kind, id, identity: binding.identity });
  }
  return selected;
}

const describe = (value: string | null) => (value === null ? 'UNKNOWN' : value);

function remedyFor(drift: readonly VenueFieldMove[]) {
  const fields = new Set<string>(drift.map(item => item.field));
  const parts = ['re-qualify on the observed venue (a new qualification-v2, or a venue-binding-v1 ' +
    'over the identity this preflight recorded, from a measured run)'];
  if ([...fields].some(field => GAME_FIELDS.has(field))) {
    const bound = drift.find(item => GAME_FIELDS.has(item.field));
    const target = bound ? ` bound by ${bound.source} ${bound.id}` : '';
    parts.push(`or roll the game back to the build${target} and keep Play auto-update off for it`);
  }
  if ([...fields].some(field => OS_FIELDS.has(field)))
    parts.push('(an OS build cannot be rolled back: only re-qualifying clears it)');
  if (fields.has('handsetHash'))
    parts.push('(a different handset: connect the bound one, or qualify this one)');
  return parts.join(' ');
}

/**
 * Compare an observed identity with every identity the run is bound to.
 *
 * UNBOUND: nothing binds a venue; the observed identity is recorded and the
 * run is not refused. DRIFT: a drift field moved; the run is refused and the
 * message names each field, from what to what. UNKNOWN: bound, but a drift
 * field could not be read, so it cannot be cleared. MATCH: every bound drift
 * field is equal. Note fields that move are reported under `notes`.
 */
export function compareVenueIdentity({ observed = null, bindings = [] }: {observed?: unknown, bindings?: readonly unknown[]} = {}): VenueCheck {
  const seen = observed === null ? null : validateVenueIdentity(observed, { label: 'observed' });
  if (!isList(bindings)) fail('bindings must be an array');
  const bound: VenueBound[] = [];
  const drift: VenueFieldMove[] = [];
  const unknown: VenueFieldUnread[] = [];
  const notes: VenueFieldMove[] = [];
  for (const binding of bindings) {
    if (!isRecord(binding) || !isOneOf(VENUE_BINDING_SOURCES, binding.source))
      fail(`binding source must be one of ${VENUE_BINDING_SOURCES.join(', ')}`);
    const id = bounded(binding.id, 'binding id');
    const identity = validateVenueIdentity(binding.identity, { requireKnown: true, label: `${binding.source} ${id}` });
    const where = { source: binding.source, id };
    bound.push({ ...where, identity });
    for (const field of VENUE_IDENTITY_FIELDS) {
      const from = identity[field];
      const to = seen ? seen[field] : null;
      if (from === null) continue;
      if (isOneOf(VENUE_NOTE_FIELDS, field)) {
        if (to !== null && to !== from) notes.push({ field, from, to, ...where });
      } else if (to === null) {
        // A null field is read only with its reason in `unknown` (validateVenueIdentity).
        const reason = seen ? seen.unknown?.[field] ?? fail(`observed.${field} is unread without a reason`)
          : 'no venue identity was observed';
        unknown.push({ field, reason, ...where });
      } else if (to !== from) drift.push({ field, from, to, ...where });
    }
  }
  const status = bound.length === 0 ? 'UNBOUND' : drift.length ? 'DRIFT' : unknown.length ? 'UNKNOWN' : 'MATCH';
  const named = bound.map(item => `${item.source} ${item.id}`).join(', ');
  const unread = seen ? VENUE_DRIFT_FIELDS.filter(field => seen[field] === null) : [];
  let message;
  if (status === 'UNBOUND') {
    message = seen
      ? 'unbound: the observed venue identity is recorded; no profile, winner or qualification binds one, so drift is not checked'
      : 'unbound, and no venue identity was observed';
    if (unread.length) message += ` (unread: ${unread.join(', ')})`;
  } else if (status === 'DRIFT') {
    message = `venue drifted from ${named}: ` +
      drift.map(item => `${item.field} ${describe(item.from)} -> ${describe(item.to)}`).join('; ');
  } else if (status === 'UNKNOWN') {
    message = `venue bound by ${named} cannot be compared: ` +
      unknown.map(item => `${item.field} unread (${item.reason})`).join('; ');
  } else message = `venue matches ${named}`;
  if (notes.length)
    message += `; noted, not refused: ${notes.map(item => `${item.field} ${item.from} -> ${item.to}`).join('; ')}`;
  return Object.freeze({
    schema: VENUE_CHECK_SCHEMA, status, refuses: status === 'DRIFT',
    observed: seen, bindings: bound.map(item => ({ source: item.source, id: item.id })),
    drift, unknown, notes, message,
    remedy: status === 'DRIFT' ? remedyFor(drift)
      : status === 'UNKNOWN' ? 'read the identity again (adb, dumpsys package, getprop); the run holds until every bound field is compared'
        : null,
  });
}

/**
 * Validate a stored venue-check-v1 (for readers of preflight records).
 */
export function validateVenueCheck(value: unknown): VenueCheck {
  if (!isRecord(value) || value.schema !== VENUE_CHECK_SCHEMA) fail(`check is not ${VENUE_CHECK_SCHEMA}`);
  if (!isOneOf(VENUE_CHECK_STATUSES, value.status)) fail('check.status is not a venue check status');
  if (value.refuses !== (value.status === 'DRIFT')) fail('check.refuses must be true exactly when status is DRIFT');
  if (value.observed !== null) validateVenueIdentity(value.observed, { label: 'check.observed' });
  for (const key of ['bindings', 'drift', 'unknown', 'notes'])
    if (!isList(value[key])) fail(`check.${key} must be an array`);
  bounded(value.message, 'check.message', 4096);
  return value as unknown as VenueCheck;
}
