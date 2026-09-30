/**
 * The Cue Helper's fixed downward-chevron button scores, and what they mean.
 *
 * The helper publishes `mask_button_downstroke` and `monitor_button_downstroke`
 * on every FRAME: a local max-channel contrast score over the two stroke lines
 * of the office's bottom controls, from the same native image as `seq`, `age`
 * and `screen`. They are a far stronger tell than the 20x9 grid, whose bottom
 * samples are too coarse for the glyph.
 *
 * This module exists so the thresholds have ONE home. They were defined in
 * `tools/device/intersection-state-gate.mjs`, which consumed them correctly
 * and said so -- "fitted grid anchors are a diagnostic fallback only", "a
 * missing stroke score is a refusal, never a luma fallback" -- while the
 * executor answered the same questions from the grid with exactly the luma
 * fallback that file forbids. A second copy of a threshold is how two parts of
 * one system end up disagreeing about the same frame.
 *
 * CONTRACT:semantic-control-v1.
 */

export const BUTTON_STROKE_THRESHOLDS = Object.freeze({
  /** 100 of roughly 142 sampled stroke columns is a full glyph. */
  visibleMin: 100,
  /** Transitional and scene edges remain below this absent ceiling. */
  absentMax: 40,
});

const score = value => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

/**
 * Classify one frame's bottom controls. The two chevrons are read SYMMETRICALLY:
 * each state hides one button and keeps the other.
 *
 *   mask visible + monitor visible  -> office: HUD drawn, mask off, monitor down
 *   mask ABSENT  + monitor visible  -> the monitor is up
 *   mask visible + monitor ABSENT   -> the mask is on
 *   both absent                     -> neither; refuse
 *
 * The monitor-up row is the operator's own observation and the signature the
 * monitor-up probe was built on. The mask-on row is its mirror, and the game
 * fact behind it is already written down in `tools/device/actuator.mjs`: "while
 * the mask is up or coming off, the monitor bar is not drawn, so a monitor
 * press there has no control under it". The mask button itself must stay drawn
 * while masked -- it is how the mask comes off.
 *
 * A missing score, or a pair matching no signature, returns nulls. That is
 * deliberate and is the whole point: an unreadable frame withholds an answer
 * instead of being downgraded to a luma guess.
 */
export function buttonStrokeState(sample) {
  const mask = score(sample?.maskButtonDownstroke);
  const monitor = score(sample?.monitorButtonDownstroke);
  if (mask === null || monitor === null)
    return { available: false, signature: null, office: false,
      monitorUp: null, maskOn: null };
  const { visibleMin, absentMax } = BUTTON_STROKE_THRESHOLDS;
  const maskVisible = mask >= visibleMin;
  const maskAbsent = mask <= absentMax;
  const monitorVisible = monitor >= visibleMin;
  const monitorAbsent = monitor <= absentMax;
  const office = maskVisible && monitorVisible;
  const monitorUpSignature = maskAbsent && monitorVisible;
  const maskOnSignature = maskVisible && monitorAbsent;
  const signature = office ? 'office'
    : monitorUpSignature ? 'monitor-up'
      : maskOnSignature ? 'mask-on' : null;
  return {
    available: true, office, signature,
    // Each fact is asserted only by a signature that names it, and by the
    // office row that excludes it. Anything else leaves it unknown.
    monitorUp: office ? false : monitorUpSignature ? true : maskOnSignature ? false : null,
    maskOn: office ? false : maskOnSignature ? true : monitorUpSignature ? false : null,
  };
}
