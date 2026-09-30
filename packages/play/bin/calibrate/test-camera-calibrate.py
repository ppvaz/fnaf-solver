#!/usr/bin/env python3
"""Phone-free fixtures for camera-calibrate.py.

The button pixels are set from the test's own copy of the measured map
coordinates (aligned with PixelWatch.defaultSpec()): if the tool's coordinates
drift, the hand-placed yellows stop being found and the exact-fit checks
fail.  The fitted artifact is round-tripped through the production JS
validator and detector, including the multiple-highlight case.
"""

import json
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
TOOL = HERE / "camera-calibrate.py"
WIDTH, HEIGHT = 2400, 1080
# The measured button centres, aligned with PixelWatch.defaultSpec().
BUTTONS = (
    ("cam01_button", 1412, 784), ("cam02_button", 1720, 784),
    ("cam03_button", 1411, 690), ("cam04_button", 1728, 690),
    ("cam05_button", 1424, 916), ("cam06_button", 1696, 916),
    ("cam07_button", 1776, 606), ("cam08_button", 1412, 590),
    ("cam09_button", 2144, 548), ("cam10_button", 1984, 716),
    ("cam11_button", 2228, 652), ("cam12_button", 2188, 784),
)
SELECTED = (194, 221, 0)     # the measured lit fill, yellowness 194
DIMMED = (110, 124, 13)      # the measured wind-state dim fill, yellowness 96
UNLIT = (49, 52, 68)         # the map's cool grey, yellowness -19


def run(args):
    return subprocess.run([sys.executable, str(TOOL), *args],
                          capture_output=True, text=True)


def build(path, lit, dimmed=False):
    image = Image.new("RGB", (WIDTH, HEIGHT), (12, 12, 12))
    for name, x, y in BUTTONS:
        colour = UNLIT
        if name == lit:
            colour = DIMMED if dimmed else SELECTED
        image.putpixel((x, y), colour)
    image.save(path, "PNG")


def main():
    failures = 0

    def check(what, ok, detail=""):
        nonlocal failures
        if not ok:
            print(f"FAIL {what}{' -- ' + detail if detail else ''}")
            failures += 1

    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        labelled = []
        for index in range(1, 13):
            control = f"cam:{index}"
            directory = root / f"cam{index:02d}"
            directory.mkdir()
            entry = f"cam{index:02d}_button"
            build(directory / "a.png", entry)
            build(directory / "b.png", entry,
                  dimmed=(entry == "cam11_button"))
            labelled.append(f"{control}={directory}")

        output = root / "camera-rule.json"
        result = run([*labelled, "--output", str(output), "--strict"])
        check("calibrated fit exits zero", result.returncode == 0, result.stderr)
        artifact = json.loads(output.read_text())
        check("status is calibrated", artifact["status"] == "calibrated")
        check("schema is camera-rule-v1", artifact["schema"] == "camera-rule-v1")
        check("all twelve buttons calibrated",
              len(artifact["adapter"]["buttons"]) == 12)
        cam11 = next(b for b in artifact["adapter"]["buttons"]
                     if b["control"] == "cam:11")
        check("cam11's lit band spans the dimmed state",
              cam11["lit_range"] == [97, 194])
        others = [b for b in artifact["adapter"]["buttons"]
                  if b["control"] != "cam:11"]
        check("bright-only buttons span 194 only",
              all(b["lit_range"] == [194, 194] for b in others))
        check("corpus names every frame",
              all(reads["named"] == artifact["adapter"]["class_counts"][label]
                  and reads["none"] == 0 and reads["multiple"] == 0
                  and reads["ambiguous"] == 0
                  for label, reads in artifact["adapter"]["corpus_reads"].items()))

        # -- Cross-language: the artifact drives the production JS detector ----
        module = (HERE.parent.parent / "src" / "sensors" / "fnaf2"
                  / "camera-rule.ts").resolve().as_uri()

        def js(script):
            return subprocess.run(["node", "-e", script],
                                  capture_output=True, text=True)
        artifact_json = json.dumps(artifact).replace("'", "\\'")
        lit_reads = {b["entry"]: ("194" if b["control"] == "cam:2" else "-19")
                     for b in artifact["adapter"]["buttons"]}
        both_lit = {b["entry"]: "194" for b in artifact["adapter"]["buttons"]}
        up = "({signal:'monitorUp',state:'OBSERVED',value:true,confidence:1})"
        down = "({signal:'monitorUp',state:'OBSERVED',value:false,confidence:1})"
        js_probe = js(f"""
const {{ parseCameraRule, measureCameraSelected }} = await import('{module}');
const rule = parseCameraRule({artifact_json});
if (measureCameraSelected({json.dumps(lit_reads)}, rule, {up}).value !== 'cam:2') process.exit(1);
if (measureCameraSelected({json.dumps(both_lit)}, rule, {up}).reason !== 'multiple-camera-highlight') process.exit(1);
if (measureCameraSelected({json.dumps(lit_reads)}, rule, {down}).reason !== 'monitor-not-up') process.exit(1);
""")
        check("js validator accepts the fitted artifact and names the camera",
              js_probe.returncode == 0, js_probe.stderr)

        # -- Refusal ------------------------------------------------------------
        weak_values = {"cam01.png": {"cam01_button": (63, 63, 68),   # yellowness -5
                                     "cam02_button": (61, 61, 68)},  # -7
                       "cam02.png": {"cam01_button": (61, 61, 68),   # -7
                                     "cam02_button": (62, 62, 68)}}  # -6
        weak_labels = []
        for index in (1, 2):
            directory = root / f"weak-cam{index:02d}"
            directory.mkdir()
            file_name = f"cam{index:02d}.png"
            image = Image.new("RGB", (WIDTH, HEIGHT), (12, 12, 12))
            for name, x, y in BUTTONS:
                image.putpixel((x, y), weak_values[file_name].get(name, UNLIT))
            image.save(directory / file_name)
            weak_labels.append(f"cam:{index}={directory}")
        refused = root / "refused.json"
        result = run([*weak_labels, "--output", str(refused), "--strict"])
        check("thin separation refuses", result.returncode != 0)
        check("refusal names the floor", "below floor" in result.stderr)

        result = run([f"camera:1={root / 'cam01'}", f"cam:2={root / 'cam02'}",
                      "--output", str(refused)])
        check("malformed label is an error", result.returncode != 0)

    if failures:
        print(f"{failures} camera calibrate check(s) failed")
        sys.exit(1)
    print("camera calibrate: button vectors, dimmed state, verdicts, and JS round-trip pass")


if __name__ == "__main__":
    main()
