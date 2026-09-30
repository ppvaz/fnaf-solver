#!/usr/bin/env python3
"""Phone-free gate for FNaF 1's menu models and their two readers.

Synthetic frames prove the plumbing -- which gate refuses what, in which order
-- and nothing about the real thresholds, which come from the device corpora
cited in the models. Every frame here is built from the committed models' own
boxes, so a model edit that moves a box moves the fixture with it.
"""
import base64
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
TITLE = json.loads((HERE / "../../profiles/fnaf1/moto-g56" / "title-fnaf1-moto-g56-v207.json").read_text())
CUSTOM = json.loads((HERE / "../../profiles/fnaf1/moto-g56" / "custom-night-fnaf1-moto-g56-v207.json").read_text())
WHITE, DARK = (255, 255, 255), (8, 8, 12)
failed = 0


def check(label, ok, detail=""):
    global failed
    if not ok:
        failed += 1
        print(f"FAIL {label}: {detail}")


def observe(frame, *args):
    out = subprocess.run([str(HERE / "fnaf1-title-observe.sh"), *args], stdin=open(frame, "rb"),
                         capture_output=True, text=True, check=False)
    return out.returncode, out.stdout.strip()


def title(rows=("newGame", "continue", "sixthNight", "customNight"), bar=None, foreign=False,
          digit=None):
    image = Image.new("RGB", (2400, 1080), DARK)
    draw = ImageDraw.Draw(image)
    draw.rectangle(TITLE["title_gate"]["box"], fill=WHITE)
    draw.rectangle(TITLE["menu_gate"]["box"], fill=WHITE)
    for name in rows:
        x, y = TITLE["items"][name]
        # A solid block well inside the band: the observer downsamples each
        # band to 32x32, which averages thin synthetic strokes below its floor.
        draw.rectangle((x - 200, y - 25, x + 200, y + 25), fill=WHITE)
    if foreign:
        draw.rectangle(TITLE["foreign_gate"]["box"], fill=WHITE)
    if bar is not None:
        draw.rectangle((0, bar[0], 2399, bar[1]), fill=WHITE)
    if digit is not None:
        spec = TITLE["continue_subtitle"]
        x0, y0, x1, y1 = spec["box"]
        bits = base64.b64decode(spec["templates"][digit])
        width = x1 - x0
        for index in range((x1 - x0) * (y1 - y0)):
            if (bits[index // 8] >> (7 - index % 8)) & 1:
                image.putpixel((x0 + index % width, y0 + index // width), WHITE)
    return image


with tempfile.TemporaryDirectory(prefix="fnaf1-menus-") as tmp:
    def save(image, name):
        path = f"{tmp}/{name}.png"
        image.save(path)
        return path

    code, out = observe(save(title(), "unlocked"))
    check("all four unlocked rows read", code == 0 and out == "items=continue,customNight,newGame,sixthNight", out)
    code, out = observe(save(title(rows=("newGame", "continue")), "night1"))
    check("a locked save lists no 6th Night or Custom Night", code == 0 and out == "items=continue,newGame", out)

    y = TITLE["items"]["sixthNight"][1]
    code, out = observe(save(title(rows=("newGame", "continue"), bar=(y - 15, y + 15)), "bar"))
    check("the static bar across a locked row refuses instead of reading it",
          code == 3 and out.startswith("unknown=ambiguous:static-bar:sixthNight"), out)

    code, out = observe(save(title(foreign=True), "fnaf2"))
    check("a lit FNaF 2 logo corner is another game's title", code == 3 and out.startswith("unknown=foreign-title"), out)
    top, bottom = TITLE["foreign_gate"]["box"][1], TITLE["foreign_gate"]["box"][3]
    code, out = observe(save(title(foreign=True, bar=(top, bottom)), "fnaf1-bar-top"))
    check("the bar across the logo corner is static, not a foreign title",
          code == 3 and out.startswith("unknown=ambiguous:static-bar:foreign-gate"), out)

    for digit in ("1", "5"):
        code, out = observe(save(title(digit=digit), f"night{digit}"), "--continue-night")
        check(f"Continue reads Night {digit}", code == 0 and out == f"night={digit}", out)
    code, out = observe(save(title(), "no-digit"), "--continue-night")
    check("an unlearned or empty subtitle digit is UNKNOWN",
          code == 3 and out.startswith("unknown=ambiguous:continue-night"), out)

    # Custom Night: the flat grey boxes are the gate; masks are reported
    # without a table match, and a dark frame is not the screen at all.
    grey = tuple(CUSTOM["screenGate"]["grey"])
    image = Image.new("RGB", (2400, 1080), (0, 0, 0))
    draw = ImageDraw.Draw(image)
    for dial in CUSTOM["dials"].values():
        for key in ("decrementBox", "incrementBox"):
            x, y0, w, h = dial[key]
            draw.rectangle((x, y0, x + w - 1, y0 + h - 1), fill=grey)
    reader = [sys.executable, str(HERE / "fnaf1-custom-night-read.py"), "--model",
              str(HERE / "../../profiles/fnaf1/moto-g56" / "custom-night-fnaf1-moto-g56-v207.json"), "--frame"]
    out = subprocess.run(reader + [save(image, "custom")], capture_output=True, text=True)
    result = json.loads(out.stdout)
    check("the grey arrow boxes pass the Custom Night gate",
          result.get("screen") == "custom-night" and len(result.get("masks", {})) == 4, out.stdout)
    check("an unlearned dial mask is UNKNOWN, never the nearest value",
          out.returncode == 3 and result.get("reason") == "unlearned-mask", out.stdout)
    out = subprocess.run(reader + [save(Image.new("RGB", (2400, 1080), DARK), "dark")],
                         capture_output=True, text=True)
    check("a frame without the grey boxes is not Custom Night",
          out.returncode == 3 and json.loads(out.stdout).get("reason") == "not-custom-night", out.stdout)
    out = subprocess.run(reader + [save(Image.new("RGB", (1280, 576), DARK), "foreign")],
                         capture_output=True, text=True)
    check("a foreign geometry is refused, not resized", out.returncode == 3 and "sensor" in out.stdout, out.stdout)

# The learned table: 21 values, one hash each, and every hash a real sha256.
table = CUSTOM["glyphs"]["hashes"]
check("the glyph table holds each value 0..20 exactly once", sorted(table.values()) == list(range(21)),
      sorted(table.values()))
check("every glyph key is a sha256 digest", all(len(k) == 64 and int(k, 16) >= 0 for k in table))
check("the dials are named in screen order", list(CUSTOM["dials"]) == ["freddy", "bonnie", "chica", "foxy"])
check("the title model binds the unlocked rows",
      {"sixthNight", "customNight"} <= set(TITLE["items"]) and TITLE["static_guard"]["items"] == ["sixthNight", "customNight"])

if failed:
    print(f"{failed} fnaf1 menu check(s) failed")
    raise SystemExit(1)
print("fnaf1 menus: unlocked rows, static-bar and FNaF 2 refusals, Continue night 1/5, "
      "Custom Night gate and exact-mask refusal, 21-value glyph table")
