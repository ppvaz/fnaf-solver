#!/usr/bin/env node
/**
 * FNaF 3's frame readers and the per-camera Springtrap detector, shared by
 * the runner (live) and by `build` (from a recorded calibration night).
 *
 *   fnaf3-detectors.mjs build --run ARTIFACT_RUN_DIR --out FILE [--pngs DIR]
 *
 * Readers that need no calibration: which CAM label is green (the monitor is
 * up on that camera), the red system error lines, the FNAF3 title logo, and a
 * vent's red seal bar. The detector compares a camera's picture with that
 * camera's EMPTY template -- the per-sample median of every settled frame the
 * calibration night showed of it, which is empty as long as he spent most of
 * the night elsewhere -- after a temporal median over consecutive frames
 * (the static is new every frame; he is not) and a gain match (a failing
 * ventilation dims the whole picture). `build` writes the templates and each
 * camera's score distribution; the occupancy cut is chosen from those by a
 * person, and the file says who chose it and from what.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync, inflateSync, constants as zlibConstants } from 'node:zlib';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pngFromRegion } from './native-regions.mjs';

// The feed region's sample grid: sample (c, r) is native (x + step*c, y + step*r).
export const FEED = { x: 400, y: 130, step: 20, cols: 96, rows: 45 };

/** Samples of a grid whose native position falls inside a box (cx, cy, half-width, half-height). */
export function boxSamples(grid, cx, cy, hw, hh) {
  const out = [];
  for (let r = 0; r < grid.rows; r += 1) {
    const y = grid.y + grid.step * r;
    if (y < cy - hh || y > cy + hh) continue;
    for (let c = 0; c < grid.cols; c += 1) {
      const x = grid.x + grid.step * c;
      if (x >= cx - hw && x <= cx + hw) out.push(r * grid.cols + c);
    }
  }
  return out;
}

export const rgb = (px) => [(px >> 16) & 255, (px >> 8) & 255, px & 255];
const luma = (px) => 0.299 * ((px >> 16) & 255) + 0.587 * ((px >> 8) & 255) + 0.114 * (px & 255);
// A selected CAM label is (153,173,61) on this build; an unselected one is grey or dark.
export const isLabelGreen = ([r, g, b]) => g >= 130 && g - b >= 60 && r >= 90 && r <= g + 10;
// The same green in the dark: its proportions (r/g 0.88, b/g 0.35) at any brightness.
export const isDimLabelGreen = ([r, g, b]) => g >= 12 && b <= 0.55 * g && r >= 0.7 * g && r <= 1.05 * g;
// The monitor's error lines are red text (~220,50,50), or its proportions in the dark.
export const isErrorRed = ([r, g, b]) => (r >= 150 && g <= 100 && b <= 100 && r - g >= 90) || (r >= 35 && r >= 2.5 * g && r >= 2.5 * b);
// The menu's "error" is white text in a dark red glow (60-150, 0-45, 0; cal1 0022).
export const isMenuRed = ([r, g, b]) => r >= 60 && r - g >= 50 && b <= 40;
// A seal bar is green (66,106,82) open and red (112,65,80) sealed.
export const isBarRed = ([r, g]) => r >= 85 && r - g >= 25;

/**
 * The picture: feed samples that are neither the camera map, its two buttons,
 * nor the error lines' band -- those change with the UI, not with the room.
 */
export const PICTURE_MASK = (() => {
  const out = [];
  for (let r = 0; r < FEED.rows; r += 1) {
    const y = FEED.y + FEED.step * r;
    for (let c = 0; c < FEED.cols; c += 1) {
      const x = FEED.x + FEED.step * c;
      const map = x >= 1470 && x <= 2345 && y >= 440 && y <= 1000;
      const buttons = x >= 1100 && x <= 1390 && y >= 760 && y <= 980;
      const errors = x >= 500 && x <= 1140 && y >= 250 && y <= 330;
      // The top band stays: Springtrap's head and ears sit there on cam 8
      // (cal1), and a heads-up banner over it (native y 0-310, cal1 49.6 s)
      // is rarer than he is.
      const frame = x < 400 || x > 2320 || y < 135 || y > 1030;
      if (!map && !buttons && !errors && !frame) out.push(r * FEED.cols + c);
    }
  }
  return Uint32Array.from(out);
})();

export class Reader {
  constructor(controls) {
    this.labels = {};
    for (let n = 1; n <= 15; n += 1) {
      const k = `cam${String(n).padStart(2, '0')}`;
      this.labels[n] = boxSamples(FEED, controls[k].x, controls[k].y, 56, 18);
    }
    this.menuText = boxSamples(FEED, 815, 730, 335, 260);
    this.playButton = boxSamples(FEED, 1246, 814, 130, 45);
    this.menuRows = { AUDIO: boxSamples(FEED, 1330, 500, 130, 22), VIDEO: boxSamples(FEED, 1330, 604, 130, 22),
      VENT: boxSamples(FEED, 1330, 708, 130, 22) };
  }
  /**
   * Which camera label is green (1-15), or null: the monitor is up on that
   * camera. A failing ventilation darkens the whole screen for seconds
   * (n2d 210-231 s, mean light 1-20), which hides the label's brightness but
   * not its hue: in the dark, the one label box whose samples keep the
   * selected green's proportions, while no other box does, is the selection
   * (the green-tinted office would light many boxes at once).
   */
  selected(frame) {
    const px = frame.regions.feed.pixels;
    let best = null; let bestN = 0;
    const dim = [];
    for (const [n, idx] of Object.entries(this.labels)) {
      let g = 0; let d = 0;
      for (const i of idx) { const c = rgb(px[i]); if (isLabelGreen(c)) g += 1; if (isDimLabelGreen(c)) d += 1; }
      if (g > bestN) { bestN = g; best = Number(n); }
      if (d >= 3) dim.push(Number(n)); else if (d >= 2) dim.push(-1);
    }
    if (bestN >= 3) return best;
    return dim.length === 1 && dim[0] > 0 ? dim[0] : null;
  }
  /** The maintenance menu's green text rows: 18 samples while it is open, 0 over the office (cal1). */
  menuOpen(frame) {
    const px = frame.regions.feed.pixels;
    let g = 0;
    for (const i of this.menuText) {
      const [r, gg, b] = rgb(px[i]);
      if ((gg >= 120 && gg - r >= 50 && gg - b >= 50) || (gg >= 30 && gg >= 1.8 * r && gg >= 1.8 * b)) g += 1;
    }
    return this.selected(frame) === null && g >= 10;
  }
  /**
   * Which systems the monitor's blinking red lines name, by the row a line
   * sits on: VIDEO at native y 240-270 (cal2: a camera error its ventilation
   * reboots never cleared), VENT at 276-316 (f3-ex1: "ventilation error").
   * A line on any other row is AUDIO until a menu read says otherwise.
   */
  errorLines(frame) {
    const px = frame.regions.errors.pixels;
    const rows = new Map();
    for (let i = 0; i < px.length; i += 1) {
      if (!isErrorRed(rgb(px[i]))) continue;
      const y = 200 + 8 * Math.floor(i / 80);
      rows.set(y, (rows.get(y) ?? 0) + 1);
    }
    const out = new Set();
    for (const [y, n] of rows) {
      if (n < 3) continue;
      out.add(y >= 240 && y <= 270 ? 'VIDEO' : y >= 276 && y <= 316 ? 'VENT' : 'AUDIO');
    }
    return out;
  }
  /** The maintenance menu's red "error" words, per row: audio y 500, camera 604, ventilation 708. */
  menuErrors(frame) {
    const px = frame.regions.feed.pixels;
    const out = new Set();
    for (const [name, idx] of Object.entries(this.menuRows)) {
      let n = 0;
      for (const i of idx) if (isMenuRed(rgb(px[i]))) n += 1;
      if (n >= 3) out.add(name);
    }
    return out;
  }
  /**
   * Play Audio ready: its two words are ~15 white samples on the camera map
   * and the dashes that replace them while `play counter` refills (g301 wants
   * it at 7) are 0-2 (cal3).
   */
  playReady(frame) {
    const px = frame.regions.feed.pixels;
    let w = 0;
    for (const i of this.playButton) { const [r, g, b] = rgb(px[i]); if (r > 200 && g > 200 && b > 200) w += 1; }
    return w >= 8;
  }
  errorRed(frame) {
    let n = 0;
    for (const px of frame.regions.errors.pixels) if (isErrorRed(rgb(px))) n += 1;
    return n;
  }
  title(frame) {
    const px = frame.regions.title.pixels;
    let n = 0;
    for (const p of px) if (Math.max(...rgb(p)) >= 150) n += 1;
    return n / px.length;
  }
  sealed(frame) {
    for (const v of [11, 12, 13, 14, 15]) {
      const px = frame.regions[`bar${v}`].pixels;
      let red = 0;
      for (const p of px) if (isBarRed(rgb(p))) red += 1;
      if (red >= px.length / 2) return v;
    }
    return null;
  }
}

/** Per-sample temporal median of the picture's luma over a few frames' feeds. */
export function medianLuma(feeds) {
  const n = feeds.length;
  const out = new Float32Array(PICTURE_MASK.length);
  const buf = new Float32Array(n);
  for (let k = 0; k < PICTURE_MASK.length; k += 1) {
    const i = PICTURE_MASK[k];
    for (let j = 0; j < n; j += 1) buf[j] = luma(feeds[j][i]);
    buf.sort();
    out[k] = n % 2 ? buf[(n - 1) / 2] : (buf[n / 2 - 1] + buf[n / 2]) / 2;
  }
  return out;
}

/**
 * How unlike its empty template a camera's picture is: the gain-matched
 * absolute luma difference, under a 3x3 spatial median (static that survives
 * the temporal median is scattered, one sample here and there; a figure is a
 * block), reported as the mean and as the share of the picture past 24 levels.
 */
export function occupancy(m, template) {
  let sm = 0; let st = 0;
  for (let k = 0; k < m.length; k += 1) { sm += m[k]; st += template[k]; }
  const gain = sm > 1 ? st / sm : 1;
  const d = new Float32Array(FEED.cols * FEED.rows).fill(NaN);
  for (let k = 0; k < m.length; k += 1) d[PICTURE_MASK[k]] = Math.abs(gain * m[k] - template[k]);
  const box = new Float32Array(9);
  let mean = 0; let over = 0;
  for (let k = 0; k < m.length; k += 1) {
    const i = PICTURE_MASK[k];
    const r = Math.floor(i / FEED.cols); const c = i % FEED.cols;
    let n = 0;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const rr = r + dr; const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= FEED.rows || cc >= FEED.cols) continue;
      const v = d[rr * FEED.cols + cc];
      if (!Number.isNaN(v)) box[n++] = v;
    }
    const sorted = box.subarray(0, n).sort();
    const v = sorted[n >> 1];
    mean += v;
    if (v > 24) over += 1;
  }
  return { mean: mean / m.length, over: over / m.length, gain };
}

// --- the game's own camera pictures (fnaf3-detectors-v2) --------------------------
// The camera screen object (dump: OBJECT 125) shows one animation per camera
// and state, picked by groups 168-213 (cameras) and 531-540 (vents): the empty
// room (A), the room with Springtrap (C, `you in = mon in` and `pic random` 0)
// and an alternate (B) that `pic random` 1 shows him as and a ventilation
// hallucination shows any camera as (AV7 = Random(3), g469). The numbers are
// the animations' image handles (OBJANIM OI 125), frame for frame: a lit and a
// dark frame of the same room alternate, and A, B and C cycle together. P is
// a phantom's picture over that camera (shadow Freddy g172/g210, Mangle g195,
// the cupcakes g193/g194, Chica g184, the Puppet g204): its scare drops the
// monitor and breaks a system, and it is not him (cal n2c 148.5 s: Mangle on
// cam 04 read as his alternate, +3..+8 against his picture's -20).
export const CAMERA_FRAMES = Object.freeze({
  1: { A: [106], B: [295], C: [295] }, 2: { A: [97, 103], B: [146, 147], C: [132, 133], P: [319, 321] },
  3: { A: [104], B: [134], C: [121] }, 4: { A: [105], B: [135], C: [122], P: [38, 229, 303] },
  5: { A: [109, 110], B: [148, 149], C: [119, 120] }, 6: { A: [98, 99], B: [141, 142], C: [117, 118] },
  7: { A: [100, 101, 102], B: [187, 188, 189], C: [124, 125, 126], P: [387, 388, 389] },
  8: { A: [112, 113, 114], B: [136, 137, 138], C: [127, 128, 129], P: [297, 298, 300] },
  9: { A: [115], B: [139], C: [130] }, 10: { A: [116], B: [140], C: [131], P: [304] },
  11: { A: [623], C: [829] }, 12: { A: [624], C: [831] }, 13: { A: [628], C: [835] }, 14: { A: [824], C: [841] }, 15: { A: [818], C: [832] },
});
// The picture on screen: image pixel (u, v) lands at native (x0 + u*sx, y0 + v*sy),
// the 1024x768 window's stretch to 2400x1080; the offset was fitted on cal1's
// cam 8 SNAP (mean absolute difference 12.7 through the live static).
export const IMAGE_GEOMETRY = Object.freeze({ x0: 402, y0: 124, sx: 2.34375, sy: 1.40625, width: 825, height: 650 });
// Both sides are compared as mean light over the 60 x 60 native px a 3 x 3
// box of feed samples covers: point samples of a detailed picture do not
// survive the game's scaling pixel for pixel, and the static averages down.
const BLOCK = 30;

/** An 8-bit RGB or RGBA non-interlaced PNG to luma (the CTFAK image export). */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8; let width = 0; let height = 0; let channels = 0; const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('only 8-bit non-interlaced PNGs');
      channels = { 2: 3, 6: 4 }[data[9]];
      if (!channels) throw new Error(`PNG colour type ${data[9]} is not RGB or RGBA`);
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const img = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? img[y * stride + x - channels] : 0;
      const b = y > 0 ? img[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? img[(y - 1) * stride + x - channels] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      img[y * stride + x] = v & 255;
    }
  }
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    gray[i] = Math.round(0.299 * img[i * channels] + 0.587 * img[i * channels + 1] + 0.114 * img[i * channels + 2]);
  }
  return { width, height, gray };
}

/** An image's mean light around each picture sample, where the sample sits on it (NaN elsewhere). */
export function sampleBlocks({ width, height, gray }, g = IMAGE_GEOMETRY) {
  const out = new Float32Array(PICTURE_MASK.length);
  for (let k = 0; k < PICTURE_MASK.length; k += 1) {
    const i = PICTURE_MASK[k];
    const X = FEED.x + FEED.step * (i % FEED.cols); const Y = FEED.y + FEED.step * Math.floor(i / FEED.cols);
    const u0 = Math.max(0, Math.round((X - BLOCK - g.x0) / g.sx)); const u1 = Math.min(width, Math.round((X + BLOCK - g.x0) / g.sx));
    const v0 = Math.max(0, Math.round((Y - BLOCK - g.y0) / g.sy)); const v1 = Math.min(height, Math.round((Y + BLOCK - g.y0) / g.sy));
    let sum = 0; let n = 0;
    for (let v = v0; v < v1; v += 1) for (let u = u0; u < u1; u += 1) { sum += gray[v * width + u]; n += 1; }
    out[k] = n > 100 ? sum / n : NaN;
  }
  return out;
}

/** A live feed's mean light over each picture sample's 3 x 3 box. */
export function boxLuma(feed) {
  const d = new Float32Array(FEED.cols * FEED.rows).fill(NaN);
  for (const i of PICTURE_MASK) d[i] = luma(feed[i]);
  const out = new Float32Array(PICTURE_MASK.length);
  for (let k = 0; k < PICTURE_MASK.length; k += 1) {
    const i = PICTURE_MASK[k]; const r = Math.floor(i / FEED.cols); const c = i % FEED.cols;
    let s = 0; let n = 0;
    for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
      const rr = r + dr; const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= FEED.rows || cc >= FEED.cols) continue;
      const v = d[rr * FEED.cols + cc];
      if (!Number.isNaN(v)) { s += v; n += 1; }
    }
    out[k] = s / n;
  }
  return out;
}

const meanAbs = (o, t, idx) => {
  let s = 0; let n = 0;
  for (const k of idx) { if (Number.isNaN(t[k])) continue; s += Math.abs(o[k] - t[k]); n += 1; }
  return n ? s / n : Infinity;
};

/**
 * How much more a frame looks like Springtrap's picture (C) -- and like the
 * alternate (B) -- than like the empty room, on the samples where the two
 * pictures differ, after picking the lighting frame the room is in. Positive
 * means him; each camera's own cut (fnaf3-detectors-v2 `cams[n].cut`) decides.
 */
export function stateScore(pairs, obs) {
  const all = [];
  for (let k = 0; k < obs.length; k += 1) all.push(k);
  let best = null;
  for (const p of pairs) { const d = meanAbs(obs, p.A, all); if (!best || d < best.d) best = { d, p }; }
  const out = { B: null, C: null, P: null };
  const against = (T) => {
    const diff = [];
    for (const k of all) if (!Number.isNaN(T[k]) && !Number.isNaN(best.p.A[k]) && Math.abs(T[k] - best.p.A[k]) > 8) diff.push(k);
    return diff.length >= 3 ? meanAbs(obs, best.p.A, diff) - meanAbs(obs, T, diff) : null;
  };
  for (const s of ['B', 'C']) if (best.p[s]) out[s] = against(best.p[s]);
  for (const T of best.p.P ?? []) { const v = against(T); if (v !== null && (out.P === null || v > out.P)) out.P = v; }
  return out;
}

/** The pairs of a v2 detectors file, as Float32Arrays. */
export function loadPairs(det) {
  const out = {};
  for (const [cam, v] of Object.entries(det.cams)) {
    const arr = (t) => Float32Array.from(t, (x) => (x === null ? NaN : x));
    out[cam] = v.pairs.map((p) => ({ A: arr(p.A), B: p.B ? arr(p.B) : null, C: arr(p.C), P: (p.P ?? []).map(arr) }));
  }
  return out;
}

/** Decode one recorded NDJSON frame's regions into Uint32 pixel arrays. */
export function decodeFrame(row) {
  const regions = {};
  for (const [k, b64] of Object.entries(row.regions)) {
    const buf = Buffer.from(b64, 'base64');
    regions[k] = { pixels: new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
  }
  return { seq: row.seq, imageHostMs: row.imageHostMs, regions };
}

function* recordedFrames(path) {
  // A run that was killed leaves the gzip without its trailer; a sync flush
  // still yields every whole line before the cut.
  const text = gunzipSync(readFileSync(path), { finishFlush: zlibConstants.Z_SYNC_FLUSH }).toString('utf8');
  for (const line of text.split('\n')) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { break; }
    yield decodeFrame(row);
  }
}

const quantile = (sorted, q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;

/**
 * Templates from a calibration run: every frame whose selected camera has
 * been the same for SETTLE_MS is that camera's; its template is the
 * per-sample median of those frames' temporal medians.
 */
async function build({ run, out, pngs, regions }) {
  const doc = JSON.parse(readFileSync(join(run, 'run.json'), 'utf8'));
  const regionsPath = regions ?? doc.regions?.path;
  if (!regionsPath) throw new Error('the run records no regions path: pass --regions');
  const controls = JSON.parse(readFileSync(new URL('./models/controls-fnaf3-moto-g56-v204.json', import.meta.url), 'utf8')).controlMap;
  const reader = new Reader(controls);
  // The feed plays a static burst on every switch: 45% of the picture bright
  // at once, 3% by 200 ms, under 1% by 400 ms (cal1).
  const SETTLE_MS = 400;
  const WINDOW = 5;
  const perCam = new Map();
  let sel = null; let since = 0; let recent = []; let videoAt = -Infinity;
  for (const f of recordedFrames(regionsPath)) {
    // A video error leaves the feed dark static with no room in it (cal2):
    // nothing it shows is a camera's picture.
    // The line blinks, so the error holds for 1.5 s past its last showing.
    if (reader.errorLines(f).has('VIDEO')) videoAt = f.imageHostMs;
    const s = f.imageHostMs - videoAt < 1500 ? null : reader.selected(f);
    if (s !== sel) { sel = s; since = f.imageHostMs; recent = []; }
    if (s === null || f.imageHostMs - since < SETTLE_MS) continue;
    recent.push(f.regions.feed.pixels);
    if (recent.length > WINDOW) recent.shift();
    if (recent.length < WINDOW) continue;
    if (!perCam.has(s)) perCam.set(s, []);
    perCam.get(s).push({ at: f.imageHostMs, visit: since, m: medianLuma(recent), feed: f.regions.feed.pixels });
  }
  const templates = {}; const stats = {};
  for (const [cam, rows] of [...perCam.entries()].sort((a, b) => a[0] - b[0])) {
    const t = new Float32Array(PICTURE_MASK.length);
    const col = new Float32Array(rows.length);
    for (let k = 0; k < t.length; k += 1) {
      for (let j = 0; j < rows.length; j += 1) col[j] = rows[j].m[k];
      col.sort();
      t[k] = col[Math.floor(rows.length / 2)];
    }
    templates[cam] = Array.from(t, (v) => Math.round(v));
    const scores = rows.map((r) => ({ at: r.at, ...occupancy(r.m, t), feed: r.feed }));
    const means = scores.map((s) => s.mean).sort((a, b) => a - b);
    const overs = scores.map((s) => s.over).sort((a, b) => a - b);
    stats[cam] = { frames: rows.length,
      mean: { p50: quantile(means, 0.5), p90: quantile(means, 0.9), p99: quantile(means, 0.99), max: means.at(-1) },
      over: { p50: quantile(overs, 0.5), p90: quantile(overs, 0.9), p99: quantile(overs, 0.99), max: overs.at(-1) },
      top: scores.slice().sort((a, b) => b.over - a.over).slice(0, 5).map((s) => ({ atNightMs: Math.round(s.at - doc.night.epochHostMs), mean: +s.mean.toFixed(1), over: +s.over.toFixed(3) })) };
    if (pngs) {
      mkdirSync(pngs, { recursive: true });
      const best = scores.slice().sort((a, b) => b.over - a.over)[0];
      const emptiest = scores.slice().sort((a, b) => a.over - b.over)[0];
      for (const [tag, s] of [['top', best], ['low', emptiest]]) {
        writeFileSync(join(pngs, `cam${String(cam).padStart(2, '0')}-${tag}-${Math.round(s.at - doc.night.epochHostMs)}.png`),
          pngFromRegion({ cols: FEED.cols, rows: FEED.rows, pixels: s.feed }, 8));
      }
    }
  }
  // Each visit (a stretch on one camera) with its best and median window: at
  // most one camera can hold him at a time, and a sighting can only move
  // along his edges, which is how a person checks a cut against a night.
  const visits = [];
  for (const [cam, rows] of perCam.entries()) {
    const byVisit = new Map();
    for (const r of rows) {
      const o = occupancy(r.m, Float32Array.from(templates[cam])).over;
      if (!byVisit.has(r.visit)) byVisit.set(r.visit, []);
      byVisit.get(r.visit).push(o);
    }
    for (const [start, overs] of byVisit) {
      overs.sort((a, b) => a - b);
      visits.push({ cam, atNightMs: Math.round(start - doc.night.epochHostMs), windows: overs.length,
        max: +overs.at(-1).toFixed(3), median: +overs[Math.floor(overs.length / 2)].toFixed(3) });
    }
  }
  visits.sort((a, b) => a.atNightMs - b.atNightMs);
  const file = { schema: 'fnaf3-detectors-v1', source: { run: doc.id, regions: regionsPath },
    feed: FEED, settleMs: SETTLE_MS, window: WINDOW, mask: 'PICTURE_MASK (fnaf3-detectors.mjs)',
    occupied: null, occupiedNote: 'not chosen: read the stats and the retained frames first',
    stats, visits, templates };
  writeFileSync(out, `${JSON.stringify(file)}\n`);
  console.log(JSON.stringify({ out, cams: Object.keys(templates).length, visits: visits.length,
    stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { frames: v.frames, mean: v.mean, over: v.over, top: v.top }])) }, null, 1));
}

/**
 * Templates from the game's pictures (a CTFAK image export of CAMERA_FRAMES,
 * outside the repository), and each camera's cut from calibration nights:
 * over every settled visit the median state score is the empty room's (he is
 * on one camera at a time), and the cut stands `margin` above it.
 */
async function buildImages({ images, out, runs, margin = 8 }) {
  const cams = {};
  for (const [cam, st] of Object.entries(CAMERA_FRAMES)) {
    const img = (h) => sampleBlocks(decodePng(readFileSync(join(images, `${h}.png`))));
    const P = (st.P ?? []).map(img);
    cams[cam] = { pairs: st.A.map((a, i) => ({ A: img(a), B: st.B ? img(st.B[Math.min(i, st.B.length - 1)]) : null,
      C: img(st.C[Math.min(i, st.C.length - 1)]), P })) };
  }
  const controls = JSON.parse(readFileSync(new URL('./models/controls-fnaf3-moto-g56-v204.json', import.meta.url), 'utf8')).controlMap;
  const reader = new Reader(controls);
  const nulls = {};
  const nullsB = {};
  for (const run of runs) {
    const doc = JSON.parse(readFileSync(join(run, 'run.json'), 'utf8'));
    let sel = null; let since = 0; let acc = null; let videoAt = -Infinity;
    const flush = () => {
      if (!acc?.n) return;
      (nulls[sel] ??= []).push(acc.C / acc.n);
      if (acc.nB) (nullsB[sel] ??= []).push(acc.B / acc.nB);
    };
    // A killed run never wrote its regions path; the file is in its capture directory.
    for (const f of recordedFrames(doc.regions?.path ?? join(doc.capture.directory, 'regions.ndjson.gz'))) {
      if (reader.errorLines(f).has('VIDEO')) videoAt = f.imageHostMs;
      const s = f.imageHostMs - videoAt < 1500 ? null : reader.selected(f);
      if (s !== sel) { flush(); sel = s; since = f.imageHostMs; acc = { n: 0, C: 0, nB: 0, B: 0 }; }
      if (s === null || f.imageHostMs - since < 400) continue;
      const r = stateScore(cams[s].pairs, boxLuma(f.regions.feed.pixels));
      if (r.C !== null) { acc.n += 1; acc.C += r.C; }
      if (r.B !== null) { acc.nB += 1; acc.B += r.B; }
    }
    flush();
  }
  for (const [cam, v] of Object.entries(cams)) {
    const xs = (nulls[cam] ?? []).sort((a, b) => a - b);
    v.null = xs.length ? { visits: xs.length, p50: +xs[Math.floor(xs.length / 2)].toFixed(2), max: +xs.at(-1).toFixed(2) } : null;
    v.cut = xs.length ? +(xs[Math.floor(xs.length / 2)] + margin).toFixed(2) : null;
    // The alternate differs from the empty room by a few samples on cams 5, 6
    // and 8 (656, 1796 and 4 image px): there he is invisible, and no cut is set.
    const bs = (nullsB[cam] ?? []).sort((a, b) => a - b);
    v.cutB = bs.length && ![5, 6, 8].includes(Number(cam)) ? +(bs[Math.floor(bs.length / 2)] + margin).toFixed(2) : null;
    const arr = (t) => Array.from(t, (x) => (Number.isNaN(x) ? null : +x.toFixed(1)));
    v.pairs = v.pairs.map((p) => ({ A: arr(p.A), B: p.B ? arr(p.B) : null, C: arr(p.C), P: p.P.map(arr) }));
  }
  const file = { schema: 'fnaf3-detectors-v2', geometry: IMAGE_GEOMETRY, block: BLOCK, frames: CAMERA_FRAMES, margin,
    source: { images: 'CTFAK image export (game content, outside the repository)', runs: runs.map((r) => r.split('/').pop()) }, cams };
  writeFileSync(out, `${JSON.stringify(file)}\n`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(cams).map(([k, v]) => [k, { null: v.null, cut: v.cut }]))));
}

async function main(argv) {
  const [verb, ...rest] = argv;
  const o = { runs: [] };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--run') { o.run = rest[++i]; o.runs.push(o.run); }
    else if (rest[i] === '--out') o.out = rest[++i];
    else if (rest[i] === '--pngs') o.pngs = rest[++i];
    else if (rest[i] === '--regions') o.regions = rest[++i];
    else if (rest[i] === '--images') o.images = rest[++i];
    else if (rest[i] === '--margin') o.margin = Number(rest[++i]);
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  if (verb === 'build-images') {
    if (!o.images || !o.out) throw new Error('usage: fnaf3-detectors.mjs build-images --images DIR --out FILE [--run RUN]... [--margin N]');
    return buildImages(o);
  }
  if (verb !== 'build' || !o.run || !o.out) throw new Error('usage: fnaf3-detectors.mjs build --run DIR --out FILE [--pngs DIR] | build-images ...');
  await build(o);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(`fnaf3-detectors: ${e.message}`); process.exitCode = 2; });
}
