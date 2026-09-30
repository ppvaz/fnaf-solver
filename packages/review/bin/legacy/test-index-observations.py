#!/usr/bin/env python3
"""Synthetic contract for the read-only observation index."""

import json
import subprocess
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
TOOL = HERE / "index-observations.py"


def write(root, name, body=b"x"):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)


with tempfile.TemporaryDirectory(prefix="fnaf-observation-index-") as temporary:
    root = Path(temporary) / "captures"
    samples = {
        "run-aborted.mp4": "aborted-run-video",
        "run-epoch.txt": "epoch-report",
        "run-hid.jsonl": "hid-trace",
        "run-cue.txt": "cue-scalar-trace",
        "run-keyframes.png": "video-keyframes",
        "probe.hid": "hid-probe-input",
        "traces/lesson.json": "trainer-trace",
        "screencheck/bb-left/calibration/session-a/empty/a.raw": "labeled-screen-frame",
        "screencheck/bb-left/models/runtime.scm": "scm1-model",
        "screencheck-keep/run/001000-bb.raw": "selected-raw-frame",
        "cue-helper/calibration/run-cue-1-p0-q1.wav": "cue-audio",
        "cue-helper/calibration/run-visual.tsv": "visual-watch",
        "cue-helper/calibration/run-sessions.tsv": "collection-boundaries",
        "cue-helper/soak-20260826.tsv": "helper-soak",
        "mystery.bin": "unclassified",
    }
    for name in samples:
        write(root, name)
    before = {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}

    result = subprocess.run(
        ["python3", TOOL, root, "--json", "--hash"],
        capture_output=True, text=True, check=True,
    )
    payload = json.loads(result.stdout)
    rows = {row["path"]: row for row in payload["artifacts"]}
    assert set(rows) == set(samples), (set(rows), set(samples))
    for name, kind in samples.items():
        assert rows[name]["kind"] == kind, (name, rows[name])
        assert len(rows[name]["sha256"]) == 64
    assert rows["run-hid.jsonl"]["authority"] == "emitted-action-record"
    assert rows["run-hid.jsonl"]["join"] == "run"
    assert rows["mystery.bin"]["verdict"] == "needs-manual-classification"
    after = {path.relative_to(root): path.read_bytes() for path in root.rglob("*") if path.is_file()}
    assert after == before, "index modified a capture"

    strict = subprocess.run(["python3", TOOL, root, "--strict"], capture_output=True)
    assert strict.returncode == 1, strict.returncode
    (root / "mystery.bin").unlink()
    strict = subprocess.run(["python3", TOOL, root, "--strict"], capture_output=True)
    assert strict.returncode == 0, strict.stderr.decode(errors="replace")

print("observation index: families classified, joins stable, strict mode and read-only contract pass")
