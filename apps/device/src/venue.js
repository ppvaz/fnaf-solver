/**
 * Venue identity at the device app's edge: which identities a run is bound
 * to, and how preflight prints what it observed. The comparison itself is
 * core's (`compareVenueIdentity`); reading it off the phone is the adapter's
 * (`readVenueIdentity`) through the adb bridge's fixed queries.
 * CONTRACT:venue-binding-v1.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateQualification, venueBindingsFor } from '@sixam/core/contracts';

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
