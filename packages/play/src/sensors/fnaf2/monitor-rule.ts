/**
 * Calibrated monitorUp detection over the Companion snapshot + grid.
 *
 * The helper emits verdict-free observations: the `GET` snapshot (freshness,
 * screen identity, whole-grid counts) and the `GRID` verb (all 180 point
 * samples of its 20x9 sensor). A `monitor-rule-v1` artifact -- fitted
 * offline from labelled 2400x1080 frames by `packages/play/bin/calibrate/monitor-calibrate.py`
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
import { isList, isRecord } from '@sixam/kernel';
import { ruleDigest } from './rule-digest.ts';
import type { Reading } from './rule-digest.ts';

type CellFeature = 'luma' | 'yellowness';
/** One anchor cell of a fitted rule: where a drawing is (present) or the office is covered (absent). */
export interface Anchor {
  readonly cell: number;
  readonly feature: CellFeature;
  readonly kind: 'present' | 'absent';
  readonly rule: { readonly kind: 'threshold', readonly threshold: number, readonly refuse_band: number };
}
/** A calibrated monitor-rule-v1 artifact, as parseMonitorRule checks it. */
export interface MonitorRule {
  readonly schema: 'monitor-rule-v1';
  readonly adapter: {
    readonly anchors: readonly Anchor[],
    readonly guard: { readonly kind: 'floor', readonly feature: 'helper_grid_mean_luma', readonly min: number, readonly reason: 'frame-dark' },
  };
  readonly [field: string]: unknown;
}
type MonitorReading = Reading<'monitorUp', boolean>;

const cellFeatures: Readonly<Record<CellFeature, (cell: unknown) => number>> = {
  luma: cell => {
    if (typeof cell !== 'number' || !Number.isInteger(cell)) return NaN;
    const r = (cell >> 16) & 0xff;
    const g = (cell >> 8) & 0xff;
    const b = cell & 0xff;
    return (77 * r + 150 * g + 29 * b) >> 8;
  },
  yellowness: cell => {
    if (typeof cell !== 'number' || !Number.isInteger(cell)) return NaN;
    const r = (cell >> 16) & 0xff;
    const g = (cell >> 8) & 0xff;
    const b = cell & 0xff;
    return Math.min(r, g) - b;
  },
};
const UNKNOWN_REASONS = new Set([
  'frame-pending', 'frame-stale', 'screen-identity', 'frame-dark',
  'feature-missing', 'ambiguous-threshold', 'sensor-mismatch',
  'calibration-refused', 'monitor-rule-absent', 'monitor-state-unavailable',
  'grid-seq-mismatch', 'grid-unavailable',
]);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function fail(message: string): never { throw new TypeError(`monitor-rule-v1: ${message}`); }

/** Stable sha256 over the artifact's canonical JSON for profile binding. */
export const monitorRuleDigest = ruleDigest;

function parseAnchor(anchor: unknown, index: number): Anchor {
  if (!isRecord(anchor)) fail(`anchor ${index} must be an object`);
  if (typeof anchor.cell !== 'number' || !Number.isInteger(anchor.cell) || anchor.cell < 0 || anchor.cell > 179)
    fail(`anchor ${index} cell must index the 180-cell grid`);
  if (anchor.feature !== 'luma' && anchor.feature !== 'yellowness')
    fail(`anchor ${index} feature must be a per-cell luma or yellowness`);
  if (anchor.kind !== 'present' && anchor.kind !== 'absent') fail(`anchor ${index} kind must be present or absent`);
  const rule = anchor.rule;
  if (!isRecord(rule) || rule.kind !== 'threshold') fail(`anchor ${index} rule kind must be threshold`);
  if (!finite(rule.threshold)) fail(`anchor ${index} threshold must be finite`);
  const band = rule.refuse_band;
  if (!finite(band) || band < 0) fail(`anchor ${index} refuse_band must be finite non-negative`);
  if (!finite(anchor.separation_margin) || anchor.separation_margin < band)
    fail(`anchor ${index} refuse_band needs a finite separation margin at least as wide`);
  return anchor as unknown as Anchor;
}

/**
 * Validate a fitted rule artifact for production use. A refused artifact is
 * evidence, never a rule: parsing one for composition is an error.
 * */
export function parseMonitorRule(artifact: unknown): MonitorRule {
  if (!isRecord(artifact)) fail('artifact must be an object');
  if (artifact.schema !== 'monitor-rule-v1') fail('schema mismatch');
  if (artifact.schema_version !== 1) fail('unsupported schema_version');
  if (artifact.status !== 'calibrated')
    fail(`artifact status is ${artifact.status ?? 'missing'} (${artifact.reason ?? 'no reason'}); it cannot drive decisions`);
  const fact = isRecord(artifact.fact) ? artifact.fact : {};
  if (fact.id !== 'monitorUp') fail('fact id must be monitorUp');
  const labels = fact.labels;
  if (!isList(labels) || !['down', 'mask', 'up'].every(label => labels.includes(label)))
    fail('fact labels must include down, mask, and up');
  const sensor = isRecord(artifact.sensor) ? artifact.sensor : {};
  const geometry = isList(sensor.geometry) ? sensor.geometry : [];
  if (geometry[0] !== 2400 || geometry[1] !== 1080)
    fail('sensor geometry must be the native 2400x1080');
  if (sensor.sampling !== 'helper-grid-20x9-cell-center')
    fail('sensor sampling must be the helper grid');
  const adapter = artifact.adapter;
  if (!isRecord(adapter)) fail('adapter is required');
  if (!isList(adapter.anchors) || adapter.anchors.length < 2)
    fail('adapter must carry at least two anchors');
  const seen = new Set<number>();
  const anchors = adapter.anchors.map((item, index) => {
    const anchor = parseAnchor(item, index);
    if (seen.has(anchor.cell)) fail(`anchor cell ${anchor.cell} is repeated`);
    seen.add(anchor.cell);
    return anchor;
  });
  if (!anchors.some(anchor => anchor.kind === 'present'))
    fail('at least one present (map) anchor is required');
  if (!anchors.some(anchor => anchor.kind === 'absent'))
    fail('at least one absent (covered-office) anchor is required');
  const guard = adapter.guard;
  if (!isRecord(guard) || guard.kind !== 'floor') fail('guard kind must be floor');
  if (guard.feature !== 'helper_grid_mean_luma') fail('guard feature must be helper_grid_mean_luma');
  if (!finite(guard.min)) fail('guard min must be a finite number');
  if (guard.reason !== 'frame-dark') fail('guard reason must be frame-dark');
  const reasons = fact.unknown_reasons;
  if (!isList(reasons) || reasons.some(reason => typeof reason !== 'string' || !UNKNOWN_REASONS.has(reason)))
    fail('fact.unknown_reasons must use the monitorUp vocabulary');
  return Object.freeze(structuredClone(artifact)) as unknown as MonitorRule;
}

function anchorReadsUp(anchor: Anchor, cells: readonly unknown[]) {
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
 * Derive the monitorUp measurement from one Companion observation.
 * `snapshot` carries the GET fields; `cells` carries the GRID sensor rows
 * from the same frame. Freshness policy mirrors
 * CompanionControlTransport.monitorMeasurement.
 * @param snapshot parsed `OK k=v` fields from GET
 * @param rule parsed monitor-rule-v1 artifact, or null */
export function measureMonitorUp(snapshot: unknown, rule: MonitorRule | null,
  { maxAgeUs = 500000, cells = null }: { maxAgeUs?: number, cells?: readonly unknown[] | null } = {}): MonitorReading {
  const unknown = (reason: string): MonitorReading => ({ signal: 'monitorUp', state: 'UNKNOWN', reason });
  const fields = (snapshot && typeof snapshot === 'object' ? snapshot : {}) as Readonly<Record<string, unknown>>;
  const ageUs = Number(fields.ageUs);
  if (!Number.isFinite(ageUs) || ageUs < 0) return unknown('frame-pending');
  if (ageUs > maxAgeUs) return unknown('frame-stale');
  if (fields.monitorUp === 'true' || fields.monitorUp === 'false')
    return { signal: 'monitorUp', state: 'OBSERVED', value: fields.monitorUp === 'true', confidence: 1 };
  if (fields.monitorUp === 'UNKNOWN')
    return unknown(typeof fields.monitorReason === 'string' && UNKNOWN_REASONS.has(fields.monitorReason)
      ? fields.monitorReason : 'monitor-state-unavailable');
  if (!rule) return unknown('monitor-rule-absent');
  if (fields.screen !== 'FNAF2_NIGHT') return unknown('screen-identity');
  const source = cells ?? fields.cells;
  if (!isList(source) || !rule.adapter.anchors.some(anchor => Number.isInteger(source[anchor.cell])))
    return unknown('grid-unavailable');
  if (Number(fields.seq) !== Number(fields.gridSeq)) return unknown('grid-seq-mismatch');
  if (rule.adapter.guard.feature === 'helper_grid_mean_luma') {
    // The darkness guard is the whole-grid mean luma, computed from the same
    // sensor rows the anchors read -- no dependency on a newer helper build.
    const total = source.reduce<number>((sum, cell) => {
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
