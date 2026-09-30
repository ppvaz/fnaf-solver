// Where a control lives, and at which view.
//
// `device-profile-v1` carries one screen coordinate per control. That is
// correct for a control pinned to the screen and silently wrong for one that
// scrolls with the office, and the profile already knows the difference: its
// `view-scroll-v1` block marks `hallLight`, `leftVentLight`, `rightVentLight`
// and `cameraFeedLight` pan-dependent, lists the pinned layer-4 buttons beside
// them, and says in prose that "NOTHING in the executor models pan state, so
// every entry marked true has a coordinate valid only at pan 0". It then adds
// that the two vent lights are 1297 px apart in a 1024 px window and "CANNOT
// both be correct at any single fixed screen coordinate -- the profile maps
// leftVentLight and rightVentLight to fixed points regardless".
//
// All of that is a measurement living in a comment, which is mistake register
// entry 9. This module is the part a check reads. FNaF 1 is why it could not
// wait: its two door buttons sit 2779 px apart on a 2400 px screen, so they can
// never both be on screen and every door press is pan-then-press. A flat
// coordinate cannot express that control even in principle.
//
// The vocabulary is deliberately small and matches how the measurements were
// actually taken -- a screen coordinate read off a frame at a known pan:
//
//   anchor: 'screen'   pinned; the coordinate holds at every view offset
//   anchor: 'world'    scrolls 1:1 with the view; valid at `measuredAtPan`
//   (absent)           UNSTATED -- not a synonym for either
//
// Absent stays legal, because every profile in the tree predates this and a
// profile's bytes are hashed into the bundles and qualifications that bind to
// it (`stableHash(this.profile)`); silently rewriting them would orphan those
// bindings exactly as the `ANCHOR_AIMS` drift did on 2026-09-15. So an unstated
// control keeps resolving at pan 0, which is what every existing route already
// assumes, and refuses anywhere else rather than returning a coordinate nobody
// measured. That refusal is the Minus 3 pan hazard becoming visible: holding
// `rightVentLight` pans the office, and no route has ever modelled it.
//
// Pan here is horizontal. Every office in these games scrolls on x alone
// (`view-scroll-v1`: worldHeight 768 in a 768 window), so a vertical claim is
// refused rather than quietly ignored.

const finite = value => typeof value === 'number' && Number.isFinite(value);

export const ANCHOR_KINDS = Object.freeze(['screen', 'world']);

/** The pan is unknown until something reads it; `view-scroll-v1` records that
 * the Cue Helper's `pan_anchor_state` read UNKNOWN throughout 2026-09-19. */
export const PAN_UNKNOWN = null;

class ControlAnchorError extends Error {}

const fail = message => { throw new ControlAnchorError(message); };

/**
 * Shape rules for one `controlMap` entry. Absent anchor is legal; a half
 * declaration is not, because "world with no pan" and "screen with a pan" are
 * each an author believing one of the two facts wrongly.
 * @param {string} control semantic control name
 * @param {any} point the profile's entry for it
 */
export function validateControlAnchor(control, point) {
  if (!point || typeof point !== 'object') fail(`control ${control} has no coordinate binding`);
  if (!finite(point.x) || !finite(point.y)) fail(`control ${control} has no finite coordinate`);
  const { anchor } = point;
  const hasPan = Object.hasOwn(point, 'measuredAtPan');
  if (anchor === undefined) {
    if (hasPan) fail(`control ${control} states a pan but no anchor kind: a coordinate measured ` +
      `at a pan is world-anchored, so say so`);
    return point;
  }
  if (!ANCHOR_KINDS.includes(anchor))
    fail(`control ${control} has anchor "${anchor}"; it must be ${ANCHOR_KINDS.join(' or ')}`);
  if (anchor === 'screen' && hasPan)
    fail(`control ${control} is screen-pinned and cannot have been measured at a pan: ` +
      `a pinned control has the same coordinate at every view offset`);
  if (anchor === 'world') {
    if (!finite(point.measuredAtPan) || point.measuredAtPan < 0)
      fail(`control ${control} is world-anchored and must declare measuredAtPan, the view ` +
        `offset its coordinate was read at (0 for a control measured at rest)`);
  }
  if (Object.hasOwn(point, 'measuredAtPanY'))
    fail(`control ${control} declares a vertical pan; these offices scroll on x alone`);
  return point;
}

/** World x of a world-anchored control: the screen x it was read at, plus the
 * pan it was read at. This is derived, never stored, so the profile keeps the
 * measurement and a check does the arithmetic. */
export function worldX(control, point) {
  validateControlAnchor(control, point);
  if (point.anchor !== 'world')
    fail(`control ${control} is not world-anchored, so it has no world x`);
  return point.x + point.measuredAtPan;
}

/**
 * The screen point to press for `control` at the current view, or a refusal
 * naming the cause. `viewOffset` is the office's current pan in screen px, or
 * `PAN_UNKNOWN` when nothing has read it.
 * @param {string} control semantic control name
 * @param {any} point the profile's entry for it
 * @param {{ viewOffset?: number|null, screenWidth?: number }} [view]
 */
export function resolveControlPoint(control, point, view = {}) {
  validateControlAnchor(control, point);
  const { viewOffset = 0, screenWidth } = view;
  if (viewOffset !== PAN_UNKNOWN && (!finite(viewOffset) || viewOffset < 0))
    fail(`view offset must be a non-negative number of screen px or PAN_UNKNOWN, got ${viewOffset}`);
  const anchor = point.anchor ?? 'unstated';

  if (anchor === 'screen') return place(control, point.x, point.y, anchor, viewOffset, screenWidth);

  if (viewOffset === PAN_UNKNOWN)
    fail(`control ${control} ${anchor === 'world' ? 'scrolls with the office' : 'has no anchor kind'}` +
      `, so its coordinate depends on the pan, and the pan is UNKNOWN. Read the view offset, or ` +
      `press a screen-pinned control instead.`);

  if (anchor === 'unstated') {
    if (viewOffset === 0) return place(control, point.x, point.y, anchor, viewOffset, screenWidth);
    fail(`control ${control} has no anchor kind, so its coordinate is only valid at the pan it ` +
      `was measured at, and the office is panned ${viewOffset} px. Declare anchor:"screen" if it ` +
      `is pinned, or anchor:"world" with the measuredAtPan it was read at.`);
  }

  // World-anchored: the control scrolls 1:1 with the view, so panning right by
  // d moves it left by d on screen.
  return place(control, point.x - (viewOffset - point.measuredAtPan), point.y, anchor, viewOffset, screenWidth);
}

function place(control, x, y, anchor, viewOffset, screenWidth) {
  if (finite(screenWidth) && (x < 0 || x >= screenWidth))
    fail(`control ${control} resolves to x ${Math.round(x)} at pan ${viewOffset}, which is off a ` +
      `${screenWidth} px screen: it is not reachable from this view and must be panned to first`);
  return { x, y, anchor, viewOffset };
}

/**
 * Every control a profile's `view-scroll-v1` block marks pan-dependent, whose
 * `controlMap` entry does not say so. The profile states the fact in one place
 * and binds a coordinate in another; this is the pair that has to agree.
 * @param {any} profile a parsed device profile
 */
export function unstatedPanDependentControls(profile) {
  const flags = profile?.viewScroll?.panDependent;
  if (!flags || typeof flags !== 'object') return [];
  return Object.entries(flags)
    .filter(([, dependent]) => dependent === true)
    .map(([control]) => control)
    .filter(control => profile.controlMap?.[control] && profile.controlMap[control].anchor === undefined);
}
