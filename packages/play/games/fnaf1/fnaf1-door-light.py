#!/usr/bin/env python3
"""Calibrate and read a FNaF 1 door-light occupancy sensor.

The FNaF 1 runner obtains its first lit-door frames during the harmless early
part of a story night.  It does not import a FNaF 2 ROI, nor does it turn a
dark frame into an empty doorway: it derives the illuminated cells from that
run's off/on pair, measures the normal frame-to-frame variation, and returns
``ambiguous`` between the two calibrated bands.

Both commands accept only native ``screencap-2400x1080`` PNGs through
``sensor.open_frame``:

  fnaf1-door-light.py calibrate --side left --off OFF.png --on ON.png \
      [--on ON2.png ...] --out MODEL.json
  fnaf1-door-light.py score --model MODEL.json --frame LIT.png

The model is an ephemeral run artifact.  It records hashes and the exact
native reference frame used by the reader; it is not a portable claim that a
different game build, display mode, or capture sensor has the same pixels.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import sys
from pathlib import Path

from PIL import ImageStat

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(Path(__file__).resolve().parent / "../../src/sensors/screencap"))  # Play's screencap readers
from sensor import NATIVE, SensorMismatch, open_frame  # noqa: E402

SCHEMA = "fnaf1-door-light-model-v1"
GEOMETRY = (2400, 1080)
CELL_W = 120
CELL_H = 90
PIXEL_DELTA = 30


def fail(reason: str, code: int = 3) -> None:
    print(json.dumps({"status": "UNKNOWN", "reason": reason}, sort_keys=True))
    raise SystemExit(code)


def read(path: str):
    try:
        image, sensor = open_frame(path)
    except SensorMismatch as exc:
        fail(str(exc))
    if image.size != GEOMETRY or sensor != NATIVE:
        fail("sensor-mismatch")
    return image


def digest(path: str) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def bounds_for(side: str):
    # Doorway illumination is on the visible half of the office.  The lower
    # 180 native pixels contain the controls/monitor tab, not the room; the
    # top 60 include HUD/title-like text that cannot say who is at a door.
    return (0, 60, 1200, 900) if side == "left" else (1200, 60, 2400, 900)


def luma_mean(image, box):
    # ImageStat is implemented in Pillow's image core and avoids materializing
    # a 2.6m-pixel Python list for every calibration cell.
    r, g, b = ImageStat.Stat(image.crop(box)).mean
    return (r + g + b) / 3.0


def cells(side: str):
    x0, y0, x1, y1 = bounds_for(side)
    return [(x, y, min(x + CELL_W, x1), min(y + CELL_H, y1))
            for y in range(y0, y1, CELL_H)
            for x in range(x0, x1, CELL_W)]


def frame_score(reference, candidate, selected):
    differing = 0
    total = 0
    mean_delta_sum = 0
    for box in selected:
        a = reference.crop(tuple(box))
        b = candidate.crop(tuple(box))
        for pa, pb in zip(a.getdata(), b.getdata()):
            delta = max(abs(pa[0] - pb[0]), abs(pa[1] - pb[1]), abs(pa[2] - pb[2]))
            mean_delta_sum += delta
            differing += delta > PIXEL_DELTA
            total += 1
    if not total:
        fail("model-has-no-sampled-pixels")
    return differing / total, mean_delta_sum / total


def calibrate(args):
    off = read(args.off)
    ons = [read(path) for path in args.on]
    all_cells = cells(args.side)
    gains = []
    for box in all_cells:
        on_mean = statistics.fmean(luma_mean(image, box) for image in ons)
        gains.append(on_mean - luma_mean(off, box))
    max_gain = max(gains, default=0.0)
    if max_gain < 8.0:
        fail("light-transition-not-visible")

    # The light's useful field is where the on-frame brightened the room.  The
    # threshold is relative to this run's strongest cell plus an absolute
    # floor, so a weak/foreign transition cannot silently nominate arbitrary
    # screen regions.  Keep the 16 strongest qualifying cells: wide enough to
    # include a doorway figure, bounded enough not to turn the entire office
    # animation into the detector.
    gain_floor = max(8.0, max_gain * 0.42)
    selected_with_gain = sorted(
        ((gain, box) for gain, box in zip(gains, all_cells) if gain >= gain_floor),
        reverse=True, key=lambda pair: pair[0])[:16]
    selected = [list(box) for _, box in selected_with_gain]
    if len(selected) < 2:
        fail("light-region-too-small")

    reference = ons[0]
    noise_scores = [frame_score(reference, image, selected)[0] for image in ons[1:]]
    noise = max(noise_scores, default=0.0)
    clear_max = max(0.004, noise + 0.003)
    occupied_min = max(0.015, noise * 3.0 + 0.006)
    if not clear_max < occupied_min:
        fail("no-occupancy-undecided-band")

    document = {
        "schema": SCHEMA,
        "sensor": NATIVE,
        "side": args.side,
        "geometry": list(GEOMETRY),
        "pixelDelta": PIXEL_DELTA,
        "cells": selected,
        "calibration": {
            "off": {"path": str(Path(args.off).resolve()), "sha256": digest(args.off)},
            "on": [{"path": str(Path(path).resolve()), "sha256": digest(path)} for path in args.on],
            "maxIlluminationGain": round(max_gain, 4),
            "selectedGainFloor": round(gain_floor, 4),
            "noiseScores": [round(value, 6) for value in noise_scores],
        },
        "thresholds": {"clearMax": round(clear_max, 6), "occupiedMin": round(occupied_min, 6)},
    }
    Path(args.out).write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "READY", "side": args.side, "cells": len(selected),
                      "clearMax": document["thresholds"]["clearMax"],
                      "occupiedMin": document["thresholds"]["occupiedMin"]}, sort_keys=True))


def score(args):
    try:
        model = json.loads(Path(args.model).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        fail("model-unreadable")
    if model.get("schema") != SCHEMA or model.get("sensor") != NATIVE:
        fail("model-schema-or-sensor")
    if model.get("geometry") != list(GEOMETRY):
        fail("model-geometry")
    cells_value = model.get("cells")
    if not isinstance(cells_value, list) or not cells_value:
        fail("model-cells")
    try:
        cells_checked = [list(map(int, box)) for box in cells_value]
        reference_path = model["calibration"]["on"][0]["path"]
        clear_max = float(model["thresholds"]["clearMax"])
        occupied_min = float(model["thresholds"]["occupiedMin"])
    except (KeyError, TypeError, ValueError):
        fail("model-incomplete")
    if not clear_max < occupied_min:
        fail("model-no-undecided-band")
    reference = read(reference_path)
    candidate = read(args.frame)
    changed, mean_delta = frame_score(reference, candidate, cells_checked)
    state = "clear" if changed <= clear_max else "occupied" if changed >= occupied_min else "ambiguous"
    print(json.dumps({"status": "READY", "state": state, "changedFraction": round(changed, 6),
                      "meanDelta": round(mean_delta, 4), "clearMax": clear_max,
                      "occupiedMin": occupied_min}, sort_keys=True))


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    calibration = commands.add_parser("calibrate")
    calibration.add_argument("--side", choices=("left", "right"), required=True)
    calibration.add_argument("--off", required=True)
    calibration.add_argument("--on", action="append", required=True)
    calibration.add_argument("--out", required=True)
    calibration.set_defaults(handler=calibrate)
    reader = commands.add_parser("score")
    reader.add_argument("--model", required=True)
    reader.add_argument("--frame", required=True)
    reader.set_defaults(handler=score)
    args = parser.parse_args(argv)
    args.handler(args)


if __name__ == "__main__":
    main(sys.argv[1:])
