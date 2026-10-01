/**
 * Calibrated cameraSelected detection over the helper's native watch.
 *
 * The monitor map's twelve camera buttons are fixed UI: the selected button
 * renders yellow (bright ~194 in the normal view, dimmed ~96 while the
 * music-box wind control is held) and unselected buttons read the map's cool
 * grey (~-19..-9).  A `camera-rule-v1` artifact -- fitted offline from
 * labelled captures by `packages/play/bin/calibrate/camera-calibrate.py` -- carries each
 * button's measured threshold and refuse band.  Verdict semantics are
 * strict: exactly one lit button names the selected camera; zero and several
 * lit buttons are distinct UNKNOWN reasons, so a camera transition and the
 * known Android double-camera glitch stay separable in telemetry; any
 * in-band value refuses.  The fact is meaningful only while the monitorUp
 * fact is OBSERVED true -- the caller passes that gate.
 * CONTRACT:camera-rule-v1.
 */
import { isList, isRecord } from '@sixam/kernel';
import { ruleDigest } from './rule-digest.ts';
import type { Reading } from './rule-digest.ts';

/** One camera button of the fitted rule: the watch entry that reads it, and its highlight threshold. */
interface Button {
  readonly control: string;
  readonly entry: string;
  readonly feature: 'yellowness';
  readonly rule: { readonly kind: 'threshold', readonly threshold: number, readonly refuse_band: number };
}
/** A calibrated camera-rule-v1 artifact, as parseCameraRule checks it. */
export interface CameraRule {
  readonly schema: 'camera-rule-v1';
  readonly adapter: { readonly buttons: readonly Button[] };
  readonly [field: string]: unknown;
}

const UNKNOWN_REASONS = new Set([
  'monitor-not-up', 'no-camera-highlight', 'multiple-camera-highlight',
  'ambiguous-threshold', 'feature-missing', 'read-unavailable', 'read-stale',
  'sensor-mismatch', 'calibration-refused',
]);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function fail(message: string): never { throw new TypeError(`camera-rule-v1: ${message}`); }

/** Stable sha256 over the artifact's canonical JSON for profile binding. */
export const cameraRuleDigest = ruleDigest;

/**
 * Validate a fitted rule artifact for production use. A refused artifact is
 * evidence, never a rule.
 * */
export function parseCameraRule(artifact: unknown): CameraRule {
  if (!isRecord(artifact)) fail('artifact must be an object');
  if (artifact.schema !== 'camera-rule-v1') fail('schema mismatch');
  if (artifact.schema_version !== 1) fail('unsupported schema_version');
  if (artifact.status !== 'calibrated')
    fail(`artifact status is ${artifact.status ?? 'missing'} (${artifact.reason ?? 'no reason'}); it cannot drive decisions`);
  const fact = isRecord(artifact.fact) ? artifact.fact : {};
  if (fact.id !== 'cameraSelected') fail('fact id must be cameraSelected');
  if (!isList(fact.labels) || fact.labels.length < 2)
    fail('fact labels must name at least two cameras');
  const sensor = isRecord(artifact.sensor) ? artifact.sensor : {};
  const geometry = isList(sensor.geometry) ? sensor.geometry : [];
  if (geometry[0] !== 2400 || geometry[1] !== 1080)
    fail('sensor geometry must be the native 2400x1080');
  if (sensor.sampling !== 'pixel-watch-native-2400x1080')
    fail('sensor sampling must be the native watch');
  const adapter = artifact.adapter;
  if (!isRecord(adapter)) fail('adapter is required');
  if (!isList(adapter.buttons) || adapter.buttons.length < 2)
    fail('adapter must carry at least two buttons');
  const entries = new Set<string>();
  const controls = new Set<string>();
  for (const button of adapter.buttons) {
    if (!isRecord(button)) fail('button must be an object');
    if (typeof button.control !== 'string' || !/^cam:[0-9]{1,2}$/.test(button.control))
      fail(`button control ${button.control ?? 'missing'} is not a semantic camera control`);
    if (controls.has(button.control)) fail(`button control ${button.control} is repeated`);
    controls.add(button.control);
    if (typeof button.entry !== 'string' || entries.has(button.entry))
      fail(`button entry ${button.entry ?? 'missing'} is missing or repeated`);
    entries.add(button.entry);
    if (button.feature !== 'yellowness') fail('button feature must be yellowness');
    const rule = button.rule;
    if (!isRecord(rule) || rule.kind !== 'threshold') fail('button rule kind must be threshold');
    if (!finite(rule.threshold)) fail('button threshold must be finite');
    const band = rule.refuse_band;
    if (!finite(band) || band < 0) fail('button refuse_band must be finite non-negative');
    // As JavaScript compares: an absent margin (NaN) passes, a null one reads 0.
    if (Number(button.separation_margin) < band) fail('refuse_band exceeds the separation margin');
  }
  const reasons = fact.unknown_reasons;
  if (!isList(reasons) || reasons.some(reason => typeof reason !== 'string' || !UNKNOWN_REASONS.has(reason)))
    fail('fact.unknown_reasons must use the cameraSelected vocabulary');
  return Object.freeze(structuredClone(artifact)) as unknown as CameraRule;
}

/**
 * Derive the cameraSelected measurement from one native watch read.
 * @param entries parsed `READ` fields: entry name -> yellowness value
 * @param rule parsed camera-rule-v1 artifact
 * @param monitorUp the monitorUp measurement for the same observation;
 * the camera fact is only meaningful when it is OBSERVED true */
export function measureCameraSelected(entries: unknown, rule: CameraRule | null, monitorUp: unknown): Reading<'cameraSelected', string> {
  const unknown = (reason: string): Reading<'cameraSelected', string> => ({ signal: 'cameraSelected', state: 'UNKNOWN', reason });
  if (!isRecord(monitorUp) || monitorUp.signal !== 'monitorUp' || monitorUp.state !== 'OBSERVED'
    || monitorUp.value !== true) return unknown('monitor-not-up');
  if (!rule) return unknown('read-unavailable');
  const fields = (entries && typeof entries === 'object' ? entries : {}) as Readonly<Record<string, unknown>>;
  let lit: string | null = null;
  for (const button of rule.adapter.buttons) {
    const raw = fields[button.entry];
    if (raw === undefined || raw === null || raw === 'UNKNOWN') return unknown('read-unavailable');
    const value = Number(raw);
    if (!finite(value)) return unknown('feature-missing');
    if (value >= button.rule.threshold + button.rule.refuse_band) {
      if (lit !== null) return unknown('multiple-camera-highlight');
      lit = button.control;
    } else if (value > button.rule.threshold - button.rule.refuse_band) {
      return unknown('ambiguous-threshold');
    }
  }
  if (lit === null) return unknown('no-camera-highlight');
  return { signal: 'cameraSelected', state: 'OBSERVED', value: lit, confidence: 1 };
}
