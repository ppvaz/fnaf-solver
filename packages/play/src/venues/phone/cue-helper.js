/**
 * Authenticated cue-helper control protocol codec.  The request function is
 * injected by the device composition root (loopback or forwarded socket), so
 * this adapter contains no adb, shell, strategy, or policy selection.
 * CONTRACT:cue-helper-control-v1.
 */

const bounded = value => typeof value === 'string' && value.length <= 4096;
  /** @param {string} line */
export function parseCueResponse(line) {
  if (!bounded(line)) throw new TypeError('cue-helper response is missing or oversized');
  const text = line.trim();
  if (!text.startsWith('OK ')) throw new Error(text.startsWith('ERROR ') ? text : 'cue-helper response is not OK');
  /** @type {Record<string, string>} */
  const fields = {};
  for (const token of text.slice(3).split(/\s+/)) {
    const separator = token.indexOf('=');
    if (separator <= 0) continue;
    fields[token.slice(0, separator)] = token.slice(separator + 1);
  }
  return Object.freeze(fields);
}

/** A REGION read is one line of at most 16 regions and 8192 samples (NativeRegions.java). */
export const REGION_LIMITS = Object.freeze({ regions: 16, samples: 8192, step: 64, lineChars: 65536 });
const REGION_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * A native region request: `REGION <token> set <name> <x> <y> <w> <h> <step>`.
 * Coordinates are native display pixels (2400x1080 on the moto g56).
 * CONTRACT:cue-helper-control-v1.
 */
export function regionSetLine(token, name, { x, y, width, height, step = 1 }) {
  if (!/^[0-9a-f]{32}$/.test(token)) throw new TypeError('region token must be the 32-hex session token');
  if (!REGION_NAME.test(name)) throw new TypeError(`region name ${name} is not [a-z][a-z0-9_]{0,31}`);
  for (const [key, value] of Object.entries({ x, y, width, height, step })) {
    if (!Number.isInteger(value) || value < 0) throw new TypeError(`region ${name}: ${key} must be a non-negative integer`);
  }
  if (width < 1 || height < 1 || step < 1 || step > REGION_LIMITS.step) throw new RangeError(`region ${name} is empty or its step is out of range`);
  return `REGION ${token} set ${name} ${x} ${y} ${width} ${height} ${step}`;
}

/**
 * Parse `OK seq=N imageNs=T copiedNs=C captured=K regions=R name=x,y,w,h,step:HEX ... snapshotNs=S`.
 * Each region comes back as its own raw pixels: `pixels[i]` is 0xRRGGBB of
 * native pixel (x + (i % cols) * step, y + floor(i / cols) * step). `seq`
 * is -1 until a frame has been copied since the regions were set.
 * CONTRACT:cue-helper-control-v1.
 */
export function parseRegionRead(line) {
  if (typeof line !== 'string' || line.length > REGION_LIMITS.lineChars) throw new TypeError('region read is missing or oversized');
  const text = line.trim();
  if (!text.startsWith('OK ')) throw new Error(text.startsWith('ERROR ') ? text : 'region read is not OK');
  const out = { seq: null, imageNs: null, copiedNs: null, snapshotNs: null, captured: null, regions: {} };
  for (const token of text.slice(3).split(/\s+/)) {
    const eq = token.indexOf('=');
    if (eq <= 0) continue;
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    if (['seq', 'imageNs', 'copiedNs', 'snapshotNs', 'captured', 'regions'].includes(key)) {
      if (!/^-?\d+$/.test(value)) throw new Error(`region read field ${key} is not an integer`);
      if (key !== 'regions') out[key] = key.endsWith('Ns') ? BigInt(value) : Number(value);
      continue;
    }
    const match = /^(\d+),(\d+),(\d+),(\d+),(\d+):([0-9a-f]*)$/.exec(value);
    if (!REGION_NAME.test(key) || !match) throw new Error(`region read has a malformed region ${key}`);
    const [x, y, width, height, step] = match.slice(1, 6).map(Number);
    const cols = Math.ceil(width / step);
    const rows = Math.ceil(height / step);
    const hex = match[6];
    if (hex.length !== cols * rows * 6) throw new Error(`region ${key} carries ${hex.length / 6} samples, expected ${cols * rows}`);
    const pixels = new Uint32Array(cols * rows);
    for (let i = 0; i < pixels.length; i += 1) pixels[i] = parseInt(hex.slice(i * 6, i * 6 + 6), 16);
    out.regions[key] = Object.freeze({ x, y, width, height, step, cols, rows, pixels });
  }
  if (out.seq === null) throw new Error('region read has no seq');
  return Object.freeze(out);
}

export class CueHelperControlTransport {
  /** @param {any} options */
  constructor({ request, token, maxAgeUs = 500000 } = {}) {
    if (typeof request !== 'function') throw new TypeError('cue-helper transport needs an injected request function');
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) throw new TypeError('cue-helper token must be 128-bit hex');
    this.request = request; this.token = token; this.maxAgeUs = maxAgeUs;
  }

  /** FNaF 2 legacy: one GET snapshot (Fnaf2Legacy.snapshotLine). */
  snapshot() { return parseCueResponse(this.request(`GET ${this.token}`)); }

  /**
   * FNaF 2 legacy: one observation, the snapshot fields AND the 180-cell grid
   * from a single locked read on the device, so both describe the same frame.
   * Two round trips (the retired GET + GRID pair) agreed on a sequence 0 times
   * in 12 on the moto g56. `gridSeq` is set from the same `seq` deliberately:
   * one read, one frame.
   */
  frame() {
    const fields = /** @type {any} */ (parseCueResponse(this.request(`FRAME ${this.token}`)));
    if (fields.grid !== '20x9') throw new Error('cue-helper frame is missing its sensor');
    const body = typeof fields.cells === 'string' ? fields.cells : '';
    if (!/^[0-9a-f]*$/.test(body)) throw new Error('cue-helper frame cell is malformed');
    if (body.length !== 180 * 6) throw new TypeError('cue-helper frame must carry the 180-cell sensor');
    const cells = [];
    for (let index = 0; index < body.length; index += 6) cells.push(parseInt(body.slice(index, index + 6), 16));
    return Object.freeze({ ...fields, gridSeq: fields.seq, cells: Object.freeze(cells) });
  }
  watch(action) {
    if (action !== 'status' && !/^[0-9a-f]{64}$/.test(action)) throw new TypeError('cue-helper watch action is invalid');
    return parseCueResponse(this.request(`WATCH ${this.token} ${action}`));
  }
  read() { return parseCueResponse(this.request(`READ ${this.token}`)); }

  /** Device capture time is not GET's snapshot time or the host request time.
   * Old helpers expose only an integer ageUs: retain the 1 us bracket instead
   * of claiming nanosecond precision. No host/device clock offset is inferred.
   */
  visualAcquisition(snapshot = {}) {
    const integer = value => typeof value === 'string' && /^\d+$/.test(value);
    if (!integer(snapshot.snapshotNs) || !integer(snapshot.ageUs) || !integer(snapshot.seq))
      throw new Error('visual-capture-time-unavailable');
    const sequence = Number(snapshot.seq);
    const snapshotNs = BigInt(snapshot.snapshotNs);
    const ageNs = BigInt(snapshot.ageUs) * 1000n;
    if (!Number.isSafeInteger(sequence) || sequence < 1 || ageNs > snapshotNs)
      throw new Error('visual-capture-time-invalid');
    let captureNs;
    let uncertaintyMs;
    if (snapshot.visualCaptureNs !== undefined) {
      if (!integer(snapshot.visualCaptureNs)) throw new Error('visual-capture-time-invalid');
      captureNs = BigInt(snapshot.visualCaptureNs);
      const measuredAgeNs = snapshotNs - captureNs;
      if (captureNs <= 0n || measuredAgeNs < ageNs || measuredAgeNs >= ageNs + 1000n)
        throw new Error('visual-capture-age-disagrees');
      uncertaintyMs = 0;
    } else {
      captureNs = snapshotNs - ageNs;
      if (captureNs <= 0n) throw new Error('visual-capture-time-invalid');
      uncertaintyMs = 0.001;
    }
    return {
      clock: 'device-monotonic-ms', at: Number(captureNs) / 1e6,
      sourceNs: captureNs.toString(), uncertaintyMs, sequence,
      basis: uncertaintyMs ? 'snapshot-minus-age-upper-bound' : 'image-timestamp',
    };
  }

  /** A transport measurement is fresh only when helper explicitly says so. */
  monitorMeasurement(snapshot = {}) {
    const ageUs = Number(snapshot.ageUs);
    const value = snapshot.monitorUp;
    if (!Number.isFinite(ageUs) || ageUs < 0 || ageUs > this.maxAgeUs || !['true', 'false'].includes(value))
      return { signal: 'monitorUp', state: 'UNKNOWN', reason: 'monitor-state-unavailable' };
    return { signal: 'monitorUp', state: 'OBSERVED', value: value === 'true', confidence: 1 };
  }
}
