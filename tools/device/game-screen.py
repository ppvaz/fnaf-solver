#!/usr/bin/env python3
"""Name the game whose title screen a native frame shows, or say UNKNOWN.

    game-screen.py < frame.png                  # game=fnaf4 screen=menu model=title-fnaf4-moto-g56-v204
    game-screen.py --expect fnaf2 < frame.png   # exit 0 only if the frame is FNaF 2's title
    game-screen.py --json < frame.png           # the verdict plus every model's gate readings
    game-screen.py --calibrate CORPUS.tsv [--out EVIDENCE.json]

The frame is a native 2400x1080 PNG, as the Companion's SNAP writes it
(`native-frame.mjs`); nothing is resized to fit. Every target in
`models/companion-targets-v1.json` that names a `titleModel` is asked the same
question with its own gates (title-observe.py's title-model-v1: a title gate
the logo lights, a foreign gate the title never lights, a menu gate the menu
row lights). A model CLAIMS the frame when its title gate reads present and its
foreign gate absent; it REFUSES when either reads the other way; anything in a
gate's undecided band is AMBIGUOUS.

The verdict is a game only when exactly one model claims and no other model
competes. A competitor is a second claim, or a model whose logo box reads
present and is held back only by its foreign gate or a static bar: FNaF 1
titles under a static bar light FNaF 2's gates, and a white flash lights every
white-text gate at once, so "the first model that matches" would put a FNaF 2
label on another game's screen. That is the one thing this tool must never do.
A model whose logo box reads inside its own undecided band is not a
competitor -- FNaF 3's logo box reads 0.11-0.20 on FNaF 2's logo text -- and
with no claim at all it makes the verdict UNKNOWN(ambiguous).
docs/evidence/companion-game-screen-20260927.json holds the corpus this rule
was measured on: 0 wrong identifications.

A pixel model names the title a frame shows, not the package that drew it:
the clean-room rebuilds render their game's title, and no rebuild has a
measured model, so their frames read as that retail title or as UNKNOWN. Which
package is in front is the focus fact (`dumpsys window`), which
cue-helper-setup.py reads beside this.

One line on stdout:

    game=<key> screen=<menu|no-menu|ambiguous-menu|title> model=<model id>   exit 0
    game=UNKNOWN reason=<reason>                                           exit 3

`--expect GAME` exits 3 unless the verdict is GAME. `--calibrate` reads
`game<TAB>label<TAB>path` rows (label `title` for a settled title screen,
anything else otherwise), reports the verdict per frame and the confusion, and
with `--out` writes the derived numbers only -- frame sha256s, labels, gate
readings, verdicts -- never a frame. Exit codes: 0 identified (or calibration
with no wrong identification), 3 unknown or expectation unmet, 4 a calibration
found a wrong identification, 2 usage or I/O failure.
"""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
REGISTRY = os.path.join(HERE, "models", "companion-targets-v1.json")
SCHEMA = "companion-game-screen-v1"


def load_title_observe():
    spec = importlib.util.spec_from_file_location("title_observe", os.path.join(HERE, "title-observe.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


OBS = load_title_observe()


def usage(message):
    print(f"game-screen: {message}", file=sys.stderr)
    raise SystemExit(2)


def load_models(registry_path):
    """{game: (model id, model path, parsed model)} for every target naming a title model."""
    try:
        with open(registry_path, "r", encoding="utf-8") as handle:
            registry = json.load(handle)
    except (OSError, ValueError):
        usage(f"unreadable target registry {registry_path}")
    if registry.get("schema") != "companion-targets-v1":
        usage("the target registry is not companion-targets-v1")
    models = {}
    for target in registry.get("targets", []):
        path = target.get("titleModel")
        if not path:
            continue
        full = path if os.path.isabs(path) else os.path.join(ROOT, path)
        sink = io.StringIO()
        try:
            with contextlib.redirect_stdout(sink):
                model = OBS.load_model(full)
        except SystemExit:
            usage(f"title model for {target['game']} refused: {sink.getvalue().strip()}")
        if model["title_gate"] is None:
            usage(f"title model for {target['game']} has no title_gate and cannot identify a screen")
        models[target["game"]] = (os.path.splitext(os.path.basename(path))[0], full, model)
    if not models:
        usage("no target names a title model")
    return models


def read(image, box, pixel):
    return round(OBS.box_fraction(image, box, pixel), 4)


def judge(image, model):
    """One model's view of the frame: claim / refuse / ambiguous, with its readings."""
    readings = {}
    gate = model["title_gate"]
    value = readings["title"] = read(image, gate["box"], gate["pixel"])
    if value <= gate["max_absent"]:
        return "refuse", "title-absent", readings
    if value < gate["min"]:
        return "ambiguous", "title-gate", readings
    foreign = model["foreign_gate"]
    if foreign is not None:
        value = readings["foreign"] = read(image, foreign["box"], foreign["pixel"])
        if value > foreign["max_absent"]:
            if foreign["static_x"] is not None:
                _, top, _, bottom = foreign["box"]
                lit = readings["static"] = read(
                    image, (foreign["static_x"][0], top, foreign["static_x"][1], bottom), model["bright_min"])
                if lit > foreign["static_max"]:
                    return "ambiguous", "static-bar", readings
            if value >= foreign["min"]:
                return "refuse", "foreign", readings
            return "ambiguous", "foreign-gate", readings
    menu = model["menu_gate"]
    if menu is None:
        return "claim", "title", readings
    value = readings["menu"] = read(image, menu["box"], menu["pixel"])
    if value >= menu["min"]:
        return "claim", "menu", readings
    if value <= menu["max_absent"]:
        return "claim", "no-menu", readings
    return "claim", "ambiguous-menu", readings


def identify(image, models):
    """{game, screen, model, reason, models: {game: {verdict, why, readings}}}."""
    seen = {}
    for game, (model_id, _, model) in sorted(models.items()):
        verdict, why, readings = judge(image, model)
        seen[game] = {"verdict": verdict, "why": why, "readings": readings, "model": model_id}
    claims = [game for game, row in seen.items() if row["verdict"] == "claim"]
    # A model whose own logo box reads between its thresholds neither sees its
    # title nor rules it out; beside a model that does see its logo and passes
    # its foreign gate, that is noise (FNaF 3's logo box reads 0.11-0.20 on
    # FNaF 2's logo text). A model whose logo box reads PRESENT and is held
    # back only by its foreign gate or its static bar is a competitor: FNaF 1
    # titles under a static bar light FNaF 2's gates too (2026-09-27 corpus).
    blocking = [game for game, row in seen.items() if row["verdict"] == "ambiguous" and row["why"] != "title-gate"]
    unsure = [game for game, row in seen.items() if row["verdict"] == "ambiguous"]
    result = {"schema": SCHEMA, "game": None, "screen": None, "model": None, "reason": None, "models": seen}
    if len(claims) > 1:
        result["reason"] = "conflict:" + "+".join(claims)
    elif blocking or (unsure and not claims):
        result["reason"] = "ambiguous:" + "+".join(f"{g}:{seen[g]['why']}" for g in unsure)
    elif not claims:
        result["reason"] = "no-registered-title"
    else:
        game = claims[0]
        result.update(game=game, screen=seen[game]["why"], model=seen[game]["model"])
    return result


def line(result):
    if result["game"] is None:
        return f"game=UNKNOWN reason={result['reason']}"
    return f"game={result['game']} screen={result['screen']} model={result['model']}"


def open_native(source):
    try:
        image, _ = OBS.open_frame(source, None)
    except OBS.SensorMismatch as exc:
        return None, str(exc)
    return image, None


def calibrate(corpus_path, models, out_path):
    """Verdicts over a labelled corpus. Rows are compact: [sha256[:16], game,
    label, verdict, screen or reason, {model: [title, foreign, menu]}], the
    readings left out where every model refused the frame outright."""
    rows, confusion, wrong, notes = [], {}, [], []
    try:
        with open(corpus_path, "r", encoding="utf-8") as handle:
            lines = [raw.rstrip("\n") for raw in handle if raw.strip()]
    except OSError:
        usage(f"unreadable corpus {corpus_path}")
    for raw in lines:
        if raw.startswith("#"):
            if raw.startswith("# note:"):
                notes.append(raw[len("# note:"):].strip())
            continue
        entry = raw.split("\t")
        if len(entry) != 3:
            usage(f"corpus rows are game<TAB>label<TAB>path: {entry!r}")
        truth, label, path = entry
        try:
            with open(path, "rb") as handle:
                data = handle.read()
        except OSError:
            usage(f"unreadable frame {path}")
        image, refusal = open_native(io.BytesIO(data))
        sha = hashlib.sha256(data).hexdigest()
        if image is None:
            rows.append([sha[:16], truth, label, "UNREAD", refusal])
            continue
        result = identify(image, models)
        verdict = result["game"] or "UNKNOWN"
        key = f"{truth}/{'title' if label == 'title' else 'other'}"
        bucket = confusion.setdefault(key, {})
        bucket[verdict] = bucket.get(verdict, 0) + 1
        if result["game"] is not None and result["game"] != truth:
            wrong.append({"sha256": sha, "game": truth, "label": label, "claimed": result["game"]})
        row = [sha[:16], truth, label, verdict, result["screen"] or result["reason"]]
        if result["reason"] != "no-registered-title":
            row.append({g: [m["readings"].get(k) for k in ("title", "foreign", "menu")]
                        for g, m in result["models"].items() if m["readings"]["title"] > 0})
        rows.append(row)
    summary = {"frames": len(rows), "unread": sum(1 for r in rows if r[3] == "UNREAD"),
               "wrongIdentifications": len(wrong), "confusion": confusion}
    for game in sorted(models):
        titles = confusion.get(f"{game}/title", {})
        total = sum(titles.values())
        summary.setdefault("titleRecall", {})[game] = (
            {"identified": titles.get(game, 0), "of": total} if total else "UNKNOWN(no title frames)")
    print(json.dumps(summary, indent=2, sort_keys=True))
    if out_path:
        document = {
            "schema": "companion-game-screen-calibration-v1",
            "tool": "tools/device/game-screen.py --calibrate",
            "rule": "a game only when exactly one registered title model claims the frame (title gate present, "
                    "foreign gate absent) and no other model competes (a second claim, or a logo box read present "
                    "but held back by its foreign gate or a static bar)",
            "models": {g: {"id": mid, "path": os.path.relpath(path, ROOT),
                           "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()}
                       for g, (mid, path, _) in sorted(models.items())},
            "corpusNotes": notes,
            "rowFormat": ["sha256[:16]", "game", "label", "verdict", "screen or reason",
                          "{model: [title, foreign, menu]} for models whose title box read above 0; "
                          "absent where every model refused"],
            "summary": summary, "wrong": wrong, "rows": rows,
        }
        document["claimLevel"] = "FIXTURE"
        document["evidenceId"] = "companion-game-screen-sha256-" + hashlib.sha256(
            json.dumps(document, separators=(",", ":"), sort_keys=True).encode()).hexdigest()[:16]
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(document, handle, separators=(",", ":"), sort_keys=True)
            handle.write("\n")
    return 4 if wrong else 0


def main(argv):
    registry = REGISTRY
    expect = None
    want_json = False
    corpus = None
    out_path = None
    i = 0
    while i < len(argv):
        flag = argv[i]
        if flag in ("--registry", "--expect", "--calibrate", "--out"):
            if i + 1 >= len(argv):
                usage(f"{flag} needs a value")
            value = argv[i + 1]
            if flag == "--registry":
                registry = value
            elif flag == "--expect":
                expect = value
            elif flag == "--calibrate":
                corpus = value
            else:
                out_path = value
            i += 2
            continue
        if flag == "--json":
            want_json = True
            i += 1
            continue
        usage(f"unknown argument {flag} (the frame is read on stdin)")
    models = load_models(registry)
    if corpus is not None:
        return calibrate(corpus, models, out_path)
    if out_path is not None:
        usage("--out belongs to --calibrate")
    if expect is not None and not (expect.replace("-", "").isalnum() and expect.islower()):
        usage("--expect takes a game key such as fnaf2")
    image, refusal = open_native(sys.stdin.buffer)
    if image is None:
        result = {"schema": SCHEMA, "game": None, "screen": None, "model": None,
                  "reason": f"unreadable:{refusal}", "models": {}}
    else:
        result = identify(image, models)
    if want_json:
        print(json.dumps(result, sort_keys=True))
    else:
        print(line(result))
    if result["game"] is None or (expect is not None and result["game"] != expect):
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
