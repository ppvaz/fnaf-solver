#!/usr/bin/env python3
"""Fingerprint the reference cue samples and report how separable they are.

The samples themselves are game content and stay outside the repository; this
writes only derived knowledge -- durations, hashes, and the pairwise similarity
of the features a detector would actually compare. That separability is a
property of the cue set alone, before any device noise, so it is the ceiling
any detector on this phone can reach.

  packages/source/decompile/extract-samples.sh /path/to/base.apk
  tools/cue/reference-report.py [refdir] [--json out.json]

Handles come from the event sheet: `packages/source/decompile/readdump.py sounds 3`.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import features  # noqa: E402

DEFAULT_REFS = "/private/tmp/fnaf2-cue-refs"

# What each handle means, from the 2026-08-24 gate-0 pass recorded in
# docs/android/ANDROID-SOURCE-STATUS.md.
ROLE = {
    15: "music-box loop (g596-600; persistent capture background)",
    16: "BB in-office taunt (g78/88/302/304/311/318)",
    17: "shared movement thud (g691-694, 18 edges, 7 characters)",
    21: "BB vocal 1 (g608) and arrival at 122 (g607)",
    23: "BB vocal 3 (g610) -- the only sole-trigger vocal",
    24: "BB vocal 2 (g609), also Toy Foxy g743 and BB g814 at 123",
    25: "footstep bank (g704, Random(5)+1, 8 characters)",
    26: "footstep bank (g705)",
    27: "footstep bank (g706)",
    28: "footstep bank (g707)",
    29: "footstep bank (g708)",
    30: "Mangle movement bank (g703/g709, hear footsteps branch 1)",
    31: "Mangle movement bank (g703/g710, hear footsteps branch 2)",
    32: "Mangle movement bank (g703/g711, hear footsteps branch 3)",
    20: "Mangle static (g732/733, CAM 11 and office/right-vent contexts)",
    33: "winding ratchet (g637/644, CAM 11 while winding)",
}


def profile(path):
    samples, rate = features.load_wav(path)
    mono = features.resample(samples, rate)
    frames = features.band_frames(mono)
    if frames:
        mean = [sum(f[b] for f in frames) / len(frames)
                for b in range(len(frames[0]))]
    else:
        mean = []
    return {
        "file": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "source_rate": rate,
        "seconds": round(len(samples) / float(rate), 3),
        "peak": round(features.peak(mono), 4),
        "rms": round(features.rms(mono), 4),
        "frames": len(frames),
        "band_profile": [round(v, 3) for v in mean],
    }


def cosine(a, b):
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("refdir", nargs="?", default=DEFAULT_REFS)
    parser.add_argument("--json", help="also write the report as JSON")
    opts = parser.parse_args()

    root = pathlib.Path(opts.refdir)
    if not root.is_dir():
        sys.exit("no reference directory at %s -- run packages/source/decompile/extract-samples.sh"
                 % root)
    found = {}
    for path in sorted(root.glob("s*.wav")):
        match = re.fullmatch(r"s(\d+)\.wav", path.name)
        if match:
            found[int(match.group(1))] = profile(path)
    if not found:
        sys.exit("no sNNNN.wav reference samples in %s" % root)

    print("reference cue samples (%d)" % len(found))
    print()
    print("%-7s %8s %7s %7s  %s" % ("handle", "seconds", "peak", "rms", "role"))
    for handle in sorted(found):
        item = found[handle]
        print("%-7d %8.3f %7.3f %7.4f  %s" % (
            handle, item["seconds"], item["peak"], item["rms"],
            ROLE.get(handle, "unmapped")))

    handles = sorted(found)
    print()
    print("pairwise band-profile similarity (1.00 = same average shape)")
    print("        " + " ".join("%6d" % h for h in handles))
    matrix = {}
    for a in handles:
        row = []
        for b in handles:
            value = cosine(found[a]["band_profile"], found[b]["band_profile"])
            row.append(value)
            matrix["%d/%d" % (a, b)] = round(value, 4)
        print("%6d  " % a + " ".join("%6.2f" % v for v in row))

    report = {"samples": found, "similarity": matrix}
    if opts.json:
        pathlib.Path(opts.json).write_text(json.dumps(report, indent=2) + "\n")
        print()
        print("wrote %s" % opts.json)


if __name__ == "__main__":
    main()
