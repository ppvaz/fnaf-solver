#!/usr/bin/env python3
"""Regression for the sensor declaration. Synthetic frames, no phone.

plans/15. A classifier calibrated on one capture method must refuse frames from
another rather than resize them into a plausible answer. The repository already
paid for the general version of this: the Companion's threshold was derived
from `screencap` frames and an offline bilinear simulation rather than from
Android's own VirtualDisplay scaler, and is therefore still uncalibrated -- so
the 42 ms sensor cannot answer the question the 225 ms sensor can.
"""
import json
import os
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

warnings.simplefilter("ignore")
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from sensor import open_frame, SensorMismatch, NATIVE  # noqa: E402


def main():
    failed = 0

    def check(name, cond, detail=""):
        nonlocal failed
        if not cond:
            print(f"FAIL {name}{' -- ' + detail if detail else ''}")
            failed += 1

    with tempfile.TemporaryDirectory() as tmp:
        native = f"{tmp}/native.png"
        Image.new("RGB", (2400, 1080), (20, 20, 20)).save(native)
        other = f"{tmp}/other.png"
        Image.new("RGB", (1280, 576), (20, 20, 20)).save(other)
        odd = f"{tmp}/odd.png"
        Image.new("RGB", (999, 111), (20, 20, 20)).save(odd)

        im, used = open_frame(native)
        check("the native sensor reads", im.size == (2400, 1080) and used == NATIVE)

        # The whole point: a different capture method is a refusal, not a resize.
        try:
            open_frame(other)
            check("an undeclared foreign frame refuses", False, "it was accepted")
        except SensorMismatch as exc:
            check("an undeclared foreign frame refuses", "sensor-mismatch" in str(exc), str(exc))

        im, used = open_frame(other, "screenrecord-1280x576")
        check("a declared foreign frame reads, named",
              im.size == (2400, 1080) and used == "screenrecord-1280x576")

        try:
            open_frame(other, "no-such-sensor")
            check("an unknown sensor name refuses", False, "it was accepted")
        except SensorMismatch as exc:
            check("an unknown sensor name refuses", "unknown-sensor" in str(exc), str(exc))

        # Declaring a sensor does not license any geometry: the frame must
        # actually match what that capture method produces.
        try:
            open_frame(odd, "screenrecord-1280x576")
            check("a declared sensor still checks geometry", False, "it was accepted")
        except SensorMismatch as exc:
            check("a declared sensor still checks geometry",
                  "sensor-geometry" in str(exc), str(exc))

        # And end to end through a real classifier.
        env = {"TITLE_MODEL": str(HERE / "models" / "title-moto-g56-v207.json")}
        env = {**os.environ, **env}
        with open(other, "rb") as fh:
            out = subprocess.run([sys.executable, str(HERE / "title-observe.py")],
                                 stdin=fh, capture_output=True, text=True,
                                 env=env, check=False)
        check("title-observe refuses a foreign frame",
              "sensor-mismatch" in out.stdout, out.stdout.strip())

        # The per-game wrapper must never inherit menu.sh's FNaF 2 default.
        # This synthetic frame is deliberately shaped to satisfy FNaF 2's
        # title model while leaving the FNaF 1 logo/menu gates dark.  It proves
        # the wrapper gives title-observe FNaF 1's explicit model, rather than
        # asserting that the two games' models happen to disagree on a blank
        # screen.
        f2_only = f"{tmp}/f2-only.png"
        frame = Image.new("RGB", (2400, 1080), (8, 8, 12))
        draw = ImageDraw.Draw(frame)
        draw.rectangle((150, 40, 250, 140), fill=(255, 255, 255))
        draw.rectangle((1780, 830, 1900, 900), fill=(255, 255, 255))
        draw.rectangle((70, 652, 730, 678), fill=(255, 255, 255))
        frame.save(f2_only)
        f2_model = HERE / "models" / "title-moto-g56-v207.json"
        with open(f2_only, "rb") as fh:
            f2_result = subprocess.run([sys.executable, str(HERE / "title-observe.py")],
                                       stdin=fh, capture_output=True, text=True,
                                       env={**os.environ, "TITLE_MODEL": str(f2_model)}, check=False)
        check("the FNaF 2 control frame is accepted by the FNaF 2 model",
              f2_result.returncode == 0 and "newGame" in f2_result.stdout,
              f2_result.stdout.strip())
        f1_model = HERE / "models" / "title-fnaf1-moto-g56-v207.json"
        with f1_model.open(encoding="utf-8") as fh:
            f1_document = json.load(fh)
        check("the FNaF 1 model identifies FNaF 1's package",
              f1_document.get("build", "").startswith("com.scottgames.fivenightsatfreddys "),
              str(f1_document.get("build")))
        with open(f2_only, "rb") as fh:
            f1_result = subprocess.run([str(HERE / "fnaf1-title-observe.sh")],
                                       stdin=fh, capture_output=True, text=True,
                                       env={**os.environ, "TITLE_MODEL": str(f2_model)}, check=False)
        check("the FNaF 1 wrapper rejects an FNaF 2-only title frame",
              f1_result.returncode == 3 and "not-the-title-screen" in f1_result.stdout,
              f1_result.stdout.strip())

    if failed:
        print(f"{failed} sensor check(s) failed")
        return 1
    print("sensor: the native capture method reads; another refuses unless "
          "declared, a declared one still has to match its own geometry, and "
          "the FNaF 1 observer cannot inherit FNaF 2's title model")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
