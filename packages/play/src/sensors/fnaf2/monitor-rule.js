/**
 * Calibrated monitorUp detection over the cue-helper snapshot + grid.
 *
 * The helper emits verdict-free observations: the `GET` snapshot (freshness,
 * screen identity, whole-grid counts) and the `GRID` verb (all 180 point
 * samples of its 20x9 sensor). A `monitor-rule-v1` artifact -- fitted
 * offline from labelled 2400x1080 frames by `tools/device/monitor-calibrate.py`
 * -- names anchor cells on the monitor's map layout drawing, which is present
 * if and only if the monitor is up, independent of the camera feed behind it.
 * Each anchor carries its own measured threshold and refuse band; a frame is
 * OBSERVED true only when every anchor reads up-side, OBSERVED false only
 * when every anchor reads firmly not-up, and UNKNOWN otherwise -- mixed
 * evidence (partial animation, feed flash under a covered cell, one occluded
 * anchor) refuses, it never votes. A future helper-emitted explicit
 * `monitorUp=` field wins over the derived value.
 * CONTRACT:monitor-rule-v1.
 */
import { createHash } from 'node:crypto';

const cellFeatures = {
  luma: cell => {
    if (!Number.isInteger(cell)) return NaN;
    const r = (cell >> 16) & 0xff;
    const g = (cell >> 8) & 0xff;
    const b = cell & 0xff;
    return (77 * r + 150 * g + 29 * b) >> 8;
  },
  yellowness: cell => {
    if (!Number.isInteger(cell)) return NaN;
    const r = (cell >> 16) & 0xff;
    const g = (cell >> 8) & 0xff;
    const b = cell & 0xff;
    return Math.min(r, g) - b;
  },
};
const KNOWN_FEATURES = { ...cellFeatures,
  helper_grid_grey_cells: 'grey',
  helper_grid_mean_luma: 'gridLuma',
};
const UNKNOWN_REASONS = new Set([
  'frame-pending', 'frame-stale', 'screen-identity', 'frame-dark',
  'feature-missing', 'ambiguous-threshold', 'sensor-mismatch',
  'calibration-refused', 'monitor-rule-absent', 'monitor-state-unavailable',
  'grid-seq-mismatch', 'grid-unavailable',
]);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function fail(message) { throw new TypeError(`monitor-rule-v1: ${message}`); }

/** Stable sha256 over the artifact's canonical JSON for profile binding. */
export function monitorRuleDigest(artifact) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(stable(artifact))).digest('hex');
}

function parseAnchor(anchor, index) {
  if (!anchor || typeof anchor !== 'object') fail(`anchor ${index} must be an object`);
  if (!Number.isInteger(anchor.cell) || anchor.cell < 0 || anchor.cell > 179)
    fail(`anchor ${index} cell must index the 180-cell grid`);
  if (!(anchor.feature in cellFeatures))
    fail(`anchor ${index} feature must be a per-cell luma or yellowness`);
  if (anchor.kind !== 'present' && anchor.kind !== 'absent') fail(`anchor ${index} kind must be present or absent`);
  if (anchor.rule?.kind !== 'threshold') fail(`anchor ${index} rule kind must be threshold`);
  if (!finite(anchor.rule.threshold)) fail(`anchor ${index} threshold must be finite`);
  const band = anchor.rule.refuse_band;
  if (!finite(band) || band < 0) fail(`anchor ${index} refuse_band must be finite non-negative`);
  if (anchor.separation_margin < band) fail(`anchor ${index} refuse_band exceeds its separation margin`);
  return anchor;
}

/**
 * Validate a fitted rule artifact for production use. A refused artifact is
 * evidence, never a rule: parsing one for composition is an error.
 * @param {any} artifact */
export function parseMonitorRule(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) fail('artifact must be an object');
  if (artifact.schema !== 'monitor-rule-v1') fail('schema mismatch');
  if (artifact.schema_version !== 1) fail('unsupported schema_version');
  if (artifact.status !== 'calibrated')
    fail(`artifact status is ${artifact.status ?? 'missing'} (${artifact.reason ?? 'no reason'}); it cannot drive decisions`);
  if (artifact.fact?.id !== 'monitorUp') fail('fact id must be monitorUp');
  const labels = artifact.fact?.labels;
  if (!Array.isArray(labels) || !['down', 'mask', 'up'].every(label => labels.includes(label)))
    fail('fact labels must include down, mask, and up');
  if (artifact.sensor?.geometry?.[0] !== 2400 || artifact.sensor?.geometry?.[1] !== 1080)
    fail('sensor geometry must be the native 2400x1080');
  if (artifact.sensor?.sampling !== 'helper-grid-20x9-cell-center')
    fail('sensor sampling must be the helper grid');
  const adapter = artifact.adapter;
  if (!adapter || typeof adapter !== 'object') fail('adapter is required');
  if (!Array.isArray(adapter.anchors) || adapter.anchors.length < 2)
    fail('adapter must carry at least two anchors');
  const seen = new Set();
  adapter.anchors.forEach((anchor, index) => {
    parseAnchor(anchor, index);
    if (seen.has(anchor.cell)) fail(`anchor cell ${anchor.cell} is repeated`);
    seen.add(anchor.cell);
  });
  if (!adapter.anchors.some(anchor => anchor.kind === 'present'))
    fail('at least one present (map) anchor is required');
  if (!adapter.anchors.some(anchor => anchor.kind === 'absent'))
    fail('at least one absent (covered-office) anchor is required');
  const guard = adapter.guard;
  if (guard?.kind !== 'floor') fail('guard kind must be floor');
  if (guard.feature !== 'helper_grid_mean_luma') fail('guard feature must be helper_grid_mean_luma');
  if (!finite(guard.min)) fail('guard min must be a finite number');
  if (guard.reason !== 'frame-dark') fail('guard reason must be frame-dark');
  const reasons = artifact.fact?.unknown_reasons;
  if (!Array.isArray(reasons) || reasons.some(reason => !UNKNOWN_REASONS.has(reason)))
    fail('fact.unknown_reasons must use the monitorUp vocabulary');
  return Object.freeze(structuredClone(artifact));
}

function anchorReadsUp(anchor, cells) {
  const value = cellFeatures[anchor.feature](cells[anchor.cell]);
  if (!Number.isFinite(value)) return 'missing';
  const { threshold, refuse_band: band } = anchor.rule;
  const upSide = anchor.kind === 'present' ? value >= threshold + band : value <= threshold - band;
  const notUpSide = anchor.kind === 'present' ? value <= threshold - band : value >= threshold + band;
  if (upSide) return 'up';
  if (notUpSide) return 'not-up';
  return 'in-band';
}

export { cellFeatures, anchorReadsUp };

/**
 * Derive the monitorUp measurement from one cue-helper observation.
 * `snapshot` carries the GET fields; `cells` carries the GRID sensor rows
 * from the same frame. Freshness policy mirrors
 * CueHelperControlTransport.monitorMeasurement.
 * @param {any} snapshot parsed `OK k=v` fields from GET
 * @param {any} rule parsed monitor-rule-v1 artifact, or null */
export function measureMonitorUp(snapshot, rule, { maxAgeUs = 500000, cells = null } = {}) {
  const unknown = reason => ({ signal: 'monitorUp', state: 'UNKNOWN', reason });
  const fields = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const ageUs = Number(fields.ageUs);
  if (!Number.isFinite(ageUs) || ageUs < 0) return unknown('frame-pending');
  if (ageUs > maxAgeUs) return unknown('frame-stale');
  if (fields.monitorUp === 'true' || fields.monitorUp === 'false')
    return { signal: 'monitorUp', state: 'OBSERVED', value: fields.monitorUp === 'true', confidence: 1 };
  if (fields.monitorUp === 'UNKNOWN')
    return unknown(UNKNOWN_REASONS.has(fields.monitorReason) ? fields.monitorReason : 'monitor-state-unavailable');
  if (!rule) return unknown('monitor-rule-absent');
  if (fields.screen !== 'FNAF2_NIGHT') return unknown('screen-identity');
  const source = cells ?? fields.cells;
  if (!rule.adapter.anchors.some(anchor => Number.isInteger(source?.[anchor.cell])))
    return unknown('grid-unavailable');
  if (Number(fields.seq) !== Number(fields.gridSeq)) return unknown('grid-seq-mismatch');
  if (rule.adapter.guard.feature === 'helper_grid_mean_luma') {
    // The darkness guard is the whole-grid mean luma, computed from the same
    // sensor rows the anchors read -- no dependency on a newer helper build.
    const total = source.reduce((sum, cell) => {
      if (!Number.isInteger(cell)) return NaN;
      return sum + cellFeatures.luma(cell);
    }, 0);
    const guardValue = Math.floor(total / source.length);
    if (!Number.isFinite(guardValue)) return unknown('feature-missing');
    if (guardValue < rule.adapter.guard.min) return unknown('frame-dark');
  }
  let sawUp = false;
  let sawNotUp = false;
  for (const anchor of rule.adapter.anchors) {
    const reading = anchorReadsUp(anchor, source);
    if (reading === 'missing') return unknown('feature-missing');
    if (reading === 'up') { sawUp = true; continue; }
    if (reading === 'not-up') { sawNotUp = true; continue; }
    return unknown('ambiguous-threshold');
  }
  if (sawUp && sawNotUp) return unknown('ambiguous-threshold');
  return { signal: 'monitorUp', state: 'OBSERVED', value: sawUp, confidence: 1 };
}
