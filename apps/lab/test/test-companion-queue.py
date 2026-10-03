#!/usr/bin/env python3
"""No-device contract tests for the safe Companion queue.

Every expectation is a check() that records its failure, as in the lab's other
tests, never a bare assert: `python3 -O` strips asserts, and the test would
then pass having checked nothing.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path
from types import ModuleType


HERE = Path(__file__).resolve().parent
QUEUE_SCRIPT = HERE / "../companion-queue.py"


def load_queue() -> ModuleType:
    spec = importlib.util.spec_from_file_location("companion_queue", QUEUE_SCRIPT)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {QUEUE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULE = load_queue()

failures: list[str] = []
passed = 0


def check(name: str, condition: bool, detail: object = "") -> None:
    global passed
    if condition:
        passed += 1
    else:
        failures.append(f"{name}: {str(detail)[:2000]}")


def patched(names: dict[str, object]) -> Callable[[], None]:
    """Set MODULE's attributes; the returned function puts them back."""
    previous = {name: getattr(MODULE, name) for name in names}
    for name, value in names.items():
        setattr(MODULE, name, value)

    def restore() -> None:
        for name, value in previous.items():
            setattr(MODULE, name, value)
    return restore


def queue_file_env(queue: Path) -> Callable[[], None]:
    """Point CUE_HELPER_QUEUE_FILE at `queue`; the returned function restores it."""
    previous = os.environ.get("CUE_HELPER_QUEUE_FILE")
    os.environ["CUE_HELPER_QUEUE_FILE"] = str(queue)

    def restore() -> None:
        if previous is None:
            os.environ.pop("CUE_HELPER_QUEUE_FILE", None)
        else:
            os.environ["CUE_HELPER_QUEUE_FILE"] = previous
    return restore


def read_queue(queue: Path) -> list[dict[str, object]]:
    jobs = json.loads(queue.read_text(encoding="utf-8"))
    return jobs if isinstance(jobs, list) else []


def persistence_and_runs(directory: Path) -> None:
    queue = directory / "jobs.json"
    environment = {**os.environ, "CUE_HELPER_QUEUE_FILE": str(queue)}
    result = subprocess.run(
        ["python3", str(QUEUE_SCRIPT), "enqueue", "menu-check"],
        cwd=HERE.parents[2], env=environment, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    check("enqueue prints QUEUED", "QUEUED" in result.stdout, result.stdout)
    jobs = read_queue(queue)
    check("one PENDING job is persisted", len(jobs) == 1 and jobs[0]["state"] == "PENDING", jobs)

    keyed = subprocess.run(
        ["python3", str(QUEUE_SCRIPT), "enqueue", "menu-check",
         "--idempotency-key", "same-agent-request", "--json"],
        cwd=HERE.parents[2], env=environment, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    keyed_again = subprocess.run(
        ["python3", str(QUEUE_SCRIPT), "enqueue", "menu-check",
         "--idempotency-key", "same-agent-request", "--json"],
        cwd=HERE.parents[2], env=environment, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    check("an idempotency key creates its job once",
          json.loads(keyed.stdout)["created"] is True and json.loads(keyed_again.stdout)["created"] is False
          and len(read_queue(queue)) == 2, (keyed.stdout, keyed_again.stdout))

    command = MODULE.job_command(jobs[0])
    check("a menu check waits for the menu", command[-4:] == ["--screen", "menu", "--wait", "30"], command)
    check("no job command inputs, taps or HID", all(part not in ("input", "tap", "hid") for part in command), command)

    hold = subprocess.run(
        ["python3", str(QUEUE_SCRIPT), "run"],
        cwd=HERE.parents[2], env={**environment, "ANDROID_SERIAL": "missing-device"},
        check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    check("an absent device holds the queue (75)",
          hold.returncode == 75 and "QUEUE HOLD reason=device-unavailable" in hold.stdout,
          (hold.returncode, hold.stdout))

    with MODULE.QueueRunnerLock(queue):
        try:
            with MODULE.QueueRunnerLock(queue):
                check("a second queue runner cannot take the lease", False, "it acquired the lease")
        except MODULE.QueueRunnerBusy:
            check("a second queue runner cannot take the lease", True)

    child_code = """
import importlib.util
import sys
import signal
from pathlib import Path

spec = importlib.util.spec_from_file_location('companion_queue', sys.argv[1])
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with module.QueueRunnerLock(Path(sys.argv[2])):
    print('child-runner-lease-acquired', flush=True)
    signal.pause()
"""
    child = subprocess.Popen(
        [sys.executable, "-c", child_code, str(QUEUE_SCRIPT), str(queue)],
        env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = child.stdout.readline().strip() if child.stdout is not None else ""
        check("another process holds the runner lease", line == "child-runner-lease-acquired", line)
        restore_env = queue_file_env(queue)
        try:
            check("a run while another runner holds the lease holds (75)", MODULE.run_queue(0.0, 0.1) == 75)
        finally:
            restore_env()
    finally:
        child.terminate()
        child.wait(timeout=5)
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
    with MODULE.QueueRunnerLock(queue):
        check("the lease is free once its holder exits", True)

    restore = patched({"run_adb": lambda serial, *args, **kwargs: (
        (0, "mWakefulness=Awake") if args == ("shell", "dumpsys", "power") else (0, "isKeyguardShowing=true"))})
    try:
        check("a locked device is not ready", MODULE.device_ready("fixture-locked") == (False, "device-locked"))
        setattr(MODULE, "run_adb", lambda serial, *args, **kwargs: (
            (0, "mWakefulness=Dozing") if args == ("shell", "dumpsys", "power") else (0, "")))
        check("a dozing device is not ready", MODULE.device_ready("fixture-asleep") == (False, "device-not-awake"))
    finally:
        restore()

    hold_script = directory / "hold-setup.sh"
    hold_script.write_text("#!/bin/sh\necho 'SETUP HOLD reason=target-not-night'\nexit 75\n", encoding="utf-8")
    hold_script.chmod(0o755)
    hold_job = MODULE.make_job("night-check", "night", False, False)
    restore_env = queue_file_env(queue)
    restore = patched({"HELPER_SETUP": hold_script})
    try:
        queue.write_text(json.dumps([hold_job]) + "\n", encoding="utf-8")
        check("a setup hold returns its reason", MODULE.execute(hold_job, "fixture-device") == "target-not-night")
        held_jobs = read_queue(queue)
        check("a held job stays PENDING with its hold",
              held_jobs[0]["state"] == "PENDING" and "target-not-night" in str(held_jobs[0]["lastHold"]), held_jobs)
    finally:
        restore()
        restore_env()

    # The overnight window drains one job per call (--max-jobs 1), notes the
    # jobs it leaves PENDING, and returns a job it had to kill to PENDING.
    done_script = directory / "done-setup.sh"
    done_script.write_text("#!/bin/sh\necho 'SETUP PASS fixture'\nexit 0\n", encoding="utf-8")
    done_script.chmod(0o755)
    first = MODULE.make_job("menu-check", "menu", False, False)
    second = MODULE.make_job("menu-check", "menu", False, False)
    restore_env = queue_file_env(queue)
    restore = patched({"HELPER_SETUP": done_script, "select_device": lambda: ("fixture-device", None),
                       "device_ready": lambda serial: (True, None)})
    try:
        queue.write_text(json.dumps([first, second]) + "\n", encoding="utf-8")
        check("--max-jobs 1 runs one job", MODULE.run_queue(0.0, 0.1, 1) == 0)
        states = [job["state"] for job in read_queue(queue)]
        check("one job DONE, the next left PENDING", states == ["DONE", "PENDING"], states)
        noted = MODULE.note_pending({"windowId": "window-fixture", "outcome": "LOCKED"})
        jobs = read_queue(queue)
        check("the window notes only the job it leaves PENDING",
              noted == [second["id"]] and "windowNote" not in jobs[0]
              and jobs[1]["windowNote"] == {"windowId": "window-fixture", "outcome": "LOCKED"}, (noted, jobs))
        jobs[1]["state"] = "RUNNING"
        queue.write_text(json.dumps(jobs) + "\n", encoding="utf-8")
        with MODULE.QueueRunnerLock(queue):
            check("a live runner's job is never released", MODULE.release_running("window deadline") == [])
        check("a stopped runner's job is released", MODULE.release_running("window deadline") == [second["id"]])
        jobs = read_queue(queue)
        check("a released job is PENDING with the reason",
              jobs[1]["state"] == "PENDING" and jobs[1]["lastHold"] == "window deadline", jobs[1])
    finally:
        restore()
        restore_env()


def cancel(directory: Path) -> None:
    """cancel retires PENDING jobs and keeps their records; a RUNNING job or an unknown id refuses the whole call."""
    queue = directory / "jobs.json"
    environment = {**os.environ, "CUE_HELPER_QUEUE_FILE": str(queue)}

    def cli(*args: str, check_exit: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["python3", str(QUEUE_SCRIPT), *args], cwd=HERE.parents[2], env=environment,
                              check=check_exit, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    cli("enqueue", "menu-check")
    cli("enqueue", "night-check", "--screen", "night")
    cli("enqueue", "menu-check")
    jobs = read_queue(queue)
    jobs[2]["state"] = "RUNNING"
    queue.write_text(json.dumps(jobs) + "\n", encoding="utf-8")
    refused = cli("cancel", str(jobs[0]["id"]), str(jobs[2]["id"]), "--reason", "stale", check_exit=False)
    check("cancel refuses a RUNNING job", refused.returncode == 2 and "only a PENDING job" in refused.stderr,
          refused.stderr)
    check("a refused cancel changes nothing",
          [j["state"] for j in read_queue(queue)] == ["PENDING", "PENDING", "RUNNING"])
    check("cancel refuses an unknown id",
          cli("cancel", "cue-0-missing", "--reason", "stale", check_exit=False).returncode == 2)
    check("cancel refuses without --reason", cli("cancel", str(jobs[0]["id"]), check_exit=False).returncode == 2)
    done = cli("cancel", str(jobs[0]["id"]), str(jobs[1]["id"]), "--reason", "stale since an earlier session")
    check("cancel retires each PENDING job named", done.stdout.count("CANCELLED id=") == 2, done.stdout)
    after = read_queue(queue)
    check("cancelled jobs keep their records",
          [j["state"] for j in after] == ["CANCELLED", "CANCELLED", "RUNNING"] and len(after) == 3, after)
    check("a cancelled job carries its reason and time",
          after[0]["cancelReason"] == "stale since an earlier session" and bool(after[0]["cancelledAt"]), after[0])
    check("a cancelled job cannot be claimed", MODULE.claimable(after[0], True) is False)


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="companion-queue-test-") as directory:
        persistence_and_runs(Path(directory))
    with tempfile.TemporaryDirectory(prefix="companion-queue-cancel-") as directory:
        cancel(Path(directory))
    if failures:
        print("companion queue FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print(f"Companion queue persistence, closed vocabulary, absent-device hold, one-job runs, "
          f"window notes, killed-job release and cancel passed ({passed} checks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
