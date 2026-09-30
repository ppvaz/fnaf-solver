#!/usr/bin/env python3
"""Phone-free fixtures for monitor-calibrate.py.

Behaviour is exercised through the CLI only.  The grid positions below are
written from the CaptureService formula in the tool's docstring, NOT taken
from the tool: if the tool's sampling drifts from the documented cell
centres, the hand-placed pixel anchors stop being found and these checks
fail.  The fitted artifact is round-tripped through the production JS
validator and detector with a real captured frame's cells.
"""

import json
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
TOOL = HERE / "monitor-calibrate.py"
WIDTH, HEIGHT = 2400, 1080

# The synthetic map: two cells bright when the monitor is up (the drawing),
# one office cell bright only when the monitor is down or masked (covered).
MAP_A, MAP_B, OFFICE = 40, 41, 100
UP_PIXELS = {MAP_A: (169, 169, 169), MAP_B: (53, 53, 53), OFFICE: (10, 10, 10)}
DOWN_PIXELS = {MAP_A: (10, 10, 10), MAP_B: (5, 5, 5), OFFICE: (187, 187, 187)}
MASK_PIXELS = {MAP_A: (8, 8, 8), MAP_B: (6, 6, 6), OFFICE: (190, 190, 190)}
BASE_PIXEL = (5, 5, 5)


def positions():
    """The documented cell centres, computed independently of the tool."""
    cells = []
    for gy in range(9):
        y = min(HEIGHT - 1, ((2 * gy + 1) * HEIGHT) // 18)
        for gx in range(20):
            x = min(WIDTH - 1, ((2 * gx + 1) * WIDTH) // 40)
            cells.append((x, y))
    return cells


POSITIONS = positions()


def build_frame(path, cells, background=BASE_PIXEL):
    image = Image.new("RGB", (WIDTH, HEIGHT), background)
    for index, colour in cells.items():
        image.putpixel(POSITIONS[index], colour)
    image.save(path, "PNG")


def frame_cells(overrides, background=BASE_PIXEL):
    cells = {index: background for index in range(180)}
    cells.update(overrides)
    return cells


def cells_to_ints(cells):
    return [r << 16 | g << 8 | b for r, g, b in cells.values()]


def run(args):
    return subprocess.run([sys.executable, str(TOOL), *args],
                          capture_output=True, text=True)


def main():
    failures = 0

    def check(what, ok, detail=""):
        nonlocal failures
        if not ok:
            print(f"FAIL {what}{' -- ' + detail if detail else ''}")
            failures += 1

    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)

        classes = {
            "down": [frame_cells(DOWN_PIXELS)],
            "mask": [frame_cells(MASK_PIXELS)],
            "up": [frame_cells(UP_PIXELS),
                   frame_cells(UP_PIXELS | {MAP_A: (175, 175, 175)})],
            "anim": [frame_cells(UP_PIXELS | {MAP_A: (90, 90, 90)},
                                 background=(12, 12, 12)),                   # in-band
                     frame_cells(DOWN_PIXELS),                                # reads false
                     frame_cells(UP_PIXELS)],                                 # reads true
            "blackout": [frame_cells({}, background=(2, 2, 2))],
        }
        class_dirs = {}
        for label, frames in classes.items():
            directory = root / label
            directory.mkdir()
            for number, cells in enumerate(frames):
                build_frame(directory / f"frame-{number}.png", cells)
            class_dirs[label] = directory

        labelled = [f"{label}={class_dirs[label]}"
                    for label in ("down", "mask", "up", "anim", "blackout")]
        output = root / "monitor-rule.json"
        result = run([*labelled, "--output", str(output), "--strict"])
        check("calibrated fit exits zero", result.returncode == 0, result.stderr)
        artifact = json.loads(output.read_text())
        check("status is calibrated", artifact["status"] == "calibrated")
        check("schema is monitor-rule-v1", artifact["schema"] == "monitor-rule-v1")
        selected = {anchor["cell"]: anchor for anchor in artifact["adapter"]["anchors"]}
        check("the bright map cell is a present anchor",
              selected.get(MAP_A, {}).get("kind") == "present")
        check("the covered office cell is an absent anchor",
              selected.get(OFFICE, {}).get("kind") == "absent")
        check("anchors carry native provenance",
              all("x" in anchor and "y" in anchor
                  for anchor in artifact["adapter"]["anchors"]))
        check("corpus classifies perfectly",
              artifact["adapter"]["corpus_reads"] == {
                  "down": {"false": 1, "true": 0, "unknown": 0},
                  "mask": {"false": 1, "true": 0, "unknown": 0},
                  "up": {"false": 0, "true": 2, "unknown": 0}})
        check("animation evidence is retained",
              artifact["adapter"]["anim_reads"] == {"false": 1, "true": 1, "unknown": 1})
        check("animation and blackout are proven by the provided frames",
              artifact["adapter"]["limitations"] == [])

        # -- Cross-language: the artifact drives the production JS detector ----
        module = (HERE.parent.parent / "src" / "sensors" / "fnaf2"
                  / "monitor-rule.ts").resolve().as_uri()

        def js(script):
            return subprocess.run(["node", "-e", script],
                                  capture_output=True, text=True)
        artifact_json = json.dumps(artifact).replace("'", "\\'")
        up_cells = json.dumps(cells_to_ints(frame_cells(UP_PIXELS)))
        band_cells = json.dumps(cells_to_ints(frame_cells(
            UP_PIXELS | {MAP_A: (90, 90, 90)}, background=(12, 12, 12))))
        js_probe = js(f"""
const {{ parseMonitorRule, measureMonitorUp }} = await import('{module}');
const rule = parseMonitorRule({artifact_json});
const probe = cells => measureMonitorUp(
  {{ ageUs: '17', screen: 'FNAF2_NIGHT', seq: 7, gridSeq: 7, cells }}, rule);
if (probe({up_cells}).value !== true) process.exit(1);
if (probe({band_cells}).reason !== 'ambiguous-threshold') process.exit(1);
""")
        check("js validator accepts the fitted artifact and derives monitorUp",
              js_probe.returncode == 0, js_probe.stderr)
        check("js validator refuses a refused artifact", js(f"""
const {{ parseMonitorRule }} = await import('{module}');
try {{ parseMonitorRule({artifact_json}.status === 'calibrated' ? {{ schema: 'none' }} : {artifact_json}); }} catch (e) {{ process.exit(0); }}
process.exit(1);
""").returncode == 0)

        # -- Refusals -----------------------------------------------------------
        weak = root / "weak"
        weak.mkdir()
        build_frame(weak / "up.png", frame_cells({MAP_A: (12, 12, 12), OFFICE: (10, 10, 10)}))
        build_frame(weak / "down.png", frame_cells({MAP_A: (10, 10, 10), OFFICE: (11, 11, 11)}))
        build_frame(weak / "mask.png", frame_cells({MAP_A: (9, 9, 9), OFFICE: (12, 12, 12)}))
        refused = root / "refused.json"
        result = run([f"down={weak}", f"mask={weak}", f"up={weak}",
                      "--output", str(refused), "--strict"])
        check("weak separation refuses", result.returncode == 1)
        check("refusal names the floor",
              "separation-margin-below-floor" in result.stdout)
        check("refused artifact still written",
              json.loads(refused.read_text())["status"] == "refuse")

        bright_blackout = root / "bright-blackout"
        bright_blackout.mkdir()
        build_frame(bright_blackout / "frame-0.png", frame_cells({}, background=(32, 32, 32)))
        bright = root / "blackout-bright.json"
        base_labelled = [f"{label}={class_dirs[label]}"
                         for label in ("down", "mask", "up", "anim")]
        result = run([*base_labelled, f"blackout={bright_blackout}",
                      "--output", str(bright)])
        check("bright blackout refuses",
              "blackout-not-separated" in result.stdout)
        check("bright blackout reason recorded",
              json.loads(bright.read_text())["reason"] == "blackout-not-separated")

        missing = root / "missing.json"
        result = run([f"down={class_dirs['down']}", f"up={class_dirs['up']}",
                      "--output", str(missing)])
        check("missing class is an error", result.returncode != 0)
        check("error names the missing class", "missing required class" in result.stderr)

        result = run([f"down={class_dirs['down']}", f"mask={class_dirs['mask']}",
                      f"up={class_dirs['up']}", f"weird={class_dirs['down']}",
                      "--output", str(missing)])
        check("unknown class is an error", result.returncode != 0)
        check("error names the unknown class", "unknown class" in result.stderr)

        foreign = root / "foreign.png"
        Image.new("RGB", (100, 100)).save(foreign)
        result = run([f"down={foreign}", f"mask={class_dirs['mask']}", f"up={class_dirs['up']}",
                      "--output", str(missing)])
        check("foreign geometry refused without resizing",
              result.returncode != 0 and "sensor-geometry" in result.stderr)

    if failures:
        print(f"{failures} monitor calibrate check(s) failed")
        sys.exit(1)
    print("monitor calibrate: anchor vectors, exact fit, refusals, and JS round-trip pass")


if __name__ == "__main__":
    main()
