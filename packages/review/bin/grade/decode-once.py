#!/usr/bin/env python3
"""Run the video instruments concurrently over ONE decode of the recording.

WHY

grade-run.sh ran the seven video instruments one after another, each
decoding the whole recording for itself: nine decodes of one file, 55-72 s
each on one core for a 232 s night, ~600 of a 703 s pipeline. Every
instrument now reads its frames through framesource.py, so the decode can be
shared -- but a shared decode has to be a RENDEZVOUS, not a plan: the chain an
instrument wants depends on its arguments (camtrace's --fps, keyframes'
--count) and two of them read the recording twice in sequence (sweepcheck rgb
then gray, keyframes small then tiles).

HOW

The instruments are launched together with FNAF2_FRAME_SOURCE_DIR pointing at
a fresh directory and FNAF2_FRAME_SOURCE_RENDEZVOUS=1. When one reaches its
decode, framesource announces the spec (a json beside a new fifo) and blocks
opening the fifo. This orchestrator watches the directory; once the set of
announced-but-unserved pipes has been stable for `--settle` seconds, it runs
ONE ffmpeg (framesource.plan_split) that decodes each recording once and
writes every branch to its fifo. ffmpeg blocks on the slowest reader, so the
only memory in flight is the pipe buffers. When that ffmpeg exits, any
instrument that wanted a second stream has announced it, and the loop runs a
second, smaller decode. Nine decodes become two.

The fifos and announcements live in a temp directory; nothing decoded is ever
written to a file (the 60 fps full-resolution branch is 2.2 MB per frame, and
/tmp on this host is tmpfs -- fifos hold no data, so they may live there).

RESOURCE CONTRACT

Each consumer gets the same fuse grade-run.sh gave its step: RLIMIT_AS of
--vmem-kb, a CPU affinity of --cpuset, nice 10, and --timeout seconds. At most
--max-concurrent consumers run at once; the rest wait, and an ffmpeg is only
started for consumers that are running. ffmpeg itself runs under --timeout
too, so a consumer that dies between announcing and opening its fifo cannot
hang the decode: its pipe is dropped from the plan when its pid is gone, and
the timeout covers the race.

OUTPUT

Each instrument's stdout and stderr are captured and replayed in the order
given, each under its own `--- label ---` header with its exit code and wall
time, so the log keeps the shape night-run.sh's verdict grep and a reader
expect. Exit code: 0 when every instrument exited 0 or 3 (3 is grade-run's
"a fact about the run"); otherwise the first other non-zero code.

Usage:
    decode-once.py [--cpuset 2-9] [--vmem-kb N] [--timeout S] [--settle S]
                   [--max-concurrent N] --step LABEL -- CMD ARGS... [--step ...]
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import resource
import shlex
import subprocess
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import framesource as fs  # noqa: E402

INFORMATIONAL = 3


def parse_steps(argv: list[str]) -> tuple[argparse.Namespace, list[tuple[str, list[str]]]]:
    """`--step LABEL -- cmd...` groups, repeated; everything before the first --step is options."""
    steps: list[tuple[str, list[str]]] = []
    head: list[str] = []
    i = 0
    while i < len(argv):
        if argv[i] == "--step":
            label = argv[i + 1]
            if argv[i + 2] != "--":
                raise SystemExit("decode-once: --step LABEL must be followed by -- and the command")
            j = i + 3
            cmd: list[str] = []
            while j < len(argv) and argv[j] != "--step":
                cmd.append(argv[j])
                j += 1
            if not cmd:
                raise SystemExit(f"decode-once: step {label!r} has no command")
            steps.append((label, cmd))
            i = j
        else:
            head.append(argv[i])
            i += 1
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--cpuset", default=os.environ.get("GRADE_CPUSET", ""), help="cpu list for every process, e.g. 2-9")
    parser.add_argument("--vmem-kb", type=int, default=int(os.environ.get("GRADE_MAX_VMEM_KB", "2097152")))
    parser.add_argument("--timeout", type=float, default=float(os.environ.get("GRADE_STEP_TIMEOUT_SECONDS", "1800")))
    parser.add_argument("--settle", type=float, default=2.0, help="seconds the announced set must be stable before a decode starts")
    parser.add_argument("--max-concurrent", type=int, default=7)
    parser.add_argument("--ffmpeg-vmem-kb", type=int, default=0,
                        help="RLIMIT_AS for the shared ffmpeg (0 = 4 x --vmem-kb). A multi-branch filter graph needs more ADDRESS SPACE than one "
                             "branch did, though its resident size stays a few frames per branch; the cgroup slice guards residency")
    parser.add_argument("--json", action="store_true", help="append a machine-readable summary")
    args = parser.parse_args(head)
    if not steps:
        raise SystemExit("decode-once: no --step given")
    return args, steps


# The fuse is a Linux contract: CPU affinity is os.sched_setaffinity, which
# only Linux exposes, and macOS refuses a finite RLIMIT_AS ("current limit
# exceeds maximum limit"). On a host without them the decode still runs -- the
# test lanes exercise the pipeline on a developer Mac -- but says so once on
# stderr, so a grade run that expected the fuse can see it was not armed.
HAS_AFFINITY = hasattr(os, "sched_setaffinity")
HAS_RLIMIT_AS = sys.platform.startswith("linux")
_fuse_warned = False


def child_limits(cpus: set[int], vmem_kb: int):
    """The preexec_fn for one consumer or the shared ffmpeg: affinity, nice 10, RLIMIT_AS."""
    global _fuse_warned
    missing = []
    if cpus and not HAS_AFFINITY:
        missing.append("cpu affinity")
    if vmem_kb > 0 and not HAS_RLIMIT_AS:
        missing.append("RLIMIT_AS")
    if missing and not _fuse_warned:
        _fuse_warned = True
        print(f"decode-once: {' and '.join(missing)} not enforceable on {sys.platform}; running without that fuse",
              file=sys.stderr, flush=True)

    def limits():
        if cpus and HAS_AFFINITY:
            os.sched_setaffinity(0, cpus)
        os.nice(10)
        if vmem_kb > 0 and HAS_RLIMIT_AS:
            resource.setrlimit(resource.RLIMIT_AS, (vmem_kb * 1024, vmem_kb * 1024))
    return limits


def cpu_list(spec: str) -> set[int]:
    cpus: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-")
            cpus.update(range(int(lo), int(hi) + 1))
        else:
            cpus.add(int(part))
    return cpus


class Consumer:
    def __init__(self, index: int, label: str, cmd: list[str]):
        self.index, self.label, self.cmd = index, label, cmd
        self.proc: subprocess.Popen | None = None
        self.started = 0.0
        self.finished = 0.0
        self.out = tempfile.TemporaryFile()
        self.err = tempfile.TemporaryFile()
        self.returncode: int | None = None
        self.timed_out = False
        self.decode_failed: int | None = None   # the shared ffmpeg's exit code, when it died under this consumer

    def start(self, env: dict, cpus: set[int], vmem_kb: int) -> None:
        self.started = time.monotonic()
        self.proc = subprocess.Popen(self.cmd, stdout=self.out, stderr=self.err, env=env,
                                     preexec_fn=child_limits(cpus, vmem_kb))

    def poll(self, timeout: float) -> bool:
        """True once finished (or killed for timeout)."""
        if self.proc is None:
            return False
        if self.returncode is not None:
            return True
        code = self.proc.poll()
        if code is None and time.monotonic() - self.started > timeout:
            self.proc.kill()
            self.timed_out = True
            code = self.proc.wait()
        if code is not None:
            self.returncode = code
            self.finished = time.monotonic()
            return True
        return False


def pending_announcements(directory: pathlib.Path, served: set[str]) -> list[dict]:
    found = []
    for announce in sorted(directory.glob("*.json")):
        if announce.name in served:
            continue
        try:
            data = json.loads(announce.read_text())
        except (OSError, ValueError):
            continue
        data["announce"] = announce.name
        found.append(data)
    return found


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def run_decode(announced: list[dict], directory: pathlib.Path, cpus: set[int], timeout: float,
               vmem_kb: int = 0) -> tuple[int, int, list[dict]]:
    """One ffmpeg over the announced pipes whose consumer is alive. Returns (exit, branches, served)."""
    live = [entry for entry in announced if alive(entry["pid"])]
    for entry in announced:
        if entry not in live:
            pathlib.Path(entry["pipe"]).unlink(missing_ok=True)
    if not live:
        return 0, 0, []
    specs = [fs.Spec(entry["path"], entry["chain"], entry["pix_fmt"], entry["frame_size"]) for entry in live]
    pipes = {entry["announce"]: pathlib.Path(entry["pipe"]) for entry in live}
    command, _ = fs.plan_split(specs, directory, pipes_by_name=pipes)

    proc = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                            preexec_fn=child_limits(cpus, vmem_kb))
    try:
        _, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        _, err = proc.communicate()
        sys.stderr.write(f"decode-once: shared ffmpeg exceeded {timeout:.0f} s and was killed\n")
        return 124, len(live), live
    if proc.returncode:
        sys.stderr.buffer.write(err[-2000:])
    return proc.returncode, len(live), live


def main(argv: list[str]) -> int:
    args, steps = parse_steps(argv)
    cpus = cpu_list(args.cpuset)
    consumers = [Consumer(i, label, cmd) for i, (label, cmd) in enumerate(steps)]
    decodes: list[dict] = []
    with tempfile.TemporaryDirectory(prefix="decode-once-") as tmp:
        directory = pathlib.Path(tmp)
        env = dict(os.environ, **{fs.ENV_DIR: str(directory), fs.ENV_RENDEZVOUS: "1"})
        served: set[str] = set()
        queue = list(consumers)
        running: list[Consumer] = []
        stable_since = None
        stable_key = None
        while queue or running:
            while queue and len(running) < args.max_concurrent:
                consumer = queue.pop(0)
                consumer.start(env, cpus, args.vmem_kb)
                running.append(consumer)
            running = [c for c in running if not c.poll(args.timeout)]
            announced = pending_announcements(directory, served)
            key = tuple(sorted(entry["announce"] for entry in announced))
            if announced and key == stable_key:
                if time.monotonic() - stable_since >= args.settle:
                    started = time.monotonic()
                    code, branches, live = run_decode(announced, directory, cpus, args.timeout,
                                                      args.ffmpeg_vmem_kb or 4 * args.vmem_kb)
                    decodes.append({"branches": branches, "exit": code, "seconds": round(time.monotonic() - started, 1),
                                    "chains": sorted({entry["chain"] for entry in announced})})
                    served.update(entry["announce"] for entry in announced)
                    if code != 0:
                        # A consumer on a pipe whose writer died sees EOF, not an
                        # error: it would finish on a truncated stream and exit 0
                        # with a wrong answer. Fail it loudly instead.
                        dead = {entry["pid"] for entry in live}
                        for consumer in running:
                            if consumer.proc and consumer.proc.pid in dead:
                                consumer.proc.kill()
                                consumer.poll(args.timeout)
                                consumer.decode_failed = code
                    stable_key, stable_since = None, None
                    continue
            elif announced:
                stable_key, stable_since = key, time.monotonic()
            else:
                stable_key, stable_since = None, None
            time.sleep(0.2)

    worst = 0
    for consumer in consumers:
        print(f"--- {consumer.label} ---")
        consumer.out.seek(0)
        sys.stdout.write(consumer.out.read().decode(errors="replace"))
        consumer.err.seek(0)
        err = consumer.err.read().decode(errors="replace")
        if err.strip():
            sys.stdout.write(err if err.endswith("\n") else err + "\n")
        code = consumer.returncode if consumer.returncode is not None else -1
        if consumer.decode_failed is not None:
            code = consumer.decode_failed
        took = consumer.finished - consumer.started if consumer.finished else 0.0
        verdict = (f"FAILED: the shared decode under this instrument exited {consumer.decode_failed}; its output above is from a truncated stream and is discarded"
                   if consumer.decode_failed is not None else
                   "timed out" if consumer.timed_out else
                   "a result about the run, not an instrument failure" if code == INFORMATIONAL else
                   "ok" if code == 0 else f"FAILED (exit {code})")
        print(f"[decode-once] {consumer.label}: exit {code}, {took:.0f}s, {verdict}")
        if code not in (0, INFORMATIONAL) and worst == 0:
            worst = code if code > 0 else 1
        sys.stdout.flush()
    print(f"[decode-once] {len(decodes)} shared decode(s) for {len(consumers)} instruments: " +
          ", ".join(f"{d['branches']} branches in {d['seconds']}s (exit {d['exit']})" for d in decodes))
    if args.json:
        print(json.dumps({"schema": "decode-once-v1", "decodes": decodes,
                          "steps": [{"label": c.label, "exit": c.returncode, "seconds": round(c.finished - c.started, 1) if c.finished else None,
                                     "timedOut": c.timed_out, "decodeFailed": c.decode_failed} for c in consumers]}))
    if any(d["exit"] not in (0,) for d in decodes) and worst == 0:
        worst = 1
    return worst


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
