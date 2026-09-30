import * as C from '@sixam/source/fnaf2';

// Frame-relative route constants. Device timing and contacts belong to the
// device adapter; this file is the readable strategy route.
export const CYCLE = Object.freeze({
  raise: 2,
  sweepGap: C.MONITOR_ANIM_UP,
  windGap: 16,
  windEnd: 244,
  sweepB: 245,
  lower: 250,
  hall: 270,
  mask: 273,
  raiseMax: 210,
  lateMax: 261,
});

export const ROUTE = Object.freeze({
  id: 'minus-7',
  night: 7,
  monitorDownAtInterval: true,
  actions: Object.freeze(['raise', 'sweep', 'wind', 'lower', 'hall-flash', 'mask']),
});

export function routeFor(night = 7, overrides = {}) {
  if (night !== 7) throw new Error('Minus 7 route requires night 7 / 10-20');
  return Object.freeze({ ...ROUTE, cycle: Object.freeze({ ...CYCLE, ...overrides }) });
}
