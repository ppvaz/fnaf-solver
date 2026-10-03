/**
 * What a cycle gate concludes about the mask from one control sample, and on
 * which evidence (adb-device-local-executor.ts runs the gate).
 *
 * The helper's fixed button chevrons decide this, not the 20x9 grid. Each
 * state hides one button and keeps the other, so the pair is a direct read of
 * both facts: both drawn is the office, a missing mask button is the monitor
 * up, and a missing MONITOR button is the mask on -- the mirror the operator
 * named on 2026-09-12, whose game fact actuator.ts already records ("while the
 * mask is up or coming off, the monitor bar is not drawn").
 *
 * The grid rule stays as a SECOND opinion and only where the strokes already
 * say the office is drawn, or where no stroke source exists at all. The
 * grid-luma refutation of mask-on is limited the same way: it no longer
 * decides a frame whose stroke source is present and shows no signature --
 * the frame the classifier could not even identify. On the 2026-09-12T02-20
 * run every single correction was made on such a frame (71% across all runs,
 * against 30% of gates that agreed), and a correction ACTS -- it presses the
 * mask -- so a wrong one does not report an inversion, it creates one.
 * `packages/play/bin/probe/intersection-state-gate.ts` has stated this rule all
 * along: a missing stroke score is a refusal, never a luma fallback.
 *
 * Where it may still decide, the refutation stays: it is the abort case, and
 * without it a night ends instead of correcting. It reads the 20x9 grid, a
 * discontinued sensor, and its floor was measured there; moving it to
 * native-region pixels waits on a floor measured on those pixels.
 */
import { buttonStrokeState } from '@sixam/play';

// Measured over 82 frames the fitted rule read confidently across the
// 2026-09-09 Night 5 runs: whole-grid mean luma reaches 10 at most with the
// mask on (n=52) and 25 at least with it off (n=30) -- a gap with no overlap.
// That bound refutes mask-on and nothing else. Asserting mask-on from darkness
// is exactly what `mask-calibrate.py` forbids, because a blacked-out office
// reads the same; refuting it is safe, and resolves 71% of the frames the
// anchors refuse.
const MASK_OFF_GRID_LUMA_FLOOR = 25;

/** The fields of a compacted control sample the gate's mask evidence reads. */
interface GateSample {
  readonly maskOn: boolean | null;
  readonly gridLuma?: number;
  readonly maskButtonDownstroke?: unknown;
  readonly monitorButtonDownstroke?: unknown;
}

/**
 * The mask state a gate may act on, or null when the sample does not show it.
 * @param believedMaskOn the plan's own mask belief at the gate
 */
export function gateMaskEvidence(sample: GateSample, believedMaskOn: boolean | null) {
  const strokes = buttonStrokeState(sample);
  const lumaMayDecide = !strokes.available || strokes.office;
  const refutesMaskOn = lumaMayDecide && sample.maskOn === null && believedMaskOn === true &&
    sample.gridLuma !== undefined && sample.gridLuma >= MASK_OFF_GRID_LUMA_FLOOR;
  const observedMaskOn = strokes.maskOn !== null ? strokes.maskOn
    : strokes.office && sample.maskOn !== null ? sample.maskOn
      : !strokes.available && sample.maskOn !== null ? sample.maskOn
        : refutesMaskOn ? false
          : null;
  const source = strokes.maskOn !== null
    ? `button-stroke:${strokes.signature}`
    : strokes.office && sample.maskOn !== null ? 'office-stroke+mask-rule'
      : !strokes.available && sample.maskOn !== null ? 'mask-rule'
        : refutesMaskOn ? 'grid-luma-refutation'
          : strokes.available ? 'stroke-signature-absent' : 'stroke-unavailable';
  return { observedMaskOn, source, strokeSignature: strokes.signature };
}
