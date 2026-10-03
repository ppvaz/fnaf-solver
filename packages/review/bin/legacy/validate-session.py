#!/usr/bin/env python3
"""Validate a v1 stock-device session manifest and its ordered event stream.

    packages/review/bin/legacy/validate-session.py MANIFEST.json [--events PATH] [--json]

Standard library only: this must run on the phone's
host, in CI, and in a checkout with no virtualenv, so there is no jsonschema
dependency. The schemas in packages/review/bin/legacy/schema/ are the machine-readable
contract; this file interprets them rather than restating them, so a field
added to a schema cannot silently go unchecked.

What it refuses, and why (docs/device/OBSERVATION-CORPUS-INVENTORY.md):

  schema-version-unsupported     a version change must fail old replay loudly
  mixed-game-builds              one session cannot straddle two game builds
  artifact-hash-missing          a filename is not provenance
  model-stale / -unauthorized    a model is executable state, not its evidence
  clock-alignment-missing        the eight clock domains are not interchangeable
  false-win-evidence             a false win is never acceptable
  secret-in-commit-safe-metadata tokens and private paths stay out of git

Exit status: 0 valid, 1 validation failure, 2 usage or I/O error.
"""

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCHEMA_DIR = HERE / "schema"

SHA256 = re.compile(r"^[0-9a-f]{64}$")
ISO8601 = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")
# A commit-safety lint, not a secret scanner: it recognises the shapes this
# repository has been told to keep out of a committed manifest, and claims
# nothing about the ones it has not been told about.
SECRET_KEY = re.compile(
    r"(?:^|_)(token|secret|password|passwd|credential|credentials"
    r"|apikey|api_key|cookie|serial)(?:$|_)", re.I)
PRIVATE_PATH = re.compile(r"^(?:/Users/|/home/|/root/)")


class Failures:
    def __init__(self):
        self.rows = []

    def add(self, code, detail):
        self.rows.append({"code": code, "detail": detail})

    def __bool__(self):
        return bool(self.rows)


def load_schema(name):
    with (SCHEMA_DIR / name).open() as handle:
        return json.load(handle)


# ---------------------------------------------------------------- type checks

def type_error(value, spec, objects):
    """Return a human reason the value does not match the spec, or None."""
    if isinstance(spec, str):
        if spec == "any":
            return None
        if spec == "string":
            return None if isinstance(value, str) else "expected string"
        if spec == "int":
            return None if isinstance(value, int) and not isinstance(value, bool) else "expected int"
        if spec == "number":
            return None if isinstance(value, (int, float)) and not isinstance(value, bool) else "expected number"
        if spec == "bool":
            return None if isinstance(value, bool) else "expected bool"
        if spec == "sha256":
            if not isinstance(value, str):
                return "expected sha256 string"
            return None if SHA256.match(value) else "expected 64 lowercase hex characters"
        if spec == "iso8601":
            if not isinstance(value, str):
                return "expected ISO-8601 UTC string"
            return None if ISO8601.match(value) else "expected YYYY-MM-DDThh:mm:ssZ"
        return f"unknown type '{spec}' in schema"

    if "const" in spec:
        return None if value == spec["const"] else f"expected {spec['const']!r}"
    if "enum" in spec:
        return None if value in spec["enum"] else f"expected one of {spec['enum']}"
    if "nullable" in spec:
        return None if value is None else type_error(value, spec["nullable"], objects)
    if "object" in spec:
        return None if isinstance(value, dict) else "expected object"
    if "array" in spec:
        if not isinstance(value, list):
            return "expected array"
        if len(value) < spec.get("min_items", 0):
            return f"expected at least {spec['min_items']} item(s)"
        return None
    if "map" in spec:
        if not isinstance(value, dict):
            return "expected object map"
        for key, item in value.items():
            reason = type_error(item, spec["map"], objects)
            if reason:
                return f"key '{key}': {reason}"
        return None
    return f"unreadable schema spec {spec!r}"


def check_object(value, name, objects, where, failures, prefix):
    """Recursively check one object against a named schema object."""
    definition = objects[name]
    required = definition.get("required", {})
    optional = definition.get("optional", {})
    known = set(required) | set(optional)

    for field, spec in required.items():
        if field not in value:
            failures.add(f"{prefix}-field-missing", f"{where}: required field '{field}' is absent")
            continue
        descend(value[field], spec, objects, f"{where}.{field}", failures, prefix)

    for field, spec in optional.items():
        if field in value:
            descend(value[field], spec, objects, f"{where}.{field}", failures, prefix)

    for field in value:
        if field not in known:
            failures.add(f"{prefix}-field-unknown",
                         f"{where}: field '{field}' is not in schema object '{name}'")


def descend(value, spec, objects, where, failures, prefix):
    reason = type_error(value, spec, objects)
    if reason:
        failures.add(f"{prefix}-field-type", f"{where}: {reason}")
        return
    if isinstance(spec, dict):
        if "nullable" in spec and value is not None:
            descend(value, spec["nullable"], objects, where, failures, prefix)
        elif "object" in spec:
            check_object(value, spec["object"], objects, where, failures, prefix)
        elif "array" in spec:
            for index, item in enumerate(value):
                descend(item, spec["array"], objects, f"{where}[{index}]", failures, prefix)


# ------------------------------------------------------------ path resolution

def path_missing(document, path):
    """First sub-path of a dotted field-group path that does not resolve."""
    parts = path.split(".")
    node = document
    walked = []
    for index, part in enumerate(parts):
        array = part.endswith("[]")
        name = part[:-2] if array else part
        walked.append(name)
        if not isinstance(node, dict) or name not in node:
            return ".".join(walked)
        node = node[name]
        if array:
            if not isinstance(node, list):
                return ".".join(walked)
            rest = ".".join(parts[index + 1:])
            for element in node:
                missing = path_missing(element, rest) if rest else None
                if missing:
                    return ".".join(walked) + "[]." + missing
            return None
    return None


# ------------------------------------------------------------- secret linting

def scan_secrets(node, where, failures, source):
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{where}.{key}"
            if isinstance(value, str) and value and SECRET_KEY.search(key):
                failures.add("secret-in-commit-safe-metadata",
                             f"{source}: '{here}' names a credential and carries a value; "
                             "commit-safe metadata must not hold tokens or serials")
            if isinstance(value, str) and PRIVATE_PATH.match(value):
                failures.add("secret-in-commit-safe-metadata",
                             f"{source}: '{here}' contains an absolute private path ({value!r})")
            scan_secrets(value, here, failures, source)
    elif isinstance(node, list):
        for index, item in enumerate(node):
            scan_secrets(item, f"{where}[{index}]", failures, source)


# ------------------------------------------------------------------ validation

def validate_manifest(manifest, schema, failures):
    if manifest.get("schema") != schema["schema"]:
        failures.add("schema-mismatch",
                     f"manifest declares schema {manifest.get('schema')!r}, "
                     f"expected {schema['schema']!r}")
        return False
    version = manifest.get("schema_version")
    if version not in schema["supported_versions"]:
        failures.add("schema-version-unsupported",
                     f"manifest schema_version {version!r} is not one of "
                     f"{schema['supported_versions']}; refusing to reinterpret it as v1")
        return False
    check_object(manifest, schema["root"], schema["objects"], "manifest", failures, "manifest")
    return not failures


def check_artifacts(manifest, failures):
    seen = set()
    for index, artifact in enumerate(manifest["artifacts"]):
        where = f"artifacts[{index}] ({artifact.get('artifact_id')})"
        if artifact.get("sha256") is None:
            failures.add("artifact-hash-missing",
                         f"{where}: no sha256; a path and a basename are not provenance")
        identifier = artifact.get("artifact_id")
        if identifier in seen:
            failures.add("duplicate-artifact-id", f"{where}: artifact_id repeats")
        seen.add(identifier)
        redaction = artifact.get("redaction", {})
        if redaction.get("contains_game_media") and redaction.get("commit_safe"):
            failures.add("raw-media-commit-declared",
                         f"{where}: declares game media and commit_safe; raw commercial "
                         "media stays out of git")
        if redaction.get("contains_game_media") and artifact.get("retention") == "commit-safe":
            failures.add("raw-media-commit-declared",
                         f"{where}: game media cannot have retention 'commit-safe'")


def check_builds(manifest, events, failures):
    build = manifest["target"]["game_build"]
    for index, artifact in enumerate(manifest["artifacts"]):
        other = artifact.get("game_build")
        if other is not None and other != build:
            failures.add("mixed-game-builds",
                         f"artifacts[{index}] ({artifact.get('artifact_id')}) was captured on "
                         f"game build {other!r}, session target is {build!r}")
    for event in events:
        other = event.get("game_build")
        if other is not None and other != build:
            failures.add("mixed-game-builds",
                         f"event seq {event.get('seq')} records game build {other!r}, "
                         f"session target is {build!r}")


def check_models(manifest, failures):
    build = manifest["target"]["game_build"]
    for index, model in enumerate(manifest["models"]):
        where = f"models[{index}] ({model.get('model_id')})"
        if model.get("authorized_for_game_build") != build:
            failures.add("model-stale",
                         f"{where}: authorized for game build "
                         f"{model.get('authorized_for_game_build')!r}, session runs {build!r}")
        if model.get("authorized_for") == "live-decision":
            holdout = model.get("holdout_report")
            if holdout is None:
                failures.add("model-unauthorized",
                             f"{where}: authorized for live decisions with no holdout report")
            elif holdout.get("errors", 0) > 0:
                failures.add("model-unauthorized",
                             f"{where}: holdout report records {holdout['errors']} error(s); "
                             "a model that misclassifies its holdout is not action-authorized")


def check_clocks(manifest, failures):
    domains = []
    for index, clock in enumerate(manifest["clocks"]):
        domain = clock.get("domain")
        if domain in domains:
            failures.add("duplicate-clock-domain", f"clocks[{index}]: domain {domain!r} repeats")
        domains.append(domain)
    for index, edge in enumerate(manifest["alignment_edges"]):
        for side in ("from_domain", "to_domain"):
            if edge.get(side) not in domains:
                failures.add("unknown-clock-domain",
                             f"alignment_edges[{index}].{side}: {edge.get(side)!r} is not a "
                             "declared clock domain")
    return domains


def read_events(path, schema, failures):
    events = []
    try:
        lines = path.read_text().splitlines()
    except OSError as error:
        failures.add("events-unreadable", f"{path}: {error}")
        return events
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            failures.add("events-unreadable", f"{path}:{number}: {error}")
            continue
        if not isinstance(record, dict):
            failures.add("events-unreadable", f"{path}:{number}: line is not a JSON object")
            continue
        where = f"event line {number}"
        check_object(record, schema["root"], schema["objects"], where, failures, "event")
        for field in schema["kind_required"].get(record.get("kind"), []):
            if record.get(field) is None:
                failures.add("event-kind-field-missing",
                             f"{where}: kind {record.get('kind')!r} requires '{field}'")
        if record.get("kind") == "observation":
            has_value = record.get("value") is not None
            has_unknown = record.get("unknown_reason") is not None
            if has_value == has_unknown:
                failures.add("event-kind-field-missing",
                             f"{where}: an observation carries exactly one of 'value' or "
                             "'unknown_reason'; an UNKNOWN must say why")
        record["_line"] = number
        events.append(record)
    return events


def check_event_stream(manifest, events, domains, failures):
    aligned = set()
    for edge in manifest["alignment_edges"]:
        aligned.add((edge.get("from_domain"), edge.get("to_domain")))
        aligned.add((edge.get("to_domain"), edge.get("from_domain")))
    models = {model["model_id"]: model for model in manifest["models"] if "model_id" in model}
    artifacts = {a["artifact_id"] for a in manifest["artifacts"] if "artifact_id" in a}

    previous_seq = None
    latest = {}
    for event in events:
        where = f"event line {event['_line']} (seq {event.get('seq')})"
        seq = event.get("seq")
        if isinstance(seq, int):
            if previous_seq is not None and seq <= previous_seq:
                failures.add("event-out-of-order",
                             f"{where}: seq must strictly increase; previous was {previous_seq}")
            previous_seq = seq

        clock = event.get("clock")
        if clock not in domains:
            failures.add("unknown-clock-domain",
                         f"{where}: clock {clock!r} is not declared in the manifest")
        else:
            when = event.get("t")
            if isinstance(when, (int, float)) and clock in latest and when < latest[clock]:
                failures.add("event-out-of-order",
                             f"{where}: t {when} precedes {latest[clock]} in the same clock "
                             f"domain {clock!r}")
            if isinstance(when, (int, float)):
                latest[clock] = when

        for field, other in (("source_clock", event.get("source_clock")),
                             ("deadline_clock", (event.get("decision") or {}).get("deadline_clock"))):
            if other is None or other == clock:
                continue
            if other not in domains:
                failures.add("unknown-clock-domain",
                             f"{where}: {field} {other!r} is not declared in the manifest")
            elif (clock, other) not in aligned:
                failures.add("clock-alignment-missing",
                             f"{where}: crosses clock domains {clock!r} -> {other!r} with no "
                             "alignment edge in the manifest; the two are not interchangeable")

        model_id = event.get("model_id")
        if model_id is not None:
            model = models.get(model_id)
            if model is None:
                failures.add("unknown-model-reference",
                             f"{where}: model_id {model_id!r} is not declared in the manifest")
            else:
                if event.get("model_sha256") not in (None, model.get("sha256")):
                    failures.add("unknown-model-reference",
                                 f"{where}: model_sha256 disagrees with the manifest entry "
                                 f"for {model_id!r}")
                split = (event.get("label_provenance") or {}).get("split_role")
                if split == "live-decision" and model.get("authorized_for") != "live-decision":
                    failures.add("model-unauthorized",
                                 f"{where}: drives a live decision with model {model_id!r}, "
                                 f"authorized only for {model.get('authorized_for')!r}")

        source = event.get("source_artifact")
        if source is not None and source not in artifacts:
            failures.add("unknown-artifact-reference",
                         f"{where}: source_artifact {source!r} is not a manifest artifact")

        if event.get("redaction", {}).get("commit_safe"):
            scan_secrets({k: v for k, v in event.items() if k != "_line"},
                         "event", failures, where)


def check_terminal_outcome(manifest, events, schema, failures):
    outcome = manifest["outcome"]
    terminal = [event for event in events
                if event.get("kind") == "lifecycle" and event.get("terminal")]
    if outcome["terminal"]:
        if not terminal:
            failures.add("terminal-event-missing",
                         "manifest declares a terminal outcome but no lifecycle event is "
                         "marked terminal")
        elif len(terminal) > 1:
            failures.add("terminal-outcome-mismatch",
                         f"{len(terminal)} lifecycle events claim to be terminal")
        elif terminal[0].get("outcome") != outcome["lifecycle"]:
            failures.add("terminal-outcome-mismatch",
                         f"manifest outcome {outcome['lifecycle']!r} disagrees with terminal "
                         f"event outcome {terminal[0].get('outcome')!r}")

    if outcome["lifecycle"] != "win":
        return
    kinds = schema["win_evidence_kinds"]
    authority = {a.get("artifact_id"): a.get("authority") for a in manifest["artifacts"]}
    supporting = [e for e in outcome["evidence"]
                  if e.get("supports") == "win" and e.get("positive") is True
                  and e.get("kind") in kinds
                  and authority.get(e.get("artifact_id")) == "primary-observation"]
    if not supporting:
        failures.add("false-win-evidence",
                     "terminal outcome 'win' has no positive 6 AM evidence from a primary "
                     f"observation (accepted evidence kinds: {kinds}); a false win is never "
                     "acceptable, so an unevidenced win stays UNKNOWN")


def check_field_groups(manifest, events, schema, failures):
    for group in schema["field_groups"]:
        label = f"field group {group['group']} ({group['name']})"
        for path in group.get("manifest_paths", []):
            missing = path_missing(manifest, path)
            if missing:
                failures.add("field-group-missing", f"{label}: manifest lacks '{missing}'")
        for path in group.get("event_paths", []):
            for event in events:
                if path.startswith("label_provenance") and event.get("kind") != "observation":
                    continue
                missing = path_missing(event, path)
                if missing:
                    failures.add("field-group-missing",
                                 f"{label}: event line {event['_line']} lacks '{missing}'")


def validate(manifest_path, events_path):
    failures = Failures()
    manifest_schema = load_schema("session-manifest-v1.json")
    event_schema = load_schema("session-events-v1.json")

    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        failures.add("manifest-unreadable", f"{manifest_path}: {error}")
        return failures, None
    if not isinstance(manifest, dict):
        failures.add("manifest-unreadable", f"{manifest_path}: not a JSON object")
        return failures, None

    if not validate_manifest(manifest, manifest_schema, failures):
        return failures, manifest

    if events_path is None:
        events_path = manifest_path.parent / manifest["event_stream"]

    check_artifacts(manifest, failures)
    check_models(manifest, failures)
    domains = check_clocks(manifest, failures)
    if manifest["redaction"]["commit_safe"]:
        scan_secrets(manifest, "manifest", failures, str(manifest_path.name))
        if manifest["helper"]["token_present"]:
            failures.add("secret-in-commit-safe-metadata",
                         "helper.token_present is true in a manifest declared commit-safe")

    events = read_events(events_path, event_schema, failures)
    check_builds(manifest, events, failures)
    check_event_stream(manifest, events, domains, failures)
    check_terminal_outcome(manifest, events, manifest_schema, failures)
    check_field_groups(manifest, events, manifest_schema, failures)
    return failures, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--events", type=Path, default=None,
                        help="event stream path (default: the manifest's event_stream field)")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if not args.manifest.exists():
        print(f"no such manifest: {args.manifest}", file=sys.stderr)
        raise SystemExit(2)

    failures, manifest = validate(args.manifest, args.events)

    if args.json:
        print(json.dumps({
            "manifest": str(args.manifest),
            "ok": not failures,
            "failures": failures.rows,
        }, indent=2))
    elif failures:
        print(f"{args.manifest.name}: {len(failures.rows)} failure(s)", file=sys.stderr)
        for row in failures.rows:
            print(f"FAIL {row['code']}: {row['detail']}", file=sys.stderr)
    else:
        session = manifest["session"]["session_id"]
        print(f"{args.manifest.name}: session {session} validates against "
              f"fnaf2.session-manifest v{manifest['schema_version']}")

    raise SystemExit(1 if failures else 0)


if __name__ == "__main__":
    main()
