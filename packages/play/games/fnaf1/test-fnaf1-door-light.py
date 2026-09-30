#!/usr/bin/env python3
"""Synthetic regression for the native FNaF 1 door-light reader."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
TOOL = HERE / "fnaf1-door-light.py"
SIZE = (2400, 1080)


def make(path, side, lit=False, occupant=False, variant=0):
    image = Image.new("RGB", SIZE, (20 + variant, 22 + variant, 25 + variant))
    draw = ImageDraw.Draw(image)
    x0, x1 = (100, 700) if side == "left" else (1700, 2300)
    if lit:
        draw.rectangle((x0, 220, x1, 720), fill=(180 + variant, 175 + variant, 145 + variant))
        draw.rectangle((x0 + 50, 300, x1 - 50, 650), fill=(210 + variant, 205 + variant, 175 + variant))
    if occupant:
        draw.rectangle((x0 + 260, 320, x0 + 450, 650), fill=(35, 30, 25))
    image.save(path)


def call(*args):
    result = subprocess.run([sys.executable, str(TOOL), *map(str, args)],
                            capture_output=True, text=True, check=False)
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        raise AssertionError(f"not JSON ({result.returncode}): {result.stdout!r} {result.stderr!r}")
    return result.returncode, payload


def main():
    with tempfile.TemporaryDirectory() as tmp_text:
        tmp = Path(tmp_text)
        off, on1, on2, occupant = (tmp / name for name in ("off.png", "on1.png", "on2.png", "occupant.png"))
        make(off, "left")
        make(on1, "left", lit=True)
        make(on2, "left", lit=True, variant=1)
        make(occupant, "left", lit=True, occupant=True)
        model = tmp / "left.json"
        code, ready = call("calibrate", "--side", "left", "--off", off, "--on", on1, "--on", on2, "--out", model)
        assert code == 0 and ready["status"] == "READY" and ready["cells"] >= 2, ready
        code, clear = call("score", "--model", model, "--frame", on2)
        assert code == 0 and clear["state"] == "clear", clear
        code, seen = call("score", "--model", model, "--frame", occupant)
        assert code == 0 and seen["state"] == "occupied", seen

        # The reader must not silently resize a screenrecord-like frame.
        foreign = tmp / "foreign.png"
        Image.new("RGB", (1280, 576), (0, 0, 0)).save(foreign)
        code, refusal = call("score", "--model", model, "--frame", foreign)
        assert code == 3 and refusal["status"] == "UNKNOWN" and "sensor-mismatch" in refusal["reason"], refusal

        # A supposed on-frame without visible illumination is not a calibration.
        dark_model = tmp / "dark.json"
        code, refusal = call("calibrate", "--side", "left", "--off", off, "--on", off, "--out", dark_model)
        assert code == 3 and refusal["reason"] == "light-transition-not-visible", refusal

    print("fnaf1 door light: native calibration, occupancy, and refusals pass")


if __name__ == "__main__":
    main()
