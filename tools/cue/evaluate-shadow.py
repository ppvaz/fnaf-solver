#!/usr/bin/env python3
"""Evaluate Companion shadow windows with whole-session holdouts.

Input is JSONL, one independently labelled detector window per line::

  {"schema":"cue-shadow-window-v1","session_id":"night-01",
   "split":"holdout","window_id":"bb-17","truth":["bb_voice","bang"],
   "observation":{"state":"HIT","events":[{"cue":"bb_voice"},{"cue":"bang"}]},
   "label_provenance":{"source":"manual-video","independent":true},
   "model_sha256":"...","audio_sha256":"..."}

Calibration and holdout rows may share a file, but a session may occur in only
one split. The output is a durable cue-holdout-v1 report. It can say PASS only
when the caller supplies simulator-derived maximum error bounds, the untouched
holdout observes zero errors, and the rule-of-three upper bounds fit them.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys

SCHEMA = "cue-shadow-window-v1"
REPORT_SCHEMA = "cue-holdout-v1"
SAFE_SPLITS = {"calibration", "holdout"}
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SAFE_NAME = re.compile(r"[A-Za-z0-9._-]{1,64}\Z")


def sha256(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def mapping(values, what):
    out = {}
    for item in values:
        name, sep, raw = item.partition("=")
        if not sep or not name:
            raise ValueError("%s must be CUE=RATE: %s" % (what, item))
        value = float(raw)
        if not 0 < value <= 1:
            raise ValueError("%s rate must be in (0,1]: %s" % (what, item))
        out[name] = value
    return out


def load(path):
    rows = []
    for number, line in enumerate(pathlib.Path(path).read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError("line %d is not JSON: %s" % (number, error))
        required = ("schema", "session_id", "split", "window_id", "open_ns",
                    "close_ns", "truth",
                    "observation", "label_provenance", "model_sha256",
                    "audio_sha256")
        if any(key not in row for key in required):
            raise ValueError("line %d lacks a required field" % number)
        if row["schema"] != SCHEMA or row["split"] not in SAFE_SPLITS:
            raise ValueError("line %d has unsupported schema/split" % number)
        if not SAFE_NAME.fullmatch(str(row["session_id"])) or \
                not SAFE_NAME.fullmatch(str(row["window_id"])):
            raise ValueError("line %d has an invalid session/window id" % number)
        if not SHA256.fullmatch(str(row["model_sha256"])) or \
                not SHA256.fullmatch(str(row["audio_sha256"])):
            raise ValueError("line %d has an invalid artifact hash" % number)
        if not isinstance(row["open_ns"], int) or not isinstance(row["close_ns"], int) or \
                row["open_ns"] < 0 or row["close_ns"] <= row["open_ns"]:
            raise ValueError("line %d has an invalid timestamped window" % number)
        if not isinstance(row["truth"], list) or \
                any(not SAFE_NAME.fullmatch(str(cue)) for cue in row["truth"]):
            raise ValueError("line %d truth is not a list" % number)
        if len(row["truth"]) != len(set(row["truth"])):
            raise ValueError("line %d repeats a truth cue" % number)
        provenance = row["label_provenance"]
        if not isinstance(provenance, dict) or provenance.get("independent") is not True:
            raise ValueError("line %d label is not independently established" % number)
        if provenance.get("source") in (None, "", "cue-helper", "detector"):
            raise ValueError("line %d label source is circular" % number)
        observation = row["observation"]
        if not isinstance(observation, dict):
            raise ValueError("line %d has an invalid observation" % number)
        if observation.get("state") not in ("HIT", "MISS", "UNKNOWN"):
            raise ValueError("line %d has invalid observation state" % number)
        events = observation.get("events", [])
        if not isinstance(events, list):
            raise ValueError("line %d has invalid events" % number)
        for event in events:
            if not isinstance(event, dict) or not SAFE_NAME.fullmatch(str(event.get("cue", ""))) or \
                    not SAFE_NAME.fullmatch(str(event.get("template", ""))):
                raise ValueError("line %d has an invalid cue event" % number)
            cue_ns = event.get("cue_ns")
            score = event.get("score")
            margin = event.get("margin")
            if not isinstance(cue_ns, int) or not row["open_ns"] <= cue_ns <= row["close_ns"]:
                raise ValueError("line %d has an event outside its timestamped window" % number)
            if isinstance(score, bool) or not isinstance(score, (int, float)) or \
                    not -1 <= score <= 1:
                raise ValueError("line %d has an invalid event score" % number)
            if isinstance(margin, bool) or not isinstance(margin, (int, float)) or \
                    not 0 <= margin <= 2:
                raise ValueError("line %d has an invalid event margin" % number)
        if observation["state"] == "HIT" and not events:
            raise ValueError("line %d reports HIT without timestamped events" % number)
        if observation["state"] == "MISS" and events:
            raise ValueError("line %d reports MISS with events" % number)
        rows.append(row)
    if not rows:
        raise ValueError("no shadow windows")
    return rows


def evaluate(rows, cues, max_fn, max_fp, input_path):
    cue_set = set(cues)
    session_split = {}
    model_hashes = set()
    audio_by_session = {}
    audio_split = {}
    window_ids = set()
    for row in rows:
        unknown_truth = set(row["truth"]) - cue_set
        unknown_events = {event["cue"] for event in row["observation"].get("events", [])} - cue_set
        if unknown_truth or unknown_events:
            raise ValueError("window %s contains cues outside the evaluation vocabulary" %
                             row["window_id"])
        session = row["session_id"]
        split = row["split"]
        if session in session_split and session_split[session] != split:
            raise ValueError("session %s appears in calibration and holdout" % session)
        session_split[session] = split
        model_hashes.add(row["model_sha256"])
        audio_by_session.setdefault(session, set()).add(row["audio_sha256"])
        audio_hash = row["audio_sha256"]
        if audio_hash in audio_split and audio_split[audio_hash] != split:
            raise ValueError("audio artifact appears in calibration and holdout")
        audio_split[audio_hash] = split
        identity = (session, row["window_id"])
        if identity in window_ids:
            raise ValueError("duplicate window %s/%s" % identity)
        window_ids.add(identity)
    if len(model_hashes) != 1:
        raise ValueError("shadow rows do not use exactly one model")
    if any(len(items) != 1 for items in audio_by_session.values()):
        raise ValueError("a session names more than one audio artifact")
    calibration = sorted(k for k, v in session_split.items() if v == "calibration")
    holdout = sorted(k for k, v in session_split.items() if v == "holdout")
    if not calibration or not holdout:
        raise ValueError("both calibration and holdout sessions are required")

    metrics = {}
    passed = True
    holdout_rows = [row for row in rows if row["split"] == "holdout"]
    unknown = sum(row["observation"]["state"] == "UNKNOWN" for row in holdout_rows)
    if unknown:
        passed = False
    for cue in cues:
        tp = fn = fp = tn = 0
        for row in holdout_rows:
            truth = cue in row["truth"]
            predicted = (row["observation"]["state"] == "HIT" and
                         cue in {event["cue"] for event in row["observation"].get("events", [])})
            if truth and predicted:
                tp += 1
            elif truth:
                fn += 1
            elif predicted:
                fp += 1
            else:
                tn += 1
        positives, negatives = tp + fn, tn + fp
        fn_upper = 1.0 if positives == 0 or fn else 3.0 / positives
        fp_upper = 1.0 if negatives == 0 or fp else 3.0 / negatives
        cue_pass = (fn == 0 and fp == 0 and
                    fn_upper <= max_fn[cue] and fp_upper <= max_fp[cue])
        passed &= cue_pass
        metrics[cue] = {
            "tp": tp, "fn": fn, "fp": fp, "tn": tn,
            "positive_windows": positives, "negative_windows": negatives,
            "fn_95_upper": fn_upper, "fp_95_upper": fp_upper,
            "max_fn_95_upper": max_fn[cue], "max_fp_95_upper": max_fp[cue],
            "pass": cue_pass,
        }
    return {
        "schema": REPORT_SCHEMA,
        "verdict": "pass" if passed else "fail",
        "input_sha256": sha256(input_path),
        "model_sha256": next(iter(model_hashes)),
        "split": {
            "unit": "whole-session",
            "calibration_sessions": calibration,
            "holdout_sessions": holdout,
            "overlap": [],
        },
        "holdout_windows": len(holdout_rows),
        "unknown_windows": unknown,
        "cues": metrics,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("windows")
    parser.add_argument("--cue", action="append", required=True)
    parser.add_argument("--max-fn-upper", action="append", required=True)
    parser.add_argument("--max-fp-upper", action="append", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        max_fn = mapping(args.max_fn_upper, "--max-fn-upper")
        max_fp = mapping(args.max_fp_upper, "--max-fp-upper")
        cues = list(dict.fromkeys(args.cue))
        if set(cues) != set(max_fn) or set(cues) != set(max_fp):
            raise ValueError("every cue needs one FN and one FP upper bound")
        rows = load(args.windows)
        report = evaluate(rows, cues, max_fn, max_fp, args.windows)
    except ValueError as error:
        parser.error(str(error))
    output = pathlib.Path(args.output)
    if output.exists():
        parser.error("refusing to overwrite %s" % output)
    output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print("%s: %s" % (output, report["verdict"].upper()))
    for cue, metric in report["cues"].items():
        print("  %s TP=%d FN=%d FP=%d TN=%d FN95<=%.4f FP95<=%.4f %s"
              % (cue, metric["tp"], metric["fn"], metric["fp"], metric["tn"],
                 metric["fn_95_upper"], metric["fp_95_upper"],
                 "PASS" if metric["pass"] else "FAIL"))
    if report["verdict"] != "pass":
        sys.exit(1)


if __name__ == "__main__":
    main()
