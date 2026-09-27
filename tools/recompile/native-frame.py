#!/usr/bin/env python3
"""Rebuild frames at the phone's native frame size, and their distance to phone frames.

The Cue Helper's MediaProjection frame is 2400x1080 landscape
(tools/device/native-frame.mjs), and the build-296 games run Display Mode FULL:
the 1024x768 frame is stretched to fill it, x2.34375 across and x1.40625 down
(tools/device/models/controls-fnaf4-moto-g56-v204.json states the rule; FNaF 2's
phone frames show the same fill). The phone magnifies game-resolution content
with bilinear filtering: in a 300 x 100 crop of a native title frame around
"Continue" (artifacts/campaign-2026-09-20T01-45-14.223Z, local) no two adjacent
columns repeat and glyph edges are ramps, where a nearest-neighbour stretch
would repeat each game column two or three times. GLRenderer is native code, so whether it filters
per sprite or once for the whole frame is not in the dex; `compare` measures
what is left.

  # the harness's CHOWDREN_SNAP frames -> native-size PNGs
  python3 tools/recompile/native-frame.py scale --out DIR SNAP.ppm [...]
  # per-rectangle distance between a native rebuild frame and a phone frame
  python3 tools/recompile/native-frame.py compare REBUILD.png PHONE.png \\
      --rect name:x0,y0,x1,y1 [...]

Frames are game art: write them outside the repository (the scratchpad, or
~/fnaf-apks). Only the numbers `compare` prints may be recorded.
"""
import argparse
import json
import os
import sys

from PIL import Image

NATIVE = (2400, 1080)
GAME = (1024, 768)


def scale(path, size=NATIVE):
    im = Image.open(path).convert('RGB')
    if im.size != GAME:
        raise SystemExit('%s: expected a %dx%d game frame, got %dx%d' % ((path,) + GAME + im.size))
    return im.resize(size, Image.BILINEAR)


def rect_stats(a, b, box):
    ca, cb = a.crop(box), b.crop(box)
    pa, pb = ca.load(), cb.load()
    w, h = ca.size
    total = 0
    worst = 0
    for y in range(h):
        for x in range(w):
            d = sum(abs(pa[x, y][k] - pb[x, y][k]) for k in range(3))
            total += d
            worst = max(worst, d)
    n = w * h * 3
    return {'meanAbs': round(total / n, 3), 'maxAbsSum': worst, 'pixels': w * h}


def parse_rect(text):
    name, coords = text.split(':', 1)
    box = tuple(int(v) for v in coords.split(','))
    if len(box) != 4 or box[2] <= box[0] or box[3] <= box[1]:
        raise SystemExit('bad --rect %r: name:x0,y0,x1,y1' % text)
    return name, box


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('scale')
    s.add_argument('--out', required=True)
    s.add_argument('frames', nargs='+')
    c = sub.add_parser('compare')
    c.add_argument('rebuild')
    c.add_argument('phone')
    c.add_argument('--rect', action='append', default=[])
    args = ap.parse_args()
    if args.cmd == 'scale':
        os.makedirs(args.out, exist_ok=True)
        for path in args.frames:
            out = os.path.join(args.out, os.path.splitext(os.path.basename(path))[0] + '-native.png')
            scale(path).save(out)
            print(out)
        return
    a = Image.open(args.rebuild).convert('RGB')
    b = Image.open(args.phone).convert('RGB')
    if a.size != NATIVE or b.size != NATIVE:
        raise SystemExit('compare wants two %dx%d frames, got %s and %s' % (NATIVE + (a.size, b.size)))
    rects = [parse_rect(r) for r in args.rect] or [('frame', (0, 0) + NATIVE)]
    json.dump({name: rect_stats(a, b, box) for name, box in rects}, sys.stdout, indent=1)
    print()


if __name__ == '__main__':
    main()
