/**
 * The Companion's versioned status line and endpoint handshake, host side.
 *
 * `STATUS <token>` answers `OK <line>`: one run of `key=value` tokens in a
 * fixed order whose first is `schema=companion-status-v1`
 * (android/companion CompanionStatus.java). A missing or ambiguous
 * measurement is `UNKNOWN` on the wire and `null` here -- never a guess.
 * The endpoint (port, abstract socket, per-session token) is handed over in
 * `files/companion-endpoint.properties` (schema `companion-endpoint-v1`), read
 * with `run-as`, so discovery no longer depends on a logcat line surviving a
 * night in the ring buffer. Both sides are held to
 * tools/device/testdata/companion-status-v1.txt.
 * CONTRACT:companion-status-v1.
 */

export const COMPANION_STATUS_SCHEMA = 'companion-status-v1';
export const COMPANION_ENDPOINT_SCHEMA = 'companion-endpoint-v1';
export const COMPANION_ENDPOINT_FILE = 'files/companion-endpoint.properties';

/** Every field the v1 writer emits, in wire order. */
export const COMPANION_STATUS_FIELDS = Object.freeze([
  'schema', 'app', 'code', 'session', 'capture', 'captureReason',
  'content', 'visible', 'frames', 'frameAgeMs', 'fps',
  'target', 'game', 'targetBuild', 'legacy',
  'regions', 'regionSamples', 'regionFrames',
  'lesson', 'lessonState', 'panel', 'clearance', 'overlayPermission',
  'lease', 'battery', 'charging', 'thermal', 'foreground', 'audioProbe',
  'snapshotNs', 'wallMs',
]);

const REQUIRED = ['schema', 'capture', 'session', 'snapshotNs'];

function fail(message) { throw new Error(`companion-status-v1: ${message}`); }

const unknown = value => value === undefined || value === 'UNKNOWN';
const orNull = value => (unknown(value) ? null : value);
const noneOrNull = value => (unknown(value) || value === 'NONE' ? null : value);

function integer(fields, key, { nullable = true } = {}) {
  const value = fields[key];
  if (unknown(value)) {
    if (nullable) return null;
    fail(`${key} is required`);
  }
  if (!/^-?\d+$/.test(value)) fail(`${key} is not an integer: ${value}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail(`${key} is out of range: ${value}`);
  return number;
}

function rect(value) {
  if (unknown(value) || value === 'NONE') return null;
  const match = /^(\d+),(\d+),(\d+),(\d+)$/.exec(value);
  if (!match) fail(`panel is not left,top,right,bottom: ${value}`);
  const [left, top, right, bottom] = match.slice(1).map(Number);
  if (!(left < right && top < bottom)) fail(`panel is empty: ${value}`);
  return Object.freeze({ left, top, right, bottom });
}

function clearance(value) {
  if (unknown(value) || value === 'UNCHECKED') return Object.freeze({ state: 'UNCHECKED' });
  let match = /^OK:(\d+)px$/.exec(value);
  if (match) return Object.freeze({ state: 'OK', gapPx: Number(match[1]) });
  match = /^VIOLATION:([a-z][a-z0-9_]{0,31}|legacy-[a-z0-9-]+)$/.exec(value);
  if (match) return Object.freeze({ state: 'VIOLATION', region: match[1] });
  fail(`clearance is malformed: ${value}`);
}

/**
 * Split a status line (with or without the `OK ` prefix) into its tokens,
 * refusing an ERROR reply, a line of another schema, or a repeated key.
 * @param {string} line
 * @returns {Record<string, string>}
 */
export function companionStatusFields(line) {
  if (typeof line !== 'string' || line.length > 4096) fail('line is missing or oversized');
  let text = line.trim();
  if (text.startsWith('ERROR ')) throw new Error(text);
  if (text.startsWith('OK ')) text = text.slice(3);
  /** @type {Record<string, string>} */
  const fields = {};
  for (const token of text.split(/\s+/)) {
    const at = token.indexOf('=');
    if (at <= 0) fail(`token is not key=value: ${token}`);
    const key = token.slice(0, at);
    if (Object.hasOwn(fields, key)) fail(`key ${key} is repeated`);
    fields[key] = token.slice(at + 1);
  }
  if (fields.schema !== COMPANION_STATUS_SCHEMA) fail(`schema is ${fields.schema ?? 'missing'}`);
  for (const key of REQUIRED) if (fields[key] === undefined) fail(`${key} is required`);
  return fields;
}

/**
 * Decode one status line into typed values. Unknown extra keys are kept in
 * `fields` (a newer minor writer may add some); a line of another schema is
 * refused.
 * @param {string} line
 */
export function parseCompanionStatus(line) {
  const fields = companionStatusFields(line);
  const capture = fields.capture;
  if (capture !== 'ON' && capture !== 'OFF') fail(`capture is ${capture}`);
  const content = unknown(fields.content) ? null : (() => {
    const match = /^(\d+)x(\d+)$/.exec(fields.content);
    if (!match) fail(`content is not WxH: ${fields.content}`);
    return Object.freeze({ width: Number(match[1]), height: Number(match[2]) });
  })();
  const flag = key => {
    const value = fields[key];
    if (unknown(value)) return null;
    if (value === '1') return true;
    if (value === '0') return false;
    fail(`${key} is not 0/1: ${value}`);
  };
  const fps = unknown(fields.fps) ? null : Number(fields.fps);
  if (fps !== null && !(Number.isFinite(fps) && fps >= 0)) fail(`fps is malformed: ${fields.fps}`);
  if (!/^\d+$/.test(fields.snapshotNs)) fail(`snapshotNs is not an integer: ${fields.snapshotNs}`);
  const legacy = noneOrNull(fields.legacy);
  const permission = fields.overlayPermission;
  if (!unknown(permission) && permission !== 'GRANTED' && permission !== 'DENIED')
    fail(`overlayPermission is ${permission}`);
  const foreground = fields.foreground;
  if (!unknown(foreground) && foreground !== 'COMPANION' && foreground !== 'OTHER')
    fail(`foreground is ${foreground}`);
  const battery = integer(fields, 'battery');
  if (battery !== null && (battery < 0 || battery > 100)) fail(`battery is ${battery}`);
  return Object.freeze({
    schema: fields.schema,
    app: orNull(fields.app),
    code: integer(fields, 'code'),
    session: integer(fields, 'session', { nullable: false }),
    capture,
    captureReason: orNull(fields.captureReason),
    content,
    visible: flag('visible'),
    frames: integer(fields, 'frames'),
    frameAgeMs: integer(fields, 'frameAgeMs'),
    fps,
    target: noneOrNull(fields.target),
    game: noneOrNull(fields.game),
    targetBuild: noneOrNull(fields.targetBuild),
    legacy: legacy === 'OFF' ? null : legacy,
    regions: integer(fields, 'regions'),
    regionSamples: integer(fields, 'regionSamples'),
    regionFrames: integer(fields, 'regionFrames'),
    lesson: noneOrNull(fields.lesson),
    lessonState: orNull(fields.lessonState),
    panel: rect(fields.panel),
    clearance: clearance(fields.clearance),
    overlayPermission: unknown(permission) ? null : permission === 'GRANTED',
    lease: noneOrNull(fields.lease),
    battery,
    charging: flag('charging'),
    thermal: orNull(fields.thermal),
    foreground: orNull(foreground),
    audioProbe: orNull(fields.audioProbe),
    snapshotNs: BigInt(fields.snapshotNs),
    wallMs: integer(fields, 'wallMs'),
    fields: Object.freeze({ ...fields }),
  });
}

/**
 * Parse the endpoint handshake: the properties file (one `key=value` per
 * line) or the `COMPANION schema=companion-endpoint-v1 ...` logcat line.
 * @param {string} text
 */
export function parseCompanionEndpoint(text) {
  if (typeof text !== 'string' || text.length > 4096) throw new Error('companion-endpoint-v1: text is missing or oversized');
  const source = text.includes('\n') ? text.split(/\r?\n/) : text.trim().replace(/^.*?\bCOMPANION\s+/, '').split(/\s+/);
  /** @type {Record<string, string>} */
  const fields = {};
  for (const token of source) {
    const value = token.trim();
    if (!value) continue;
    const at = value.indexOf('=');
    if (at <= 0) continue;
    fields[value.slice(0, at)] = value.slice(at + 1);
  }
  const bad = message => { throw new Error(`companion-endpoint-v1: ${message}`); };
  if (fields.schema !== COMPANION_ENDPOINT_SCHEMA) bad(`schema is ${fields.schema ?? 'missing'}`);
  if (!/^[0-9a-f]{32}$/.test(fields.token ?? '')) bad('token is not 128-bit hex');
  const port = Number(fields.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) bad('port is outside 1..65535');
  if (!/^com\.fnaf2\.cuehelper\.control\.[0-9a-z]+$/.test(fields.socket ?? '')) bad('socket is not the control socket name');
  for (const key of ['code', 'session', 'pid'])
    if (!/^\d+$/.test(fields[key] ?? '')) bad(`${key} is not an integer`);
  return Object.freeze({ schema: fields.schema, app: fields.app ?? null, code: Number(fields.code),
    session: Number(fields.session), pid: Number(fields.pid), port, socket: fields.socket, token: fields.token });
}
