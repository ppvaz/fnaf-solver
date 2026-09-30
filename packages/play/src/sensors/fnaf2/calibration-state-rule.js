/**
 * Profile-bound positive office/mask state for seam calibration.
 *
 * The seam runner admits a trial only on positive NIGHT/monitor/mask
 * observations, and a handset profile can only supply them through a
 * measured rule: a `calibration-state-v1` artifact binds the fitted
 * `monitor-rule-v1` (already digest-bound in the profile) together with a
 * fitted `mask-rule-v1`, both over the same helper 20x9 grid. A state is
 * OBSERVED only when BOTH sub-rules resolve the same frame positively;
 * any UNKNOWN refuses, exactly as one positive frame is insufficient
 * downstream. Nothing here fits thresholds -- offline labelled-frame
 * tooling produces the sub-artifacts, and until a measured artifact is
 * bound the runner keeps refusing live calibration.
 * CONTRACT:calibration-state-v1.
 */
import { createHash } from 'node:crypto';
import { measureMonitorUp, monitorRuleDigest, parseMonitorRule, cellFeatures, anchorReadsUp } from './monitor-rule.js';

const MASK_UNKNOWN_REASONS = new Set([
  'frame-pending', 'frame-stale', 'screen-identity', 'frame-dark',
  'feature-missing', 'ambiguous-threshold', 'sensor-mismatch',
  'calibration-refused', 'mask-rule-absent', 'grid-seq-mismatch',
  'grid-unavailable', 'monitor-state-unavailable',
]);
const finite = value => typeof value === 'number' && Number.isFinite(value);

function fail(message) { throw new TypeError(`calibration-state-v1: ${message}`); }

/** Stable sha256 over the artifact's canonical JSON for profile binding. */
export function calibrationStateRuleDigest(artifact) {
  const stable = value => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    }
    return value;
  };
  return createHash('sha256').update(JSON.stringify(stable(artifact))).digest('hex');
}

/** Same canonical sha256 for the mask sub-rule, mirroring monitorRuleDigest. */
export function maskRuleDigest(artifact) { return calibrationStateRuleDigest(artifact); }

function parseMaskAnchors(adapter) {
  if (!Array.isArray(adapter?.anchors) || adapter.anchors.length < 2)
    fail('mask rule must carry at least two anchors');
  const seen = new Set();
  adapter.anchors.forEach((anchor, index) => {
    if (!anchor || typeof anchor !== 'object') fail(`mask anchor ${index} must be an object`);
    if (!Number.isInteger(anchor.cell) || anchor.cell < 0 || anchor.cell > 179)
      fail(`mask anchor ${index} cell must index the 180-cell grid`);
    if (!(anchor.feature in cellFeatures)) fail(`mask anchor ${index} feature must be a per-cell feature`);
    if (anchor.kind !== 'present' && anchor.kind !== 'absent') fail(`mask anchor ${index} kind must be present or absent`);
    if (anchor.rule?.kind !== 'threshold') fail(`mask anchor ${index} rule kind must be threshold`);
    if (!finite(anchor.rule.threshold)) fail(`mask anchor ${index} threshold must be finite`);
    const band = anchor.rule.refuse_band;
    if (!finite(band) || band < 0) fail(`mask anchor ${index} refuse_band must be finite non-negative`);
    if (anchor.separation_margin < band) fail(`mask anchor ${index} refuse_band exceeds its separation margin`);
    if (seen.has(anchor.cell)) fail(`mask anchor cell ${anchor.cell} is repeated`);
    seen.add(anchor.cell);
  });
  // The monitor rule can demand one anchor of EACH polarity because raising
  // the monitor ADDS its map drawing: some cells go bright and others are
  // covered in the same frame. The mask adds nothing. It is opaque black, and
  // its two eye holes show the SAME office as the unmasked frame, so no cell
  // is brighter with the mask on -- measured over the 20260901 corpus, the
  // best positive gap across all 180 cells x both features is 0/255. Demanding
  // a `present` anchor here is unsatisfiable, and an eye-hole anchor would be
  // actively wrong: reading bright in BOTH states, it would make mask-off
  // resolve ambiguous instead of OBSERVED false. What a polarity-independent
  // rule can still guarantee is spread -- one occluded strip must not carry
  // the whole verdict, so the anchors must sit on at least two grid rows.
  const rows = new Set(adapter.anchors.map(anchor => Math.floor(anchor.cell / 20)));
  if (rows.size < 2) fail('mask anchors must span at least two of the nine grid rows');
}

/** @param {any} artifact */
export function parseMaskRule(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) fail('mask rule must be an object');
  if (artifact.schema !== 'mask-rule-v1') fail('mask rule schema mismatch');
  if (artifact.schema_version !== 1) fail('unsupported mask rule schema_version');
  if (artifact.status !== 'calibrated')
    fail(`mask rule status is ${artifact.status ?? 'missing'} (${artifact.reason ?? 'no reason'}); it cannot drive decisions`);
  if (artifact.fact?.id !== 'maskOn') fail('mask rule fact id must be maskOn');
  const labels = artifact.fact?.labels;
  if (!Array.isArray(labels) || !['off', 'on'].every(label => labels.includes(label)))
    fail('mask rule fact labels must include off and on');
  if (artifact.sensor?.geometry?.[0] !== 2400 || artifact.sensor?.geometry?.[1] !== 1080)
    fail('mask rule sensor geometry must be the native 2400x1080');
  if (artifact.sensor?.sampling !== 'helper-grid-20x9-cell-center')
    fail('mask rule sensor sampling must be the helper grid');
  const guard = artifact.adapter?.guard;
  if (guard?.kind !== 'floor') fail('mask rule guard kind must be floor');
  if (guard.feature !== 'helper_grid_mean_luma') fail('mask rule guard feature must be helper_grid_mean_luma');
  if (!finite(guard.min)) fail('mask rule guard min must be a finite number');
  if (guard.reason !== 'frame-dark') fail('mask rule guard reason must be frame-dark');
  const reasons = artifact.fact?.unknown_reasons;
  if (!Array.isArray(reasons) || reasons.some(reason => !MASK_UNKNOWN_REASONS.has(reason)))
    fail('mask rule unknown_reasons vocabulary is invalid');
  parseMaskAnchors(artifact.adapter);
  return Object.freeze(structuredClone(artifact));
}

/** @param {any} artifact */
export function parseCalibrationStateRule(artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) fail('artifact must be an object');
  if (artifact.schema !== 'calibration-state-v1') fail('schema mismatch');
  if (artifact.schema_version !== 1) fail('unsupported schema_version');
  if (artifact.status !== 'calibrated')
    fail(`artifact status is ${artifact.status ?? 'missing'} (${artifact.reason ?? 'no reason'}); it cannot drive decisions`);
  if (artifact.fact?.id !== 'calibrationState') fail('fact id must be calibrationState');
  const labels = artifact.fact?.labels;
  if (!Array.isArray(labels) || !['NIGHT', 'UP', 'DOWN', 'ON', 'OFF'].every(label => labels.includes(label)))
    fail('fact labels must include NIGHT, UP, DOWN, ON, and OFF');
  if (artifact.screen?.identity !== 'FNAF2_NIGHT') fail('screen identity must be FNAF2_NIGHT');
  const monitor = parseMonitorRule(artifact.monitor?.rule);
  if (artifact.monitor.digest !== monitorRuleDigest(monitor))
    fail('bound monitor rule digest does not match its artifact');
  const mask = parseMaskRule(artifact.mask?.rule);
  if (artifact.mask.digest !== maskRuleDigest(mask)) fail('bound mask rule digest does not match its artifact');
  // With the mask on almost every cell is black, so a mask-on frame and a
  // blacked-out screen differ only by the whole-grid darkness guard. Until a
  // blackout class has actually been captured that floor is unproven and the
  // rule could read a dark screen as a positive mask state -- the exact false
  // positive the seam runner admits trials on. The fitted artifact stays valid
  // evidence; it just cannot become a live decision until the floor is
  // measured. Capturing a blackout class lifts this by itself.
  if (mask.adapter.limitations?.includes('blackout-unproven'))
    fail('bound mask rule has an unproven darkness guard (blackout-unproven); it cannot gate live calibration');
  return Object.freeze(structuredClone(artifact));
}

/**
 * Derive the fitted `maskOn` fact from one atomic Cue Helper FRAME.
 *
 * This is deliberately a measurement, not an actuator gate: callers can
 * retain its reason and the fitted rule's limitations in an evidence ledger.
 * A masked FRAME may identify its screen as UNKNOWN, so that identity is
 * allowed here; an explicit menu/helper identity is not.
 *
 * @param {any} snapshot parsed FRAME fields
 * @param {any} rule parsed mask-rule-v1 artifact
 * @param {{maxAgeUs?: number, cells?: any}} options
 */
export function measureMaskOn(snapshot, rule, { maxAgeUs = 500000, cells = null } = {}) {
  const unknown = reason => ({ signal: 'maskOn', state: 'UNKNOWN', reason });
  const fields = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const ageUs = Number(fields.ageUs);
  if (!Number.isFinite(ageUs) || ageUs < 0) return unknown('frame-pending');
  if (ageUs > maxAgeUs) return unknown('frame-stale');
  if (!rule) return unknown('mask-rule-absent');
  if (fields.screen !== 'FNAF2_NIGHT' && fields.screen !== 'UNKNOWN')
    return unknown('screen-identity');
  const source = cells ?? fields.cells;
  if (!Array.isArray(source) ||
      !rule.adapter.anchors.some(anchor => Number.isInteger(source[anchor.cell])))
    return unknown('grid-unavailable');
  if (Number(fields.seq) !== Number(fields.gridSeq)) return unknown('grid-seq-mismatch');
  const total = source.reduce((sum, cell) => {
    if (!Number.isInteger(cell)) return NaN;
    return sum + cellFeatures.luma(cell);
  }, 0);
  const guardValue = Math.floor(total / source.length);
  if (!Number.isFinite(guardValue)) return unknown('feature-missing');
  if (guardValue < rule.adapter.guard.min) return unknown('frame-dark');
  let sawOn = false;
  let sawOff = false;
  for (const anchor of rule.adapter.anchors) {
    const reading = anchorReadsUp(anchor, source);
    if (reading === 'missing') return unknown('feature-missing');
    if (reading === 'up') { sawOn = true; continue; }
    if (reading === 'not-up') { sawOff = true; continue; }
    return unknown('ambiguous-threshold');
  }
  if (sawOn && sawOff) return unknown('ambiguous-threshold');
  return { signal: 'maskOn', state: 'OBSERVED', value: sawOn, confidence: 1 };
}

/**
 * Derive the calibrationState measurement from one cue-helper observation.
 * OBSERVED requires BOTH the bound monitor rule and mask rule to resolve
 * the same frame positively; any UNKNOWN refuses the state. A positive,
 * guard-qualified mask rule may also establish NIGHT when the helper reports
 * UNKNOWN: the opaque mask is exactly why the helper cannot see its normal
 * flashlight/mask-bar night signature. Explicit menu or helper identities
 * never get this fallback.
 * @param {any} snapshot parsed `OK k=v` fields from GET
 * @param {any} rule parsed calibration-state-v1 artifact
 * @param {{maxAgeUs?: number, cells?: any}} options */
export function measureCalibrationState(snapshot, rule, { maxAgeUs = 500000, cells = null } = {}) {
  const unknown = reason => ({ signal: 'calibrationState', state: 'UNKNOWN', reason });
  const fields = snapshot && typeof snapshot === 'object' ? snapshot : {};
  const ageUs = Number(fields.ageUs);
  if (!Number.isFinite(ageUs) || ageUs < 0) return unknown('frame-pending');
  if (ageUs > maxAgeUs) return unknown('frame-stale');
  if (!rule) return unknown('calibration-refused');
  // Only the classifier's UNKNOWN branch can use a measured mask as a
  // secondary identity. Known menu/helper frames must refuse before any
  // sub-rule is allowed to inspect their pixels.
  if (fields.screen !== 'FNAF2_NIGHT' && fields.screen !== 'UNKNOWN')
    return unknown('screen-identity');
  const source = cells ?? fields.cells;
  const monitorRule = parseMonitorRule(rule.monitor.rule);
  const maskRule = parseMaskRule(rule.mask.rule);
  const mask = measureMaskOn({ ...fields, cells: source }, maskRule,
    { maxAgeUs, cells: source });
  if (mask.state !== 'OBSERVED') return unknown(mask.reason);
  const screenIsNight = fields.screen === 'FNAF2_NIGHT';
  const maskEstablishesNight = fields.screen === 'UNKNOWN' && mask.value === true;
  if (!screenIsNight && !maskEstablishesNight) return unknown('screen-identity');

  // CaptureService's monitor detector has the same screen gate as the old
  // host path, so masked frames arrive with monitorUp=UNKNOWN. Once the
  // bound mask rule has independently resolved ON, use the bound monitor
  // anchors over this same atomic grid; do not let that helper-side UNKNOWN
  // erase the combined rule's evidence. Direct measureMonitorUp() remains
  // explicit-field-first for all other callers.
  const monitorFields = maskEstablishesNight ? { ...fields,
    screen: 'FNAF2_NIGHT', monitorUp: undefined, monitorReason: undefined } : fields;
  const monitor = measureMonitorUp(monitorFields, monitorRule, { maxAgeUs, cells: source });
  if (monitor.state !== 'OBSERVED') return unknown(monitor.reason ?? 'monitor-state-unavailable');
  return { signal: 'calibrationState', state: 'OBSERVED',
    value: { screen: 'NIGHT', monitor: monitor.value ? 'UP' : 'DOWN', mask: mask.value ? 'ON' : 'OFF' },
    confidence: 1 };
}
