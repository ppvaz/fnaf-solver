#!/usr/bin/env python3
"""Fit the monitorUp anchor rule over the Companion grid from labelled frames.

The monitor's map layout drawing is present if and only if the monitor is up,
independent of the camera feed behind it.  This tool searches the helper's
20x9 point-sampled grid -- cell by cell, luma and yellowness -- for the cells
that separate labelled monitor-up frames from office-down and mask frames,
and emits the versioned ``monitor-rule-v1`` artifact that
``packages/play/src/sensors/fnaf2/monitor-rule.ts`` consumes.  The runtime reads those
anchor cells through the existing ``GRID`` verb; no APK change is required.

Rule semantics are strict: a frame is monitor-up only when every anchor reads
its up side, monitor-down only when every anchor reads firmly not-up, and
UNKNOWN otherwise -- mixed evidence never votes.  If no anchor set clears the
requested margin the artifact is still written, but with ``status: refuse``;
a refused rule is evidence, never a decision.

Fit classes are fixed because the fact is: ``up``, ``down``, ``mask`` are
required; optional ``anim`` frames are classified with the fitted rule and
the reads are retained as evidence; optional ``blackout`` frames must sit
below the darkness guard floor.

The grid replication below must stay mechanically aligned with the FNaF 2
legacy readers (Fnaf2Legacy.sampleGrid, PixelWatch.gridSampleX/Y): cell
(gx, gy) samples the native pixel
    x = ((2*gx + 1) * width) // (2 * VISUAL_WIDTH)
    y = ((2*gy + 1) * height) // (2 * VISUAL_HEIGHT)
with VISUAL_WIDTH x VISUAL_HEIGHT = 20x9. The near-grey cell count
(25-channel spread) was a helper field until 2026-09-27 (ScreenStats, removed
with the discontinued grid statistics); this tool keeps its own copy for
fitting over retained frames.

    monitor-calibrate.py --output monitor-rule.json \
        down=captures/office up=captures/monitor mask=captures/mask

Inputs are labelled PNGs or Android RGBA8888/RGBX8888 ``.raw`` screencaps.
Foreign geometry is refused, never resized: resizing would calibrate a
different sensor.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import struct
from dataclasses import dataclass

try:
    from PIL import Image
except ImportError as error:  # pragma: no cover - exercised by the CLI
    Image = None
    PIL_ERROR = error

WIDTH = 2400
HEIGHT = 1080
SCHEMA = "monitor-rule-v1"
SENSOR_ID = "cue-helper-mediaprojection-2400x1080"
PROFILE_ID = "moto-g56-v207-landscape"
GRID_WIDTH = 20
GRID_HEIGHT = 9
REQUIRED_LABELS = ("down", "mask", "up")
OPTIONAL_LABELS = ("anim", "blackout")
UNKNOWN_REASONS = [
    "frame-pending", "frame-stale", "screen-identity", "frame-dark",
    "feature-missing", "ambiguous-threshold", "sensor-mismatch",
    "calibration-refused", "monitor-rule-absent", "monitor-state-unavailable",
    "grid-seq-mismatch", "grid-unavailable",
]
CELL_FEATURES = {
    "luma": lambda rgb: (77 * rgb[0] + 150 * rgb[1] + 29 * rgb[2]) >> 8,
    "yellowness": lambda rgb: min(rgb[0], rgb[1]) - rgb[2],
}
LABEL_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class CalibrationError(ValueError):
    pass


def load_raw(path: pathlib.Path) -> "Image.Image":
    data = path.read_bytes()
    if len(data) < 16:
        raise CalibrationError(f"{path}: truncated raw screencap header")
    width, height, pixel_format, _ = struct.unpack_from("<IIII", data)
    if (width, height) != (WIDTH, HEIGHT):
        raise CalibrationError(
            f"{path}: sensor-geometry {width}x{height}; expected {WIDTH}x{HEIGHT}")
    if pixel_format not in (1, 2):
        raise CalibrationError(f"{path}: unsupported raw pixel format {pixel_format}")
    size = WIDTH * HEIGHT * 4
    if len(data) < 16 + size:
        raise CalibrationError(f"{path}: truncated raw pixels")
    return Image.frombytes("RGBA", (WIDTH, HEIGHT), data[16:16 + size]).convert("RGB")


def load_frame(path: pathlib.Path) -> "Image.Image":
    if Image is None:
        raise CalibrationError(f"Pillow is required to read frames: {PIL_ERROR}")
    if path.suffix.lower() == ".raw":
        return load_raw(path)
    if path.suffix.lower() != ".png":
        raise CalibrationError(f"{path}: expected .png or .raw")
    try:
        image = Image.open(path).convert("RGB")
    except OSError as error:
        raise CalibrationError(f"{path}: unreadable frame: {error}") from error
    if image.size != (WIDTH, HEIGHT):
        raise CalibrationError(
            f"{path}: sensor-geometry {image.width}x{image.height}; "
            f"expected {WIDTH}x{HEIGHT}")
    return image


def paths_for(spec: str) -> tuple[str, list[pathlib.Path]]:
    label, separator, raw_path = spec.partition("=")
    if not separator or not LABEL_RE.fullmatch(label):
        raise CalibrationError(f"labelled source must be LABEL=PATH: {spec!r}")
    root = pathlib.Path(raw_path)
    if root.is_dir():
        paths = sorted(
            p for p in root.rglob("*")
            if p.is_file() and p.suffix.lower() in {".png", ".raw"})
    elif root.is_file():
        paths = [root]
    else:
        raise CalibrationError(f"{root}: no such frame or directory")
    if not paths:
        raise CalibrationError(f"{root}: no .png or .raw frames")
    return label, paths


def grid_cells(image: "Image.Image") -> list[tuple[int, int, int]]:
    """The helper's exact 20x9 point-sampling, cell centres on native frames."""
    cells = []
    for gy in range(GRID_HEIGHT):
        y = min(HEIGHT - 1, ((2 * gy + 1) * HEIGHT) // (2 * GRID_HEIGHT))
        for gx in range(GRID_WIDTH):
            x = min(WIDTH - 1, ((2 * gx + 1) * WIDTH) // (2 * GRID_WIDTH))
            cells.append(image.getpixel((x, y)))
    return cells


def grid_luma(cells: list[tuple[int, int, int]]) -> int:
    """Whole-grid mean luma, the darkness guard feature (never a classifier)."""
    total = sum((77 * r + 150 * g + 29 * b) >> 8 for r, g, b in cells)
    return total // len(cells)


def cell_native_xy(cell: int) -> tuple[int, int]:
    gx, gy = cell % GRID_WIDTH, cell // GRID_WIDTH
    x = min(WIDTH - 1, ((2 * gx + 1) * WIDTH) // (2 * GRID_WIDTH))
    y = min(HEIGHT - 1, ((2 * gy + 1) * HEIGHT) // (2 * GRID_HEIGHT))
    return x, y


@dataclass(frozen=True)
class Anchor:
    """One grid cell whose measured value separates up from down and mask."""

    cell: int
    x: int
    y: int
    feature: str
    kind: str  # "present": bright when up; "absent": dark (covered) when up
    threshold: float
    refuse_band: float
    separation_margin: float
    up_range: tuple[int, int]
    not_up: dict

    def reads(self, cells: list[tuple[int, int, int]]) -> str:
        value = CELL_FEATURES[self.feature](cells[self.cell])
        if self.kind == "present":
            if value >= self.threshold + self.refuse_band:
                return "up"
            if value <= self.threshold - self.refuse_band:
                return "not-up"
        else:
            if value <= self.threshold - self.refuse_band:
                return "up"
            if value >= self.threshold + self.refuse_band:
                return "not-up"
        return "in-band"

    def record(self) -> dict:
        return {
            "cell": self.cell, "x": self.x, "y": self.y,
            "feature": self.feature, "kind": self.kind,
            "rule": {"kind": "threshold", "threshold": self.threshold,
                     "refuse_band": self.refuse_band},
            "separation_margin": self.separation_margin,
            "up_range": list(self.up_range), "not_up": self.not_up,
        }


def fit_anchor(cell_frames: dict, cell: int, feature: str,
               min_margin: float, positive: str = "up",
               negatives: tuple[str, ...] = ("down", "mask")) -> Anchor | None:
    """Midpoint threshold over the worst-case positive/negative gap for one cell.

    ``not_up`` pools the negative classes per class; the gap must hold against
    every one of them. Anchors are inclusive at both edges: the worst positive
    frame and the worst negative frame classify, values between are in-band.

    ``positive``/``negatives`` name the fact being fitted. They default to the
    monitorUp split so this module's own CLI is unchanged; `mask-calibrate.py`
    passes the maskOn split. The record's ``up_range``/``not_up`` field names
    are the shared artifact shape and read as positive/negative for any fact.
    """
    up = [CELL_FEATURES[feature](cells[cell]) for cells in cell_frames[positive]]
    up_lo, up_hi = min(up), max(up)
    not_up = {}
    for label in negatives:
        values = [CELL_FEATURES[feature](cells[cell]) for cells in cell_frames[label]]
        not_up[label] = (min(values), max(values))
    neg_hi = max(hi for _, hi in not_up.values())
    neg_lo = min(lo for lo, _ in not_up.values())
    if up_hi < neg_lo:
        kind, gap, edge_up, edge_neg = "absent", neg_lo - up_hi, up_hi, neg_lo
    elif up_lo > neg_hi:
        kind, gap, edge_up, edge_neg = "present", up_lo - neg_hi, up_lo, neg_hi
    else:
        return None
    band = gap / 2.0
    if band < min_margin:
        return None
    x, y = cell_native_xy(cell)
    return Anchor(
        cell=cell, x=x, y=y, feature=feature, kind=kind,
        threshold=round((edge_up + edge_neg) / 2.0, 3),
        refuse_band=round(band, 3),
        separation_margin=round(band, 3),
        up_range=(up_lo, up_hi), not_up=not_up)


def rule_reads(anchors: list[Anchor], cells: list[tuple[int, int, int]]) -> str:
    readings = [anchor.reads(cells) for anchor in anchors]
    if all(reading == "up" for reading in readings):
        return "true"
    if all(reading == "not-up" for reading in readings):
        return "false"
    return "unknown"


def calibrate(args) -> None:
    sources = [paths_for(spec) for spec in args.labelled]
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
            f"unknown class(es) {', '.join(unknown)}; the monitorUp fact is fixed")

    excluded_rows = set()
    for part in (args.exclude_rows or "").split(","):
        if part.strip():
            row = int(part)
            if not 0 <= row < GRID_HEIGHT:
                raise CalibrationError(f"excluded row {row} is outside the 20x9 grid")
            excluded_rows.add(row)
    excluded_cells = {cell for cell in range(GRID_WIDTH * GRID_HEIGHT)
                      if cell // GRID_WIDTH in excluded_rows}

    cell_frames: dict[str, list[list[tuple[int, int, int]]]] = {label: [] for label in labels}
    counts: dict[str, int] = {}
    for label, paths in sources:
        counts[label] = len(paths)
        for path in paths:
            cell_frames[label].append(grid_cells(load_frame(path)))

    candidates = []
    for cell in range(GRID_WIDTH * GRID_HEIGHT):
        if cell in excluded_cells:
            continue
        for feature in CELL_FEATURES:
            anchor = fit_anchor(cell_frames, cell, feature, args.min_margin)
            if anchor is not None:
                candidates.append(anchor)
    candidates.sort(key=lambda a: (-a.separation_margin, a.cell, a.feature))
    selected = []
    seen_cells = set()
    for anchor in candidates:  # best margins first, one anchor per cell
        if anchor.kind == "present" and \
                sum(1 for a in selected if a.kind == "present") >= args.max_present:
            continue
        if anchor.kind == "absent" and \
                sum(1 for a in selected if a.kind == "absent") >= args.max_absent:
            continue
        if anchor.cell in seen_cells:
            continue
        selected.append(anchor)
        seen_cells.add(anchor.cell)
        if len(selected) >= args.max_present + args.max_absent:
            break
    selected.sort(key=lambda a: (a.cell, a.feature))
    present = [a for a in selected if a.kind == "present"]
    absent = [a for a in selected if a.kind == "absent"]

    limitations = list(args.note) if args.note else []
    if excluded_rows:
        limitations.append(f"grid-rows-{sorted(excluded_rows)}-excluded")
    reason = None
    if not candidates:
        reason = "separation-margin-below-floor"
    elif not present or not absent:
        reason = "anchor-selection-insufficient"
    accepted = reason is None

    guard_floor = min(grid_luma(cells) for label in REQUIRED_LABELS
                      for cells in cell_frames[label])

    corpus_reads: dict[str, dict[str, int]] = {}
    if accepted:
        for label in REQUIRED_LABELS:
            reads: dict[str, int] = {"true": 0, "false": 0, "unknown": 0}
            for cells in cell_frames[label]:
                reads[rule_reads(selected, cells)] += 1
            corpus_reads[label] = reads
        expected = {"up": "true", "down": "false", "mask": "false"}
        if any(corpus_reads[label][verdict] != counts[label]
               for label, verdict in expected.items()):
            reason = "calibration-refused"
            accepted = False

    anim_reads = None
    if "anim" in counts:
        anim_reads = {"true": 0, "false": 0, "unknown": 0}
        if accepted:
            for cells in cell_frames["anim"]:
                anim_reads[rule_reads(selected, cells)] += 1
    else:
        limitations.append("animation-unproven")

    if "blackout" in counts:
        blackout_max = max(grid_luma(cells) for cells in cell_frames["blackout"])
        if blackout_max >= guard_floor:
            if accepted:
                reason = "blackout-not-separated"
                accepted = False
    else:
        limitations.append("blackout-unproven")

    output = {
        "schema": SCHEMA,
        "schema_version": 1,
        "status": "calibrated" if accepted else "refuse",
        "reason": None if accepted else reason,
        "fact": {
            "id": "monitorUp",
            "labels": sorted(counts),
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
            "selection": ("per-cell luma/yellowness worst-case gap, top margins, "
                          f"max {args.max_present} present + {args.max_absent} absent"),
            "limitations": limitations,
        },
    }
    destination = pathlib.Path(args.output)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "status": output["status"], "reason": output["reason"],
        "anchors": len(selected),
        "margins": [anchor.separation_margin for anchor in selected],
        "guard_floor": guard_floor, "output": str(destination),
    }, sort_keys=True))
    if not accepted and args.strict:
        raise SystemExit(1)


def add_common_arguments(parser, sensor_id, profile_id, *, note=True):
    """The CLI core every calibrate fitter shares.

    All five fitters declared these five options identically -- same flag,
    same type, same default, same help -- beside their own one or two. The
    copies were the argparse block, not the fit: the fit has been shared by
    import since mask-calibrate.py. Each caller still adds its own extra
    options and its own `labelled` positional, whose metavar differs.
    """
    parser.add_argument("--output", required=True, type=pathlib.Path)
    parser.add_argument("--sensor-id", default=sensor_id)
    parser.add_argument("--profile-id", default=profile_id)
    parser.add_argument("--min-margin", type=float, default=5.0)
    if note:
        parser.add_argument("--note", action="append", default=[],
                            help="retained as a limitation in the artifact")
    parser.add_argument("--strict", action="store_true",
                        help="exit 1 when calibration emits status=refuse")
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser()
    add_common_arguments(parser, SENSOR_ID, PROFILE_ID)
    parser.add_argument("--max-present", type=int, default=4)
    parser.add_argument("--max-absent", type=int, default=2)
    parser.add_argument("--exclude-rows", default="",
                        help="comma-separated grid rows to exclude from the search "
                             "(e.g. an on-screen tutorial overlay strip)")
    parser.add_argument("labelled", nargs="+", metavar="LABEL=PATH")
    args = parser.parse_args(argv)
    if args.min_margin < 0:
        parser.error("--min-margin must be non-negative")
    if args.max_present < 1 or args.max_absent < 1:
        parser.error("anchor budgets must each be at least one")
    try:
        calibrate(args)
    except CalibrationError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
