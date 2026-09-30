#!/usr/bin/env python3
"""Report stable 10 -> 04 -> 07 -> 11 camera sweeps in a trial video.

The highlighted selected-camera buttons provide a stronger post-run signal than
ADB's printed command log. They are YELLOW, not lime: `lime_score` below tests
`red > 100 and green > 100 and blue < 100`, and the button measures (200,200,0)
on this build. The function keeps its name; the description is corrected because
"lime" sent a later reader looking for green and finding nothing. Brief white flashlight frames and map transitions are
ignored. This tool never participates in the live timed loop.

Usage: camtrace.py captures/run.mp4
"""

import argparse
import subprocess
import sys

import framesource


WIDTH = 430
HEIGHT = 110
FPS = 30
MIN_MS = 100
FRAME_SIZE = WIDTH * HEIGHT * 3
CROP_X = 850
CROP_Y = 300
CAMERAS = {
    10: (1091 - CROP_X, 384 - CROP_Y),
    4: (923 - CROP_X, 379 - CROP_Y),
    7: (947 - CROP_X, 328 - CROP_Y),
    11: (1213 - CROP_X, 365 - CROP_Y),
}


def decode(path):
    """Yield frames; a full 60 fps night is far too large for capture_output.

    The chain is the instrument's own; framesource decodes it privately or
    hands it the shared decode's pipe when the pipeline offers one."""
    yield from framesource.frames(
        path, f"fps={FPS},scale=1280:576,crop={WIDTH}:{HEIGHT}:{CROP_X}:{CROP_Y}", "rgb24", FRAME_SIZE)


def lime_score(frame, center):
    center_x, center_y = center
    score = 0
    for y in range(max(0, center_y - 24), min(HEIGHT, center_y + 25), 2):
        for x in range(max(0, center_x - 48), min(WIDTH, center_x + 49), 2):
            start = (y * WIDTH + x) * 3
            red, green, blue = frame[start:start + 3]
            if red > 100 and green > 100 and blue < 100 and green > blue * 1.5:
                score += 1
    return score


def classify(frame):
    scores = {camera: lime_score(frame, center) for camera, center in CAMERAS.items()}
    camera = max(scores, key=scores.get)
    return camera if scores[camera] >= 30 else None


def stable_runs(states):
    start = 0
    for i in range(1, len(states) + 1):
        if i == len(states) or states[i] != states[start]:
            if states[start] is not None and i - start >= max(2, round(FPS * MIN_MS / 1000)):
                yield states[start], start, i
            start = i


def main():
    global FPS, MIN_MS
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    # screenrecord captures at the panel rate (60 fps on the Moto g56), so the
    # default 30 fps decode plus a 100 ms floor cannot resolve a sweep whose
    # cameras are only selected for ~160 ms: every dwell reports as exactly the
    # floor. Raise the decode rate before concluding a selection was dropped.
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--min-ms", type=int, default=100,
                        help="shortest run counted as a stable selection")
    parser.add_argument(
        "--expected", type=int,
        help="expected number of complete sweeps; exit nonzero if fewer appear",
    )
    args = parser.parse_args()
    FPS, MIN_MS = args.fps, args.min_ms

    states = [classify(frame) for frame in decode(args.video)]
    if not states:
        raise SystemExit(f"no video frames decoded from {args.video}")
    detected = list(stable_runs(states))
    print(f"{args.video}: selected-camera trace at {FPS} fps")
    if not detected:
        print("  no stable target-camera highlights detected")
        return

    for camera, start, end in detected:
        print(
            f"  cam {camera:02d}  {start / FPS:6.2f}s -> {end / FPS:6.2f}s  "
            f"({(end - start) / FPS:4.2f}s)"
        )

    sequence = []
    for camera, _, _ in detected:
        if not sequence or sequence[-1] != camera:
            sequence.append(camera)
    sweeps = 0
    misses = 0
    for i, camera in enumerate(sequence):
        if camera != 10:
            continue
        tail = sequence[i:i + 4]
        if tail == [10, 4, 7, 11]:
            sweeps += 1
        else:
            misses += 1
    expected = f"/{args.expected}" if args.expected is not None else ""
    print(
        f"summary: {sweeps}{expected} complete 10-04-07-11 sweeps, "
        f"{misses} incomplete sweep starts"
    )
    if args.expected is not None and sweeps < args.expected:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
