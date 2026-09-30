#!/usr/bin/env python3
"""Queue Companion jobs across device absence or lock state.

The queue is intentionally a closed vocabulary. It can defer observation setup
and screen checks, and -- since Pedro's "Yes, play nights" (2026-09-27) -- one
night of a COMMITTED winner file (`night`, validated by night_jobs.py and run
by night-job.py). It cannot hold shell text, coordinates, HID events, timings
or any other game-control action. A runner executes jobs only after it sees
exactly one ready ADB device, an awake display, and no visible keyguard, and
it claims a night job only when the overnight window asks it to (`--nights`):
`cue.queue.run` from an agent never plays a night.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "packages/play/src/safety"))  # the serial lease: Play's
import night_jobs  # noqa: E402
from companion_device_lock import state_dir  # noqa: E402

ROOT = HERE.parents[1]
# One queue for every checkout: the main checkout's captures (state_dir()).
DEFAULT_QUEUE = state_dir() / "queued-jobs.json"
HELPER_SETUP = ROOT / "tools/device/companion-setup.sh"
NIGHT_JOB_COMMAND = [sys.executable, str(HERE / "night-job.py")]
# A setup or check job's hard ceiling. A night job carries its own (budgetS).
# The overnight window (overnight-window.py) starts a job only when its
# ceiling fits before the window's own deadline.
JOB_TIMEOUT_S = 360.0
# A job that outlives its ceiling: SIGINT, then SIGTERM, then SIGKILL to its
# whole process tree, each after this grace.
JOB_STOP_GRACE_S = 120.0
JOB_TERM_GRACE_S = 20.0
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


def make_night_job(game: str, winner: str, night: int, label: str | None = None, audio: bool = False,
                   idempotency_key: str | None = None) -> dict:
    """One night of a committed winner. Validated now (custody, schema, night,
    a fresh emit for FNaF 2) so a bad job is refused while its author is here,
    and bound by hash: the night job refuses at run time if any of it moved."""
    job_id = f"cue-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    label = label or f"q-{job_id[-8:]}"
    try:
        loaded = night_jobs.validate(game, winner, night, label, audio)
        binding = night_jobs.resolve_binding(game, winner, loaded, night, None)
    except night_jobs.NightJobError as error:
        raise QueueError(str(error)) from error
    job = {
        "id": job_id,
        "kind": "night",
        "game": game,
        "winner": winner,
        "night": night,
        "label": label,
        "audio": bool(audio),
        "winnerSha256": binding["winnerSha256"],
        "planSha256": binding.get("planSha256"),
        "nightMs": binding["nightMs"],
        "budgetS": night_jobs.budget_s(binding["nightMs"]),
        "state": "PENDING",
        "attempts": 0,
        "createdAt": now_text(),
    }
    if idempotency_key is not None:
        if not idempotency_key or len(idempotency_key) > 128:
            raise QueueError("idempotency key must be 1..128 characters")
        job["idempotencyKey"] = idempotency_key
    return job


def job_timeout_s(job: dict) -> float:
    """The job's own ceiling: the window starts it only if this fits."""
    if job.get("kind") == "night":
        budget = job.get("budgetS")
        if not isinstance(budget, (int, float)) or budget <= 0:
            raise QueueError(f"night job {job.get('id')} has no budget")
        return float(budget)
    return JOB_TIMEOUT_S


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
    elif job["kind"] == "night":
        verb = "QUEUED" if created else "EXISTING"
        print(f"{verb} id={job['id']} kind=night game={job['game']} night={job['night']} "
              f"winner={job['winner']} budget={int(job['budgetS'])}s")
    else:
        verb = "QUEUED" if created else "EXISTING"
        print(f"{verb} id={job['id']} kind={job['kind']} screen={job['screen']}")


def print_jobs(jobs: list[dict]) -> None:
    if not jobs:
        print("QUEUE EMPTY")
        return
    for job in jobs:
        if job.get("kind") == "night":
            note = job.get("windowNote") or {}
            print(f"{job.get('id', '?')} state={job.get('state', '?')} kind=night game={job.get('game')} "
                  f"night={job.get('night')} winner={job.get('winner')} budget={int(job.get('budgetS', 0))}s "
                  f"attempts={job.get('attempts', 0)}"
                  + (f" window={note.get('outcome')}" if note else ""))
            continue
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
    if kind == "night":
        # Every field is re-validated by night-job.py against night_jobs.py
        # before anything touches the phone; nothing here is shell text.
        command = [*NIGHT_JOB_COMMAND, "run", "--job-id", str(job["id"]), "--game", str(job["game"]),
                   "--winner", str(job["winner"]), "--night", str(int(job["night"])),
                   "--label", str(job["label"]), "--winner-sha256", str(job["winnerSha256"]),
                   "--plan-sha256", str(job.get("planSha256") or "none"),
                   "--budget-s", f"{job_timeout_s(job):.1f}"]
        if job.get("audio"):
            command.append("--audio")
        return command
    if kind not in ("setup", "menu-check", "night-check"):
        raise QueueError(f"queue refuses unknown job kind: {kind}")
    command = [str(HELPER_SETUP)]
    if kind == "setup" and job.get("install"):
        command.append("--install")
    if kind == "setup" and job.get("probe"):
        command.append("--probe")
    command += ["--screen", job.get("screen", "menu"), "--wait", "30"]
    return command


def claimable(job: dict, allow_nights: bool) -> bool:
    return job.get("state") == "PENDING" and (allow_nights or job.get("kind") != "night")


def claim_next(allow_nights: bool = False) -> dict | None:
    path = queue_path()
    with QueueFile(path):
        jobs = read_jobs(path)
        # A killed runner cannot leave a job permanently RUNNING. A night it
        # killed was started: that is a record to read, never a replay.
        changed = False
        for job in jobs:
            if job.get("state") == "RUNNING":
                stale_release(job, "runner-restarted")
                changed = True
        pending = next((job for job in jobs if claimable(job, allow_nights)), None)
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


def cancel(job_ids: list[str], reason: str) -> list[str]:
    """Retire PENDING jobs by id, keeping each record (state CANCELLED, when and why). A job that is not
    PENDING, or an id the queue does not hold, refuses the whole call and changes nothing."""
    if not reason.strip():
        raise QueueError("cancel needs a --reason")
    path = queue_path()
    with QueueFile(path):
        jobs = read_jobs(path)
        by_id = {job.get("id"): job for job in jobs}
        for job_id in job_ids:
            job = by_id.get(job_id)
            if job is None:
                raise QueueError(f"no queued job {job_id}")
            if job.get("state") != "PENDING":
                raise QueueError(f"{job_id} is {job.get('state')}, only a PENDING job can be cancelled")
        for job_id in job_ids:
            by_id[job_id]["state"] = "CANCELLED"
            by_id[job_id]["cancelledAt"] = now_text()
            by_id[job_id]["cancelReason"] = reason[:500]
        write_jobs(path, jobs)
    return job_ids


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


def stale_release(job: dict, reason: str) -> None:
    """A RUNNING job whose runner is gone: a setup or check goes back to
    PENDING; a night job was started, so it ends FAILED and is not replayed."""
    if job.get("kind") == "night":
        job["state"] = "FAILED"
        job["finishedAt"] = now_text()
        job["result"] = f"stopped mid-job: {reason}"[-2000:]
    else:
        job["state"] = "PENDING"
        job.pop("startedAt", None)
        job["lastHold"] = reason[-2000:]
        job["lastError"] = reason[-2000:]


def release_running(reason: str) -> list[str]:
    """Release RUNNING jobs after their runner was stopped (see stale_release).

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
                        stale_release(job, reason)
                        released.append(str(job.get("id")))
                if released:
                    write_jobs(path, jobs)
                return released
    except QueueRunnerBusy:
        return []


def process_tree(pid: int) -> list[int]:
    """`pid` and every descendant, from /proc; just `pid` where /proc is absent."""
    children: dict[int, list[int]] = {}
    try:
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            try:
                stat = Path(f"/proc/{entry}/stat").read_text(encoding="utf-8")
            except OSError:
                continue
            # comm may hold spaces and parentheses: fields resume after the last ')'.
            ppid = int(stat.rsplit(")", 1)[1].split()[1])
            children.setdefault(ppid, []).append(int(entry))
    except OSError:
        return [pid]
    tree, frontier = [], [pid]
    while frontier:
        current = frontier.pop()
        tree.append(current)
        frontier.extend(children.get(current, []))
    return tree


def signal_tree(pid: int, signum: int) -> None:
    for member in process_tree(pid):
        try:
            os.kill(member, signum)
        except (ProcessLookupError, PermissionError):
            pass


class Interrupted:
    """Records SIGINT/SIGTERM/SIGHUP while a job runs, and never raises.

    The job is in this runner's process group, so a signal to the group (the
    overnight window's stop, an operator's Ctrl-C) reaches it directly and it
    runs its own cleanup: a night runner drives the game back to the title.
    This runner must outlive that cleanup to record its result, not die at the
    first interrupt and leave `subprocess.run` to SIGKILL the job 0.25 s later.
    """

    def __init__(self):
        self.signals: list[str] = []
        self.previous: dict = {}

    def __enter__(self):
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            try:
                self.previous[signum] = signal.signal(signum, self.note)
            except ValueError:  # not the main thread: keep the default
                pass
        return self

    def note(self, signum: int, _frame: object) -> None:
        self.signals.append(signal.Signals(signum).name)

    def __exit__(self, *_):
        for signum, handler in self.previous.items():
            signal.signal(signum, handler)


def run_job(command: list[str], env: dict, timeout_s: float) -> tuple[int, str, str | None, list[str]]:
    """Run one job to its end: (exit, output, 'timeout' or None, signals seen)."""
    with Interrupted() as interrupted:
        child = subprocess.Popen(command, cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT)
        stopped = None
        try:
            output, _ = child.communicate(timeout=timeout_s)
        except subprocess.TimeoutExpired:
            stopped, output = "timeout", ""
            for signum, grace in ((signal.SIGINT, JOB_STOP_GRACE_S), (signal.SIGTERM, JOB_TERM_GRACE_S),
                                  (signal.SIGKILL, None)):
                signal_tree(child.pid, signum)
                try:
                    more, _ = child.communicate(timeout=grace)
                    output += more or ""
                    break
                except subprocess.TimeoutExpired:
                    continue
        return child.returncode, output or "", stopped, list(interrupted.signals)


def execute(job: dict, serial: str) -> bool | str:
    env = os.environ.copy()
    env["ANDROID_SERIAL"] = serial
    command = job_command(job)
    if job["kind"] == "night":
        print(f"RUNNING id={job['id']} kind=night game={job['game']} night={job['night']} winner={job['winner']}",
              flush=True)
    else:
        print(f"RUNNING id={job['id']} kind={job['kind']} screen={job['screen']}", flush=True)
    code, output, stopped, signals = run_job(command, env, job_timeout_s(job))
    if output:
        print(output, end="" if output.endswith("\n") else "\n")
    if stopped == "timeout":
        finish(job["id"], "FAILED", f"timeout after {job_timeout_s(job):.0f} s\n{output}")
        print(f"FAILED id={job['id']} reason=timeout", file=sys.stderr)
        return False
    if signals:
        # An interrupted night was started and cut short: it is a record to
        # read, not a job to replay by itself next window. A setup or check
        # is idempotent and goes back to PENDING.
        reason = f"interrupted by {','.join(signals)} (exit {code})"
        if job["kind"] == "night":
            finish(job["id"], "FAILED", f"{reason}\n{output}")
            print(f"FAILED id={job['id']} reason=interrupted", file=sys.stderr)
        else:
            finish(job["id"], "PENDING", f"{reason}\n{output}")
            print(f"QUEUE HOLD reason=interrupted serial={serial}")
        return "interrupted"
    # A night job holds only by its own exit 75: its output carries a runner's
    # log, whose lines must never turn a played night back into PENDING.
    hold = re.search(r"SETUP HOLD reason=([a-z0-9-]+)", output) \
        if job["kind"] != "night" or code == 75 else None
    if hold is not None:
        reason = hold.group(1)
        finish(job["id"], "PENDING", f"exit={code}\n{output}")
        print(f"QUEUE HOLD reason={reason} serial={serial}")
        return reason
    if code == 0:
        finish(job["id"], "DONE", output)
        print(f"DONE id={job['id']}")
        return True
    finish(job["id"], "FAILED", f"exit={code}\n{output}")
    print(f"FAILED id={job['id']} exit={code}", file=sys.stderr)
    return False


def run_queue_once(deadline: float | None, interval: float, max_jobs: int = 0,
                   allow_nights: bool = False) -> int:
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
        job = claim_next(allow_nights)
        if job is None:
            held = 0 if allow_nights else sum(
                1 for item in read_jobs(queue_path()) if item.get("state") == "PENDING" and item.get("kind") == "night")
            print("QUEUE EMPTY" + (f" nights-held={held} (night jobs run only in an overnight window)"
                                   if held else ""))
            return 0
        outcome = execute(job, serial)
        if outcome == "interrupted":
            return 130
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


def run_queue(wait_seconds: float, interval: float, max_jobs: int = 0, allow_nights: bool = False) -> int:
    deadline = time.monotonic() + wait_seconds if wait_seconds else None
    while True:
        try:
            with QueueRunnerLock(queue_path()):
                return run_queue_once(deadline, interval, max_jobs, allow_nights)
        except QueueRunnerBusy:
            if deadline is None or time.monotonic() >= deadline:
                print("QUEUE HOLD reason=queue-runner-busy")
                return 75
            print("QUEUE WAIT reason=queue-runner-busy")
            time.sleep(interval)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Queue Companion setup/check jobs and night jobs")
    sub = parser.add_subparsers(dest="command", required=True)
    add = sub.add_parser("enqueue", help="append a deferred job")
    add.add_argument("kind", choices=("setup", "menu-check", "night-check", "night"))
    add.add_argument("--screen", choices=("menu", "night"), default="menu")
    add.add_argument("--install", action="store_true")
    add.add_argument("--probe", action="store_true")
    add.add_argument("--game", choices=tuple(night_jobs.GAMES), default=None,
                     help="night: the game whose committed winner this is")
    add.add_argument("--winner", default=None, help="night: tools/device/*-winner.json, committed")
    add.add_argument("--night", type=int, default=None, help="night: the one night to play (7 = Custom Night)")
    add.add_argument("--label", default=None, help="night: run label (lowercase, digits, hyphens)")
    add.add_argument("--audio", action="store_true", help="night (FNaF 2): retain the A2DP mix")
    add.add_argument("--idempotency-key", default=None)
    add.add_argument("--json", action="store_true", help="emit the queued job as structured JSON")
    list_parser = sub.add_parser("list", help="show queued jobs")
    list_parser.add_argument("--json", action="store_true", help="emit structured JSON")
    cancel_parser = sub.add_parser("cancel", help="retire PENDING jobs, keeping their records")
    cancel_parser.add_argument("ids", nargs="+", help="job ids from `list`")
    cancel_parser.add_argument("--reason", required=True, help="why, kept in each job's record")
    run = sub.add_parser("run", help="run pending jobs when device is ready")
    run.add_argument("--wait", type=float, default=0.0,
                     help="wait for a ready device for this many seconds")
    run.add_argument("--interval", type=float, default=5.0,
                     help="poll interval while waiting")
    run.add_argument("--max-jobs", type=int, default=0,
                     help="stop after this many DONE jobs (0: drain the queue)")
    run.add_argument("--nights", action="store_true",
                     help="also claim night jobs (the overnight window passes this; cue.queue.run cannot)")
    args = parser.parse_args(argv)
    try:
        if args.command == "enqueue":
            if args.kind == "night":
                if args.game is None or args.winner is None or args.night is None:
                    raise QueueError("a night job needs --game, --winner and --night")
                if args.install or args.probe or args.screen != "menu":
                    raise QueueError("a night job takes no --screen, --install or --probe")
                enqueue(make_night_job(args.game, args.winner, args.night, args.label, args.audio,
                                       args.idempotency_key), args.json)
                return 0
            if any(value is not None for value in (args.game, args.winner, args.night, args.label)) or args.audio:
                raise QueueError("--game, --winner, --night, --label and --audio belong to night jobs")
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
        if args.command == "cancel":
            for job_id in cancel(args.ids, args.reason):
                print(f"CANCELLED id={job_id}")
            return 0
        if args.wait < 0 or args.wait > 86400 or args.interval <= 0 or args.interval > 300:
            raise QueueError("wait must be 0..86400 and interval must be 0..300")
        if args.max_jobs < 0 or args.max_jobs > 1000:
            raise QueueError("max-jobs must be 0..1000")
        return run_queue(args.wait, args.interval, args.max_jobs, args.nights)
    except QueueError as error:
        print(f"QUEUE ERROR {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
