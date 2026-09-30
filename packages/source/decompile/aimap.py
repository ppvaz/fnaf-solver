#!/usr/bin/env python3
"""Map every character's AI level, per hour and night, from the event sheet.

Two input forms are accepted. The canonical one is the tabular
`events-android.txt` that `packages/source/decompile/regen-dump.sh` produces and
`readdump.py` reads; the older CTFAK-rendered `03-04-Office.txt` is still
parsed for archived sheets. Either way the relevant groups carry a night
comparison, an optional hour comparison, and `<name> AI` counter writes.

Levels carry forward within a night: group 673 zeroes every counter on any
night but Custom Night, then each night/hour group overwrites only the
characters it names.

  packages/source/decompile/aimap.py [path/to/events-android.txt]
  packages/source/decompile/aimap.py --json

`$FNAF2_DUMP` (canonical) or `$FNAF2_OFFICE_DUMP` (rendered sheet) selects the
input. Either file is extracted game content and stays outside the repository.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from readdump import Dump  # noqa: E402  (same directory, after the path fix)


DEFAULT = Path(
    os.environ.get("FNAF2_OFFICE_DUMP")
    or os.environ.get("FNAF2_DUMP")
    or "/private/tmp/fnaf2-android-dump/events-android.txt"
)

# --- the rendered `03-04-Office.txt` form
GROUP = re.compile(r"^--- group (\d+) ---")
NIGHT = re.compile(r"IF\s+night -> CompareCounter \(COMPARISON\{(\S+) Long\[(\d+)\]\}")
HOUR = re.compile(r"IF\s+time of the night -> CompareCounter \(COMPARISON\{= Long\[(\d+)\]\}")
SET = re.compile(r"DO\s+(.+?) AI -> SetCounterValue \(EXPRESSION\{= (.+?)\}\)")
LONG = re.compile(r"^Long\[(\d+)\]$")
# (Random(D) + 1) / D uses integer division, so it is one only on D-1.
RAND = re.compile(
    r"Parenthesis Random Long\[(\d+)\] EndParenthesis Plus Long\[1\] "
    r"EndParenthesis Divide Long\[(\d+)\]"
)

# --- the canonical tabular form
# One flattened expression item, as EventTextDumper renders it.
ITEM = re.compile(
    r"^\[(?P<index>\d+)\]ot=(?P<ot>-?\d+),num=(?P<num>-?\d+),oi=(?P<oi>-?\d+),"
    r"oil=(?P<oil>-?\d+),loader=(?P<loader>[^,]*),value=(?P<value>.*)$"
)
# Counter compare and counter set: the two condition/action ids this reads.
COMPARE_COUNTER = -81
SET_COUNTER = 80
COUNTER_OT = 7

NAMES = [
    "old Freddy", "old Bonnie", "old Chica", "old Foxy",
    "new Freddy", "new Bonnie", "new Chica", "new Foxy",
    "Balloon Boy", "Sockpuppet", "Paperpals", "Golden Freddy",
]
# Post-XOR, the dump's old/new names are Withered/Toy; new Foxy is Mangle.
PRETTY = {
    "old Freddy": "W. Freddy",
    "old Bonnie": "W. Bonnie",
    "old Chica": "W. Chica",
    "old Foxy": "W. Foxy",
    "new Freddy": "Toy Freddy",
    "new Bonnie": "Toy Bonnie",
    "new Chica": "Toy Chica",
    "new Foxy": "Mangle",
    "Balloon Boy": "BB",
    "Sockpuppet": "Puppet",
    "Paperpals": "PaperPals",
    "Golden Freddy": "G. Freddy",
}


def value(expression):
    """Read one rendered-sheet assignment."""
    match = LONG.match(expression)
    if match:
        return int(match.group(1))
    match = RAND.search(expression)
    if match and match.group(1) == match.group(2):
        return f"1/{int(match.group(1))}"
    # Night 7 copies the Custom Night dials rather than a fixed table.
    match = re.search(r"CounterValue\[cust_(.+?) AI\]", expression)
    if match:
        return "dial"
    return expression


def parse_rendered(path):
    groups = []
    current = None
    for line in path.read_text(errors="replace").splitlines():
        match = GROUP.match(line)
        if match:
            current = {
                "id": int(match.group(1)),
                "night": None,
                "night_op": None,
                "hour": None,
                "sets": [],
            }
            groups.append(current)
            continue
        if current is None:
            continue
        match = NIGHT.search(line)
        if match:
            current["night_op"], current["night"] = (
                match.group(1), int(match.group(2))
            )
        match = HOUR.search(line)
        if match:
            current["hour"] = int(match.group(1))
        match = SET.search(line)
        if match:
            current["sets"].append(
                (match.group(1).strip(), value(match.group(2).strip()))
            )
    return groups


def expressions(params):
    """Yield (operator, items) for each ExpressionParameter in a PARAMS field."""
    for chunk in params.split(" || "):
        _, _, rest = chunk.partition(":")
        kind, _, body = rest.partition(":")
        if kind != "ExpressionParameter":
            continue
        operator, _, rendered = body.partition(" ")
        items = []
        for text in rendered.split(" ; "):
            match = ITEM.match(text.strip())
            if match:
                items.append(match.groupdict())
        yield operator[len("cmp="):], items


def tabular_value(items, dump):
    """Read one tabular assignment from its flattened expression items."""
    longs = [int(item["value"]) for item in items if item["loader"] == "LongExp"]
    if len(items) == 1 and items[0]["loader"] == "LongExp":
        return longs[0]
    # (Random(D) + 1) / D: integer division makes this one only on D-1.
    if any(item["ot"] == "-1" and item["num"] == "1" for item in items):
        if len(longs) == 3 and longs[0] == longs[2] and longs[1] == 1:
            return f"1/{longs[0]}"
    for item in items:
        if int(item["ot"]) == COUNTER_OT:
            name = dump.name(int(item["oi"]))
            # Night 7 copies the Custom Night dials rather than a fixed table.
            return "dial" if name.startswith("cust_") else name
    return " ".join(item["value"] for item in items)


def parse_tabular(path, xor=28):
    dump = Dump(str(path), xor)
    office = next(frame for frame in dump.frames if frame["name"].endswith("Office"))
    groups = []
    for group in office["groups"]:
        entry = {"id": group["idx"], "night": None, "night_op": None,
                 "hour": None, "sets": []}
        for line in group["lines"]:
            field = line.split("\t")
            kind = field[0].strip()
            cell = dict(zip(field[1::2], field[2::2]))
            if int(cell.get("OT", "0")) != COUNTER_OT:
                continue
            name = dump.name(int(cell.get("OI", "0")))
            params = line.split("PARAMS\t", 1)[1] if "PARAMS\t" in line else ""
            expression = next(iter(expressions(params)), None)
            if expression is None:
                continue
            operator, items = expression
            if kind == "C" and int(cell.get("NUM", "0")) == COMPARE_COUNTER:
                if name == "night":
                    entry["night_op"], entry["night"] = operator, int(items[0]["value"])
                elif name == "time of the night":
                    entry["hour"] = int(items[0]["value"])
            elif kind == "A" and int(cell.get("NUM", "0")) == SET_COUNTER:
                if name.endswith(" AI") and not name.startswith("cust_"):
                    entry["sets"].append((name[:-len(" AI")],
                                          tabular_value(items, dump)))
        groups.append(entry)
    return groups


def parse(path, xor=28):
    with open(path, errors="replace") as handle:
        tabular = handle.readline().startswith("GAME\t")
    groups = parse_tabular(path, xor) if tabular else parse_rendered(path)
    return [group for group in groups
            if group["sets"] and group["night"] is not None]


def applies(operator, bound, night):
    """Does a group's night comparison hold for this night?

    Both dump forms carry `<` and `>` comparisons -- group 804 zeroes Golden
    Freddy below night 6, group 821 pins the Puppet above it -- so a reader
    that only understands `=`/`<>` silently applies them to every night.
    """
    if operator in ("=", "=="):
        return night == bound
    if operator in ("<>", "!="):
        return night != bound
    if operator == "<":
        return night < bound
    if operator == ">":
        return night > bound
    if operator == "<=":
        return night <= bound
    if operator == ">=":
        return night >= bound
    raise ValueError(f"unknown night comparison {operator!r}")


def build(groups):
    """Replay the table groups, in group order, for nights 1 through 7."""
    nights = {}
    for night in range(1, 8):
        levels = {name: 0 for name in NAMES}
        per_hour = {}
        for hour in range(0, 7):
            for group in groups:
                if not applies(group["night_op"], group["night"], night):
                    continue
                # A group with no hour condition fires at the start of the night.
                group_hour = group["hour"] if group["hour"] is not None else 0
                if group_hour != hour:
                    continue
                for name, level in group["sets"]:
                    if name in levels:
                        levels[name] = level
            per_hour[hour] = dict(levels)
        nights[night] = per_hour
    return nights


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", default=str(DEFAULT))
    parser.add_argument("--xor", type=int, default=28,
                        help="handle scramble; 28 on Android, 0 on PC builds")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    path = Path(args.path)
    if not path.exists():
        raise SystemExit(f"no event sheet at {path} -- see docs/android/SOURCE-DUMP-GUIDE.md")

    nights = build(parse(path, args.xor))
    if args.json:
        print(json.dumps(nights, indent=2))
        return

    print("AI level by hour, from the Office event sheet.")
    print("Hour 0 is 12 AM; a value repeats until a later group overwrites it.")
    print(
        '"1/N" is `(Random(N)+1)/N` with integer division: one with '
        "probability 1/N, otherwise zero.\n"
    )
    for night in range(1, 8):
        label = "10/20 (Custom)" if night == 7 else f"Night {night}"
        print(f"=== {label} ===")
        print("character   " + "".join(f"{hour:>8}" for hour in range(7)))
        print(
            "            "
            + "".join(
                f"{'12AM' if hour == 0 else str(hour) + 'AM':>8}"
                for hour in range(7)
            )
        )
        for name in NAMES:
            row = [nights[night][hour][name] for hour in range(7)]
            if all(level == 0 for level in row):
                continue
            print(f"{PRETTY[name]:<12}" + "".join(f"{str(level):>8}" for level in row))
        print()


if __name__ == "__main__":
    main()
