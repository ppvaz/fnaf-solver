#!/usr/bin/env python3
"""Phone-free tests for native input/frame alignment."""

from __future__ import annotations

import importlib.util


HERE = __import__("pathlib").Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("input_frame_align", HERE / "input-frame-align.py")
assert SPEC and SPEC.loader
align = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(align)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def row(kind: str, ts: int, name: str) -> dict:
    return {"kind": kind, "ts_ns": ts, "dur_ns": 1, "name": name,
            "thread_name": "main", "process_name": "com.scottgames.fnaf2",
            "track_name": "game"}


def frames(final_mask_off: bool = True) -> list[dict]:
    states = [
        (0, 142, 144), (90, 142, 144),
        (120, 4, 24), (140, 0, 144),
        (320, 0, 0), (360, 142, 144),
        (520, 4, 20), (550, 142, 20),
        (720, 4, 0), (740, 142, 0),
    ]
    if final_mask_off:
        states.append((800, 142, 144))
    return [{"seq": index + 1, "image_ns": t * 1_000_000,
             "interval_ns": 0, "mask_downstroke": mask,
             "monitor_downstroke": monitor, "trace_ns": t * 1_000_000,
             "state": align.classify_state(mask, monitor)}
            for index, (t, mask, monitor) in enumerate(states)]


def test_query_and_clock() -> None:
    query = align.build_query("com.example.o'reilly")
    check("publishMotionEvent" in query and "receiveMessage" in query,
          "query must include publication and game-channel receipt")
    check("com.example.o''reilly" in query and "clock_snapshot" not in query,
          "package must be SQL escaped without mixing the clock query")
    offset, report = align.clock_offset([
        {"snapshot_id": 0, "clock_name": "BOOTTIME", "clock_value": 1100},
        {"snapshot_id": 0, "clock_name": "MONOTONIC", "clock_value": 100},
        {"snapshot_id": 1, "clock_name": "BOOTTIME", "clock_value": 2200},
        {"snapshot_id": 1, "clock_name": "MONOTONIC", "clock_value": 1200},
    ])
    check(offset == 1000 and report["spreadNs"] == 0,
          "clock offset must be derived from paired snapshots")


def synthetic_rows() -> list[dict]:
    rows = [
        row("publish", 1, "publishMotionEvent(inputChannel=game, action=DOWN)"),
        row("receive", 2, "receiveMessage(inputChannel=game, seq=0x1, type=MOTION)"),
        row("finish", 3, "receiveMessage(inputChannel=game, seq=0x1, type=FINISHED)"),
        row("publish", 4, "publishMotionEvent(inputChannel=game, action=MOVE)"),
        row("receive", 5, "receiveMessage(inputChannel=game, seq=0x2, type=MOTION)"),
        row("finish", 6, "receiveMessage(inputChannel=game, seq=0x2, type=FINISHED)"),
        row("publish", 7, "publishMotionEvent(inputChannel=game, action=UP)"),
        row("receive", 8, "receiveMessage(inputChannel=game, seq=0x3, type=MOTION)"),
        row("finish", 9, "receiveMessage(inputChannel=game, seq=0x3, type=FINISHED)"),
    ]
    # Four independent device contacts follow the injected menu triplet.
    actions = [(100_000_000, "DOWN", "0x10"), (110_000_000, "UP", "0x11"),
               (300_000_000, "DOWN", "0x12"), (310_000_000, "UP", "0x13"),
               (500_000_000, "DOWN", "0x14"), (510_000_000, "UP", "0x15"),
               (700_000_000, "DOWN", "0x16"), (710_000_000, "UP", "0x17")]
    ordinal = 4
    for ts, action, event_id in actions:
        rows.append(row("publish", ts, f"publishMotionEvent(inputChannel=game, action={action})"))
        rows.append(row("receive", ts + 1,
                        f"receiveMessage(inputChannel=game, seq={event_id}, type=MOTION)"))
        rows.append(row("finish", ts + 2,
                        f"receiveMessage(inputChannel=game, seq={event_id}, type=FINISHED)"))
        rows.append(row("dispatch", ts, f"dispatchInputEvent MotionEvent ACTION_{action} "
                       f"deviceId=9 source=0x1002 historySize=0"))
        ordinal += 1
    # The first three dispatches are injected menu events.
    for ts, action in [(1, "DOWN"), (4, "MOVE"), (7, "UP")]:
        rows.append(row("dispatch", ts,
                        f"dispatchInputEvent MotionEvent ACTION_{action} "
                        f"deviceId=-1 source=0x1002 historySize=0"))
    return sorted(rows, key=lambda item: item["ts_ns"])


def test_alignment() -> None:
    events = align.parse_game_events(synthetic_rows())
    check(len(events) == 11, "publication and receipt rows should pair")
    check(events[3]["origin"] == "device" and events[0]["origin"] == "injected",
          "dispatch ordinals should preserve input origin")
    report = align.analyze(frames(), events)
    check(report["deviceContacts"] == 4 and report["visualAcceptedContacts"] == 4,
          "all four synthetic transitions should be visually accepted")
    check(report["contacts"][0]["departure_frame"] == 3,
          "first transition departure must be the first UNKNOWN frame")
    check(report["contacts"][0]["settled_frame"] == 4,
          "first transition settle must be the first new-state frame")
    check(report["contacts"][0]["observed_animation_ms"] == 20.0,
          "animation duration must use native frame timestamps")
    refused = align.analyze(frames(final_mask_off=False), events)
    check(refused["contacts"][-1]["status"] == "VISUAL_DEPARTURE_NO_SETTLED_TARGET",
          "a delivered contact without a settled target must remain explicit")


def main() -> None:
    test_query_and_clock()
    test_alignment()
    print("input-frame-align: clock mapping, channel pairing, native frame landing, "
          "animation intervals, and no-effect reporting pass")


if __name__ == "__main__":
    main()
