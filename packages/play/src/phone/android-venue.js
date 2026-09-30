/**
 * Reading a venue-identity-v1 off Android's own text, host side.
 *
 * The inputs are the outputs of fixed read-only commands the device app runs
 * through its closed adb port (`dumpsys package <pkg>`, three `getprop`
 * reads): this module parses text and never opens adb. `dumpsys package`
 * prints `versionCode=` and `versionName=` in the package block,
 * `lastUpdateTime=` there too, and `firstInstallTime=` under each `User N:`
 * line on current Android (at package level on older releases); the first
 * occurrence inside the queried package's block is taken, which is user 0.
 * The two times are dumpsys's local wall-clock strings (`yyyy-MM-dd
 * HH:mm:ss`, no zone), so the zone is read beside them.
 *
 * The serial is hashed here and dropped: `handsetHash` is the first 16 hex of
 * sha256 over the serial's UTF-8 bytes, the truncation the repository uses for
 * content ids. A field that cannot be read is null with a reason.
 * CONTRACT:venue-identity-v1.
 */
import { createHash } from 'node:crypto';
import { makeVenueIdentity, VENUE_FIELD_PATTERNS } from '@sixam/kernel/contracts';

const TIME = '(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2})';

/** @param {string} serial */
export function handsetHash(serial) {
  if (typeof serial !== 'string' || serial.length === 0) throw new TypeError('handsetHash needs a serial');
  return `sha256-${createHash('sha256').update(serial, 'utf8').digest('hex').slice(0, 16)}`;
}

/**
 * The lines of `dumpsys package` that describe `packageName`: from its
 * `Package [name]` header to the next package header or unindented section.
 * Output with no header (a bare field dump) is read whole.
 * @param {string} text
 * @param {string} packageName
 */
function packageBlock(text, packageName) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim().startsWith(`Package [${packageName}]`));
  if (start < 0) return text;
  const indent = lines[start].length - lines[start].trimStart().length;
  const end = lines.findIndex((line, index) => index > start && line.trim().length > 0 &&
    (line.length - line.trimStart().length <= indent));
  return lines.slice(start, end < 0 ? lines.length : end).join('\n');
}

/**
 * @param {string} text `dumpsys package <packageName>` output
 * @param {string} packageName
 * @returns {{versionName: string | null, versionCode: string | null,
 *   firstInstallTime: string | null, lastUpdateTime: string | null}}
 */
export function parseDumpsysPackage(text, packageName) {
  if (typeof text !== 'string') throw new TypeError('dumpsys package output must be text');
  const block = packageBlock(text, packageName);
  const first = pattern => block.match(pattern)?.[1] ?? null;
  return {
    versionName: first(/\bversionName=([^\s]+)/),
    versionCode: first(/\bversionCode=(\d+)\b/),
    firstInstallTime: first(new RegExp(`\\bfirstInstallTime=${TIME}`)),
    lastUpdateTime: first(new RegExp(`\\blastUpdateTime=${TIME}`)),
  };
}

/**
 * One `getprop NAME` answer: a single trimmed line, or null when empty.
 * @param {string} text
 */
export function parseGetprop(text) {
  if (typeof text !== 'string') return null;
  const value = text.trim();
  return value.length === 0 || /[\r\n]/.test(value) ? null : value;
}

/**
 * @typedef {{ok: boolean, stdout?: string, stderr?: string}} CommandRead
 */

const failed = (read, what) => `${what} failed: ${String(read?.stderr ?? '').trim().slice(0, 120) || 'no output'}`;

/**
 * Assemble the identity from the raw reads. `companion` is null when the
 * preflight was told not to require the Companion (it is then not queried).
 * @param {{packageName: string, serial: string | null, game: CommandRead,
 *   fingerprint: CommandRead, securityPatch: CommandRead, timeZone: CommandRead,
 *   companion?: CommandRead | null, companionPackage?: string}} reads
 */
export function readVenueIdentity({ packageName, serial, game, fingerprint, securityPatch, timeZone,
  companion = null, companionPackage = 'com.ppvaz.fnafcompanion' }) {
  /** @type {Record<string, string | null>} */
  const readings = { package: packageName };
  /** @type {Record<string, string>} */
  const reasons = {};
  if (game?.ok) {
    const parsed = parseDumpsysPackage(String(game.stdout ?? ''), packageName);
    for (const [field, value] of Object.entries(parsed)) {
      readings[field] = value;
      if (value === null) reasons[field] = `dumpsys package ${packageName} printed no ${field}`;
    }
  } else {
    for (const field of ['versionName', 'versionCode', 'firstInstallTime', 'lastUpdateTime'])
      reasons[field] = failed(game, `dumpsys package ${packageName}`);
  }
  /** @type {[string, CommandRead, string][]} */
  const props = [['buildFingerprint', fingerprint, 'ro.build.fingerprint'],
    ['securityPatch', securityPatch, 'ro.build.version.security_patch'],
    ['timeZone', timeZone, 'persist.sys.timezone']];
  for (const [field, read, prop] of props) {
    readings[field] = read?.ok ? parseGetprop(String(read.stdout ?? '')) : null;
    if (readings[field] === null)
      reasons[field] = read?.ok ? `getprop ${prop} is empty` : failed(read, `getprop ${prop}`);
  }
  if (companion === null) {
    readings.companionVersion = null;
    reasons.companionVersion = 'Companion not queried (preflight does not require it)';
  } else if (companion.ok) {
    const parsed = parseDumpsysPackage(String(companion.stdout ?? ''), companionPackage);
    readings.companionVersion = parsed.versionName && parsed.versionCode
      ? `${parsed.versionName}+${parsed.versionCode}` : null;
    if (readings.companionVersion === null)
      reasons.companionVersion = `dumpsys package ${companionPackage} printed no version (not installed?)`;
  } else {
    readings.companionVersion = null;
    reasons.companionVersion = failed(companion, `dumpsys package ${companionPackage}`);
  }
  if (typeof serial === 'string' && serial.length > 0) readings.handsetHash = handsetHash(serial);
  else { readings.handsetHash = null; reasons.handsetHash = 'no device serial was selected'; }
  // A reading in a shape this contract does not know is recorded as unread
  // with the text that was seen, so an odd handset holds instead of crashing.
  for (const [field, value] of Object.entries(readings)) {
    if (field === 'package' || value === null || VENUE_FIELD_PATTERNS[field]?.test(value)) continue;
    readings[field] = null;
    reasons[field] = `unrecognised ${field} text: ${JSON.stringify(String(value).slice(0, 60))}`;
  }
  return makeVenueIdentity(readings, reasons);
}
