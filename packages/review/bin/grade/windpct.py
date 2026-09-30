#!/usr/bin/env python3
"""Measure the CAM 11 music-box gauge in a recorded device trial.

This is deliberately post-run analysis. It does not participate in or retime
the open-loop Minus 7 strategy. The geometry is calibrated against the
1280x576 recordings made by trial.sh; input video is scaled before
measurement, so other resolutions produce the same result.

Usage: windpct.py [--samples] captures/run.mp4
"""

import argparse
import statistics
import subprocess
import sys

import framesource


WIDTH = 320
HEIGHT = 80
FPS = 12
FRAME_SIZE = WIDTH * HEIGHT * 3

# At the harness's reference resolution, the solid white pie gauge is centered
# here. Staying 7 px inside its antialiased edge makes white area proportional
# to the displayed pie fill despite the feed's moving static.
GAUGE_X = 276
GAUGE_Y = 49
GAUGE_RADIUS = 24
GAUGE_PIXELS = [
    (x, y)
    for y in range(GAUGE_Y - GAUGE_RADIUS, GAUGE_Y + GAUGE_RADIUS + 1)
    for x in range(GAUGE_X - GAUGE_RADIUS, GAUGE_X + GAUGE_RADIUS + 1)
    if (x - GAUGE_X) ** 2 + (y - GAUGE_Y) ** 2 <= GAUGE_RADIUS ** 2
]

# The lime Wind Up Music Box button exists only in CAM 11. Sampling every
# other pixel here cheaply rejects other camera feeds and transition frames.
BUTTON_POINTS = [
    (x, y)
    for y in range(16, 68, 2)
    for x in range(10, 212, 2)
]


def decode(path):
    """Yield cropped frames so a long recording stays O(seconds), not O(video)."""
    yield from framesource.frames(
        path, f"fps={FPS},scale=1280:576,crop={WIDTH}:{HEIGHT}:120:400", "rgb24", FRAME_SIZE)


def pixel(frame, x, y):
    start = (y * WIDTH + x) * 3
    return frame[start], frame[start + 1], frame[start + 2]


def is_cam11(frame):
    lime = 0
    for x, y in BUTTON_POINTS:
        red, green, blue = pixel(frame, x, y)
        if red > 90 and green > 90 and blue < 85 and green > blue * 1.6:
            lime += 1
    return lime >= 200


def gauge_fill(frame):
    white = 0
    for x, y in GAUGE_PIXELS:
        red, green, blue = pixel(frame, x, y)
        if red > 200 and green > 200 and blue > 200:
            white += 1
    return white / len(GAUGE_PIXELS)


def runs(samples):
    start = None
    for i, value in enumerate(samples):
        if value is not None and start is None:
            start = i
        elif value is None and start is not None:
            yield start, i, samples[start:i]
            start = None
    if start is not None:
        yield start, len(samples), samples[start:]


def smooth(values):
    output = list(values)
    for i, value in enumerate(values):
        if value is None:
            continue
        nearby = [
            values[j]
            for j in range(max(0, i - 1), min(len(values), i + 2))
            if values[j] is not None
        ]
        output[i] = statistics.median(nearby)
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    parser.add_argument(
        "--samples", action="store_true",
        help="also print CAM 11 samples at roughly half-second intervals",
    )
    args = parser.parse_args()

    values = smooth([gauge_fill(frame) if is_cam11(frame) else None
                     for frame in decode(args.video)])
    if not values:
        raise SystemExit(f"no video frames decoded from {args.video}")
    intervals = list(runs(values))

    print(f"{args.video}: {len(values) / FPS:.2f}s sampled at {FPS} fps")
    if not intervals:
        print("  no CAM 11 music-box gauge detected")
        return

    for start, end, segment in intervals:
        # Ignore the first and last frame when possible: the button can become
        # detectable before the gauge's flip animation has fully settled.
        stable = segment[1:-1] if len(segment) >= 4 else segment
        first = stable[0]
        last = stable[-1]
        low = min(stable)
        high = max(stable)
        print(
            f"  cam11 {start / FPS:6.2f}s -> {end / FPS:6.2f}s  "
            f"{first * 100:5.1f}% -> {last * 100:5.1f}%  "
            f"(range {low * 100:5.1f}-{high * 100:5.1f}%)"
        )
        if args.samples:
            for relative in range(1, len(segment) - 1, max(1, FPS // 2)):
                value = segment[relative]
                print(f"    {(start + relative) / FPS:6.2f}s  {value * 100:5.1f}%")


if __name__ == "__main__":
    main()
