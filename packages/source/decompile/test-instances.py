#!/usr/bin/env python3
"""Check the frame-instance reader against a synthetic dump.

No game content: the fixture below is hand-written, so this runs anywhere.

What it defends is the one rule that is easy to get wrong three different
ways. A placed instance's OI is in its own space: the runtime's layout loader
(Frame/CLO.load) reads it as `readAShort() ^ 48` and only then resolves it in
the item table that COI.loadHeader XORed with 28. So the event handle of an
` I` line is OI ^ 48, its item-table row is OI ^ 48 ^ 28, and its image is the
one the dumper printed on the instance line whose OI equals that row. The
2026-08-26 reader used the raw row and the 2026-09-15 reader used OI as an
event handle; each left the Office without five of its twelve camera markers.
docs/android/SOURCE-DUMP-GUIDE.md section 4.
"""
import os
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from readdump import Dump

# Rows 66, 94, 110 and 114 are one XOR orbit: 66 ^ 28 == 94, 66 ^ 48 == 114,
# 66 ^ 48 ^ 28 == 110. So the instance line with OI 66 is `your view` read raw,
# `hall movement` read as an event handle, and `cam 11` read as the runtime
# does. Each instance line carries the image of its raw row, as the dumper does.
FIXTURE = """GAME\tfixture\tBUILD\t296\tFRAMES\t1
OBJECTS
OBJECT\t66\tTYPE\t2\tNAME\tyour view\tVALUES\t\tSTRINGS\t
OBJECT\t83\tTYPE\t7\tNAME\tviewing hall light\tVALUES\t\tSTRINGS\t
OBJECT\t94\tTYPE\t2\tNAME\thall movement\tVALUES\t\tSTRINGS\t
OBJECT\t110\tTYPE\t2\tNAME\tcam 11\tVALUES\t\tSTRINGS\t
OBJECT\t114\tTYPE\t2\tNAME\tleft light\tVALUES\t\tSTRINGS\t
FRAME\t0\t04-Office\tGROUPS\t1
 F\tWIDTH\t1600\tHEIGHT\t768\tLAYERS\t2\tINSTANCES\t5
 L\tIDX\t0\tNAME\tLayer 1\tXC\t1\tYC\t1
 L\tIDX\t1\tNAME\tLayer 2\tXC\t1\tYC\t1
 I\tINST\t0\tOI\t66\tNAME\tyour view\tX\t950\tY\t465\tLAYER\t3\tPTYPE\t0\tPARENT\t0\tINSTNUM\t0\tW\t32\tH\t32\tHOTX\t16\tHOTY\t16
 I\tINST\t1\tOI\t94\tNAME\thall movement\tX\t-274\tY\t482\tLAYER\t3\tPTYPE\t0\tPARENT\t0\tINSTNUM\t1\tW\t16\tH\t125\tHOTX\t8\tHOTY\t62
 I\tINST\t2\tOI\t110\tNAME\tcam 11\tX\t1\tY\t914\tLAYER\t4\tPTYPE\t0\tPARENT\t0\tINSTNUM\t2\tW\t59\tH\t40\tHOTX\t29\tHOTY\t20
 I\tINST\t3\tOI\t114\tNAME\tleft light\tX\t340\tY\t846\tLAYER\t3\tPTYPE\t0\tPARENT\t0\tINSTNUM\t3\tW\t58\tH\t88\tHOTX\t28\tHOTY\t42
 I\tINST\t4\tOI\t127\tNAME\t?\tX\t-867\tY\t102\tLAYER\t5\tPTYPE\t0\tPARENT\t0\tINSTNUM\t4\tW\t\tH\t\tHOTX\t\tHOTY\t
GROUP\t0\tFLAGS\t0\tRESTRICT\tFalse\tCONDS\t1\tACTS\t0
 C\tOT\t2\tNUM\t-27\tOI\t114\tNAME\tleft light\tOIL\t0\tCFLAGS\t0\tCOTHER\t0\tPARAMS\t50:AlterableValue:AlterableValue0
"""


def main():
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as handle:
        handle.write(FIXTURE)
        path = handle.name
    try:
        dump = Dump(path, 28, 48)
        frame = dump.frames[0]
        cam11, light, view, hall_mv, counter = frame["instances"]
        checks = []

        def check(label, got, want):
            checks.append((label, got, want))

        check("frame size", (frame["size"]["WIDTH"], frame["size"]["HEIGHT"]),
              ("1600", "768"))
        check("layer count", len(frame["layers"]), 2)
        check("instance count", len(frame["instances"]), 5)
        check("groups still parse", len(frame["groups"]), 1)

        # Events: handle 114 is row 110, cam 11.
        check("event handle 114 -> cam 11", dump.name(114), "cam 11")
        # Instances: OI 66 is event handle 66 ^ 48 == 114, the same cam 11.
        check("instance OI 66 -> event handle 114", dump.handle(cam11), 114)
        check("instance OI 66 -> cam 11", dump.placed(cam11), "cam 11")
        check("instance OI 94 -> left light", dump.placed(light), "left light")
        # The three readings disagree on this line, and only one is the runtime's.
        check("raw row 66 would say your view", dump.objects[66], "your view")
        check("event-space reading would say hall movement", dump.name(66), "hall movement")

        # The image follows the true object: OI 66 draws row 110's image (59x40),
        # which the dumper printed on the instance line whose OI is 110.
        check("extent uses row OI ^ 48 ^ 28 and subtracts the hotspot",
              dump.extent(cam11), (921, 445, 980, 485))
        check("instance OI 94 draws row 114's image (58x88)",
              dump.extent(light), (-302, 440, -244, 528))
        check("a non-Active true object has no extent", dump.extent(counter), None)
        check("and its image is not 'missing'", dump.image_known(counter), True)

        # The new line types must not leak into the event lines.
        check("condition line intact", dump.render(frame["groups"][0]["lines"][0]).strip(),
              "C ot=2 num=-27 oi=114 [cam 11] 50:AlterableValue:AlterableValue0")

        # PC builds: no scramble anywhere.
        flat = Dump(path, 0, 0)
        check("--xor 0 --lo-xor 0 reads rows as printed",
              (flat.placed(flat.frames[0]["instances"][0]), flat.name(66)),
              ("your view", "your view"))

        # The `instances` command runs end to end.
        out = subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          "readdump.py"), "--dump", path,
             "instances", "0", "cam"],
            capture_output=True, text=True)
        check("instances command exits 0", out.returncode, 0)
        check("instances command prints the true name, event handle, raw oi and box",
              "cam 11" in out.stdout and "h=114" in out.stdout and "oi=66" in out.stdout
              and "box x[921..980] y[445..485]" in out.stdout, True)

        bad = [c for c in checks if c[1] != c[2]]
        for label, got, want in checks:
            print("%-4s %-64s %s" % ("FAIL" if got != want else "ok", label,
                                     "" if got == want else "got %r want %r" % (got, want)))
        print("\n%d/%d checks passed" % (len(checks) - len(bad), len(checks)))
        return 1 if bad else 0
    finally:
        os.unlink(path)


if __name__ == "__main__":
    sys.exit(main())
