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
import type { VenueIdentity } from '../types.ts';

export const VENUE_IDENTITY_SCHEMA = 'venue-identity-v1';
export const VENUE_CHECK_SCHEMA = 'venue-check-v1';
export const VENUE_BINDING_SCHEMA = 'venue-binding-v1';

/** A move in any of these refuses a bound run and demotes a qualification. */
export const VENUE_DRIFT_FIELDS = Object.freeze([
  'package', 'versionName', 'versionCode', 'firstInstallTime', 'lastUpdateTime',
  'buildFingerprint', 'securityPatch', 'handsetHash',
]);
/**
 * Recorded and compared, reported when they move, never refused. The Companion
 * is this project's own instrument and is reinstalled between sessions. The
 * time zone is recorded because dumpsys prints install and update times as
 * local wall-clock strings; a zone change therefore reads as a time drift,
 * which refuses (the safe direction).
 */
export const VENUE_NOTE_FIELDS = Object.freeze(['companionVersion', 'timeZone']);
export const VENUE_IDENTITY_FIELDS = Object.freeze([...VENUE_DRIFT_FIELDS, ...VENUE_NOTE_FIELDS]);
export const VENUE_CHECK_STATUSES = Object.freeze(['UNBOUND', 'MATCH', 'DRIFT', 'UNKNOWN']);
export const VENUE_BINDING_SOURCES = Object.freeze(['profile', 'winner', 'qualification']);

const DUMPSYS_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** What a read field must look like; anything else is recorded as unread, not guessed. */
export const VENUE_FIELD_PATTERNS = Object.freeze({
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
const GAME_FIELDS = new Set(['package', 'versionName', 'versionCode', 'firstInstallTime', 'lastUpdateTime']);
const OS_FIELDS = new Set(['buildFingerprint', 'securityPatch']);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new TypeError(`venue: ${message}`); };
const bounded = (value, label, max = 256) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    fail(`${label} must be a non-empty string of at most ${max} characters`);
  return value;
};

/**
 * Validate a venue-identity-v1 record. It is closed: any other key, and in
 * particular a raw `serial`, is refused. With `requireKnown`, every drift
 * field must be read (a binding cannot bind to an unknown).
 */
export function validateVenueIdentity(value: any, { requireKnown = false, label = 'identity' }: {requireKnown?: boolean, label?: string} = {}): VenueIdentity {
  if (!isRecord(value) || value.schema !== VENUE_IDENTITY_SCHEMA) fail(`${label} is not ${VENUE_IDENTITY_SCHEMA}`);
  if (Object.hasOwn(value, 'serial'))
    fail(`${label} carries a raw serial; a venue names its handset only by handsetHash`);
  const allowed = new Set(['schema', 'unknown', ...VENUE_IDENTITY_FIELDS]);
  const extra = Object.keys(value).filter(key => !allowed.has(key));
  if (extra.length) fail(`${label} has undeclared fields: ${extra.join(', ')}`);
  const unknown = value.unknown ?? {};
  if (!isRecord(unknown)) fail(`${label}.unknown must be an object of field -> reason`);
  for (const field of VENUE_IDENTITY_FIELDS) {
    if (!Object.hasOwn(value, field)) fail(`${label}.${field} is missing (null with a reason when unread)`);
    const reading = value[field];
    if (reading === null) {
      bounded(unknown[field], `${label}.unknown.${field}`);
      if (requireKnown && VENUE_DRIFT_FIELDS.includes(field))
        fail(`${label}.${field} is unknown (${unknown[field]}); a binding needs every drift field read`);
    } else {
      if (typeof reading !== 'string' || !VENUE_FIELD_PATTERNS[field].test(reading))
        fail(`${label}.${field} is malformed: ${JSON.stringify(reading)}`);
      if (Object.hasOwn(unknown, field)) fail(`${label}.${field} is read and also listed as unknown`);
    }
  }
  for (const field of Object.keys(unknown))
    if (!VENUE_IDENTITY_FIELDS.includes(field)) fail(`${label}.unknown names an undeclared field ${field}`);
  if (value.package === null) fail(`${label}.package must be named: it is the package that was queried`);
  return value;
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
export function validateVenueBinding(value: any) {
  if (!isRecord(value) || value.schema !== VENUE_BINDING_SCHEMA) fail(`binding is not ${VENUE_BINDING_SCHEMA}`);
  if (!isRecord(value.subject) || !['profile', 'winner'].includes(value.subject.kind))
    fail('binding.subject.kind must be profile or winner');
  bounded(value.subject.id, 'binding.subject.id');
  validateVenueIdentity(value.identity, { requireKnown: true, label: 'binding.identity' });
  bounded(value.boundBy, 'binding.boundBy');
  if (typeof value.boundAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.boundAt))
    fail('binding.boundAt must be a YYYY-MM-DD date');
  bounded(value.evidenceId, 'binding.evidenceId');
  return value;
}

/**
 * Select the identities a run is bound to. A qualification-v2 binds through
 * its own `venue`; a venue-binding-v1 applies when its subject is this run's
 * profile or winner, and one that names another subject is refused rather
 * than ignored. The qualification's schema is checked by validateQualification,
 * which callers run first.
 */
export function venueBindingsFor({ profileId = null, winnerHash = null, qualification = null, bindings = [] }: {profileId?: string | null, winnerHash?: string | null, qualification?: any, bindings?: any[]} = {}): {source: string, id: string, identity: any}[] {
  if (!Array.isArray(bindings)) fail('bindings must be an array of venue-binding-v1 records');
  const selected = [];
  if (qualification?.schema === 'qualification-v2') {
    validateVenueIdentity(qualification.venue, { requireKnown: true, label: 'qualification.venue' });
    selected.push({ source: 'qualification', id: qualification.evidenceId, identity: qualification.venue });
  }
  for (const binding of bindings) {
    validateVenueBinding(binding);
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

const describe = value => (value === null ? 'UNKNOWN' : value);

function remedyFor(drift) {
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
export function compareVenueIdentity({ observed = null, bindings = [] }: {observed?: any, bindings?: {source: string, id: string, identity: any}[]} = {}) {
  if (observed !== null) validateVenueIdentity(observed, { label: 'observed' });
  if (!Array.isArray(bindings)) fail('bindings must be an array');
  const drift = [];
  const unknown = [];
  const notes = [];
  for (const binding of bindings) {
    if (!isRecord(binding) || !VENUE_BINDING_SOURCES.includes(binding.source))
      fail(`binding source must be one of ${VENUE_BINDING_SOURCES.join(', ')}`);
    bounded(binding.id, 'binding id');
    validateVenueIdentity(binding.identity, { requireKnown: true, label: `${binding.source} ${binding.id}` });
    for (const field of VENUE_IDENTITY_FIELDS) {
      const from = binding.identity[field];
      const to = observed ? observed[field] : null;
      if (from === null) continue;
      const where = { source: binding.source, id: binding.id };
      if (VENUE_NOTE_FIELDS.includes(field)) {
        if (to !== null && to !== from) notes.push({ field, from, to, ...where });
      } else if (to === null) {
        unknown.push({ field, reason: observed ? observed.unknown[field] : 'no venue identity was observed', ...where });
      } else if (to !== from) drift.push({ field, from, to, ...where });
    }
  }
  const status = bindings.length === 0 ? 'UNBOUND' : drift.length ? 'DRIFT' : unknown.length ? 'UNKNOWN' : 'MATCH';
  const named = bindings.map(item => `${item.source} ${item.id}`).join(', ');
  const unread = observed ? VENUE_DRIFT_FIELDS.filter(field => observed[field] === null) : [];
  let message;
  if (status === 'UNBOUND') {
    message = observed
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
    observed, bindings: bindings.map(item => ({ source: item.source, id: item.id })),
    drift, unknown, notes, message,
    remedy: status === 'DRIFT' ? remedyFor(drift)
      : status === 'UNKNOWN' ? 'read the identity again (adb, dumpsys package, getprop); the run holds until every bound field is compared'
        : null,
  });
}

/**
 * Validate a stored venue-check-v1 (for readers of preflight records).
 */
export function validateVenueCheck(value: any) {
  if (!isRecord(value) || value.schema !== VENUE_CHECK_SCHEMA) fail(`check is not ${VENUE_CHECK_SCHEMA}`);
  if (!VENUE_CHECK_STATUSES.includes(value.status)) fail('check.status is not a venue check status');
  if (value.refuses !== (value.status === 'DRIFT')) fail('check.refuses must be true exactly when status is DRIFT');
  if (value.observed !== null) validateVenueIdentity(value.observed, { label: 'check.observed' });
  for (const key of ['bindings', 'drift', 'unknown', 'notes'])
    if (!Array.isArray(value[key])) fail(`check.${key} must be an array`);
  bounded(value.message, 'check.message', 4096);
  return value;
}
