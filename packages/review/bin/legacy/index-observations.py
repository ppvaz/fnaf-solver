#!/usr/bin/env python3
"""Read-only inventory of ignored observation artifacts.

The command classifies paths and their evidence role. It deliberately does not
infer labels from filenames, migrate layouts, or rewrite old captures.

    packages/review/bin/legacy/index-observations.py [captures] [--json] [--hash] [--strict]

`--strict` fails when a file is empty or unclassified. It does not make an old
artifact replayable; that requires the session manifest introduced by Plan 09.
"""

import argparse
import hashlib
import json
from pathlib import Path


def record(kind, authority, join=None, note=""):
    return {"kind": kind, "authority": authority, "join": join, "note": note}


def root_join(name):
    for suffix in (
        "-aborted.mp4", "-epoch.txt", "-hid.jsonl", "-cue.txt",
        "-keyframes.png", ".mp4",
    ):
        if name.endswith(suffix):
            return name[:-len(suffix)]
    return None


def classify(relative):
    parts = relative.parts
    name = relative.name
    suffix = relative.suffix.lower()

    if parts and parts[0] == "traces" and suffix == ".json":
        return record("trainer-trace", "primary-observation", name[:-5],
                      "trainer/simulator timing, not stock-game truth")

    if parts and parts[0] == "screencheck-keep" and suffix in (".raw", ".png"):
        join = parts[1] if len(parts) > 2 else None
        return record("selected-raw-frame", "primary-observation", join,
                      "selection/class filename is not an independent label")

    if parts and parts[0] == "screencheck":
        if suffix == ".scm":
            return record("scm1-model", "model-artifact", None,
                          "requires separate calibration and holdout evidence")
        if suffix in (".raw", ".png"):
            join = parts[-2] if len(parts) >= 5 else None
            return record("labeled-screen-frame", "primary-observation", join,
                          "directory label is collection intent")

    if parts and parts[0] == "cue-helper":
        if suffix == ".wav":
            join = name.split("-cue-", 1)[0] if "-cue-" in name else None
            return record("cue-audio", "primary-observation", join,
                          "continuous logs need a retained monotonic startNs")
        if suffix == ".tsv" and name.startswith("soak-"):
            return record("helper-soak", "operational-metadata")
        if suffix == ".tsv" and name.endswith("-visual.tsv"):
            return record("visual-watch", "primary-observation",
                          name[:-len("-visual.tsv")])
        if suffix == ".tsv" and name.endswith("-sessions.tsv"):
            return record("collection-boundaries", "operational-metadata",
                          name[:-len("-sessions.tsv")])

    if len(parts) == 1:
        join = root_join(name)
        if name.endswith("-aborted.mp4"):
            return record("aborted-run-video", "primary-observation", join)
        if suffix == ".mp4":
            return record("run-video", "primary-observation", join)
        if name.endswith("-epoch.txt"):
            return record("epoch-report", "operational-metadata", join)
        if name.endswith("-hid.jsonl"):
            return record("hid-trace", "emitted-action-record", join,
                          "does not prove the game accepted an action")
        if name.endswith("-cue.txt"):
            return record("cue-scalar-trace", "primary-observation", join)
        if name.endswith("-keyframes.png"):
            return record("video-keyframes", "derived-evidence", join)
        if suffix == ".hid":
            return record("hid-probe-input", "emitted-action-record", name[:-4])

    if suffix in (".mp4", ".wav", ".raw"):
        return record("unscoped-media", "primary-observation", None,
                      "media type known; producer/session unknown")
    if suffix == ".png":
        return record("derived-or-raw-image", "unknown", None,
                      "needs manual authority classification")
    if suffix == ".json" and "signature" in name.lower():
        return record("grid-signature", "model-artifact")
    return record("unclassified", "unknown", None,
                  "no current capture-family rule matches")


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def inventory(root, with_hash=False):
    rows = []
    if not root.exists():
        return rows
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root)
        info = classify(relative)
        size = path.stat().st_size
        row = {
            "path": relative.as_posix(),
            "bytes": size,
            **info,
            "verdict": "empty-unusable" if size == 0
                       else "needs-manual-classification" if info["authority"] == "unknown"
                       else "indexed-not-manifested",
        }
        if with_hash:
            row["sha256"] = digest(path)
        rows.append(row)
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default="captures", type=Path)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--hash", action="store_true",
                        help="read every file to include SHA-256 (off by default for large video)")
    parser.add_argument("--strict", action="store_true",
                        help="fail when any artifact is empty or unclassified")
    args = parser.parse_args()

    rows = inventory(args.root, args.hash)
    if args.json:
        print(json.dumps({"root": str(args.root), "artifacts": rows}, indent=2))
    else:
        print(f"{len(rows)} artifact(s) under {args.root}")
        print("bytes       authority              kind                       join  path")
        for row in rows:
            print(f"{row['bytes']:10d}  {row['authority']:<21s}  {row['kind']:<25s}  "
                  f"{(row['join'] or '-'):>4s}  {row['path']}")
            if row["note"]:
                print(f"            note: {row['note']}")
            if row["verdict"] != "indexed-not-manifested":
                print(f"            verdict: {row['verdict']}")
        if not rows:
            print("capture root is absent or empty")

    bad = [row for row in rows if row["verdict"] != "indexed-not-manifested"]
    if args.strict and bad:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
