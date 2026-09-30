#!/usr/bin/env python3
"""Generate synthetic intro-card decision fixtures and a deliberately wide model.

The fixtures prove conjunction and refusal behavior, not device thresholds or
night-number recognition.  Real threshold evidence is recorded in
``models/intro-card-moto-g56-v207.json``; no generated file is a device model.

    python3 make-intro-card-fixture.py OUTDIR
"""
import json
import os
import sys

from PIL import Image, ImageDraw

GEOMETRY = (640, 288)


def base():
    return Image.new("RGB", GEOMETRY, (1, 1, 1))


def text(image):
    draw = ImageDraw.Draw(image)
    # Thin, wide-spanning glyph strokes inside the central text box.
    for x in range(240, 400, 8):
        draw.rectangle((x, 125, x + 2, 133), fill=(255, 255, 255))


def coloured_confetti(image):
    draw = ImageDraw.Draw(image)
    colours = ((240, 40, 40), (40, 230, 70), (50, 70, 240), (240, 220, 40))
    for i in range(16):
        x = 20 + (i * 37) % 590
        y = 10 + (i * 23) % 95
        draw.rectangle((x, y, x + 3, y + 3), fill=colours[i % len(colours)])


def noisy_field(image):
    px = image.load()
    state = 71
    for y in range(29, 259):
        for x in range(64, 576):
            state = (state * 1103515245 + 12345) & 0x7fffffff
            value = (state >> 16) % 18
            px[x, y] = (value, value, value)


def render():
    intro = base(); text(intro)
    sixam = intro.copy(); coloured_confetti(sixam)
    fade = base()
    cutscene = base(); noisy_field(cutscene); text(cutscene)
    ImageDraw.Draw(cutscene).rectangle((0, 10, 639, 24), fill=(220, 220, 220))
    office = base()
    ImageDraw.Draw(office).rectangle((0, 18, 639, 36), fill=(220, 220, 220))
    return {"intro": intro, "sixam": sixam, "fade": fade,
            "cutscene": cutscene, "office": office}


def main(argv):
    if len(argv) != 1:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        return 2
    outdir = argv[0]
    os.makedirs(outdir, exist_ok=True)
    for name, image in render().items():
        image.save(os.path.join(outdir, f"{name}.png"))
    model = {
        "schema": "intro-card-model-v1",
        "build": "synthetic-fixture -- NOT a device model",
        "bright_min": 150,
        "boxes": {"textbox": [0.36, 0.36, 0.64, 0.60],
                  "outer": [0.0, 0.0, 1.0, 0.25],
                  "rough": [0.1, 0.1, 0.9, 0.9]},
        "confetti_upper_fraction": 0.45,
        "confetti_sample_step": 3,
        "thresholds": {"textbox_min": 0.04, "outer_max": 0.01,
                       "rough_max": 1.0, "confetti_min": 0.02}
    }
    with open(os.path.join(outdir, "synthetic-intro-model.json"), "w",
              encoding="utf-8") as handle:
        json.dump(model, handle, indent=2)
        handle.write("\n")
    print("5 synthetic lifecycle frames and one synthetic intro model")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
