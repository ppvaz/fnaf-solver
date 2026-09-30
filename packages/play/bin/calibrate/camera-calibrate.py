#!/usr/bin/env python3
"""Fit the cameraSelected rule from labelled monitor captures.

Each camera's map button renders yellow at a fixed position on the monitor
map while it is selected -- bright (~194) in the normal view, dimmed (~96)
while the music-box wind control is held -- and cool grey (~-19..-9) when
unselected.  This tool measures the yellowness of the twelve watch pixels
(mechanically aligned with ``PixelWatch.defaultSpec``, the twelve
camera-button pixels the FNaF 2 watch serves) over labelled captures -- one label per camera --
and emits the versioned ``camera-rule-v1`` artifact that
``packages/play/src/sensors/fnaf2/camera-rule.ts`` consumes.

Verdict semantics are strict: exactly one lit button names the selected
camera; zero and several are distinct UNKNOWN reasons (``no-camera-highlight``
and ``multiple-camera-highlight``), so a camera transition and the known
Android double-camera glitch stay separable in telemetry instead of being
confounded; any in-band value refuses as ``ambiguous-threshold``.  The camera
fact is meaningful only while the monitorUp fact is OBSERVED true; the JS
detector enforces that gate.

    camera-calibrate.py --output camera-rule.json \
        cam:4=captures/cam04 cam:7=captures/cam07 ...

Labels are semantic control names (``cam:1``..``cam:12``).  Foreign geometry
is refused, never resized.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import re
import sys
from dataclasses import dataclass

# One frame reader, not three: the .raw/.png loaders, the native-geometry
# refusal and the error type live in monitor-calibrate.py and are imported
# here, the way mask-calibrate.py and screen-calibrate.py already do. The
# module name is hyphenated, so it is loaded by path.
_SPEC = importlib.util.spec_from_file_location(
    "_monitor_calibrate", pathlib.Path(__file__).with_name("monitor-calibrate.py"))
_MC = importlib.util.module_from_spec(_SPEC)
sys.modules["_monitor_calibrate"] = _MC
_SPEC.loader.exec_module(_MC)

CalibrationError = _MC.CalibrationError
WIDTH, HEIGHT = _MC.WIDTH, _MC.HEIGHT
load_raw, load_frame = _MC.load_raw, _MC.load_frame

# `paths_for` stays local: this tool's labels are CAM:N, not free-form names.
SCHEMA = "camera-rule-v1"
SENSOR_ID = "cue-helper-watch-native-2400x1080"
PROFILE_ID = "moto-g56-v207-landscape"

# Mechanically aligned with PixelWatch.defaultSpec() (the FNaF 2 camera watch):
# the monitor map's camera buttons, measured 2026-09-01 on g56 captures.
BUTTON_PIXELS = (
    ("cam01_button", 1412, 784),
    ("cam02_button", 1720, 784),
    ("cam03_button", 1411, 690),
    ("cam04_button", 1728, 690),
    ("cam05_button", 1424, 916),
    ("cam06_button", 1696, 916),
    ("cam07_button", 1776, 606),
    ("cam08_button", 1412, 590),
    ("cam09_button", 2144, 548),
    ("cam10_button", 1984, 716),
    ("cam11_button", 2228, 652),
    ("cam12_button", 2188, 784),
)
UNKNOWN_REASONS = [
    "monitor-not-up", "no-camera-highlight", "multiple-camera-highlight",
    "ambiguous-threshold", "feature-missing", "read-unavailable", "read-stale",
    "sensor-mismatch", "calibration-refused",
]
LABEL_RE = re.compile(r"^cam:[0-9]{1,2}$")

@dataclass(frozen=True)
class Button:
    """One map button's measured selected/unselected separation."""

    control: str
    entry: str
    x: int
    y: int
    feature: str
    threshold: float
    refuse_band: float
    separation_margin: float
    lit_range: tuple[int, int]
    unlit_range: tuple[int, int]

    def reads(self, value: float) -> str:
        if value >= self.threshold + self.refuse_band:
            return "lit"
        if value <= self.threshold - self.refuse_band:
            return "unlit"
        return "in-band"

    def record(self) -> dict:
        return {
            "control": self.control, "entry": self.entry, "x": self.x, "y": self.y,
            "feature": self.feature,
            "rule": {"kind": "threshold", "threshold": self.threshold,
                     "refuse_band": self.refuse_band},
            "separation_margin": self.separation_margin,
            "lit_range": list(self.lit_range), "unlit_range": list(self.unlit_range),
        }

def paths_for(spec: str) -> tuple[str, list[pathlib.Path]]:
    label, separator, raw_path = spec.partition("=")
    if not separator or not LABEL_RE.fullmatch(label):
        raise CalibrationError(f"labelled source must be cam:N=PATH: {spec!r}")
    root = pathlib.Path(raw_path)
    if root.is_dir():
        paths = sorted(
            p for p in root.rglob("*")
            if p.is_file() and p.suffix.lower() in {".png", ".raw"})
    elif root.is_file():
        paths = [root]
    else:
        raise CalibrationError(f"{root}: no such frame or directory")
    if not paths:
        raise CalibrationError(f"{root}: no .png or .raw frames")
    return label, paths

def yellowness(rgb: tuple[int, int, int]) -> int:
    return min(rgb[0], rgb[1]) - rgb[2]

def calibrate(args) -> None:
    sources = [paths_for(spec) for spec in args.labelled]
    labels = [label for label, _ in sources]
    if len(set(labels)) != len(labels):
        raise CalibrationError("each label may appear only once")
    if len(labels) < 2:
        raise CalibrationError("at least two labelled cameras are required")

    frames: dict[str, list[dict[str, int]]] = {label: [] for label in labels}
    counts: dict[str, int] = {}
    for label, paths in sources:
        counts[label] = len(paths)
        for path in paths:
            image = load_frame(path)
            frames[label].append({
                entry: yellowness(image.getpixel((x, y)))
                for entry, x, y in BUTTON_PIXELS
            })

    controls = sorted(frames, key=lambda label: int(label.split(":")[1]))
    buttons = []
    for entry, x, y in BUTTON_PIXELS:
        control = f"cam:{entry[3:5].lstrip('0') or '0'}"
        lit = [values[entry] for values in frames.get(control, [])]
        unlit = [values[entry] for label in controls if label != control
                 for values in frames[label]]
        if not lit:
            # This camera was not among the labelled sources: an unlit-only
            # button still carries a threshold from its observed unlit band,
            # but it cannot be named as a verdict until its own camera is
            # captured.  Such buttons are refused into limitations instead.
            continue
        lit_lo, lit_hi = min(lit), max(lit)
        unlit_hi = max(unlit) if unlit else lit_lo - 2 * args.min_margin
        if lit_lo <= unlit_hi:
            raise CalibrationError(
                f"{control}: selected band {lit_lo}..{lit_hi} overlaps "
                f"unselected {unlit_hi}")
        threshold = (lit_lo + unlit_hi) / 2.0
        band = (lit_lo - unlit_hi) / 2.0
        if band < args.min_margin:
            raise CalibrationError(
                f"{control}: separation margin {band} below floor {args.min_margin}")
        buttons.append(Button(
            control=control, entry=entry, x=x, y=y, feature="yellowness",
            threshold=round(threshold, 3), refuse_band=round(band, 3),
            separation_margin=round(band, 3),
            lit_range=(lit_lo, lit_hi),
            unlit_range=(min(unlit) if unlit else 0, unlit_hi)))

    corpus_reads: dict[str, dict[str, int]] = {}
    reason = None
    for label in controls:
        reads = {"named": 0, "none": 0, "multiple": 0, "ambiguous": 0}
        for values in frames[label]:
            states = [(button, button.reads(values[button.entry]))
                      for button in buttons]
            lit = [button for button, state in states if state == "lit"]
            in_band = any(state == "in-band" for _, state in states)
            if len(lit) == 1 and not in_band:
                named = lit[0].control
                reads["named" if named == label else "ambiguous"] += 1
            elif len(lit) > 1:
                reads["multiple" if not in_band else "ambiguous"] += 1
            elif in_band:
                reads["ambiguous"] += 1
            else:
                reads["none"] += 1
        corpus_reads[label] = reads
        if reads["named"] != counts[label] and reason is None:
            reason = "calibration-refused"
    accepted = reason is None

    limitations = list(args.note)
    named_controls = {button.control for button in buttons}
    missing = sorted(set(controls) - named_controls)
    if missing:
        limitations.append(f"no-calibrated-buttons-for:{','.join(missing)}")

    output = {
        "schema": SCHEMA,
        "schema_version": 1,
        "status": "calibrated" if accepted else "refuse",
        "reason": None if accepted else reason,
        "fact": {
            "id": "cameraSelected",
            "labels": controls,
            "unknown_reasons": UNKNOWN_REASONS,
        },
        "sensor": {
            "id": args.sensor_id,
            "geometry": [WIDTH, HEIGHT],
            "sampling": "pixel-watch-native-2400x1080",
            "profile_id": args.profile_id,
        },
        "adapter": {
            "buttons": [button.record() for button in buttons],
            "minimum_margin": args.min_margin,
            "calibration_frames": sum(counts.values()),
            "class_counts": counts,
            "corpus_reads": corpus_reads,
            "limitations": limitations,
        },
    }
    destination = pathlib.Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "status": output["status"], "reason": output["reason"],
        "buttons": len(buttons),
        "margins": [button.separation_margin for button in buttons],
        "output": str(destination),
    }, sort_keys=True))
    if not accepted and args.strict:
        raise SystemExit(1)

def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    _MC.add_common_arguments(parser, SENSOR_ID, PROFILE_ID)
    parser.add_argument("labelled", nargs="+", metavar="CAM:N=PATH")
    args = parser.parse_args(argv)
    if args.min_margin < 0:
        parser.error("--min-margin must be non-negative")
    try:
        calibrate(args)
    except CalibrationError as error:
        parser.error(str(error))

if __name__ == "__main__":
    main()
