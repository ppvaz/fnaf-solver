#!/usr/bin/env python3
"""Build FNaF 4 view templates from a `fnaf4-run.ts --mode calibrate` run.

  fnaf4-detectors.py build --run RUN_ID --out ~/fnaf-apks/fnaf4-detectors/cal0.json

The calibration choreography is open-loop (Night 1 before 2 AM: every AI is
0), so each input names the view that follows it. A frame is labelled with a
view only after that input's measured settle time and before the next input,
and a hold's lit/shut state only inside the hold. The template of a view is the
per-sample median of its round-1 frames; round 2 is the held-out check, and
the build refuses to write a file whose held-out accuracy is below 0.9 for any
view it keeps. The views render pixel-identically while nothing moves
(held-out distance p90 0.0 on cal0), so an occupant shows as distance from the
EMPTY lit template.

Frames and templates are game pixels: the output lives outside the repository.
"""
import argparse
import base64
import gzip
import json
import os
import sys

import numpy as np

KEYS = ["left_edge", "right_edge", "center"]
# view after an input, and the settle time (ms) measured on cal0 (fnaf4-run.ts
# calibrate, 2026-09-25): door runs settle 2360-2610 ms, backs 955-1767 ms.
AFTER = {"bed": "bed", "leftDoor": "doorL", "rightDoor": "doorR", "closet": "closet",
         "panRight": "roomR", "panLeft": "roomL", "continue": "roomL"}
SETTLE = {"bed": 450, "back": 2000, "leftDoor": 2800, "rightDoor": 2600, "closet": 2500,
          "panRight": 700, "panLeft": 800, "continue": 7000}
BACK_TO = {"bed": "roomL", "doorL": "hub", "doorR": "hub", "closet": "hub"}


def load(run):
    cap = os.path.expanduser(f"~/fnaf-apks/fnaf4-device-runs/{run}")
    art = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../../artifacts/runs", run)
    frames, shapes = [], None
    for line in gzip.open(os.path.join(cap, "regions.ndjson.gz"), "rt"):
        r = json.loads(line)
        parts = []
        for k in KEYS:
            a = np.frombuffer(base64.b64decode(r["regions"][k]), "<i4")
            parts.append(np.stack([(a >> 16) & 255, (a >> 8) & 255, a & 255], 1).ravel())
        if shapes is None:
            shapes = [len(p) for p in parts]
        frames.append((r["imageHostMs"], np.concatenate(parts).astype(np.float32)))
    events = [json.loads(l) for l in open(os.path.join(art, "events.jsonl"))]
    return frames, shapes, events


def label(frames, events):
    T = np.array([t for t, _ in frames])
    inputs = [e for e in events if e["type"] == "input.requested"]
    spans, where = [], "roomL"
    for i, e in enumerate(inputs):
        h = e["hostMs"]
        nxt = inputs[i + 1]["hostMs"] if i + 1 < len(inputs) else T[-1]
        c = e["control"]
        if e.get("kind") == "hold" and c in ("flashlight", "closeDoor"):
            spans.append((h + 250, h + e["durationMs"] - 50, where + ("-lit" if c == "flashlight" else "-shut")))
            spans.append((h + e["durationMs"] + 450, nxt, where))
            continue
        where = BACK_TO[where] if c == "back" else AFTER[c]
        spans.append((h + SETTLE[c], nxt, where))
    lab = np.array([""] * len(T), dtype=object)
    for a, b, s in spans:
        lab[(T >= a) & (T < b)] = s
    return T, lab


def build(args):
    frames, shapes, events = load(args.run)
    T, lab = label(frames, events)
    V = np.stack([v for _, v in frames])
    # Round 2 starts at its own phase mark: a time midpoint would cut round 1's
    # right door in half.
    split = next(e["hostMs"] for e in events if e["type"] == "phase" and e["phase"] == "r2-room-left")
    rnd = np.where(T < split, 1, 2)
    states = sorted({s for s in lab if s})
    tpl = {s: np.median(V[(lab == s) & (rnd == 1)], axis=0) for s in states if ((lab == s) & (rnd == 1)).sum() >= 5}
    names = list(tpl)
    M = np.stack([tpl[s] for s in names])
    report = {}
    for s in names:
        idx = np.where((rnd == 2) & (lab == s))[0]
        if len(idx) == 0:
            continue
        D = np.abs(M[None, :, :] - V[idx][:, None, :]).mean(2)
        pick = np.array(names)[D.argmin(1)]
        report[s] = {"n": int(len(idx)), "accuracy": float((pick == s).mean()),
                     "selfDistP90": float(np.percentile(D[:, names.index(s)], 90))}
    bad = {s: r for s, r in report.items() if r["accuracy"] < 0.9 and not s.startswith("bed")}
    print(json.dumps(report, indent=1))
    if bad:
        print(f"fnaf4-detectors: held-out accuracy below 0.9: {bad}", file=sys.stderr)
        return 3
    out = {"schema": "fnaf4-detectors-v1", "source": args.run, "regions": KEYS, "sampleCounts": shapes,
           "metric": "mean absolute RGB difference over every sample of the three regions",
           "heldOut": report,
           "templates": {s: [int(round(x)) for x in tpl[s]] for s in names}}
    os.makedirs(os.path.dirname(os.path.expanduser(args.out)), exist_ok=True)
    with open(os.path.expanduser(args.out), "w") as f:
        json.dump(out, f)
    print(f"wrote {args.out}: {len(names)} views")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="verb", required=True)
    b = sub.add_parser("build")
    b.add_argument("--run", required=True)
    b.add_argument("--out", required=True)
    args = ap.parse_args()
    return build(args)


if __name__ == "__main__":
    sys.exit(main())
