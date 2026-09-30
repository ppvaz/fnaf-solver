#!/usr/bin/env node
/**
 * FNaF 1 night detectors over native regions: empty-scene templates learned
 * from a 0/0/0/0 calibration night, and the classifier the 4/20 runner reads
 * the room with.
 *
 *   fnaf1-detectors.mjs build --run artifacts/runs/<calibrate-empty id> --out ~/fnaf-apks/fnaf1-detectors/NAME.json
 *
 * The office is static: consecutive native frames of a still room are
 * pixel-identical (calibration noise p50 0), so a region is compared with the
 * template of the state the room is in, and anything that is not that
 * template is a change. The panels say the state -- DOOR red/green and LIGHT
 * grey/white for each side are four clearly separated templates -- and the
 * doorway (left) or window and doorway (right) say whether the lit scene is
 * the empty one. "Different from empty" is `occupied`: a detector that cannot
 * tell is conservative in the direction that shuts a door.
 *
 * The templates are crops of the game's own rendering, so the built file
 * stays with the other local captures (~/fnaf-apks), never in the repository.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadRun, distance } from './fnaf1-calibration-analyze.mjs';

const b64 = (px) => Buffer.from(new Uint8Array(px.buffer, px.byteOffset, px.byteLength)).toString('base64');
const unb64 = (s) => { const b = Buffer.from(s, 'base64'); return new Uint32Array(b.buffer, b.byteOffset, b.length / 4); };

/** The calibration choreography's state at every press, as label -> frames. */
export function stateSegments(run) {
  // The night's presses only: the title row and the dials are not the office.
  const ready = run.probe.readyHostMs;
  const ev = run.events.filter((e) => e.type === 'input.requested' && typeof e.hostMs === 'number'
    && e.hostMs > ready && e.control !== 'ready');
  let st = { pan: 0, monitor: 'down', left: { door: 'open', light: 'off' }, right: { door: 'open', light: 'off' }, cam: null };
  const groups = {};
  for (let i = 0; i < ev.length; i += 1) {
    const e = ev[i];
    const next = ev[i + 1]?.hostMs ?? e.hostMs + 3000;
    const c = e.control;
    st = JSON.parse(JSON.stringify(st));
    if (c === 'pan-right') st.pan = 600;
    if (c === 'pan-left') st.pan = 0;
    if (c === 'monitor') st.monitor = e.state === 'up' ? 'up' : 'down';
    if (c === 'cam4B') st.cam = 42;
    for (const side of ['left', 'right']) {
      if (c === `${side}DoorLight`) st[side].light = e.state;
      if (c === `${side}Door`) st[side].door = e.state === 'close' ? 'shut' : 'open';
    }
    // Settled frames only: 700 ms after the press (release landing + door
    // animation), and clear of the next one.
    const frames = run.frames.filter((f) => f.t >= e.hostMs + 700 && f.t <= next - 50);
    const label = st.monitor === 'up' ? (st.cam === 42 ? 'up42' : null)
      : `pan${st.pan}|${st.pan === 0 ? `L:${st.left.door}/${st.left.light}` : `R:${st.right.door}/${st.right.light}`}`;
    if (label && frames.length) (groups[label] ??= []).push(...frames);
  }
  return groups;
}

/** The sample most like the others: a template that is a real frame. */
function medoid(frames, region) {
  const pick = frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 40)) === 0);
  let best = null; let bestSum = Infinity;
  for (const a of pick) {
    let sum = 0;
    for (const b of pick) sum += distance(a.regions[region], b.regions[region]);
    if (sum < bestSum) { bestSum = sum; best = a; }
  }
  return best.regions[region];
}

export function build(run) {
  const groups = stateSegments(run);
  const need = ['pan0|L:open/off', 'pan0|L:open/on', 'pan0|L:shut/off', 'pan0|L:shut/on',
    'pan600|R:open/off', 'pan600|R:open/on', 'pan600|R:shut/off', 'pan600|R:shut/on', 'up42'];
  for (const label of need) if (!groups[label]?.length) throw new Error(`calibration has no settled frames for ${label}`);
  const regionsFor = {
    pan0: ['left_panel', 'left_doorway'],
    pan600: ['right_panel', 'right_window', 'right_doorway'],
    up42: ['cam_label', 'map_cam4b'],
  };
  const templates = {};
  const spread = {};
  for (const label of need) {
    const key = label.split('|')[0];
    templates[label] = {};
    spread[label] = {};
    for (const region of regionsFor[key]) {
      const t = medoid(groups[label], region);
      templates[label][region] = b64(t);
      const d = groups[label].map((f) => distance(f.regions[region], t)).sort((a, b) => a - b);
      spread[label][region] = { p95: +d[Math.floor(d.length * 0.95)].toFixed(2), max: +d.at(-1).toFixed(2), n: d.length };
    }
  }
  return { schema: 'fnaf1-detectors-v1', builtFrom: run.probe.id, builtAt: new Date().toISOString(),
    rule: 'mean absolute RGB difference of raw native samples against the empty template of the state the panel names',
    thresholds: { panelMatch: 8, upMatch: 40, occupied: 4 }, spread, templates };
}

/**
 * Classify one REGION read for a runner that knows its own pan.
 * Returns the device lane's frame shape: monitor, cam, left/right, doors.
 */
export function makeClassifier(model) {
  const t = {};
  for (const [label, regions] of Object.entries(model.templates)) {
    t[label] = Object.fromEntries(Object.entries(regions).map(([r, s]) => [r, unb64(s)]));
  }
  const th = model.thresholds;
  const DOOR = { open: 0, shut: 2 };
  let lastDoor = { left: null, right: null };
  return (read, pan) => {
    const R = read.regions;
    const side = pan === 0 ? 'left' : 'right';
    const panel = side === 'left' ? 'left_panel' : 'right_panel';
    const prefix = `pan${pan}|${side === 'left' ? 'L' : 'R'}:`;
    let best = null; let bestD = Infinity;
    for (const door of ['open', 'shut']) {
      for (const light of ['off', 'on']) {
        const d = distance(R[panel], t[`${prefix}${door}/${light}`][panel]);
        if (d < bestD) { bestD = d; best = { door, light }; }
      }
    }
    const upD = distance(R.cam_label, t.up42.cam_label);
    const frame = { monitor: 'flipping', cam: 0, left: 'hidden', right: 'hidden',
      leftDoor: lastDoor.left, rightDoor: lastDoor.right, distances: { panel: +bestD.toFixed(2), up: +upD.toFixed(2) } };
    if (bestD <= th.panelMatch) {
      frame.monitor = 'down';
      const doorValue = DOOR[best.door];
      lastDoor[side] = doorValue;
      frame[side === 'left' ? 'leftDoor' : 'rightDoor'] = doorValue;
      if (best.light === 'off') frame[side] = 'dark';
      else {
        // The lights flicker, most of all with someone at the door: a lit
        // frame can render as the unlit room and hide him. Only the LIT empty
        // scene is `clear`; a frame that matches the unlit one is `flicker`,
        // which no rule acts on (the reader takes the next frame); anything
        // else is `occupied` (fnaf1-custom-grid420-posctl1: Bonnie read
        // occupied 8.93 and, on flicker frames, 2.71 from the unlit room).
        const scene = side === 'left' ? ['left_doorway'] : ['right_window', 'right_doorway'];
        const dOn = Math.max(...scene.map((r) => distance(R[r], t[`${prefix}${best.door}/on`][r])));
        const dOff = Math.max(...scene.map((r) => distance(R[r], t[`${prefix}${best.door}/off`][r])));
        frame.distances.scene = +dOn.toFixed(2);
        frame.distances.sceneUnlit = +dOff.toFixed(2);
        frame[side] = dOn <= th.occupied ? 'clear' : dOff <= th.occupied ? 'flicker' : 'occupied';
      }
    } else if (upD <= th.upMatch) {
      frame.monitor = 'up';
      frame.cam = 42;
    }
    return frame;
  };
}

export function loadDetectors(path) {
  const model = JSON.parse(readFileSync(path, 'utf8'));
  if (model.schema !== 'fnaf1-detectors-v1') throw new Error(`${path} is not fnaf1-detectors-v1`);
  return model;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv[0] !== 'build') { console.error('usage: fnaf1-detectors.mjs build --run DIR --out FILE'); process.exit(2); }
  let dir = null; let out = null;
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === '--run') dir = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
  }
  const model = build(loadRun(dir));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(model));
  console.log(JSON.stringify({ out, spread: model.spread }, null, 1));
}
