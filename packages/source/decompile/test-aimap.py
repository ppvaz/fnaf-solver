#!/usr/bin/env python3
"""Check aimap.py against a synthetic event sheet.

The real Office sheet is extracted game content and cannot live here, so this
builds a miniature dump in both accepted forms -- the canonical tabular one
and the older rendered one -- with the same shapes the real table uses: the
night-start zeroing group, per-night and per-hour sets, `<` and `>` night
comparisons, a Random assignment, and the Custom Night dial copy.

  python3 packages/source/decompile/test-aimap.py
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aimap  # noqa: E402

XOR = 28
# Stored item-table handles; events address each of these as handle ^ XOR.
STORED = {
    "night": 108,
    "time of the night": 144,
    "old Freddy AI": 109,
    "Balloon Boy AI": 117,
    "Sockpuppet AI": 118,
    "Golden Freddy AI": 154,
    "cust_BB AI": 161,
}

failures = []


def ok(what, condition):
    if not condition:
        failures.append(what)


def long_expression(value):
    return f"[0]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value={value}"


def random_expression(bound):
    """`(Random(bound) + 1) / bound`, flattened the way the dumper writes it."""
    return " ; ".join([
        "[0]ot=-1,num=-1,oi=0,oil=0,loader=,value=null",
        "[1]ot=-1,num=1,oi=0,oil=0,loader=,value=null",
        f"[2]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value={bound}",
        "[3]ot=-1,num=-2,oi=0,oil=0,loader=,value=null",
        "[4]ot=0,num=2,oi=0,oil=0,loader=,value=null",
        "[5]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value=1",
        "[6]ot=-1,num=-2,oi=0,oil=0,loader=,value=null",
        "[7]ot=0,num=8,oi=0,oil=0,loader=,value=null",
        f"[8]ot=-1,num=0,oi=0,oil=0,loader=LongExp,value={bound}",
    ])


def counter_expression(name):
    return f"[0]ot=7,num=80,oi={STORED[name] ^ XOR},oil=0,loader=,value=null"


def condition(name, operator, expression):
    return ("\t".join([
        " C", "OT", "7", "NUM", "-81", "OI", str(STORED[name] ^ XOR),
        "NAME", "ignored", "OIL", "0", "CFLAGS", "0", "COTHER", "0",
        "PARAMS", f"23:ExpressionParameter:cmp={operator} {expression}",
    ]))


def action(name, expression):
    return ("\t".join([
        " A", "OT", "7", "NUM", "80", "OI", str(STORED[name] ^ XOR),
        "NAME", "ignored", "OIL", "0",
        "PARAMS", f"22:ExpressionParameter:cmp== {expression}",
    ]))


def group(index, conditions, actions):
    header = "\t".join([
        "GROUP", str(index), "FLAGS", "0", "RESTRICT", "False",
        "CONDS", str(len(conditions)), "ACTS", str(len(actions)),
    ])
    return "\n".join([header, *conditions, *actions])


def tabular_sheet():
    lines = ["GAME\ttest\tBUILD\t296\tFRAMES\t1", "OBJECTS"]
    for name, stored in STORED.items():
        lines.append("\t".join([
            "OBJECT", str(stored), "TYPE", "7", "NAME", name,
            "VALUES", "", "STRINGS", "",
        ]))
    lines.append("FRAME\t0\t04-Office\tGROUPS\t6")
    # The night-start zeroing group: every night but Custom.
    lines.append(group(673, [condition("night", "!=", long_expression(7))],
                       [action("old Freddy AI", long_expression(0)),
                        action("Balloon Boy AI", long_expression(0)),
                        action("Golden Freddy AI", long_expression(0))]))
    # Night 6, 12 AM and 2 AM: the second row overwrites only what it names.
    lines.append(group(683, [condition("night", "==", long_expression(6))],
                       [action("old Freddy AI", long_expression(5)),
                        action("Balloon Boy AI", long_expression(5)),
                        action("Golden Freddy AI", random_expression(10))]))
    lines.append(group(684, [condition("night", "==", long_expression(6)),
                             condition("time of the night", "==", long_expression(2))],
                       [action("old Freddy AI", long_expression(10)),
                        action("Balloon Boy AI", long_expression(9))]))
    # Custom Night copies the dials.
    lines.append(group(787, [condition("night", "==", long_expression(7))],
                       [action("Balloon Boy AI", counter_expression("cust_BB AI"))]))
    # Golden Freddy exists only from night 6 up; the Puppet is pinned above it.
    lines.append(group(804, [condition("night", "<", long_expression(6))],
                       [action("Golden Freddy AI", long_expression(0))]))
    lines.append(group(815, [condition("night", "==", long_expression(1))],
                       [action("Sockpuppet AI", long_expression(1))]))
    lines.append(group(821, [condition("night", ">", long_expression(6))],
                       [action("Sockpuppet AI", long_expression(15))]))
    return "\n".join(lines) + "\n"


RENDERED_SHEET = """--- group 683 ---
IF	night -> CompareCounter (COMPARISON{= Long[6]})
DO	Balloon Boy AI -> SetCounterValue (EXPRESSION{= Long[5]})
--- group 684 ---
IF	night -> CompareCounter (COMPARISON{= Long[6]})
IF	time of the night -> CompareCounter (COMPARISON{= Long[2]})
DO	Balloon Boy AI -> SetCounterValue (EXPRESSION{= Long[9]})
--- group 815 ---
IF	night -> CompareCounter (COMPARISON{= Long[1]})
DO	Sockpuppet AI -> SetCounterValue (EXPRESSION{= Long[1]})
--- group 821 ---
IF	night -> CompareCounter (COMPARISON{> Long[6]})
DO	Sockpuppet AI -> SetCounterValue (EXPRESSION{= Long[15]})
"""


def write(directory, name, text):
    path = Path(directory) / name
    path.write_text(text)
    return path


with tempfile.TemporaryDirectory() as directory:
    tabular = write(directory, "events-android.txt", tabular_sheet())
    nights = aimap.build(aimap.parse(tabular))

    six = nights[6]
    ok("night 6 carries 12 AM values into 1 AM",
       six[0]["Balloon Boy"] == 5 and six[1]["Balloon Boy"] == 5)
    ok("night 6 raises Balloon Boy at 2 AM",
       six[2]["Balloon Boy"] == 9 and six[6]["Balloon Boy"] == 9)
    ok("an unnamed character keeps the earlier row's value",
       six[2]["old Freddy"] == 10)
    ok("a Random assignment reads as its probability",
       six[0]["Golden Freddy"] == "1/10")
    ok("the 2 AM row leaves Golden Freddy on the 12 AM roll",
       six[2]["Golden Freddy"] == "1/10")

    # The night comparison the old reader ignored: `<` and `>` were applied to
    # every night, which zeroed Golden Freddy on night 6 and pinned the Puppet
    # at 15 on night 1.
    ok("group 804 zeroes Golden Freddy below night 6",
       all(nights[night][6]["Golden Freddy"] == 0 for night in range(1, 6)))
    ok("group 804 leaves night 6 alone", nights[6][0]["Golden Freddy"] == "1/10")
    ok("group 821 does not reach night 1", nights[1][0]["Sockpuppet"] == 1)
    ok("group 821 pins the Puppet on Custom Night",
       nights[7][0]["Sockpuppet"] == 15)

    ok("the zeroing group spares Custom Night",
       nights[7][0]["Balloon Boy"] == "dial")
    ok("the zeroing group runs on every other night",
       nights[5][0]["Balloon Boy"] == 0)

    rendered = write(directory, "03-04-Office.txt", RENDERED_SHEET)
    rendered_nights = aimap.build(aimap.parse(rendered))
    ok("the rendered form still parses",
       rendered_nights[6][2]["Balloon Boy"] == 9
       and rendered_nights[1][0]["Sockpuppet"] == 1)

for operator, night, bound, expected in [
    ("=", 6, 6, True), ("==", 6, 7, False), ("<>", 6, 7, True), ("!=", 7, 7, False),
    ("<", 5, 6, True), ("<", 6, 6, False), (">", 7, 6, True), (">", 6, 6, False),
    ("<=", 6, 6, True), (">=", 5, 6, False),
]:
    ok(f"applies({operator!r}, {bound}, {night})",
       aimap.applies(operator, bound, night) is expected)

try:
    aimap.applies("~=", 1, 1)
    failures.append("an unknown comparison must raise")
except ValueError:
    pass

if failures:
    for failure in failures:
        print(f"FAIL  {failure}")
    sys.exit(1)
print("aimap: all checks passed")
