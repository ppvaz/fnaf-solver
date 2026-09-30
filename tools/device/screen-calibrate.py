#!/usr/bin/env python3
"""Fit the screenIdentity rule over the Companion grid from labelled frames.

WHY THIS EXISTS.  Screen identity was the one fact the host trusted the helper
to decide: `GET` returns `screen=FNAF2_NIGHT|FNAF2_MENU|...` from
`ScreenIdentity.java`, a hand-tuned colour-anchor heuristic, and
`measureCalibrationState` used that field as its positive gate.  Measured
against the attached moto g56 on 2026-09-05 the helper reported
`screen=FNAF2_NIGHT` on 24 consecutive live grids while the operator was
looking at the menu.  A gate that admits the menu is not a gate.

Fitting it host-side fixes a second defect at the same time.  The helper
answers `GET` and `GRID` in two round trips, and its capture advances between
them -- measured 0/12 seq agreement, delta 1-2 frames -- so any rule that
needs the snapshot's `screen` AND the grid's cells refuses every live
observation with `grid-seq-mismatch`.  Deriving screen identity from the same
180 cells as the monitor and mask anchors makes ONE `GRID` response carry all
three facts, from one frame, with one sequence number.

The rule shape is the shared one: per-cell luma/yellowness anchors with
measured thresholds and refuse bands, plus a whole-grid darkness guard.  As
with maskOn the separation is occlusion-shaped rather than additive -- the
menu holds saturated cells the night never lights -- so anchors may be all one
polarity, and what is required instead is spread over at least two grid rows.

Inputs are labelled directories of PNG/raw frames, or a `screen-grid-corpus-v1`
JSON of grids captured through the live helper.  Both are accepted because the
two capture paths were measured equivalent on one screen: between-path
per-cell luma difference averaged 14.1 against within-path temporal spread of
53.7 (screencap) and 65.5 (helper), and was exactly 0 on every cell stable
enough in both paths to compare.

    screen-calibrate.py --output screen-rule.json \
        night=captures/monitor-calibration-20260901 \
        menu=docs/evidence/screen-grids-20260905-moto-g56-menu.json

WHAT THIS RULE CANNOT DO.  It is fitted from the classes it is given.  With a
night and a menu class it separates those two; it does not know a loading
screen, a jumpscare or 6 AM, and it will call an unseen screen a night if the
anchors happen to read that way.  Every class in the corpus is recorded in
`class_counts`, and classes absent from it are recorded as limitations.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys

_SPEC = importlib.util.spec_from_file_location(
    "_monitor_calibrate", pathlib.Path(__file__).with_name("monitor-calibrate.py"))
_MC = importlib.util.module_from_spec(_SPEC)
sys.modules["_monitor_calibrate"] = _MC
_SPEC.loader.exec_module(_MC)

CalibrationError = _MC.CalibrationError
CELL_FEATURES = _MC.CELL_FEATURES
GRID_WIDTH, GRID_HEIGHT = _MC.GRID_WIDTH, _MC.GRID_HEIGHT
WIDTH, HEIGHT = _MC.WIDTH, _MC.HEIGHT

SCHEMA = "screen-rule-v1"
SENSOR_ID = _MC.SENSOR_ID
PROFILE_ID = _MC.PROFILE_ID
POSITIVE = "night"
NEGATIVES = ("menu",)
REQUIRED_LABELS = (POSITIVE,) + NEGATIVES
OPTIONAL_LABELS = ("helper", "loading", "blackout")
UNKNOWN_REASONS = [
    "frame-pending", "frame-stale", "frame-dark", "feature-missing",
    "ambiguous-threshold", "sensor-mismatch", "calibration-refused",
    "screen-rule-absent", "grid-unavailable",
]


def load_class(spec: str):
    """Grids for one label, from frames on disk or a captured grid corpus."""
    label, separator, raw = spec.partition("=")
    if not separator or not _MC.LABEL_RE.fullmatch(label):
        raise CalibrationError(f"labelled source must be LABEL=PATH: {spec!r}")
    root = pathlib.Path(raw)
    if root.is_file() and root.suffix.lower() == ".json":
        document = json.loads(root.read_text())
        if document.get("schema") != "screen-grid-corpus-v1":
            raise CalibrationError(f"{root}: not a screen-grid-corpus-v1 document")
        grids = []
        for frame in document.get("frames", []):
            cells = frame.get("cells")
            if not isinstance(cells, list) or len(cells) != GRID_WIDTH * GRID_HEIGHT:
                raise CalibrationError(f"{root}: a frame does not carry the 180-cell sensor")
            grids.append([((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff) for v in cells])
        if not grids:
            raise CalibrationError(f"{root}: corpus carries no frames")
        return label, grids
    _, paths = _MC.paths_for(spec)
    return label, [_MC.grid_cells(_MC.load_frame(path)) for path in paths]


def calibrate(args) -> None:
    sources = [load_class(spec) for spec in args.labelled]
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
            f"unknown class(es) {', '.join(unknown)}; the screenIdentity fact is fixed")

    cell_frames = {label: grids for label, grids in sources}
    counts = {label: len(grids) for label, grids in sources}
    negatives = tuple(label for label in labels if label != POSITIVE)

    candidates = []
    for cell in range(GRID_WIDTH * GRID_HEIGHT):
        for feature in CELL_FEATURES:
            anchor = _MC.fit_anchor(cell_frames, cell, feature, args.min_margin,
                                    positive=POSITIVE, negatives=negatives)
            if anchor is not None:
                candidates.append(anchor)
    candidates.sort(key=lambda a: (-a.separation_margin, a.cell, a.feature))
    selected, seen = [], set()
    for anchor in candidates:
        if anchor.cell in seen:
            continue
        selected.append(anchor)
        seen.add(anchor.cell)
        if len(selected) >= args.max_anchors:
            break
    selected.sort(key=lambda a: (a.cell, a.feature))
    rows = {anchor.cell // GRID_WIDTH for anchor in selected}

    limitations = list(args.note) if args.note else []
    for absent in OPTIONAL_LABELS:
        if absent not in counts:
            limitations.append(f"{absent}-class-absent")
    reason = None
    if not candidates:
        reason = "separation-margin-below-floor"
    elif len(selected) < 2:
        reason = "anchor-selection-insufficient"
    elif len(rows) < 2:
        reason = "anchor-rows-not-spread"
    accepted = reason is None

    guard_floor = min(_MC.grid_luma(grid) for label in REQUIRED_LABELS
                      for grid in cell_frames[label])

    corpus_reads = {}
    if accepted:
        for label in labels:
            reads = {"true": 0, "false": 0, "unknown": 0}
            for grid in cell_frames[label]:
                reads[_MC.rule_reads(selected, grid)] += 1
            corpus_reads[label] = reads
        expected = {label: ("true" if label == POSITIVE else "false") for label in labels}
        if any(corpus_reads[label][verdict] != counts[label]
               for label, verdict in expected.items()):
            reason = "calibration-refused"
            accepted = False

    output = {
        "schema": SCHEMA,
        "schema_version": 1,
        "status": "calibrated" if accepted else "refuse",
        "reason": None if accepted else reason,
        "fact": {
            "id": "screenIdentity",
            "labels": ["FNAF2_NIGHT", "FNAF2_MENU"],
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
            "anchor_rows": sorted(rows),
            "selection": ("per-cell luma/yellowness worst-case gap, top margins, "
                          f"max {args.max_anchors} anchors over >=2 grid rows"),
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
        "guard_floor": guard_floor, "classes": counts,
        "output": str(destination),
    }, sort_keys=True))
    if not accepted and args.strict:
        raise SystemExit(1)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--sensor-id", default=SENSOR_ID)
    parser.add_argument("--profile-id", default=PROFILE_ID)
    parser.add_argument("--min-margin", type=float, default=5.0)
    parser.add_argument("--max-anchors", type=int, default=6)
    parser.add_argument("--note", action="append", default=[])
    parser.add_argument("--strict", action="store_true",
                        help="exit 1 when calibration emits status=refuse")
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
