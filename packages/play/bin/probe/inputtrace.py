#!/usr/bin/env python3
"""Report Android input dispatch and frame landing from a Perfetto trace.

The trace is queried through Perfetto's dependency-free ``trace_processor``
wrapper.  This tool deliberately reports missing correlations instead of
turning them into dropped events: an input slice can exist without a delivery
or a usable frame signal, and those are different findings.

Usage::

    inputtrace.py RUN-input.pftrace
    inputtrace.py RUN-input.pftrace --trace-processor ./trace_processor

The command exits non-zero for an unreadable trace/query, an explicit
``--expected`` count mismatch, or a trace with no matching app events. The
last case is printed as ``NO APP EVENTS`` so a caller cannot mistake a trace
that recorded no input for a successful sweep.
"""

from __future__ import annotations

import argparse
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
DEFAULT_FRAME_WINDOW_MS = 50.0

# The package filter belongs in SQL for two reasons: it keeps the CSV small on
# a whole-device trace, and it prevents a launcher/system-ui touch from being
# counted as a game contact merely because it has the same source value.
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
SELECT 'delivery' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM app_joined
WHERE name GLOB 'deliverInputEvent src=* eventTimeNano=* id=*'
UNION ALL
SELECT 'frame' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM app_joined
WHERE name GLOB 'Choreographer#doFrame *'
UNION ALL
SELECT 'finish' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE lower(name) LIKE '%finishdispatchcycle%'
UNION ALL
-- Some Android builds omit process/track names for app slices. The input
-- dispatcher still preserves the package in this game-channel publication
-- marker, so retain it as a separate, auditable delivery observation rather
-- than declaring a good trace empty.
SELECT 'game_publish' AS kind, ts_ns, dur_ns, name, thread_name, process_name, track_name
FROM joined
WHERE name GLOB 'publishMotionEvent(inputChannel=*{package}*, action=*)'
ORDER BY ts_ns;
"""

DISPATCH_RE = re.compile(
    r"^dispatchInputEvent MotionEvent ACTION_(?P<action>[A-Z_]+(?:\(\d+\))?) "
    r"deviceId=(?P<device_id>-?\d+) source=(?P<source>0x[0-9a-fA-F]+) "
    r"historySize=(?P<history_size>\d+)$"
)
DELIVERY_RE = re.compile(
    r"^deliverInputEvent .*?eventTimeNano=(?P<event_time_ns>\d+) "
    r"id=(?P<event_id>0x[0-9a-fA-F]+)$"
)
ID_RE = re.compile(r"\bid=(?P<event_id>0x[0-9a-fA-F]+)\b")
FRAME_RE = re.compile(r"^Choreographer#doFrame (?P<frame_id>\d+)$")
PUBLISHED_RE = re.compile(
    r"^publishMotionEvent\(inputChannel=.*?, action=(?P<action>.+)\)$"
)


class InputTraceError(RuntimeError):
    """An input trace could not be queried or decoded."""


def build_query(package: str = DEFAULT_PACKAGE) -> str:
    """Build the fixed query, escaping only the caller-supplied package."""

    if not package or any(ch in package for ch in "\r\n"):
        raise ValueError("package must be a non-empty single line")
    return QUERY_TEMPLATE.format(package=package.replace("'", "''"))


def _csv_body(stdout: str) -> str:
    """Discard optional trace-processor progress text before the CSV header."""

    lines = stdout.splitlines()
    for index, line in enumerate(lines):
        if line.startswith('"kind"') or line.startswith("kind,"):
            return "\n".join(lines[index:])
    raise InputTraceError("trace processor returned no CSV header")


def parse_query_csv(stdout: str) -> list[dict[str, Any]]:
    """Parse trace_processor CSV into normalized rows."""

    try:
        reader = csv.DictReader(io.StringIO(_csv_body(stdout)))
    except csv.Error as error:
        raise InputTraceError(f"invalid trace-processor CSV: {error}") from error
    required = {"kind", "ts_ns", "dur_ns", "name", "thread_name", "process_name", "track_name"}
    if not required.issubset(reader.fieldnames or ()):
        got = ", ".join(reader.fieldnames or ())
        raise InputTraceError(f"trace-processor CSV lacks required columns (got {got})")
    rows: list[dict[str, Any]] = []
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
            raise InputTraceError(f"invalid CSV row {number}: {row}") from error
    return rows


def _parse_frame(row: dict[str, Any]) -> dict[str, Any]:
    match = FRAME_RE.match(row["name"])
    return {
        **row,
        "frame_id": int(match.group("frame_id")) if match else None,
    }


def _parse_delivery(row: dict[str, Any]) -> dict[str, Any] | None:
    match = DELIVERY_RE.match(row["name"])
    if not match:
        return None
    return {
        **row,
        "event_time_ns": int(match.group("event_time_ns")),
        "event_id": match.group("event_id").lower(),
    }


def _parse_finish(row: dict[str, Any]) -> dict[str, Any] | None:
    match = ID_RE.search(row["name"])
    if not match:
        return None
    return {**row, "event_id": match.group("event_id").lower()}


def _parse_published(row: dict[str, Any]) -> dict[str, Any] | None:
    match = PUBLISHED_RE.match(row["name"])
    if not match:
        return None
    return {**row, "action": match.group("action")}


def _nearest_delivery(event: dict[str, Any], deliveries: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Find the smallest enclosing deliverInputEvent slice for a dispatch."""

    containing = [
        delivery for delivery in deliveries
        if delivery["ts_ns"] <= event["dispatch_ts_ns"]
        <= delivery["ts_ns"] + max(delivery["dur_ns"], 0)
    ]
    if not containing:
        return None
    return min(containing, key=lambda item: (item["dur_ns"], -item["ts_ns"]))


def _attach_delivery(event: dict[str, Any], delivery: dict[str, Any], method: str) -> None:
    event.update({
        "delivery_ts_ns": delivery["ts_ns"],
        "event_time_ns": delivery["event_time_ns"],
        "event_id": delivery["event_id"],
        "delivery_correlation": method,
    })


def _next_frame(ts_ns: int, frames: list[dict[str, Any]]) -> dict[str, Any] | None:
    for frame in frames:
        if frame["ts_ns"] >= ts_ns:
            return frame
    return None


def parse_surfaceflinger_latency(text: str) -> dict[str, Any]:
    """Summarize the stable integer rows from ``dumpsys ... --latency``.

    SurfaceFlinger prints a refresh period followed by triples of
    ``desired-present-ready`` timestamps.  The middle value is the actual
    present time. Zero timestamps mean an empty ring slot and are excluded.
    The raw file remains the authority; this summary is only a cross-check on
    the frame period.
    """

    values: list[int] = []
    for line in text.splitlines():
        value = line.strip()
        if re.fullmatch(r"\d+", value):
            values.append(int(value))
    if not values:
        return {"refresh_period_ns": None, "frame_count": 0, "interval_ms": {}}
    refresh = values[0]
    presents = [value for value in values[2::3] if value > 0]
    intervals = [later - earlier for earlier, later in zip(presents, presents[1:])
                 if later > earlier]
    summary: dict[str, Any] = {
        "refresh_period_ns": refresh,
        "frame_count": len(presents),
        "interval_ms": {},
    }
    if intervals:
        summary["interval_ms"] = {
            "median": round(statistics.median(intervals) / 1_000_000, 3),
            "min": round(min(intervals) / 1_000_000, 3),
            "max": round(max(intervals) / 1_000_000, 3),
        }
    return summary


def analyze(rows: Iterable[dict[str, Any]], frame_window_ms: float = DEFAULT_FRAME_WINDOW_MS) -> dict[str, Any]:
    """Correlate app dispatch slices with deliveries, finish cycles, and frames."""

    if frame_window_ms <= 0:
        raise ValueError("frame window must be positive")
    all_rows = list(rows)
    deliveries = [parsed for row in all_rows
                   if row["kind"] == "delivery"
                   for parsed in [_parse_delivery(row)] if parsed]
    published = [parsed for row in all_rows
                 if row["kind"] == "game_publish"
                 for parsed in [_parse_published(row)] if parsed]
    finishes = [parsed for row in all_rows
                if row["kind"] == "finish"
                for parsed in [_parse_finish(row)] if parsed]
    frames = sorted((_parse_frame(row) for row in all_rows if row["kind"] == "frame"),
                    key=lambda item: item["ts_ns"])
    events: list[dict[str, Any]] = []
    unparsed = 0
    for row in all_rows:
        if row["kind"] != "dispatch":
            continue
        match = DISPATCH_RE.match(row["name"])
        if not match:
            unparsed += 1
            continue
        event: dict[str, Any] = {
            "action": match.group("action"),
            "device_id": int(match.group("device_id")),
            "source": match.group("source").lower(),
            "history_size": int(match.group("history_size")),
            "dispatch_ts_ns": row["ts_ns"],
            "dispatch_dur_ns": row["dur_ns"],
            "thread_name": row["thread_name"],
            "process_name": row["process_name"],
            "input_origin": "injected" if int(match.group("device_id")) == -1 else "device",
            "delivery_ts_ns": None,
            "event_time_ns": None,
            "event_id": None,
            "delivery_correlation": "missing",
            "finish_ts_ns": None,
            "frame_ts_ns": None,
            "frame_id": None,
            "frame_delta_ms": None,
            "frame_status": "missing",
        }
        delivery = _nearest_delivery(event, deliveries)
        if delivery:
            _attach_delivery(event, delivery, "enclosing")
            matching_finish = [finish for finish in finishes
                               if finish["event_id"] == delivery["event_id"]
                               and finish["ts_ns"] >= delivery["ts_ns"]]
            if matching_finish:
                event["finish_ts_ns"] = min(matching_finish, key=lambda item: item["ts_ns"])["ts_ns"]
        frame = _next_frame(event["dispatch_ts_ns"], frames)
        if frame:
            delta_ms = (frame["ts_ns"] - event["dispatch_ts_ns"]) / 1_000_000
            event.update({
                "frame_ts_ns": frame["ts_ns"],
                "frame_id": frame["frame_id"],
                "frame_delta_ms": round(delta_ms, 3),
                "frame_status": "matched" if delta_ms <= frame_window_ms else "out-of-window",
            })
        events.append(event)

    # On Android's input trace, the app's `dispatchInputEvent` slice can be
    # emitted just before the app's `deliverInputEvent` slice rather than as a
    # parent/child pair. When both app streams have the same cardinality, the
    # chronological ordinal is an explicit, auditable fallback; it is never
    # applied to a partial stream where it could silently hide a missing read.
    free_events = [event for event in events if event["event_id"] is None]
    free_deliveries = [delivery for delivery in deliveries
                       if not any(event["event_id"] == delivery["event_id"] for event in events)]
    if free_events and len(free_events) == len(free_deliveries):
        for event, delivery in zip(free_events, free_deliveries):
            _attach_delivery(event, delivery, "ordinal")
            matching_finish = [finish for finish in finishes
                               if finish["event_id"] == delivery["event_id"]
                               and finish["ts_ns"] >= delivery["ts_ns"]]
            if matching_finish:
                event["finish_ts_ns"] = min(matching_finish, key=lambda item: item["ts_ns"])["ts_ns"]

    event_actions = Counter(event["action"] for event in events)
    origins = Counter(event["input_origin"] for event in events)
    return {
        "events": events,
        "timing": timing_summary(events),
        "summary": {
            "dispatch_events": len(events),
            "unparsed_dispatch_slices": unparsed,
            "actions": dict(sorted(event_actions.items())),
            "origins": dict(sorted(origins.items())),
            "delivery_matches": sum(event["event_id"] is not None for event in events),
            "finish_matches": sum(event["finish_ts_ns"] is not None for event in events),
            "game_channel_publishes": len(published),
            "game_channel_actions": dict(sorted(Counter(
                item["action"] for item in published).items())),
            "frame_candidates": sum(event["frame_ts_ns"] is not None for event in events),
            "frame_matches": sum(event["frame_status"] == "matched" for event in events),
            "frame_out_of_window": sum(event["frame_status"] == "out-of-window" for event in events),
            "trace_rows": len(all_rows),
            "delivery_slices": len(deliveries),
            "finish_slices": len(finishes),
            "frame_slices": len(frames),
            "frame_window_ms": frame_window_ms,
        },
    }


def distribution_ms(values):
    """Latency distribution, not a claim that errors are IID or Gaussian."""
    ordered = sorted(values)
    if not ordered:
        return None
    def percentile(p):
        return ordered[max(0, math.ceil(p * len(ordered)) - 1)]
    return {"n": len(ordered), "median_ms": statistics.median(ordered),
            "p90_ms": percentile(.90), "p95_ms": percentile(.95),
            "p99_ms": percentile(.99), "max_ms": ordered[-1],
            "sigma_ms": statistics.pstdev(ordered), "percentile_method": "nearest-rank"}


def timing_summary(events):
    presses = [event for event in events if event["action"] in ("DOWN", "POINTER_DOWN")]
    # Perfetto normalizes slice timestamps onto its trace clock; Android's
    # MotionEvent eventTimeNano is a source timestamp. Without clock snapshots
    # mapping those domains, subtracting them would manufacture dispatch lag.
    # A Choreographer slice is not a Fusion input poll or a visible game effect.
    frame_delays = [event["frame_delta_ms"] for event in presses
                    if event["frame_delta_ms"] is not None]
    return {
        "clock_domains": {"event_time_ns": "android-monotonic-ns",
                          "dispatch_ts_ns": "perfetto-trace-ns", "frame_ts_ns": "perfetto-trace-ns"},
        "press_count": len(presses),
        "inject": {"status": "UNKNOWN", "reason": "no-id-matched-command-request-timestamps"},
        "dispatch": {"status": "UNKNOWN", "reason": "no-event-clock-to-trace-clock-mapping"},
        "effective": {"status": "UNKNOWN", "reason": "no-id-matched-request-and-positive-game-effect"},
        "dispatch_to_next_app_frame_proxy": {
            "status": "OBSERVED" if frame_delays else "UNKNOWN",
            "distribution": distribution_ms(frame_delays),
            "missing": len(presses) - len(frame_delays),
            "out_of_window": sum(event["frame_status"] == "out-of-window" for event in presses),
            "meaning": "next-Choreographer-slice-only; NOT game input acceptance or game-frame phase",
        },
    }


def _find_trace_processor(explicit: str | None) -> str:
    candidates = [explicit] if explicit else []
    candidates += [os.environ.get("TRACE_PROCESSOR"), "trace_processor", "trace_processor_shell"]
    for candidate in candidates:
        if candidate and (Path(candidate).is_file() or shutil.which(candidate)):
            return candidate
    raise InputTraceError(
        "trace_processor not found; set TRACE_PROCESSOR or pass --trace-processor "
        "(download the official dependency-free wrapper outside the repository)"
    )


def run_query(processor: str, trace: Path, package: str) -> list[dict[str, Any]]:
    try:
        result = subprocess.run(
            [processor, "query", str(trace), build_query(package)],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as error:
        raise InputTraceError(f"could not execute trace processor: {error}") from error
    if result.returncode:
        detail = (result.stderr or result.stdout).strip().splitlines()
        raise InputTraceError(
            f"trace processor failed ({result.returncode}): "
            f"{detail[-1] if detail else 'no diagnostic'}"
        )
    return parse_query_csv(result.stdout)


def _print_report(path: Path, package: str, report: dict[str, Any], sf: dict[str, Any] | None) -> None:
    summary = report["summary"]
    print(f"trace: {path}")
    print(f"package: {package}")
    print(f"dispatch events: {summary['dispatch_events']}  "
          f"actions={summary['actions'] or 'none'}  origins={summary['origins'] or 'none'}")
    print(f"delivery matches: {summary['delivery_matches']}/{summary['dispatch_events']}  "
          f"finish matches: {summary['finish_matches']}/{summary['dispatch_events']}")
    print(f"game-channel publishes: {summary['game_channel_publishes']}  "
          f"actions={summary['game_channel_actions'] or 'none'}")
    print(f"frame candidates: {summary['frame_candidates']}/{summary['dispatch_events']}  "
          f"within {summary['frame_window_ms']} ms: {summary['frame_matches']}")
    if sf is not None:
        print(f"SurfaceFlinger latency: {sf['frame_count']} frames, "
              f"refresh={sf['refresh_period_ns']} ns, intervals={sf['interval_ms'] or 'none'}")
    print("inject / dispatch / effective latency: UNKNOWN (request IDs, clock mapping and game effects required)")
    print("dispatch -> next app frame PROXY: "
          + str(report["timing"]["dispatch_to_next_app_frame_proxy"]["distribution"]))
    if not report["events"]:
        if report["summary"]["game_channel_publishes"]:
            print("NO APP DISPATCH SLICES; GAME CHANNEL PUBLISHES PRESENT")
        else:
            print("NO APP EVENTS")
        return
    origin = min(event["dispatch_ts_ns"] for event in report["events"])
    print("# action origin device dispatch_ms delivery event_id frame_id frame_delta_ms status")
    for index, event in enumerate(report["events"], 1):
        dispatch_ms = (event["dispatch_ts_ns"] - origin) / 1_000_000
        delivery = "yes" if event["event_id"] else "no"
        print(f"{index:02d} {event['action']:<6} {event['input_origin']:<8} "
              f"{event['device_id']:>6} {dispatch_ms:>10.3f} {delivery:<8} "
              f"{event['event_id'] or '-':<12} {event['frame_id'] or '-':>8} "
              f"{event['frame_delta_ms'] if event['frame_delta_ms'] is not None else '-':>15} "
              f"{event['frame_status']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", type=Path)
    parser.add_argument("--package", default=DEFAULT_PACKAGE)
    parser.add_argument("--trace-processor")
    parser.add_argument("--frame-window-ms", type=float, default=DEFAULT_FRAME_WINDOW_MS)
    parser.add_argument("--sf-latency", type=Path)
    parser.add_argument("--expected", type=int)
    parser.add_argument("--json", action="store_true", help="emit the machine-readable report")
    args = parser.parse_args(argv)
    try:
        if not args.trace.is_file():
            raise InputTraceError(f"trace does not exist: {args.trace}")
        processor = _find_trace_processor(args.trace_processor)
        rows = run_query(processor, args.trace, args.package)
        report = analyze(rows, args.frame_window_ms)
        report.update({"trace": str(args.trace), "package": args.package,
                       "trace_processor": processor})
        trace_hash = hashlib.sha256(args.trace.read_bytes()).hexdigest()
        report.update({"schema": "inputtrace-result-v2", "trace_sha256": trace_hash,
                       "evidenceId": "inputtrace-" + hashlib.sha256(json.dumps({
                           "trace": trace_hash, "package": args.package,
                           "window": args.frame_window_ms,
                           "analyzer": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                       }, sort_keys=True).encode()).hexdigest()[:20]})
        if args.sf_latency:
            if not args.sf_latency.is_file():
                raise InputTraceError(f"SurfaceFlinger latency file does not exist: {args.sf_latency}")
            report["surfaceflinger_latency"] = parse_surfaceflinger_latency(
                args.sf_latency.read_text(encoding="utf-8")
            )
        if args.json:
            print(json.dumps(report, indent=2, sort_keys=True))
        else:
            _print_report(args.trace, args.package, report,
                          report.get("surfaceflinger_latency"))
        if (not report["events"]
                and not report["summary"]["game_channel_publishes"]):
            return 3
        if args.expected is not None and report["summary"]["dispatch_events"] != args.expected:
            print(f"expected {args.expected} dispatch events, found "
                  f"{report['summary']['dispatch_events']}", file=sys.stderr)
            return 1
        return 0
    except (InputTraceError, OSError, ValueError) as error:
        print(f"inputtrace: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
