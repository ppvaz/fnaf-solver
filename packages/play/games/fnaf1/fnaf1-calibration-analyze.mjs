#!/usr/bin/env node
/**
 * Read a fnaf1-custom-run calibration record: the native-region frames the
 * helper returned, against the inputs the run sent, on one host clock.
 *
 *   fnaf1-calibration-analyze.mjs --run artifacts/runs/<id> [--out FILE.json]
 *
 * For every press it finds the first frame whose own region changed from the
 * frame before the press -- the press-to-rendered latency the device lane
 * assumed -- and reports the change's size, so a press that changed nothing
 * is visible as such. It also reports when the office first appeared after
 * Ready (the hour-text region settling to its in-night content) and when that
 * region changed again (the 1 AM hour), which is the night-origin check.
 *
 * Distances are mean absolute differences over raw RGB channels of the
 * region's native samples. No luma, no grid.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

function fail(message) { console.error(`fnaf1-calibration-analyze: ${message}`); process.exit(2); }

export function loadRun(dir) {
  const probe = JSON.parse(readFileSync(join(dir, 'probe.json'), 'utf8'));
  const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const regionsPath = probe.regions?.path;
  if (!regionsPath) fail('run has no recorded regions');
  const frames = gunzipSync(readFileSync(regionsPath)).toString('utf8').trim().split('\n').map((line) => {
    const row = JSON.parse(line);
    const regions = {};
    for (const [name, b64] of Object.entries(row.regions)) {
      const buf = Buffer.from(b64, 'base64');
      regions[name] = new Uint32Array(buf.buffer, buf.byteOffset, buf.length / 4);
    }
    return { seq: row.seq, t: row.imageHostMs, sentAt: row.sentAt, receivedAt: row.receivedAt, regions };
  });
  return { probe, events, frames };
}

/** Mean absolute RGB difference between two sample vectors, 0..255. */
export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]; const y = b[i];
    sum += Math.abs(((x >> 16) & 255) - ((y >> 16) & 255))
      + Math.abs(((x >> 8) & 255) - ((y >> 8) & 255)) + Math.abs((x & 255) - (y & 255));
  }
  return sum / (a.length * 3);
}

const REGION_FOR = {
  leftDoorLight: 'left_doorway', leftDoor: 'left_doorway', rightDoorLight: 'right_doorway',
  rightDoor: 'right_doorway', monitor: 'cam_label', cam4B: 'map_cam4b',
  'pan-right': 'right_panel', 'pan-left': 'left_panel',
};

export function analyze({ probe, events, frames }) {
  const presses = events.filter((e) => e.type === 'input.requested' && typeof e.hostMs === 'number');
  const readyAt = probe.readyHostMs;
  // Frame-to-frame noise per region while nothing is pressed: the floor any
  // "changed" call must stand above.
  const noise = {};
  for (const name of Object.keys(frames[0].regions)) {
    const diffs = [];
    for (let i = 1; i < frames.length; i += 1) diffs.push(distance(frames[i].regions[name], frames[i - 1].regions[name]));
    diffs.sort((a, b) => a - b);
    noise[name] = { p50: diffs[diffs.length >> 1], p95: diffs[Math.floor(diffs.length * 0.95)] };
  }
  const rows = [];
  for (const p of presses) {
    const region = REGION_FOR[p.control];
    if (!region) continue;
    const before = [...frames].reverse().find((f) => f.t !== null && f.t <= p.hostMs);
    if (!before) continue;
    // Consecutive frames of a still region are identical (noise p50 is 0), so
    // a small absolute floor separates a real change from nothing.
    const threshold = 3;
    const after = frames.find((f) => f.t !== null && f.t > p.hostMs
      && distance(f.regions[region], before.regions[region]) > threshold);
    const settle = after ? frames.filter((f) => f.t > after.t && f.t < after.t + 1200) : [];
    rows.push({
      control: p.control, state: p.state ?? null, pressAt: +(p.hostMs - readyAt).toFixed(1),
      firstChangeMs: after ? +(after.t - p.hostMs).toFixed(1) : null,
      change: after ? +distance(after.regions[region], before.regions[region]).toFixed(2) : null,
      settledChange: settle.length ? +distance(settle.at(-1).regions[region], before.regions[region]).toFixed(2) : null,
      threshold: +threshold.toFixed(2),
    });
  }
  // The office's hour text: its final in-night content, and the first frame
  // after Ready that already shows it.
  const clock = frames.filter((f) => f.t !== null && f.t > readyAt);
  let onset = null; let hourChange = null;
  if (clock.length) {
    // The office's first frame: the hour region equal to how it reads in the
    // room at pan 0 before any control is touched.
    const firstPress = presses.find((p) => p.hostMs > readyAt)?.hostMs ?? Infinity;
    const lateRef = [...clock].reverse().find((f) => f.t < firstPress) ?? clock.at(-1);
    const onsetFrame = clock.find((f) => distance(f.regions.hud_clock, lateRef.regions.hud_clock) < 4);
    onset = onsetFrame ? +(onsetFrame.t - readyAt).toFixed(1) : null;
    if (onsetFrame) {
      // The hour text changes in the room at pan 0 (the choreography ends
      // there): the first frame after 80 s that differs from the 12 AM room.
      const changed = clock.find((f) => f.t > onsetFrame.t + 80000
        && distance(f.regions.hud_clock, lateRef.regions.hud_clock) > 8);
      hourChange = changed ? +(changed.t - onsetFrame.t).toFixed(1) : null;
    }
  }
  const byControl = {};
  for (const r of rows) {
    const key = `${r.control}${r.state ? `:${r.state}` : ''}`;
    (byControl[key] ??= []).push(r.firstChangeMs);
  }
  return { frames: frames.length, noise, onsetAfterReadyMs: onset, hourChangeAfterOnsetMs: hourChange,
           latency: byControl, presses: rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  let dir = null; let out = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--run') dir = argv[++i];
    else if (argv[i] === '--out') out = argv[++i];
    else fail(`unknown flag ${argv[i]}`);
  }
  if (!dir) fail('--run is required');
  const result = analyze(loadRun(dir));
  const text = JSON.stringify(result, null, 2);
  if (out) writeFileSync(out, text); else console.log(text);
}
