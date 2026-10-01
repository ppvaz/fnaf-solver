#!/usr/bin/env python3
"""Report which title-screen items are visible, or why that is unknown.

The title screen is the one place the runners have always acted blind. Four
scripts tap a coordinate for `Continue` or `6th Night` without ever asking
whether that item is on screen; `TAP_NEWGAME` sits in `coords.sh` beside them,
unused and unguarded, one edit away from erasing the save. plans/13 makes the
menu an observation instead: nothing is tapped that was not seen.

    screencap -p | title-observe.py            # items=continue,newGame
    title-observe.py --adb                     # capture and classify
    title-observe.py --measure < frame.png     # the raw fractions, for calibration
    title-observe.py --continue-night < frame.png   # night=5, for a model with continue_subtitle

Output is exactly one line on stdout:

    items=<comma-separated MenuTargets>   a confident read   (exit 0)
    unknown=<reason>                      refuse             (exit 3)

`packages/play/profiles/fnaf2/moto-g56/title-moto-g56-v207.json` is the measured model for the canonical build
on the calibrated handset (2026-08-26, 26 frames). Its numbers, with their
control:

    band                     newGame        continue       sixthNight
    title, fresh save (23)   0.0674-0.1318  0.0264-0.0547  0.0000 exactly
    title, 6th unlocked (3)  0.0690-0.0720  0.0310-0.0330  0.0670-0.0690
    office HUD (control)     0.0000         0.0000         0.0000

Absent is not "small", it is exactly zero across every frame measured, and the
narrowest present value is 0.0264 -- so the thresholds sit at 0.008/0.020 with
the interval between them meaning "undecided", never "probably absent".

The gate exists because of the Options screen. Its "Perspective Effect" label
lands inside the New Game band at 0.0186, against a 0.020 present threshold: a
margin of 0.0014, which is not a classifier. So the item bands are consulted
only after the game logo says this is the title screen at all -- the word "Five"
reads 0.106-0.123 on every title frame measured and 0.007-0.012 on Options.

A model counts a pixel as lit when its channels all exceed `bright_min` --
the white menu text of FNaF 1, 2 and 3. A model may instead name a `pixel`
predicate (`{"kind": "red", "red_min": R, "other_max": O}`: red above R with
green and blue at most O), for FNaF 4's red-on-red title, and a gate may carry
its own `pixel`. Models without one behave exactly as before.

With no `TITLE_MODEL` this prints `unknown=no-title-model` and the selector
refuses. To calibrate a different handset or build, run `--measure` over frames
of each save state and set thresholds that separate them, with the undecided
interval kept wide enough to be useful.
`packages/play/test/testdata/make-title-fixture.py` builds the synthetic equivalent
that `test-menu.sh` uses to exercise every branch here without a phone --
synthetic frames prove the plumbing, never the threshold.

Exit codes: 0 confident, 3 unknown/refuse, 2 usage or I/O failure.
"""
import base64
import json
import os
import subprocess
import sys
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sensor import open_frame, SensorMismatch  # noqa: E402

warnings.simplefilter("ignore")

GEOMETRY = (2400, 1080)
MODEL_SCHEMA = "title-model-v1"
# Every MenuTarget this project recognises. A model naming anything else is a
# model for a different game build, not a title screen with a bonus button.
TARGETS = ("newGame", "continue", "sixthNight", "customNight")


def fail(reason):
    print(f"unknown={reason}")
    raise SystemExit(3)


def parse_pixel(spec, bright_min):
    """A lit-pixel predicate spec, validated: bright (min channel) or red."""
    if spec is None:
        return {"kind": "bright", "min": bright_min}
    if not isinstance(spec, dict):
        fail("title-model-bad-pixel")
    kind = spec.get("kind")
    try:
        if kind == "bright":
            return {"kind": "bright", "min": int(spec["min"])}
        if kind == "red":
            red_min, other_max = int(spec["red_min"]), int(spec["other_max"])
            if not 0 <= other_max < red_min <= 255:
                fail("title-model-bad-pixel")
            return {"kind": "red", "red_min": red_min, "other_max": other_max}
    except (KeyError, TypeError, ValueError):
        fail("title-model-bad-pixel")
    fail("title-model-bad-pixel")


def load_model(path):
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8") as handle:
            model = json.load(handle)
    except (OSError, ValueError):
        fail("title-model-unreadable")
    if model.get("schema") != MODEL_SCHEMA:
        fail(f"title-model-schema:{model.get('schema')}")
    items = model.get("items")
    if not isinstance(items, dict) or not items:
        fail("title-model-has-no-items")
    for name, point in items.items():
        if name not in TARGETS:
            fail(f"title-model-unknown-item:{name}")
        if (not isinstance(point, list) or len(point) != 2
                or not all(isinstance(v, int) for v in point)):
            fail(f"title-model-bad-point:{name}")
    try:
        model_pixel = parse_pixel(model.get("pixel"), int(model["bright_min"]))
    except (KeyError, TypeError, ValueError):
        fail("title-model-incomplete")
    gates = {}
    for key in ("title_gate", "menu_gate", "foreign_gate"):
        gate = model.get(key)
        if gate is None:
            gates[key] = None
            continue
        try:
            box = [int(v) for v in gate["box"]]
            gate = {"box": tuple(box), "min": float(gate["min"]),
                    "max_absent": float(gate["max_absent"]),
                    "pixel": parse_pixel(gate["pixel"], model_pixel.get("min", 150))
                    if "pixel" in gate else model_pixel}
        except (KeyError, TypeError, ValueError):
            fail(f"title-model-bad-gate:{key}")
        if len(box) != 4 or not gate["max_absent"] < gate["min"]:
            fail(f"title-model-bad-gate:{key}")
        if key == "foreign_gate":
            raw = model[key]
            gate["static_x"] = None
            if "static_x" in raw:
                try:
                    x0, x1 = (int(v) for v in raw["static_x"])
                    gate["static_x"], gate["static_max"] = (x0, x1), float(raw["static_max"])
                except (KeyError, TypeError, ValueError):
                    fail(f"title-model-bad-gate:{key}")
                if not 0 <= x0 < x1 <= GEOMETRY[0]:
                    fail(f"title-model-bad-gate:{key}")
        gates[key] = gate
    # An undecided band is mandatory. A model whose present and absent
    # thresholds meet has no way to say "ambiguous", and this screen's whole
    # job is to be able to refuse.
    try:
        present, absent = float(model["present_min"]), float(model["absent_max"])
        bright = int(model["bright_min"])
        band_w, band_h = (int(v) for v in model["band"])
    except (KeyError, TypeError, ValueError):
        fail("title-model-incomplete")
    if not absent < present:
        fail("title-model-has-no-undecided-band")
    if band_w <= 0 or band_h <= 0:
        fail("title-model-bad-band")
    subtitle = model.get("continue_subtitle")
    if subtitle is not None:
        try:
            x0, y0, x1, y1 = (int(v) for v in subtitle["box"])
            sx0, sx1 = (int(v) for v in subtitle["static_x"])
            templates = {}
            for digit, packed in subtitle["templates"].items():
                bits = base64.b64decode(packed)
                size = (x1 - x0) * (y1 - y0)
                if not digit.isdigit() or len(bits) != (size + 7) // 8:
                    raise ValueError(digit)
                templates[int(digit)] = [(bits[i // 8] >> (7 - i % 8)) & 1 for i in range(size)]
            subtitle = {"box": (x0, y0, x1, y1), "static_x": (sx0, sx1),
                        "static_max": float(subtitle["static_max"]),
                        "min_iou": float(subtitle["min_iou"]),
                        "margin": float(subtitle["margin"]), "templates": templates}
        except (KeyError, TypeError, ValueError):
            fail("title-model-bad-continue-subtitle")
    guard = model.get("static_guard")
    if guard is not None:
        try:
            x0, x1 = (int(v) for v in guard["x"])
            guard = {"x": (x0, x1), "max": float(guard["max"]),
                     "items": tuple(guard["items"])}
        except (KeyError, TypeError, ValueError):
            fail("title-model-bad-static-guard")
        if (not 0 <= x0 < x1 <= GEOMETRY[0] or not 0.0 <= guard["max"] < 1.0
                or not guard["items"]
                or any(name not in items for name in guard["items"])):
            fail("title-model-bad-static-guard")
    return {"items": items, "present_min": present, "absent_max": absent,
            "bright_min": bright, "band": (band_w, band_h),
            "title_gate": gates["title_gate"], "menu_gate": gates["menu_gate"],
            "foreign_gate": gates["foreign_gate"], "static_guard": guard,
            "continue_subtitle": subtitle, "pixel": model_pixel,
            "build": model.get("build", "unnamed")}


def read_frame(source, declared=None):
    """The frame, or a refusal naming the sensor. plans/15: a model reads the
    capture method it was calibrated for, and says so about the rest."""
    try:
        image, _ = open_frame(source, declared)
    except SensorMismatch as exc:
        fail(str(exc))
    return image


def lit(pixel):
    """The per-pixel predicate: an int is the classic bright_min threshold."""
    if isinstance(pixel, int):
        return lambda r, g, b: min(r, g, b) > pixel
    if pixel["kind"] == "bright":
        threshold = pixel["min"]
        return lambda r, g, b: min(r, g, b) > threshold
    red_min, other_max = pixel["red_min"], pixel["other_max"]
    return lambda r, g, b: r >= red_min and max(g, b) <= other_max


def box_fraction(image, box, bright_min):
    test = lit(bright_min)
    data = list(image.crop(box).resize((32, 32)).getdata())
    return sum(1 for r, g, b in data if test(r, g, b)) / len(data)


def bright_fraction(image, point, band, bright_min):
    x, y = point
    half_w, half_h = band[0] // 2, band[1] // 2
    box = (max(0, x - half_w), max(0, y - half_h),
           min(GEOMETRY[0], x + half_w), min(GEOMETRY[1], y + half_h))
    return box_fraction(image, box, bright_min)


def continue_night(image, model):
    """The digit under Continue, by IoU with the only cursors ever observed;
    any other digit is UNKNOWN, never the nearest template."""
    spec = model["continue_subtitle"]
    if spec is None:
        fail("no-continue-subtitle")
    x0, y0, x1, y1 = spec["box"]
    lit = box_fraction(image, (spec["static_x"][0], y0, spec["static_x"][1], y1),
                       model["bright_min"])
    if lit > spec["static_max"]:
        fail(f"ambiguous:static-bar:continue-night:{lit:.4f}")
    mask = [1 if min(p) > model["bright_min"] else 0
            for p in image.crop((x0, y0, x1, y1)).getdata()]
    scores = {}
    for digit, template in spec["templates"].items():
        both = sum(a & b for a, b in zip(mask, template))
        either = sum(a | b for a, b in zip(mask, template))
        scores[digit] = both / either if either else 0.0
    ranked = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best, score = ranked[0]
    second = ranked[1][1] if len(ranked) > 1 else 0.0
    if score < spec["min_iou"] or score - second < spec["margin"]:
        fail(f"ambiguous:continue-night:{best}:{score:.3f}")
    return best


def capture_via_adb(timeout):
    try:
        result = subprocess.run(
            ["adb", "exec-out", "screencap", "-p"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        fail("capture-failed")
    if result.returncode != 0 or not result.stdout:
        fail("capture-failed")
    import io
    return io.BytesIO(result.stdout)


FLAGS = ("--measure", "--adb", "--continue-night")
VALUED = ("--sensor", "--model")

def main(argv):
    # Every token is a flag or a valued flag's value. The frame comes on stdin (or --adb): a positional path used to be
    # ignored, and the stdin frame read as `unknown=unreadable-frame` (CLAUDE.md mistake register 1), so it is refused.
    i = 0
    while i < len(argv):
        if argv[i] in VALUED: i += 2
        elif argv[i] in FLAGS: i += 1
        else:
            print(f"title-observe.py: unexpected argument {argv[i]!r}; the frame is read from stdin (or --adb), "
                  "never from a path argument", file=sys.stderr)
            return 2
    measure = "--measure" in argv
    use_adb = "--adb" in argv
    want_night = "--continue-night" in argv
    declared = None
    if "--sensor" in argv:
        idx = argv.index("--sensor")
        if idx + 1 >= len(argv):
            print("--sensor needs a capture method", file=sys.stderr)
            return 2
        declared = argv[idx + 1]
    model_path = os.environ.get("TITLE_MODEL", "")
    if "--model" in argv:
        index = argv.index("--model")
        if index + 1 >= len(argv):
            print("--model needs a path", file=sys.stderr)
            return 2
        model_path = argv[index + 1]

    # --measure is the calibration path and deliberately does not need a model:
    # it is how the first one gets built.
    if measure:
        model = load_model(model_path) if model_path else None
        band = model["band"] if model else (660, 76)
        bright_min = model["pixel"] if model else 150
        points = model["items"] if model else {
            "newGame": [400, 640], "continue": [400, 730], "sixthNight": [400, 880]}
        image = read_frame(capture_via_adb(8.0) if use_adb else sys.stdin.buffer, declared)
        for name in sorted(points):
            value = bright_fraction(image, points[name], band, bright_min)
            print(f"{name} {value:.4f}")
        return 0

    if not model_path:
        fail("no-title-model")
    model = load_model(model_path)
    image = read_frame(capture_via_adb(8.0) if use_adb else sys.stdin.buffer, declared)

    # Is this the title screen at all? Asking the item bands that question is
    # the wrong way round, and the Options screen proves it: its "Perspective
    # Effect" label lands inside the New Game band at 0.0186, a hair under the
    # 0.020 present threshold. A margin of 0.0014 is not a classifier.
    #
    # The game logo is: the word "Five" reads 0.106-0.123 on every title screen
    # measured, on both sensors (native screencap and upscaled screenrecord),
    # and 0.007-0.012 on Options. Gate on that, and the item bands are only ever
    # consulted once the screen is known to be the title.
    gate = model["title_gate"]
    if gate is not None:
        value = box_fraction(image, gate["box"], gate["pixel"])
        if value <= gate["max_absent"]:
            fail(f"not-the-title-screen:{value:.4f}")
        if value < gate["min"]:
            fail(f"ambiguous:title-gate:{value:.4f}")

    # Another game's title can pass this game's logo gate: FNaF 1 and FNaF 2
    # both open with the word "Five" in the same corner, and FNaF 1's observer
    # read 14 of 31 retained FNaF 2 title frames as its own -- 6th Night and
    # Custom Night rows included, because FNaF 2's rows sit inside FNaF 1's
    # bands. A foreign gate names a box the OTHER title always lights and this
    # one never draws on. Bright there is someone else's title -- unless the
    # static bar is across those rows, which a strip dark on BOTH titles
    # reports; the interval between the thresholds refuses, as every gate does.
    foreign = model["foreign_gate"]
    if foreign is not None:
        value = box_fraction(image, foreign["box"], foreign["pixel"])
        if value > foreign["max_absent"]:
            if foreign["static_x"] is not None:
                _, top, _, bottom = foreign["box"]
                lit = box_fraction(image, (foreign["static_x"][0], top,
                                           foreign["static_x"][1], bottom),
                                   model["bright_min"])
                if lit > foreign["static_max"]:
                    fail(f"ambiguous:static-bar:foreign-gate:{lit:.4f}")
            if value >= foreign["min"]:
                fail(f"foreign-title:{value:.4f}")
            fail(f"ambiguous:foreign-gate:{value:.4f}")

    # The logo being up does not mean the MENU is up. Pressing New Game raises a
    # "Start a new game?" confirmation that keeps the logo and reuses the same
    # three rows: the prompt sits in the New Game band, "No" on the Continue
    # row, and "Yes" on the 6th Night row. Measured on that dialog the item
    # bands read 0.0332 / 0.0166 / 0.0254 -- newGame and sixthNight both ABOVE
    # the 0.020 present threshold. So without this gate the observer reports a
    # menu, and `menu_select sixthNight` presses (400,880), which is "Yes", and
    # the save is gone. Only an accidental ambiguity in the Continue band
    # stopped that on 2026-08-26.
    #
    # The Options row is the discriminator: 0.0869-0.1201 with the menu up,
    # 0.0000 on the confirmation and 0.0000 on the Options screen.
    menu = model["menu_gate"]
    if menu is not None:
        value = box_fraction(image, menu["box"], menu["pixel"])
        if value <= menu["max_absent"]:
            fail(f"title-dialog:{value:.4f}")
        if value < menu["min"]:
            fail(f"ambiguous:menu-gate:{value:.4f}")

    # FNaF 1's title static sweeps a bright full-width bar down the screen. On
    # a row whose absence is a real save state, that bar reads exactly like
    # text: a Night 1 save's 6th Night band read 0.2646 with the bar across
    # it, against 0.034-0.050 for the real row. The bar is full width and the
    # menu text is not, so a text-free strip on the band's own rows tells them
    # apart: lit there means the bar, and the item cannot be decided.
    if want_night:
        print(f"night={continue_night(image, model)}")
        return 0

    guard = model["static_guard"]
    present = []
    for name in sorted(model["items"]):
        if guard is not None and name in guard["items"]:
            y = model["items"][name][1]
            half_h = model["band"][1] // 2
            strip = (guard["x"][0], max(0, y - half_h),
                     guard["x"][1], min(GEOMETRY[1], y + half_h))
            lit = box_fraction(image, strip, model["bright_min"])
            if lit > guard["max"]:
                fail(f"ambiguous:static-bar:{name}:{lit:.4f}")
        value = bright_fraction(image, model["items"][name], model["band"],
                                model["pixel"])
        if value >= model["present_min"]:
            present.append(name)
        elif value > model["absent_max"]:
            # Between the thresholds is not "probably absent". A title screen
            # mid-transition reads exactly like this, and so does a frame from
            # a build whose layout moved.
            fail(f"ambiguous:{name}:{value:.4f}")
    if not present:
        # Every band dark is not "a title screen with no buttons" -- it is far
        # more likely not the title screen at all.
        fail("no-items-visible")
    print("items=" + ",".join(present))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
