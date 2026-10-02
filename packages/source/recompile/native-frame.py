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
from typing import cast

from PIL import Image

NATIVE = (2400, 1080)
GAME = (1024, 768)


def scale(path: str, size: tuple[int, int] = NATIVE) -> Image.Image:
    im = Image.open(path).convert('RGB')
    if im.size != GAME:
        raise SystemExit('%s: expected a %dx%d game frame, got %dx%d' % ((path,) + GAME + im.size))
    return im.resize(size, Image.Resampling.BILINEAR)


BRIGHT = 200  # luma (PIL 'L', ITU-R 601-2) above which a pixel counts as glyph
RGB = tuple[int, int, int]


def rect_stats(a: Image.Image, b: Image.Image, box: tuple[int, int, int, int]) -> dict[str, float | int | None]:
    ca, cb = a.crop(box), b.crop(box)
    pa, pb = ca.load(), cb.load()
    la, lb = ca.convert('L').load(), cb.convert('L').load()
    assert pa is not None and pb is not None and la is not None and lb is not None  # load() of an image in memory
    w, h = ca.size
    total = 0
    worst = 0
    both = either = 0
    for y in range(h):
        for x in range(w):
            # An RGB image's pixel is its three channels; an 'L' image's is its luma.
            d = sum(abs(cast(RGB, pa[x, y])[k] - cast(RGB, pb[x, y])[k]) for k in range(3))
            total += d
            worst = max(worst, d)
            ba, bb = cast(int, la[x, y]) > BRIGHT, cast(int, lb[x, y]) > BRIGHT
            both += ba and bb
            either += ba or bb
    n = w * h * 3
    # meanAbs includes whatever lies behind a label (the title's static is random per frame);
    # brightIoU compares only the glyph masks, so it measures geometry and filtering.
    return {'meanAbs': round(total / n, 3), 'maxAbsSum': worst, 'pixels': w * h,
            'brightIoU': round(both / either, 4) if either else None}


def sha256(path: str) -> str:
    import hashlib
    with open(path, 'rb') as fp:
        return hashlib.sha256(fp.read()).hexdigest()


def parse_rect(text: str) -> tuple[str, tuple[int, int, int, int]]:
    name, coords = text.split(':', 1)
    box = tuple(int(v) for v in coords.split(','))
    if len(box) != 4 or box[2] <= box[0] or box[3] <= box[1]:
        raise SystemExit('bad --rect %r: name:x0,y0,x1,y1' % text)
    return name, (box[0], box[1], box[2], box[3])


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    s = sub.add_parser('scale')
    s.add_argument('--out', required=True)
    s.add_argument('frames', nargs='+')
    c = sub.add_parser('compare')
    c.add_argument('rebuild')
    c.add_argument('phone')
    c.add_argument('--rect', action='append', default=[])
    c.add_argument('--out', help='write a content-free record: frame hashes, rectangles, numbers')
    c.add_argument('--note', default='')
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
    stats = {name: rect_stats(a, b, box) for name, box in rects}
    json.dump(stats, sys.stdout, indent=1)
    print()
    if args.out:
        record = {
            'schema': 'fnaf2-native-frame-compare-v1',
            'claimLevel': 'MODEL_ONLY',
            'fidelity': 'rebuilt-runtime',
            'note': args.note,
            'rebuildFrameSha256': sha256(args.rebuild),
            'phoneFrameSha256': sha256(args.phone),
            'size': list(NATIVE),
            'brightLuma': BRIGHT,
            'rects': {name: list(box) for name, box in rects},
            'stats': stats,
            'toolSha256': sha256(os.path.abspath(__file__)),
        }
        with open(args.out, 'w') as fp:
            json.dump(record, fp, indent=1)
            fp.write('\n')


if __name__ == '__main__':
    main()
