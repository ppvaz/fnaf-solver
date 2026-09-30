#!/usr/bin/env python3
"""Name the lifecycle screen, or refuse. Adds classes; never overrides the authority.

`screenstate.py` classifies night / gameover / other, and stays the authority on
whether a night is running -- CLAUDE.md is explicit that a detector which knows
one way to be dead must never be what says you are alive. That rule cost this
project two runs reported at 163 s and 153 s which were 26.0 s and 72.2 s alive.

What it does not do is distinguish everything else. `other` covers the title, the
New Game confirmation, the Options screen, the "HELP WANTED" newspaper, a death,
a minigame, static, and a screen nobody has seen. plans/13 package 3 needs those
apart, because "the office HUD disappeared" is not a clear and an aborted
recording must not grade as a campaign advance.

So this runs screenstate first and only refines its `other`.

    screencap -p | lifecycle-observe.py          # state=title
    lifecycle-observe.py --adb --verbose

Output is one line: `state=<name>` (exit 0) or `unknown=<reason>` (exit 3).

Ordering matters and is measured, not assumed: the logo box reads 0.206 on an
OFFICE frame, higher than its 0.050 threshold, so a title test placed before the
HUD test would claim the office is a title screen. The HUD bars (0.151 in the
office, 0.000 on every title screen) are consulted first.

Still not modelled, and deliberately reported as unknown rather than guessed:
minigames and the night number printed on an intro card. The generic intro card
and the 6 AM transition now have positive signals, but neither can stand in for
those missing facts.

One correction worth carrying: the death static on this build is DARK (frame
mean 34.1, the same as the office), not the bright static the Companion's death
signature was measured against. Brightness does not separate it; roughness does.
"""
import json
import os
import subprocess
import sys
import warnings

warnings.simplefilter("ignore")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from sensor import open_frame, SensorMismatch  # noqa: E402
import intro_card  # noqa: E402
from PIL import Image  # noqa: E402
GEOMETRY = (2400, 1080)
MODEL_SCHEMA = "lifecycle-model-v1"
DEFAULT_MODEL = os.path.join(HERE, "models", "lifecycle-moto-g56-v207.json")
_INTRO_MODELS = {}


def refuse(reason):
    print(f"unknown={reason}")
    raise SystemExit(3)


def load_frame(data, declared=None):
    """plans/15: refuse a capture method this model was not calibrated for,
    rather than resizing it into a plausible answer."""
    import io
    try:
        im, _ = open_frame(io.BytesIO(data), declared)
    except SensorMismatch as exc:
        refuse(str(exc))
    return im


def authority(data):
    """screenstate.py's verdict. It owns night and gameover."""
    out = subprocess.run([sys.executable, os.path.join(HERE, "screenstate.py")],
                         input=data, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, check=False)
    return out.stdout.decode().strip() or "unknown"


# --- the two dark screens: 6 AM and the story-night intro card ------------
#
# Measured in FRACTIONS of the frame and consulted BEFORE load_frame's sensor
# gate, because they are sensor-independent by construction -- the same
# argument nightpredicate.py makes for the alive/dead rule. The only fixtures
# that exist are 1280x576 `screenrecord` frames, which the calibrated
# `screencap` model correctly refuses; teaching one fact twice, once per
# sensor, is what plans/15 exists to stop.
#
# Calibrated 2026-08-26 on the first cleared Night 1 (`n1-full-1640`) -- also
# the first 6 AM this project has ever recorded. Measured, with controls:
#
#   class          frame mean     confetti%      clock columns
#   6 AM (win)     1.80-2.41      0.059-0.326    0.153-0.203
#   intro card     0.06-1.29      0.000 exactly  0.000-0.205
#   death frames   29.7-39.4      0.000-5.134    0.027-0.075
#   death static   34.6           0.000          0.593
#   game over      19.1           4.930          0.132
#   office/night   22.2-59.4      0.000-1.140    0.027-0.332
#   title          24.3-45.5      0.000-0.090    0.027-0.223
#
# `mean < 5` isolates the two dark screens from every other class by a wide
# margin -- the nearest other class is 19.1. Within the dark pair, the win
# confetti is not merely *small* on the intro card, it is **exactly zero**
# across sixteen frames from two separate recordings, while the lowest 6 AM
# frame reads 0.059. That is why the threshold sits at 0.02 and not halfway.
#
# NOT separated here, and reported rather than guessed: WHICH night an intro
# card names. Reading "1st" from "2nd" is a different problem with different
# evidence, and plans/13's identity contract needs that second fact -- so a
# detected card must never stand in for a verified night.
def _intro_model():
    path = os.environ.get("INTRO_CARD_MODEL", intro_card.DEFAULT_MODEL)
    if path not in _INTRO_MODELS:
        _INTRO_MODELS[path] = intro_card.load_model(path)
    return _INTRO_MODELS[path]


def dark_screen_state(im, th):
    """Name a measured dark screen, otherwise return a refusal sentinel."""
    im = im.convert("RGB")
    w, h = im.size
    px = im.load()

    tot = n = 0
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            r, g, b = px[x, y]
            tot += (r * 299 + g * 587 + b * 114) // 1000
            n += 1
    if tot / max(n, 1) >= th["darkMeanMax"]:
        return None

    # Bright text in the clock band. A dark frame without it is a fade or a
    # blackout, not a screen this can name.
    cols = set()
    for y in range(int(0.40 * h), int(0.56 * h), 2):
        for x in range(0, w, 2):
            r, g, b = px[x, y]
            if (r * 299 + g * 587 + b * 114) // 1000 > 150:
                cols.add(x)
    if len(cols) / (w / 2) < th["clockColsMin"]:
        # Dark, but no text: the fade either side of a card, or a blackout.
        # Named so it does not fall through to the sensor gate and come back
        # blaming the capture method for a frame that simply has nothing on it.
        return "dark"

    # Win confetti: saturated colour in the upper half. The intro card is pure
    # white on black and reads exactly zero here. Test this before the intro
    # conjunction because 6 AM also has central clock text, a black top field,
    # and low roughness; without confetti it would fit the card's shape.
    sat = m = 0
    for y in range(0, int(0.45 * h), 3):
        for x in range(0, w, 3):
            r, g, b = px[x, y]
            m += 1
            if max(r, g, b) > 70 and (max(r, g, b) - min(r, g, b)) > 50:
                sat += 1
    if 100 * sat / max(m, 1) >= th["confettiMin"]:
        return "sixam"

    # The measured intro signature is a conjunction, not "dark plus text".
    # In particular, the cutscene immediately before the card carries MORE
    # central text than the card. intro_card also refuses 6 AM and never reads
    # the ordinal printed beneath 12:00 AM.
    try:
        positive, _, _ = intro_card.classify(im, _intro_model())
    except (ValueError, KeyError, TypeError):
        return "intro-model-error"
    return "intro" if positive else "unclassified-dark-text"


def main(argv):
    verbose = "--verbose" in argv
    declared = None
    if "--sensor" in argv:
        idx = argv.index("--sensor")
        if idx + 1 >= len(argv):
            print("--sensor needs a capture method", file=sys.stderr)
            return 2
        declared = argv[idx + 1]
    model_path = os.environ.get("LIFECYCLE_MODEL", DEFAULT_MODEL)
    try:
        with open(model_path, "r", encoding="utf-8") as fh:
            model = json.load(fh)
    except (OSError, ValueError):
        refuse("lifecycle-model-unreadable")
    if model.get("schema") != MODEL_SCHEMA:
        refuse(f"lifecycle-model-schema:{model.get('schema')}")

    if "--adb" in argv:
        got = subprocess.run(["adb", "exec-out", "screencap", "-p"],
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             timeout=8.0, check=False)
        if got.returncode != 0 or not got.stdout:
            refuse("capture-failed")
        data = got.stdout
    else:
        data = sys.stdin.buffer.read()

    verdict = authority(data)
    if verdict in ("night", "gameover"):
        print(f"state={verdict}")
        return 0

    # Sensor-independent, so it precedes the calibrated model's sensor gate.
    import io as _io
    dark = dark_screen_state(Image.open(_io.BytesIO(data)), model["thresholds"])
    if dark == "dark":
        refuse("dark-frame-no-text")
    if dark == "intro-model-error":
        refuse("intro-model-unreadable")
    if dark == "unclassified-dark-text":
        refuse("dark-text-no-lifecycle-signature")
    if dark:
        print(f"state={dark}")
        return 0

    im = load_frame(data, declared)
    sigs, th = model["signatures"], model["thresholds"]
    bright = model["bright_min"]

    def value(name):
        s = sigs[name]
        box = tuple(s["box"])
        if s["kind"] == "roughness":
            # Mean absolute difference between vertically adjacent pixels, at
            # full resolution. Static is noise everywhere; a rendered scene has
            # smooth regions. Downsampling would destroy exactly the signal.
            crop = im.crop(box).convert("L")
            px = crop.load()
            w, h = crop.size
            tot = n = 0
            for y in range(0, h - 1, 3):
                for x in range(0, w, 3):
                    tot += abs(px[x, y] - px[x, y + 1])
                    n += 1
            return tot / n
        data_ = list(im.crop(box).resize((24, 24) if s["kind"] == "mean" else (32, 32)).getdata())
        if s["kind"] == "mean":
            return sum(sum(p) for p in data_) / (len(data_) * 3)
        return sum(1 for r, g, b in data_ if min(r, g, b) > bright) / len(data_)

    v = {name: value(name) for name in sigs}
    if verbose:
        print("  " + "  ".join(f"{k}={x:.3f}" for k, x in v.items()), file=sys.stderr)

    # The newspaper is the whole frame going bright; nothing else comes near it.
    if v["wholeFrameMean"] >= th["newspaperMeanMin"]:
        state = "newspaper"
    # The office HUD before anything else -- see the module docstring.
    elif v["hudBars"] >= th["hudPresentMin"] or v["hudNightClock"] >= th["hudPresentMin"]:
        # screenstate said this is not a night, yet the office HUD is drawn.
        # That disagreement is a finding, not something to resolve here.
        refuse(f"office-hud-without-night (bars {v['hudBars']:.3f})")
    # The death static, before anything that reads a box of pixels as text: on
    # static every such box is noise and could match anything.
    elif v["roughness"] >= th["staticRoughnessMin"]:
        state = "static"
    elif v["optionsHeader"] >= th["optionsHeaderMin"]:
        state = "options"
    elif v["logo"] >= th["logoMin"] and v["menuOptionsRow"] >= th["menuRowMin"]:
        state = "title"
    elif v["logo"] >= th["logoMin"] and v["menuOptionsRow"] <= th["menuRowAbsentMax"]:
        state = "titleDialog"
    else:
        refuse("no-signature-matched")
    print(f"state={state}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
