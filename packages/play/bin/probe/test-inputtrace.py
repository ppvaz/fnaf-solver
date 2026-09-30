#!/usr/bin/env python3
"""Phone-free regression tests for inputtrace.py's correlation contract."""

from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("inputtrace", HERE / "inputtrace.py")
assert SPEC and SPEC.loader
inputtrace = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inputtrace)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def rows() -> list[dict[str, object]]:
    common = {
        "dur_ns": 10,
        "thread_name": "main",
        "process_name": "com.scottgames.fnaf2",
        "track_name": "com.scottgames.fnaf2/com.scottgames.fnaf2.Main",
    }
    return [
        {**common, "kind": "delivery", "dur_ns": 200_000, "ts_ns": 1_000_000, "name":
         "deliverInputEvent src=0x1002 eventTimeNano=900 id=0xabc"},
        {**common, "kind": "dispatch", "ts_ns": 1_050_000, "name":
         "dispatchInputEvent MotionEvent ACTION_DOWN deviceId=7 source=0x1002 historySize=0"},
        {**common, "kind": "finish", "ts_ns": 1_090_000, "name":
         "finishDispatchCycleLocked(inputChannel=game, id=0xabc)"},
        {**common, "kind": "frame", "ts_ns": 1_100_000, "name":
         "Choreographer#doFrame 42"},
        {**common, "kind": "dispatch", "ts_ns": 2_000_000, "name":
         "dispatchInputEvent MotionEvent ACTION_UP deviceId=-1 source=0x1002 historySize=0"},
        {**common, "kind": "frame", "ts_ns": 2_050_000, "name":
         "Choreographer#doFrame 43"},
    ]


def test_correlation() -> None:
    report = inputtrace.analyze(rows())
    summary = report["summary"]
    events = report["events"]
    check(summary["dispatch_events"] == 2, "both dispatch slices should be reported")
    check(summary["delivery_matches"] == 1, "only the enclosing delivery should match")
    check(summary["finish_matches"] == 1, "finish should correlate by event id")
    check(summary["frame_matches"] == 2, "next frames should be assigned within the window")
    check(summary["origins"] == {"device": 1, "injected": 1},
          "deviceId=-1 must remain visibly injected")
    check(events[0]["event_time_ns"] == 900 and events[0]["event_id"] == "0xabc",
          "delivery event time and id must survive correlation")
    check(events[0]["frame_id"] == 42 and events[0]["frame_delta_ms"] == 0.05,
          "dispatch must land on the next frame with measured delta")
    check(events[1]["event_id"] is None, "unmatched dispatch must not invent an id")
    timing = report["timing"]
    check(timing["press_count"] == 1, 'releases must not become independent presses')
    for stage in ('inject', 'dispatch', 'effective'):
        check(timing[stage]["status"] == "UNKNOWN", f'{stage} must not be invented from unrelated clocks')
    check(timing["dispatch_to_next_app_frame_proxy"]["distribution"]["max_ms"] == .05,
          'same-trace frame proxy remains measurable, without claiming gameplay acceptance')
    tails = inputtrace.distribution_ms(list(range(1, 101)))
    check(tails["p99_ms"] == 99 and tails["max_ms"] == 100 and tails["median_ms"] == 50.5,
          'latency tails must not be replaced by average or Gaussian extrapolation')


def test_csv_and_query() -> None:
    csv_text = (
        "progress text\n"
        '"kind","ts_ns","dur_ns","name","thread_name","process_name","track_name"\n'
        '"dispatch","1","2","dispatchInputEvent MotionEvent ACTION_DOWN '
        'deviceId=1 source=0x1002 historySize=0","main","","28af0db com.scottgames.fnaf2/com.scottgames.fnaf2.Main"\n'
    )
    parsed = inputtrace.parse_query_csv(csv_text)
    check(parsed[0]["ts_ns"] == 1 and parsed[0]["dur_ns"] == 2 and
          parsed[0]["track_name"].endswith("Main"),
          "CSV parser should retain a package-bearing track when process_name is empty")
    query = inputtrace.build_query("com.example.o'reilly")
    check(query.count("com.example.o''reilly") >= 3 and
          "INSTR(track_name" in query and
          "deliverInputEvent src=* eventTimeNano=* id=*" in query and
          "game_publish" in query,
          "package must be SQL-escaped across process, track, and game-channel matches")
    pointer = inputtrace.DISPATCH_RE.match(
        "dispatchInputEvent MotionEvent ACTION_POINTER_DOWN(1) "
        "deviceId=335 source=0x1002 historySize=0")
    check(pointer and pointer.group("action") == "POINTER_DOWN(1)",
          "pointer MotionEvents must remain parseable")
    published = inputtrace.PUBLISHED_RE.match(
        "publishMotionEvent(inputChannel=game, action=POINTER_UP(1))")
    check(published and published.group("action") == "POINTER_UP(1)",
          "parenthesized game-channel actions must remain parseable")


def test_surfaceflinger() -> None:
    sf = inputtrace.parse_surfaceflinger_latency(
        "16666666\n0\n16666666\n17000000\n17000000\n33333332\n34000000\n"
    )
    check(sf["refresh_period_ns"] == 16666666 and sf["frame_count"] == 2,
          "SurfaceFlinger refresh and present rows should be read")
    check(sf["interval_ms"]["median"] == 16.667,
          "SurfaceFlinger interval summary should use present timestamps")


def test_fake_processor() -> None:
    # Exercise the subprocess boundary without a trace processor dependency.
    with tempfile.TemporaryDirectory(prefix="m7-inputtrace-") as directory:
        processor = Path(directory) / "trace_processor"
        processor.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' 'kind,ts_ns,dur_ns,name,thread_name,process_name,track_name' "
            "'dispatch,1,2,dispatchInputEvent MotionEvent ACTION_DOWN "
            "deviceId=1 source=0x1002 historySize=0,main,,com.scottgames.fnaf2/Main'\n",
            encoding="utf-8",
        )
        processor.chmod(0o700)
        trace = Path(directory) / "trace.pftrace"
        trace.write_bytes(b"fixture")
        result = inputtrace.run_query(str(processor), trace, inputtrace.DEFAULT_PACKAGE)
        check(len(result) == 1 and result[0]["kind"] == "dispatch",
              "query runner should pass through fixture CSV")


def main() -> None:
    test_correlation()
    test_csv_and_query()
    test_surfaceflinger()
    test_fake_processor()
    print("inputtrace: dispatch/delivery/frame correlation and SurfaceFlinger parsing pass")


if __name__ == "__main__":
    main()
