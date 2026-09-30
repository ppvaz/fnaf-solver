import * as C from '@sixam/source/fnaf2';

// The published brayden/Shooter25 timing, expressed in frames. The plant model
// and the eventual device compiler consume this semantic route separately.
export const CYCLE = Object.freeze({
  periodFrames: C.s(15),
  mainStartFrames: C.s(29.5),
  maskDownFrames: 0,
  maskOffFrames: C.s(5.7),
  foxyFlashFrames: C.s(7.6),
  ventLightFrames: C.s(7.7),
  nextRaiseFrames: C.s(10.5),
  windFrames: C.s(10.75),
  openingFirstRaiseFrames: 1,
  openingFirstCameraFrames: C.MONITOR_ANIM_UP + 2,
  openingFirstWindFrames: C.MONITOR_ANIM_UP + 4,
});

export const ROUTE = Object.freeze({
  id: 'right-vent-camp',
  night: 7,
  clock: '15-second-loop',
  actions: Object.freeze(['mask', 'hall-flash', 'right-vent-light', 'cam:11', 'wind']),
  branches: Object.freeze([
    Object.freeze({ when: 'blackout', then: 'mask-through-blackout' }),
    Object.freeze({ when: 'toy-bonnie-in-right-vent', then: 'skip-vent-light-and-wind' }),
    Object.freeze({ when: 'vent-character-at-opening', then: 'mask-and-defer-next-raise' }),
  ]),
});

export function routeFor(night = 7, overrides = {}) {
  if (night !== 7) throw new Error('Right Vent Camp route requires night 7 / 10-20');
  return Object.freeze({ ...ROUTE, cycle: Object.freeze({ ...CYCLE, ...overrides }) });
}

export function emitPlan(overrides = {}) {
  const route = routeFor(7, overrides);
  return [
    '#format model-route-v1',
    '#policy right-vent-camp',
    '#night 7',
    '#execution model-only',
    '#opening first-20-seconds wind-and-flash-every-5-seconds',
    `#period ${Math.round(route.cycle.periodFrames * 1000 / C.FPS)}`,
    '#beat wind->mask/blackout->recovery->right-vent-stall',
    '#branch blackout mask-through-blackout',
    '#branch toy-bonnie-in-right-vent skip-vent-light-and-wind',
    '#branch vent-character-at-opening mask-and-defer-next-raise',
    JSON.stringify(route.cycle),
  ].join('\n') + '\n';
}
