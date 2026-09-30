#!/usr/bin/env python3
"""Read a night out of a rendered CTFAK event sheet, for any of the four games.

`aimap.py` answers one question about one game: FNaF 2's per-night AI counter
table. This answers the same class of question about *whatever sheet it is
pointed at*, which is what makes a second, third and fourth game's night
modellable without a bespoke parser each time.

The sheet format is the CTFAK-rendered one, produced by `dump_events.py`:

    --- group N ---
      IF   <condition>
      DO   <action>

Every line in all four games' dumps is one of: a group header, an `IF`, a `DO`,
a `FRAME` header, its `====` underline, or blank. Nothing wraps, so the parse
is a split rather than a grammar -- see `--audit`, which prints any line the
reader could not classify. An empty audit is the claim that nothing was
silently dropped.

Reports (each also available as `--json`):

  --table       the per-night / per-hour difficulty table
  --clock       the night clock: what ticks, what rolls over, what wins
  --rolls       movement rolls: `Every N ms` + `Random(B)+1 <= <counter>`
  --graph OBJ   an object's movement graph: overlap source -> position target
  --draws       every `Random` draw, with whether a timer forces it
  --timers      every distinct `Every` / `TimerEquals` period
  --audit       unclassified lines (should be empty)

Usage:

    packages/source/decompile/nightmap.py --game fnaf1 --table
    packages/source/decompile/nightmap.py --sheet path/to/03-04-Office.txt --clock --json
    packages/source/decompile/nightmap.py --game fnaf4 --graph Bonnie

`--game` resolves a sheet through `$FNAF_DUMP_ROOT` (default `~/fnaf-apks`),
whose per-game `events/` directories hold extracted game content and stay
outside the repository. `--sheet` takes a path directly.

The counter names each game uses for its night and hour are *not* guessed from
a convention -- FNaF 4's is `Night` where FNaF 1's is `night number`, and a
lowercase-only query finds nothing in FNaF 4 while looking exactly like an
absence. They are named per game in GAMES below, and `--clock` derives the
clock chain structurally so that a wrong name shows up as a missing chain
rather than as a plausible wrong number.
"""
import argparse
import json
import os
import re
import sys
from collections import OrderedDict
from pathlib import Path

# --- sheet resolution -------------------------------------------------------

DUMP_ROOT = Path(os.environ.get("FNAF_DUMP_ROOT", Path.home() / "fnaf-apks"))

# Per game: the night frame's sheet, and the counters that carry night and
# hour. Each name is quoted from that game's own sheet, not inferred.
GAMES = {
    "fnaf1": {
        "sheet": "fnaf1/events/05-06-Main_Room.txt",
        "night": "night number",
        "hour": "time of day",
    },
    "fnaf2": {
        "sheet": "fnaf2/events/03-04-Office.txt",
        "night": "night",
        "hour": "time of the night",
    },
    "fnaf3": {
        "sheet": "fnaf3/events/03-04-Office.txt",
        "night": "night number",
        "hour": "hour",
    },
    "fnaf4": {
        "sheet": "fnaf4/events/03-04-level.txt",
        "night": "Night",
        "hour": "hour",
    },
}


def resolve_sheet(game=None, sheet=None):
    if sheet:
        return Path(sheet)
    if game:
        return DUMP_ROOT / GAMES[game]["sheet"]
    raise SystemExit("nightmap: pass --game or --sheet")


# --- the parse --------------------------------------------------------------

GROUP = re.compile(r"^--- group (\d+) ---")
LINE = re.compile(r"^  (IF|DO)   (.*)$")
FRAME = re.compile(r"^FRAME \d+:")
RULE = re.compile(r"^=+$")


class Group:
    __slots__ = ("id", "conditions", "actions")

    def __init__(self, gid):
        self.id = gid
        self.conditions = []
        self.actions = []

    def __repr__(self):
        return f"<group {self.id}: {len(self.conditions)} IF, {len(self.actions)} DO>"


def parse(text):
    """Split a rendered sheet into groups. Returns (groups, unclassified)."""
    groups = []
    unclassified = []
    current = None
    for number, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        header = GROUP.match(raw)
        if header:
            current = Group(int(header.group(1)))
            groups.append(current)
            continue
        if FRAME.match(raw) or RULE.match(raw):
            continue
        kind = LINE.match(raw)
        if kind and current is not None:
            (current.conditions if kind.group(1) == "IF" else current.actions).append(
                kind.group(2))
            continue
        unclassified.append((number, raw))
    return groups, unclassified


# --- the shapes a condition or action can carry -----------------------------

EVERY = re.compile(r"\bEvery \(TIME\{[^}]*timer=(\d+)\}")
TIMER_EQUALS = re.compile(r"\bTimerEquals \(TIME\{[^}]*timer=(\d+)\}")
COMPARE_COUNTER = re.compile(
    r"^(?:NOT )?(?P<name>.+?) -> CompareCounter \(COMPARISON\{(?P<op>\S+) Long\[(?P<value>-?\d+)\]\}\)$")
WRITE_COUNTER = re.compile(
    r"^(?P<name>.+?) -> (?P<verb>Set|Add|Subtract)CounterValue \(EXPRESSION\{= (?P<expr>.*)\}\)$")
COMPARE_AV = re.compile(
    r"^(?P<neg>NOT )?(?P<obj>.+?) -> CompareAlterableValue \(AlterableValue\{[^}]*value=(?P<slot>\d+)\}, "
    r"COMPARISON\{(?P<op>\S+) (?:Long|Double)\[(?P<value>-?[\d.]+)\]\}\)$")
WRITE_AV = re.compile(
    r"^(?P<obj>.+?) -> (?P<verb>SetAlterableValue|AddToAlterable) \(AlterableValue\{[^}]*value=(?P<slot>\d+)\}, "
    r"EXPRESSION\{= (?P<expr>.*)\}\)$")
OVERLAP = re.compile(
    r"^(?P<neg>NOT )?(?P<obj>.+?) -> IsOverlapping \(OBJECT\{[^}]*objectInfo->(?P<target>[^}]*)\}\)$")
SET_POSITION = re.compile(
    r"^(?P<obj>.+?) -> SetPosition \(POSITION\{[^}]*objectInfoParent->(?P<target>[^}]*)\}\)$")
RANDOM = re.compile(r"Random Long\[(\d+)\]")
# `Random(B) + 1 <= CounterValue[X]`: the movement roll every game uses.
ROLL = re.compile(
    r"^Compare \(EXPRESSION\{= Random Long\[(?P<bound>\d+)\] EndParenthesis Plus Long\[1\]\}, "
    r"COMPARISON\{(?P<op>\S+) CounterValue\[(?P<counter>[^\]]+)\]\}\)$")
# `(Random(D) + 1) / D` under integer division: 1 with probability 1/D.
ONE_IN = re.compile(
    r"Parenthesis Random Long\[(\d+)\] EndParenthesis Plus Long\[1\] "
    r"EndParenthesis Divide Long\[(\d+)\]")
LONG = re.compile(r"^Long\[(-?\d+)\]$")
# `base + Random(bound)`, which the sheet writes with either operand first:
# FNaF 1 writes `Long[1] Plus Random Long[2] EndParenthesis` and FNaF 4 writes
# `Random Long[4] EndParenthesis Plus Long[2]` for the same shape. Matching
# only one order reports the other as unreadable, which looks like an exotic
# expression rather than like a missing case.
BASE_PLUS_RANDOM = re.compile(r"^Long\[(-?\d+)\] Plus Random Long\[(\d+)\] EndParenthesis$")
RANDOM_PLUS_BASE = re.compile(r"^Random Long\[(\d+)\] EndParenthesis Plus Long\[(-?\d+)\]$")
# `CounterValue[x]`, optionally offset by a literal. FNaF 3's whole difficulty
# table is this shape (`AI = night number`, `AI = night number - 1`), and
# reading it as UNKNOWN would report the simplest of the four tables as the
# one that could not be read.
COUNTER_OFFSET = re.compile(
    r"^CounterValue\[(?P<counter>[^\]]+)\](?: (?P<sign>Plus|Minus) Long\[(?P<offset>-?\d+)\])?$")
# Conditions carrying no operand a model needs: the trigger-once forms, the
# object-count and visibility tests, and the animation/frame lifecycle ones.
BARE_CONDITION = re.compile(
    r"^(?:(?P<neg>NOT )?)(?:[^ ]+(?:\.[^ ]+)? -> )?"
    r"(?P<kind>NotAlways|Always|Once|StartOfFrame|GroupEnd|NewGroup|Skip|"
    r"ObjectInvisible|ObjectVisible|NumberOfObjects|AnimationFinished|"
    r"OnTimerEvent|ObjectClicked|MouseOnObject|KeyDown|KeyPressed|"
    r"Multiple Touch|FlagOn|FlagOff|Compare|CompareGlobalValueIntEqual|"
    r"CompareAlterableValue|CompareCounter|IsOverlapping|TimerEquals)\b.*$")
JUMP_TO_FRAME = re.compile(r"^JumpToFrame \(FRAME\{[^}]*value=(\d+)\}\)$")
GLOBAL_COMPARE = re.compile(
    r"^CompareGlobalValueIntEqual \(GlobalValue\{[^}]*value=(?P<slot>\d+)\}, "
    r"COMPARISON\{(?P<op>\S+) Long\[(?P<value>-?\d+)\]\}\)$")


def timers_of(group):
    """Every timer period that gates this group, in ms."""
    found = []
    for condition in group.conditions:
        for pattern in (EVERY, TIMER_EQUALS):
            match = pattern.search(condition)
            if match:
                found.append(int(match.group(1)))
    return found


def counter_compares(group, name=None):
    out = []
    for condition in group.conditions:
        match = COMPARE_COUNTER.match(condition)
        if match and (name is None or match.group("name") == name):
            out.append((match.group("name"), match.group("op"), int(match.group("value"))))
    return out


def alterable_compares(group):
    out = []
    for condition in group.conditions:
        match = COMPARE_AV.match(condition)
        if not match:
            continue
        out.append(OrderedDict([
            ("object", match.group("obj")),
            ("slot", int(match.group("slot"))),
            ("op", match.group("op")),
            ("value", float(match.group("value"))),
            ("negated", bool(match.group("neg"))),
        ]))
    return out


def counter_writes(group, suffix=None):
    out = []
    for action in group.actions:
        match = WRITE_COUNTER.match(action)
        if not match:
            continue
        if suffix is not None and not match.group("name").endswith(suffix):
            continue
        out.append((match.group("name"), match.group("verb"), match.group("expr")))
    return out


def read_expression(expr):
    """Classify a counter-set expression into something a model can use.

    Returns a dict with a `kind`. Anything unrecognised comes back as
    `{"kind": "UNKNOWN", "expr": ...}` rather than a number, because a
    difficulty table that silently reads a Random as 0 is exactly the tidy
    wrong answer this reader exists to avoid.
    """
    literal = LONG.match(expr)
    if literal:
        return {"kind": "literal", "value": int(literal.group(1))}
    chance = ONE_IN.search(expr)
    if chance and chance.group(1) == chance.group(2):
        return {"kind": "oneIn", "n": int(chance.group(1))}
    span = BASE_PLUS_RANDOM.match(expr)
    if span:
        base, bound = int(span.group(1)), int(span.group(2))
        return {"kind": "range", "min": base, "max": base + bound - 1, "base": base, "bound": bound}
    span = RANDOM_PLUS_BASE.match(expr)
    if span:
        bound, base = int(span.group(1)), int(span.group(2))
        return {"kind": "range", "min": base, "max": base + bound - 1, "base": base, "bound": bound}
    if expr.startswith("GlobalValue["):
        return {"kind": "global", "expr": expr}
    offset = COUNTER_OFFSET.match(expr)
    if offset:
        delta = int(offset.group("offset") or 0)
        if offset.group("sign") == "Minus":
            delta = -delta
        return {"kind": "counter", "counter": offset.group("counter"), "offset": delta}
    return {"kind": "UNKNOWN", "expr": expr}


# --- report: the per-night difficulty table ---------------------------------

def night_table(groups, night_name, hour_name):
    """Groups gated on the night counter, with what they write.

    Each row keeps its night comparison verbatim (`=`, `>=`, `<`) rather than
    expanding it to a night list, because the sheet's own ordering decides
    which of two overlapping rows wins and that is not recoverable from an
    expansion.
    """
    rows = []
    for group in groups:
        nights = counter_compares(group, night_name)
        if not nights:
            continue
        hours = counter_compares(group, hour_name)
        writes = counter_writes(group)
        if not writes:
            continue
        rows.append(OrderedDict([
            ("group", group.id),
            ("night", [{"op": op, "value": value} for _, op, value in nights]),
            ("hour", [{"op": op, "value": value} for _, op, value in hours]),
            ("gates", [c for c in group.conditions
                       if not COMPARE_COUNTER.match(c)
                       or COMPARE_COUNTER.match(c).group("name") not in (night_name, hour_name)]),
            ("sets", [OrderedDict([("counter", name), ("verb", verb),
                                   ("value", read_expression(expr))])
                      for name, verb, expr in writes]),
        ]))
    return rows


# --- report: the night clock ------------------------------------------------

def clock(groups, hour_name):
    """Derive the clock chain rather than assert it.

    Looks for: a counter incremented on a timer (the minute), a group that
    compares that counter against a threshold and advances the hour, the
    hour's own wrap, and the hour value that leaves the frame. Each link is
    reported with the group that carries it, and a missing link is reported
    as missing -- an absent chain is the signal that the hour counter was
    named wrong, which is the one failure this cannot otherwise see.
    """
    found = OrderedDict([
        ("hourCounter", hour_name),
        ("minuteTicks", []),
        ("hourAdvance", []),
        ("hourWrap", []),
        ("leavesFrame", []),
        ("hourSets", []),
    ])

    # Which counters advance the hour, and on what threshold.
    for group in groups:
        for name, verb, expr in counter_writes(group):
            if name != hour_name:
                continue
            if verb == "Add":
                sources = counter_compares(group)
                found["hourAdvance"].append(OrderedDict([
                    ("group", group.id),
                    ("by", read_expression(expr)),
                    ("when", [{"counter": n, "op": op, "value": v} for n, op, v in sources]),
                    ("whenAlterable", alterable_compares(group)),
                    ("timers", timers_of(group)),
                ]))
            elif verb == "Set":
                target = read_expression(expr)
                wrap = [c for c in counter_compares(group, hour_name)]
                entry = OrderedDict([
                    ("group", group.id),
                    ("to", target),
                    ("when", [{"counter": n, "op": op, "value": v}
                              for n, op, v in counter_compares(group)]),
                    ("timers", timers_of(group)),
                ])
                (found["hourWrap"] if wrap else found["hourSets"]).append(entry)

    # The minute source is whatever the hour advance tests. It is a counter in
    # FNaF 1 (`minute counter`) and FNaF 3/4 (nothing -- the hour is on a wall
    # clock), but in FNaF 2 it is an *alterable value* on the `AM` object, so
    # a counter-only search reports "no minute source" for the one game whose
    # night this repository actually runs. Both are collected.
    minute_names = {w["counter"] for entry in found["hourAdvance"]
                    for w in entry["when"] if w["counter"] != hour_name}
    minute_slots = {(w["object"], w["slot"]) for entry in found["hourAdvance"]
                    for w in entry["whenAlterable"]}
    for group in groups:
        for name, verb, expr in counter_writes(group):
            if name not in minute_names or verb != "Add":
                continue
            found["minuteTicks"].append(OrderedDict([
                ("group", group.id),
                ("source", name),
                ("by", read_expression(expr)),
                ("timers", timers_of(group)),
                ("gates", [c for c in group.conditions if not EVERY.search(c)]),
            ]))
        for action in group.actions:
            write = WRITE_AV.match(action)
            if not write or write.group("verb") != "AddToAlterable":
                continue
            if (write.group("obj"), int(write.group("slot"))) not in minute_slots:
                continue
            found["minuteTicks"].append(OrderedDict([
                ("group", group.id),
                ("source", f"{write.group('obj')}[{write.group('slot')}]"),
                ("by", read_expression(write.group("expr"))),
                ("timers", timers_of(group)),
                ("gates", [c for c in group.conditions if not EVERY.search(c)]),
            ]))
    found["minuteSources"] = sorted(minute_names) + sorted(
        f"{obj}[{slot}]" for obj, slot in minute_slots)

    # Leaving the frame on an hour value is the win condition.
    #
    # `frameHandle` is the raw value the action carries and is NOT the dumped
    # frame index: FNaF 3's own timer names give `JumpToGFreddy` -> 21 against
    # index 22 and `JumpToMangle` -> 17 against index 20, so the two disagree
    # by different amounts and no constant offset reconciles them.
    # UNKNOWN(frame-handle-map) -- the map lives outside the event sheet.
    # A night's win is therefore identified by the *hour it fires at*, which
    # this reports, and never by where it lands.
    for group in groups:
        hours = counter_compares(group, hour_name)
        if not hours:
            continue
        for action in group.actions:
            jump = JUMP_TO_FRAME.match(action)
            if jump:
                found["leavesFrame"].append(OrderedDict([
                    ("group", group.id),
                    ("at", [{"op": op, "value": v} for _, op, v in hours]),
                    ("frameHandle", int(jump.group(1))),
                ]))
    return found


# --- report: movement rolls -------------------------------------------------

def rolls(groups):
    """`Every N ms` + `Random(B)+1 <= <counter>` -- the shape all four use."""
    out = []
    for group in groups:
        periods = timers_of(group)
        for condition in group.conditions:
            match = ROLL.match(condition)
            if not match:
                continue
            out.append(OrderedDict([
                ("group", group.id),
                ("everyMs", periods[0] if periods else None),
                ("bound", int(match.group("bound"))),
                ("op", match.group("op")),
                ("counter", match.group("counter")),
                ("gates", [c for c in group.conditions
                           if c is not condition and not EVERY.search(c)]),
                ("actions", list(group.actions)),
            ]))
    return out


# --- report: an object's movement graph -------------------------------------

def condition_terms(conditions):
    """A branch condition as structured terms rather than as engine text.

    `--graph` prints the sheet's own wording, which is what you want while
    reading. `--graphs` is the export mode and must not carry it: a file of
    verbatim event lines is a partial reproduction of the dump, and this
    project's publishing boundary allows derived facts out and dump content
    never. Everything a model needs -- which counter, which comparison, which
    value -- survives the conversion; only the engine's phrasing is dropped.

    A condition the reader cannot classify is kept as `{"kind": "UNKNOWN"}`
    with its shape but not its text, so a gap stays visible without leaking.
    """
    terms = []
    for condition in conditions:
        counter = COMPARE_COUNTER.match(condition)
        if counter:
            terms.append(OrderedDict([("kind", "counter"), ("name", counter.group("name")),
                                      ("op", counter.group("op")),
                                      ("value", int(counter.group("value")))]))
            continue
        alterable = COMPARE_AV.match(condition)
        if alterable:
            terms.append(OrderedDict([("kind", "alterable"), ("object", alterable.group("obj")),
                                      ("slot", int(alterable.group("slot"))),
                                      ("op", alterable.group("op")),
                                      ("value", float(alterable.group("value"))),
                                      ("negated", bool(alterable.group("neg")))]))
            continue
        overlap = OVERLAP.match(condition)
        if overlap:
            terms.append(OrderedDict([("kind", "overlap"), ("object", overlap.group("obj")),
                                      ("target", overlap.group("target")),
                                      ("negated", bool(overlap.group("neg")))]))
            continue
        every = EVERY.search(condition)
        if every:
            terms.append(OrderedDict([("kind", "every"), ("ms", int(every.group(1)))]))
            continue
        roll = ROLL.match(condition)
        if roll:
            terms.append(OrderedDict([("kind", "roll"), ("bound", int(roll.group("bound"))),
                                      ("op", roll.group("op")),
                                      ("counter", roll.group("counter"))]))
            continue
        # Conditions with no operands worth carrying. The engine's name for
        # the *kind* is a derived fact; its rendered line is not, so only the
        # kind is emitted.
        bare = BARE_CONDITION.match(condition)
        if bare:
            terms.append(OrderedDict([("kind", bare.group("kind")),
                                      ("negated", bool(bare.group("neg")))]))
            continue
        terms.append(OrderedDict([("kind", "UNKNOWN")]))
    return terms


def graph(groups, obj):
    """Edges for one object: where it is (overlap) -> where it goes (position).

    The branch selector is left as the group's remaining conditions verbatim.
    Naming it would mean guessing which alterable slot is "the" selector, and
    the four games do not agree on that.
    """
    edges = []
    for group in groups:
        moves = [SET_POSITION.match(a) for a in group.actions]
        moves = [m for m in moves if m and obj.lower() in m.group("obj").lower()]
        if not moves:
            continue
        sources = []
        branch = []
        for condition in group.conditions:
            overlap = OVERLAP.match(condition)
            if overlap and obj.lower() in overlap.group("obj").lower():
                sources.append({"target": overlap.group("target"),
                                "negated": bool(overlap.group("neg"))})
            else:
                branch.append(condition)
        for move in moves:
            edges.append(OrderedDict([
                ("group", group.id),
                ("object", move.group("obj")),
                ("from", sources),
                ("to", move.group("target")),
                ("branch", branch),
                ("branchTerms", condition_terms(branch)),
            ]))
    return edges


# --- report: the draw census ------------------------------------------------

def draws(groups):
    """Every Random draw, and what has to hold before it is consumed.

    A draw a timer forces is consumed whether or not anything happens, so a
    seed model must reproduce it; a draw behind a state condition is consumed
    only when that state holds. The distinction is the whole difficulty of
    predicting a stream.

    Where the draw sits decides this, and it is not the same question for the
    two sites:

    - A draw in an **action** runs only if every condition passed.
    - A draw in a **condition** is evaluated while the conditions are being
      tested, and Clickteam stops at the first that fails. So a `Random`
      inside a movement roll's own comparison is consumed as soon as the
      timer fires *if nothing before it can fail* -- which is why
      `conditionsBefore` counts the non-timer conditions that precede the
      drawing line rather than the group's conditions as a whole.

    `forcedByTimer` is therefore true when a timer gates the group and
    nothing that can fail stands in front of the draw.
    """
    out = []
    for group in groups:
        periods = timers_of(group)
        blocking = []           # non-timer conditions seen so far, in order
        for line in group.conditions:
            hits = RANDOM.findall(line)
            for bound in hits:
                out.append(OrderedDict([
                    ("group", group.id),
                    ("site", "condition"),
                    ("bound", int(bound)),
                    ("everyMs", periods[0] if periods else None),
                    ("conditionsBefore", len(blocking)),
                    ("forcedByTimer", bool(periods) and not blocking),
                    ("text", line),
                ]))
            if not EVERY.search(line) and not TIMER_EQUALS.search(line):
                blocking.append(line)
        for line in group.actions:
            for bound in RANDOM.findall(line):
                out.append(OrderedDict([
                    ("group", group.id),
                    ("site", "action"),
                    ("bound", int(bound)),
                    ("everyMs", periods[0] if periods else None),
                    ("conditionsBefore", len(blocking)),
                    ("forcedByTimer", bool(periods) and not blocking),
                    ("text", line),
                ]))
    return out


def movers(groups, minimum=3):
    """Every object that moves itself more than `minimum` times.

    A character in these games *is* an object that repositions itself onto
    camera markers, so this finds the cast without being told who they are:
    FNaF 3's antagonist is named `dhfgh` in the sheet, which no list of
    expected names would have contained.
    """
    counts = {}
    for group in groups:
        for action in group.actions:
            move = SET_POSITION.match(action)
            if move:
                counts[move.group("obj")] = counts.get(move.group("obj"), 0) + 1
    return OrderedDict(sorted(((name, n) for name, n in counts.items() if n >= minimum),
                              key=lambda item: -item[1]))


def timers(groups):
    seen = {}
    for group in groups:
        for period in timers_of(group):
            seen.setdefault(period, []).append(group.id)
    return OrderedDict((str(period), seen[period]) for period in sorted(seen))


# --- CLI --------------------------------------------------------------------

def render_table(rows, stream):
    for row in rows:
        night = ", ".join(f"night {c['op']} {c['value']}" for c in row["night"])
        hour = ", ".join(f"hour {c['op']} {c['value']}" for c in row["hour"]) or "night start"
        print(f"g{row['group']}: {night} | {hour}", file=stream)
        for gate in row["gates"]:
            print(f"    gate: {gate}", file=stream)
        for write in row["sets"]:
            value = write["value"]
            if value["kind"] == "literal":
                shown = str(value["value"])
            elif value["kind"] == "oneIn":
                shown = f"1 in {value['n']}"
            elif value["kind"] == "range":
                shown = f"{value['min']}..{value['max']}"
            elif value["kind"] == "counter":
                delta = value["offset"]
                shown = f"[{value['counter']}]" + (f" {delta:+d}" if delta else "")
            elif value["kind"] == "global":
                shown = value["expr"]
            else:
                shown = f"UNKNOWN({value.get('expr', value['kind'])})"
            verb = {"Set": "=", "Add": "+=", "Subtract": "-="}[write["verb"]]
            print(f"    {write['counter']} {verb} {shown}", file=stream)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--game", choices=sorted(GAMES))
    parser.add_argument("--sheet")
    parser.add_argument("--night", help="override the night counter name")
    parser.add_argument("--hour", help="override the hour counter name")
    parser.add_argument("--table", action="store_true")
    parser.add_argument("--clock", action="store_true")
    parser.add_argument("--rolls", action="store_true")
    parser.add_argument("--graph", metavar="OBJ")
    parser.add_argument("--graphs", action="store_true",
                        help="every mover's graph, keyed by object name")
    parser.add_argument("--movers", action="store_true")
    parser.add_argument("--draws", action="store_true")
    parser.add_argument("--timers", action="store_true")
    parser.add_argument("--audit", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    path = resolve_sheet(args.game, args.sheet)
    if not path.exists():
        raise SystemExit(f"nightmap: no sheet at {path}")
    groups, unclassified = parse(path.read_text(encoding="utf-8", errors="replace"))

    profile = GAMES.get(args.game, {})
    night_name = args.night or profile.get("night")
    hour_name = args.hour or profile.get("hour")

    report = OrderedDict([("sheet", str(path)), ("groups", len(groups)),
                          ("unclassifiedLines", len(unclassified))])
    wanted = any([args.table, args.clock, args.rolls, args.graph, args.graphs,
                  args.movers, args.draws, args.timers, args.audit])
    if not wanted:
        args.table = True

    if args.table:
        if not night_name:
            raise SystemExit("nightmap: --table needs --game or --night")
        report["table"] = night_table(groups, night_name, hour_name)
    if args.clock:
        if not hour_name:
            raise SystemExit("nightmap: --clock needs --game or --hour")
        report["clock"] = clock(groups, hour_name)
    if args.rolls:
        report["rolls"] = rolls(groups)
    if args.graph:
        report["graph"] = graph(groups, args.graph)
    if args.movers or args.graphs:
        report["movers"] = movers(groups)
    if args.graphs:
        # The export drops the verbatim `branch` and keeps `branchTerms`.
        report["graphs"] = OrderedDict()
        for name in report["movers"]:
            edges = []
            for edge in graph(groups, name):
                kept = OrderedDict((k, v) for k, v in edge.items() if k != "branch")
                edges.append(kept)
            report["graphs"][name] = edges
    if args.draws:
        report["draws"] = draws(groups)
    if args.timers:
        report["timers"] = timers(groups)
    if args.audit:
        report["audit"] = [{"line": n, "text": t} for n, t in unclassified]

    if args.json:
        json.dump(report, sys.stdout, indent=2)
        print()
        return 0

    print(f"{path.name}: {len(groups)} groups, {len(unclassified)} unclassified lines")
    if args.table:
        print(f"\n--- night table ({night_name}) ---")
        render_table(report["table"], sys.stdout)
    if args.clock:
        print(f"\n--- clock ({hour_name}) ---")
        print(json.dumps(report["clock"], indent=2))
    if args.rolls:
        print("\n--- rolls ---")
        for roll in report["rolls"]:
            print(f"g{roll['group']}: every {roll['everyMs']} ms, "
                  f"Random({roll['bound']})+1 {roll['op']} {roll['counter']}")
            for gate in roll["gates"]:
                print(f"    gate: {gate}")
    if args.graph:
        print(f"\n--- graph ({args.graph}) ---")
        for edge in report["graph"]:
            source = ", ".join(("NOT " if s["negated"] else "") + s["target"]
                               for s in edge["from"]) or "(unconditioned)"
            print(f"g{edge['group']}: {source} -> {edge['to']}")
            for branch in edge["branch"]:
                print(f"    when: {branch}")
    if args.draws:
        print("\n--- draws ---")
        forced = [d for d in report["draws"] if d["forcedByTimer"]]
        gated = [d for d in report["draws"] if d["everyMs"] is not None]
        # Two different questions, and they rank the four games differently.
        # "In a timer-gated group" is the loose count -- how much of the sheet
        # is on a clock at all. "Forced" is the count a seed model owes: draws
        # with nothing that can fail in front of them, consumed on every tick
        # whatever happens.
        print(f"{len(report['draws'])} draw sites, "
              f"{len(gated)} in a timer-gated group, {len(forced)} timer-forced")
        for draw in report["draws"]:
            mark = "FORCED" if draw["forcedByTimer"] else "cond"
            print(f"g{draw['group']}: Random({draw['bound']}) "
                  f"[{mark}, every {draw['everyMs']} ms]")
    if args.movers:
        print("\n--- movers ---")
        for name, count in report["movers"].items():
            print(f"{count:4d}  {name}")
    if args.graphs:
        print("\n--- graphs ---")
        for name, edges in report["graphs"].items():
            print(f"{name}: {len(edges)} edges")
    if args.timers:
        print("\n--- timers ---")
        for period, ids in report["timers"].items():
            print(f"{period} ms: {len(ids)} groups ({', '.join(str(i) for i in ids[:8])}"
                  f"{'...' if len(ids) > 8 else ''})")
    if args.audit:
        print("\n--- audit ---")
        if not unclassified:
            print("no unclassified lines")
        for number, text in unclassified:
            print(f"{number}: {text!r}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
