#!/usr/bin/env python3
"""decode-once.py contract, hermetic: three fake instruments over a testsrc2
clip, two of them reading the recording twice in sequence, one failing before
it announces; the shared decodes must equal each instrument's private decode
byte for byte, the recording must be decoded exactly twice (first streams,
then the late second streams), and the failing instrument must fail only
itself.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import textwrap

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import framesource as fs  # noqa: E402


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"test-decode-once: FAIL: {message}")


CONSUMER = textwrap.dedent('''
    import hashlib, sys
    sys.path.insert(0, %r)
    import framesource as fs
    video, mode = sys.argv[1], sys.argv[2]
    if mode == "fail":
        print("dying before any decode", file=sys.stderr)
        raise SystemExit(7)
    chains = {"a": [("fps=10,scale=160:90", "rgb24", 160 * 90 * 3)],
              "b": [("fps=10,scale=160:90", "rgb24", 160 * 90 * 3), ("fps=10,scale=160:90", "gray", 160 * 90)],
              "c": [("fps=5,scale=320:180,crop=100:40:10:20", "rgb24", 100 * 40 * 3), ("fps=2,scale=32:18", "gray", 32 * 18)]}[mode]
    for chain, pix, size in chains:
        digest = hashlib.sha256()
        count = 0
        for frame in fs.frames(video, chain, pix, size):
            digest.update(frame); count += 1
        print(f"{mode} {chain} {pix} frames={count} sha={digest.hexdigest()[:16]}")
    raise SystemExit(3 if mode == "c" else 0)
''')


def private_digest(video: str, chain: str, pix: str, size: int) -> tuple[int, str]:
    digest = hashlib.sha256()
    count = 0
    for frame in fs.frames(video, chain, pix, size):
        digest.update(frame)
        count += 1
    return count, digest.hexdigest()[:16]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="decode-once-test-") as tmp:
        tmp_path = pathlib.Path(tmp)
        video = tmp_path / "clip.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
                        "-t", "2", "-pix_fmt", "yuv420p", str(video)], check=True)
        consumer = tmp_path / "consumer.py"
        consumer.write_text(CONSUMER % str(HERE))

        result = subprocess.run(
            [sys.executable, str(HERE / "decode-once.py"), "--settle", "0.5", "--timeout", "60", "--max-concurrent", "4", "--json",
             "--step", "A", "--", sys.executable, str(consumer), str(video), "a",
             "--step", "B", "--", sys.executable, str(consumer), str(video), "b",
             "--step", "C", "--", sys.executable, str(consumer), str(video), "c",
             "--step", "F", "--", sys.executable, str(consumer), str(video), "fail"],
            capture_output=True, text=True, timeout=120)
        out = result.stdout
        check(result.returncode == 7, f"exit is the failing instrument's code, got {result.returncode}\n{out}\n{result.stderr}")
        summary = json.loads(out.strip().splitlines()[-1])
        check(len(summary["decodes"]) == 2, f"two shared decodes (first streams, then the late seconds), got {summary['decodes']}")
        check(summary["decodes"][0]["branches"] == 3 and summary["decodes"][1]["branches"] == 2,
              f"3 branches then 2, got {[d['branches'] for d in summary['decodes']]}")
        check(all(d["exit"] == 0 for d in summary["decodes"]), "both shared ffmpegs exited 0")
        steps = {s["label"]: s for s in summary["steps"]}
        check(steps["A"]["exit"] == 0 and steps["B"]["exit"] == 0 and steps["C"]["exit"] == 3 and steps["F"]["exit"] == 7,
              f"per-step exits preserved, got {steps}")
        check("--- C ---" in out and "a result about the run" in out and "dying before any decode" in out,
              "each instrument's stdout/stderr is replayed under its own header")

        # Every shared read equals the private decode, byte for byte.
        expected = {
            ("a", "fps=10,scale=160:90", "rgb24"): private_digest(str(video), "fps=10,scale=160:90", "rgb24", 160 * 90 * 3),
            ("b", "fps=10,scale=160:90", "gray"): private_digest(str(video), "fps=10,scale=160:90", "gray", 160 * 90),
            ("c", "fps=5,scale=320:180,crop=100:40:10:20", "rgb24"): private_digest(str(video), "fps=5,scale=320:180,crop=100:40:10:20", "rgb24", 100 * 40 * 3),
            ("c", "fps=2,scale=32:18", "gray"): private_digest(str(video), "fps=2,scale=32:18", "gray", 32 * 18),
        }
        for (mode, chain, pix), (count, sha) in expected.items():
            line = f"{mode} {chain} {pix} frames={count} sha={sha}"
            check(line in out, f"shared decode differs from private for {mode} {chain} {pix}:\n{out}")

    # A shared ffmpeg that dies must fail the instruments it was feeding, loudly:
    # an address-space cap of 1 MB kills ffmpeg at start, the consumers see EOF
    # on their fifos, and the orchestrator must report them FAILED with the
    # decode's exit code rather than replay their truncated results as ok.
    # The starvation itself is RLIMIT_AS, a Linux contract (decode-once.py
    # HAS_RLIMIT_AS): a macOS host cannot arm it, so this block is reported as
    # skipped there rather than passed, and the instrument's own stderr line
    # is the evidence that it knew.
    if not sys.platform.startswith("linux"):
        print(f"test-decode-once: starved-ffmpeg block SKIPPED on {sys.platform} (RLIMIT_AS is a Linux fuse)")
        print("test-decode-once: ok")
        return 0
    with tempfile.TemporaryDirectory(prefix="decode-once-test-") as tmp:
        tmp_path = pathlib.Path(tmp)
        video = tmp_path / "clip.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
                        "-t", "2", "-pix_fmt", "yuv420p", str(video)], check=True)
        consumer = tmp_path / "consumer.py"
        consumer.write_text(CONSUMER % str(HERE))
        result = subprocess.run(
            [sys.executable, str(HERE / "decode-once.py"), "--settle", "0.5", "--timeout", "60", "--ffmpeg-vmem-kb", "1024", "--json",
             "--step", "A", "--", sys.executable, str(consumer), str(video), "a"],
            capture_output=True, text=True, timeout=120)
        summary = json.loads(result.stdout.strip().splitlines()[-1])
        check(summary["decodes"] and summary["decodes"][0]["exit"] != 0, f"the crippled shared ffmpeg fails: {summary['decodes']}")
        check(summary["steps"][0]["decodeFailed"] not in (None, 0) and result.returncode != 0,
              f"the consumer is failed with the decode's code, got {summary['steps'][0]} / exit {result.returncode}")
        check("truncated stream" in result.stdout, "the replay says the output is discarded")

    print("test-decode-once: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
