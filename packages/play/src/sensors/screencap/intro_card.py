#!/usr/bin/env python3
"""Recognise a story-night intro card, without guessing which night it names.

The real calibration material is a 1280x576 ``screenrecord`` capture, while
the live lifecycle observer normally reads a 2400x1080 ``screencap``.  Every
box in this classifier is therefore fractional.  The signal is the measured
conjunction from Plan 13, not merely "bright text in the middle":

* bright glyphs in the central ``12:00 AM / Nth Night`` band;
* a black top quarter;
* a smooth central field; and
* no coloured 6 AM confetti.

The last condition matters now that a real 6 AM capture exists: the clock band,
black background, and roughness alone also match that win screen.  A positive
result is only ``state=intro``.  Reading ``1st`` versus ``2nd`` has no fixture
coverage and is deliberately outside this classifier.

    intro_card.py FRAME.png [--model MODEL] [--verbose]
    screencap -p | intro_card.py

Unknown inputs print ``unknown=<reason>`` and exit 3.
"""
import argparse
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_SCHEMA = "intro-card-model-v1"
DEFAULT_MODEL = os.path.join(HERE, "..", "..", "..", "profiles", "fnaf2", "moto-g56", "intro-card-moto-g56-v207.json")


def load_model(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            model = json.load(handle)
    except (OSError, ValueError) as exc:
        raise ValueError("intro-model-unreadable") from exc
    if model.get("schema") != MODEL_SCHEMA:
        raise ValueError(f"intro-model-schema:{model.get('schema')}")
    return model


def _box(im, fraction):
    w, h = im.size
    x0, y0, x1, y1 = fraction
    return (int(x0 * w), int(y0 * h), max(int(x1 * w), int(x0 * w) + 1),
            max(int(y1 * h), int(y0 * h) + 1))


def _bright_fraction(im, box, bright_min):
    pixels = list(im.crop(_box(im, box)).getdata())
    return sum(1 for r, g, b in pixels if min(r, g, b) > bright_min) / len(pixels)


def _roughness(im, box):
    crop = im.crop(_box(im, box)).convert("L")
    px = crop.load()
    w, h = crop.size
    total = count = 0
    for y in range(h - 1):
        for x in range(w):
            total += abs(px[x, y] - px[x, y + 1])
            count += 1
    return total / max(count, 1)


def _confetti_percent(im, upper_fraction, sample_step):
    """Match lifecycle-observe's measured saturated-colour signal."""
    w, h = im.size
    px = im.load()
    saturated = count = 0
    for y in range(0, int(upper_fraction * h), sample_step):
        for x in range(0, w, sample_step):
            r, g, b = px[x, y]
            count += 1
            saturated += max(r, g, b) > 70 and max(r, g, b) - min(r, g, b) > 50
    return 100 * saturated / max(count, 1)


def measure(image, model):
    im = image.convert("RGB")
    boxes = model["boxes"]
    return {
        "textbox": _bright_fraction(im, boxes["textbox"], model["bright_min"]),
        "outer": _bright_fraction(im, boxes["outer"], model["bright_min"]),
        "rough": _roughness(im, boxes["rough"]),
        "confetti": _confetti_percent(im, model["confetti_upper_fraction"],
                                       model["confetti_sample_step"]),
    }


def classify(image, model):
    """Return ``(is_intro, reason, metrics)``; all negatives remain unknown."""
    values = measure(image, model)
    th = model["thresholds"]
    if values["confetti"] >= th["confetti_min"]:
        return False, "win-confetti-present", values
    if values["textbox"] < th["textbox_min"]:
        return False, "intro-text-absent", values
    if values["outer"] > th["outer_max"]:
        return False, "intro-outer-field-lit", values
    if values["rough"] > th["rough_max"]:
        return False, "intro-field-not-smooth", values
    return True, None, values


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("frame", nargs="?", help="PNG/JPEG frame; stdin if omitted")
    parser.add_argument("--model", default=os.environ.get("INTRO_CARD_MODEL", DEFAULT_MODEL))
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)
    try:
        model = load_model(args.model)
    except ValueError as exc:
        print(f"unknown={exc}")
        return 3
    try:
        image = Image.open(args.frame if args.frame else sys.stdin.buffer)
        positive, reason, values = classify(image, model)
    except (OSError, ValueError, KeyError, TypeError):
        print("unknown=frame-or-model-unreadable")
        return 3
    if args.verbose:
        print("  " + "  ".join(f"{name}={value:.4f}" for name, value in values.items()),
              file=sys.stderr)
    if positive:
        print("state=intro")
        return 0
    print(f"unknown={reason}")
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
