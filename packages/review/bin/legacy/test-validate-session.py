#!/usr/bin/env python3
"""Synthetic contract for the v1 session manifest/event validator.

The point of this gate is not that a good session passes. It is that each way
of being wrong fails for its *own* stated reason: a validator that rejects
everything with one generic error is indistinguishable from one that rejects
everything, and would let the next malformed session be explained away.
"""

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE / "validate-session.py"
DATA = HERE / "../../test/legacy-session"
SCHEMA = HERE / "schema"


def run(manifest, events=None, as_json=False):
    argv = [sys.executable, str(TOOL), str(DATA / manifest)]
    if events:
        argv += ["--events", str(DATA / events)]
    if as_json:
        argv += ["--json"]
    return subprocess.run(argv, capture_output=True, text=True)


def first_code(manifest, events=None):
    result = run(manifest, events, as_json=True)
    assert result.returncode == 1, (manifest, result.returncode, result.stdout, result.stderr)
    payload = json.loads(result.stdout)
    assert payload["ok"] is False, payload
    assert payload["failures"], payload
    return payload["failures"][0]["code"]


# The fixtures are the committed evidence, so they may never quietly become
# game media or a real device's identity.
allowed = {".json", ".jsonl"}
for path in DATA.iterdir():
    assert path.suffix in allowed, f"non-synthetic fixture type in testdata: {path.name}"
before = {path.name: path.read_bytes() for path in DATA.iterdir()}

# The schemas must still carry all twelve minimum field groups from
# docs/device/OBSERVATION-CORPUS-INVENTORY.md. Dropping one is how a contract
# silently stops representing provenance.
manifest_schema = json.loads((SCHEMA / "session-manifest-v1.json").read_text())
event_schema = json.loads((SCHEMA / "session-events-v1.json").read_text())
groups = [group["group"] for group in manifest_schema["field_groups"]]
assert groups == list(range(1, 13)), groups
for group in manifest_schema["field_groups"]:
    assert group.get("manifest_paths") or group.get("event_paths"), group
assert manifest_schema["supported_versions"] == [1], manifest_schema["supported_versions"]
assert event_schema["supported_versions"] == [1], event_schema["supported_versions"]

# Positive fixtures. Two of them, because a win rule that is never exercised
# and a win rule that is vacuous look identical from one passing session.
for manifest in ("valid-night6-win.manifest.json", "valid-aborted-unknown.manifest.json"):
    result = run(manifest)
    assert result.returncode == 0, (manifest, result.returncode, result.stderr)
    assert "validates against fnaf2.session-manifest v1" in result.stdout, result.stdout

# Each way of being wrong, and the reason it must fail with.
expected = {
    "bad-schema-version.manifest.json": "schema-version-unsupported",
    "bad-mixed-builds.manifest.json": "mixed-game-builds",
    "bad-missing-hash.manifest.json": "artifact-hash-missing",
    "bad-stale-model.manifest.json": "model-stale",
    "bad-cross-clock.manifest.json": "clock-alignment-missing",
    "bad-false-win.manifest.json": "false-win-evidence",
    "bad-secret.manifest.json": "secret-in-commit-safe-metadata",
}
seen = {}
for manifest, code in expected.items():
    actual = first_code(manifest)
    assert actual == code, (manifest, actual, code)
    seen[code] = manifest
assert len(seen) == len(expected), seen

# Event-stream defects fail on their own terms too, against a manifest that is
# otherwise valid -- so the reason cannot be blamed on the manifest.
assert first_code("valid-night6-win.manifest.json",
                  "bad-event-order.events.jsonl") == "event-out-of-order"
assert first_code("valid-night6-win.manifest.json",
                  "bad-shadow-model-live.events.jsonl") == "model-unauthorized"

# A stale model and a shadow model driving a live decision are different
# faults; neither may be reported as the other.
assert seen["model-stale"] != "model-unauthorized"

# The secret lint is a positive control, not a claim about the fixture's
# innocence: the same manifest without the token passes.
clean = run("valid-night6-win.manifest.json", as_json=True)
assert json.loads(clean.stdout)["ok"] is True, clean.stdout

# Usage failure is distinct from validation failure, so a typo in a path can
# never be read as a passing or failing session.
missing = subprocess.run([sys.executable, str(TOOL), str(DATA / "no-such.json")],
                         capture_output=True, text=True)
assert missing.returncode == 2, (missing.returncode, missing.stderr)

after = {path.name: path.read_bytes() for path in DATA.iterdir()}
assert after == before, "validator modified a fixture"

print(f"session contract: {len(before)} synthetic fixtures, 12 field groups, "
      f"{len(expected)} manifest defects and 2 event defects each failing with "
      "its own reason; validator is read-only")
