#!/usr/bin/env python3
"""Grade a recorded Minus 7 run without participating in the live loop.

The device harness deliberately runs open-loop. This tool decodes a pulled
screenrecord afterward and reports stable office, mask, and camera intervals.
The thresholds are calibrated for the 1280x576 recordings made by the local
Moto g56 harness, but frames are scaled before classification so the report is
independent of the recording resolution.

Usage: grade-minus7.py captures/run.mp4
"""

import argparse
import subprocess
import sys

import framesource


WIDTH = 160
HEIGHT = 72
FPS = 12
FRAME_SIZE = WIDTH * HEIGHT


def mean_region(frame, left, top, right, bottom):
    total = 0
    count = 0
    for y in range(top, bottom):
        start = y * WIDTH + left
        row = frame[start:y * WIDTH + right]
        total += sum(row)
        count += len(row)
    return total / count


def classify(frame):
    overall = sum(frame) / FRAME_SIZE
    map_area = mean_region(frame, 70, 22, 155, 65)
    center = mean_region(frame, 40, 17, 120, 58)
    bottom_left = mean_region(frame, 0, 62, 90, 71)
    hall_core = mean_region(frame, 105, 22, 145, 50)

    # The office hall beam brightens the right half but leaves the center much
    # darker than a camera-feed flash/static frame. Detect it before the broad
    # camera rule so a visibly rendered office beam is reported. The Android
    # source deliberately renders the hall dark during the 300-frame movement
    # latch even though the same logical light still affects Foxy.
    if 25 < overall < 48 and center < 30 and bottom_left > 30 and hall_core > 25:
        return "hall-candidate"

    # The camera map/static lifts both the whole frame and the right-side map.
    if overall > 36 and map_area > 24:
        return "camera"
    # The mask is almost black, apart from its persistent pink lower-left tab.
    if overall < 10 and bottom_left > 14:
        return "mask"
    # The office has a dark center and the bright mask tab, unlike flip/static.
    if 21 < overall < 37 and center < 15 and bottom_left > 30:
        return "office"
    return "transition"


def runs(states):
    start = 0
    for i in range(1, len(states) + 1):
        if i == len(states) or states[i] != states[start]:
            yield states[start], start, i
            start = i


def smooth(states):
    states = list(states)
    # A short noisy/static gap inside one stable view is still that view.
    for state, start, end in list(runs(states)):
        if state != "transition" or end - start > round(FPS * 0.5):
            continue
        before = states[start - 1] if start else None
        after = states[end] if end < len(states) else None
        if before == after and before != "transition":
            states[start:end] = [before] * (end - start)
    return states


def resolve_hall(states):
    """Separate office hall beams from visually similar camera-light frames."""
    states = list(states)
    lookback = round(FPS * 0.5)
    for state, start, end in list(runs(states)):
        if state != "hall-candidate":
            continue
        # A camera-light pulse has the same broad brightness signature, but it
        # starts directly inside a camera interval. A real office beam follows
        # the monitor-down/mask phase, leaving at least half a second since the
        # previous stable camera sample.
        recent_camera = "camera" in states[max(0, start - lookback):start]
        replacement = "camera" if recent_camera else "hall"
        if start == 0:
            replacement = "transition"
        states[start:end] = [replacement] * (end - start)
    return states


def decode(path):
    """Yield frames; this report only retains classification labels."""
    yield from framesource.frames(path, f"fps={FPS},scale={WIDTH}:{HEIGHT}", "gray", FRAME_SIZE)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("video")
    args = parser.parse_args()

    states = smooth(resolve_hall(classify(frame) for frame in decode(args.video)))
    if not states:
        raise SystemExit(f"no video frames decoded from {args.video}")
    stable = []
    minimum = round(FPS * 0.25)
    for state, start, end in runs(states):
        state_minimum = 2 if state == "hall" else minimum
        if state != "transition" and end - start >= state_minimum:
            stable.append((state, start / FPS, end / FPS))

    print(f"{args.video}: {len(states) / FPS:.2f}s sampled at {FPS} fps")
    for state, start, end in stable:
        duration = end - start
        warning = "  <-- latched mask" if state == "mask" and duration > 1.0 else ""
        print(f"  {state:6s} {start:6.2f}s -> {end:6.2f}s  ({duration:4.2f}s){warning}")

    camera_entries = sum(1 for state, _, _ in stable if state == "camera")
    hall_flashes = sum(1 for state, _, _ in stable if state == "hall")
    long_masks = sum(1 for state, start, end in stable if state == "mask" and end - start > 1.0)
    print(
        f"summary: {camera_entries} camera intervals, {hall_flashes} visible hall flashes, "
        f"{long_masks} latched-mask intervals"
    )
    print(
        "note: visible hall flashes are only a rendering lower bound; the sourced "
        "movement blackout can hide logically accepted Foxy flashes"
    )


if __name__ == "__main__":
    main()
