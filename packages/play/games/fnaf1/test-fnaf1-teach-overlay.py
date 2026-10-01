#!/usr/bin/env python3
"""Phone-free contract check for FNaF 1's noninteractive teaching overlay."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
MODEL = ROOT / "packages/play/profiles/fnaf1/moto-g56/teach-panel-fnaf1-moto-g56-v207.json"
CONTROLS = ROOT / "packages/play/profiles/fnaf1/moto-g56/controls-fnaf1-moto-g56-v207.json"
TITLE = ROOT / "packages/play/profiles/fnaf1/moto-g56/title-fnaf1-moto-g56-v207.json"
SENSOR = ROOT / "packages/play/games/fnaf1/fnaf1-door-light.py"
COMPANION = ROOT / "android/companion/src/com/ppvaz/fnafcompanion"
CONTRACT = COMPANION / "Fnaf1Strip.java"
OVERLAY = COMPANION / "OverlayController.java"
TOOL = ROOT / "packages/play/games/fnaf1/fnaf1-teach-overlay.ts"


def gap(rect, point):
    left, top, right, bottom = rect
    x, y = point
    dx = max(left - x, x - (right - 1), 0) if not left <= x < right else 0
    dy = max(top - y, y - (bottom - 1), 0) if not top <= y < bottom else 0
    return max(dx, dy)


model = json.loads(MODEL.read_text())
controls = json.loads(CONTROLS.read_text())
title = json.loads(TITLE.read_text())
rect_row = model["rect"]
rect = tuple(rect_row[key] for key in ("left", "top", "right", "bottom"))
assert model["schema"] == "fnaf1-teach-overlay-v2"
assert model["target"]["package"] == "com.scottgames.fivenightsatfreddys"
assert model["geometry"] == {"width": 2400, "height": 1080}
assert 0 <= rect[0] < rect[2] <= 2400 and 0 <= rect[1] < rect[3] <= 1080
assert rect[3] + model["guardPx"] <= 60, "must clear fnaf1-door-light.py's y=60 reader floor"
sensor_source = SENSOR.read_text()
assert "(0, 60, 1200, 900)" in sensor_source
assert "(1200, 60, 2400, 900)" in sensor_source
assert rect[3] <= title["title_gate"]["box"][1], "must not touch FNaF 1 title logo gate"
for name, point in controls["controlMap"].items():
    assert gap(rect, (point["x"], point["y"])) >= model["guardPx"], (name, point)
assert set(model["stages"]) == {
    "hands-off", "left-calibration", "left-watch", "right-monitor-calibration", "full-loop", "night2-calibration"
}
# The Companion draws what this model describes: the same rectangle, guard and
# stages, in the shared non-touchable panel window, on debug builds only.
contract = CONTRACT.read_text()
assert model["presenter"]["package"] == "com.ppvaz.fnafcompanion" and model["presenter"]["lesson"] == "f1strip"
assert model["presenter"]["contract"] == str(CONTRACT.relative_to(ROOT))
constants = {name: int(value) for name, value in re.findall(r"public static final int (\w+) = (\d+);", contract)}
assert (constants["LEFT"], constants["TOP"], constants["RIGHT"], constants["BOTTOM"]) == rect, (constants, rect)
assert constants["GUARD_PX"] == model["guardPx"]
assert re.findall(r'"([a-z0-9-]+)"', contract.split("STAGES = {")[1].split("}")[0]) == model["stages"]
assert f'SCHEMA = "{model["schema"]}"' in contract
assert "FNAF2" not in contract and "fnaf2" not in contract
overlay = OVERLAY.read_text()
assert "FLAG_NOT_TOUCHABLE" in overlay and "FLAG_NOT_FOCUSABLE" in overlay and "TYPE_APPLICATION_OVERLAY" in overlay
strip_command = overlay.split("public String f1StripCommand")[1].split("\n    }\n")[0]
assert 'if (!debuggable()) return "ERROR teach-release-build";' in strip_command
tool = TOOL.read_text()
assert "f1strip" in tool and f"SCHEMA = '{model['schema']}'" in tool
assert "com.scottgames.fnaf2" not in tool
assert "fnaf1-teach-overlay.ts --status|--preflight|--clear" in tool
print("fnaf1 teach overlay: the Companion's FNaF 1-only passive strip clears reader/title/control contracts")
