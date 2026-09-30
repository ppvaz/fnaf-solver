// The device-proven Minus 3 "frame light" recipe, and the checks that keep it
// honest.
//
// This is the schedule that actually cleared story Nights 3 and 4 on the Moto
// g56 (evidence victory-night3-20260908, victory-night4-20260908). It ran from
// a one-off runner under a gitignored artifacts directory, so the recipe that
// won existed nowhere a clean checkout could find it. It lives here now.
//
// Two facts make it expressible in the checked-in vocabulary rather than as a
// pile of edges: the winner is KNOBS0 with earlier masking and the measured
// wind pair, and its second contact is hall-only (`secondHallVent: false`).
// `camdrop(lead, monitor, tail)` already expands to exactly the light hold with
// the monitor tap inside it that the runner called `flashMask`, so the mask tap
// simply moves to `monitor press + maskGapMs`.
//
//     minus3-frame-light.mjs --verify            edge parity against EDGES_SHA256
//     minus3-frame-light.mjs --census [--runs=N] model census (3000 seeds)
//
// The census is MODEL_ONLY and is not a promotion gate. The device claim is the
// evidence record; this module only proves the bytes still reproduce.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Sim } from '@sixam/core/mechanics';
import { FNAF2_CONTROL_VOCABULARY as V } from '@sixam/core/control';
import { GOLDEN_MODEL_SEED_SALT, randomSeedCohort, seedCohortDescriptor } from '@sixam/research/seeds';
import { KNOBS0, schedule } from './minus-3-plan.mjs';

/** Measured monitor DOWN -> mask DOWN gap on the winning runs. */
export const MASK_GAP_MS = 67;

/** sha256 of the canonical edge list of the run that cleared Night 3 (774 edges). */
export const EDGES_SHA256 = '8883626783fd81308103cea36601b805ea6d607e1e4fdd05d0cc7969c03f7d42';

export const WIN_KNOBS = Object.freeze({
  ...KNOBS0,
  secondHallVent: false,
  // mask at the monitor press + MASK_GAP_MS, not after the light tail
  openMaskAtMs: 4217,
  maskOnMs: 9217,
  windAtMs: 5800,
  windMs: 3200,
  // Pinned 2026-09-19, and deliberately NOT the shipped default any more.
  // These two inherited from KNOBS0, so when the default opening wind moved to
  // 2083 ms (it sat at exactly raise+434, zero slack against the wind-ready
  // floor) it silently rewrote the schedule that actually cleared Nights 3 and
  // 4 on the phone -- the 774-edge hash below caught it. What the device ran is
  // a record, not a target: it stays at 2050/1800 even though a plan emitted
  // today would not be allowed to. This is exactly the separation this file's
  // own point 2 asks for, now enforced by value instead of by hope.
  openWindAtMs: 2050,
  openWindMs: 1800,
});

/** The winning opening/clear rows, in the checked-in row vocabulary. */
export function winRows(k = WIN_KNOBS) {
  const c = k.contactMs;
  const opening = [
    [k.openViewMs, 'tap', 'monitor', c],
    [k.openLastViewedMs, 'tap', 'cam11', c],
    [k.openArmMs, 'tap', 'cam8', c],
    [k.openArmMs + k.armingGapMs, 'tap', 'monitor', c],
    [k.openArmMs + k.armingGapMs + k.openRaiseGapMs, 'tap', 'monitor', c],
    [k.openWindAtMs, 'hold', 'wind', k.openWindMs],
    [k.openCamdropAtMs, 'camdrop', k.openCamdropLeadMs, k.openCamdropMonitorMs, k.openCamdropTailMs],
    [k.openMaskAtMs, 'tap', 'mask', c],
  ];
  const clear = [
    [k.maskOffMs, 'tap', 'mask', c],
    [k.secondHallMs, k.secondHallVent ? 'hallvent' : 'hall', k.secondHallHoldMs],
    [k.raiseMs, 'tap', 'monitor', c],
    [k.windAtMs, 'hold', 'wind', k.windMs],
    [k.camdropMs, 'camdrop', k.camdropLeadMs, k.camdropMonitorMs, k.camdropTailMs],
    [k.maskOnMs, 'tap', 'mask', c],
  ];
  return { opening, clear };
}

/**
 * Expand the rows into the device contact edges the HID transport actuates.
 * `camdrop` is the light hold with the monitor tap inside it; `hall` is a
 * distinct control from that light, and the winning run pressed two different
 * measured points for them.
 */
export function deviceEdges({ knobs = WIN_KNOBS, untilMs = 540000 } = {}) {
  const edges = [];
  const contact = (atMs, control, durationMs) =>
    edges.push({ atMs, control, down: true }, { atMs: atMs + durationMs, control, down: false });
  const camName = a => (a === 'cam11' ? 'cam:11' : a === 'cam8' ? 'cam:8' : a);
  const expand = (base, rows) => {
    for (const [at, kind, a, b, tail] of rows) {
      const when = base + at;
      if (kind === 'tap') contact(when, camName(a), b);
      else if (kind === 'hold') contact(when, a, b);
      else if (kind === 'hall') contact(when, V.hallLight, a);
      else if (kind === 'camdrop') {
        contact(when, V.cameraFeedLight, a + b + tail);
        contact(when + a, V.monitor, b);
      }
      else throw new Error(`minus3 frame light: unhandled row ${kind}`);
    }
  };
  const { opening, clear } = winRows(knobs);
  expand(0, opening);
  for (let base = knobs.loopStartMs; base < untilMs; base += knobs.periodMs) expand(base, clear);
  edges.sort((x, y) => x.atMs - y.atMs || Number(x.down) - Number(y.down));
  return edges;
}

export function edgesSha256(edges = deviceEdges()) {
  // Keep the evidence identity stable across this vocabulary-only rename:
  // these aliases are the historical labels for the same measured contacts,
  // not accepted device input names.
  const historical = { [V.cameraFeedLight]: 'light', [V.hallLight]: 'hall' };
  const canonical = JSON.stringify(edges.map(e => [e.atMs, historical[e.control] ?? e.control, e.down]));
  return createHash('sha256').update(canonical).digest('hex');
}

/** MODEL_ONLY census of this exact schedule. Not a promotion gate. */
export function census(night, { runs = 3000, seeds, knobs = WIN_KNOBS } = {}) {
  const population = seeds ?? randomSeedCohort({ count: runs });
  const { opening, clear } = winRows(knobs);
  const queue = schedule({ opening, clear, knobs });
  let wins = 0, split = 0, minPower = Infinity, minBox = 1;
  const losses = new Map();
  for (const seed of population) {
    const sim = new Sim({ night, seed });
    let cursor = 0, sawSplit = false;
    while (sim.alive && !sim.won) {
      while (cursor < queue.length && queue[cursor][0] <= sim.frame) {
        const [, , kind, action] = queue[cursor++];
        sim[kind](action);
      }
      sim.tick();
      if (!sawSplit && sim.camsUp && sim.viewing === 11 && sim.cam === 8) sawSplit = true;
      minBox = Math.min(minBox, sim.box);
      minPower = Math.min(minPower, sim.power);
    }
    if (sim.won) wins++;
    if (sawSplit) split++;
    if (!sim.won) {
      const reason = sim.death?.reason ?? 'unknown';
      losses.set(reason, (losses.get(reason) ?? 0) + 1);
    }
    cursor = 0;
  }
  return { night, wins, runs: population.length, split, minPower,
    minBox: Number(minBox.toFixed(4)),
    seedCohort: seedCohortDescriptor(population, { salt: GOLDEN_MODEL_SEED_SALT }),
    losses: Object.fromEntries([...losses].sort((a, b) => b[1] - a[1])) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--census')) {
    const runs = Number(process.argv.find(a => a.startsWith('--runs='))?.slice(7) ?? 3000);
    for (const night of [3, 4, 5, 6]) console.log(JSON.stringify(census(night, { runs })));
  } else {
    const actual = edgesSha256();
    const edges = deviceEdges();
    const ok = actual === EDGES_SHA256;
    console.log(`edges=${edges.length} sha256=${actual}`);
    console.log(ok ? 'EDGE PARITY: matches the Night 3 winning run'
      : `EDGE PARITY FAILED: expected ${EDGES_SHA256}`);
    if (!ok) process.exitCode = 1;
  }
}
