#!/usr/bin/env python3
"""No-device test for stopping a lab runner's process tree (process_tree.py).

night-job.py stops a night runner that outlives its bound, companion-queue.py a
job, and overnight-window.py its queue child: SIGINT, then SIGTERM, then
SIGKILL, each given its grace. A runner's work runs in its children, so the
signals must reach the whole tree, and on a host without /proc (macOS) too.

Covered:
- the tree from /proc (a comm holding spaces and parentheses), from `ps` where
  there is no /proc, and just the process where neither answers;
- the stop: INT, TERM, then KILL, each once, to a child that ignores the first
  two; a child already gone is not signalled again; a child that outlives the
  last grace is reported;
- night-job.py stops a stubborn runner (INT and TERM ignored, inherited by its
  child) and that runner's child, on a host without /proc;
- companion-queue.py does the same for a job, and a child orphaned holding the
  job's output does not hold the queue past the last grace.
"""

from __future__ import annotations

import importlib.util
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import ModuleType

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parents[2] / "packages/play/src/safety"))
# By name, so the test patches the module night-job.py imports, not a copy.
process_tree = importlib.import_module("process_tree")

failures: list[str] = []
passed = 0

# Ignores SIGINT and SIGTERM, which its background child inherits; prints that child's pid.
STUBBORN = "trap '' INT TERM; sleep 60 & echo \"grandchild $!\"; wait"


def check(name: str, condition: bool, detail: object = "") -> None:
    global passed
    if condition:
        passed += 1
    else:
        failures.append(f"{name}: {str(detail)[:2000]}")


def wait_for(predicate: object, what: str, limit: float = 10.0) -> bool:
    assert callable(predicate)
    until = time.monotonic() + limit
    while time.monotonic() < until:
        if predicate():
            return True
        time.sleep(0.02)
    check(f"waited for {what}", False, "timed out")
    return False


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def load(name: str, file: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, HERE.parent / file)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def grandchild_of(log: Path) -> int | None:
    text = log.read_text(encoding="utf-8") if log.exists() else ""
    for line in text.splitlines():
        if line.startswith("grandchild "):
            return int(line.split()[1])
    return None


def stubborn_with_child() -> tuple[subprocess.Popen[str], int]:
    child = subprocess.Popen(["sh", "-c", STUBBORN], stdout=subprocess.PIPE, text=True)
    assert child.stdout is not None
    return child, int(child.stdout.readline().split()[1])


def reads_the_tree(base: Path) -> None:
    proc = base / "proc"
    for pid, stat in ((100, "100 (sh) S 1 100"), (101, "101 (a b) c)) S 100 100"), (102, "102 (x) S 101 100"),
                      (200, "200 (other) S 1 200")):
        (proc / str(pid)).mkdir(parents=True)
        (proc / str(pid) / "stat").write_text(stat, encoding="utf-8")
    (proc / "self").mkdir()
    check("tree: /proc, a comm with spaces and parentheses", sorted(process_tree.tree(100, proc=proc)) == [100, 101, 102],
          process_tree.tree(100, proc=proc))
    missing = base / "no-proc"
    child, grandchild = stubborn_with_child()
    try:
        members = process_tree.tree(child.pid, proc=missing)
        check("tree: from ps where there is no /proc", members[:1] == [child.pid] and grandchild in members,
              (members, child.pid, grandchild))
        check("tree: just the process where neither answers",
              process_tree.tree(child.pid, proc=missing, ps=("false",)) == [child.pid])
    finally:
        for pid in (grandchild, child.pid):
            os.kill(pid, signal.SIGKILL)
        child.wait(timeout=10)


def stops(base: Path) -> None:
    setattr(process_tree, "PROC", base / "no-proc")
    child, grandchild = stubborn_with_child()
    sent: list[str] = []
    started = time.monotonic()
    done = process_tree.stop(child, lambda signum: process_tree.signal_tree(child.pid, signum), (0.3, 0.3, 10.0),
                             on_signal=lambda signum: sent.append(signum.name))
    check("stop: INT, TERM, then KILL to a child ignoring the first two",
          done and sent == ["SIGINT", "SIGTERM", "SIGKILL"] and child.returncode == -signal.SIGKILL,
          (done, sent, child.returncode))
    wait_for(lambda: not alive(grandchild), "stop: the child's own child to die")
    check("stop: within the graces", time.monotonic() - started < 15, time.monotonic() - started)
    if alive(grandchild):
        os.kill(grandchild, signal.SIGKILL)

    def gone(_signum: signal.Signals) -> None:
        raise ProcessLookupError
    quiet: list[str] = []
    check("stop: nothing left to stop sends nothing more",
          process_tree.stop(child, gone, (0.1, 0.1, 0.1), on_signal=lambda signum: quiet.append(signum.name))
          and quiet == [], quiet)

    survivor = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])
    try:
        outlived = process_tree.stop(survivor, lambda _signum: None, (0.05, 0.05, 0.05))
        check("stop: a child that outlives the last grace is reported", outlived is False and survivor.poll() is None)
    finally:
        survivor.kill()
        survivor.wait(timeout=10)


def night_job_stops_the_tree(base: Path) -> None:
    setattr(process_tree, "PROC", base / "no-proc")
    os.environ["FNAF_NIGHT_JOB_DIR"] = str(base / "night-jobs")
    night_job = load("night_job", "night-job.py")
    setattr(night_job, "RUNNER_STOP_GRACE_S", 0.3)
    setattr(night_job, "RUNNER_TERM_GRACE_S", 0.3)
    job = night_job.NightJob("FAKE0001", "cue-1-00000000")
    started = time.monotonic()
    code, text, stopped = job.run_runner(["sh", "-c", STUBBORN], dict(os.environ), 1.0)
    grandchild = grandchild_of(job.dir / "runner.log")
    signals = [event["signal"] for event in job.record["events"] if event["type"] == "runner-signal"]
    check("night-job: the runner was stopped at its bound", stopped == "timeout", (code, stopped, text))
    check("night-job: INT, TERM, then KILL, each once", signals == ["SIGINT", "SIGTERM", "SIGKILL"], signals)
    check("night-job: the runner's child printed its pid", grandchild is not None, text)
    if grandchild is not None:
        wait_for(lambda: not alive(grandchild), "night-job: the runner's child to die")
        if alive(grandchild):
            os.kill(grandchild, signal.SIGKILL)
    check("night-job: the stop took the graces, not the child's 60 s", time.monotonic() - started < 30,
          time.monotonic() - started)


def queue_stops_the_tree(base: Path) -> None:
    setattr(process_tree, "PROC", base / "no-proc")
    queue = load("companion_queue", "companion-queue.py")
    setattr(queue, "JOB_STOP_GRACE_S", 0.3)
    setattr(queue, "JOB_TERM_GRACE_S", 0.3)
    setattr(queue, "JOB_KILL_GRACE_S", 2.0)
    started = time.monotonic()
    code, output, stopped, _signals = queue.run_job(["sh", "-c", STUBBORN.replace("60", "20")], dict(os.environ), 1.0)
    grandchild = next((int(line.split()[1]) for line in output.splitlines() if line.startswith("grandchild ")), None)
    check("queue: a stubborn job and its child are stopped at the ceiling, not after the child's 20 s",
          stopped == "timeout" and code == -signal.SIGKILL and time.monotonic() - started < 10,
          (code, stopped, time.monotonic() - started, output))
    if grandchild is not None and alive(grandchild):
        os.kill(grandchild, signal.SIGKILL)

    # The job exits at SIGINT, but its background child (SIGINT ignored, as in any
    # non-interactive shell) is orphaned holding the output pipe: no tree reaches it.
    started = time.monotonic()
    code, output, stopped, _signals = queue.run_job(["sh", "-c", "sleep 20 & echo \"orphan $!\"; wait"],
                                                    dict(os.environ), 1.0)
    orphan = next((int(line.split()[1]) for line in output.splitlines() if line.startswith("orphan ")), None)
    check("queue: an orphan holding the output does not hold the queue past its last grace",
          stopped == "timeout" and time.monotonic() - started < 10, (code, stopped, time.monotonic() - started))
    if orphan is not None and alive(orphan):
        os.kill(orphan, signal.SIGKILL)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="process-tree-test-") as directory:
        base = Path(directory)
        reads_the_tree(base)
        stops(base)
        night_job_stops_the_tree(base)
        queue_stops_the_tree(base)
    if failures:
        print("process tree FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print(f"process tree: {passed} checks -- the tree from /proc, from ps, or the process alone; INT then TERM "
          "then KILL, bounded; night-job.py stops a stubborn runner and its child on a host without /proc")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
