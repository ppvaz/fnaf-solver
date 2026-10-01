// Camera pairs that identify the two supported double-camera glitch arms.
// Values use the same `cam:N` vocabulary as the Companion and policy-v1.
export const DOUBLE_GLITCH_CAMERA_PAIRS = Object.freeze({
  minus3: Object.freeze(['cam:8', 'cam:11']),
  minusToys: Object.freeze(['cam:9', 'cam:11']),
});

export const cameraPairHeader = (pair: readonly string[]) => {
  if (!Array.isArray(pair) || pair.length < 2) throw new TypeError('camera arm needs a pair');
  return pair.join(',');
};
