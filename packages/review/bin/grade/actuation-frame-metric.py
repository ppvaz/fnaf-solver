#!/usr/bin/env python3
"""Report native-frame state coverage for one physical actuation.

The frame trace is the Companion's native-resolution 2400x1080 ImageReader
stream.  This
tool applies the native fixed bottom-control strokes when a v3 trace carries
them, and falls back to the checked-in monitor and mask anchor rules for older
traces. It reports the percentage of frames on which the combined control
state is UNKNOWN. A positive observation of one exclusive control safely
complements the other; a negative observation never invents its opposite.

The trace path intentionally records ``screen_identity=UNKNOWN`` so it can
drain every ImageReader frame without running the live detector stack.  For
v3 traces, the offline metric uses the native fixed-stroke observations and
does not use that field as a screen gate.  Older traces without those stroke
columns use the checked-in fitted anchors as a compatibility fallback.  This
is a measurement of trace coverage, not a promotion of an unqualified rule to
live control authority.

Usage:
    actuation-frame-metric.py TRACE [--start-ns N] [--end-ns N] [--json]

When no bounds are supplied the report is explicitly ``scope=full-trace``;
callers should use bounds that cover the actuation itself when setup frames
are present in the capture.
"""

from __future__ import annotations

import argparse
import collections
import json
import pathlib
import sys
from dataclasses import dataclass


ROOT = pathlib.Path(__file__).resolve().parents[4]
PLAY_PROFILES = ROOT / "packages" / "play" / "profiles" / "fnaf2" / "moto-g56"
DEFAULT_MONITOR = PLAY_PROFILES / "monitor-rule-moto-g56-v207.json"
DEFAULT_MASK = PLAY_PROFILES / "mask-rule-moto-g56-v207.json"
GRID_CELLS = 20 * 9
GRID_HEX_WIDTH = GRID_CELLS * 6
STROKE_VISIBLE_MIN = 100
STROKE_ABSENT_MAX = 40


class MetricError(ValueError):
    pass


def luma(rgb: int) -> int:
    red = (rgb >> 16) & 0xff
    green = (rgb >> 8) & 0xff
    blue = rgb & 0xff
    return (77 * red + 150 * green + 29 * blue) >> 8


def read_rule(path: pathlib.Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise MetricError(f"cannot read rule {path}: {error}") from error
    if value.get("status") != "calibrated":
        raise MetricError(f"rule {path} is not calibrated")
    if value.get("schema") not in {"monitor-rule-v1", "mask-rule-v1"}:
        raise MetricError(f"rule {path} has an unsupported schema")
    return value


def parse_cells(raw: str) -> list[int]:
    if len(raw) != GRID_HEX_WIDTH:
        raise MetricError(
            f"grid_hex has {len(raw)} hex characters; expected {GRID_HEX_WIDTH}")
    try:
        return [int(raw[index:index + 6], 16)
                for index in range(0, GRID_HEX_WIDTH, 6)]
    except ValueError as error:
        raise MetricError("grid_hex contains a non-hex value") from error


def parse_trace(path: pathlib.Path) -> tuple[dict, list[dict]]:
    try:
        lines = path.read_text().splitlines()
    except OSError as error:
        raise MetricError(f"cannot read trace {path}: {error}") from error
    if len(lines) < 2 or not lines[0].startswith("# schema=fnaf2-frame-trace-v"):
        raise MetricError(f"{path}: not a fnaf2-frame-trace-v1 trace")
    header = {}
    for field in lines[0][2:].split():
        key, separator, value = field.partition("=")
        if separator:
            header[key] = value
    columns = lines[1].split("\t")
    required = {"image_ns", "grid_mean_luma", "screen_identity", "mask_luma",
                "monitor_luma", "grid_hex"}
    if not required.issubset(columns):
        raise MetricError(f"{path}: trace columns do not carry the required state fields")
    index = {name: columns.index(name) for name in required}
    if "elapsed_ns" in columns:
        index["elapsed_ns"] = columns.index("elapsed_ns")
    if "seq" in columns:
        index["seq"] = columns.index("seq")
    stroke_columns = {"mask_downstroke", "monitor_downstroke"}.intersection(columns)
    if stroke_columns and stroke_columns != {"mask_downstroke", "monitor_downstroke"}:
        raise MetricError(f"{path}: trace carries only one native stroke column")
    for name in stroke_columns:
        index[name] = columns.index(name)
    rows = []
    for line_number, line in enumerate(lines[2:], 3):
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) != len(columns):
            raise MetricError(f"{path}:{line_number}: wrong column count")
        try:
            rows.append({
                "seq": int(fields[index["seq"]]) if "seq" in index else None,
                "image_ns": int(fields[index["image_ns"]]),
                "grid_mean_luma": int(fields[index["grid_mean_luma"]]),
                "screen_identity": int(fields[index["screen_identity"]]),
                "mask_luma": int(fields[index["mask_luma"]]),
                "monitor_luma": int(fields[index["monitor_luma"]]),
                "cells": parse_cells(fields[index["grid_hex"]]),
            })
            if "elapsed_ns" in index:
                rows[-1]["elapsed_ns"] = int(fields[index["elapsed_ns"]])
            for name in stroke_columns:
                rows[-1][name] = int(fields[index[name]])
        except ValueError as error:
            raise MetricError(f"{path}:{line_number}: invalid numeric field") from error
    if not rows:
        raise MetricError(f"{path}: trace contains no frames")
    return header, rows


@dataclass(frozen=True)
class State:
    value: bool | None
    reason: str | None = None


def classify(rule: dict, cells: list[int]) -> State:
    guard = rule["adapter"]["guard"]
    if sum(luma(cell) for cell in cells) // len(cells) < guard["min"]:
        return State(None, "frame-dark")
    readings = []
    for anchor in rule["adapter"]["anchors"]:
        value = luma(cells[anchor["cell"]])
        threshold = anchor["rule"]["threshold"]
        band = anchor["rule"]["refuse_band"]
        positive = value >= threshold + band if anchor["kind"] == "present" \
            else value <= threshold - band
        negative = value <= threshold - band if anchor["kind"] == "present" \
            else value >= threshold + band
        if positive == negative:
            return State(None, "ambiguous-threshold")
        readings.append(positive)
    if not readings or any(value != readings[0] for value in readings[1:]):
        return State(None, "ambiguous-threshold")
    return State(readings[0])


def classify_native_strokes(mask_stroke: int, monitor_stroke: int) -> State:
    """Classify the exclusive monitor state from the fixed native strokes."""
    if mask_stroke < 0 or monitor_stroke < 0:
        return State(None, "native-stroke-unavailable")
    if (mask_stroke <= STROKE_ABSENT_MAX and
            monitor_stroke >= STROKE_VISIBLE_MIN):
        return State(True, "native-stroke-monitor-up")
    if (mask_stroke >= STROKE_VISIBLE_MIN and
            monitor_stroke >= STROKE_VISIBLE_MIN):
        return State(False, "native-stroke-office")
    return State(None, "native-stroke-ambiguous")


def classify_native_mask(monitor: State) -> State:
    """The tested exclusive control states both imply mask-down."""
    if monitor.value is not None:
        return State(False, "native-stroke-mask-complement")
    return State(None, "native-stroke-mask-ambiguous")


def reconcile(monitor: State, mask: State) -> State:
    if monitor.value is True and mask.value is True:
        return State(None, "mask-monitor-contradiction")
    if monitor.value is True and mask.value is None:
        return State(True, "mask-off-monitor-complement")
    if monitor.value is None and mask.value is True:
        return State(False, "monitor-down-mask-complement")
    if monitor.value is not None and mask.value is not None:
        return State(True, "observed")
    if monitor.value is None and mask.value is None:
        return State(None, "monitor-and-mask-unknown")
    return State(None, "monitor-unknown" if monitor.value is None
                 else "mask-unknown")


def pct(count: int, total: int) -> float:
    return round(100.0 * count / total, 3) if total else 0.0


def report(path: pathlib.Path, start_ns: int | None = None,
           end_ns: int | None = None,
           monitor_path: pathlib.Path = DEFAULT_MONITOR,
           mask_path: pathlib.Path = DEFAULT_MASK) -> dict:
    if start_ns is not None and end_ns is not None and end_ns <= start_ns:
        raise MetricError("--end-ns must be greater than --start-ns")
    header, all_rows = parse_trace(path)
    rows = [row for row in all_rows
            if (start_ns is None or row["image_ns"] >= start_ns)
            and (end_ns is None or row["image_ns"] < end_ns)]
    if not rows:
        raise MetricError("the selected trace scope contains no frames")
    monitor_rule = read_rule(monitor_path)
    mask_rule = read_rule(mask_path)
    native_strokes = all("mask_downstroke" in row and
                         "monitor_downstroke" in row for row in rows)
    if native_strokes:
        monitor_states = [classify_native_strokes(
            row["mask_downstroke"], row["monitor_downstroke"]) for row in rows]
        mask_states = [classify_native_mask(state) for state in monitor_states]
        basis = "native-strokes"
    else:
        monitor_states = [classify(monitor_rule, row["cells"]) for row in rows]
        mask_states = [classify(mask_rule, row["cells"]) for row in rows]
        basis = "fitted-grid"
    combined = [reconcile(monitor, mask)
                for monitor, mask in zip(monitor_states, mask_states)]
    total = len(rows)

    def signal_summary(states: list[State]) -> dict:
        unknown = [state for state in states if state.value is None]
        return {
            "knownFrames": total - len(unknown),
            "unknownFrames": len(unknown),
            "unknownFramePct": pct(len(unknown), total),
            "reasons": dict(sorted(collections.Counter(
                state.reason for state in unknown).items())),
        }

    unknown = [state for state in combined if state.value is None]
    return {
        "schema": "actuation-frame-metric-v1",
        "basis": basis,
        "trace": str(path),
        "scope": {
            "kind": "bounded" if start_ns is not None or end_ns is not None
            else "full-trace",
            "startNs": start_ns,
            "endNs": end_ns,
        },
        "frames": total,
        "traceFrames": len(all_rows),
        "monitor": signal_summary(monitor_states),
        "mask": signal_summary(mask_states),
        "combined": {
            "knownFrames": total - len(unknown),
            "unknownFrames": len(unknown),
            "unknownFramePct": pct(len(unknown), total),
            "reasons": dict(sorted(collections.Counter(
                state.reason for state in unknown).items())),
        },
        "unknown_frame_pct": pct(len(unknown), total),
        "traceStartNs": header.get("start_ns"),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("trace", type=pathlib.Path)
    parser.add_argument("--start-ns", type=int)
    parser.add_argument("--end-ns", type=int)
    parser.add_argument("--monitor-rule", type=pathlib.Path, default=DEFAULT_MONITOR)
    parser.add_argument("--mask-rule", type=pathlib.Path, default=DEFAULT_MASK)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        output = report(args.trace, args.start_ns, args.end_ns,
                        args.monitor_rule, args.mask_rule)
    except MetricError as error:
        print(f"actuation-frame-metric: {error}", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(output, indent=2, sort_keys=True))
    else:
        combined = output["combined"]
        monitor = output["monitor"]
        mask = output["mask"]
        print(
            f"ACTUATION_METRIC trace={args.trace.name} scope={output['scope']['kind']} "
            f"frames={output['frames']} "
            f"monitor_unknown_frame_pct={monitor['unknownFramePct']:.3f} "
            f"mask_unknown_frame_pct={mask['unknownFramePct']:.3f} "
            f"state_basis={output['basis']} "
            f"unknown_frames={combined['unknownFrames']}/{output['frames']} "
            f"unknown_frame_pct={output['unknown_frame_pct']:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
