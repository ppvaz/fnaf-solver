// The Sim's own constants, shared by plant-model.js and its mechanism modules. The sourced game constants
// are config.js's.

/** route nodes whose entry plays a footstep sound, by default the hall stages only. 8a7288b narrowed the set
 * to these because full-06's audio had no footstep sound (25-29) on a Withered hop onto cams 01-4
 * (docs/evidence/night7-k3-frametrace-nights-20260915.json); that negative is not evidence, since its
 * detector cannot hear samples 25-29 in that capture (docs/evidence/footstep-cam-markers-adjudication-20260927.json).
 * footstepCamMarkers adds the CAM 01-04 markers the CCN's geometry puts under `hear footsteps`. */
export const FOOTSTEP_NODES = /** @type {Set<string | number>} */ (new Set(['blindA', 'blindB']));
// sourcedHourTable: Golden Freddy's `(Random(N) + 1) / N` in the first-loop hour row (g677, g679, g681).
export const SOURCED_HOUR0_GOLDEN = /** @type {Record<number, number>} */ ({ 3: 1000, 4: 100, 5: 100 });
// footstepCamMarkers: the markers the CCN's own geometry puts under `hear footsteps`.
export const FOOTSTEP_CAM_NODES = /** @type {Set<string | number>} */ (new Set([1, 2, 3, 4, 'blindA', 'blindB']));
// sourcedOfficeFootsteps: the route units whose sprite on `in office` (122) overlaps `hear footsteps`.
export const OFFICE_FOOTSTEP_IDS = new Set(['withbonnie', 'toybonnie', 'mangle']);
// sourcedRouteViewDraws: the move groups' sheet order (g374-g435), with Balloon Boy's (g413-g418) and g419 in place.
export const ROUTE_MOVE_ORDER = ['withfreddy', 'withbonnie', 'withchica', 'mangle', 'bb', 'g419', 'toyfreddy', 'toybonnie', 'toychica'];
export const MON_DOWN = 'down';
export const MON_RAISING = 'raising';
export const MON_UP = 'up';
export const MON_LOWERING = 'lowering';
// sourcedValue5: g1236's divisor, the Double token decoded as 32.32 fixed as the Android runtime reads it.
export const VALUE5_DIVISOR = 71582788266 / 2 ** 32;
