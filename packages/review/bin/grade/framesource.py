#!/usr/bin/env python3
"""One frame source for every video instrument: ffmpeg today, a shared decode
when one is offered.

WHY IT EXISTS

grade-run.sh decodes the same recording nine times: camtrace, sweepcheck
(twice: rgb and gray), keyframes (twice), windpct, grade-minus7, run-timeline
and grade-night each spawn their own ffmpeg with their own ``fps=``/``scale=``
/``crop=`` chain and read rawvideo from its stdout. Measured on
night5-final2's 232 s recording, one core, niced: a single decode is 55-72 s,
and the video part of the pipeline is ~600 of 703 s. Nine decodes of one file
is where the iteration time goes.

The fix that keeps every instrument's bytes identical is to decode ONCE and
fan the branches out: one ffmpeg with ``-filter_complex "[0:v]split=N..."``
where each branch carries exactly the chain its instrument uses today, each
branch written to a named pipe, and the instruments reading their pipes
concurrently. ffmpeg blocks on the slowest reader, so memory stays at
pipe-buffer size and wall time becomes max(decode, slowest consumer) instead
of the sum. Nothing decoded is written to a file: the 60 fps full-resolution
branch is 2.2 MB per frame (93 GB for a 700 s night), and /tmp on this host is
tmpfs.

This module is the seam. ``frames(path, chain, pix_fmt, frame_size)`` yields
frames exactly as the instruments read them from ffmpeg's stdout. When the
environment carries ``FNAF2_FRAME_SOURCE_DIR``, and that directory holds a
pipe registered for the same ``(path, chain, pix_fmt)`` (see ``spec_name``),
the frames come from the pipe instead; otherwise ffmpeg is spawned as before.
An instrument therefore cannot get different bytes from the two paths unless
the chain differs -- and the chain is the key.

``plan_split(...)`` builds the single ffmpeg command for a set of specs; the
orchestration (mkfifo, launch ffmpeg, launch consumers, reap) lives in the
pipeline, not here.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import subprocess
import sys
from dataclasses import dataclass
from typing import Iterable, Iterator

ENV_DIR = "FNAF2_FRAME_SOURCE_DIR"
# Set by decode-once.py: an instrument that finds no pipe for its spec
# ANNOUNCES it (a json beside a fresh fifo) and blocks on the fifo until the
# orchestrator's ffmpeg opens it. Without this flag a missing pipe falls back
# to a private ffmpeg, so nothing ever waits on a decoder that is not coming.
ENV_RENDEZVOUS = "FNAF2_FRAME_SOURCE_RENDEZVOUS"

# The decoder flags every instrument already uses. `-threads 1` is the
# resource contract with grade-run.sh's per-step cpuset; it stays.
FFMPEG_PREFIX = ["ffmpeg", "-v", "error", "-threads", "1", "-filter_threads", "1"]


@dataclass(frozen=True)
class Spec:
    """One branch: the recording, its filter chain and its output pixel format."""
    path: str
    chain: str          # e.g. "fps=60,scale=1280:576" -- verbatim from the instrument
    pix_fmt: str        # "rgb24" | "gray"
    frame_size: int     # bytes per frame the instrument reads

    @property
    def name(self) -> str:
        return spec_name(self.path, self.chain, self.pix_fmt)


def spec_name(path: str, chain: str, pix_fmt: str) -> str:
    """Stable pipe name for a (recording, chain, pix_fmt) triple.

    The recording is keyed by its real path so two instruments over two
    recordings never share a pipe; the chain is keyed verbatim, so a chain that
    differs by one character is a different branch, which is the point.
    """
    real = os.path.realpath(path)
    digest = hashlib.sha256(f"{real}\n{chain}\n{pix_fmt}".encode()).hexdigest()[:16]
    return f"frames-{digest}.{pix_fmt}.raw"


def ffmpeg_command(spec: Spec) -> list[str]:
    """The per-instrument command, unchanged from what the instruments spawn."""
    return FFMPEG_PREFIX + ["-i", spec.path, "-vf", spec.chain,
                            "-f", "rawvideo", "-pix_fmt", spec.pix_fmt, "-"]


def _read_frames(handle, frame_size: int) -> Iterator[bytes]:
    while True:
        frame = handle.read(frame_size)
        if len(frame) < frame_size:
            break
        yield frame


def frames(path: str, chain: str, pix_fmt: str, frame_size: int) -> Iterator[bytes]:
    """Yield frames for `spec`, from the shared decode when offered, else ffmpeg.

    The shared path is taken only when the directory named by
    FNAF2_FRAME_SOURCE_DIR holds a pipe for exactly this spec. A missing pipe is
    not an error: the instrument decodes on its own, as it always has, so a
    partially wired pipeline still grades. A present pipe is read to EOF.
    """
    spec = Spec(path, chain, pix_fmt, frame_size)
    shared = os.environ.get(ENV_DIR)
    if shared:
        pipe = pathlib.Path(shared) / spec.name
        if not pipe.exists() and os.environ.get(ENV_RENDEZVOUS) == "1":
            # One pipe per consumer PROCESS: a fifo has one stream, and two
            # readers of one fifo would each get half the frames. The name
            # carries the pid so identical chains in two instruments become
            # two branches of the same decode, never one shared pipe.
            pipe = pathlib.Path(shared) / f"{os.getpid()}-{spec.name}"
            announce = pipe.with_suffix(pipe.suffix + ".json")
            tmp = announce.with_suffix(".json.tmp")
            tmp.write_text(json.dumps({"path": os.path.realpath(path), "chain": chain, "pix_fmt": pix_fmt,
                                       "frame_size": frame_size, "pid": os.getpid(), "pipe": str(pipe)}))
            os.mkfifo(pipe)
            os.replace(tmp, announce)   # the fifo exists before the announcement is visible
        if pipe.exists():
            with open(pipe, "rb", buffering=frame_size * 4) as handle:
                yield from _read_frames(handle, frame_size)
            return
    proc = subprocess.Popen(ffmpeg_command(spec), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        yield from _read_frames(proc.stdout, frame_size)
    finally:
        # Exactly what every instrument did on its own: ffmpeg's stderr is
        # forwarded and its exit code becomes the step's, so grade-run.sh
        # sees the same failure it saw before this seam existed.
        proc.stdout.close()
        stderr = proc.stderr.read()
        if proc.wait():
            sys.stderr.buffer.write(stderr)
            raise SystemExit(proc.returncode)


def plan_split(specs: Iterable[Spec], directory: str | os.PathLike,
               pipes_by_name: dict[str, pathlib.Path] | None = None) -> tuple[list[str], list[pathlib.Path]]:
    """One ffmpeg command decoding each distinct recording once and writing
    every branch to its pipe under `directory`.

    Returns (command, pipes). Specs over the same recording share one decode;
    a second recording gets its own input and split. Without `pipes_by_name`,
    duplicate specs collapse to one branch named by the spec; with it (the
    rendezvous), each entry is one announced pipe and identical chains from
    two consumers become two branches of the same decode.
    """
    directory = pathlib.Path(directory)
    unique: dict[str, Spec] = {}
    if pipes_by_name is None:
        for spec in specs:
            unique.setdefault(spec.name, spec)
    else:
        for name, spec in zip(pipes_by_name, specs):
            unique[name] = spec
    by_path: dict[str, list[tuple[str, Spec]]] = {}
    for name, spec in unique.items():
        by_path.setdefault(os.path.realpath(spec.path), []).append((name, spec))

    command = FFMPEG_PREFIX + ["-nostdin"]
    filters: list[str] = []
    outputs: list[str] = []
    pipes: list[pathlib.Path] = []
    for index, (path, group) in enumerate(sorted(by_path.items())):
        command += ["-i", path]
        labels = [f"i{index}b{k}" for k in range(len(group))]
        filters.append(f"[{index}:v]split={len(group)}" + "".join(f"[{label}]" for label in labels))
        for label, (name, spec) in zip(labels, group):
            out = f"{label}o"
            filters.append(f"[{label}]{spec.chain}[{out}]")
            pipe = pipes_by_name[name] if pipes_by_name else directory / name
            pipes.append(pipe)
            outputs += ["-map", f"[{out}]", "-f", "rawvideo", "-pix_fmt", spec.pix_fmt, "-y", str(pipe)]
    command += ["-filter_complex", ";".join(filters)] + outputs
    return command, pipes


if __name__ == "__main__":  # pragma: no cover - a tiny CLI for the characterisation harness
    import argparse
    import json
    parser = argparse.ArgumentParser(description="print the single-decode ffmpeg command for a spec list (JSON)")
    parser.add_argument("specs", help="JSON file: [{path, chain, pix_fmt, frame_size}, ...]")
    parser.add_argument("directory")
    args = parser.parse_args()
    loaded = [Spec(**entry) for entry in json.loads(pathlib.Path(args.specs).read_text())]
    cmd, pipes = plan_split(loaded, args.directory)
    print(json.dumps({"command": cmd, "pipes": [str(p) for p in pipes]}, indent=1))
