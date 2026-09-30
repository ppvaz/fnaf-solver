#!/usr/bin/env python3
"""framesource.py contract: the same bytes from the shared decode and from a
private ffmpeg, a missing pipe falling back to ffmpeg, and one decode per
recording in the split plan.

No device. ffmpeg synthesises the recording (testsrc2, 2 s at 30 fps, 320x180),
so the test is hermetic and takes about a second.
"""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
import tempfile
import threading

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import framesource as fs  # noqa: E402


def check(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"test-framesource: FAIL: {message}")


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="framesource-") as tmp:
        tmp_path = pathlib.Path(tmp)
        video = tmp_path / "clip.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30",
                        "-t", "2", "-pix_fmt", "yuv420p", str(video)], check=True)

        # Two instruments' chains, plus a duplicate of the first with another pix_fmt.
        rgb = fs.Spec(str(video), "fps=10,scale=160:90", "rgb24", 160 * 90 * 3)
        gray = fs.Spec(str(video), "fps=10,scale=160:90", "gray", 160 * 90)
        crop = fs.Spec(str(video), "fps=5,scale=320:180,crop=100:40:10:20", "rgb24", 100 * 40 * 3)

        # 1. The private path yields whole frames at the chain's rate.
        private = {spec.name: list(fs.frames(spec.path, spec.chain, spec.pix_fmt, spec.frame_size))
                   for spec in (rgb, gray, crop)}
        check(len(private[rgb.name]) == 20 and len(private[crop.name]) == 10,
              f"private decode frame counts: {len(private[rgb.name])} rgb, {len(private[crop.name])} crop")
        check(all(len(frame) == rgb.frame_size for frame in private[rgb.name]), "whole rgb frames")

        # 2. The split plan decodes the recording once and writes every branch.
        command, pipes = fs.plan_split([rgb, gray, crop, rgb], tmp_path)
        check(command.count("-i") == 1, "one input for one recording")
        check(len(pipes) == 3, f"three distinct branches, got {len(pipes)}")
        check("split=3" in " ".join(command), "the split fans out to the three branches")

        # 3. Shared path: fifos, ffmpeg writing, consumers reading concurrently,
        #    and the bytes are the private decode's bytes.
        for pipe in pipes:
            os.mkfifo(pipe)
        shared: dict[str, list[bytes]] = {}
        env = dict(os.environ, **{fs.ENV_DIR: str(tmp_path)})

        def consume(spec: fs.Spec) -> None:
            os.environ[fs.ENV_DIR] = str(tmp_path)
            shared[spec.name] = list(fs.frames(spec.path, spec.chain, spec.pix_fmt, spec.frame_size))

        threads = [threading.Thread(target=consume, args=(spec,)) for spec in (rgb, gray, crop)]
        for thread in threads:
            thread.start()
        proc = subprocess.run(command, env=env, capture_output=True)
        for thread in threads:
            thread.join(timeout=30)
        check(proc.returncode == 0, f"split ffmpeg exit {proc.returncode}: {proc.stderr.decode(errors='replace')[-300:]}")
        for spec in (rgb, gray, crop):
            check(shared[spec.name] == private[spec.name],
                  f"{spec.chain} {spec.pix_fmt}: shared bytes differ from the private decode "
                  f"({len(shared[spec.name])} vs {len(private[spec.name])} frames)")

        # 4. A missing pipe is a fallback, never an error.
        os.environ[fs.ENV_DIR] = str(tmp_path)
        other = fs.Spec(str(video), "fps=2,scale=32:18", "gray", 32 * 18)
        check(len(list(fs.frames(other.path, other.chain, other.pix_fmt, other.frame_size))) == 4,
              "an unregistered spec decodes privately")
        del os.environ[fs.ENV_DIR]

        # 5. An ffmpeg failure exits with ffmpeg's own code, as the instruments did.
        try:
            list(fs.frames(str(tmp_path / "missing.mp4"), "fps=1", "gray", 1))
            check(False, "a missing recording must fail")
        except SystemExit as exit_:
            check(exit_.code not in (0, None), "the exit carries ffmpeg's non-zero code")

        # 6. The name keys the chain verbatim.
        check(fs.spec_name("a.mp4", "fps=10", "gray") != fs.spec_name("a.mp4", "fps=10 ", "gray"),
              "a chain that differs by a character is a different branch")

    print("test-framesource: ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
