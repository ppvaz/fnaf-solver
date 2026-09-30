#!/usr/bin/env python3
"""Emit a v1 session manifest and event stream for one device run.

    session-manifest.py start    RUN [key=value ...]
    session-manifest.py record   RUN OP [key=value ...]
    session-manifest.py event    RUN [key=value ...]
    session-manifest.py finalize RUN [key=value ...]

This is the *producer* half of the Plan 09 package 2 contract; validate-session.py
is the consumer half. It is standard-library only for the same reason: it runs
on the host beside a live phone, in CI, and in a checkout with no virtualenv.

Three properties it exists to guarantee:

  One session id, threaded.  `start` latches an id and a monotonic origin once
  and writes them to a spool; every later call reads them back. Nothing
  re-derives an id from a filename or a clock, so artifacts from one run join.

  Hashes, not filenames.     `record artifact file=...` and `record model
  file=...` hash the bytes on disk. A path that does not exist is an error, not
  an artifact entry -- a manifest that names a file nobody wrote is exactly the
  failure grade-run.sh was written for.

  Raw clocks preserved.      Every event names its clock domain. A reading that
  came from another domain keeps its own `source_clock`/`source_t`; the
  manifest carries the measured alignment edge instead of rewriting the value.

Fields are typed by tools/device/schema/*.json, not by a table restated here,
so a key this tool cannot place in the schema is refused at `record` time
rather than surfacing as a validation failure minutes later.

Exit status: 0 success, 1 refused/invalid, 2 usage or I/O error.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
SCHEMA_DIR = HERE / "schema"
# FNAF2_CAPTURES exists so the mock-ADB regression can build real sessions
# without colliding with a live run's files. It must stay inside the checkout:
# artifact paths are recorded repository-relative, and a path outside it cannot
# be recorded at all.
CAPTURES = Path(os.environ.get("FNAF2_CAPTURES") or (REPO / "captures"))

# The same two shapes validate-session.py refuses inside a commit-safe
# manifest, refused here on the way in and regardless of commit_safe: a
# producer that can write a token has already leaked it to the local disk.
SECRET_KEY = re.compile(
    r"(?:^|_)(token|secret|password|passwd|credential|credentials"
    r"|apikey|api_key|cookie|serial)(?:$|_)", re.I)
PRIVATE_PATH = re.compile(r"^(?:/Users/|/home/|/root/)")

ORIGIN_CLOCK = "host_monotonic_ms"


def host_monotonic():
    """Return one OS monotonic clock shared by separate producer processes.

    Every manifest operation is a fresh Python process.  Some instrumented
    runtimes expose ``time.monotonic()`` relative to process start, which makes
    independently recorded events run backwards.  CLOCK_MONOTONIC is the
    clock-domain contract we actually need; retain the portable wrapper only
    on platforms that do not expose it explicitly.
    """
    clock = getattr(time, "CLOCK_MONOTONIC", None)
    return time.clock_gettime(clock) if clock is not None else time.monotonic()

# op -> (schema file, root object, manifest destination)
OPS = {
    "producer":   ("manifest", "producer",       ("producer",)),
    "target":     ("manifest", "target",         ("target",)),
    "controller": ("manifest", "controller",     ("controller",)),
    "helper":     ("manifest", "helper",         ("helper",)),
    "redaction":  ("manifest", "redaction",      ("redaction",)),
    "clock":      ("manifest", "clock",          ("clocks",)),
    "align":      ("manifest", "alignment_edge", ("alignment_edges",)),
    "artifact":   ("manifest", "artifact",       ("artifacts",)),
    "model":      ("manifest", "model",          ("models",)),
    "evidence":   ("manifest", "evidence",       ("outcome", "evidence")),
}
LIST_OPS = {"clock", "align", "artifact", "model", "evidence"}


def die(message, status=2):
    print(f"session-manifest: {message}", file=sys.stderr)
    raise SystemExit(status)


def load_schema(name):
    with (SCHEMA_DIR / f"session-{name}-v1.json").open() as handle:
        return json.load(handle)


# ------------------------------------------------------------------ spool i/o

def paths(run):
    return {
        "spool": CAPTURES / f"{run}-session.spool.jsonl",
        "events": CAPTURES / f"{run}-session.events.jsonl",
        "manifest": CAPTURES / f"{run}-session.json",
    }


def read_spool(run):
    path = paths(run)["spool"]
    if not path.exists():
        die(f"no session started for {run!r}: {path.name} is absent", 2)
    rows = []
    for number, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as error:
            die(f"{path.name}:{number}: {error}", 2)
    if not rows or rows[0].get("op") != "start":
        die(f"{path.name} does not begin with a start record", 2)
    return rows


def append(path, record):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


# ------------------------------------------------------------ value handling

def guard(key, value):
    """Refuse the shapes that must never reach a manifest, wherever declared."""
    if isinstance(value, str) and value and SECRET_KEY.search(key.split(".")[-1]):
        die(f"refusing to record {key!r}: it names a credential and carries a "
            "value; a manifest never holds tokens, serials or cookies", 1)
    if isinstance(value, str) and PRIVATE_PATH.match(value):
        die(f"refusing to record {key!r}: {value!r} is an absolute private "
            "path; record a repository-relative path instead", 1)


def relative(path_text, what):
    path = Path(path_text)
    if not path.is_absolute():
        path = (Path.cwd() / path)
    path = path.resolve()
    try:
        return path, path.relative_to(REPO).as_posix()
    except ValueError:
        die(f"{what} {path_text!r} lives outside the repository; its path "
            "cannot be recorded without leaking a private location", 1)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_tree(root):
    """A directory's digest: the sorted (name, sha256) listing, itself hashed.

    Frame sets are pulled as directories and there is no single file to hash.
    Hashing the listing is reproducible from the directory alone and changes if
    any member does, which is the property a manifest needs.
    """
    listing = []
    total = 0
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        total += path.stat().st_size
        listing.append(f"{path.relative_to(root).as_posix()} {sha256_file(path)}")
    if not listing:
        return None, 0, 0
    digest = hashlib.sha256("\n".join(listing).encode() + b"\n").hexdigest()
    return digest, total, len(listing)


# --------------------------------------------------------- schema-typed keys

def leaf_spec(objects, obj_name, parts):
    definition = objects.get(obj_name)
    if definition is None:
        return None
    spec = definition.get("required", {}).get(parts[0])
    if spec is None:
        spec = definition.get("optional", {}).get(parts[0])
    if spec is None:
        return None
    if len(parts) == 1:
        return spec
    inner = spec.get("nullable", spec) if isinstance(spec, dict) else spec
    if isinstance(inner, dict) and "object" in inner:
        return leaf_spec(objects, inner["object"], parts[1:])
    return None


def coerce(spec, key, text):
    if isinstance(spec, dict):
        if "nullable" in spec:
            if text in ("", "null", "none"):
                return None
            return coerce(spec["nullable"], key, text)
        if "enum" in spec or "const" in spec:
            return text
        if "array" in spec:
            return [item for item in text.split(",") if item]
        die(f"{key!r} is a structured field; set its leaves individually", 2)
    if spec == "int":
        try:
            return int(text)
        except ValueError:
            die(f"{key!r} expects an integer, got {text!r}", 2)
    if spec == "number":
        try:
            return float(text)
        except ValueError:
            die(f"{key!r} expects a number, got {text!r}", 2)
    if spec == "bool":
        if text in ("1", "true", "True", "yes"):
            return True
        if text in ("0", "false", "False", "no"):
            return False
        die(f"{key!r} expects a boolean, got {text!r}", 2)
    return text


def parse_pairs(argv):
    pairs = []
    for item in argv:
        if "=" not in item:
            die(f"expected key=value, got {item!r}", 2)
        key, _, value = item.partition("=")
        pairs.append((key, value))
    return pairs


def typed_fields(schema_name, obj_name, pairs, skip=()):
    objects = load_schema(schema_name)["objects"]
    out = {}
    for key, text in pairs:
        if key in skip:
            continue
        parts = key.split(".")
        spec = leaf_spec(objects, obj_name, parts)
        if spec is None:
            die(f"{key!r} is not a field of schema object {obj_name!r}; the "
                "schema in tools/device/schema/ is the contract", 2)
        value = coerce(spec, key, text)
        guard(key, value)
        node = out
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return out


def deep_merge(into, extra):
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(into.get(key), dict):
            deep_merge(into[key], value)
        else:
            into[key] = value


# ------------------------------------------------------------------ git facts

def git(*args):
    try:
        result = subprocess.run(["git", "-C", str(REPO), *args],
                                capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip() if result.returncode == 0 else None


# -------------------------------------------------------------- subcommands

def cmd_start(run, argv):
    spool = paths(run)["spool"]
    if spool.exists():
        die(f"{spool.name} already exists; a session id is latched once per "
            "run name, never re-derived. Use a fresh run name.", 2)
    fields = dict(parse_pairs(argv))
    unknown = set(fields) - {"command", "session_id", "cohort_id", "tool_version"}
    if unknown:
        die(f"start does not take {sorted(unknown)}; use `record`", 2)
    command = fields.get("command")
    if not command:
        die("start needs command=<the producer's argv[0], repo-relative>", 2)
    guard("command", command)

    commit = git("rev-parse", "--short", "HEAD") or "unknown"
    dirty = git("status", "--porcelain")
    session_id = fields.get("session_id") or (
        f"{run}-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid.uuid4().hex[:8]}")
    record = {
        "op": "start",
        "session_id": session_id,
        "cohort_id": fields.get("cohort_id") or None,
        "command": command,
        "tool_version": fields.get("tool_version") or f"{Path(command).name}@{commit}",
        "repo_commit": commit,
        "dirty_tree": bool(dirty) if dirty is not None else True,
        "started_at_utc": f"{datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ}",
        "origin_monotonic": host_monotonic(),
        "origin_wall_ms": int(time.time() * 1000),
    }
    append(spool, record)
    paths(run)["events"].touch()
    # Shell-evalable, so the caller threads exactly what was latched here
    # instead of computing a second answer.
    print(f"FNAF2_SESSION_ID={session_id}")
    print(f"FNAF2_SESSION_RUN={run}")
    print(f"FNAF2_SESSION_ORIGIN_WALL_MS={record['origin_wall_ms']}")
    return 0


def cmd_record(run, argv):
    if not argv:
        die("record needs an op: " + " ".join(sorted(OPS) + ["env", "note"]), 2)
    op, rest = argv[0], argv[1:]
    read_spool(run)                       # refuses if no session was started
    pairs = parse_pairs(rest)

    if op == "env":
        fields = {}
        for key, value in pairs:
            guard(key, value)
            fields[key] = value
        append(paths(run)["spool"], {"op": "env", "fields": fields})
        return 0
    if op == "note":
        text = dict(pairs).get("text", "")
        guard("note", text)
        append(paths(run)["spool"], {"op": "note", "text": text})
        return 0
    if op not in OPS:
        die(f"unknown op {op!r}; expected one of "
            + ", ".join(sorted(list(OPS) + ["env", "note"])), 2)

    schema_name, obj_name, _ = OPS[op]
    given = dict(pairs)
    derived = {}

    if op == "model":
        # A model records its hash and nothing about where it sat. Model files
        # are gitignored and often live outside the checkout entirely; the hash
        # is the provenance, which is the point of recording one at all.
        source = given.get("file")
        if not source:
            die("record model needs file=<path>", 2)
        resolved = Path(source).expanduser().resolve()
        if not resolved.is_file():
            die(f"record model file={source!r}: not a file. A manifest does not "
                "name a model nobody can hash.", 1)
        derived = {"sha256": sha256_file(resolved)}

    if op == "artifact":
        source = given.get("file") or given.get("dir")
        if not source:
            die("record artifact needs file=<path> (or dir=<path> for a frame set)", 2)
        resolved, rel = relative(source, "artifact source")
        if "dir" in given:
            if not resolved.is_dir():
                die(f"record artifact dir={source!r}: not a directory. A manifest "
                    "does not name artifacts that were never written.", 1)
            digest, total, count = sha256_tree(resolved)
            if count == 0:
                die(f"record artifact dir={source!r}: the directory is empty. "
                    "An empty frame set is a fault to report, not an artifact.", 1)
            derived = {"path": rel, "sha256": digest, "bytes": total}
            print(f"session-manifest: {op} {given.get('artifact_id', rel)}: "
                  f"{count} file(s), {total} bytes")
        else:
            if not resolved.is_file():
                die(f"record {op} file={source!r}: not a file. A manifest does not "
                    "name artifacts that were never written.", 1)
            derived = {"path": rel,
                       "sha256": sha256_file(resolved),
                       "bytes": resolved.stat().st_size}

    if op == "controller" and "plan_file" in given:
        # Same reasoning as a model: the plan is identified by its bytes. The
        # emitted plan lives in a per-run temporary directory that is gone by
        # the time anyone reads the manifest, so its path would be a dead name.
        resolved = Path(given["plan_file"]).expanduser().resolve()
        if not resolved.is_file():
            die(f"record controller plan_file={given['plan_file']!r}: not a file", 1)
        derived["plan_sha256"] = sha256_file(resolved)

    fields = typed_fields(schema_name, obj_name, pairs,
                          skip=("file", "dir", "plan_file"))
    deep_merge(fields, derived)
    append(paths(run)["spool"], {"op": op, "fields": fields})
    return 0


def event_fields(pairs):
    return typed_fields("events", "event", pairs)


def cmd_event(run, argv, spool_rows=None):
    rows = spool_rows or read_spool(run)
    start = rows[0]
    events = paths(run)["events"]
    seq = sum(1 for line in events.read_text().splitlines() if line.strip()) + 1 \
        if events.exists() else 1

    fields = event_fields(parse_pairs(argv))
    fields.pop("seq", None)
    record = {"seq": seq}
    record["clock"] = fields.pop("clock", ORIGIN_CLOCK)
    record["t"] = fields.pop("t", round(
        (host_monotonic() - start["origin_monotonic"]) * 1000, 1))
    record["kind"] = fields.pop("kind", "lifecycle")
    redaction = fields.pop("redaction", {})
    redaction.setdefault("commit_safe", True)
    record["redaction"] = redaction
    record.update(fields)
    append(events, record)
    return 0


# ------------------------------------------------------------------ finalize

def elapsed_ms(start):
    return round((host_monotonic() - start["origin_monotonic"]) * 1000, 1)


def assemble(run, rows, closing):
    start = rows[0]
    manifest = {
        "schema": "fnaf2.session-manifest",
        "schema_version": 1,
        "event_stream": paths(run)["events"].name,
        "session": {
            "session_id": start["session_id"],
            "cohort_id": start["cohort_id"],
            "started_at_utc": start["started_at_utc"],
            "ended_at_utc": f"{datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ}",
            "origin_clock": ORIGIN_CLOCK,
        },
        "producer": {
            "command": start["command"],
            "tool_version": start["tool_version"],
            "repo_commit": start["repo_commit"],
            "dirty_tree": start["dirty_tree"],
            "environment": {},
        },
        "target": {},
        "clocks": [{
            "domain": ORIGIN_CLOCK,
            "kind": "monotonic",
            "units": "ms",
            "origin_note": "python time.monotonic() latched by "
                           "session-manifest.py start; host-side only",
            "valid_from": 0,
            "valid_until": elapsed_ms(start),
        }],
        "alignment_edges": [],
        "artifacts": [],
        "models": [],
        "controller": {},
        "outcome": {"lifecycle": closing["lifecycle"],
                    "terminal": closing["terminal"],
                    "evidence": []},
        "helper": {"process_identity": None, "restarts": 0, "revocations": 0,
                   "focus_faults": 0, "token_present": False},
        "redaction": {
            "commit_safe": True,
            "raw_media_committed": False,
            "notes": "captures/ is gitignored; this manifest carries paths, "
                     "sizes and hashes, never media",
        },
    }
    notes = []
    for row in rows[1:]:
        op = row["op"]
        if op == "env":
            manifest["producer"]["environment"].update(row["fields"])
        elif op == "note":
            notes.append(row["text"])
        elif op in LIST_OPS:
            _, _, dest = OPS[op]
            node = manifest
            for part in dest[:-1]:
                node = node[part]
            node[dest[-1]].append(row["fields"])
        else:
            _, _, dest = OPS[op]
            deep_merge(manifest[dest[0]], row["fields"])
    if notes:
        manifest["notes"] = " | ".join(notes)
    return manifest


def cmd_finalize(run, argv):
    where = paths(run)
    rows = read_spool(run)
    start = rows[0]
    fields = dict(parse_pairs(argv))
    lifecycle = fields.get("lifecycle", "unknown")
    if lifecycle not in ("win", "death", "aborted", "focus-loss", "unknown"):
        die(f"lifecycle {lifecycle!r} is not a v1 outcome", 2)
    terminal = fields.get("terminal", "true" if lifecycle != "unknown" else "false")
    terminal = terminal in ("1", "true", "True", "yes")
    reason = fields.get("reason", "")
    guard("reason", reason)

    if terminal:
        # The manifest and the stream must not be able to disagree about how
        # the session ended, so the terminal record is written here, from the
        # same decision, rather than left to each caller's exit path.
        cmd_event(run, ["kind=lifecycle", f"outcome={lifecycle}", "terminal=true",
                        "sensor=runner", f"note={reason or lifecycle}"],
                  spool_rows=rows)

    manifest = assemble(run, rows, {"lifecycle": lifecycle, "terminal": terminal})

    # The event stream is itself an artifact of the session, and hashing it
    # last guarantees at least one artifact exists even for a run that captured
    # nothing -- an empty artifact list would otherwise read as "no manifest".
    manifest["artifacts"].append({
        "artifact_id": "session-events",
        "role": "session-event-stream",
        "authority": "operational-metadata",
        "path": where["events"].relative_to(REPO).as_posix(),
        "format": "application/x-ndjson",
        "bytes": where["events"].stat().st_size if where["events"].exists() else 0,
        "sha256": sha256_file(where["events"]) if where["events"].exists() else None,
        "complete": True,
        "truncated": False,
        "retention": "local-only",
        "clock_domain": ORIGIN_CLOCK,
        "game_build": None,
        "redaction": {"contains_game_media": False, "contains_audio": False,
                      "commit_safe": True},
    })
    if not manifest["outcome"]["evidence"]:
        manifest["outcome"]["evidence"].append({
            "kind": "runner-exit-record",
            "supports": lifecycle,
            "positive": True,
            "artifact_id": "session-events",
            "note": reason or "the runner's own exit path; no independent "
                              "grader has spoken for this interval",
        })
    if manifest["helper"]["token_present"]:
        # A live helper token existed in this session. The manifest never holds
        # it, but v1 treats "commit-safe" and "a token was in play" as
        # contradictory, and the honest side of that is not to claim commit
        # safety for a session that had one.
        manifest["redaction"]["commit_safe"] = False
        manifest["redaction"]["notes"] += \
            "; a Companion session token was in play, so this manifest is not " \
            "declared commit-safe (the token itself is never recorded)"

    missing = [key for key in ("game_package", "game_version", "game_build", "night",
                               "configuration", "device_model", "sensor_path")
               if key not in manifest["target"]]
    if missing or "display" not in manifest["target"]:
        die("target facts were never recorded: "
            + ", ".join(missing + ([] if "display" in manifest["target"] else ["display"]))
            + ". Refusing to write a manifest that cannot name its build or "
              "device; the spool is kept at " + where["spool"].name, 1)
    if not manifest["controller"]:
        die("no controller was recorded; refusing to write a manifest that "
            "cannot name the policy that produced the run", 1)

    tmp = where["manifest"].with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2, sort_keys=False) + "\n")
    os.replace(tmp, where["manifest"])

    validator = subprocess.run(
        [sys.executable, str(HERE / "validate-session.py"), str(where["manifest"])],
        capture_output=True, text=True)
    sys.stdout.write(validator.stdout)
    sys.stderr.write(validator.stderr)
    if validator.returncode != 0:
        print(f"session-manifest: {where['manifest'].name} was written but does "
              "NOT validate; the spool is kept beside it so the defect can be "
              "corrected and re-finalized", file=sys.stderr)
        return 1
    where["spool"].unlink()
    print(f"session-manifest: {where['manifest'].name} "
          f"({len(manifest['artifacts'])} artifact(s), "
          f"{len(manifest['models'])} model(s), outcome {lifecycle})")
    return 0


def main(argv):
    if len(argv) < 3:
        print(__doc__, file=sys.stderr)
        raise SystemExit(2)
    command, run = argv[1], argv[2]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,79}", run):
        die(f"run name {run!r} must be a plain basename", 2)
    rest = argv[3:]
    if command == "start":
        return cmd_start(run, rest)
    if command == "record":
        return cmd_record(run, rest)
    if command == "event":
        return cmd_event(run, rest)
    if command == "finalize":
        return cmd_finalize(run, rest)
    die(f"unknown subcommand {command!r}", 2)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
