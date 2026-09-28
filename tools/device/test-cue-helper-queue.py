#!/usr/bin/env python3
"""No-device contract tests for the safe Cue Helper queue."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("cue_helper_queue", HERE / "cue-helper-queue.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


with tempfile.TemporaryDirectory(prefix="cue-helper-queue-test-") as directory:
    queue = Path(directory) / "jobs.json"
    environment = {**os.environ, "CUE_HELPER_QUEUE_FILE": str(queue)}
    result = subprocess.run(
        ["python3", str(HERE / "cue-helper-queue.py"), "enqueue", "menu-check"],
        cwd=HERE.parents[1], env=environment, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert "QUEUED" in result.stdout
    jobs = json.loads(queue.read_text(encoding="utf-8"))
    assert len(jobs) == 1 and jobs[0]["state"] == "PENDING"

    keyed = subprocess.run(
        ["python3", str(HERE / "cue-helper-queue.py"), "enqueue", "menu-check",
         "--idempotency-key", "same-agent-request", "--json"],
        cwd=HERE.parents[1], env=environment, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    keyed_again = subprocess.run(
        ["python3", str(HERE / "cue-helper-queue.py"), "enqueue", "menu-check",
         "--idempotency-key", "same-agent-request", "--json"],
        cwd=HERE.parents[1], env=environment, check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert json.loads(keyed.stdout)["created"] is True
    assert json.loads(keyed_again.stdout)["created"] is False
    assert len(json.loads(queue.read_text(encoding="utf-8"))) == 2

    assert MODULE.job_command(jobs[0])[-4:] == ["--screen", "menu", "--wait", "30"]
    assert all(part not in ("input", "tap", "hid") for part in MODULE.job_command(jobs[0]))

    hold = subprocess.run(
        ["python3", str(HERE / "cue-helper-queue.py"), "run"],
        cwd=HERE.parents[1], env={**environment, "ANDROID_SERIAL": "missing-device"},
        check=False, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert hold.returncode == 75
    assert "QUEUE HOLD reason=device-unavailable" in hold.stdout

    with MODULE.QueueRunnerLock(queue):
        try:
            with MODULE.QueueRunnerLock(queue):
                raise AssertionError("a second queue runner unexpectedly acquired the lease")
        except MODULE.QueueRunnerBusy:
            pass

    child_code = """
import importlib.util
import sys
import signal
from pathlib import Path

spec = importlib.util.spec_from_file_location('cue_helper_queue', sys.argv[1])
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with module.QueueRunnerLock(Path(sys.argv[2])):
    print('child-runner-lease-acquired', flush=True)
    signal.pause()
"""
    child = subprocess.Popen(
        [sys.executable, "-c", child_code, str(HERE / "cue-helper-queue.py"),
         str(queue)],
        env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        assert child.stdout is not None
        assert child.stdout.readline().strip() == "child-runner-lease-acquired"
        previous_queue = os.environ.get("CUE_HELPER_QUEUE_FILE")
        os.environ["CUE_HELPER_QUEUE_FILE"] = str(queue)
        try:
            assert MODULE.run_queue(0.0, 0.1) == 75
        finally:
            if previous_queue is None:
                os.environ.pop("CUE_HELPER_QUEUE_FILE", None)
            else:
                os.environ["CUE_HELPER_QUEUE_FILE"] = previous_queue
    finally:
        child.terminate()
        child.wait(timeout=5)
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
    with MODULE.QueueRunnerLock(queue):
        pass

    original_run_adb = MODULE.run_adb
    try:
        MODULE.run_adb = lambda serial, *args, **kwargs: (
            (0, "mWakefulness=Awake") if args == ("shell", "dumpsys", "power") else
            (0, "isKeyguardShowing=true")
        )
        ready, reason = MODULE.device_ready("fixture-locked")
        assert ready is False and reason == "device-locked"

        MODULE.run_adb = lambda serial, *args, **kwargs: (
            (0, "mWakefulness=Dozing") if args == ("shell", "dumpsys", "power") else
            (0, "")
        )
        ready, reason = MODULE.device_ready("fixture-asleep")
        assert ready is False and reason == "device-not-awake"
    finally:
        MODULE.run_adb = original_run_adb

    hold_script = Path(directory) / "hold-setup.sh"
    hold_script.write_text(
        "#!/bin/sh\necho 'SETUP HOLD reason=target-not-night'\nexit 75\n",
        encoding="utf-8")
    hold_script.chmod(0o755)
    hold_job = MODULE.make_job("night-check", "night", False, False)
    previous_queue = os.environ.get("CUE_HELPER_QUEUE_FILE")
    previous_setup = MODULE.HELPER_SETUP
    os.environ["CUE_HELPER_QUEUE_FILE"] = str(queue)
    MODULE.HELPER_SETUP = hold_script
    try:
        queue.write_text(json.dumps([hold_job]) + "\n", encoding="utf-8")
        assert MODULE.execute(hold_job, "fixture-device") == "target-not-night"
        held_jobs = json.loads(queue.read_text(encoding="utf-8"))
        assert held_jobs[0]["state"] == "PENDING"
        assert "target-not-night" in held_jobs[0]["lastHold"]
    finally:
        MODULE.HELPER_SETUP = previous_setup
        if previous_queue is None:
            os.environ.pop("CUE_HELPER_QUEUE_FILE", None)
        else:
            os.environ["CUE_HELPER_QUEUE_FILE"] = previous_queue

    # The overnight window drains one job per call (--max-jobs 1), notes the
    # jobs it leaves PENDING, and returns a job it had to kill to PENDING.
    done_script = Path(directory) / "done-setup.sh"
    done_script.write_text("#!/bin/sh\necho 'SETUP PASS fixture'\nexit 0\n", encoding="utf-8")
    done_script.chmod(0o755)
    first = MODULE.make_job("menu-check", "menu", False, False)
    second = MODULE.make_job("menu-check", "menu", False, False)
    previous_queue = os.environ.get("CUE_HELPER_QUEUE_FILE")
    previous = (MODULE.HELPER_SETUP, MODULE.select_device, MODULE.device_ready)
    os.environ["CUE_HELPER_QUEUE_FILE"] = str(queue)
    MODULE.HELPER_SETUP = done_script
    MODULE.select_device = lambda: ("fixture-device", None)
    MODULE.device_ready = lambda serial: (True, None)
    try:
        queue.write_text(json.dumps([first, second]) + "\n", encoding="utf-8")
        assert MODULE.run_queue(0.0, 0.1, 1) == 0
        states = [job["state"] for job in json.loads(queue.read_text(encoding="utf-8"))]
        assert states == ["DONE", "PENDING"], states
        noted = MODULE.note_pending({"windowId": "window-fixture", "outcome": "LOCKED"})
        jobs = json.loads(queue.read_text(encoding="utf-8"))
        assert noted == [second["id"]] and "windowNote" not in jobs[0]
        assert jobs[1]["windowNote"] == {"windowId": "window-fixture", "outcome": "LOCKED"}
        jobs[1]["state"] = "RUNNING"
        queue.write_text(json.dumps(jobs) + "\n", encoding="utf-8")
        with MODULE.QueueRunnerLock(queue):
            assert MODULE.release_running("window deadline") == [], "released a live runner's job"
        assert MODULE.release_running("window deadline") == [second["id"]]
        jobs = json.loads(queue.read_text(encoding="utf-8"))
        assert jobs[1]["state"] == "PENDING" and jobs[1]["lastHold"] == "window deadline"
    finally:
        MODULE.HELPER_SETUP, MODULE.select_device, MODULE.device_ready = previous
        if previous_queue is None:
            os.environ.pop("CUE_HELPER_QUEUE_FILE", None)
        else:
            os.environ["CUE_HELPER_QUEUE_FILE"] = previous_queue

# cancel retires PENDING jobs and keeps their records; a RUNNING job or an unknown id refuses the whole call.
with tempfile.TemporaryDirectory(prefix="cue-helper-queue-cancel-") as directory:
    queue = Path(directory) / "jobs.json"
    environment = {**os.environ, "CUE_HELPER_QUEUE_FILE": str(queue)}
    def cli(*args, check=True):
        return subprocess.run(["python3", str(HERE / "cue-helper-queue.py"), *args], cwd=HERE.parents[1],
                              env=environment, check=check, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    cli("enqueue", "menu-check"); cli("enqueue", "night-check", "--screen", "night"); cli("enqueue", "menu-check")
    jobs = json.loads(queue.read_text(encoding="utf-8"))
    jobs[2]["state"] = "RUNNING"
    queue.write_text(json.dumps(jobs) + "\n", encoding="utf-8")
    refused = cli("cancel", jobs[0]["id"], jobs[2]["id"], "--reason", "stale", check=False)
    assert refused.returncode == 2 and "only a PENDING job" in refused.stderr, refused.stderr
    assert [j["state"] for j in json.loads(queue.read_text(encoding="utf-8"))] == ["PENDING", "PENDING", "RUNNING"]
    assert cli("cancel", "cue-0-missing", "--reason", "stale", check=False).returncode == 2
    assert cli("cancel", jobs[0]["id"], check=False).returncode == 2, "a cancel without --reason ran"
    done = cli("cancel", jobs[0]["id"], jobs[1]["id"], "--reason", "stale since an earlier session")
    assert done.stdout.count("CANCELLED id=") == 2
    after = json.loads(queue.read_text(encoding="utf-8"))
    assert [j["state"] for j in after] == ["CANCELLED", "CANCELLED", "RUNNING"] and len(after) == 3
    assert after[0]["cancelReason"] == "stale since an earlier session" and after[0]["cancelledAt"]
    assert MODULE.claimable(after[0], True) is False, "a cancelled job can still be claimed"

print("cue-helper queue persistence, closed vocabulary, absent-device hold, one-job runs, "
      "window notes, killed-job release and cancel passed")
