#!/usr/bin/env python3
"""Rebuild the launcher icon assets from a single source render.

Adaptive-icon geometry, so the numbers live where something reads them
instead of in a comment:

  108dp  full adaptive canvas (both layers are drawn at this size)
   16dp  inset applied by res/drawable/companion_icon_foreground.xml,
         leaving the artwork in the central 76dp
   72dp  the region a launcher actually shows, masked to its own shape
   66dp  the shape-independent safe zone

The artwork is therefore drawn at 76dp against a 72dp visible circle: it is
full-bleed by construction, and only the extreme corners are ever clipped.

Usage: ./make-icon.py <source.png>
"""
import sys
from pathlib import Path
from PIL import Image

FOREGROUND_PX = 512   # drawn into 76dp; 512 leaves headroom for large surfaces
LEGACY_PX = 192       # xxxhdpi launcher icon (48dp @ 4x), pre-API-26 path

HERE = Path(__file__).parent
TARGETS = [
    (HERE / "res/drawable-nodpi/companion_icon_foreground_bitmap.png", FOREGROUND_PX),
    (HERE / "res/mipmap-xxxhdpi/companion_icon_legacy.png", LEGACY_PX),
]


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.strip())
        return 2
    src_path = Path(sys.argv[1]).expanduser()
    src = Image.open(src_path).convert("RGB")
    if src.width != src.height:
        print(f"refusing: source is {src.width}x{src.height}, must be square")
        return 1

    print(f"source {src_path.name}: {src.width}x{src.height}, "
          f"{src_path.stat().st_size / 1024:.0f} KiB")
    for out, px in TARGETS:
        before = out.stat().st_size if out.exists() else 0
        src.resize((px, px), Image.Resampling.LANCZOS).save(out, "PNG", optimize=True)
        after = out.stat().st_size
        print(f"  {out.relative_to(HERE)}: {px}x{px}, "
              f"{before / 1024:.0f} -> {after / 1024:.0f} KiB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
