#!/usr/bin/env python3
"""Pull the most *different* frames out of a run and tile them into one sheet.

Reading a night meant scrubbing video or guessing at timestamps, so nobody did
it. The one time the frames were actually looked at, the whole failure was
obvious at a glance: a restart card, the death static and the "Take cake to the
children" minigame, sitting inside an interval that had been reported as 163
seconds of survival. Everything needed to catch that was on disk for hours.

This is deliberately not `find-events.py`. That locates *moments of change* --
overlays, flips, jumpscares -- and answers "when did something happen". This
answers "what did this run contain", which is a different question: it picks a
small set of frames that are maximally unlike each other, so a screen that
persists for a minute contributes one tile and a screen that flashes once still
gets its own. A run that only ever shows office/cameras produces a boring sheet.
That is the point -- the interesting ones stop being boring.

Selection is farthest-point: start from the first frame, then repeatedly take
the frame whose nearest already-chosen neighbour is furthest away. That is a
diversity sample, not a change detector, and it cannot be fooled by a long
static tail the way "biggest successive difference" can.

Usage: keyframes.py VIDEO [--count 12] [--fps 2] [--out sheet.png]
"""
import argparse
import subprocess
import sys
from pathlib import Path

import framesource

# Small enough that the distance metric is about layout and brightness rather
# than film grain, which is what makes static and a dark office separable.
FW, FH = 32, 18
# What the tiles are rendered at.
TW, TH = 480, 216


def decode(path, fps, w, h, pix, depth):
    """Yield frames so full-night contact-sheet generation stays bounded."""
    yield from framesource.frames(str(path), f"fps={fps},scale={w}:{h}", pix, w * h * depth)


def distance(a, b):
    return sum((x - y) * (x - y) for x, y in zip(a, b))


def farthest_point(features, count):
    """Greedy max-min. Deterministic: always starts at the first frame."""
    chosen = [0]
    nearest = [distance(f, features[0]) for f in features]
    while len(chosen) < min(count, len(features)):
        pick = max(range(len(features)), key=lambda i: nearest[i])
        if nearest[pick] == 0:
            break                      # everything left duplicates something chosen
        chosen.append(pick)
        for i, f in enumerate(features):
            d = distance(f, features[pick])
            if d < nearest[i]:
                nearest[i] = d
    return sorted(chosen)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--count", type=int, default=12)
    p.add_argument("--fps", type=float, default=2.0)
    p.add_argument("--out", default=None, help="default: alongside the video")
    p.add_argument("--brighten", type=float, default=2.2,
                   help="the office is nearly black; without this half the sheet reads as blank")
    a = p.parse_args()

    video = Path(a.video)
    small = list(decode(video, a.fps, FW, FH, "gray", 1))
    if not small:
        print(f"{video}: no frames", file=sys.stderr)
        raise SystemExit(2)
    picks = farthest_point([list(f) for f in small], a.count)

    try:
        from PIL import Image, ImageDraw
    except ImportError:
        # Still useful without Pillow: say which timestamps to look at.
        print(f"{video}: {len(small)} frames at {a.fps} fps; most different at")
        for i in picks:
            print(f"  {i / a.fps:7.1f}s")
        print("(install Pillow for the contact sheet)")
        return

    # Decode the display pass again, but retain only the twelve selected frames
    # rather than every 480x216 RGB frame from the night.
    wanted = set(picks)
    tiles = {i: frame for i, frame in enumerate(decode(video, a.fps, TW, TH, "rgb24", 3))
             if i in wanted}
    cols = 3
    rows = (len(picks) + cols - 1) // cols
    sheet = Image.new("RGB", (TW * cols, TH * rows), (12, 12, 12))
    draw = ImageDraw.Draw(sheet)
    for n, i in enumerate(picks):
        if i not in tiles:
            continue
        im = Image.frombytes("RGB", (TW, TH), tiles[i])
        if a.brighten != 1.0:
            im = im.point(lambda v: min(255, int(v * a.brighten)))
        x, y = (n % cols) * TW, (n // cols) * TH
        sheet.paste(im, (x, y))
        label = f"{i / a.fps:.1f}s"
        draw.rectangle([x + 2, y + 2, x + 2 + 8 * len(label), y + 14], fill=(0, 0, 0))
        draw.text((x + 4, y + 3), label, fill=(255, 220, 90))

    out = Path(a.out) if a.out else video.with_name(video.stem + "-keyframes.png")
    sheet.save(out)
    print(f"{video}: {len(small)} frames at {a.fps} fps, {len(picks)} kept")
    print(f"  timestamps: " + " ".join(f"{i / a.fps:.1f}s" for i in picks))
    print(f"  sheet: {out}")


if __name__ == "__main__":
    main()
