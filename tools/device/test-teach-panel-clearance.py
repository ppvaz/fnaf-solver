#!/usr/bin/env python3
"""The teach panel against every host-side reader of a frame, and every tap.

The Companion's teach panel (android/companion TeachPanel.java) paints one
opaque rectangle over the game during a --teach-overlay night. Its helper-side
clearance is TeachPanelTest.java; this is the host side, read from the modules
themselves rather than copied:

  - the live night authority (nightpredicate.py, screenstate.py): every region
    it reads during a night stays GUARD_PX clear of the panel;
  - the lifecycle model's boxes (lifecycle-observe.py) and the video grader's
    row bands (run-timeline.py): clear, except the named whole-frame and
    upper-half statistics, which a teach run's grading blanks with
    `run-timeline.py --exclude-rect` (checked here to cover the panel);
  - the device profile's control points: none lies under the panel, so the
    opaque window never meets Android's untrusted-touch opacity rule on a tap
    the schedule sends during a night.

Exit 0 and one PASS line, or a FAIL line per violation and exit 1.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

import nightpredicate  # noqa: E402
import screenstate  # noqa: E402

W, H = 2400, 1080
failures = []


def check(what, ok):
    if not ok:
        failures.append(what)
        print(f"FAIL {what}")


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


model = json.load(open(os.path.join(HERE, "models", "teach-panel-v1.json")))
check("model schema", model.get("schema") == "teach-panel-v1")
check("model geometry is native", model["geometry"] == {"width": W, "height": H})
rect = model["rect"]
L, T, R, B = rect["left"], rect["top"], rect["right"], rect["bottom"]
GUARD = model["guardPx"]
check("panel lies on the frame", 0 <= L < R <= W and 0 <= T < B <= H)


def gap(x0, y0, x1, y1):
    """Pixel distance from the half-open box [x0,x1)x[y0,y1) to the panel; 0 if they overlap."""
    dx = max(L - (x1 - 1), x0 - (R - 1), 0) if not (x1 > L and x0 < R) else 0
    dy = max(T - (y1 - 1), y0 - (B - 1), 0) if not (y1 > T and y0 < B) else 0
    return max(dx, dy)


def fraction_box(box):
    fx0, fy0, fx1, fy1 = box
    x0, y0 = int(fx0 * W), int(fy0 * H)
    return x0, y0, max(int(fx1 * W), x0 + 1), max(int(fy1 * H), y0 + 1)


def clear(name, box):
    d = gap(*box)
    check(f"{name} {box} stays {GUARD} px from the panel (distance {d})", d >= GUARD)


# The live night authority: every region it reads while a night runs.
for name in ("FLASH", "MASKBAR", "TOP_BAND"):
    clear(f"nightpredicate.{name}", fraction_box(getattr(nightpredicate, name)))
for index, row in enumerate(nightpredicate.GLOBAL_ROWS):
    clear(f"nightpredicate.GLOBAL_ROWS[{index}]", fraction_box(row))
for index, box in enumerate(screenstate.RULE_BOXES):
    clear(f"screenstate.RULE_BOXES[{index}]", fraction_box(box))
clear("screenstate.GAMEOVER_TOP_BAND", screenstate.GAMEOVER_TOP_BAND)

# Lifecycle signatures. wholeFrameMean is the one box that cannot avoid any
# panel; it is read only for a frame the night predicate did not call a night.
lifecycle = json.load(open(os.path.join(HERE, "models", "lifecycle-moto-g56-v207.json")))
for name, signature in lifecycle["signatures"].items():
    box = tuple(signature["box"])
    if name == "wholeFrameMean":
        check("wholeFrameMean is the whole frame", box == (0, 0, W, H))
        continue
    clear(f"lifecycle.{name}", box)

# The video grader. Its row bands are fractions of the decoded frame.
timeline = load("run_timeline", os.path.join(HERE, "run-timeline.py"))
clear("run-timeline mask bar rows", (0, int(0.88 * H), W, H))
clear("run-timeline clock band rows", (0, int(0.40 * H), W, int(0.56 * H) + 1))
# The confetti band (upper 45%) and the dark-frame mean cannot avoid the
# panel: a teach run is graded with the panel blanked. Prove the blanking
# covers every decoded pixel the panel touches, at the grader's own scale.
frame = bytes([255]) * (timeline.W * timeline.H * 3)
blanked = timeline.exclude(frame, (L, T, R, B))
for y in range(timeline.H):
    for x in range(timeline.W):
        nx0, nx1 = x * W / timeline.W, (x + 1) * W / timeline.W
        ny0, ny1 = y * H / timeline.H, (y + 1) * H / timeline.H
        touches = nx1 > L and nx0 < R and ny1 > T and ny0 < B
        if touches and blanked[(y * timeline.W + x) * 3] != 0:
            check(f"--exclude-rect blanks decoded pixel ({x},{y})", False)
check("--exclude-rect leaves the rest of the frame", blanked.count(255) > 0.9 * len(frame))
check("--exclude-rect parses the model's rectangle",
      timeline.parse_rect(f"{L},{T},{R},{B}") == (L, T, R, B))

# Taps: no control the schedule can press during a night is under the panel.
profile = json.load(open(os.path.join(ROOT, "apps", "device", "profiles", "hid-mediaprojection.json")))
for control, point in profile["controlMap"].items():
    d = gap(point["x"], point["y"], point["x"] + 1, point["y"] + 1)
    check(f"control {control} ({point['x']},{point['y']}) is {GUARD} px clear of the panel "
          f"(distance {d})", d >= GUARD)

if failures:
    print(f"test-teach-panel-clearance: {len(failures)} failure(s)")
    sys.exit(1)
print("test-teach-panel-clearance: the night authority, lifecycle boxes, grader bands "
      "and control points clear the teach panel; the grader blanks it")
