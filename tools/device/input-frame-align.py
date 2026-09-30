#!/usr/bin/env python3
"""Align game-channel input with the Companion's native presented frames.

This is deliberately narrower than ``inputtrace.py``.  Android dispatch and
the app-channel FINISHED acknowledgement prove transport, but neither proves
that the game changed state.  A v3 native frame trace supplies the visual
clock and the fixed bottom-control strokes.  This tool joins:

  publishMotionEvent -> receiveMessage(MOTION) -> receiveMessage(FINISHED)
  -> first native frame that leaves the prior settled state
  -> first native frame in the new settled state.

The image timestamp is CLOCK_MONOTONIC. Perfetto slices are CLOCK_BOOTTIME on
this handset, so the trace's clock_snapshot table supplies the offset. Using
the callback time instead would add ImageReader queue latency to every frame.

The result is visual acceptance evidence, not a claim about the game's private
touch handler. A delivered contact with no observed state change is reported
as ``CHANNEL_DELIVERED_NO_VISUAL_EFFECT``. Missing game-channel rows are a
trace failure, never silently reclassified as a game rejection.

Usage:
    input-frame-align.py INPUT.pftrace FRAME.tsv --trace-processor ./trace_processor
    input-frame-align.py INPUT.pftrace FRAME.tsv --json
"""

from __future__ import annotations

import argparse
import bisect
import csv
import hashlib
import io
import json
import math
import os
import re
import shutil
import statistics
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Iterable


DEFAULT_PACKAGE = "com.scottgames.fnaf2"
STROKE_VISIBLE_MIN = 100
STROKE_ABSENT_MAX = 40
DISPATCH_RE = re.compile(
    r"^dispatchInputEvent MotionEvent ACTION_(?P<action>[A-Z_]+(?:\(\d+\))?) "
    r"deviceId=(?P<device_id>-?\d+) source=(?P<source>0x[0-9a-fA-F]+) "
    r"historySize=(?P<history_size>\d+)$"
)
ACTION_RE = re.compile(r"action=(?P<action>.+)\)$")
SEQ_RE = re.compile(r"\bseq=(?P<seq>0x[0-9a-fA-F]+)\b")


class AlignError(RuntimeError):
    """The two clocks or their evidence cannot be aligned safely."""


QUERY_TEMPLATE = r"""
WITH joined AS (
  SELECT
    s.ts AS ts_ns,
    s.dur AS dur_ns,
    s.name AS name,
    COALESCE(th.name, '') AS thread_name,
    COALESCE(p.name, '') AS process_name,
    COALESCE(t.name, '') AS track_name
  FROM slice s
  JOIN track t ON t.id = s.track_id
  LEFT JOIN thread_track tt ON tt.id = s.track_id
  LEFT JOIN thread th ON th.utid = tt.utid
  LEFT JOIN process p ON p.upid = th.upid
),
app_joined AS (
  SELECT * FROM joined
  WHERE process_name = '{package}' OR INSTR(track_name, '{package}') > 0
)
SELECT 'dispatch' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM app_joined
WHERE name GLOB 'dispatchInputEvent MotionEvent *'
UNION ALL
SELECT 'publish' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE name GLOB 'publishMotionEvent(inputChannel=*{package}*, action=*)'
UNION ALL
SELECT 'receive' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE name GLOB 'receiveMessage(inputChannel=*{package}*, seq=*, type=MOTION)'
UNION ALL
SELECT 'finish' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE name GLOB 'receiveMessage(inputChannel=*{package}*, seq=*, type=FINISHED)'
ORDER BY ts_ns;
"""


def build_query(package: str = DEFAULT_PACKAGE) -> str:
    if not package or any(ch in package for ch in "\r\n"):
        raise ValueError("package must be a non-empty single line")
    return QUERY_TEMPLATE.format(package=package.replace("'", "''"))


def _csv_body(stdout: str) -> str:
    lines = stdout.splitlines()
    for index, line in enumerate(lines):
        if line.startswith('"kind"') or line.startswith("kind,"):
            return "\n".join(lines[index:])
    raise AlignError("trace processor returned no CSV header")


def parse_query_csv(stdout: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(_csv_body(stdout)))
    required = {"kind", "ts_ns", "dur_ns", "name", "thread_name",
                "process_name", "track_name"}
    if not required.issubset(reader.fieldnames or ()):
        raise AlignError("trace processor CSV lacks required columns")
    rows = []
    for number, row in enumerate(reader, 2):
        try:
            rows.append({
                "kind": row["kind"],
                "ts_ns": int(row["ts_ns"]),
                "dur_ns": int(row["dur_ns"] or 0),
                "name": row["name"],
                "thread_name": row["thread_name"] or "",
                "process_name": row["process_name"] or "",
                "track_name": row["track_name"] or "",
            })
        except (KeyError, TypeError, ValueError) as error:
            raise AlignError(f"invalid trace-processor row {number}: {row}") from error
    return rows


def parse_clock_rows(stdout: str) -> list[dict[str, int | str]]:
    lines = stdout.splitlines()
    start = next((i for i, line in enumerate(lines)
                  if line.startswith('"snapshot_id"') or line.startswith("snapshot_id,")), None)
    if start is None:
        raise AlignError("trace processor returned no clock_snapshot header")
    rows = []
    for row in csv.DictReader(io.StringIO("\n".join(lines[start:]))):
        try:
            rows.append({
                "snapshot_id": int(row["snapshot_id"]),
                "clock_name": row["clock_name"],
                "clock_value": int(row["clock_value"]),
            })
        except (KeyError, TypeError, ValueError) as error:
            raise AlignError(f"invalid clock_snapshot row: {row}") from error
    return rows


def _parse_frame_header(line: str) -> dict[str, str]:
    if not line.startswith("# schema=fnaf2-frame-trace-v"):
        raise AlignError("frame trace is not a fnaf2-frame-trace-v trace")
    result = {}
    for field in line[2:].split():
        key, separator, value = field.partition("=")
        if separator:
            result[key] = value
    return result


def read_frame_trace(path: Path) -> tuple[dict[str, str], list[dict[str, int]]]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as error:
        raise AlignError(f"cannot read frame trace {path}: {error}") from error
    if len(lines) < 3:
        raise AlignError(f"{path}: frame trace is empty")
    header = _parse_frame_header(lines[0])
    columns = lines[1].split("\t")
    required = {"seq", "image_ns", "interval_ns", "mask_downstroke",
                "monitor_downstroke"}
    if not required.issubset(columns):
        missing = ", ".join(sorted(required - set(columns)))
        raise AlignError(f"{path}: exact alignment requires native stroke columns ({missing})")
    index = {name: columns.index(name) for name in required}
    rows = []
    for line_number, line in enumerate(lines[2:], 3):
        if not line.strip():
            continue
        fields = line.split("\t")
        if len(fields) != len(columns):
            raise AlignError(f"{path}:{line_number}: wrong column count")
        try:
            rows.append({name: int(fields[position]) for name, position in index.items()})
        except ValueError as error:
            raise AlignError(f"{path}:{line_number}: invalid numeric field") from error
    if not rows:
        raise AlignError(f"{path}: frame trace contains no frames")
    return header, rows


def clock_offset(clock_rows: Iterable[dict[str, int | str]]) -> tuple[int, dict[str, Any]]:
    by_snapshot: dict[int, dict[str, int]] = {}
    for row in clock_rows:
        by_snapshot.setdefault(int(row["snapshot_id"]), {})[str(row["clock_name"])] = int(row["clock_value"])
    offsets = [values["BOOTTIME"] - values["MONOTONIC"]
               for values in by_snapshot.values()
               if "BOOTTIME" in values and "MONOTONIC" in values]
    if not offsets:
        raise AlignError("trace clock_snapshot has no BOOTTIME/MONOTONIC pair")
    median = int(statistics.median(offsets))
    return median, {
        "offsetNs": median,
        "offsetMs": round(median / 1_000_000, 6),
        "samples": len(offsets),
        "spreadNs": max(offsets) - min(offsets),
        "method": "median(clock_snapshot.BOOTTIME - MONOTONIC)",
    }


def classify_state(mask_stroke: int, monitor_stroke: int) -> str:
    if mask_stroke < 0 or monitor_stroke < 0:
        return "UNKNOWN"
    if mask_stroke <= STROKE_ABSENT_MAX and monitor_stroke >= STROKE_VISIBLE_MIN:
        return "MONITOR_UP"
    if mask_stroke >= STROKE_VISIBLE_MIN and monitor_stroke >= STROKE_VISIBLE_MIN:
        return "OFFICE"
    if mask_stroke >= STROKE_VISIBLE_MIN and monitor_stroke <= STROKE_ABSENT_MAX:
        return "MASK_ON"
    return "UNKNOWN"


def decorate_frames(raw_frames: list[dict[str, int]], offset_ns: int) -> list[dict[str, Any]]:
    frames = []
    for raw in raw_frames:
        frame = dict(raw)
        frame["trace_ns"] = raw["image_ns"] + offset_ns
        frame["state"] = classify_state(raw["mask_downstroke"],
                                         raw["monitor_downstroke"])
        frames.append(frame)
    frames.sort(key=lambda row: row["trace_ns"])
    return frames


def _action(name: str) -> str | None:
    match = ACTION_RE.search(name)
    return match.group("action") if match else None


def _seq(name: str) -> str | None:
    match = SEQ_RE.search(name)
    return match.group("seq").lower() if match else None


def parse_game_events(rows: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    all_rows = sorted(rows, key=lambda row: row["ts_ns"])
    dispatch = []
    for row in all_rows:
        if row["kind"] != "dispatch":
            continue
        match = DISPATCH_RE.match(row["name"])
        if match:
            dispatch.append({
                "action": match.group("action"),
                "device_id": int(match.group("device_id")),
                "dispatch_ts_ns": row["ts_ns"],
            })
    publishes = [{"action": _action(row["name"]), "ts_ns": row["ts_ns"]}
                 for row in all_rows if row["kind"] == "publish"]
    receives = []
    for row in all_rows:
        if row["kind"] != "receive":
            continue
        action = None
        # The action is carried by the matching publication; only the channel
        # sequence is needed here.
        sequence = _seq(row["name"])
        if sequence:
            receives.append({"ts_ns": row["ts_ns"], "seq": sequence})
    finishes = {}
    for row in all_rows:
        if row["kind"] == "finish":
            sequence = _seq(row["name"])
            if sequence and sequence not in finishes:
                finishes[sequence] = row["ts_ns"]
    if not publishes or not receives:
        return []
    if len(publishes) != len(receives):
        raise AlignError(f"game publish/receive cardinality differs ({len(publishes)} vs {len(receives)})")
    events = []
    for index, (published, received) in enumerate(zip(publishes, receives)):
        if published["action"] is None:
            raise AlignError(f"game publication {index + 1} has no action")
        event = {
            "ordinal": index + 1,
            "action": published["action"],
            "publish_ts_ns": published["ts_ns"],
            "receive_ts_ns": received["ts_ns"],
            "channel_latency_ms": round((received["ts_ns"] - published["ts_ns"]) / 1_000_000, 3),
            "seq": received["seq"],
            "finish_ts_ns": finishes.get(received["seq"]),
            "finish_latency_ms": (round((finishes[received["seq"]] - received["ts_ns"]) / 1_000_000, 3)
                                  if received["seq"] in finishes else None),
            "origin": "UNKNOWN",
            "device_id": None,
        }
        events.append(event)
    # Dispatch order matches the game publication order on this Android
    # input channel. Use it only when both cardinality and action sequence
    # agree; otherwise retain UNKNOWN origin instead of guessing.
    if len(dispatch) == len(events) and all(
            row["action"] == event["action"]
            for row, event in zip(dispatch, events)):
        for row, event in zip(dispatch, events):
            event["device_id"] = row["device_id"]
            event["dispatch_ts_ns"] = row["dispatch_ts_ns"]
            event["origin"] = "injected" if row["device_id"] == -1 else "device"
    return events


def _frame_before(ts_ns: int, frames: list[dict[str, Any]]) -> dict[str, Any] | None:
    times = [frame["trace_ns"] for frame in frames]
    index = bisect.bisect_right(times, ts_ns) - 1
    return frames[index] if index >= 0 else None


def _frame_after(ts_ns: int, frames: list[dict[str, Any]]) -> dict[str, Any] | None:
    times = [frame["trace_ns"] for frame in frames]
    index = bisect.bisect_left(times, ts_ns)
    return frames[index] if index < len(frames) else None


def _frame_after_index(index: int, frames: list[dict[str, Any]]) -> dict[str, Any] | None:
    return frames[index] if index < len(frames) else None


def _index_after(ts_ns: int, frames: list[dict[str, Any]]) -> int:
    return bisect.bisect_left([frame["trace_ns"] for frame in frames], ts_ns)


def contact_groups(events: list[dict[str, Any]]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    contacts = []
    active = None
    for event in events:
        if event["origin"] != "device":
            continue
        if event["action"] == "DOWN":
            active = event
        elif event["action"] == "UP" and active is not None:
            contacts.append((active, event))
            active = None
    return contacts


def _target_state(index: int, before: str, after: str | None) -> str | None:
    if after is not None and after != before:
        return after
    # The transition-only stream has an explicit legal order. This label is
    # only a presentation aid; visual evidence still has to show the change.
    expected = ("MONITOR_UP", "OFFICE", "MASK_ON", "OFFICE")
    return expected[index] if index < len(expected) else None


def analyze(frames: list[dict[str, Any]], events: list[dict[str, Any]],
            max_wait_ms: float = 2500.0) -> dict[str, Any]:
    if not frames:
        raise AlignError("no native frames")
    if max_wait_ms <= 0:
        raise ValueError("max_wait_ms must be positive")
    intervals = [(later["image_ns"] - earlier["image_ns"]) / 1_000_000
                 for earlier, later in zip(frames, frames[1:])
                 if later["image_ns"] > earlier["image_ns"]]
    # Keep the repository's actuation metric contract: the calibrated
    # coverage rule currently proves only OFFICE versus MONITOR_UP. A native
    # MASK_ON classification is useful for animation landing, but it is not
    # promoted to combined control coverage until its independent mask rule
    # is qualified. Therefore MASK_ON remains UNKNOWN in this percentage.
    coverage_known = [frame for frame in frames
                      if frame["state"] in {"OFFICE", "MONITOR_UP"}]
    coverage_unknown = len(frames) - len(coverage_known)
    state_unknown = sum(frame["state"] == "UNKNOWN" for frame in frames)
    contacts = []
    for index, (down, up) in enumerate(contact_groups(events)):
        before = _frame_before(down["receive_ts_ns"], frames)
        pre_state = before["state"] if before else "UNKNOWN"
        start_index = _index_after(down["receive_ts_ns"], frames)
        release_index = _index_after(up["receive_ts_ns"], frames)
        limit_ns = up["receive_ts_ns"] + int(max_wait_ms * 1_000_000)
        departure = None
        departure_index = None
        if pre_state != "UNKNOWN":
            for candidate_index in range(start_index, len(frames)):
                candidate = frames[candidate_index]
                if candidate["trace_ns"] > limit_ns:
                    break
                if candidate["state"] != pre_state:
                    departure = candidate
                    departure_index = candidate_index
                    break
        settled = None
        if departure_index is not None:
            for candidate in frames[departure_index:]:
                if candidate["trace_ns"] > limit_ns:
                    break
                if candidate["state"] in {"OFFICE", "MONITOR_UP", "MASK_ON"} \
                        and candidate["state"] != pre_state:
                    settled = candidate
                    break
        target = settled["state"] if settled else None
        expected = _target_state(index, pre_state, target)
        if departure is None:
            status = "CHANNEL_DELIVERED_NO_VISUAL_EFFECT"
        elif settled is None:
            status = "VISUAL_DEPARTURE_NO_SETTLED_TARGET"
        elif target != expected:
            status = "VISUAL_STATE_UNEXPECTED"
        else:
            status = "VISUAL_ACCEPTED"
        contacts.append({
            "ordinal": index + 1,
            "down_event_ordinal": down["ordinal"],
            "up_event_ordinal": up["ordinal"],
            "down_receive_ts_ns": down["receive_ts_ns"],
            "up_receive_ts_ns": up["receive_ts_ns"],
            "contact_channel_ms": round((up["receive_ts_ns"] - down["receive_ts_ns"]) / 1_000_000, 3),
            "pre_state": pre_state,
            "expected_state": expected,
            "departure_frame": departure["seq"] if departure else None,
            "departure_trace_ns": departure["trace_ns"] if departure else None,
            "departure_after_release_ms": (round((departure["trace_ns"] - up["receive_ts_ns"]) / 1_000_000, 3)
                                           if departure else None),
            "settled_state": target,
            "settled_frame": settled["seq"] if settled else None,
            "settled_trace_ns": settled["trace_ns"] if settled else None,
            "observed_animation_ms": (round((settled["trace_ns"] - departure["trace_ns"]) / 1_000_000, 3)
                                      if departure and settled else None),
            "status": status,
        })
    interval_summary = {}
    if intervals:
        ordered = sorted(intervals)
        interval_summary = {
            "minMs": round(min(ordered), 3),
            "p50Ms": round(statistics.median(ordered), 3),
            "maxMs": round(max(ordered), 3),
            "over25ms": sum(value > 25.0 for value in ordered),
        }
    return {
        "frames": len(frames),
        "knownFrames": len(coverage_known),
        "unknownFrames": coverage_unknown,
        "unknownFramePct": round(100.0 * coverage_unknown / len(frames), 3),
        "stateUnknownFrames": state_unknown,
        "stateUnknownFramePct": round(100.0 * state_unknown / len(frames), 3),
        "intervals": interval_summary,
        "contacts": contacts,
        "visualAcceptedContacts": sum(row["status"] == "VISUAL_ACCEPTED" for row in contacts),
        "deviceContacts": len(contacts),
    }


def _find_trace_processor(explicit: str | None) -> str:
    candidates = [explicit] if explicit else []
    candidates += [os.environ.get("TRACE_PROCESSOR"), "trace_processor", "trace_processor_shell"]
    for candidate in candidates:
        if candidate and (Path(candidate).is_file() or shutil.which(candidate)):
            return candidate
    raise AlignError("trace_processor not found; pass --trace-processor")


def run_query(processor: str, trace: Path, query: str) -> str:
    try:
        result = subprocess.run([processor, "query", str(trace), query],
                                check=False, capture_output=True, text=True)
    except OSError as error:
        raise AlignError(f"could not execute trace processor: {error}") from error
    if result.returncode:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise AlignError(f"trace processor failed: {detail[-1] if detail else 'unknown error'}")
    return result.stdout


def _print_report(report: dict[str, Any]) -> None:
    clock = report["clock"]
    visual = report["visual"]
    channel = report["channel"]
    print(f"native frames: {visual['frames']} known={visual['knownFrames']} "
          f"unknown={visual['unknownFrames']}/{visual['frames']} "
          f"unknown_frame_pct={visual['unknownFramePct']:.3f}")
    print(f"native cadence: {visual['intervals'] or 'none'}")
    print(f"clock mapping: +{clock['offsetMs']:.6f} ms "
          f"({clock['method']}, samples={clock['samples']}, spread_ns={clock['spreadNs']})")
    print(f"game channel: publishes={channel['publishes']} receives={channel['receives']} "
          f"finish_acks={channel['finishAcks']}")
    print("# contact pre -> target departure_frame settled_frame animation_ms status")
    for contact in visual["contacts"]:
        print(f"{contact['ordinal']:02d} {contact['pre_state']:<11} -> "
              f"{contact['expected_state'] or '-':<11} "
              f"{contact['departure_frame'] or '-':>6} "
              f"{contact['settled_frame'] or '-':>6} "
              f"{contact['observed_animation_ms'] if contact['observed_animation_ms'] is not None else '-':>13} "
              f"{contact['status']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("trace", type=Path)
    parser.add_argument("frame_trace", type=Path)
    parser.add_argument("--package", default=DEFAULT_PACKAGE)
    parser.add_argument("--trace-processor")
    parser.add_argument("--max-wait-ms", type=float, default=2500.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        if not args.trace.is_file() or not args.frame_trace.is_file():
            raise AlignError("trace and frame trace must both exist")
        processor = _find_trace_processor(args.trace_processor)
        rows = parse_query_csv(run_query(processor, args.trace, build_query(args.package)))
        clock_query = "select snapshot_id,clock_name,clock_value from clock_snapshot " \
                      "where clock_name in ('BOOTTIME','MONOTONIC') order by snapshot_id,clock_name"
        offset, clock = clock_offset(parse_clock_rows(run_query(processor, args.trace, clock_query)))
        header, raw_frames = read_frame_trace(args.frame_trace)
        frames = decorate_frames(raw_frames, offset)
        events = parse_game_events(rows)
        visual = analyze(frames, events, args.max_wait_ms)
        report = {
            "schema": "input-frame-align-v1",
            "trace": str(args.trace),
            "frameTrace": str(args.frame_trace),
            "package": args.package,
            "traceProcessor": processor,
            "clock": clock,
            "frameTraceHeader": header,
            "channel": {
                "publishes": sum(row["kind"] == "publish" for row in rows),
                "receives": sum(row["kind"] == "receive" for row in rows),
                "finishAcks": sum(row["kind"] == "finish" for row in rows),
                "events": events,
            },
            "visual": visual,
            "traceSha256": hashlib.sha256(args.trace.read_bytes()).hexdigest(),
            "frameTraceSha256": hashlib.sha256(args.frame_trace.read_bytes()).hexdigest(),
        }
        if args.json:
            print(json.dumps(report, indent=2, sort_keys=True))
        else:
            _print_report(report)
        if not events:
            print("NO GAME CHANNEL EVENTS", file=sys.stderr)
            return 3
        return 0
    except (AlignError, OSError, ValueError) as error:
        print(f"input-frame-align: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
