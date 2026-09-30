#!/usr/bin/env python3
"""grade-night.py's temporal death-static rule, against the rows it was
measured on and the controls it must refuse.

Until 2026-09-12 grade-night recognised death only as bright, rough static
(mean > 90, edge > 40). This handset records the death static as a mid-grey
noise field, so three deaths in a row (final2, rep1, anchor1) graded as
"ALIVE for at least ... -- a lower bound" with the terminal UNKNOWN. The rule
that separates that static from everything else is temporal: consecutive
frames are decorrelated for seconds. The measured rows below are the
calibration; a bound that stops clearing them with margin fails here.
"""

from __future__ import annotations

import importlib.util
import pathlib
import random
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("grade_night", HERE / "grade-night.py")
gn = importlib.util.module_from_spec(spec)
sys.modules["grade_night"] = gn
spec.loader.exec_module(gn)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"test-grade-night: FAIL: {message}")


FPS = 4.0
# Measured 4 fps rows (mean, sd, tdiff), subsampled red channel, 1280x576.
DEATH_STATIC = {
    "anchor1 274.25-279.00": [(36.7, 34.5, 72.9), (34.0, 32.1, 35.2), (34.8, 34.4, 34.8), (33.9, 32.2, 34.8),
                              (34.8, 34.3, 34.7), (36.8, 34.6, 36.7), (34.7, 34.1, 36.5), (36.8, 34.6, 36.5),
                              (34.6, 34.3, 36.7), (33.9, 32.2, 34.8), (34.7, 34.2, 34.7), (36.8, 34.6, 36.7),
                              (34.7, 34.4, 36.7), (36.9, 34.5, 36.7), (34.6, 34.3, 36.7), (36.9, 35.0, 36.9),
                              (34.6, 34.3, 36.9), (36.8, 34.7, 36.7), (34.7, 34.4, 36.7)],
    "rep1 147.50-152.50": [(36.7, 35.3, 67.9), (34.1, 33.0, 36.1), (34.8, 35.0, 35.5), (33.9, 32.9, 35.5),
                           (34.6, 35.0, 35.5), (36.9, 35.4, 37.5), (34.6, 34.9, 37.4), (36.9, 35.1, 37.3),
                           (34.6, 34.7, 37.2), (37.0, 35.2, 37.2), (34.7, 34.4, 36.9), (37.0, 34.8, 36.8),
                           (34.7, 34.5, 36.7), (36.9, 34.8, 36.7), (34.7, 34.5, 36.7), (36.9, 34.8, 36.7),
                           (34.7, 34.5, 36.6), (36.9, 34.8, 36.7), (34.7, 34.5, 36.6), (36.8, 36.0, 37.5)],
    "final2 213.75-218.50": [(37.0, 35.5, 63.2), (34.7, 34.4, 37.2), (33.9, 32.1, 34.7), (34.6, 34.8, 35.0),
                             (36.8, 34.6, 37.0), (34.7, 33.8, 36.4), (36.8, 34.6, 36.4), (34.6, 34.3, 36.7),
                             (36.8, 34.6, 36.7), (34.7, 34.3, 36.6), (36.6, 34.6, 36.7), (34.6, 34.3, 36.7),
                             (36.8, 34.7, 36.7), (34.7, 34.4, 36.7), (36.8, 34.6, 36.7), (34.6, 34.4, 36.7),
                             (36.8, 34.6, 36.7), (34.7, 34.4, 36.7), (36.8, 34.6, 36.7), (34.6, 34.3, 36.7)],
}
GAME_OVER = [(23.6, 36.6, 30.3)] + [(22.8, 36.2, 11.3), (23.7, 36.3, 11.3), (21.5, 36.0, 11.0), (23.6, 36.6, 10.8)] * 8
OFFICE = [(38.7, 53.4, 12.0), (45.2, 54.8, 16.8), (40.5, 55.1, 16.2), (37.3, 56.7, 11.8), (36.0, 57.0, 5.5),
          (39.1, 56.6, 6.5), (43.4, 56.6, 10.1), (40.8, 56.0, 10.8), (40.0, 56.3, 8.6), (38.6, 56.6, 7.5)]
MASK_VIEW = [(4.8, 21.3, 15.6)] + [(4.6, 21.1, 1.6), (4.6, 21.1, 1.4), (4.5, 21.0, 1.2), (4.5, 21.1, 1.6)] * 5
TRANSITION = [(75.9, 64.2, 42.8), (29.6, 35.6, 57.7), (12.9, 36.3, 31.2)]      # monitor lowering, 3 frames
TEAR_BAND = [(190.6, 102.4, 164.8), (38.8, 51.0, 155.1)]                         # rep1's banded raise
JUMPSCARE = [(79.1, 63.4, 47.6), (33.4, 44.9, 62.3), (78.5, 82.9, 73.5)]         # anchor1's Mangle lunge

# 1. Every measured death row is inside the envelope, with margin.
for label, rows in DEATH_STATIC.items():
    for mean, sd, tdiff in rows[1:]:
        check(gn.static_frame((mean, sd, tdiff)), f"{label}: measured static row {(mean, sd, tdiff)} must match")
        check(tdiff - gn.STATIC_TDIFF_MIN >= 8, f"{label}: tdiff bound {gn.STATIC_TDIFF_MIN} too close to measured {tdiff}")
        check(mean - gn.STATIC_MEAN_RANGE[0] >= 8 and gn.STATIC_MEAN_RANGE[1] - mean >= 8, f"{label}: mean bound too close to {mean}")
        check(sd - gn.STATIC_SD_RANGE[0] >= 5 and gn.STATIC_SD_RANGE[1] - sd >= 5, f"{label}: sd bound too close to {sd}")

# 2. No control frame matches, and no control RUN matches the temporal rule.
for label, rows in {"game over": GAME_OVER[1:], "office": OFFICE, "mask view": MASK_VIEW[1:]}.items():
    for row in rows:
        check(not gn.static_frame(row), f"{label} row {row} must not read as static")
check(gn.STATIC_MIN_SECONDS * FPS > len(TRANSITION), "a monitor transition is shorter than the minimum run")
check(gn.STATIC_MIN_SECONDS * FPS > len(JUMPSCARE), "a jumpscare is shorter than the minimum run")

# 3. A whole recording: office, a mask window, a monitor transition, a
#    jumpscare, the death static, the game-over card. The run must end at the
#    first static frame and nowhere else.
sequence = [("office", OFFICE, True), ("mask", MASK_VIEW, True), ("office", OFFICE, True), ("transition", TRANSITION, False),
            ("cams", OFFICE, False), ("transition", TRANSITION, False), ("office", OFFICE, True),
            ("jumpscare", JUMPSCARE, True), ("static", DEATH_STATIC["anchor1 274.25-279.00"], False),
            ("gameover", GAME_OVER, False)]
stats, flags, labels = [], [], []
for label, rows, hud in sequence:
    for row in rows:
        stats.append(row)
        flags.append(hud)
        labels.append(label)
runs = gn.temporal_static_runs(stats, flags, FPS)
first_static = labels.index("static")
check(runs[first_static] is not None and runs[first_static].startswith("death static (temporal"),
      f"the static run is described at its first frame, got {runs[first_static]}")
check(all(runs[k] is None for k, label in enumerate(labels) if label != "static"),
      "no frame outside the static run is described as static")
check(all(runs[k] is not None for k, label in enumerate(labels) if label == "static"), "every static frame is inside the run")
descriptions = [r or "not a night HUD" for r in runs]
end = gn.find_end(flags, 0, 3, lambda i: descriptions[i].startswith("death static"))
check(end == first_static, f"find_end ends the run at the first static frame ({first_static}), got {end}")

# 4. A short burst of the same noise (a camera blip) is not a death.
burst = OFFICE + DEATH_STATIC["rep1 147.50-152.50"][1:4] + OFFICE
bflags = [True] * len(OFFICE) + [False] * 3 + [True] * len(OFFICE)
check(all(r is None for r in gn.temporal_static_runs(burst, bflags, FPS)), "a 0.75 s noise burst is not the death static")

# 5. frame_stats on real buffers: two independent noise buffers are
#    decorrelated, a buffer against itself is not.
rng = random.Random(7)
n = gn.WIDTH * gn.HEIGHT * 3
a = bytes(rng.getrandbits(8) for _ in range(0, n, 1)) if False else bytes(bytearray(rng.randbytes(n)))
b = bytes(bytearray(rng.randbytes(n)))
m1, s1, t1, sample = gn.frame_stats(a, None)
check(t1 is None and len(sample) == (n + gn.STATIC_STRIDE - 1) // gn.STATIC_STRIDE, "first frame has no tdiff")
_, _, t2, _ = gn.frame_stats(b, sample)
_, _, t3, _ = gn.frame_stats(a, sample)
check(t2 > 60 and t3 == 0, f"decorrelated noise reads high tdiff ({t2:.0f}) and a repeated frame zero ({t3})")

print("test-grade-night: ok")
