#!/usr/bin/env python3
"""Cross-language smoke reader for the shared JSONL contract vectors."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
control = [json.loads(line) for line in (ROOT / "packages/source/test/fixtures/semantic-control-v1.jsonl").read_text().splitlines()]
assert control[0]["case"] == "valid" and control[0]["action"]["control"] == "mask"
assert control[1]["case"].startswith("invalid-") and "coordinates" in control[1]
print("contract vectors: Python reads the shared valid/invalid semantic control cases")
