#!/usr/bin/env python3
"""Resolution regression for camtrace's stable-run gate.

screenrecord captures at the panel rate (60 fps on the Moto g56). Decoding at
30 fps with a 100 ms floor cannot resolve a camera selected for ~160 ms: every
dwell reports as exactly the floor, and any dwell that straddles frame edges
falls under it and reads as a dropped selection. That artifact is what made a
120 ms sweep look rejected on this phone.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import camtrace


def runs(states, fps, min_ms):
    camtrace.FPS, camtrace.MIN_MS = fps, min_ms
    return [(state, end - start) for state, start, end in camtrace.stable_runs(states)]


# One 160 ms selection of each camera, sampled at 60 fps: ten frames each, but
# the middle one loses its edges to feed transitions and keeps only five.
sampled = [10] * 10 + [None] + [4] * 5 + [None] + [7] * 10 + [11] * 90
decimated = sampled[::2]   # the same capture decoded at 30 fps

assert [state for state, _ in runs(sampled, 60, 50)] == [10, 4, 7, 11], \
    "60 fps at a 50 ms floor must resolve all three selections"
assert [state for state, _ in runs(decimated, 30, 100)] == [10, 7, 11], \
    "the 30 fps default is expected to lose the short middle selection"

# The floor must never fall below two samples, or single-frame colour noise
# becomes a selection.
assert runs([10, None, 10, None, 10], 60, 1) == [], \
    "a one-sample run must not count as a stable selection at any floor"

print("camtrace resolution checks passed")
