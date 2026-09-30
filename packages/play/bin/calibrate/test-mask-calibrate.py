#!/usr/bin/env python3
"""Phone-free fixtures for mask-calibrate.py.

Behaviour is exercised through the CLI only.  The grid positions below are
written from the CaptureService formula in the tool's docstring, NOT taken
from the tool, exactly as in test-monitor-calibrate.py: if the sampling drifts
from the documented cell centres the hand-placed pixel anchors stop being
found and these checks fail.

The maskOn fact is occlusion-only, so the synthetic corpus is too -- cells that
are bright with the mask off and black with it on.  What is pinned here is the
pair of guarantees that replace the monitor rule's polarity demand: anchors
must spread over at least two grid rows, and an artifact whose darkness guard
was never proven against a blackout class parses as evidence but is refused as
a live calibration-state gate.  The fitted handset artifact is round-tripped
through the production JS validator.
"""

import json
import pathlib
import subprocess
import sys
import tempfile

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
TOOL = HERE / "mask-calibrate.py"
ROOT = HERE.parents[3]
WIDTH, HEIGHT = 2400, 1080

# Two occluded cells on different grid rows: bright with the mask off, black
# with it on. Nothing gets brighter when masked -- that is the whole point.
CELL_A, CELL_B, SAME_ROW = 30, 50, 31
ON_PIXELS = {CELL_A: (8, 8, 8), CELL_B: (6, 6, 6)}
OFFICE_PIXELS = {CELL_A: (187, 187, 187), CELL_B: (190, 190, 190)}
CAMS_PIXELS = {CELL_A: (169, 169, 169), CELL_B: (152, 152, 152)}
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


def run(args):
    return subprocess.run([sys.executable, str(TOOL), *args],
                          capture_output=True, text=True)


def node(script):
    return subprocess.run(["node", "--input-type=module", "-e", script],
                          capture_output=True, text=True, cwd=ROOT)


def main():
    failures = 0

    def check(label, ok, detail=""):
        nonlocal failures
        if not ok:
            failures += 1
            print(f"FAIL {label} {detail}")

    with tempfile.TemporaryDirectory() as raw_root:
        root = pathlib.Path(raw_root)
        class_dirs = {}
        for label, pixels in (("on", ON_PIXELS), ("office", OFFICE_PIXELS),
                              ("cams", CAMS_PIXELS)):
            directory = root / label
            directory.mkdir()
            for index in range(3):
                build_frame(directory / f"frame-{index}.png", frame_cells(pixels))
            class_dirs[label] = directory
        labelled = [f"{label}={path}" for label, path in class_dirs.items()]

        # -- The occlusion-only fit --------------------------------------------
        fitted = root / "mask-rule.json"
        result = run([*labelled, "--output", str(fitted)])
        check("occlusion-only corpus calibrates", result.returncode == 0, result.stderr)
        artifact = json.loads(fitted.read_text())
        check("status is calibrated", artifact["status"] == "calibrated")
        check("schema is mask-rule-v1", artifact["schema"] == "mask-rule-v1")
        check("fact is maskOn with off/on labels",
              artifact["fact"]["id"] == "maskOn"
              and artifact["fact"]["labels"] == ["off", "on"])
        anchors = artifact["adapter"]["anchors"]
        check("both occluded cells are anchors",
              {a["cell"] for a in anchors} == {CELL_A, CELL_B}, str(anchors))
        check("every anchor is absent polarity",
              all(a["kind"] == "absent" for a in anchors),
              "the mask adds no bright cell")
        check("anchors span two rows", artifact["adapter"]["anchor_rows"] == [1, 2])
        reads = artifact["adapter"]["corpus_reads"]
        check("mask-on frames all read true", reads["on"] == {"true": 3, "false": 0, "unknown": 0})
        check("office frames all read false", reads["office"] == {"true": 0, "false": 3, "unknown": 0})
        check("cams frames all read false", reads["cams"] == {"true": 0, "false": 3, "unknown": 0})
        check("an uncaptured blackout is recorded, not assumed",
              "blackout-unproven" in artifact["adapter"]["limitations"])
        check("an uncaptured mask animation is recorded",
              "animation-unproven" in artifact["adapter"]["limitations"])

        # -- Spread replaces polarity ------------------------------------------
        one_row = root / "one-row"
        one_row.mkdir()
        for label, dark in (("on", True), ("office", False), ("cams", False)):
            directory = one_row / label
            directory.mkdir()
            pixels = {CELL_A: (8, 8, 8), SAME_ROW: (6, 6, 6)} if dark else \
                     {CELL_A: (187, 187, 187), SAME_ROW: (190, 190, 190)}
            for index in range(3):
                build_frame(directory / f"frame-{index}.png", frame_cells(pixels))
        narrow = root / "narrow.json"
        result = run([f"on={one_row / 'on'}", f"office={one_row / 'office'}",
                      f"cams={one_row / 'cams'}", "--output", str(narrow), "--strict"])
        check("anchors confined to one row refuse", result.returncode == 1)
        check("refusal names the spread rule",
              json.loads(narrow.read_text())["reason"] == "anchor-rows-not-spread")

        # -- Refusals -----------------------------------------------------------
        weak = root / "weak"
        weak.mkdir()
        for label in ("on", "office", "cams"):
            directory = weak / label
            directory.mkdir()
            build_frame(directory / "frame-0.png",
                        frame_cells({CELL_A: (10, 10, 10), CELL_B: (11, 11, 11)}))
        refused = root / "refused.json"
        result = run([f"on={weak / 'on'}", f"office={weak / 'office'}",
                      f"cams={weak / 'cams'}", "--output", str(refused), "--strict"])
        check("weak separation refuses", result.returncode == 1)
        check("refusal names the floor", "separation-margin-below-floor" in result.stdout)
        check("refused artifact still written",
              json.loads(refused.read_text())["status"] == "refuse")

        bright_blackout = root / "bright-blackout"
        bright_blackout.mkdir()
        build_frame(bright_blackout / "frame-0.png", frame_cells({}, background=(32, 32, 32)))
        bright = root / "blackout-bright.json"
        result = run([*labelled, f"blackout={bright_blackout}", "--output", str(bright)])
        check("a blackout above the floor refuses",
              json.loads(bright.read_text())["reason"] == "blackout-not-separated")

        missing = root / "missing.json"
        result = run([f"on={class_dirs['on']}", f"office={class_dirs['office']}",
                      "--output", str(missing)])
        check("missing cams class is an error", result.returncode != 0)
        check("error names the missing class", "missing required class" in result.stderr)

        result = run([*labelled, f"weird={class_dirs['on']}", "--output", str(missing)])
        check("unknown class is an error", result.returncode != 0)
        check("error names the unknown class", "unknown class" in result.stderr)

        foreign = root / "foreign.png"
        Image.new("RGB", (100, 100)).save(foreign)
        result = run([f"on={foreign}", f"office={class_dirs['office']}",
                      f"cams={class_dirs['cams']}", "--output", str(missing)])
        check("foreign geometry refused without resizing",
              result.returncode != 0 and "sensor-geometry" in result.stderr)

        # -- Production JS round-trip ------------------------------------------
        check("synthetic fit round-trips through parseMaskRule, and an unproven "
              "guard is refused as a live gate", node(f"""
import {{ readFileSync }} from 'node:fs';
import {{ parseMaskRule, maskRuleDigest, parseCalibrationStateRule }}
  from './packages/play/src/sensors/fnaf2/calibration-state-rule.js';
import {{ monitorRuleDigest }} from './packages/play/src/sensors/fnaf2/monitor-rule.js';
const mask = JSON.parse(readFileSync({json.dumps(str(fitted))}, 'utf8'));
parseMaskRule(mask);
const monitor = JSON.parse(readFileSync('packages/play/profiles/fnaf2/moto-g56/monitor-rule-moto-g56-v207.json', 'utf8'));
const state = {{ schema: 'calibration-state-v1', schema_version: 1, status: 'calibrated',
  fact: {{ id: 'calibrationState', labels: ['NIGHT', 'UP', 'DOWN', 'ON', 'OFF'] }},
  screen: {{ identity: 'FNAF2_NIGHT' }},
  monitor: {{ rule: monitor, digest: monitorRuleDigest(monitor) }},
  mask: {{ rule: mask, digest: maskRuleDigest(mask) }} }};
try {{ parseCalibrationStateRule(state); process.exit(1); }}
catch (error) {{ if (!/unproven darkness guard/.test(error.message)) process.exit(1); }}
""").returncode == 0)

    # -- The fitted handset artifact ------------------------------------------
    handset = ROOT / "packages" / "play" / "profiles" / "fnaf2" / "moto-g56" / "mask-rule-moto-g56-v207.json"
    check("the fitted handset mask rule round-trips", node(f"""
import {{ readFileSync }} from 'node:fs';
import {{ parseMaskRule }} from './packages/play/src/sensors/fnaf2/calibration-state-rule.js';
const rule = parseMaskRule(JSON.parse(readFileSync({json.dumps(str(handset))}, 'utf8')));
if (rule.adapter.anchors.length < 2) process.exit(1);
if (!rule.adapter.anchors.every(anchor => anchor.kind === 'absent')) process.exit(1);
""").returncode == 0)

    if failures:
        print(f"{failures} mask calibrate check(s) failed")
        sys.exit(1)
    print("mask calibrate: occlusion fit, row spread, unproven-guard gate, "
          "refusals, and JS round-trip pass")


if __name__ == "__main__":
    main()
