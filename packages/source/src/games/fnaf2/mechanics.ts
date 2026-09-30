/**
 * FNaF 2's named mechanics: behaviours of the compiled game that a strategy
 * can require and a run's constraints can forbid. An id is a stored name (ADR
 * 0002 principle 9). Each entry cites the event-sheet groups and the fact
 * index section that read them, and paraphrases; it never copies dump text
 * (Pedro's decision 12, 2026-09-29).
 */

/** The double-camera glitch, which the routes and the code call the camera split. */
export const CAMERA_SPLIT = 'fnaf2.camera-split';

export const FNAF2_MECHANICS = Object.freeze({
  // Select camera X and lower the monitor before the next 200 ms sample of
  // `last viewed` (g263): the completed raise restores `viewing` to the
  // previous camera Y (g1 -> g2) while the `your view` marker stays on X, and
  // only a camera touch re-syncs them (g39/g40, the latch g45 clears). The
  // flash immunity gates read `viewing`; the flash target and the look-hold
  // stall read the marker (g450-g457, g344-g348).
  [CAMERA_SPLIT]: Object.freeze({
    id: CAMERA_SPLIT,
    name: 'the double-camera glitch',
    label: 'SOURCED',
    groups: Object.freeze(['g1', 'g2', 'g39', 'g40', 'g45', 'g263', 'g344-g348', 'g450-g457']),
    cites: 'docs/android/UNIFIED-SOURCED-ENGINE-FACT-INDEX.md §5',
  }),
});
