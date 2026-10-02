#!/usr/bin/env python3
"""Pack the text faces the Android runtime draws with, for the rebuilt runtime.

Build 296's font bank names Consolas and Tahoma (heights -13 to -43). The APK
ships no font files, so CFontInfo.createFont finds neither on the device and
falls back to Typeface.create(name, style): the platform sans-serif, Roboto.
The runtime then draws at TextPaint.setTextSize(|lfHeight|) pixels (CFont.load
negates a negative height). Chowdren instead drew every text with the one font
it packed, SmallFonts, at the nearest of its sizes: the tiny, misplaced "Night"
label on the title.

This writes Chowdren's font bank format (chowdren/fontgen.py: per font a
uint16 pixel size, uint16 flags, float width/height/ascender/descender and
glyphs with box, advance, bitmap corner and 8-bit coverage) from Roboto TTFs
held OUTSIDE the repository, at the pixel sizes the bank uses. Anti-aliased,
as Android renders text.

  python3 packages/source/recompile/make-android-fonts.py --regular Roboto-Regular.ttf \\
      --bold Roboto-Bold.ttf --out <anaconda>/Chowdren/fonts/AndroidSans.dat \\
      --sizes 13,16,21,24,32,43 --bold-sizes 43

No font data enters the repository; the .dat is a build input next to the
converter.
"""
import argparse
import struct

from PIL import ImageFont

CHARSET = [chr(c) for c in range(32, 127)] + ['©', 'é']
BOLD = 1


def font_bytes(path: str, size: int, bold: bool) -> bytes:
    font = ImageFont.truetype(path, size)
    ascent, descent = font.getmetrics()
    glyphs = []
    max_advance = 0.0
    for ch in CHARSET:
        mask, (ox, oy) = font.getmask2(ch, mode='L')
        w, h = mask.size
        advance = font.getlength(ch)
        max_advance = max(max_advance, advance)
        if w == 0 or h == 0:
            if ch != ' ':
                continue
            w = h = 0
        # FreeType convention, y up from the baseline: the bitmap's top-left
        # corner and the glyph box. PIL's origin is the line's ascender.
        corner_x = float(ox)
        corner_y = float(ascent - oy)
        x1, y1, x2, y2 = corner_x, corner_y - h, corner_x + w, corner_y
        data = bytes(mask) if w and h else b''
        glyphs.append(struct.pack('<I8f2I', ord(ch), x1, y1, x2, y2, advance, 0.0,
                                  corner_x, corner_y, w, h) + data)
    header = struct.pack('<HHffffI', size, BOLD if bold else 0, max_advance,
                         float(ascent + descent), float(ascent), float(-descent), len(glyphs))
    return header + b''.join(glyphs)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--regular', required=True)
    ap.add_argument('--bold', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--sizes', default='13,16,21,24,32,43')
    ap.add_argument('--bold-sizes', default='43')
    args = ap.parse_args()
    fonts = [font_bytes(args.regular, int(s), False) for s in args.sizes.split(',')]
    fonts += [font_bytes(args.bold, int(s), True) for s in args.bold_sizes.split(',')]
    with open(args.out, 'wb') as fp:
        fp.write(struct.pack('<I', len(fonts)))
        for f in fonts:
            fp.write(f)
    print('%s: %d fonts' % (args.out, len(fonts)))


if __name__ == '__main__':
    main()
