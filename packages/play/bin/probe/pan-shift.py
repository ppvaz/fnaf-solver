#!/usr/bin/env python3
"""Horizontal displacement between two office frames, or UNKNOWN.

The office view pans. `camera follow 2` (frame 3, event handle 80) integrates a
velocity into a scroll position clamped to [512, 1088] -- 576 units of travel --
and the night opens at 512, the minimum. Nothing in the event sheet reads that
position, so it gates no game rule; but it moves the vent-light hitboxes, which
are pinned to scene objects, and it costs wall-clock. That makes it an actuator
fact, and actuator facts have to be measured on the phone.

This is the measuring stick: how far did the view move between two frames.

    pan-shift.py before.png after.png     # shift=+312 px  residual=4.11
                                          # UNKNOWN  <reason>            (exit 3)

**It must be able to say it does not know.** The first version of this returned
its own search bound when the office went dark, because the night had ended to
the Puppet mid-measurement and a flat strip has no minimum -- and a bound
printed as a number reads exactly like a measurement. Two refusals now: a strip
with no texture cannot be matched at all, and a best shift sitting on the search
bound is a saturation rather than a displacement. Widen LIMIT if a real panel
travels further; do not read a saturated answer.

Exit 0 with a measurement, 3 with UNKNOWN, 2 on usage error.
"""
import sys
import warnings

warnings.simplefilter("ignore")

GEOMETRY = (2400, 1080)
# The strip: above the HUD bars, below the top-of-frame decorations, and clear
# of the first-run tutorial panel. Downsampled 4x horizontally, so a shift is
# resolved to 4 px.
STRIP = (0, 120, 2400, 300)
COLS, ROWS = 300, 30
SCALE = GEOMETRY[0] // COLS
# A narrow template searched across the whole strip, rather than sliding the
# whole strip against itself. Full-strip SAD loses its overlap exactly when the
# displacement is large, which is when the answer matters most: the first
# version saturated at its own bound on a full traverse and had to be widened
# twice. A template keeps every candidate position equally supported.
TEMPLATE = 60             # downsampled columns, taken from the strip centre
LIMIT = COLS - TEMPLATE   # the largest displacement that can still be located
MIN_STDDEV = 8.0          # below this the strip is flat
AGREE_PX = 48             # two templates must land within this of each other


def refuse(reason):
    print(f"UNKNOWN  {reason}")
    raise SystemExit(3)


def strip(path):
    from PIL import Image, UnidentifiedImageError
    try:
        image = Image.open(path).convert("L")
    except (OSError, UnidentifiedImageError):
        refuse(f"cannot read {path}")
    if image.size != GEOMETRY:
        image = image.resize(GEOMETRY)
    return list(image.crop(STRIP).resize((COLS, ROWS)).getdata())


def stddev(pixels):
    mean = sum(pixels) / len(pixels)
    return (sum((v - mean) ** 2 for v in pixels) / len(pixels)) ** 0.5


def main(argv):
    if len(argv) != 2:
        print("usage: pan-shift.py before.png after.png", file=sys.stderr)
        return 2
    before, after = strip(argv[0]), strip(argv[1])
    for name, pixels in (("reference", before), ("frame", after)):
        spread = stddev(pixels)
        if spread < MIN_STDDEV:
            refuse(f"the {name} strip is flat (stddev {spread:.1f} < {MIN_STDDEV}); "
                   "not a lit office view, or the night has ended")

    # Two templates, from different parts of the strip, that must agree.
    #
    # One template is not enough, and this is measured rather than assumed: at
    # full traverse a single centre template reported a confident `shift=+16 px`
    # three times running, because the content it was tracking had left the
    # strip entirely and the best remaining match was spurious. A displacement
    # both templates independently agree on cannot be that.
    span = COLS - TEMPLATE
    offsets = [span // 4, 3 * span // 4]
    found = []
    for t0 in offsets:
        window = [before[y * COLS + x] for y in range(ROWS) for x in range(t0, t0 + TEMPLATE)]
        if stddev(window) < MIN_STDDEV:
            refuse(f"the template at column {t0} is flat; nothing to locate")
        best = best_value = None
        for shift in range(-t0, COLS - TEMPLATE - t0 + 1):
            total = count = 0
            for y in range(0, ROWS, 2):
                row = y * COLS
                for x in range(t0, t0 + TEMPLATE):
                    total += abs(before[row + x] - after[row + x + shift])
                    count += 1
            value = total / count
            if best_value is None or value < best_value:
                best, best_value = shift, value
        if best <= -t0 or best >= COLS - TEMPLATE - t0:
            refuse(f"the template at column {t0} matched at the search bound "
                   f"({best * SCALE:+d} px); saturated, not measured")
        found.append((best, best_value))
    (s1, r1), (s2, r2) = found
    if abs(s1 - s2) * SCALE > AGREE_PX:
        refuse(f"the two templates disagree ({s1 * SCALE:+d} vs {s2 * SCALE:+d} px); "
               "the tracked content has probably left the strip")
    best = (s1 + s2) // 2
    print(f"shift={best * SCALE:+5d} px  residual={max(r1, r2):.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
