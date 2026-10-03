/**
 * The live campaign's reads of the office controls over the Companion: the
 * camera arm (the native watch's highlighted pair) and the monitor and mask
 * state the effect ledger and the cycle gates act on
 * (modern-campaign-ports.ts composes it; adb-device-local-executor.ts reads it).
 */
import { readFile } from 'node:fs/promises';
import { measureMaskOn, measureMonitorUp, parseMaskRule, parseMonitorRule, reconcileExclusiveControls,
  visualAcquisitionOf } from '@sixam/play';
import type { CameraRule, CompanionFrame } from '@sixam/play';
import type { ArmSample } from './adb-device-local-executor.ts';

type Fields = Readonly<Record<string, string>>;

/** The Companion reads the observers make, each over the run's control channel. */
interface ControlReads {
  watch(action: string): Promise<Fields>;
  readPanel(): Promise<Fields>;
  readFrame(): Promise<CompanionFrame>;
}

/** The fitted rules the observers apply. */
interface ControlRules {
  readonly cameraRule: CameraRule;
  readonly monitorRule: ReturnType<typeof parseMonitorRule>;
  readonly maskRule: ReturnType<typeof parseMaskRule>;
}

// The fitted monitor and mask rules live with the observers that apply them,
// so the module that reads the grid rule is the one that also reads the native
// strokes (packages/propose/bindings/test-fact-register.ts ranks producers by file).
const MONITOR_RULE = new URL('../../../../packages/play/profiles/fnaf2/moto-g56/monitor-rule-moto-g56-v207.json', import.meta.url);
const MASK_RULE = new URL('../../../../packages/play/profiles/fnaf2/moto-g56/mask-rule-moto-g56-v207.json', import.meta.url);

/** Read the profile's fitted monitor and mask rules. */
export async function loadControlRules(): Promise<Pick<ControlRules, 'monitorRule' | 'maskRule'>> {
  const [monitorRule, maskRule] = await Promise.all([
    readFile(MONITOR_RULE, 'utf8').then(text => parseMonitorRule(JSON.parse(text))),
    readFile(MASK_RULE, 'utf8').then(text => parseMaskRule(JSON.parse(text))),
  ]);
  return { monitorRule, maskRule };
}

/**
 * Read the exact camera highlight set from the authenticated native watch.
 * The helper's singular `cameraSelected` fact deliberately becomes UNKNOWN
 * for the Android double-camera glitch; the arm gate needs the complete set,
 * so it consumes the calibrated button entries from that same READ frame.
 */
function nativeCameraHighlights(read: Readonly<Record<string, string>> | null | undefined, rule: CameraRule):
  { state: 'UNKNOWN', reason: string } | { state: 'OBSERVED', value: string[] } {
  const unknown = (reason: string) => ({ state: 'UNKNOWN' as const, reason });
  if (read?.read !== 'OBSERVED') return unknown('read-unavailable');
  const ageUs = Number(read.ageUs);
  if (!Number.isFinite(ageUs) || ageUs < 0) return unknown('read-unavailable');
  if (ageUs > 500000) return unknown('read-stale');
  const highlights: string[] = [];
  for (const button of rule.adapter.buttons) {
    const raw = read[button.entry];
    if (raw === undefined || raw === 'UNKNOWN') return unknown('read-unavailable');
    const value = Number(raw);
    if (!Number.isFinite(value)) return unknown('feature-missing');
    const lower = button.rule.threshold - button.rule.refuse_band;
    const upper = button.rule.threshold + button.rule.refuse_band;
    if (value >= upper) highlights.push(button.control);
    else if (value > lower) return unknown('ambiguous-threshold');
  }
  if (highlights.length === 0) return unknown('no-camera-highlight');
  return { state: 'OBSERVED', value: highlights };
}

/**
 * The arm watch, the arm observer and the control-state observer for one run.
 * The watch is loaded once and stays loaded for the run.
 */
export function createControlObserver({ watch, readPanel, readFrame }: ControlReads,
  { cameraRule, monitorRule, maskRule }: ControlRules) {
  const maskLimitations = (maskRule.adapter?.limitations ?? []).filter(value =>
    typeof value === 'string' && value.length <= 63);
  // The fitted mask rule is intentionally diagnostic-only until its blackout
  // and animation limitations are retired. Preserve that fact in each ACK so
  // later analysis cannot mistake a useful trace clue for a live safety gate.
  const maskEvidence = maskLimitations.length
    ? `diagnostic-provisional:${maskLimitations.join(',')}` : 'calibrated';
  let armWatchLoaded = false;
  const ensureArmWatch = async () => {
    if (armWatchLoaded) return;
    const status = await watch('status');
    if (typeof status.spec !== 'string' || !/^[0-9a-f]{64}$/.test(status.spec))
      throw new Error('native camera watchlist status has no valid spec hash');
    const active = status.watch === 'ACTIVE';
    const loaded = active ? status : await watch(status.spec);
    if (loaded.watch !== 'ACTIVE' || loaded.spec !== status.spec)
      throw new Error('native camera watchlist did not activate');
    armWatchLoaded = true;
  };
  const observeArm = async (): Promise<ArmSample> => {
    if (!armWatchLoaded) throw new Error('native camera watchlist is not active');
    const read = await readPanel();
    const highlights = nativeCameraHighlights(read, cameraRule);
    const cameraValues = Object.fromEntries(cameraRule.adapter.buttons.map(button =>
      [button.control, read[button.entry] ?? 'UNKNOWN']));
    return {
      sequence: read.seq,
      highlights: highlights.state === 'OBSERVED' ? highlights.value : null,
      cameraValues,
      // A true double highlight intentionally has no singleton camera fact.
      // The declared viewing camera is verified by the exact pair contract.
      viewing: null,
      reason: highlights.state === 'UNKNOWN' ? highlights.reason : null,
    };
  };
  const observeControlState = async () => {
    // FRAME carries the snapshot and its 20x9 grid under one sequence. A
    // GET/GRID pair is deliberately not used here: those reads cannot prove
    // they describe the same image at the helper's capture cadence.
    const frame = await readFrame();
    const monitor = measureMonitorUp(frame, monitorRule, { cells: frame.cells });
    const mask = measureMaskOn(frame, maskRule, { cells: frame.cells });
    // The fitted monitor rule answers only on the office HUD -- the screen a
    // raised monitor hides. Measured on Night 5 (campaign-2026-09-09T14-14-39,
    // 41 observations: 40 false, 1 true) it never once saw the monitor up,
    // while the retained video shows the camera feed up for half the night.
    // A visible camera highlight is the positive evidence it cannot give, so
    // the two are read as complements rather than one replacing the other:
    // highlights decide monitor-up, the office HUD decides monitor-down.
    let panel: {state: string, reason?: string, value?: string[]} = { state: 'UNKNOWN', reason: 'camera-watch-unavailable' };
    let panelRead: Readonly<Record<string, string>> | null = null;
    try {
      await ensureArmWatch();
      panelRead = await readPanel();
      panel = nativeCameraHighlights(panelRead, cameraRule);
    } catch { /* the fitted rule still carries the monitor-down half */ }
    // The camera rule is calibrated on monitor-up frames only; its behaviour
    // over the office is unmeasured. The helper's own screen classifier is the
    // independent guard: FNAF2_NIGHT is the office HUD, which a raised monitor
    // covers, so a highlight claimed against it is a contradiction and not a
    // state. FRAME and READ are separate round trips, so this also catches a
    // pairing straddling a real transition.
    const officeOnScreen = frame.screen === 'FNAF2_NIGHT';
    const panelUp = panel.state === 'OBSERVED' && !officeOnScreen ? true : null;
    // A positive monitor-rule result on a known office frame is impossible:
    // the office HUD is covered by a raised monitor. Do not let a stale or
    // overfit rule manufacture the illegal half of the pair.
    const ruleUp = monitor.state === 'OBSERVED' &&
      !(officeOnScreen && monitor.value === true) ? monitor.value : null;
    const contradicted = panel.state === 'OBSERVED' && officeOnScreen;
    const rawMonitorUp = panelUp ?? ruleUp;
    const rawMaskOn = mask.state === 'OBSERVED' ? mask.value : null;
    const exclusive = reconcileExclusiveControls({
      monitorUp: rawMonitorUp, maskOn: rawMaskOn,
    });
    const monitorUp = exclusive.monitorUp;
    const monitorSource = panelUp !== null ? 'camera-panel'
      : ruleUp !== null ? 'monitor-rule' : exclusive.monitorInference;
    const maskOn = exclusive.maskOn;
    const maskSource = exclusive.maskInference ??
      (mask.state === 'OBSERVED' ? 'mask-rule' : null);
    let visualCapture: ReturnType<typeof visualAcquisitionOf> | null = null;
    try { visualCapture = visualAcquisitionOf(frame); }
    catch { /* an unavailable timestamp leaves the state ACK usable but bounded */ }
    return {
      sequence: frame.seq,
      ageUs: frame.ageUs,
      screen: frame.screen,
      // The helper's fixed downward-chevron scores, carried through untouched.
      // They are the strongest tell the device offers for whether the office
      // controls are drawn, and the cycle gate refuses rather than falling back
      // to luma when they are missing (packages/play/src/sensors/fnaf2/button-strokes.ts).
      maskButtonDownstroke: frame.mask_button_downstroke ?? null,
      monitorButtonDownstroke: frame.monitor_button_downstroke ?? null,
      monitorUp,
      ...(monitorSource ? { monitorSource } : {}),
      panelSequence: panelRead?.seq ?? null,
      monitorReason: monitorUp !== null ? null
        : exclusive.contradiction ? exclusive.reason
        : contradicted ? 'camera-panel-over-office-hud'
        : monitor.state === 'UNKNOWN' ? monitor.reason : panel.reason,
      maskOn,
      ...(maskSource ? { maskSource } : {}),
      maskReason: maskOn !== null ? null
        : exclusive.contradiction ? exclusive.reason
        : mask.state === 'UNKNOWN' ? mask.reason : null,
      // A frame the fitted rule cannot classify is the only frame worth the
      // bytes: retaining its sensor row is what lets a later refit cover the
      // state, instead of another night spent rediscovering that it exists.
      ...(mask.state === 'OBSERVED' ? {} : { maskCells: frame.cells }),
      // The helper's darkness feature, carried so a refused frame can still
      // refute mask-on. It is never used to assert mask-on: that is the one
      // direction a blackout is indistinguishable from the mask.
      gridLuma: Math.floor(frame.cells.reduce((sum, cell) =>
        sum + (((77 * ((cell >> 16) & 0xff)) + (150 * ((cell >> 8) & 0xff)) +
          (29 * (cell & 0xff))) >> 8), 0) / frame.cells.length),
      maskEvidence: exclusive.maskInference === 'monitor-up-complement'
        ? 'exclusive-monitor-up' : maskEvidence,
      ...(visualCapture ? { visualCaptureAt: visualCapture.at,
        visualCaptureUncertaintyMs: visualCapture.uncertaintyMs } : {}),
    };
  };
  return { ensureArmWatch, observeArm, observeControlState };
}
