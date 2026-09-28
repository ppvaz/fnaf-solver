#!/usr/bin/env python3
"""Fit an RGBA cutout to a sprite's size, for the runtime's CHOWDREN_IMAGE_OVERRIDE.

The rebuilt runtime (sprite-override.patch, beside this script) takes an image's
pixels from a PNG when CHOWDREN_IMAGE_OVERRIDE=<id>=<png> names it. A PNG of
exactly the image's width and height is copied as it is; this script writes one.

    sprite-override.py CUTOUT --out OUT.png (--size WxH | --assets FILE --target ID)
        [--base PNG | --assets FILE --base-image ID] [--box X,Y,W,H | --box diff]
        [--fit contain|height] [--gain G | --gain R,G,B] [--image-count N]

The cutout is trimmed to its visible pixels, scaled with premultiplied alpha
into the box (default: the whole sprite) and anchored at the box's bottom
centre. `--fit contain` (default) keeps it inside the box; `--fit height` makes
it as tall as the box, centred on it, and lets it overhang the box's sides (the
sprite's edges still clip it). Without a base the rest of the sprite is
transparent; with one, the cutout is composited over it, so a sprite that is a
whole scene keeps its scene. `--box diff` is the bounding box of the pixels
where the target differs from the base (both read from Assets.dat).

--assets reads images from a Chowdren Assets.dat (the layout
base/assetfile.cpp reads: IMAGE_COUNT uint16 preload handles, then uint32
image offsets; each image is uint16 w, h, int16 hotspot x, y, action x, y,
uint32 size, then zlib RGBA). --image-count is that build's IMAGE_COUNT
(generated assets.h; 782 for the FNaF 2 build). Nothing read from Assets.dat,
and no image this writes, belongs in the repository.
"""
import argparse
import struct
import sys
import zlib

from PIL import Image, ImageChops


def read_asset_image(path, handle, image_count):
    with open(path, 'rb') as f:
        f.seek(image_count * 2 + handle * 4)
        (offset,) = struct.unpack('<I', f.read(4))
        f.seek(offset)
        w, h, _hx, _hy, _ax, _ay, size = struct.unpack('<HHhhhhI', f.read(16))
        data = zlib.decompress(f.read(size))
    if len(data) != w * h * 4:
        raise SystemExit(f'image {handle}: {len(data)} bytes for {w}x{h}; is --image-count right?')
    return Image.frombytes('RGBA', (w, h), data)


def parse_gain(text):
    parts = [float(v) for v in text.split(',')]
    if len(parts) == 1:
        parts *= 3
    if len(parts) != 3 or min(parts) < 0:
        raise argparse.ArgumentTypeError('gain is G or R,G,B, non-negative')
    return tuple(parts)


def diff_box(a, b, threshold=30):
    """Bounding box (x, y, w, h) of pixels whose RGB differs by more than threshold (sum of channels)."""
    d = ImageChops.difference(a.convert('RGB'), b.convert('RGB'))
    r, g, bl = d.split()
    total = ImageChops.add(ImageChops.add(r, g), bl)  # clipped at 255, enough for a threshold
    mask = total.point(lambda v: 255 if v > threshold else 0)
    bbox = mask.getbbox()
    if bbox is None:
        raise SystemExit('--box diff: the target and the base do not differ')
    return bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]


def fit(cutout, size, box, mode='contain', gain=(1.0, 1.0, 1.0)):
    """The cutout scaled into box (x, y, w, h) of a transparent canvas of size, anchored bottom-centre."""
    cut = cutout.convert('RGBA')
    trim = cut.getchannel('A').getbbox()
    if trim is None:
        raise SystemExit('the cutout has no visible pixels')
    cut = cut.crop(trim)
    if gain != (1.0, 1.0, 1.0):
        bands = [c.point(lambda v, k=k: min(255, int(v * k + 0.5))) for c, k in zip(cut.split()[:3], gain)]
        cut = Image.merge('RGBA', bands + [cut.getchannel('A')])
    bx, by, bw, bh = box
    if mode == 'height':
        scale = bh / cut.height
    else:
        scale = min(bw / cut.width, bh / cut.height)
    w, h = max(1, round(cut.width * scale)), max(1, round(cut.height * scale))
    scaled = cut.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')
    x, y = bx + (bw - w) // 2, by + bh - h
    layer = Image.new('RGBA', size, (0, 0, 0, 0))
    layer.paste(scaled, (x, y))
    return layer, (x, y, w, h)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('cutout', help='RGBA PNG; its transparent margin is trimmed')
    ap.add_argument('--out', required=True, help='PNG to write (keep it outside the repository)')
    ap.add_argument('--size', help='sprite size WxH (else --target reads it)')
    ap.add_argument('--assets', help='a Chowdren Assets.dat, for --target, --base-image and --box diff')
    ap.add_argument('--image-count', type=int, default=782, help="the build's IMAGE_COUNT (default 782)")
    ap.add_argument('--target', type=int, help='id of the image being replaced (its size; --box diff)')
    ap.add_argument('--base', help='PNG of the sprite size to composite over')
    ap.add_argument('--base-image', type=int, help='Assets.dat image id to composite over')
    ap.add_argument('--box', help="X,Y,W,H inside the sprite, or 'diff' (default: the whole sprite)")
    ap.add_argument('--fit', choices=('contain', 'height'), default='contain')
    ap.add_argument('--gain', type=parse_gain, default=(1.0, 1.0, 1.0), help='multiply the cutout colour: G or R,G,B')
    args = ap.parse_args(argv)

    if (args.target is not None or args.base_image is not None) and not args.assets:
        ap.error('--target and --base-image read from --assets')
    target = read_asset_image(args.assets, args.target, args.image_count) if args.target is not None else None
    if args.base and args.base_image is not None:
        ap.error('--base and --base-image are alternatives')
    base = None
    if args.base:
        base = Image.open(args.base).convert('RGBA')
    elif args.base_image is not None:
        base = read_asset_image(args.assets, args.base_image, args.image_count)

    if args.size:
        try:
            size = tuple(int(v) for v in args.size.lower().split('x'))
            assert len(size) == 2 and min(size) > 0
        except (ValueError, AssertionError):
            ap.error('--size is WxH')
    elif target is not None:
        size = target.size
    elif base is not None:
        size = base.size
    else:
        ap.error('give --size, or --assets with --target')
    if base is not None and base.size != size:
        ap.error(f'the base is {base.size[0]}x{base.size[1]}, the sprite {size[0]}x{size[1]}')

    if args.box is None:
        box = (0, 0) + size
    elif args.box == 'diff':
        if target is None or base is None:
            ap.error('--box diff needs --target and a base')
        box = diff_box(target, base)
    else:
        try:
            box = tuple(int(v) for v in args.box.split(','))
            assert len(box) == 4 and box[2] > 0 and box[3] > 0
        except (ValueError, AssertionError):
            ap.error('--box is X,Y,W,H or diff')

    layer, placed = fit(Image.open(args.cutout), size, box, args.fit, args.gain)
    out = layer if base is None else Image.alpha_composite(base, layer)
    out.save(args.out)
    print(f'{args.out}: {size[0]}x{size[1]}, box {box[0]},{box[1]},{box[2]},{box[3]}, '
          f'cutout at {placed[0]},{placed[1]} size {placed[2]}x{placed[3]}'
          f'{", over a base" if base is not None else ""}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
