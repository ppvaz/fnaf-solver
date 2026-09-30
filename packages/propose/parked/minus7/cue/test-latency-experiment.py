#!/usr/bin/env python3
"""Phone-free checks for the latency experiment's session and clock logic."""

import importlib.util
import json
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("latency_experiment", HERE / "latency-experiment.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def check_clock_mapping():
    first = {"host_mid_ns": 1_000_000_000, "device_ns": 6_000_000_000,
             "rtt_ns": 20, "offset_device_minus_host_ns": 5_000_000_000}
    second = {"host_mid_ns": 2_000_000_000, "device_ns": 7_000_000_000,
              "rtt_ns": 10, "offset_device_minus_host_ns": 5_000_000_000}
    merged = module.merge_clocks({"samples": [first]}, {"samples": [second]})
    assert module.device_to_host_ns(merged, 6_500_000_000) == 1_500_000_000
    assert merged["selected"] is second


def check_visual_arrivals():
    rows = []
    for second in range(6):
        rows.append((second * 1_000_000_000, 220 if second < 3 else 15))
    result = module.visual_arrivals(rows, min_dwell_s=2.0)
    assert result["state"] == "OBSERVED"
    assert result["events_device_ns"] == [3_000_000_000]
    assert result["dark_mean"] == 15.0
    assert result["bright_mean"] == 220.0


def check_visual_unknown():
    rows = [(i * 1_000_000_000, 100 + i) for i in range(5)]
    result = module.visual_arrivals(rows)
    assert result["state"] == "UNKNOWN"
    assert result["events"] == []


def check_nearest_pairing():
    sync = module.merge_clocks({"samples": [{
        "host_mid_ns": 0,
        "device_ns": 5_000_000_000,
        "rtt_ns": 1,
        "offset_device_minus_host_ns": 5_000_000_000,
    }]})
    pairs, unmatched = module.pair_events(
        [6_000_000_000],
        [{"onset_s": 1.150, "correlation": 0.8},
         {"onset_s": 3.000, "correlation": 0.9}],
        0, sync, 500.0,
    )
    assert len(pairs) == 1
    assert pairs[0]["audio_hit_index"] == 0
    assert pairs[0]["audio_minus_visual_ms"] == 150.0
    assert unmatched == []


def check_pairing_is_one_to_one():
    sync = module.merge_clocks({"samples": [{
        "host_mid_ns": 0,
        "device_ns": 5_000_000_000,
        "rtt_ns": 1,
        "offset_device_minus_host_ns": 5_000_000_000,
    }]})
    pairs, unmatched = module.pair_events(
        [6_000_000_000, 6_010_000_000],
        [{"onset_s": 1.005, "correlation": 0.8}],
        0, sync, 500.0,
    )
    assert len(pairs) == 1
    assert pairs[0]["audio_hit_index"] == 0
    assert unmatched == [6_010_000_000]


def check_latency_statistics():
    pairs = [
        {"audio_minus_visual_ms": 100.0, "audio_hit_index": 0},
        {"audio_minus_visual_ms": 150.0, "audio_hit_index": 1},
        {"audio_minus_visual_ms": 200.0, "audio_hit_index": 2},
    ]
    report = module.latency_statistics(
        pairs, [1, 2, 3, 4], [{}, {}, {}, {}], [4])
    assert report["p50_ms"] == 150.0
    assert report["p95_ms"] == 195.0
    assert report["max_ms"] == 200.0
    assert report["jitter_ms"] == 45.0
    assert report["temporal_decision"]["recommended_timestamp_compensation_ms"] == -150.0
    assert report["temporal_decision"]["positive_delay_max_ms"] == 200.0
    assert report["temporal_decision"]["remaining_causal_budget_ms"] == 550.0
    assert report["temporal_decision"]["timestamp_compensation"] == \
        "within-window-but-losses"
    assert report["temporal_decision"]["loss_free"] is False
    assert report["losses"] == {
        "visual_events": 4,
        "audio_hits": 4,
        "paired_events": 3,
        "visual_without_audio": 1,
        "audio_without_visual": 1,
        "visual_loss_rate": 0.25,
        "audio_orphan_rate": 0.25,
        "pair_rate": 0.75,
    }


def check_session_creation_and_manifest_shape():
    with tempfile.TemporaryDirectory(prefix="fnaf2-latency-test-") as directory:
        root = Path(directory)
        session = module.create_run_dir(root, "manual-event")
        assert session.parent == root
        assert session.name.endswith("-manual-event")
        (session / "manifest.json").write_text(json.dumps({
            "schema": "fnaf2-latency-experiment-v1",
            "state": "running",
        }) + "\n")
        assert json.loads((session / "manifest.json").read_text())["schema"] == \
            "fnaf2-latency-experiment-v1"


def check_authority_fact_timestamps():
    with tempfile.TemporaryDirectory(prefix="fnaf2-latency-facts-") as directory:
        facts_path = Path(directory) / "audio-facts.jsonl"
        facts_path.write_text(json.dumps({
            "schema": "fact-message-v1", "seq": 4, "type": "cue-bang",
            "state": "OBSERVED", "value": True, "confidence": 0.8,
            "t_observed": 1150, "t_received": 1150,
        }) + "\n")
        facts = module.authority_fact_hits(facts_path, "bang")
        events = module.fact_hits_as_audio_events(facts, 1_000_000_000)
        assert facts["fact_type"] == "cue-bang"
        assert len(events) == 1
        assert events[0]["onset_s"] == 0.15


check_authority_fact_timestamps()


check_clock_mapping()
check_visual_arrivals()
check_visual_unknown()
check_nearest_pairing()
check_pairing_is_one_to_one()
check_latency_statistics()
check_session_creation_and_manifest_shape()
print("latency experiment: clock mapping, visual labeling, and session shape pass")
