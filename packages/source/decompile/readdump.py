#!/usr/bin/env python3
"""Read the Fusion event-sheet dump with object handles unscrambled.

The Android runtime XORs every object handle with 28 at load, and events
address objects *after* that XOR, so a raw dump labels every event with the
wrong object name. This reader resolves each handle through the XOR before
looking the name up, which is the only way the dump means anything.

Read docs/android/SOURCE-DUMP-GUIDE.md first -- it explains the file format, the handle
scramble, and the alterable-value vocabulary these commands print.

The dump itself is game content: it lives outside the repo. Point --dump (or
$FNAF2_DUMP) at it; regenerate it with packages/source/decompile/regen-dump.sh.

  readdump.py frames                     every frame and its group count
  readdump.py objects [pattern]          objects by event-space handle
  readdump.py group 3 413-418            print a group range
  readdump.py find 3 "balloon boy"       groups whose text matches
  readdump.py object 3 "balloon boy"     groups referencing an object
  readdump.py writes 3 "balloon boy" 0   groups whose actions write its value 0
  readdump.py sounds 3                   sample handles played, and by which groups
  readdump.py sounds 3 21                the groups that play one sample handle
  readdump.py instances 3 [pattern]      placed scene objects: X, Y, layer, extent

PC dumps (Fusion builds before the Android scramble) need --xor 0 --lo-xor 0.

Placed frame instances are scrambled again, with their own constant: the
runtime's layout loader (Frame/CLO.load) reads an instance's object handle as
`readAShort() ^ 48`, and only then looks it up in the post-XOR-28 item table.
So an ` I` line's OI is neither an event handle nor an item-table row: the
event handle is OI ^ 48 and the item-table row is OI ^ 48 ^ 28.
"""
import argparse
import os
import re
import sys

DEFAULT_DUMP = os.environ.get(
    "FNAF2_DUMP", "/private/tmp/fnaf2-android-dump/events-android.txt")

# "6:Sample:Sample '<obfuscated name>' handle: N" is a play-sample action.
SAMPLE_RE = re.compile(r"Sample:Sample .*? handle: (\d+)")
POSITION_RE = re.compile(r"Object Info: (\d+)")
# ParamObject renders as "Object <oil> <handle> <type>" (see ParamObject.cs).
PARAMOBJECT_RE = re.compile(r"Object (\d+) (\d+) (\d+)")


class Dump:
    def __init__(self, path, xor=28, lo_xor=48):
        self.xor = xor
        self.lo_xor = lo_xor       # Frame/CLO.load: loOiHandle = readAShort() ^ 48
        self.objects = {}          # stored handle -> name as the item table has it
        self.types = {}            # stored handle -> TYPE as the item table has it
        self.images = {}           # stored handle -> (W, H, HOTX, HOTY) as the dumper read that row
        self.frames = []           # [{idx, name, size, layers, instances, groups}]
        frame = group = None
        with open(path, errors="replace") as handle:
            for raw in handle:
                line = raw.rstrip("\n")
                field = line.split("\t")
                if field[0] == "OBJECT":
                    self.objects[int(field[1])] = field[5]
                    self.types[int(field[1])] = field[3]
                elif field[0] == "FRAME":
                    frame = {"idx": int(field[1]), "name": field[2], "groups": [],
                             "size": {}, "layers": [], "instances": []}
                    self.frames.append(frame)
                elif field[0] == " F":
                    frame["size"] = dict(zip(field[1::2], field[2::2]))
                elif field[0] == " L":
                    frame["layers"].append(dict(zip(field[1::2], field[2::2])))
                elif field[0] == " I":
                    instance = dict(zip(field[1::2], field[2::2]))
                    frame["instances"].append(instance)
                    if instance.get("W"):
                        self.images.setdefault(int(instance["OI"]), tuple(
                            int(instance[k]) for k in ("W", "H", "HOTX", "HOTY")))
                elif field[0] == "GROUP":
                    group = {"idx": int(field[1]), "header": dict(zip(field[2::2], field[3::2])),
                             "lines": []}
                    frame["groups"].append(group)
                elif line.startswith(" C") or line.startswith(" A"):
                    group["lines"].append(line)

    def name(self, handle):
        """True name of the object an event addresses by `handle`."""
        return self.objects.get(handle ^ self.xor, "?%d" % handle)

    def handle(self, instance):
        """The event-space handle of a placed scene object.

        The runtime's layout loader (Frame/CLO.load) XORs an instance's stored
        object handle with 48 and only then resolves it through the item table
        that COI.loadHeader already XORed with 28. So an ` I` line's OI is its
        own space: the event handle is OI ^ 48, and the item-table row is
        OI ^ 48 ^ 28. Neither earlier rule was right: "not scrambled"
        (2026-08-26) and "same space as events" (2026-09-15) each left the
        Office without five of its twelve camera markers, and the recompile
        join that backed the second read the same chunk with the same mistake.
        See docs/android/SOURCE-DUMP-GUIDE.md 4.
        """
        return int(instance["OI"]) ^ self.lo_xor

    def placed(self, instance):
        """True name of a placed scene object."""
        return self.name(self.handle(instance))

    def extent(self, instance):
        """(left, top, right, bottom) in scene units, or None with no image.

        The dumper read W/H/HOTX/HOTY from the item-table row equal to the raw
        OI, which is not the object's row. The true object's row is
        OI ^ lo_xor ^ xor, and its image is what the dumper printed on any
        instance line (in any frame) whose OI equals that row. Fusion draws an
        image with its hotspot on the object's position. Animation 0 /
        direction 0 / frame 0 -- the default appearance, not whatever is
        showing at runtime.
        """
        image = self.images.get(self.handle(instance) ^ self.xor)
        if image is None:
            return None
        w, h, hot_x, hot_y = image
        x, y = int(instance["X"]), int(instance["Y"])
        left, top = x - hot_x, y - hot_y
        return (left, top, left + w, top + h)

    def image_known(self, instance):
        """False when the true object is an Active whose image no instance line carries."""
        row = self.handle(instance) ^ self.xor
        return row in self.images or self.types.get(row) != "2"

    def render(self, line):
        field = line.split("\t")
        kind = field[0].strip()
        cell = dict(zip(field[1::2], field[2::2]))
        handle = int(cell.get("OI", "0"))
        # Fusion stores condition negation in OtherFlags bit 0.
        negated = kind == "C" and int(cell.get("COTHER", "0") or 0) & 1
        params = line.split("PARAMS\t", 1)[1] if "PARAMS\t" in line else ""
        # Position parameters carry event-space handles too: unscramble them so
        # a route hop reads "-> cam 10" instead of a meaningless number.
        params = POSITION_RE.sub(
            lambda m: "Object Info: %s [%s]" % (m.group(1), self.name(int(m.group(1)))),
            params)
        params = PARAMOBJECT_RE.sub(
            lambda m: "Object %s %s [%s] %s" % (
                m.group(1), m.group(2), self.name(int(m.group(2))), m.group(3)),
            params)
        return "  %s%s ot=%s num=%s oi=%s [%s] %s" % (
            "!" if negated else " ", kind, cell.get("OT"), cell.get("NUM"),
            handle, self.name(handle), params)

    def text(self, group):
        return "\n".join(self.render(line) for line in group["lines"])

    def show(self, frame_index, group):
        header = group["header"]
        print("FRAME %d GROUP %d  flags=%s conds=%s acts=%s" % (
            frame_index, group["idx"], header.get("FLAGS"),
            header.get("CONDS"), header.get("ACTS")))
        print(self.text(group))
        print()

    def samples(self, group):
        """Sample handles this group plays, in action order."""
        played = []
        for _, line in self.actions(group):
            played.extend(int(h) for h in SAMPLE_RE.findall(line))
        return played

    def actions(self, group):
        for line in group["lines"]:
            if line.startswith(" A"):
                field = line.split("\t")
                yield dict(zip(field[1::2], field[2::2])), line


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dump", default=DEFAULT_DUMP)
    parser.add_argument("--lo-xor", type=int, default=48,
                        help="layout-instance handle scramble (Frame/CLO.load); "
                             "48 on this Android build, 0 on PC builds")
    parser.add_argument("--xor", type=int, default=28,
                        help="handle scramble; 28 on Android, 0 on PC builds")
    parser.add_argument("command", choices=["frames", "objects", "group", "find",
                                            "object", "writes", "sounds", "instances"])
    parser.add_argument("args", nargs="*")
    opts = parser.parse_args()

    if not os.path.exists(opts.dump):
        sys.exit("no dump at %s -- see docs/android/SOURCE-DUMP-GUIDE.md" % opts.dump)
    dump = Dump(opts.dump, opts.xor, opts.lo_xor)

    if opts.command == "frames":
        for frame in dump.frames:
            print("%3d  %-34s %5d groups" % (frame["idx"], frame["name"], len(frame["groups"])))
        return

    if opts.command == "objects":
        pattern = opts.args[0].lower() if opts.args else ""
        for stored, name in sorted(dump.objects.items()):
            if pattern and pattern not in name.lower():
                continue
            # Events address this object as stored^xor; print that handle first.
            print("%4d  %s" % (stored ^ opts.xor, name))
        return

    frame_index = int(opts.args[0])
    frame = dump.frames[frame_index]

    if opts.command == "group":
        span = opts.args[1]
        low, _, high = span.partition("-")
        low, high = int(low), int(high or low)
        for group in frame["groups"]:
            if low <= group["idx"] <= high:
                dump.show(frame_index, group)
        return

    if opts.command == "find":
        needle = opts.args[1].lower()
        for group in frame["groups"]:
            if needle in dump.text(group).lower():
                dump.show(frame_index, group)
        return

    if opts.command == "object":
        target = opts.args[1].lower()
        for group in frame["groups"]:
            if any(dump.name(int(dict(zip(l.split("\t")[1::2], l.split("\t")[2::2]))
                                  .get("OI", "0"))).lower() == target
                   for l in group["lines"]):
                dump.show(frame_index, group)
        return

    if opts.command == "sounds":
        wanted = int(opts.args[1]) if len(opts.args) > 1 else None
        index = {}
        for group in frame["groups"]:
            for handle in dump.samples(group):
                index.setdefault(handle, []).append(group["idx"])
        if wanted is not None:
            for group in frame["groups"]:
                if wanted in dump.samples(group):
                    dump.show(frame_index, group)
            return
        # A sample played by one group is a candidate cue; a sample played by
        # many is shared, and cannot identify a state edge on its own.
        for handle in sorted(index):
            groups = index[handle]
            print("sample %3d  %2d group(s)  %s%s" % (
                handle, len(groups), ", ".join(str(g) for g in groups[:12]),
                " ..." if len(groups) > 12 else ""))
        return

    if opts.command == "instances":
        pattern = opts.args[1].lower() if len(opts.args) > 1 else ""
        size = frame["size"]
        print("frame %d  %s  %sx%s  %s layers  %s instances" % (
            frame_index, frame["name"], size.get("WIDTH"), size.get("HEIGHT"),
            size.get("LAYERS"), size.get("INSTANCES")))
        for instance in frame["instances"]:
            name = dump.placed(instance)
            if pattern and pattern not in name.lower():
                continue
            box = dump.extent(instance)
            print("  %-30s h=%-4d oi=%-5s X=%-6s Y=%-6s layer=%-3s %s" % (
                name[:30], dump.handle(instance), instance["OI"],
                instance["X"], instance["Y"], instance["LAYER"],
                "box x[%d..%d] y[%d..%d]" % (box[0], box[2], box[1], box[3])
                if box else "(no image)" if dump.image_known(instance)
                else "(image not in dump)"))
        return

    if opts.command == "writes":
        target = opts.args[1].lower()
        value = "AlterableValue%s " % opts.args[2] if len(opts.args) > 2 else "AlterableValue"
        for group in frame["groups"]:
            for cell, line in dump.actions(group):
                if (dump.name(int(cell.get("OI", "0"))).lower() == target
                        and value in line):
                    dump.show(frame_index, group)
                    break
        return


if __name__ == "__main__":
    main()
