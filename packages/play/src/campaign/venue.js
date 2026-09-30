/**
 * Venue identity at the device app's edge: which identities a run is bound
 * to, how preflight prints what it observed, and how an observed identity is
 * bound to a profile. The comparison itself is core's
 * (`compareVenueIdentity`); reading it off the phone is the adapter's
 * (`readVenueIdentity`) through the adb bridge's fixed queries.
 *
 * A live run needs a binding (ADR 0002, decision 1: "refuses on drift from
 * the bound profile"). With none, drift cannot be checked, which is the
 * 2026-09-27 reinstall again, so a live run refuses an unbound venue and the
 * remedy names the command that records a binding from the phone. The values
 * are never invented: a binding holds only what a preflight read.
 * CONTRACT:venue-binding-v1.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stableHash, validateQualification, validateVenueBinding, venueBindingsFor } from '@sixam/kernel/contracts';
import { preflightVenue, unboundVenueRemedy } from './adb-bridge.js';

/**
 * The bindings for one run: a qualification-v2's own venue, plus every
 * venue-binding-v1 file named with --venue-binding, each of which must name
 * this run's profile or winner. An invalid qualification binds nothing here;
 * the campaign preflight refuses it with its own check.
 * @param {{profileId: string, winnerHash?: string | null, qualification?: any, paths?: string[]}} options
 */
export async function loadVenueBindings({ profileId, winnerHash = null, qualification = null, paths = [] }) {
  let valid = null;
  if (qualification) {
    try { valid = validateQualification(qualification); } catch { valid = null; }
  }
  const bindings = [];
  for (const path of paths) {
    try { bindings.push(JSON.parse(await readFile(resolve(path), 'utf8'))); }
    catch (error) { throw new Error(`venue binding ${path} is not readable: ${error.message}`); }
  }
  return venueBindingsFor({ profileId, winnerHash, qualification: valid, bindings });
}

/**
 * What a dry run says about the venue: it opens no phone, so the identity is
 * UNKNOWN with that reason, and it names what a live run would compare the
 * phone with, or that a live run would refuse because nothing binds it.
 * @param {{bindings: {source: string, id: string}[], profileId: string}} options
 */
export function dryRunVenue({ bindings, profileId }) {
  const bound = bindings.map(item => `${item.source} ${item.id}`);
  return Object.freeze({
    status: 'UNKNOWN', reason: 'dry run: no phone is opened, so the venue identity is neither read nor compared',
    bound,
    live: bound.length ? `a live run compares the phone with ${bound.join(', ')} and refuses on drift`
      : `a live run refuses: no profile, winner or qualification binds a venue identity. Remedy: ${unboundVenueRemedy(profileId)}`,
  });
}

/**
 * Bind the identity a preflight recorded to its profile, as a venue-binding-v1.
 * Refused when the installed build is not the profile's, when the identity
 * drifted from an existing binding (binding it would bless the change the
 * refusal exists to catch), and when a drift field is unread.
 * @param {{preflight: any, profileId: string, boundBy: string, boundAt: string}} options
 */
export function bindVenueFromPreflight({ preflight, profileId, boundBy, boundAt }) {
  const venue = preflightVenue(preflight);
  if (!venue?.observed) throw new Error('venue binding refused: this preflight observed no venue identity');
  const build = preflight.checks?.find(item => item.id === 'target-build');
  if (build?.status !== 'PASS')
    throw new Error(`venue binding refused: the installed build is not profile ${profileId}'s ` +
      `(${JSON.stringify(build?.detail ?? 'target-build unchecked')})`);
  if (venue.status === 'DRIFT' || venue.status === 'UNKNOWN')
    throw new Error(`venue binding refused: ${venue.message}; re-qualify on this venue rather than bind it`);
  const identity = venue.observed;
  return Object.freeze(validateVenueBinding({ schema: 'venue-binding-v1', subject: { kind: 'profile', id: profileId },
    identity, boundBy, boundAt, evidenceId: `venue-binding-${profileId}-${stableHash(identity)}` }));
}

/**
 * Plain-text lines for a venue-check-v1, as `device:preflight` prints them.
 * @param {any} venue
 */
export function renderVenueCheck(venue) {
  if (!venue) return 'venue NOT RECORDED: this preflight predates venue identity (device-preflight-v1)';
  // The status leads the line, so the message's own opening word is dropped.
  const lines = [`venue ${venue.status}: ${String(venue.message).replace(/^(?:unbound: |venue )/, '')}`];
  const seen = venue.observed;
  if (seen) {
    const read = field => seen[field] ?? `UNKNOWN (${seen.unknown?.[field] ?? 'no reason'})`;
    lines.push(`  game      ${seen.package} ${read('versionName')} code ${read('versionCode')}`);
    lines.push(`  installed ${read('firstInstallTime')}  updated ${read('lastUpdateTime')}  zone ${read('timeZone')}`);
    lines.push(`  os        ${read('buildFingerprint')}  patch ${read('securityPatch')}`);
    lines.push(`  handset   ${read('handsetHash')}  companion ${read('companionVersion')}`);
  }
  if (venue.remedy) lines.push(`  remedy    ${venue.remedy}`);
  return lines.join('\n');
}
