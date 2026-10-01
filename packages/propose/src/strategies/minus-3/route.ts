import * as C from '@sixam/source/fnaf2';

// Device/contact calibration belongs to the device adapter. These values are
// the strategy's semantic route: camera split, ten-second cadence, hall flash,
// winding leg, and mask leg.
export const KNOBS0 = Object.freeze({
  contactMs: 33,
  periodMs: 10000,
  loopStartMs: 5000,
  stopAtMs: 419600,
  observeUntilMs: 420000,
  openViewMs: 0,
  openLastViewedMs: 300,
  openArmMs: 833,
  armingGapMs: 50,
  openRaiseGapMs: 733,
  // The opening raise lands at openArmMs + openRaiseGapMs = 1616 ms, and a wind
  // contact is only observed to land from raise+434 ms. 2050 was raise+434
  // EXACTLY -- zero slack against a floor that is itself only the lowest
  // observed working gap, so a single frame of jitter puts the contact in the
  // region where raise+200 measurably missed and the box went unwound. Moved to
  // raise + 434 + RAISE_MARGIN_MS (33) = 2083, the same margin every shipped
  // minus-toys winner clears this floor by. The hold gives up those 33 ms
  // rather than the camdrop at 4000 ms moving: the wind still ends at 3850.
  openWindMs: 1767,
  openWindAtMs: 2083,
  openCamdropAtMs: 4000,
  openCamdropLeadMs: 150,
  openCamdropMonitorMs: 33,
  openCamdropTailMs: 400,
  openMaskAtMs: 4650,
  maskOffMs: 4400,
  raiseMs: 5300,
  windAtMs: 5800,
  windMs: 3200,
  camdropMs: 9000,
  camdropLeadMs: 150,
  camdropMonitorMs: 33,
  camdropTailMs: 400,
  secondHallMs: 4700,
  secondHallHoldMs: 400,
  secondHallVent: true,
  maskOnMs: 9600,
  // Minimal-input modes for dial vectors that do not need the leg. Both were
  // derived for the 4/20 Custom Night vector (withered four at 20, rest 0):
  // maskless drops every mask row (3000/3000 at the 4/20 vector; the mask is
  // dead weight when the office-entry pressure is the capped withered trio),
  // ventless narrows the hall+vent composite flash to the plain hall flash
  // (ventR is droppable; the hall leg alone resets Foxy at his 17 cap).
  maskless: false,
  ventless: false,
});

type Knobs = typeof KNOBS0;
/** One authored row of the route, in ms: a tap or hold of a control, a hall flash, or a camdrop. */
type RouteRow =
  | readonly [at: number, kind: 'tap' | 'hold', action: string, ms: number]
  | readonly [at: number, kind: 'hall' | 'hallvent', holdMs: number]
  | readonly [at: number, kind: 'camdrop', leadMs: number, monitorMs: number, tailMs: number];
/** A frame-locked edge the plant replays: its frame, its row's index, press or release, the control. */
type ScheduleRow = [frame: number, index: number, kind: 'press' | 'release', action: string];

const clone = (overrides?: Partial<Knobs> | null) => ({ ...KNOBS0, ...(overrides ?? {}) });
const frame = (ms: number) => Math.round(ms * C.FPS / 1000);
const actionFor = (action: string) => action.startsWith('cam') ? `cam:${action.slice(3)}` : action;

export function build(overrides: Partial<Knobs> = {}) {
  const k = clone(overrides);
  const c = k.contactMs;
  const opening: RouteRow[] = [
    [k.openViewMs, 'tap', 'monitor', c],
    [k.openLastViewedMs, 'tap', 'cam11', c],
    [k.openArmMs, 'tap', 'cam8', c],
    [k.openArmMs + k.armingGapMs, 'tap', 'monitor', c],
    [k.openArmMs + k.armingGapMs + k.openRaiseGapMs, 'tap', 'monitor', c],
    [k.openWindAtMs, 'hold', 'wind', k.openWindMs],
    [k.openCamdropAtMs, 'camdrop', k.openCamdropLeadMs,
      k.openCamdropMonitorMs, k.openCamdropTailMs],
    [k.openMaskAtMs, 'tap', 'mask', c],
  ];
  const clear: RouteRow[] = [
    [k.maskOffMs, 'tap', 'mask', c],
    [k.secondHallMs, k.secondHallVent ? 'hallvent' : 'hall', k.secondHallHoldMs],
    [k.raiseMs, 'tap', 'monitor', c],
    [k.windAtMs, 'hold', 'wind', k.windMs],
    [k.camdropMs, 'camdrop', k.camdropLeadMs,
      k.camdropMonitorMs, k.camdropTailMs],
    [k.maskOnMs, 'tap', 'mask', c],
  ];
  return { opening, clear, knobs: k };
}

export function schedule({ opening, clear, knobs, untilMs }: {opening?: readonly RouteRow[], clear?: readonly RouteRow[], knobs?: Partial<Knobs>, untilMs?: number} = {}) {
  const k = clone(knobs);
  const built = opening && clear ? { opening, clear } : build(k);
  const queue: ScheduleRow[] = [];
  const add = (base: number, row: RouteRow, index: number) => {
    const when = base + row[0];
    if (row[1] === 'tap') queue.push([frame(when), index, 'press', actionFor(row[2])]);
    else if (row[1] === 'hold') {
      const action = actionFor(row[2]);
      queue.push([frame(when), index, 'press', action],
        [frame(when + row[3]), index, 'release', action]);
    } else if (row[1] === 'hall') {
      queue.push([frame(when), index, 'press', 'light'],
        [frame(when + row[2]), index, 'release', 'light']);
    } else if (row[1] === 'hallvent') {
      queue.push([frame(when), index, 'press', 'light'],
        [frame(when), index, 'press', 'ventR'],
        [frame(when + row[2]), index, 'release', 'light'],
        [frame(when + row[2]), index, 'release', 'ventR']);
    } else if (row[1] === 'camdrop') {
      queue.push([frame(when), index, 'press', 'light'],
        [frame(when + row[2]), index, 'press', 'monitor'],
        [frame(when + row[2] + row[3] + row[4]), index, 'release', 'light']);
    } else throw new Error(`unknown Minus 3 row ${(row as readonly unknown[])[1]}`);
  };
  built.opening.forEach((row, index) => add(0, row, index));
  const end = untilMs ?? k.stopAtMs;
  for (let base = k.loopStartMs; base < end; base += k.periodMs)
    built.clear.forEach((row, index) => add(base, row, index));
  return queue.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

// Branch-aware route timing. These are frame offsets because the plant is
// frame-locked; device conversion happens in Play's campaign later.
export const REACTIVE_KNOBS = Object.freeze({
  firstAnchorFrames: 600,
  cycleFrames: 600,
  maskOffLeadFrames: 36,
  hallOffsetFrames: -18,
  hallHoldFrames: 24,
  raiseOffsetFrames: 18,
  cameraOffsetFrames: 30,
  windOffsetFrames: 30,
  dropOffsetFrames: 240,
  monitorDropLeadFrames: 9,
  lightTailFrames: 35,
  maskOnOffsetFrames: 276,
  resumeLeadFrames: 60,
  toyBonnieSafetyFrames: 230,
});

export const MINUS3_STORY_NIGHTS: readonly number[] = Object.freeze([3, 4, 5]);

export function reactiveRoute(night: number, overrides: Partial<typeof REACTIVE_KNOBS> = {}) {
  if (!Number.isInteger(night) || !MINUS3_STORY_NIGHTS.includes(night))
    throw new Error('Minus 3 reactive route requires story night 3..5');
  const k = { ...REACTIVE_KNOBS, ...overrides };
  return {
    schema: 'model-route-v1',
    policy: 'minus3-reactive',
    night,
    execution: 'model-only',
    opening: build(KNOBS0).opening,
    cycle: {
      anchorFrames: k.firstAnchorFrames,
      periodFrames: k.cycleFrames,
      maskOff: -k.maskOffLeadFrames,
      hall: [k.hallOffsetFrames, k.hallHoldFrames],
      raise: k.raiseOffsetFrames,
      camera: k.cameraOffsetFrames,
      wind: k.windOffsetFrames,
      drop: k.dropOffsetFrames,
      maskOn: k.maskOnOffsetFrames,
    },
    branches: [
      { when: 'blackout.visible', then: 'hold-mask-and-defer-cycle' },
      { when: 'bb.left-opening || mangle.right-opening', then: 'defer-monitor-raise' },
      { when: 'toybonnie.right-opening-near-expiry', then: 'defer-monitor-raise' },
      { when: 'threat-cleared-and-mask-fully-on', then: 'reanchor-next-5s-boundary' },
    ],
  };
}

export function emitReactivePlan(night: number, overrides: Partial<typeof REACTIVE_KNOBS> = {}) {
  const route = reactiveRoute(night, overrides);
  const ms = (frames: number) => Math.round(frames * 1000 / C.FPS);
  return [
    '#format model-route-v1',
    `#policy ${route.policy}`,
    `#night ${night}`,
    '#execution model-only',
    '#arm split cam:11-viewing cam:8-marker',
    `#anchor ${ms(route.cycle.anchorFrames)}`,
    `#period ${ms(route.cycle.periodFrames)}`,
    '#branch blackout.visible hold-mask-and-defer-cycle',
    '#branch bb.left-opening|mangle.right-opening defer-monitor-raise',
    '#branch toybonnie.right-opening-near-expiry defer-monitor-raise',
    '#branch threat-cleared-and-mask-fully-on reanchor-next-5s-boundary',
    JSON.stringify(route.cycle),
  ].join('\n') + '\n';
}
