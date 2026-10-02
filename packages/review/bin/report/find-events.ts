#!/usr/bin/env node
// Locate visual events in a mask-camp trial video by frame differencing.
//
// Reports timestamp ranges where the frame changes sharply (vent-visitor overlays, monitor flips,
// jumpscare, game over), so mask-clear intervals can be read without scrubbing the whole video.
// Ported from find-events.py; it prints what that printed.
//
//   node packages/review/bin/report/find-events.ts video.mp4
import { spawnSync } from 'node:child_process';
import { pyFixed } from '@sixam/kernel';

const path = process.argv[2];
if (path === undefined) throw new Error('usage: find-events.ts video.mp4');
const W = 160, H = 72, FPS = 6;
const SZ = W * H;
const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', path, '-vf', `fps=${FPS},scale=${W}:${H}`,
  '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 30 }).stdout;
const n = Math.floor(raw.length / SZ);
const diffs: number[] = [];
for (let i = 1; i < n; i += 1) {
  let sum = 0;
  for (let k = 0; k < SZ; k += 1) sum += Math.abs(raw[(i - 1) * SZ + k] - raw[i * SZ + k]);
  diffs.push(sum / SZ);
}
if (!diffs.length) throw new Error('no median for empty data');
const sorted = [...diffs].sort((a, b) => a - b);
const mid = sorted.length >> 1;
const base = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
const thr = Math.max(3.0, base * 3);
console.log(`${n} frames @ ${FPS} fps, median diff ${pyFixed(base, 2)}, threshold ${pyFixed(thr, 2)}`);
let run: number | null = null;
diffs.forEach((d, i) => {
  const t = (i + 1) / FPS;
  if (d > thr && run === null) run = t;
  else if (d <= thr && run !== null) {
    console.log(`  event ${pyFixed(run, 2).padStart(6)}s -> ${pyFixed(t, 2).padStart(6)}s`);
    run = null;
  }
});
if (run !== null) console.log(`  event ${pyFixed(run, 2).padStart(6)}s -> end`);
