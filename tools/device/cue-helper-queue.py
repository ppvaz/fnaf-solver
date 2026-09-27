#!/usr/bin/env python3
"""Queue safe Cue Helper setup/check jobs across device absence or lock state.

The queue is intentionally a closed vocabulary. It can defer observation setup
and screen checks, but it cannot hold shell text, coordinates, HID events, or
game-control actions. A runner executes jobs only after it sees exactly one
ready ADB device, an awake display, and no visible keyguard.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_QUEUE = ROOT / "captures/cue-helper/queued-jobs.json"
HELPER_SETUP = ROOT / "tools/device/cue-helper-setup.sh"
# One job's hard ceiling. The overnight window (overnight-window.py) starts a
# job only when this much time remains before its own deadline.
JOB_TIMEOUT_S = 360.0
DEVICE_REASONS = {
    "absent": "device-unavailable",
    "locked": "device-locked",
    "asleep": "device-not-awake",
    "ambiguous": "multiple-devices",
}


class QueueError(RuntimeError):
    pass


class QueueRunnerBusy(RuntimeError):
    pass


def queue_path() -> Path:
    return Path(os.environ.get("CUE_HELPER_QUEUE_FILE", str(DEFAULT_QUEUE)))


def now_text() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_jobs(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise QueueError(f"queue is unreadable: {path}: {error}") from error
    if not isinstance(value, list) or any(not isinstance(job, dict) for job in value):
        raise QueueError(f"queue has invalid shape: {path}")
    return value


def write_jobs(path: Path, jobs: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(jobs, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


class QueueFile:
    def __init__(self, path: Path):
        self.path = path
        self.lock_path = Path(f"{path}.lock")
        self.handle = None

    def __enter__(self):
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.lock_path.open("a+", encoding="utf-8")
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
        return self

    def __exit__(self, *_):
        if self.handle is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()


class QueueRunnerLock:
    """Serialize queue drainers; enqueue/list still use the ordinary queue lock."""

    def __init__(self, path: Path):
        self.path = Path(f"{path}.runner.lock")
        self.handle = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.handle.close()
            self.handle = None
            raise QueueRunnerBusy("another queue runner owns this queue") from error
        return self

    def __exit__(self, *_):
        if self.handle is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()
            self.handle = None


def normalize_job_kind(kind: str) -> tuple[str, str]:
    if kind == "menu-check":
        return "menu-check", "menu"
    if kind == "night-check":
        return "night-check", "night"
    if kind == "setup":
        return "setup", "menu"
    raise QueueError(f"unsupported safe job kind: {kind}")


def make_job(kind: str, screen: str, install: bool, probe: bool,
             idempotency_key: str | None = None) -> dict:
    normalized, default_screen = normalize_job_kind(kind)
    if screen not in ("menu", "night"):
        raise QueueError("screen must be menu or night")
    if normalized != "setup" and (install or probe):
        raise QueueError("install/probe options are available only for setup jobs")
    if normalized == "menu-check" and screen != "menu":
        raise QueueError("menu-check must target menu")
    if normalized == "night-check" and screen != "night":
        raise QueueError("night-check must target night")
    if normalized == "setup" and screen == "menu" and default_screen != screen:
        raise QueueError("invalid setup screen")
    job = {
        "id": f"cue-{int(time.time())}-{uuid.uuid4().hex[:8]}",
        "kind": normalized,
        "screen": screen,
        "install": bool(install),
        "probe": bool(probe),
        "state": "PENDING",
        "attempts": 0,
        "createdAt": now_text(),
    }
    if idempotency_key is not None:
        if not idempotency_key or len(idempotency_key) > 128:
            raise QueueError("idempotency key must be 1..128 characters")
        job["idempotencyKey"] = idempotency_key
    return job


def enqueue(job: dict, json_output: bool = False) -> None:
    path = queue_path()
    created = True
    with QueueFile(path):
        jobs = read_jobs(path)
        key = job.get("idempotencyKey")
        existing = next((item for item in jobs
                         if key is not None and item.get("idempotencyKey") == key), None)
        if existing is not None:
            job = existing
            created = False
        else:
            jobs.append(job)
            write_jobs(path, jobs)
    if json_output:
        print(json.dumps({"created": created, "job": job}, sort_keys=True))
    else:
        verb = "QUEUED" if created else "EXISTING"
        print(f"{verb} id={job['id']} kind={job['kind']} screen={job['screen']}")


def print_jobs(jobs: list[dict]) -> None:
    if not jobs:
        print("QUEUE EMPTY")
        return
    for job in jobs:
        extra = []
        if job.get("install"):
            extra.append("install=1")
        if job.get("probe"):
            extra.append("probe=1")
        suffix = " " + " ".join(extra) if extra else ""
        print(f"{job.get('id', '?')} state={job.get('state', '?')} "
              f"kind={job.get('kind', '?')} screen={job.get('screen', '?')} "
              f"attempts={job.get('attempts', 0)}{suffix}")


def run_adb(serial: str | None, *args: str, timeout: float = 10.0) -> tuple[int, str]:
    command = ["adb"]
    if serial:
        command += ["-s", serial]
    command += list(args)
    try:
        result = subprocess.run(command, cwd=ROOT, check=False, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as error:
        return 1, str(error)
    return result.returncode, (result.stdout + result.stderr).replace("\r", "")


def select_device() -> tuple[str | None, str | None]:
    explicit = os.environ.get("ANDROID_SERIAL", "")
    if explicit:
        code, output = run_adb(explicit, "get-state", timeout=5.0)
        return (explicit, None) if code == 0 and output.strip() == "device" \
            else (None, DEVICE_REASONS["absent"])
    code, output = run_adb(None, "devices", "-l", timeout=5.0)
    if code != 0:
        return None, DEVICE_REASONS["absent"]
    usb = []
    wireless = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) < 2 or fields[1] != "device":
            continue
        serial = fields[0]
        if any(field.startswith("usb:") for field in fields[2:]):
            usb.append(serial)
        else:
            wireless.append(serial)
    candidates = usb or wireless
    if not candidates:
        return None, DEVICE_REASONS["absent"]
    if len(candidates) != 1:
        return None, DEVICE_REASONS["ambiguous"]
    return candidates[0], None


def device_ready(serial: str) -> tuple[bool, str | None]:
    code, power = run_adb(serial, "shell", "dumpsys", "power")
    if code != 0:
        return False, DEVICE_REASONS["absent"]
    if "mWakefulness=Awake" not in power:
        return False, DEVICE_REASONS["asleep"]
    code, windows = run_adb(serial, "shell", "dumpsys", "window", "policy")
    if code != 0:
        return False, DEVICE_REASONS["absent"]
    locked_patterns = (
        r"isKeyguardShowing\s*=\s*true",
        r"mShowingLockscreen\s*=\s*true",
        r"mKeyguardShowing\s*=\s*true",
        r"mDreamingLockscreen\s*=\s*true",
    )
    if any(re.search(pattern, windows) for pattern in locked_patterns):
        return False, DEVICE_REASONS["locked"]
    return True, None


def job_command(job: dict) -> list[str]:
    kind = job.get("kind")
    if kind not in ("setup", "menu-check", "night-check"):
        raise QueueError(f"queue refuses unknown job kind: {kind}")
    command = [str(HELPER_SETUP)]
    if kind == "setup" and job.get("install"):
        command.append("--install")
    if kind == "setup" and job.get("probe"):
        command.append("--probe")
    command += ["--screen", job.get("screen", "menu"), "--wait", "30"]
    return command


def claim_next() -> dict | None:
    path = queue_path()
    with QueueFile(path):
        jobs = read_jobs(path)
        # A killed runner cannot leave a job permanently RUNNING.
        changed = False
        for job in jobs:
            if job.get("state") == "RUNNING":
                job["state"] = "PENDING"
                job["lastError"] = "runner-restarted"
                changed = True
        pending = next((job for job in jobs if job.get("state") == "PENDING"), None)
        if pending is None:
            if changed:
                write_jobs(path, jobs)
            return None
        pending["state"] = "RUNNING"
        pending["attempts"] = int(pending.get("attempts", 0)) + 1
        pending["startedAt"] = now_text()
        write_jobs(path, jobs)
        return dict(pending)


def finish(job_id: str, state: str, output: str = "") -> None:
    path = queue_path()
    with QueueFile(path):
        jobs = read_jobs(path)
        for job in jobs:
            if job.get("id") == job_id:
                job["state"] = state
                if state == "PENDING":
                    job.pop("startedAt", None)
                    job["lastHold"] = output[-2000:] if output else "runner-released"
                else:
                    job["finishedAt"] = now_text()
                if output:
                    job["result"] = output[-2000:]
                break
        else:
            raise QueueError(f"queued job disappeared: {job_id}")
        write_jobs(path, jobs)


def note_pending(note: dict) -> list[str]:
    """Attach a window's note to every job it left PENDING.

    The overnight window ends LOCKED, IN_USE or at its deadline with jobs still
    queued; `list` then says which window saw them and why it stopped.
    """
    path = queue_path()
    with QueueFile(path):
        jobs = read_jobs(path)
        noted = []
        for job in jobs:
            if job.get("state") == "PENDING":
                job["windowNote"] = dict(note)
                noted.append(str(job.get("id")))
        if noted:
            write_jobs(path, jobs)
    return noted


def release_running(reason: str) -> list[str]:
    """Return RUNNING jobs to PENDING after their runner was stopped.

    Only while no runner owns the queue: a live runner's RUNNING job is its
    own. `claim_next` does the same on the next run; this names the reason.
    """
    try:
        with QueueRunnerLock(queue_path()):
            path = queue_path()
            with QueueFile(path):
                jobs = read_jobs(path)
                released = []
                for job in jobs:
                    if job.get("state") == "RUNNING":
                        job["state"] = "PENDING"
                        job.pop("startedAt", None)
                        job["lastHold"] = reason[-2000:]
                        released.append(str(job.get("id")))
                if released:
                    write_jobs(path, jobs)
                return released
    except QueueRunnerBusy:
        return []


def execute(job: dict, serial: str) -> bool | str:
    env = os.environ.copy()
    env["ANDROID_SERIAL"] = serial
    command = job_command(job)
    print(f"RUNNING id={job['id']} kind={job['kind']} screen={job['screen']}")
    try:
        result = subprocess.run(command, cwd=ROOT, env=env, check=False,
                                text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=JOB_TIMEOUT_S)
    except subprocess.TimeoutExpired as error:
        output = (error.stdout or "") if isinstance(error.stdout, str) else ""
        finish(job["id"], "FAILED", f"timeout\n{output}")
        print(f"FAILED id={job['id']} reason=timeout", file=sys.stderr)
        return False
    output = result.stdout or ""
    if output:
        print(output, end="" if output.endswith("\n") else "\n")
    hold = re.search(r"SETUP HOLD reason=([a-z0-9-]+)", output)
    if hold is not None:
        reason = hold.group(1)
        finish(job["id"], "PENDING", f"exit={result.returncode}\n{output}")
        print(f"QUEUE HOLD reason={reason} serial={serial}")
        return reason
    if result.returncode == 0:
        finish(job["id"], "DONE", output)
        print(f"DONE id={job['id']}")
        return True
    finish(job["id"], "FAILED", f"exit={result.returncode}\n{output}")
    print(f"FAILED id={job['id']} exit={result.returncode}", file=sys.stderr)
    return False


def run_queue_once(deadline: float | None, interval: float, max_jobs: int = 0) -> int:
    done = 0
    while True:
        serial, reason = select_device()
        if serial is None:
            if deadline is None or time.monotonic() >= deadline:
                print(f"QUEUE HOLD reason={reason}")
                return 75
            print(f"QUEUE WAIT reason={reason}")
            time.sleep(interval)
            continue
        ready, reason = device_ready(serial)
        if not ready:
            if deadline is None or time.monotonic() >= deadline:
                print(f"QUEUE HOLD reason={reason} serial={serial}")
                return 75
            print(f"QUEUE WAIT reason={reason} serial={serial}")
            time.sleep(interval)
            continue
        job = claim_next()
        if job is None:
            print("QUEUE EMPTY")
            return 0
        outcome = execute(job, serial)
        if isinstance(outcome, str):
            if deadline is None or time.monotonic() >= deadline:
                return 75
            print(f"QUEUE WAIT reason={outcome} serial={serial}")
            time.sleep(interval)
            continue
        if not outcome:
            return 1
        done += 1
        if max_jobs and done >= max_jobs:
            # The overnight window runs one job per call so that it can check
            # the phone (lock, use, battery) between jobs.
            print(f"QUEUE PAUSED done={done}")
            return 0


def run_queue(wait_seconds: float, interval: float, max_jobs: int = 0) -> int:
    deadline = time.monotonic() + wait_seconds if wait_seconds else None
    while True:
        try:
            with QueueRunnerLock(queue_path()):
                return run_queue_once(deadline, interval, max_jobs)
        except QueueRunnerBusy:
            if deadline is None or time.monotonic() >= deadline:
                print("QUEUE HOLD reason=queue-runner-busy")
                return 75
            print("QUEUE WAIT reason=queue-runner-busy")
            time.sleep(interval)


def main() -> int:
    parser = argparse.ArgumentParser(description="Queue safe Cue Helper setup/check jobs")
    sub = parser.add_subparsers(dest="command", required=True)
    add = sub.add_parser("enqueue", help="append a safe deferred job")
    add.add_argument("kind", choices=("setup", "menu-check", "night-check"))
    add.add_argument("--screen", choices=("menu", "night"), default="menu")
    add.add_argument("--install", action="store_true")
    add.add_argument("--probe", action="store_true")
    add.add_argument("--idempotency-key", default=None)
    add.add_argument("--json", action="store_true", help="emit the queued job as structured JSON")
    list_parser = sub.add_parser("list", help="show queued jobs")
    list_parser.add_argument("--json", action="store_true", help="emit structured JSON")
    run = sub.add_parser("run", help="run pending jobs when device is ready")
    run.add_argument("--wait", type=float, default=0.0,
                     help="wait for a ready device for this many seconds")
    run.add_argument("--interval", type=float, default=5.0,
                     help="poll interval while waiting")
    run.add_argument("--max-jobs", type=int, default=0,
                     help="stop after this many DONE jobs (0: drain the queue)")
    args = parser.parse_args()
    try:
        if args.command == "enqueue":
            enqueue(make_job(args.kind, args.screen, args.install, args.probe,
                             args.idempotency_key), args.json)
            return 0
        if args.command == "list":
            jobs = read_jobs(queue_path())
            if args.json:
                print(json.dumps({"jobs": jobs}, sort_keys=True))
            else:
                print_jobs(jobs)
            return 0
        if args.wait < 0 or args.wait > 86400 or args.interval <= 0 or args.interval > 300:
            raise QueueError("wait must be 0..86400 and interval must be 0..300")
        if args.max_jobs < 0 or args.max_jobs > 1000:
            raise QueueError("max-jobs must be 0..1000")
        return run_queue(args.wait, args.interval, args.max_jobs)
    except QueueError as error:
        print(f"QUEUE ERROR {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
