#!/usr/bin/env python3
"""Fit the maskOn anchor rule over the Companion grid from labelled frames.

The Freddy mask is OPAQUE: putting it on blacks out the office everywhere
except its two eye holes.  This tool searches the helper's 20x9 point-sampled
grid -- cell by cell, luma and yellowness -- for the cells that separate
labelled mask-on frames from mask-off frames, and emits the versioned
``mask-rule-v1`` artifact that
``packages/play/src/sensors/fnaf2/calibration-state-rule.js`` consumes alongside the
already-fitted ``monitor-rule-v1``.  The runtime reads those anchor cells
through the existing ``GRID`` verb; no APK change is required.

THE MASK IS NOT ADDITIVE, AND THAT SHAPES THE RULE.  When the monitor rises
its map drawing is *added*: some cells go bright and others are covered, so
`monitor-calibrate.py` can demand one anchor of each polarity.  The mask adds
nothing.  Its body is black and its two eye holes show the SAME office as the
unmasked frame, so no cell is brighter with the mask on -- measured on the
20260901 corpus, the best positive gap over all 180 cells x both features is
0/255.  A maskOn rule is therefore occlusion-only (``absent`` anchors), and an
eye-hole anchor would be worse than useless: reading bright in BOTH states, it
would make mask-off resolve ambiguous instead of OBSERVED false.

What replaces the polarity requirement is spread: at least two anchors over at
least two grid rows, so a single occluded strip cannot carry the whole verdict.

THE REMAINING HAZARD IS DARKNESS, NOT POLARITY.  A frame with the mask on and
a frame with the screen blacked out both read "almost everything is black";
only the whole-grid darkness guard separates them.  Until a ``blackout`` class
is supplied the guard floor is unproven, the artifact records the
``blackout-unproven`` limitation, and `parseCalibrationStateRule` refuses to
bind it as a live calibration-state rule.  The artifact is evidence either
way; it is a decision only once the floor is measured.

Fit classes: ``on`` (mask on) is required, and the mask-off side must be given
as both ``office`` (monitor down) and ``cams`` (monitor up) so the rule holds
in both monitor states the seam runner admits.  Optional ``anim`` frames are
the MASK-RAISE transient specifically -- not the monitor animation, which is a
different fact -- classified with the fitted rule and retained as evidence;
optional ``blackout`` frames must sit below the darkness guard floor.

    mask-calibrate.py --output mask-rule.json \
        on=captures/mask office=captures/office cams=captures/monitor

Inputs are labelled PNGs or Android RGBA8888/RGBX8888 ``.raw`` screencaps.
Foreign geometry is refused, never resized: resizing would calibrate a
different sensor.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys

# One fitting algorithm, not two: the per-cell worst-case-gap fit, the grid
# replication and the frame loaders all live in monitor-calibrate.py and are
# imported here. The module name is hyphenated, so it is loaded by path.
_SPEC = importlib.util.spec_from_file_location(
    "_monitor_calibrate", pathlib.Path(__file__).with_name("monitor-calibrate.py"))
_MC = importlib.util.module_from_spec(_SPEC)
sys.modules["_monitor_calibrate"] = _MC
_SPEC.loader.exec_module(_MC)

CalibrationError = _MC.CalibrationError
CELL_FEATURES = _MC.CELL_FEATURES
GRID_WIDTH, GRID_HEIGHT = _MC.GRID_WIDTH, _MC.GRID_HEIGHT
WIDTH, HEIGHT = _MC.WIDTH, _MC.HEIGHT

SCHEMA = "mask-rule-v1"
SENSOR_ID = _MC.SENSOR_ID
PROFILE_ID = _MC.PROFILE_ID
POSITIVE = "on"
NEGATIVES = ("office", "cams")
REQUIRED_LABELS = (POSITIVE,) + NEGATIVES
OPTIONAL_LABELS = ("anim", "blackout")
# Must stay a subset of MASK_UNKNOWN_REASONS in calibration-state-rule.js.
UNKNOWN_REASONS = [
    "frame-pending", "frame-stale", "screen-identity", "frame-dark",
    "feature-missing", "ambiguous-threshold", "sensor-mismatch",
    "calibration-refused", "mask-rule-absent", "monitor-state-unavailable",
    "grid-seq-mismatch", "grid-unavailable",
]


def calibrate(args) -> None:
    sources = [_MC.paths_for(spec) for spec in args.labelled]
    labels = [label for label, _ in sources]
    if len(set(labels)) != len(labels):
        raise CalibrationError("each label may appear only once")
    missing = [label for label in REQUIRED_LABELS if label not in labels]
    if missing:
        raise CalibrationError(f"missing required class(es): {', '.join(missing)}")
    unknown = [label for label in labels
               if label not in REQUIRED_LABELS and label not in OPTIONAL_LABELS]
    if unknown:
        raise CalibrationError(
            f"unknown class(es) {', '.join(unknown)}; the maskOn fact is fixed")

    excluded_rows = set()
    for part in (args.exclude_rows or "").split(","):
        if part.strip():
            row = int(part)
            if not 0 <= row < GRID_HEIGHT:
                raise CalibrationError(f"excluded row {row} is outside the 20x9 grid")
            excluded_rows.add(row)
    excluded_cells = {cell for cell in range(GRID_WIDTH * GRID_HEIGHT)
                      if cell // GRID_WIDTH in excluded_rows}

    cell_frames: dict[str, list] = {label: [] for label in labels}
    counts: dict[str, int] = {}
    for label, paths in sources:
        counts[label] = len(paths)
        for path in paths:
            cell_frames[label].append(_MC.grid_cells(_MC.load_frame(path)))

    candidates = []
    for cell in range(GRID_WIDTH * GRID_HEIGHT):
        if cell in excluded_cells:
            continue
        for feature in CELL_FEATURES:
            anchor = _MC.fit_anchor(cell_frames, cell, feature, args.min_margin,
                                    positive=POSITIVE, negatives=NEGATIVES)
            if anchor is not None:
                candidates.append(anchor)
    candidates.sort(key=lambda a: (-a.separation_margin, a.cell, a.feature))
    selected = []
    seen_cells = set()
    for anchor in candidates:  # best margins first, one anchor per cell
        if anchor.cell in seen_cells:
            continue
        selected.append(anchor)
        seen_cells.add(anchor.cell)
        if len(selected) >= args.max_anchors:
            break
    selected.sort(key=lambda a: (a.cell, a.feature))
    rows = {anchor.cell // GRID_WIDTH for anchor in selected}

    limitations = list(args.note) if args.note else []
    if excluded_rows:
        limitations.append(f"grid-rows-{sorted(excluded_rows)}-excluded")
    reason = None
    if not candidates:
        reason = "separation-margin-below-floor"
    elif len(selected) < 2:
        reason = "anchor-selection-insufficient"
    elif len(rows) < 2:
        # One occluded strip must not carry the whole verdict; see the module
        # docstring on why this replaces the monitor rule's polarity demand.
        reason = "anchor-rows-not-spread"
    accepted = reason is None

    guard_floor = min(_MC.grid_luma(cells) for label in REQUIRED_LABELS
                      for cells in cell_frames[label])

    corpus_reads: dict[str, dict[str, int]] = {}
    if accepted:
        for label in REQUIRED_LABELS:
            reads: dict[str, int] = {"true": 0, "false": 0, "unknown": 0}
            for cells in cell_frames[label]:
                reads[_MC.rule_reads(selected, cells)] += 1
            corpus_reads[label] = reads
        expected = {POSITIVE: "true", "office": "false", "cams": "false"}
        if any(corpus_reads[label][verdict] != counts[label]
               for label, verdict in expected.items()):
            reason = "calibration-refused"
            accepted = False

    anim_reads = None
    if "anim" in counts:
        anim_reads = {"true": 0, "false": 0, "unknown": 0}
        if accepted:
            for cells in cell_frames["anim"]:
                anim_reads[_MC.rule_reads(selected, cells)] += 1
    else:
        limitations.append("animation-unproven")

    if "blackout" in counts:
        blackout_max = max(_MC.grid_luma(cells) for cells in cell_frames["blackout"])
        if blackout_max >= guard_floor:
            if accepted:
                reason = "blackout-not-separated"
                accepted = False
    else:
        # The load-bearing limitation for this fact: with the mask on almost
        # every cell is black, so only the guard tells mask-on from a dark
        # screen. Until it is measured this artifact cannot be bound live.
        limitations.append("blackout-unproven")

    output = {
        "schema": SCHEMA,
        "schema_version": 1,
        "status": "calibrated" if accepted else "refuse",
        "reason": None if accepted else reason,
        "fact": {
            "id": "maskOn",
            "labels": ["off", "on"],
            "unknown_reasons": UNKNOWN_REASONS,
        },
        "sensor": {
            "id": args.sensor_id,
            "geometry": [WIDTH, HEIGHT],
            "sampling": "helper-grid-20x9-cell-center",
            "profile_id": args.profile_id,
        },
        "adapter": {
            "anchors": [anchor.record() for anchor in selected],
            "guard": {
                "feature": "helper_grid_mean_luma",
                "kind": "floor",
                "min": guard_floor,
                "reason": "frame-dark",
            },
            "minimum_margin": args.min_margin,
            "calibration_frames": sum(counts.values()),
            "class_counts": counts,
            "corpus_reads": corpus_reads,
            "anim_reads": anim_reads,
            "anchor_rows": sorted(rows),
            "selection": ("per-cell luma/yellowness worst-case gap, top margins, "
                          f"max {args.max_anchors} anchors over >=2 grid rows; "
                          "occlusion-only, the mask adds no bright cell"),
            "limitations": limitations,
        },
    }
    destination = pathlib.Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "status": output["status"], "reason": output["reason"],
        "anchors": len(selected), "rows": sorted(rows),
        "margins": [anchor.separation_margin for anchor in selected],
        "guard_floor": guard_floor, "output": str(destination),
    }, sort_keys=True))
    if not accepted and args.strict:
        raise SystemExit(1)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    _MC.add_common_arguments(parser, SENSOR_ID, PROFILE_ID)
    parser.add_argument("--max-anchors", type=int, default=6)
    parser.add_argument("--exclude-rows", default="",
                        help="comma-separated grid rows to exclude from the search "
                             "(e.g. the persistent on-screen control strip)")
    parser.add_argument("labelled", nargs="+", metavar="LABEL=PATH")
    args = parser.parse_args(argv)
    if args.min_margin < 0:
        parser.error("--min-margin must be non-negative")
    if args.max_anchors < 2:
        parser.error("--max-anchors must be at least two")
    try:
        calibrate(args)
    except CalibrationError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
