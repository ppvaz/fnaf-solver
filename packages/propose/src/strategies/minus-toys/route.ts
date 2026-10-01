import * as C from '@sixam/source/fnaf2';

// Interval-relative semantic route. Contact timing is compiled by the device
// adapter; the plant model consumes these frame offsets directly.
export const CYCLE = Object.freeze({
  raise: 6,
  flashOn: 13,
  flashOff: 17,
  windOn: 18,
  windOff: 229,
  drop: 240,
  mask: 242,
  lightOff: 244,
  unmaskMin: 540,
});

export const ROUTE = Object.freeze({
  id: 'minus-toys',
  night: '2..7',
  split: Object.freeze({ viewing: 11, marker: 9 }),
  setup: Object.freeze([
    [0, 'press', 'monitor'], [13, 'press', 'cam:11'],
    [25, 'press', 'cam:9'], [25, 'press', 'monitor'],
    [48, 'press', 'monitor'], [62, 'press', 'light'],
    [66, 'release', 'light'], [67, 'press', 'wind'],
    [235, 'release', 'wind'], [235, 'press', 'light'],
    [240, 'press', 'monitor'], [242, 'press', 'mask'],
    [244, 'release', 'light'],
  ]),
});

// Frozen compatibility schedule for the package's original family API. It is
// intentionally kept beside the route data, not in a second family model.
/** One edge the plant replays: press or release, and the control. */
export type SimEdge = readonly ['press' | 'release', string];

export const LEGACY_SETUP = new Map<number, readonly SimEdge[]>([
  [0, [['press', 'monitor']]],
  [13, [['press', 'cam:11']]],
  [25, [['press', 'cam:9'], ['press', 'monitor']]],
  [48, [['press', 'monitor']]],
  [62, [['press', 'light']]],
  [66, [['release', 'light']]],
  [67, [['press', 'wind']]],
  [235, [['release', 'wind'], ['press', 'light']]],
  [240, [['press', 'monitor']]],
  [242, [['press', 'mask']]],
  [244, [['release', 'light']]],
]);

export const LEGACY_LOOP = new Map<number, readonly SimEdge[]>([
  [540, [['press', 'mask']]],
  [556, [['press', 'light']]],
  [560, [['release', 'light']]],
  [606, [['press', 'monitor']]],
  [619, [['press', 'light']]],
  [623, [['release', 'light']]],
  [624, [['press', 'wind']]],
  [835, [['release', 'wind'], ['press', 'light']]],
  [840, [['press', 'monitor']]],
  [842, [['press', 'mask']]],
  [844, [['release', 'light']]],
]);

export const fifthBoundary = (frame: number) =>
  frame + ((C.FPS - (frame % C.FPS)) % C.FPS) + 4 * C.FPS + 1;

export function routeFor(night = 7, overrides: Partial<typeof CYCLE> = {}) {
  if (!Number.isInteger(night) || night < 1 || night > 7)
    throw new Error('Minus Toys route requires night 1..7');
  return Object.freeze({ ...ROUTE, night, cycle: Object.freeze({ ...CYCLE, ...overrides }) });
}
