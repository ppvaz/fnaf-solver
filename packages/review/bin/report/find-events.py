#!/usr/bin/env python3
"""Locate visual events in a mask-camp trial video by frame differencing.

Reports timestamp ranges where the frame changes sharply (vent-visitor
overlays, monitor flips, jumpscare, game over), so mask-clear intervals can
be read without scrubbing the whole video. Stdlib only.
Usage: find-events.py video.mp4
"""
import subprocess, sys, statistics

path = sys.argv[1]
W, H, FPS = 160, 72, 6
SZ = W * H
raw = subprocess.run(
    ["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps={FPS},scale={W}:{H}",
     "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    capture_output=True).stdout
n = len(raw) // SZ
diffs = []
for i in range(1, n):
    a = raw[(i - 1) * SZ:i * SZ]
    b = raw[i * SZ:(i + 1) * SZ]
    diffs.append(sum(abs(x - y) for x, y in zip(a, b)) / SZ)
base = statistics.median(diffs)
thr = max(3.0, base * 3)
print(f"{n} frames @ {FPS} fps, median diff {base:.2f}, threshold {thr:.2f}")
run = None
for i, d in enumerate(diffs):
    t = (i + 1) / FPS
    if d > thr and run is None:
        run = t
    elif d <= thr and run is not None:
        print(f"  event {run:6.2f}s -> {t:6.2f}s")
        run = None
if run is not None:
    print(f"  event {run:6.2f}s -> end")
