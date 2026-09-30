#!/usr/bin/env python3
"""Join raw Companion shadow results to independent labels and anchored PCM.

The trace is deliberately simple and append-only::

  cue-shadow-trace-v1 session=night-01 modelSha256=<64hex> evidence=shadow
  ARM OK armed=w0 cues=all mode=shadow openNs=100 closeNs=5000000100 ...
  RESULT HIT window=w0 count=2 events=bb_voice:21:...,... closeNs=... mode=shadow

Labels are JSONL objects with ``window_id``, ``truth`` and an independent
``label_provenance``.  The output is cue-shadow-window-v1 JSONL suitable for
evaluate-shadow.py.  Detector output never supplies its own truth label.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys

HEADER = "cue-shadow-trace-v1"
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SAFE = re.compile(r"[A-Za-z0-9._-]{1,96}\Z")


def fields(text):
    return dict(re.findall(r"([A-Za-z][A-Za-z0-9]*)=([^ ]+)", text))


def labels(path):
    out = {}
    for number, line in enumerate(pathlib.Path(path).read_text().splitlines(), 1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError("label line %d is not JSON: %s" % (number, error))
        window = item.get("window_id")
        truth = item.get("truth")
        provenance = item.get("label_provenance")
        if not SAFE.fullmatch(str(window or "")) or window in out:
            raise ValueError("label line %d has an invalid/duplicate window" % number)
        if not isinstance(truth, list) or len(truth) != len(set(truth)) or \
                any(not SAFE.fullmatch(str(cue)) for cue in truth):
            raise ValueError("label line %d has invalid truth cues" % number)
        if not isinstance(provenance, dict) or provenance.get("independent") is not True or \
                provenance.get("source") in (None, "", "cue-helper", "detector"):
            raise ValueError("label line %d is not independently established" % number)
        out[window] = {"truth": truth, "label_provenance": provenance}
    if not out:
        raise ValueError("no independent labels")
    return out


def parse_events(raw, open_ns, close_ns):
    if raw == "none":
        return []
    events = []
    for encoded in raw.split(","):
        parts = encoded.split(":")
        if len(parts) != 5:
            raise ValueError("malformed cue event: %s" % encoded)
        cue, template, cue_ns, score, margin = parts
        try:
            event = {"cue": cue, "template": template, "cue_ns": int(cue_ns),
                     "score": float(score), "margin": float(margin)}
        except ValueError:
            raise ValueError("malformed cue event: %s" % encoded)
        if not SAFE.fullmatch(cue) or not SAFE.fullmatch(template) or \
                not open_ns <= event["cue_ns"] <= close_ns:
            raise ValueError("invalid/out-of-window cue event: %s" % encoded)
        events.append(event)
    return events


def build(trace_path, labels_path, audio_sidecar, split):
    trace = pathlib.Path(trace_path).read_text().splitlines()
    if not trace or not trace[0].startswith(HEADER + " "):
        raise ValueError("trace has no cue-shadow-trace-v1 header")
    header = fields(trace[0])
    session = header.get("session")
    model_hash = header.get("modelSha256")
    if not SAFE.fullmatch(str(session or "")) or not SHA256.fullmatch(str(model_hash or "")):
        raise ValueError("trace header has invalid session/model hash")
    if header.get("evidence") not in ("shadow", "heldout"):
        raise ValueError("trace header has invalid model evidence")

    sidecar = json.loads(pathlib.Path(audio_sidecar).read_text())
    if sidecar.get("schema") != "cue-audio-anchor-v1" or \
            sidecar.get("clock_domain") != "helper_monotonic_ns" or \
            not SHA256.fullmatch(str(sidecar.get("audio_sha256", ""))):
        raise ValueError("audio sidecar is not an anchored cue-audio-anchor-v1")
    audio_path = pathlib.Path(audio_sidecar).parent / str(sidecar.get("wav", ""))
    if not audio_path.is_file():
        raise ValueError("audio sidecar does not name an existing WAV")
    if hashlib.sha256(audio_path.read_bytes()).hexdigest() != sidecar["audio_sha256"]:
        raise ValueError("audio sidecar hash does not match its WAV")

    armed = {}
    results = {}
    for number, line in enumerate(trace[1:], 2):
        if not line.strip():
            continue
        kind, sep, body = line.partition(" ")
        if not sep or kind not in ("ARM", "RESULT"):
            raise ValueError("trace line %d has an unknown record" % number)
        item = fields(body)
        if kind == "ARM":
            if not body.startswith("OK ") or item.get("mode") != "shadow":
                raise ValueError("trace line %d is not a successful shadow arm" % number)
            window = item.get("armed")
            try:
                open_ns, close_ns = int(item["openNs"]), int(item["closeNs"])
            except (KeyError, ValueError):
                raise ValueError("trace line %d has invalid arm timestamps" % number)
            if not SAFE.fullmatch(str(window or "")) or window in armed or close_ns <= open_ns:
                raise ValueError("trace line %d has an invalid/duplicate arm" % number)
            armed[window] = (open_ns, close_ns)
            continue
        state = body.split(" ", 1)[0]
        window = item.get("window")
        if state not in ("HIT", "MISS", "UNKNOWN") or window in results:
            raise ValueError("trace line %d has an invalid/duplicate result" % number)
        if window not in armed or item.get("mode") != "shadow":
            raise ValueError("trace line %d has no matching shadow arm" % number)
        open_ns, close_ns = armed[window]
        if int(item.get("closeNs", close_ns)) != close_ns:
            raise ValueError("trace line %d changes the armed close timestamp" % number)
        events = parse_events(item.get("events", "none"), open_ns, close_ns)
        if state == "HIT" and not events:
            raise ValueError("trace line %d reports HIT without events" % number)
        if state == "MISS" and events:
            raise ValueError("trace line %d reports MISS with events" % number)
        observation = {"state": state, "events": events}
        if state == "UNKNOWN":
            observation["reason"] = item.get("reason", "unspecified")
        results[window] = observation

    labelled = labels(labels_path)
    if set(armed) != set(results) or set(results) != set(labelled):
        raise ValueError("arms, terminal results, and independent labels must match exactly")
    rows = []
    for window, (open_ns, close_ns) in armed.items():
        rows.append({
            "schema": "cue-shadow-window-v1", "session_id": session,
            "split": split, "window_id": window, "open_ns": open_ns,
            "close_ns": close_ns, "truth": labelled[window]["truth"],
            "observation": results[window],
            "label_provenance": labelled[window]["label_provenance"],
            "model_sha256": model_hash,
            "audio_sha256": sidecar["audio_sha256"],
        })
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace")
    parser.add_argument("labels")
    parser.add_argument("audio_sidecar")
    parser.add_argument("--split", choices=("calibration", "holdout"), required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = pathlib.Path(args.output)
    if output.exists():
        parser.error("refusing to overwrite %s" % output)
    try:
        rows = build(args.trace, args.labels, args.audio_sidecar, args.split)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    output.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))
    print("wrote %s (%d independently labelled shadow windows)" % (output, len(rows)))


if __name__ == "__main__":
    main()
