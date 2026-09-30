#!/usr/bin/env python3
"""Repo-runnable gate for Plan 13's generic intro-card decision."""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    failed = 0

    def check(ok, message):
        nonlocal failed
        if not ok:
            print(f"FAIL {message}")
            failed += 1

    with tempfile.TemporaryDirectory() as tmp:
        made = subprocess.run(
            [sys.executable, str(HERE / "testdata/make-intro-card-fixture.py"), tmp],
            capture_output=True, text=True, check=False)
        check(made.returncode == 0, f"fixture generator: {made.stderr.strip()}")
        model_path = Path(tmp) / "synthetic-intro-model.json"
        model = json.loads(model_path.read_text())
        intro = load("intro_card", HERE / "../src/sensors/screencap/intro_card.py")

        expected = {
            "intro": (True, None),
            "sixam": (False, "win-confetti-present"),
            "fade": (False, "intro-text-absent"),
            "cutscene": (False, "intro-outer-field-lit"),
            "office": (False, "intro-text-absent"),
        }
        for name, want in expected.items():
            got = intro.classify(Image.open(Path(tmp) / f"{name}.png"), model)[:2]
            check(got == want, f"{name}: expected {want!r}, got {got!r}")

        # Exercise the public protocol: the positive label is generic and every
        # negative is UNKNOWN, never a guessed lifecycle or night number.
        for name, (positive, reason) in expected.items():
            got = subprocess.run(
                [sys.executable, str(HERE / "../src/sensors/screencap/intro_card.py"),
                 str(Path(tmp) / f"{name}.png"), "--model", str(model_path)],
                capture_output=True, text=True, check=False)
            want_text = "state=intro" if positive else f"unknown={reason}"
            check(got.stdout.strip() == want_text,
                  f"CLI {name}: expected {want_text!r}, got {got.stdout.strip()!r}")
            check(got.returncode == (0 if positive else 3),
                  f"CLI {name}: unexpected exit {got.returncode}")
            check("night1" not in got.stdout.lower() and "1st" not in got.stdout.lower(),
                  f"CLI {name}: inferred a night number")

        # Lifecycle and timeline are the two integration paths used by
        # grade-run.sh.  Unit-driving phase_of avoids requiring ffmpeg in CI.
        old = os.environ.get("INTRO_CARD_MODEL")
        os.environ["INTRO_CARD_MODEL"] = str(model_path)
        try:
            lifecycle = load("lifecycle_observe", HERE / "../src/sensors/screencap/lifecycle-observe.py")
            timeline = load("run_timeline", HERE / "../../../packages/review/bin/grade/run-timeline.py")
            lifecycle_model = json.loads(
                (HERE / "../profiles/fnaf2/moto-g56/lifecycle-moto-g56-v207.json").read_text())
            th = lifecycle_model["thresholds"]
            for name, want in (("intro", "intro"), ("sixam", "sixam"),
                               ("fade", "dark")):
                image = Image.open(Path(tmp) / f"{name}.png").resize(
                    (timeline.W, timeline.H))
                frame = image.convert("RGB").tobytes()
                got = timeline.phase_of(frame, lifecycle, th)
                check(got == want, f"timeline {name}: expected {want!r}, got {got!r}")
        finally:
            if old is None:
                os.environ.pop("INTRO_CARD_MODEL", None)
            else:
                os.environ["INTRO_CARD_MODEL"] = old

        grade = (HERE / "../../../packages/review/bin/grade/grade-run.sh").read_text()
        check('"$HERE/run-timeline.py" "$VIDEO"' in grade,
              "grade-run no longer invokes the lifecycle timeline")

    if failed:
        print(f"{failed} intro-card check(s) failed")
        return 1
    print("intro-card: conjunction rejects cutscene, fade, office and 6 AM; "
          "timeline/grade-run integration preserves the generic intro label")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
