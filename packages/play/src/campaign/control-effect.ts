/**
 * Whether a monitor or mask contact had its effect: the control reads a
 * device-local night samples after each transition, compacted for the event
 * log and graded against the transition's target. Split out of
 * adb-device-local-executor.js on 2026-09-25.
 */
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function boundedSampleText(value) {
  return typeof value === 'string' && value.length <= 160 ? value : null;
}

export function compactControlSample(value) {
  const sample = isRecord(value) ? value : {};
  const sequence = typeof sample.sequence === 'string' || Number.isSafeInteger(sample.sequence)
    ? sample.sequence : null;
  const ageUs = typeof sample.ageUs === 'string' && /^\d+$/.test(sample.ageUs)
    ? sample.ageUs : Number.isSafeInteger(sample.ageUs) && sample.ageUs >= 0 ? sample.ageUs : null;
  const screen = typeof sample.screen === 'string' && sample.screen.length <= 80 ? sample.screen : null;
  const monitorUp = typeof sample.monitorUp === 'boolean' ? sample.monitorUp : null;
  const maskOn = typeof sample.maskOn === 'boolean' ? sample.maskOn : null;
  const monitorReason = boundedSampleText(sample.monitorReason ?? sample.reason)
    ?? (monitorUp === null ? 'monitor-state-unavailable' : null);
  const maskReason = boundedSampleText(sample.maskReason)
    ?? (maskOn === null ? 'mask-state-unavailable' : null);
  const maskEvidence = boundedSampleText(sample.maskEvidence);
  const maskSource = boundedSampleText(sample.maskSource);
  // Which detector answered is part of the observation: the camera panel and
  // the office HUD see opposite halves of the monitor state.
  const monitorSource = boundedSampleText(sample.monitorSource);
  const gridLuma = Number.isSafeInteger(sample.gridLuma) && sample.gridLuma >= 0
    ? sample.gridLuma : null;
  // Only ever present on a frame the fitted rule refused, and bounded to the
  // helper's fixed 20x9 sensor so a run bundle cannot grow without limit.
  const maskCells = Array.isArray(sample.maskCells) && sample.maskCells.length === 180 &&
    sample.maskCells.every(Number.isSafeInteger) ? sample.maskCells : null;
  const panelSequence = typeof sample.panelSequence === 'string' ||
    Number.isSafeInteger(sample.panelSequence) ? sample.panelSequence : null;
  // The helper's fixed downward-chevron scores. They are what the cycle gate
  // decides a frame's readability on, so they are retained in the bundle.
  const strokeScore = value => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  };
  const maskButtonDownstroke = strokeScore(sample.maskButtonDownstroke);
  const monitorButtonDownstroke = strokeScore(sample.monitorButtonDownstroke);
  const visualCaptureAt = Number.isFinite(sample.visualCaptureAt) ? sample.visualCaptureAt : null;
  const visualCaptureUncertaintyMs = Number.isFinite(sample.visualCaptureUncertaintyMs) &&
    sample.visualCaptureUncertaintyMs >= 0 ? sample.visualCaptureUncertaintyMs : null;
  return { sequence, ageUs, screen, monitorUp, monitorReason, maskOn, maskReason,
    ...(monitorSource ? { monitorSource } : {}),
    ...(maskSource ? { maskSource } : {}),
    ...(gridLuma === null ? {} : { gridLuma }),
    ...(maskCells ? { maskCells } : {}),
    ...(panelSequence === null ? {} : { panelSequence }),
    ...(maskEvidence ? { maskEvidence } : {}),
    ...(maskButtonDownstroke === null ? {} : { maskButtonDownstroke }),
    ...(monitorButtonDownstroke === null ? {} : { monitorButtonDownstroke }),
    ...(visualCaptureAt === null ? {} : { visualCaptureAt }),
    ...(visualCaptureUncertaintyMs === null ? {} : { visualCaptureUncertaintyMs }) };
}

/**
 * Grade one authored transition from the samples taken after its contact.
 *
 * The latency is measured, not compared against a settle constant, and it is
 * reported as the bracket of the read that first saw the target: the host
 * cannot place a device frame inside its own read without inferring a clock
 * offset, so both bounds are retained and neither is called the answer.
 * `atFirstFrame` marks the case the series cannot separate — a state already
 * at target before the contact looks exactly like an instant effect.
 */
export function controlEffectVerdict(reads, signal, target, contactAt) {
  const reasonKey = signal === 'monitorUp' ? 'monitorReason' : 'maskReason';
  const samples = reads.map(read => ({ ...compactControlSample(read.sample),
    readStartedAt: read.readStartedAt, readFinishedAt: read.readFinishedAt,
    sinceContactLowerMs: read.readStartedAt === null ? null : read.readStartedAt - contactAt,
    sinceContactUpperMs: read.readFinishedAt === null ? null : read.readFinishedAt - contactAt }));
  const verdict = (status, reason, latency = null) => ({ status, reason, latency, samples });
  if (samples.some(sample => sample.screen !== null &&
      sample.screen !== 'FNAF2_NIGHT' && sample.screen !== 'UNKNOWN'))
    return verdict('UNKNOWN', 'screen-identity');
  // A repeated frame sequence is the helper's capture cadence, not a fault. It
  // carries no new observation, so it can neither confirm nor refute a target.
  const frames = [];
  for (const sample of samples) {
    if (sample.sequence === null || sample[signal] === null) continue;
    if (frames.length && String(frames.at(-1).sequence) === String(sample.sequence)) continue;
    frames.push(sample);
  }
  if (!frames.length)
    return verdict('UNKNOWN', samples.find(sample => sample[reasonKey])?.[reasonKey]
      ?? `${signal}-state-unavailable`);
  // One frame decides nothing in either direction: a stalled capture shows the
  // pre-contact state as convincingly as a genuinely lost effect does.
  if (frames.length < 2) return verdict('UNKNOWN', 'insufficient-frames');
  const held = frames.findIndex((sample, index) =>
    sample[signal] === target && frames[index + 1]?.[signal] === target);
  if (held !== -1)
    return verdict('PASS', null, { lowerMs: frames[held].sinceContactLowerMs,
      upperMs: frames[held].sinceContactUpperMs, frameAgeUs: frames[held].ageUs,
      atFirstFrame: held === 0 });
  if (frames.some(sample => sample[signal] === target))
    return verdict('UNSTABLE', 'target-not-held-across-frames');
  return verdict('MISSING', 'target-not-observed');
}

export function effectTransitions(monitorTransitions = [], maskTransitions = []) {
  return [
    ...monitorTransitions.map(transition => ({ ...transition, signal: 'monitorUp',
      target: transition.targetMonitorUp })),
    ...maskTransitions.map(transition => ({ ...transition, signal: 'maskOn',
      target: transition.targetMaskOn })),
  ].sort((left, right) => left.atMs - right.atMs ||
    left.actionId.localeCompare(right.actionId) || left.signal.localeCompare(right.signal));
}
