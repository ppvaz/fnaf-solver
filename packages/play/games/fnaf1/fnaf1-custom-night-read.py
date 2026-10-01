#!/usr/bin/env python3
"""Read FNaF 1's four Custom Night dials off one native frame, or refuse.

    fnaf1-custom-night-read.py --model MODEL [--frame PATH] < frame.png

Prints one JSON line and exits 0 (PASS), 3 (UNKNOWN: refuse) or 2 (usage/IO):

    {"status": "PASS", "screen": "custom-night", "dials": {"freddy": 1, ...},
     "masks": {"freddy": "<sha256>", ...}}

The screen gate comes first. The eight arrow boxes are drawn in one flat grey
(67,67,67 on the calibrated handset); the title's static and the office never
hold a flat grey field, so a frame whose boxes are not that grey is not this
screen, whatever its bright pixels say.

Each dial's readback box is then binarised at the white the counter is drawn
in and hashed. The Custom Night screen has no static -- settled captures are
pixel-identical -- so a value renders to the same mask every time, and the
model's glyph table maps each hash seen during a device sweep to the value the
sweep put there. A hash the table does not hold is UNKNOWN, never the nearest
value: this reader only reads states it has seen exactly, on the geometry it
was calibrated on. The masks are reported even without a glyph table, which is
how `fnaf1-menu-probe.ts` proves each press moved exactly one dial.
"""
import argparse
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "../../src/sensors/screencap"))  # Play's screencap readers
from sensor import open_frame, SensorMismatch  # noqa: E402

SCHEMA = "fnaf1-custom-night-model-v1"
WHITE_MIN = 150
DIALS = ("freddy", "bonnie", "chica", "foxy")


def emit(status, code, **fields):
    print(json.dumps({"status": status, **fields}, sort_keys=True))
    return code


def load_model(path):
    with open(path, "r", encoding="utf-8") as handle:
        model = json.load(handle)
    if model.get("schema") != SCHEMA:
        raise ValueError(f"model schema is {model.get('schema')!r}, not {SCHEMA}")
    if tuple(model.get("dials", {})) != DIALS:
        raise ValueError("model does not name the four dials in screen order")
    return model


def gate_fraction(image, model):
    """Fraction of arrow-box interior pixels (glyph rectangle excluded) that
    are the flat box grey."""
    gate = model["screenGate"]
    grey, tol = gate["grey"], gate["tolerance"]
    pixels = image.load()
    hits = total = 0
    for dial in model["dials"].values():
        for key in ("decrementBox", "incrementBox"):
            x, y, w, h = dial[key]
            cx, cy = x + w // 2, y + h // 2
            for py in range(y + 4, y + h - 4, 2):
                for px in range(x + 4, x + w - 4, 2):
                    if abs(px - cx) < 24 and abs(py - cy) < 28:
                        continue  # the glyph and its antialiasing
                    total += 1
                    r, g, b = pixels[px, py]
                    if (abs(r - grey[0]) <= tol and abs(g - grey[1]) <= tol
                            and abs(b - grey[2]) <= tol):
                        hits += 1
    return hits / total if total else 0.0


def dial_mask(image, box):
    x, y, w, h = box
    crop = image.crop((x, y, x + w, y + h))
    bits = bytearray()
    acc = count = 0
    for r, g, b in crop.getdata():
        acc = (acc << 1) | (1 if min(r, g, b) > WHITE_MIN else 0)
        count += 1
        if count == 8:
            bits.append(acc)
            acc = count = 0
    if count:
        bits.append(acc << (8 - count))
    return hashlib.sha256(bytes(bits)).hexdigest()


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--model", required=True)
    parser.add_argument("--frame")
    args = parser.parse_args(argv)
    try:
        model = load_model(args.model)
    except (OSError, ValueError, KeyError) as error:
        print(f"fnaf1-custom-night-read: {error}", file=sys.stderr)
        return 2
    try:
        source = open(args.frame, "rb") if args.frame else sys.stdin.buffer
        image, _ = open_frame(source)
    except SensorMismatch as error:
        return emit("UNKNOWN", 3, reason=str(error))
    except OSError as error:
        print(f"fnaf1-custom-night-read: {error}", file=sys.stderr)
        return 2

    fraction = gate_fraction(image, model)
    if fraction < model["screenGate"]["minFraction"]:
        return emit("UNKNOWN", 3, reason="not-custom-night", gate=round(fraction, 4))

    masks = {name: dial_mask(image, dial["readback"]["box"])
             for name, dial in model["dials"].items()}
    # One table for all four dials: the sweep measured every value rendering to
    # the same mask on each of them.
    table = (model.get("glyphs") or {}).get("hashes", {})
    dials, unknown = {}, []
    for name, digest in masks.items():
        value = table.get(digest)
        if isinstance(value, int):
            dials[name] = value
        else:
            unknown.append(name)
    if unknown:
        return emit("UNKNOWN", 3, reason="unlearned-mask", screen="custom-night",
                    gate=round(fraction, 4), dials=dials, unknown=unknown, masks=masks)
    return emit("PASS", 0, screen="custom-night", gate=round(fraction, 4),
                dials=dials, masks=masks)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
