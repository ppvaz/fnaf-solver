#!/usr/bin/env python3
"""Classify an adb screencap: prints night, gameover, or other.

Correction 2026-08-26: the night predicate had a false positive. The "HELP
WANTED" newspaper -- the cutscene FNaF 2 plays when a New Game starts -- read as
`night`, because it is bright everywhere and the flashlight-meter box therefore
clears the > 90 test (measured 154.6 against the office's 165.6). The original
reasoning was sound for every screen it had been shown: a lit meter means the
office. It had simply never been shown a screen that is bright all over, because
no route had ever pressed New Game. plans/13 needs that route for the fresh-save
ladder, so the gap became reachable.

The fix is a global-brightness guard, and it is the safe direction: it can only
take `night` away, never grant it. Measured over every office frame available --
plain, hall lit, vent lit, and under the first-run tutorial overlay -- rows 500
and 700 mean 14.5-35.1, against the newspaper's 112.5. The threshold sits at 80,
roughly a factor of two from either side. The same two scanlines are added to the
--adb-fast path so both paths answer alike; without them the fast path cannot see
global brightness at all.

night = the office HUD is on screen: flashlight meter lit top-left, or the
pink mask bar bottom-left (still visible in the masked view). Title, game
over, jumpscare and static otherwise read "other". `gameover` additionally
requires both the red face and bright lower-center text, avoiding false
positives on a jumpscare or title screen. 2400x1080 landscape.

Correction 2026-09-13: the Custom Night dial screen read as `gameover`. With
every dial at 20 (the Golden Freddy preset) the orange preset arrows and the
red-faced portraits fill the face box (0.078 against the 0.05 floor) and the
white preset name fills the text box (0.142 against 0.08). The runner's
end-of-night watcher pulled the frame trace on that label, 6-8 s before the
night began, on seven of twelve Night 7 runs. The guard is the portrait band:
the game over screen is black above the face (bright fraction 0.000 on all ten
real game overs from Nights 5-6, 2026-09-12/13), while the dial screen's
portraits read 0.215 on all seven captured dial frames. GAMEOVER_TOP_BRIGHT_MAX
sits at 0.05, four times the nearest dial reading below and a decade above the
measured zero. Like the night guard it can only take `gameover` away.

Default mode reads a PNG from stdin. `--adb-fast [timeout]` captures a raw
frame on-device and transfers only ten scanlines used by the night predicate.
That avoids moving a multi-megabyte PNG over USB for every safety-watch poll.
"""
import os
import subprocess
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nightpredicate  # noqa: E402

warnings.simplefilter("ignore")


# The fast path keeps its own arithmetic because it only has twelve scanlines
# to work with, but the threshold and the rule are nightpredicate's.
GLOBAL_BRIGHT_MAX = nightpredicate.GLOBAL_BRIGHT_MAX

# The portrait band of the Custom Night dial screen (x 100-2300, y 40-260),
# bright fraction at max-channel > 120: real game overs 0.000 (n=10), dial
# screens 0.215 (n=7). See the module docstring for the correction record.
GAMEOVER_TOP_BAND = (100, 40, 2300, 260)
GAMEOVER_TOP_BRIGHT_MAX = 0.05

# Device geometry the scanline plan below is expressed in.
DEVICE_W, DEVICE_H = 2400, 1080

# The rule's regions, in the order the fast path fetches rows for them.
RULE_BOXES = (nightpredicate.FLASH, nightpredicate.MASKBAR, nightpredicate.TOP_BAND,
              *nightpredicate.GLOBAL_ROWS)


def _covers(ys):
    """Every rule region must own at least one fetched scanline.

    The fast path picks its rows by hand -- it cannot afford a full frame --
    so the rule and the row plan are two things that have to agree. They did
    not, twice: the global-brightness guard was added to the rule while this
    path still fetched ten rows and could not see global brightness at all.
    This makes that a startup failure rather than a silent `night`."""
    for fx0, fy0, fx1, fy1 in RULE_BOXES:
        y0 = int(fy0 * DEVICE_H)
        y1 = max(int(fy1 * DEVICE_H), y0 + 1)
        if not any(y0 <= y < y1 for y in ys):
            raise SystemExit(
                f"screenstate --adb-fast fetches no scanline inside rule region "
                f"y {y0}-{y1}; the row plan no longer covers nightpredicate.py")
    return ys


def channel_mean(rows, x0, x1):
    total = [0, 0, 0]
    count = 0
    for row in rows:
        segment = row[x0 * 4:x1 * 4]
        for offset in range(0, len(segment), 4):
            total[0] += segment[offset]
            total[1] += segment[offset + 1]
            total[2] += segment[offset + 2]
            count += 1
    return tuple(value / count for value in total)


def state_from_rows(ys, rows, width=DEVICE_W):
    """Evaluate the shared rule over the fetched scanlines.

    Split out of fast_adb_state so it can be tested without a phone. The live
    watchdog path had never been exercised by anything: the audit that found
    the rule stated four times noted "--adb-fast is never run", and it was the
    copy that kept its own `flash > 90 or (maskbar ...)` after the PNG path had
    been ported. A rule stated twice is a rule that drifts once, and the copy
    nothing runs is the one that drifts."""
    by_y = dict(zip(ys, rows))

    def sample(fx0, fy0, fx1, fy1):
        y0 = int(fy0 * DEVICE_H)
        y1 = max(int(fy1 * DEVICE_H), y0 + 1)
        inside = [row for y, row in by_y.items() if y0 <= y < y1]
        x0 = int(fx0 * DEVICE_W)
        x1 = max(int(fx1 * DEVICE_W), x0 + 1)
        return channel_mean(inside, x0, min(x1, width))

    return "night" if nightpredicate.is_night(sample) else "other"


def fast_adb_state(timeout):
    width = 2400
    stride = width * 4
    # The last two are the global-brightness guard; see the module docstring.
    ys = _covers((45, 55, 65, 75, 85, 1004, 1014, 1024, 1034, 1044, 500, 700))
    remote = f"/data/local/tmp/fnaf2-watch-{os.getpid()}.raw"
    reads = "; ".join(
        f"dd if=$raw bs=1 skip={16 + y * stride} count={stride} 2>/dev/null"
        for y in ys
    )
    script = (
        f"raw={remote}; trap 'rm -f $raw' EXIT HUP INT TERM; "
        f"screencap > $raw || exit 2; {reads}"
    )
    try:
        result = subprocess.run(
            ["adb", "exec-out", "sh", "-c", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SystemExit(2)
    expected = len(ys) * stride
    if result.returncode != 0 or len(result.stdout) != expected:
        raise SystemExit(2)
    rows = [
        result.stdout[index:index + stride]
        for index in range(0, expected, stride)
    ]
    print(state_from_rows(ys, rows, width))


def png_state():
    """Classify a PNG screenshot on stdin. Prints night, gameover or other.

    Wrapped in a function 2026-08-26 so this module can be imported. It could
    not be: importing it ran this code, which blocks reading stdin -- which is
    why the live --adb-fast path had never been exercised by any test even
    though it was the copy of the rule most worth exercising."""
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError:
        print("PNG screenshot mode requires Pillow", file=sys.stderr)
        raise SystemExit(2)

    try:
        im = Image.open(sys.stdin.buffer).convert("RGB")
    except (OSError, UnidentifiedImageError):
        print("invalid screenshot", file=sys.stderr)
        raise SystemExit(2)
    if im.size != (2400, 1080):
        im = im.resize((2400, 1080))

    def mean(box):
        px = im.crop(box).resize((16, 16))
        data = list(px.getdata())
        n = len(data)
        return tuple(sum(c[i] for c in data) / n for i in range(3))

    def fraction(box, predicate):
        data = list(im.crop(box).resize((32, 32)).getdata())
        return sum(1 for pixel in data if predicate(*pixel)) / len(data)

    # One definition, in nightpredicate.py. This file used to state the rule and
    # grade-night.py used to restate it; only one of the two got the global
    # brightness guard, and the copy that missed it is the one that produces run
    # lengths. The boxes are fractions there, so a 2400x1080 caller and a 1280x576
    # one evaluate the same rule rather than two rules that agree by inspection.
    night = nightpredicate.is_night(
        lambda fx0, fy0, fx1, fy1: mean((round(fx0 * 2400), round(fy0 * 1080),
                                         max(round(fx1 * 2400), round(fx0 * 2400) + 1),
                                         max(round(fy1 * 1080), round(fy0 * 1080) + 1))))
    red_face = fraction(
        (650, 450, 1750, 920),
        lambda r, g, b: r > 80 and r > g * 1.5 and r > b * 1.3,
    )
    bright_text = fraction(
        (900, 950, 1450, 1040),
        lambda r, g, b: min(r, g, b) > 150,
    )
    top_bright = fraction(
        GAMEOVER_TOP_BAND,
        lambda r, g, b: max(r, g, b) > 120,
    )
    gameover = (red_face > 0.05 and bright_text > 0.08
                and top_bright < GAMEOVER_TOP_BRIGHT_MAX)

    if night:
        print("night")
    elif gameover:
        print("gameover")
    else:
        print("other")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--adb-fast":
        try:
            capture_timeout = float(sys.argv[2]) if len(sys.argv) > 2 else 0.8
        except ValueError:
            raise SystemExit(2)
        if capture_timeout <= 0:
            raise SystemExit(2)
        fast_adb_state(capture_timeout)
        raise SystemExit(0)
    png_state()
