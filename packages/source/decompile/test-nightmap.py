#!/usr/bin/env python3
"""Check nightmap.py against a synthetic event sheet.

The real sheets are extracted game content and cannot live here, so this
builds a miniature one carrying the shapes all four games actually use, plus
the shapes that were *nearly* misread while writing the reader:

  - a night-gated difficulty row, with and without an hour,
  - `Add` as well as `Set`, since FNaF 4 escalates by adding,
  - both operand orders of `base + Random(bound)`, because FNaF 1 writes
    `Long[1] Plus Random Long[2]` and FNaF 4 writes
    `Random Long[4] EndParenthesis Plus Long[2]` for the same shape, and
    matching only one reports the other as an exotic expression,
  - `(Random(D) + 1) / D`, the one-in-D form,
  - a counter-valued assignment (`AI = night number - 1`), which is the whole
    of FNaF 3's difficulty table,
  - an accumulator clock built on an **alterable value** rather than a
    counter, which is FNaF 2's and which a counter-only search misses in
    silence,
  - a movement roll and a movement edge,
  - a line the reader cannot classify, so that `--audit` is shown to report
    rather than to swallow.

  python3 packages/source/decompile/test-nightmap.py
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nightmap  # noqa: E402

failures = []


def ok(what, condition):
    if not condition:
        failures.append(what)


def eq(what, actual, expected):
    if actual != expected:
        failures.append(f"{what}: expected {expected!r}, got {actual!r}")


SHEET = """FRAME 03: 04-Office
==========================================

--- group 10 ---
  IF   night number -> CompareCounter (COMPARISON{= Long[2]})
  IF   NotAlways
  DO   bonnie activity -> SetCounterValue (EXPRESSION{= Long[3]})
  DO   freddy activity -> SetCounterValue (EXPRESSION{= Long[1] Plus Random Long[2] EndParenthesis})

--- group 11 ---
  IF   night number -> CompareCounter (COMPARISON{= Long[2]})
  IF   time of day -> CompareCounter (COMPARISON{= Long[3]})
  IF   NotAlways
  DO   bonnie activity -> AddCounterValue (EXPRESSION{= Long[2]})
  DO   force Chica -> SetCounterValue (EXPRESSION{= Random Long[3] EndParenthesis Plus Long[3]})

--- group 12 ---
  IF   night number -> CompareCounter (COMPARISON{>= Long[6]})
  DO   Golden Freddy AI -> SetCounterValue (EXPRESSION{= Parenthesis Parenthesis Random Long[10] EndParenthesis Plus Long[1] EndParenthesis Divide Long[10]})
  DO   AI -> SetCounterValue (EXPRESSION{= CounterValue[night number] Minus Long[1]})

--- group 13 ---
  IF   CompareGlobalValueIntEqual (GlobalValue{isExpression=False value=3}, COMPARISON{= Long[0]})
  IF   Every (TIME{isExpression=False loops=0 timer=1000}, BUFFER4{isExpression=False value=0})
  DO   AM -> AddToAlterable (AlterableValue{isExpression=False value=0}, EXPRESSION{= Long[1]})

--- group 14 ---
  IF   AM -> CompareAlterableValue (AlterableValue{isExpression=False value=0}, COMPARISON{>= Long[70]})
  IF   time of day -> CompareCounter (COMPARISON{<> Long[12]})
  DO   AM -> SetAlterableValue (AlterableValue{isExpression=False value=0}, EXPRESSION{= Long[0]})
  DO   time of day -> AddCounterValue (EXPRESSION{= Long[1]})

--- group 15 ---
  IF   time of day -> CompareCounter (COMPARISON{= Long[6]})
  IF   NotAlways
  DO   JumpToFrame (FRAME{isExpression=False value=4})

--- group 16 ---
  IF   Every (TIME{isExpression=False loops=0 timer=4970}, BUFFER4{isExpression=False value=0})
  IF   Compare (EXPRESSION{= Random Long[20] EndParenthesis Plus Long[1]}, COMPARISON{<= CounterValue[bonnie activity]})
  IF   viewing -> CompareCounter (COMPARISON{= Long[0]})
  DO   move who? -> SetCounterValue (EXPRESSION{= Long[1]})

--- group 17 ---
  IF   move who? -> CompareCounter (COMPARISON{= Long[1]})
  IF   charBonnie.Active -> IsOverlapping (OBJECT{isExpression=False objectInfo=75 objectInfoList=0 objectType=2 objectInfo->cam1A.Active})
  IF   charBonnie.Active -> CompareAlterableValue (AlterableValue{isExpression=False value=0}, COMPARISON{= Long[2]})
  DO   charBonnie.Active -> SetPosition (POSITION{angle=0 direction=0 isExpression=False layer=0 objectInfoList=0 objectInfoParent=76 slope=0 typeParent=2 x=0 y=0 objectInfoParent->cam1B.Active})

this line belongs to no group and must be reported
"""


def main():
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "03-04-Office.txt"
        path.write_text(SHEET, encoding="utf-8")
        groups, unclassified = nightmap.parse(path.read_text(encoding="utf-8"))

    eq("group count", len(groups), 8)
    eq("the stray line is audited, not swallowed", len(unclassified), 1)
    ok("the audit reports the line itself",
       "belongs to no group" in unclassified[0][1])

    # --- the difficulty table
    table = nightmap.night_table(groups, "night number", "time of day")
    eq("table rows", len(table), 3)

    row = table[0]
    eq("row cites its group", row["group"], 10)
    eq("a row with no hour compare fires at night start", row["hour"], [])
    eq("night comparison is kept verbatim", row["night"], [{"op": "=", "value": 2}])
    eq("a literal set reads as a literal",
       row["sets"][0], {"counter": "bonnie activity", "verb": "Set",
                        "value": {"kind": "literal", "value": 3}})
    eq("`Long[base] Plus Random Long[bound]` reads as a range",
       row["sets"][1]["value"], {"kind": "range", "min": 1, "max": 2, "base": 1, "bound": 2})

    row = table[1]
    eq("an hour compare is carried", row["hour"], [{"op": "=", "value": 3}])
    eq("Add is distinguished from Set", row["sets"][0]["verb"], "Add")
    eq("`Random Long[bound] Plus Long[base]` reads as the same range",
       row["sets"][1]["value"], {"kind": "range", "min": 3, "max": 5, "base": 3, "bound": 3})

    row = table[2]
    eq("`>=` is kept, not expanded", row["night"], [{"op": ">=", "value": 6}])
    eq("(Random(D)+1)/D reads as one-in-D",
       row["sets"][0]["value"], {"kind": "oneIn", "n": 10})
    eq("a counter-valued set reads as a counter with an offset",
       row["sets"][1]["value"],
       {"kind": "counter", "counter": "night number", "offset": -1})

    # Nothing in a table may read UNKNOWN silently; the shapes above are the
    # complete set the four sheets use.
    unknown = [w for r in table for w in r["sets"] if w["value"]["kind"] == "UNKNOWN"]
    eq("no expression is left unread", unknown, [])

    # --- the clock, on an alterable-value accumulator
    clock = nightmap.clock(groups, "time of day")
    eq("the minute source is found even as an alterable value",
       clock["minuteSources"], ["AM[0]"])
    eq("the tick is found", len(clock["minuteTicks"]), 1)
    eq("the tick's period", clock["minuteTicks"][0]["timers"], [1000])
    eq("the hour advance is found", len(clock["hourAdvance"]), 1)
    eq("the advance threshold comes off the alterable compare",
       clock["hourAdvance"][0]["whenAlterable"][0]["value"], 70.0)
    eq("leaving the frame is reported with the hour it fires at",
       clock["leavesFrame"][0]["at"], [{"op": "=", "value": 6}])
    ok("the jump target is labelled a handle, not an index",
       "frameHandle" in clock["leavesFrame"][0])

    # --- rolls
    rolls = nightmap.rolls(groups)
    eq("one roll", len(rolls), 1)
    eq("roll period", rolls[0]["everyMs"], 4970)
    eq("roll bound", rolls[0]["bound"], 20)
    eq("roll counter", rolls[0]["counter"], "bonnie activity")
    eq("a roll's remaining conditions are kept as gates", len(rolls[0]["gates"]), 1)

    # --- the movement graph
    edges = nightmap.graph(groups, "charBonnie")
    eq("one edge", len(edges), 1)
    eq("edge source", edges[0]["from"], [{"target": "cam1A.Active", "negated": False}])
    eq("edge target", edges[0]["to"], "cam1B.Active")
    ok("the branch condition is kept verbatim",
       any("value=0" in b for b in edges[0]["branch"]))

    # --- the draw census
    draws = nightmap.draws(groups)
    forced = [d for d in draws if d["forcedByTimer"]]
    eq("every Random is counted", len(draws), 4)
    # g16's roll is `Every 4970 ms` + the Random comparison itself, and the
    # comparison is the first condition that can fail -- so the timer forces
    # that draw even though the group also tests `viewing`, which comes after.
    eq("a timer-forced condition draw is reported as forced", len(forced), 1)
    eq("the forced draw is the roll", forced[0]["group"], 16)
    eq("its bound", forced[0]["bound"], 20)
    eq("nothing that can fail precedes it", forced[0]["conditionsBefore"], 0)
    night_start = [d for d in draws if d["group"] == 10]
    eq("a night-start draw is not timer-forced", night_start[0]["forcedByTimer"], False)

    timers = nightmap.timers(groups)
    eq("timers are collected", sorted(timers), ["1000", "4970"])

    if failures:
        print(f"nightmap: {len(failures)} checks FAILED")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("nightmap: all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
