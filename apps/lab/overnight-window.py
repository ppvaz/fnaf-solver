#!/usr/bin/env python3
"""Run the Companion queue on the owner's phone inside a scheduled window,
then put the phone back the way the window found it.

Pedro's decision (2026-09-27): the phone stops being the bottleneck through
overnight windows. His own phone runs queued jobs overnight on the charger,
with stay-awake on, only inside a scheduled window. It is his personal phone,
so everything the window changes is recorded before it is changed and restored
when the window ends, however it ends.

  overnight-window.py [run]                     dry run (the default): the resolved
                                                window, its hash, the deadline and
                                                the queue; no adb call at all
  overnight-window.py run --live --confirm-live the window itself
  overnight-window.py preflight [--json]        read-only: what the window would
                                                decide now (takes the lease briefly)
  overnight-window.py restore --live --confirm-live
                                                restore what a killed window left
  overnight-window.py units --serial ID [--out DIR]
                                                render the systemd --user service
                                                and timer; installs nothing

A live window, in order: take the serial lease (another owner: LEASE_BUSY);
restore anything an earlier window left unrestored; check the time is inside
the window, or within the arming lead before it; check the queue holds work;
check the device, its capabilities (capabilities.ts), that it is awake and
unlocked (waiting a bounded time, then LOCKED), that no call is active and the
foreground is the launcher, the Companion or a target game (else IN_USE), and
that the battery is plugged, at or above its floor and below its temperature
ceiling (else POWER). Only then does it record the settings, write that record
to disk, set stay-awake-while-charging, suppress heads-up notifications and
turn Do Not Disturb on (else DND: the window refuses and starts no job). Then
it runs the queue one job at a time, repeating those checks between jobs,
until the queue is empty, a job fails, or the deadline. At the end, and on any
signal, it stops the queue child (SIGINT, SIGTERM, SIGKILL on its process
group), returns a killed job to PENDING, leaves the screen as it found it,
restores every setting it restores, Do Not Disturb included, reads each one
back, releases the lease and writes the record.

It never changes lock-screen security (no `locksettings`), never unlocks or
wakes the phone, never taps anything, never writes airplane mode, writes Do Not
Disturb only through NotificationManager's own `cmd notification set_dnd`, and
runs no command outside its own fixed vocabulary. The jobs carry their own
resolved profiles; the window infers no mode, geometry, coordinate or timing.

Nights (Pedro, 2026-09-27: "Yes, play nights"): the window's queue child is
the only runner that claims `night` jobs (`--nights`), one per call, each only
if its own budget fits before the stop instant. After a night killed before it
could observe the title, the window recovers the title itself
(`night-job.py title --recover`). In the morning, after the lease, it packs
each night's run and appends one summary line per window.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, time as clock_time, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "packages/play/src/safety"))  # the serial lease: Play's
import night_jobs  # noqa: E402
from companion_device_lock import DeviceBusy, DeviceLock, state_dir  # noqa: E402


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# The queue and the setup own their vocabularies; the window reuses them.
QUEUE = _load("companion_queue", "companion-queue.py")
SETUP = _load("companion_setup", ROOT / "packages/play/bin/companion/companion-setup.py")

SCHEMA = "overnight-window-v1"
CONFIG_SCHEMA = "overnight-window-config-v1"
PENDING_SCHEMA = "overnight-window-pending-v1"

# --- the window (Pedro can change these by flag or environment) -------------
DEFAULT_START = "01:30"           # FNAF_WINDOW_START / --start, local time
DEFAULT_END = "07:00"             # FNAF_WINDOW_END / --end, local time
BATTERY_FLOOR_PERCENT = 50        # --battery-floor: start and continue only at or above it
TEMPERATURE_CEILING_C = 45.0      # --temperature-ceiling: battery temperature, Celsius
LOCK_WAIT_S = 600.0               # --lock-wait: how long a locked phone is waited for
MAX_ARM_LEAD_S = 4 * 3600.0       # --max-arm-lead: a window may be armed this early

# --- what the window changes, restores, and only witnesses -----------------
# stay_on_while_plugged_in is a bitmask of charger kinds: AC 1 | USB 2 | wireless 4.
STAY_ON_SETTING = "global/stay_on_while_plugged_in"
STAY_ON_VALUE = "7"
# Heads-up notifications, which SystemUI reads from this global setting (1, or
# unset, is on). Pedro, 2026-09-29 (ADR 0002, decision 2): "Do Not Disturb and
# heads-up suppression on at window open, the prior setting restored at close;
# the window refuses if it cannot set them." A banner dropped over the game
# covers controls the night presses; the setting is written, read back and
# restored like stay-awake. Whether this handset's SystemUI honours it is not
# yet measured on the phone (UNKNOWN): the window proves the write, not the
# absence of a banner.
HEADS_UP_SETTING = "global/heads_up_notifications_enabled"
HEADS_UP_OFF = "0"
# Settings whose `settings put` IS their control path: recorded, restored to
# the recorded value if anything changed them, and read back.
RESTORED_SETTINGS = (
    STAY_ON_SETTING,
    "system/screen_off_timeout",
    "system/screen_brightness",
    "system/screen_brightness_mode",
    HEADS_UP_SETTING,
)
# Do Not Disturb (same decision). NotificationManager owns it: a raw
# `settings put global zen_mode` desynchronises it, so the window writes it only
# through `cmd notification set_dnd`, the service's own shell command, and reads
# `zen_mode` back. It is set to `priority` (zen_mode 1), not `on`: `on` is
# total silence, which would also silence an alarm the phone's owner set inside
# the window, while `priority` keeps his own priority policy (alarms, by
# default). Only a DND the window turned on is turned off again: a window that
# finds DND already on (the owner's schedule, zen_mode 1-3) leaves it alone and
# only witnesses it, so a schedule that ends at 07:00 is never re-entered by a
# "restore". set_dnd off also snoozes an automatic rule that started after the
# window opened; the owner's schedule resumes on its next start.
DND_SETTING = "global/zen_mode"
DND_ON = "1"
# zen_mode as Settings.Global stores it -> the `cmd notification set_dnd` word that sets it.
DND_WORDS = {"0": "off", "1": "priority", "2": "none", "3": "alarms"}
DND_READBACK_S = 5.0              # zen_mode is read back until it answers the value asked for
DND_READBACK_POLL_S = 0.25
# Recorded and read back, never written. Airplane mode is owned by the radios:
# a raw `settings put` desynchronises them. A drift is reported, not reversed.
WITNESSED_SETTINGS = ("global/airplane_mode_on",)
RECORDED_SETTINGS = (*RESTORED_SETTINGS, DND_SETTING, *WITNESSED_SETTINGS)
SETTING_VALUE = re.compile(r"^(?:null|-?\d{1,12}(?:\.\d{1,6})?)$")

COMPANION = SETUP.HELPER_PACKAGE
TARGETS = (SETUP.TARGET_PACKAGE, *SETUP.OTHER_TARGETS.values())
LOCKED_PATTERNS = SETUP.LOCKED_PATTERNS

# --- deadlines (seconds) -----------------------------------------------------
# A job's own ceiling is the queue's: JOB_TIMEOUT_S for a setup or check, and
# a night job's budgetS (night_jobs.budget_s: every step's bound plus the
# night's own length). No job starts unless that ceiling fits before the stop.
JOB_TIMEOUT_S = QUEUE.JOB_TIMEOUT_S
CHILD_WAIT_S = 120.0              # the queue child's --wait for a ready device or a hold
QUEUE_INTERVAL_S = 5.0            # the queue child's --interval
# SIGINT -> SIGTERM: a job's own cleanup. A night's runner stops and pulls its
# recording and resets the game to the title (night-run.sh's EXIT trap), then
# the night job observes the title (night_jobs.POST_TITLE_S).
STOP_GRACE_S = 300.0
TERM_GRACE_S = 20.0               # SIGTERM -> SIGKILL
KILL_GRACE_S = 5.0
NIGHT_RECOVERY_S = night_jobs.POST_TITLE_S   # the window's own title recovery after a killed night
RESTORE_BUDGET_S = 120.0          # reserved before the window end for leave + restore
PACK_TIMEOUT_S = 300.0            # one morning `evidence pack` (host only, after the lease)
RESTORE_RETRY_S = 1800.0          # a phone unreachable at restore is retried this long
RESTORE_RETRY_POLL_S = 30.0
# One setting's read, write and read-back, each retried until it answers.
# Seven settings at most: 7 x 15 s = 105 s stays inside RESTORE_BUDGET_S.
RESTORE_CALL_BUDGET_S = 15.0
RESTORE_CALL_POLL_S = 0.5
# Held while the window cleans up: a child spawned then cannot be killed by a
# signal to this process group in the gap between its fork and its setsid().
CLEANUP_SIGNALS = frozenset({signal.SIGINT, signal.SIGTERM, signal.SIGHUP})
LOCK_POLL_S = 15.0
ARM_POLL_S = 1.0
MAX_HOLDS = 3                     # consecutive queue holds before the window ends HELD
ADB_TIMEOUT_S = 20.0
CAPABILITY_TIMEOUT_S = 150.0
LEAVE_TIMEOUT_S = 60.0
FOCUS_RETRIES = 3

QUEUE_COMMAND = [str(HERE / "companion-queue.sh")]
HELPER_STOP_COMMAND = [str(HERE / "../../packages/play/bin/companion/companion-setup.sh"), "--stop"]
CAPABILITIES_COMMAND = ["node", str(HERE / "../../packages/play/bin/phone/capabilities.ts")]
LOCAL_PROFILE_COMMAND = ["node", str(HERE / "../../packages/play/bin/phone/local-profile.ts"), "serial"]
NIGHT_JOB_COMMAND = [sys.executable, str(HERE / "night-job.py")]
PACK_COMMAND = ["node", str(ROOT / "apps/desktop/src/evidence.ts"), "pack"]
PACKS_ROOT = ROOT                 # docs/evidence/runs/<run> lives here
RUNS_ROOT = ROOT                  # artifacts/runs/<run> lives here

SERIAL = re.compile(r"^[A-Za-z0-9._:-]{1,96}$")
CLOCK = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$")
FOCUS = re.compile(r"mCurrentFocus=Window\{\S+ u\d+ ([^\s}]+)")

# Exit codes: 0 the window ran (COMPLETE or DEADLINE) and restored; 75 it did
# not run and may run later (a refusal); 1 a job or a check failed; 130 a
# signal ended it; 3 a setting could not be restored and verified, which
# overrides every other code; 2 a usage error.
EXIT = {
    "COMPLETE": 0, "DEADLINE": 0,
    "LOCKED": 75, "IN_USE": 75, "POWER": 75, "LEASE_BUSY": 75, "DEVICE_ABSENT": 75,
    "OUTSIDE_WINDOW": 75, "HELD": 75, "DND": 75,
    "JOB_FAILED": 1, "CAPABILITY": 1, "UNKNOWN_STATE": 1, "QUEUE_ERROR": 1, "ERROR": 1,
    "ABORTED": 130, "RESTORE_PENDING": 3,
}


class ConfigError(ValueError):
    pass


class Deadline:
    """An instant on both clocks; whichever says it has passed, it has.

    CLOCK_MONOTONIC stops while the host is suspended: a host that sleeps at
    02:00 and wakes at 08:00 would find a monotonic-only deadline still hours
    away and start a job on the owner's phone in the morning. The wall clock
    carries the window's end across a suspend; the monotonic one carries it
    across a wall-clock step.
    """

    def __init__(self, seconds_from_now: float, now_wall: datetime, now_mono: float):
        self.mono = now_mono + seconds_from_now
        self.wall = now_wall + timedelta(seconds=seconds_from_now)

    def remaining(self) -> float:
        return min(self.mono - mono(), (self.wall - now_local()).total_seconds())

    def passed(self) -> bool:
        return self.remaining() <= 0.0


def mono() -> float:
    return time.monotonic()


def now_local() -> datetime:
    return datetime.now().astimezone()


def iso(value: datetime) -> str:
    return value.isoformat(timespec="seconds")


def window_dir() -> Path:
    return Path(os.environ.get("FNAF_WINDOW_DIR", str(ROOT / "artifacts/overnight-windows")))


def pending_path(serial: str) -> Path:
    """The phone's unrestored settings: host-wide (state_dir()), so a restore
    from any checkout or worktree finds what the main checkout's window left."""
    digest = hashlib.sha256(serial.encode("utf-8")).hexdigest()[:16]
    return state_dir() / "overnight-window" / f"pending-restore-{digest}.json"


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def canonical_sha256(value: object) -> str:
    text = json.dumps(value, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# --- configuration ------------------------------------------------------------

def parse_clock(text: str, name: str) -> clock_time:
    match = CLOCK.fullmatch(text or "")
    if not match:
        raise ConfigError(f"{name} must be HH:MM or HH:MM:SS in local time, not {text!r}")
    return clock_time(int(match.group(1)), int(match.group(2)), int(match.group(3) or 0))


def window_length_s(start: clock_time, end: clock_time) -> float:
    base = datetime(2000, 1, 1)
    s = datetime.combine(base.date(), start)
    e = datetime.combine(base.date() if end > start else base.date() + timedelta(days=1), end)
    return (e - s).total_seconds()


def local_profile_serial() -> str:
    """The untracked local profile's serial (local-profile.ts, ADR 0002
    decision 8), or '' when the host has none. No tracked default exists."""
    try:
        result = subprocess.run(LOCAL_PROFILE_COMMAND, cwd=ROOT, check=False, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


SERIAL_HOW_TO = ("--serial, FNAF_SERIAL, or the untracked local profile "
                 "(node packages/play/bin/phone/local-profile.ts set <serial>)")


def resolve_config(args: argparse.Namespace) -> dict:
    serial = (args.serial or os.environ.get("FNAF_SERIAL") or os.environ.get("ANDROID_SERIAL")
              or local_profile_serial())
    if serial and not SERIAL.fullmatch(serial):
        raise ConfigError(f"the serial is not a device token: {serial!r}")
    start_text = args.start or os.environ.get("FNAF_WINDOW_START") or DEFAULT_START
    end_text = args.end or os.environ.get("FNAF_WINDOW_END") or DEFAULT_END
    start, end = parse_clock(start_text, "start"), parse_clock(end_text, "end")
    if start == end:
        raise ConfigError("the window's start and end are the same instant")
    floor = BATTERY_FLOOR_PERCENT if args.battery_floor is None else args.battery_floor
    if not 1 <= floor <= 100:
        raise ConfigError("battery floor must be 1..100 percent")
    ceiling = TEMPERATURE_CEILING_C if args.temperature_ceiling is None else args.temperature_ceiling
    if not 20.0 <= ceiling <= 60.0:
        raise ConfigError("temperature ceiling must be 20..60 C")
    lock_wait = LOCK_WAIT_S if args.lock_wait is None else args.lock_wait
    if not 0 <= lock_wait <= 3600:
        raise ConfigError("lock wait must be 0..3600 s")
    lead = MAX_ARM_LEAD_S if args.max_arm_lead is None else args.max_arm_lead
    if not 0 <= lead <= 12 * 3600:
        raise ConfigError("max arm lead must be 0..43200 s")
    if lead + window_length_s(start, end) >= 24 * 3600:
        raise ConfigError("the arming lead plus the window must be shorter than a day")
    return {
        "schema": CONFIG_SCHEMA,
        "serial": serial or "UNKNOWN",
        "start": start_text,
        "end": end_text,
        "batteryFloorPercent": floor,
        "temperatureCeilingC": ceiling,
        "lockWaitS": lock_wait,
        "maxArmLeadS": lead,
        "stayOn": {"setting": STAY_ON_SETTING, "value": STAY_ON_VALUE},
        "headsUp": {"setting": HEADS_UP_SETTING, "value": HEADS_UP_OFF},
        "dnd": {"setting": DND_SETTING, "value": DND_ON,
                "command": f"cmd notification set_dnd {DND_WORDS[DND_ON]}",
                "restore": "set_dnd off, only when the window found zen_mode 0"},
        "restoredSettings": list(RESTORED_SETTINGS),
        "witnessedSettings": list(WITNESSED_SETTINGS),
        "allowedForeground": ["<the phone's resolved HOME activity>", COMPANION, *TARGETS],
        "deadlines": {
            "jobTimeoutS": JOB_TIMEOUT_S, "nightJobBudget": "per job: night_jobs.budget_s(nightMs)",
            "childWaitS": CHILD_WAIT_S, "stopGraceS": STOP_GRACE_S, "termGraceS": TERM_GRACE_S,
            "nightRecoveryS": NIGHT_RECOVERY_S, "restoreBudgetS": RESTORE_BUDGET_S,
            "restoreRetryS": RESTORE_RETRY_S, "maxHolds": MAX_HOLDS,
        },
        "queueFile": str(QUEUE.queue_path()),
    }


def window_for(now: datetime, config: dict) -> tuple[datetime, datetime] | None:
    """The window `now` belongs to: inside it, or within the arming lead before it."""
    start = parse_clock(config["start"], "start")
    end = parse_clock(config["end"], "end")
    lead = timedelta(seconds=config["maxArmLeadS"])
    for offset in (-1, 0, 1):
        day = (now + timedelta(days=offset)).date()
        opens = datetime.combine(day, start).astimezone()
        closes = datetime.combine(day if end > start else day + timedelta(days=1), end).astimezone()
        if opens - lead <= now < closes:
            return opens, closes
    return None


# --- the phone, read ----------------------------------------------------------

ADB_TIMED_OUT = 124
ADB_NOT_STARTED = 127


def adb(serial: str, *args: str, timeout: float | None = None) -> tuple[int, str]:
    """One bounded adb call: (exit, output). A negative exit is the signal
    that killed the child (-2 = SIGINT); 124 a timeout; 127 not started."""
    command = [os.environ.get("ADB_BIN", "adb"), "-s", serial, *args]
    try:
        # Its own session, so a signal to this runner's process group cannot
        # reach the call once it has started. That leaves the gap between fork
        # and setsid(): a group signal landing there kills the child before it
        # runs (measured 2026-09-27, 1721 of 13960 spawns under a SIGINT
        # barrage at load 10). The cleanup closes that gap by holding the
        # signals while it spawns (Window.finish), and the restore retries.
        result = subprocess.run(command, cwd=ROOT, check=False, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=ADB_TIMEOUT_S if timeout is None else timeout,
                                start_new_session=True)
    except subprocess.TimeoutExpired as error:
        return ADB_TIMED_OUT, str(error)
    except OSError as error:
        return ADB_NOT_STARTED, str(error)
    output = result.stdout if result.returncode == 0 else result.stdout + result.stderr
    return result.returncode, output.replace("\r", "")


def device_present(serial: str) -> bool:
    code, output = adb(serial, "get-state", timeout=10.0)
    return code == 0 and output.strip() == "device"


def read_power(serial: str) -> dict:
    code, power = adb(serial, "shell", "dumpsys", "power")
    if code != 0:
        return {"reachable": False}
    code, policy = adb(serial, "shell", "dumpsys", "window", "policy")
    if code != 0:
        return {"reachable": False}
    return {"reachable": True, "awake": "mWakefulness=Awake" in power,
            "keyguard": any(re.search(pattern, policy) for pattern in LOCKED_PATTERNS)}


def read_foreground(serial: str) -> list[str] | None:
    """Every non-null mCurrentFocus token; the first line is often null mid-transition."""
    for attempt in range(FOCUS_RETRIES):
        code, output = adb(serial, "shell", "dumpsys", "window")
        if code != 0:
            return None
        tokens = [match.group(1) for match in FOCUS.finditer(output)]
        if tokens:
            return tokens
        if attempt + 1 < FOCUS_RETRIES:
            time.sleep(1.0)
    return []


def read_launcher(serial: str) -> str | None:
    code, output = adb(serial, "shell", "cmd", "package", "resolve-activity", "--brief",
                       "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME")
    if code != 0:
        return None
    for line in reversed(output.splitlines()):
        value = line.strip()
        if re.fullmatch(r"[A-Za-z0-9_.]+/[A-Za-z0-9_.$]+", value):
            package = value.split("/", 1)[0]
            # "android" is the chooser: no default HOME app, so no launcher to recognise.
            return None if package == "android" else package
    return None


def read_call_states(serial: str) -> list[int] | None:
    code, output = adb(serial, "shell", "dumpsys", "telephony.registry")
    states = [int(value) for value in re.findall(r"mCallState=(\d+)", output)] if code == 0 else []
    return states or None


def read_battery(serial: str) -> dict | None:
    code, output = adb(serial, "shell", "dumpsys", "battery")
    if code != 0:
        return None

    def field(name: str) -> str | None:
        match = re.search(rf"^\s*{re.escape(name)}:\s*(\S+)", output, re.M)
        return match.group(1) if match else None

    try:
        level, scale = int(field("level") or ""), int(field("scale") or "100")
        temperature = int(field("temperature") or "") / 10.0
    except ValueError:
        return None
    kinds = ("AC", "USB", "Wireless", "Dock")
    return {
        # `dumpsys battery set/unplug` leaves simulated values behind this line.
        "simulated": "UPDATES STOPPED" in output,
        "percent": round(100.0 * level / scale, 1) if scale > 0 else None,
        "plugged": [kind for kind in kinds if field(f"{kind} powered") == "true"],
        "status": field("status"),
        "temperatureC": temperature,
    }


def read_projection(serial: str) -> bool | None:
    code, output = adb(serial, "shell", "dumpsys", "media_projection")
    if code != 0:
        return None
    return COMPANION in output and "TYPE_SCREEN_CAPTURE" in output


UNPARSEABLE = 65   # the call exited 0 but printed no setting value


def read_setting(serial: str, name: str, timeout: float | None = None) -> tuple[str | None, int]:
    """(value, exit): the value is None unless the read answered with one."""
    namespace, key = name.split("/", 1)
    code, output = adb(serial, "shell", "settings", "get", namespace, key, timeout=timeout)
    value = output.strip()
    if code != 0:
        return None, code
    if not SETTING_VALUE.fullmatch(value):
        return None, UNPARSEABLE
    return value, 0


def get_setting(serial: str, name: str) -> str | None:
    return read_setting(serial, name)[0]


def write_setting(serial: str, name: str, value: str, timeout: float | None = None) -> int:
    """The write's exit code. Only a restored setting, only a number or null."""
    if name not in RESTORED_SETTINGS or not SETTING_VALUE.fullmatch(value):
        raise ValueError(f"the window never writes {name}={value!r}")
    namespace, key = name.split("/", 1)
    if value == "null":
        code, _ = adb(serial, "shell", "settings", "delete", namespace, key, timeout=timeout)
    else:
        code, _ = adb(serial, "shell", "settings", "put", namespace, key, value, timeout=timeout)
    return code


def put_setting(serial: str, name: str, value: str) -> bool:
    return write_setting(serial, name, value) == 0


def set_dnd(serial: str, zen_mode: str, timeout: float | None = None) -> int:
    """Do Not Disturb through NotificationManager's own shell command: the
    exit code. Only a zen_mode the command can name; never `settings put`."""
    if zen_mode not in DND_WORDS:
        raise ValueError(f"the window never sets zen_mode={zen_mode!r}")
    code, _ = adb(serial, "shell", "cmd", "notification", "set_dnd", DND_WORDS[zen_mode], timeout=timeout)
    return code


def write_value(serial: str, name: str, value: str, timeout: float | None = None) -> int:
    """A restore's write: DND through set_dnd, every other setting through settings put."""
    if name == DND_SETTING:
        return set_dnd(serial, value, timeout=timeout)
    return write_setting(serial, name, value, timeout=timeout)


def writes_on_restore(name: str, prior: str) -> bool:
    """Whether a restore may write `name` back to `prior`. DND only when the
    window found it off (it turned it on); otherwise it only witnesses it."""
    return name in RESTORED_SETTINGS or (name == DND_SETTING and prior == "0")


def classify_foreground(tokens: list[str], launcher: str | None) -> tuple[str, list[str]]:
    """'ok' when every focused window is the launcher, the Companion or a target."""
    packages = []
    for token in tokens:
        if "/" not in token:
            # A system window with no activity: the shade, a dialog, the keyguard.
            return "in-use", [token]
        packages.append(token.split("/", 1)[0])
    allowed = {COMPANION, *TARGETS} | ({launcher} if launcher else set())
    foreign = [package for package in packages if package not in allowed]
    return ("in-use", foreign) if foreign else ("ok", packages)


def assess_phone(serial: str, config: dict, launcher: str | None, lock_wait_s: float,
                 event=lambda *a, **k: None, sleep=None) -> tuple[str, str] | None:
    """None when the phone is fit for a job; otherwise (outcome, reason).

    Order matters: a locked or sleeping phone has no meaningful foreground.
    A locked phone is waited for (bounded), never unlocked or woken.
    """
    sleep = sleep or (lambda seconds: (time.sleep(seconds), True)[1])
    deadline = mono() + lock_wait_s
    while True:
        power = read_power(serial)
        if not power["reachable"]:
            return "DEVICE_ABSENT", "device-unavailable"
        if power["awake"] and not power["keyguard"]:
            break
        reason = "device-locked" if power["keyguard"] else "device-not-awake"
        if mono() >= deadline:
            return "LOCKED", reason
        event("lock.wait", reason=reason)
        if not sleep(min(LOCK_POLL_S, max(0.0, deadline - mono()))):
            return "ABORTED", "signal"
    calls = read_call_states(serial)
    if calls is None:
        return "UNKNOWN_STATE", "call-state-unreadable"
    if any(state != 0 for state in calls):
        return "IN_USE", f"call-state={','.join(map(str, calls))}"
    tokens = read_foreground(serial)
    if tokens is None:
        return "DEVICE_ABSENT", "device-unavailable"
    if not tokens:
        return "UNKNOWN_STATE", "foreground-unreadable"
    verdict, detail = classify_foreground(tokens, launcher)
    if verdict != "ok":
        return "IN_USE", f"foreground={','.join(detail)}"
    battery = read_battery(serial)
    if battery is None or battery["percent"] is None:
        return "UNKNOWN_STATE", "battery-unreadable"
    if battery["simulated"]:
        return "UNKNOWN_STATE", "battery-simulated"
    event("phone.checked", foreground=",".join(tokens), battery=battery["percent"],
          plugged=",".join(battery["plugged"]) or "none", temperatureC=battery["temperatureC"])
    if not battery["plugged"]:
        return "POWER", "not-plugged"
    if battery["percent"] < config["batteryFloorPercent"]:
        return "POWER", f"battery={battery['percent']}<{config['batteryFloorPercent']}"
    if battery["temperatureC"] >= config["temperatureCeilingC"]:
        return "POWER", f"temperature={battery['temperatureC']}>={config['temperatureCeilingC']}"
    return None


def restore_one(serial: str, name: str, want: str, write: bool) -> dict:
    """One setting back to `want`, read back -- every call retried until it
    answers, within RESTORE_CALL_BUDGET_S. A read that dies (a killed child, a
    timeout on a loaded host) is asked again, never taken for the answer.

    `write` False only witnesses: the setting is read, never written.
    Every call's exit code is kept in `calls`, in order (`put:` for settings
    put or delete, `set_dnd:` for Do Not Disturb)."""
    until = mono() + RESTORE_CALL_BUDGET_S
    calls: list[str] = []
    before = None
    last = None
    verb = "set_dnd" if name == DND_SETTING else "put"

    def pause() -> bool:
        """Wait one poll before asking again; False once the budget is spent."""
        if mono() >= until:
            return False
        time.sleep(max(0.0, min(RESTORE_CALL_POLL_S, until - mono())))
        return True

    while True:
        remaining = until - mono()
        if remaining <= 0:
            break
        value, code = read_setting(serial, name, timeout=min(ADB_TIMEOUT_S, remaining))
        calls.append(f"get:{code}")
        if value is None:
            if pause():
                continue
            break
        last = value
        if before is None:
            before = value
        # A write that was killed may still have landed: any attempt counts.
        attempted = any(call.startswith(f"{verb}:") for call in calls)
        if value == want:
            return {"setting": name, "prior": want, "before": before, "after": value,
                    "action": "restored" if attempted else "unchanged", "calls": calls}
        if not write:
            return {"setting": name, "prior": want, "after": value,
                    "action": "DRIFT-REPORTED-NOT-WRITTEN", "calls": calls}
        if attempted and not pause():
            break
        remaining = until - mono()
        if remaining <= 0:
            break
        calls.append(f"{verb}:{write_value(serial, name, want, timeout=min(ADB_TIMEOUT_S, remaining))}")
        # ...and read it back at once.
    row = {"setting": name, "prior": want, "after": last, "calls": calls}
    if last is None:
        row["action"] = "UNREACHABLE"
    else:
        row.update({"before": before, "action": "FAILED"})
    return row


def restore_settings(serial: str, prior: dict[str, str], retry_s: float | None = None,
                     event=lambda *a, **k: None) -> dict:
    """Put every restored setting back to its recorded value and read it back."""
    deadline = mono() + (RESTORE_RETRY_S if retry_s is None else retry_s)
    written = {name for name in RECORDED_SETTINGS
               if prior.get(name) is not None and writes_on_restore(name, prior[name])}
    while True:
        results = []
        for name in RECORDED_SETTINGS:
            want = prior.get(name)
            if want is not None:
                results.append(restore_one(serial, name, want, write=name in written))
        restored = [row for row in results if row["setting"] in written]
        verified = all(row["action"] in ("restored", "unchanged") for row in restored)
        # Only a setting the window writes is worth waiting for the phone over.
        reachable = all(row["action"] != "UNREACHABLE" for row in restored)
        if reachable or mono() >= deadline:
            return {"verified": verified, "settings": results}
        event("restore.retry", reason="device-unreachable")
        time.sleep(max(0.0, min(RESTORE_RETRY_POLL_S, deadline - mono())))


def run_capabilities(serial: str) -> dict:
    try:
        result = subprocess.run([*CAPABILITIES_COMMAND, "--serial", serial, "--json"], cwd=ROOT,
                                check=False, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=CAPABILITY_TIMEOUT_S,
                                start_new_session=True)
        device = json.loads(result.stdout)["device"]
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError, TypeError) as error:
        return {"ok": False, "reason": f"capabilities-unreadable: {error}"}
    summary = {key: device.get(key) for key in
               ("model", "androidRelease", "sdk", "cueHelper", "targetInstalled")}
    if device.get("targetInstalled") is not True:
        return {"ok": False, "reason": "target-not-installed", **summary}
    if not device.get("cueHelper"):
        return {"ok": False, "reason": "companion-not-installed", **summary}
    return {"ok": True, **summary}


# --- the window ---------------------------------------------------------------

class Window:
    def __init__(self, config: dict):
        self.config = config
        self.serial = config["serial"]
        self.opened = now_local()
        digest = hashlib.sha256(self.serial.encode("utf-8")).hexdigest()[:8]
        self.id = f"window-{self.opened.astimezone().strftime('%Y%m%dT%H%M%S%z')}-{digest}"
        self.dir = window_dir() / self.id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.events_file = (self.dir / "events.jsonl").open("a", encoding="utf-8")
        self.jobs_log = self.dir / "queue.log"
        self.started = mono()
        self.lease: DeviceLock | None = None
        self.lease_released = False
        self.child: subprocess.Popen | None = None
        self.child_signals: list[str] = []
        self.signals: list[str] = []
        self.signal_rows: list[dict] = []
        self.held: list[str] = []
        self.cleaning = False
        self.applied = False
        self.prior: dict[str, str] = {}
        self.found: dict = {}
        self.launcher: str | None = None
        self.outcome: str | None = None
        self.reason: str | None = None
        self.record: dict = {
            "schema": SCHEMA,
            "claim": "operational: what the window ran and what it restored. A job's "
                     "own evidence carries any claim about a night.",
            "windowId": self.id, "host": socket.gethostname(), "pid": os.getpid(),
            "config": config, "configSha256": canonical_sha256(config),
            "window": {"openedAt": iso(self.opened)},
            "jobs": [], "events": [],
        }

    # -- bookkeeping
    def event(self, name: str, /, **fields) -> None:
        row = {"at": iso(now_local()), "t": round(mono() - self.started, 3), "type": name, **fields}
        self.record["events"].append(row)
        self.events_file.write(json.dumps(row, sort_keys=True) + "\n")
        self.events_file.flush()
        detail = " ".join(f"{key}={value}" for key, value in fields.items())
        print(f"WINDOW {name}{' ' + detail if detail else ''}", flush=True)

    def end(self, outcome: str, reason: str | None = None) -> None:
        self.outcome, self.reason = outcome, reason
        self.event("window.outcome", outcome=outcome, reason=reason)

    @property
    def aborted(self) -> bool:
        return bool(self.signals)

    def on_signal(self, signum: int, _frame: object) -> None:
        # Never raises and does no I/O. Until 2026-09-27 it wrote the event
        # itself, and a signal landing while the main thread was writing the
        # same events file raised "reentrant call inside BufferedWriter" out of
        # that write -- aborting the restore it interrupted. Its rows are
        # written from here by the main thread (write_signal_events).
        self.signals.append(signal.Signals(signum).name)
        self.signal_rows.append({"at": iso(now_local()), "signal": signal.Signals(signum).name,
                                 "duringCleanup": self.cleaning})

    def write_signal_events(self) -> None:
        while self.signal_rows:
            row = self.signal_rows.pop(0)
            self.event("signal", **{key: value for key, value in row.items() if key != "at"}, receivedAt=row["at"])

    def sleep(self, seconds: float) -> bool:
        """Sleep in short steps; False as soon as a signal arrives."""
        until = mono() + max(0.0, seconds)
        while mono() < until:
            if self.aborted:
                return False
            time.sleep(min(0.1, until - mono()))
        return not self.aborted

    def queue_jobs(self) -> list[dict]:
        try:
            return QUEUE.read_jobs(QUEUE.queue_path())
        except QUEUE.QueueError as error:
            self.event("queue.unreadable", detail=str(error))
            return []

    def pending(self) -> list[dict]:
        return [job for job in self.queue_jobs() if job.get("state") == "PENDING"]

    def next_budget(self) -> float:
        """The ceiling of the job the queue claims next (its first PENDING)."""
        pending = self.pending()
        if not pending or pending[0].get("kind") != "night":
            return JOB_TIMEOUT_S
        try:
            return QUEUE.job_timeout_s(pending[0])
        except QUEUE.QueueError:
            return float("inf")

    def child_env(self) -> dict:
        env = dict(os.environ)
        env["ANDROID_SERIAL"] = self.serial
        if self.lease is not None:
            env["CUE_HELPER_LEASE_OWNER_PID"] = str(self.lease.owner_pid)
        return env

    # -- checks
    def check_phone(self, lock_wait: bool) -> tuple[str, str] | None:
        return assess_phone(self.serial, self.config, self.launcher,
                            self.config["lockWaitS"] if lock_wait else 0.0,
                            event=self.event, sleep=self.sleep)

    # -- the queue child
    def run_child(self, stop: Deadline, budget: float) -> dict:
        wait = max(0.0, min(CHILD_WAIT_S, stop.remaining() - budget))
        # --nights: only a window's queue child claims night jobs.
        command = [*QUEUE_COMMAND, "run", "--max-jobs", "1", "--wait", f"{wait:.1f}",
                   "--interval", str(QUEUE_INTERVAL_S), "--nights"]
        offset = self.jobs_log.stat().st_size if self.jobs_log.exists() else 0
        attempt = {"attempt": len(self.record["jobs"]) + 1, "startedAt": iso(now_local()),
                   "command": command}
        self.record["jobs"].append(attempt)
        with self.jobs_log.open("a", encoding="utf-8") as log:
            self.child = subprocess.Popen(command, cwd=ROOT, env=self.child_env(), stdout=log,
                                          stderr=subprocess.STDOUT, start_new_session=True)
        self.child_signals = []
        self.event("child.start", pid=self.child.pid, attempt=attempt["attempt"])
        stopped = None
        while self.child.poll() is None:
            if self.aborted:
                stopped = "aborted"
            elif stop.passed():
                stopped = "deadline"
            if stopped:
                self.stop_child(stopped)
                break
            time.sleep(0.1)
        code = self.child.wait()
        self.child = None
        with self.jobs_log.open("r", encoding="utf-8", errors="replace") as log:
            log.seek(offset)
            output = log.read()
        attempt.update({"endedAt": iso(now_local()), "exit": code, "signals": self.child_signals,
                        "done": re.findall(r"^DONE id=(\S+)", output, re.M),
                        "failed": re.findall(r"^FAILED id=(\S+)", output, re.M),
                        "nights": [{"id": m.group(1), "game": m.group(2), "night": int(m.group(3))}
                                   for m in re.finditer(r"^RUNNING id=(\S+) kind=night game=(\S+) night=(\d)",
                                                        output, re.M)],
                        "outputTail": output[-2000:]})
        hold = re.search(r"QUEUE HOLD reason=([a-z0-9-]+)", output)
        if stopped is None and self.aborted:
            # The window's own interrupt can reach the queue child before its
            # setsid() and end it at once: that is this window's abort too.
            stopped = "aborted"
        if stopped:
            attempt["kind"] = stopped
        elif code == 0 and "QUEUE EMPTY" in output:
            attempt["kind"] = "empty"
        elif code == 0:
            attempt["kind"] = "done"
        elif code == 1:
            attempt["kind"] = "failed"
        elif code == 75:
            attempt.update({"kind": "hold", "hold": hold.group(1) if hold else "unknown"})
        elif code == 130:
            attempt["kind"] = "interrupted"
        else:
            attempt["kind"] = "error"
        self.event("child.end", exit=code, kind=attempt["kind"])
        return attempt

    def stop_child(self, why: str) -> None:
        child = self.child
        if child is None:
            return
        for signum, grace in ((signal.SIGINT, STOP_GRACE_S), (signal.SIGTERM, TERM_GRACE_S),
                              (signal.SIGKILL, KILL_GRACE_S)):
            if child.poll() is not None:
                return
            try:
                os.killpg(child.pid, signum)
            except ProcessLookupError:
                return
            self.child_signals.append(signum.name)
            self.event("child.signal", signal=signum.name, why=why)
            until = mono() + grace
            while child.poll() is None and mono() < until:
                time.sleep(0.05)

    # -- the body
    def run(self) -> int:
        for signum in CLEANUP_SIGNALS:
            signal.signal(signum, self.on_signal)
        try:
            try:
                self.body()
            except Exception as error:  # the restore below must still run
                self.end("ERROR", repr(error))
            if self.outcome is None:
                self.end("ERROR", "the window ended without an outcome")
        finally:
            # From here until the process exits, SIGINT/SIGTERM/SIGHUP are held:
            # every child the cleanup spawns inherits the block, so a signal to
            # this process group cannot kill it between fork and setsid(), and
            # no handler runs in the middle of a restore. finish() records what
            # arrived meanwhile (sigpending). They stay held after it, too: the
            # result is written by then, and an interrupt during the
            # interpreter's own exit (which restores the default handlers)
            # would otherwise turn exit 130 into a SIGINT death (-2). What is
            # still pending is dropped with the process. SIGKILL still works.
            self.cleaning = True
            signal.pthread_sigmask(signal.SIG_BLOCK, CLEANUP_SIGNALS)
            self.finish()
        return self.record["exitCode"]

    def body(self) -> None:
        config = self.config
        self.event("window.open", serial=self.serial, configSha256=self.record["configSha256"])
        try:
            self.lease = DeviceLock(self.serial).__enter__()
        except DeviceBusy as error:
            return self.end("LEASE_BUSY", str(error))
        self.event("lease.acquired", ownerPid=self.lease.owner_pid)
        if pending_path(self.serial).exists():
            recovered = recover(self.serial, self.event)
            self.record["recovered"] = recovered
            if not recovered["verified"]:
                return self.end("RESTORE_PENDING", "an earlier window's settings are still unrestored")

        now = now_local()
        window = window_for(now, config)
        if window is None:
            return self.end("OUTSIDE_WINDOW", f"{config['start']}-{config['end']} (armed up to "
                            f"{int(config['maxArmLeadS'])} s early) does not contain {iso(now)}")
        opens, closes = window
        base = mono()
        start = Deadline(max(0.0, (opens - now).total_seconds()), now, base)
        # The queue child is signalled here, so that its own cleanup (the
        # SIGINT, SIGTERM and SIGKILL graces) and then the leave and the
        # restore all fit before the window's end.
        stop = Deadline((closes - now).total_seconds() - RESTORE_BUDGET_S - NIGHT_RECOVERY_S - STOP_GRACE_S
                        - TERM_GRACE_S - KILL_GRACE_S, now, base)
        armed = now < opens
        self.record["window"].update({
            "start": iso(opens), "end": iso(closes), "armedEarly": armed, "stopAt": iso(stop.wall),
        })
        queue_before = self.queue_jobs()
        self.record["queue"] = {"before": [{"id": job.get("id"), "state": job.get("state"),
                                            "kind": job.get("kind")} for job in queue_before]}
        if not armed and not self.pending():
            return self.end("COMPLETE", "queue-empty")
        budget = self.next_budget()
        if stop.remaining() - max(0.0, start.remaining()) < CHILD_WAIT_S + budget:
            return self.end("DEADLINE", f"no-room-for-a-job-before-the-deadline (next job {budget:.0f} s)")

        if not device_present(self.serial):
            return self.end("DEVICE_ABSENT", "adb get-state is not device")
        capabilities = run_capabilities(self.serial)
        self.record["capabilities"] = capabilities
        self.event("capabilities", ok=capabilities["ok"], reason=capabilities.get("reason"))
        if not capabilities["ok"]:
            return self.end("CAPABILITY", capabilities["reason"])
        self.launcher = read_launcher(self.serial)
        if self.launcher is None:
            return self.end("UNKNOWN_STATE", "no default HOME activity resolved")
        verdict = self.check_phone(lock_wait=True)
        if verdict is not None:
            return self.end(*verdict)

        if self.aborted:  # a signal during the preflight: nothing has changed yet
            return self.end("ABORTED", f"signal {self.signals[0]}")
        tokens = read_foreground(self.serial) or []
        self.found = {"launcher": self.launcher, "foreground": tokens,
                      "foregroundIsLauncher": bool(tokens) and all(
                          token.split("/", 1)[0] == self.launcher for token in tokens),
                      "projection": read_projection(self.serial)}
        prior = {}
        for name in RECORDED_SETTINGS:
            value = get_setting(self.serial, name)
            if value is None:
                return self.end("UNKNOWN_STATE", f"setting unreadable: {name}")
            prior[name] = value
        self.prior = prior
        self.record["found"] = self.found
        self.record["settings"] = {"prior": prior}
        # Write-ahead: the record of what to restore exists before anything changes.
        write_json(pending_path(self.serial), {
            "schema": PENDING_SCHEMA, "windowId": self.id, "serial": self.serial,
            "prior": prior, "writtenAt": iso(now_local())})
        self.event("settings.recorded", **{name.split("/", 1)[1]: value for name, value in prior.items()})
        self.applied = True
        put_setting(self.serial, STAY_ON_SETTING, STAY_ON_VALUE)
        read_back = get_setting(self.serial, STAY_ON_SETTING)
        self.record["settings"]["applied"] = {STAY_ON_SETTING: {"value": STAY_ON_VALUE,
                                                                "readBack": read_back}}
        self.event("settings.applied", setting=STAY_ON_SETTING, value=STAY_ON_VALUE, readBack=read_back)
        if read_back != STAY_ON_VALUE:
            return self.end("UNKNOWN_STATE", "stay-awake did not read back")
        refused = self.apply_quiet()
        if refused is not None and self.aborted:
            return self.end("ABORTED", f"signal {self.signals[0]}")
        if refused is not None:
            return self.end("DND", refused)

        if armed:
            self.event("arm.wait", until=iso(opens))
            while not start.passed():
                if not self.sleep(min(ARM_POLL_S, start.remaining())):
                    return self.end("ABORTED", f"signal {self.signals[0]}")
            if not self.pending():
                return self.end("COMPLETE", "queue-empty")

        holds = 0
        while True:
            if self.aborted:
                return self.end("ABORTED", f"signal {self.signals[0]}")
            if not self.pending():
                return self.end("COMPLETE", "queue-drained")
            budget = self.next_budget()
            if stop.remaining() < CHILD_WAIT_S + budget:
                return self.end("DEADLINE", f"no-room-for-the-next-job ({budget:.0f} s)")
            verdict = self.check_phone(lock_wait=True)
            if verdict is not None:
                return self.end(*verdict)
            attempt = self.run_child(stop, budget)
            kind = attempt["kind"]
            if kind == "aborted":
                return self.end("ABORTED", f"signal {self.signals[0]}")
            if kind == "deadline":
                return self.end("DEADLINE", "hard-deadline")
            if kind == "empty":
                return self.end("COMPLETE", "queue-drained")
            if kind in ("failed", "interrupted"):
                return self.end("JOB_FAILED", ",".join(attempt["failed"]) or f"exit {attempt['exit']}")
            if kind == "hold":
                holds += 1
                if holds >= MAX_HOLDS:
                    return self.end("HELD", attempt["hold"])
                continue
            if kind == "done":
                holds = 0
                continue
            return self.end("QUEUE_ERROR", f"queue exit {attempt['exit']}")

    def apply_quiet(self) -> str | None:
        """Heads-up suppression, then Do Not Disturb (ADR 0002, decision 2):
        None once both read back, else why the window refuses. The write-ahead
        record already holds their prior values, so the restore undoes either."""
        applied = self.record["settings"]["applied"]
        put_setting(self.serial, HEADS_UP_SETTING, HEADS_UP_OFF)
        heads_up = get_setting(self.serial, HEADS_UP_SETTING)
        applied[HEADS_UP_SETTING] = {"value": HEADS_UP_OFF, "readBack": heads_up}
        self.event("settings.applied", setting=HEADS_UP_SETTING, value=HEADS_UP_OFF, readBack=heads_up)
        if heads_up != HEADS_UP_OFF:
            return f"heads-up suppression did not read back ({HEADS_UP_SETTING}={heads_up})"
        found = self.prior[DND_SETTING]
        if found != "0":
            applied[DND_SETTING] = {"value": found, "readBack": found, "action": "already-on"}
            self.event("settings.dnd", action="already-on", zenMode=found)
            return None
        code = set_dnd(self.serial, DND_ON)
        zen = get_setting(self.serial, DND_SETTING)
        until = mono() + DND_READBACK_S
        while code == 0 and zen != DND_ON and mono() < until and not self.aborted:
            time.sleep(DND_READBACK_POLL_S)
            zen = get_setting(self.serial, DND_SETTING)
        applied[DND_SETTING] = {"value": DND_ON, "command": f"cmd notification set_dnd {DND_WORDS[DND_ON]}",
                                "exit": code, "readBack": zen}
        self.event("settings.dnd", action="set", value=DND_ON, exit=code, readBack=zen)
        if zen != DND_ON:
            return f"do-not-disturb did not read back (set_dnd exit {code}, zen_mode {zen})"
        return None

    # -- the end: always runs
    def finish(self) -> None:
        """Runs with CLEANUP_SIGNALS held (Window.run)."""
        self.write_signal_events()
        steps = (self.finish_child, self.finish_queue, self.finish_nights, self.finish_leave,
                 self.finish_restore, self.finish_lease, self.finish_morning)
        for step in steps:
            try:
                step()
            except Exception as error:  # every later step still runs
                self.event("cleanup.error", step=step.__name__, detail=repr(error))
        self.write_signal_events()
        # A standard signal is pending at most once however often it was sent.
        self.held = sorted(sig.name for sig in signal.sigpending() & CLEANUP_SIGNALS)
        if self.held:
            self.event("signal.held", signals=",".join(self.held))
        self.record["window"]["closedAt"] = iso(now_local())
        self.record["signals"] = [*self.signals, *self.held]
        self.record["signalsHeldDuringCleanup"] = self.held
        restore = self.record.get("settings", {}).get("restore")
        code = EXIT.get(self.outcome or "ERROR", 1)
        if (restore is not None and not restore["verified"]) or pending_path(self.serial).exists():
            code = EXIT["RESTORE_PENDING"]
        self.record.update({"outcome": self.outcome, "reason": self.reason, "exitCode": code})
        self.event("window.close", outcome=self.outcome, exitCode=code,
                   restored=None if restore is None else restore["verified"],
                   leaseReleased=self.lease_released)
        write_json(self.dir / "window.json", self.record)
        self.events_file.close()

    def finish_child(self) -> None:
        if self.child is not None and self.child.poll() is None:
            self.stop_child("window-end")
            self.child.wait()
            self.child = None

    def finish_queue(self) -> None:
        if self.lease is None:
            return
        released = QUEUE.release_running(f"window {self.id} ended {self.outcome}: job stopped")
        if released:
            self.event("queue.released", jobs=",".join(released))
        # A start outside the window (a late timer, a daytime typo) says
        # nothing about the jobs; it must not overwrite last night's note.
        noted = [] if self.outcome == "OUTSIDE_WINDOW" else QUEUE.note_pending({
            "windowId": self.id, "outcome": self.outcome, "reason": self.reason, "at": iso(now_local())})
        if noted:
            self.event("queue.noted", jobs=",".join(noted), outcome=self.outcome)
        self.record.setdefault("queue", {})["after"] = [
            {"id": job.get("id"), "state": job.get("state"), "kind": job.get("kind")}
            for job in self.queue_jobs()]

    def night_jobs_run(self) -> list[dict]:
        """Every night job this window started, with its record if it wrote one."""
        seen, nights = set(), []
        for attempt in self.record["jobs"]:
            for night in attempt.get("nights", []):
                if night["id"] in seen:
                    continue
                seen.add(night["id"])
                path = night_jobs.job_root() / night["id"] / "job.json"
                try:
                    record = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    record = None
                nights.append({**night, "record": record, "recordPath": str(path)})
        return nights

    def finish_nights(self) -> None:
        """Mistake register 6, the window's side: a night job killed before it
        could observe the title leaves the game wherever the night was. Observe
        it here, force-stopping and relaunching if need be, under the lease."""
        if self.lease is None:
            return
        recoveries = []
        for night in self.night_jobs_run():
            after = ((night["record"] or {}).get("titleAfter") or {}).get("status")
            started = bool((night["record"] or {}).get("runner"))
            if after == "OBSERVED" or (night["record"] is not None and not started):
                continue
            command = [*NIGHT_JOB_COMMAND, "title", "--game", night["game"], "--recover"]
            try:
                result = subprocess.run(command, cwd=ROOT, env=self.child_env(), check=False, text=True,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                        timeout=NIGHT_RECOVERY_S, start_new_session=True)
                line = next((row for row in reversed(result.stdout.splitlines()) if row.startswith("TITLE ")),
                            f"exit {result.returncode}")
                recoveries.append({"job": night["id"], "exit": result.returncode, "title": line[:500]})
            except subprocess.TimeoutExpired:
                recoveries.append({"job": night["id"], "exit": None, "title": "timeout"})
            self.event("night.title-recovery", **recoveries[-1])
        if recoveries:
            self.record["nightRecoveries"] = recoveries

    def finish_morning(self) -> None:
        """Pack each night's evidence and write one summary line for the window.

        Host-only, after the lease: `evidence pack` for a FNaF 2 or FNaF 1 run
        that night-run.sh did not already pack (a killed runner never reaches
        its own pack), and the run record for FNaF 4."""
        nights = []
        for night in self.night_jobs_run():
            record = night["record"] or {}
            run_id = record.get("runId")
            entry = {"job": night["id"], "game": night["game"], "night": night["night"],
                     "outcome": record.get("outcome", "NO_RECORD"), "runId": run_id,
                     "terminal": (record.get("terminal") or {}).get("outcome")}
            if run_id and night["game"] in ("fnaf2", "fnaf1"):
                pack_dir = PACKS_ROOT / "docs/evidence/runs" / run_id
                if not pack_dir.is_dir() and (RUNS_ROOT / "artifacts/runs" / run_id).is_dir():
                    try:
                        result = subprocess.run([*PACK_COMMAND, run_id], cwd=ROOT, check=False, text=True,
                                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                                timeout=PACK_TIMEOUT_S, start_new_session=True)
                        entry["packExit"] = result.returncode
                        entry["packOutput"] = result.stdout[-500:]
                    except subprocess.TimeoutExpired:
                        entry["packExit"] = None
                    entry["pack"] = "packed" if pack_dir.is_dir() else "FAILED"
                else:
                    entry["pack"] = "present" if pack_dir.is_dir() else "no-run-directory"
                try:
                    entry["packOutcome"] = json.loads((pack_dir / "pack.json").read_text(encoding="utf-8")).get("outcome")
                    entry["packDir"] = str(pack_dir.relative_to(PACKS_ROOT))
                except (OSError, ValueError):
                    pass
            elif run_id and night["game"] == "fnaf4":
                run_json = RUNS_ROOT / "artifacts/runs" / run_id / "run.json"
                entry["pack"] = "run-record" if run_json.is_file() else "no-run-record"
                entry["runRecord"] = str(run_json.relative_to(RUNS_ROOT))
            else:
                entry["pack"] = "no-run"
            nights.append(entry)
        restore = (self.record.get("settings") or {}).get("restore")
        parts = [f"{night['game']} N{night['night']} {night['runId'] or '-'} {night['outcome']}"
                 f"{'/' + str(night['terminal']) if night['terminal'] else ''} pack={night['pack']}"
                 f"{':' + str(night.get('packOutcome')) if night.get('packOutcome') else ''}" for night in nights]
        setups = sum(len(attempt.get("done", [])) for attempt in self.record["jobs"]) - \
            sum(1 for night in nights if night["outcome"] == "NIGHT_PLAYED")
        line = (f"{self.record['window'].get('start', self.record['window']['openedAt'])[:10]} {self.id} "
                f"{self.outcome} ({self.reason}) | nights {len(nights)}: {'; '.join(parts) or 'none'} | "
                f"other jobs done {max(0, setups)} | restored "
                f"{'n/a' if restore is None else ('verified' if restore['verified'] else 'NOT VERIFIED')} | "
                f"lease {'released' if self.lease_released else 'not held'}")
        self.record["morning"] = {"nights": nights, "summary": line}
        summary = window_dir() / "summary.log"
        summary.parent.mkdir(parents=True, exist_ok=True)
        with summary.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        print(f"MORNING {line}", flush=True)

    def finish_leave(self) -> None:
        """Leave the screen as the window found it: projection, then foreground."""
        if not self.applied:
            return
        leave: dict = {}
        if self.found.get("projection") is False and read_projection(self.serial) is True:
            try:
                result = subprocess.run(HELPER_STOP_COMMAND, cwd=ROOT, env=self.child_env(),
                                        check=False, text=True, stdout=subprocess.PIPE,
                                        stderr=subprocess.STDOUT, timeout=LEAVE_TIMEOUT_S,
                                        start_new_session=True)
                leave["helperStop"] = {"exit": result.returncode, "output": result.stdout[-500:]}
            except subprocess.TimeoutExpired:
                leave["helperStop"] = {"exit": None, "output": "timeout"}
        tokens = read_foreground(self.serial) or []
        ours = [token for token in tokens if token.split("/", 1)[0] in {COMPANION, *TARGETS}]
        if self.found.get("foregroundIsLauncher") and ours and len(ours) == len(tokens):
            code, _ = adb(self.serial, "shell", "input", "keyevent", "KEYCODE_HOME")
            leave["home"] = {"exit": code, "from": tokens}
        leave["foregroundAfter"] = read_foreground(self.serial)
        self.record["leave"] = leave
        self.event("leave", **{key: json.dumps(value) for key, value in leave.items()})

    def finish_restore(self) -> None:
        if not self.applied:
            return
        restore = restore_settings(self.serial, self.prior, event=self.event)
        self.record["settings"]["restore"] = restore
        if restore["verified"]:
            pending_path(self.serial).unlink(missing_ok=True)
        for row in restore["settings"]:
            self.event("settings.restore", **row)

    def finish_lease(self) -> None:
        acquired = self.lease is not None
        if acquired:
            self.lease.__exit__(None, None, None)
            self.lease = None
            self.lease_released = True
            self.event("lease.released")
        # LEASE_BUSY never held it: acquired false, and nothing to release.
        self.record["lease"] = {"acquired": acquired, "released": self.lease_released}


def recover(serial: str, event=lambda *a, **k: None) -> dict:
    """Restore the settings a killed window recorded but never put back."""
    path = pending_path(serial)
    try:
        pending = json.loads(path.read_text(encoding="utf-8"))
        prior = {name: value for name, value in pending["prior"].items()
                 if isinstance(value, str) and SETTING_VALUE.fullmatch(value)}
        if pending.get("schema") != PENDING_SCHEMA or pending.get("serial") != serial:
            raise ValueError("pending restore record is for another schema or serial")
    except (OSError, ValueError, KeyError, TypeError) as error:
        return {"verified": False, "reason": f"pending-unreadable: {error}", "file": str(path)}
    event("recover.start", windowId=pending.get("windowId"))
    if not device_present(serial):
        return {"verified": False, "reason": "device-absent", "windowId": pending.get("windowId")}
    result = restore_settings(serial, prior, event=event)
    result["windowId"] = pending.get("windowId")
    if result["verified"]:
        path.unlink(missing_ok=True)
    event("recover.end", verified=result["verified"])
    return result


# --- the other commands --------------------------------------------------------

def dry_run(config: dict) -> int:
    now = now_local()
    window = window_for(now, config)
    try:
        jobs = QUEUE.read_jobs(QUEUE.queue_path())
    except QUEUE.QueueError as error:
        print(f"queue    UNREADABLE {error}")
        jobs = []
    print("DRY RUN, the phone is not touched (add --live --confirm-live to run the window)")
    print(f"config   {canonical_sha256(config)}")
    print(json.dumps(config, indent=2, sort_keys=True))
    if window is None:
        print(f"window   OUTSIDE_WINDOW at {iso(now)}")
    else:
        opens, closes = window
        stop = closes - timedelta(seconds=RESTORE_BUDGET_S + NIGHT_RECOVERY_S + STOP_GRACE_S
                                  + TERM_GRACE_S + KILL_GRACE_S)
        print(f"window   {iso(opens)} .. {iso(closes)}{' (would arm early)' if now < opens else ''}")
        print(f"deadline the queue child is stopped at {iso(stop)}; a setup or check starts no later than "
              f"{iso(stop - timedelta(seconds=CHILD_WAIT_S + JOB_TIMEOUT_S))}")
        for job in jobs:
            if job.get("state") == "PENDING" and job.get("kind") == "night":
                latest = stop - timedelta(seconds=CHILD_WAIT_S + float(job.get("budgetS", 0)))
                print(f"night    {job.get('id')} {job.get('game')} N{job.get('night')} budget "
                      f"{int(job.get('budgetS', 0))} s: starts no later than {iso(latest)}"
                      f"{'' if latest > opens else ' (NEVER: longer than the window)'}")
    pending = pending_path(config["serial"]) if config["serial"] != "UNKNOWN" else None
    if pending is not None and pending.exists():
        print(f"pending  {pending} (an earlier window left settings unrestored)")
    print(f"queue    {len([j for j in jobs if j.get('state') == 'PENDING'])} pending of {len(jobs)}")
    QUEUE.print_jobs(jobs)
    return 0


def preflight(config: dict, as_json: bool) -> int:
    """Every read the window decides on, and what it would decide: no writes."""
    serial = config["serial"]
    if serial == "UNKNOWN":
        print(f"PREFLIGHT ERROR a serial is required: {SERIAL_HOW_TO}", file=sys.stderr)
        return 2
    report: dict = {"schema": "overnight-window-preflight-v1", "serial": serial,
                    "configSha256": canonical_sha256(config), "at": iso(now_local())}
    try:
        lease = DeviceLock(serial).__enter__()
    except DeviceBusy as error:
        report["phone"] = {"outcome": "LEASE_BUSY", "reason": str(error)}
        print(json.dumps(report, indent=2, sort_keys=True) if as_json
              else f"PREFLIGHT LEASE_BUSY {error}")
        return 75
    try:
        window = window_for(now_local(), config)
        report["window"] = None if window is None else [iso(window[0]), iso(window[1])]
        try:
            jobs = QUEUE.read_jobs(QUEUE.queue_path())
        except QUEUE.QueueError as error:
            jobs = []
            report["queueError"] = str(error)
        report["pendingJobs"] = len([job for job in jobs if job.get("state") == "PENDING"])
        report["pendingRestore"] = pending_path(serial).exists()
        report["present"] = device_present(serial)
        verdict: tuple[str, str] | None = ("DEVICE_ABSENT", "adb get-state is not device")
        if report["present"]:
            report["capabilities"] = run_capabilities(serial)
            report["launcher"] = read_launcher(serial)
            report["power"] = read_power(serial)
            report["callStates"] = read_call_states(serial)
            report["foreground"] = read_foreground(serial)
            report["battery"] = read_battery(serial)
            report["projection"] = read_projection(serial)
            report["settings"] = {name: get_setting(serial, name) for name in RECORDED_SETTINGS}
            if not report["capabilities"]["ok"]:
                verdict = ("CAPABILITY", report["capabilities"]["reason"])
            elif report["launcher"] is None:
                verdict = ("UNKNOWN_STATE", "no default HOME activity resolved")
            elif None in report["settings"].values():
                verdict = ("UNKNOWN_STATE", "a setting is unreadable")
            else:
                verdict = assess_phone(serial, config, report["launcher"], 0.0)
        report["phone"] = ({"outcome": "FIT"} if verdict is None
                           else {"outcome": verdict[0], "reason": verdict[1]})
    finally:
        lease.__exit__(None, None, None)
    if as_json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        for key in ("serial", "window", "pendingJobs", "pendingRestore", "present", "capabilities",
                    "launcher", "power", "callStates", "foreground", "battery", "projection",
                    "settings", "phone"):
            if key in report:
                print(f"{key:14} {json.dumps(report[key], sort_keys=True)}")
    return 0 if verdict is None else 75


def restore_command(config: dict) -> int:
    serial = config["serial"]
    if serial == "UNKNOWN":
        print(f"RESTORE ERROR a serial is required: {SERIAL_HOW_TO}", file=sys.stderr)
        return 2
    path = pending_path(serial)
    if not path.exists():
        print("RESTORE NOTHING-PENDING")
        return 0
    try:
        lease = DeviceLock(serial).__enter__()
    except DeviceBusy as error:
        print(f"RESTORE HOLD reason=device-busy detail={error}")
        return 75
    try:
        result = recover(serial, lambda kind, **fields: print(f"RESTORE {kind} {fields}", flush=True))
    finally:
        lease.__exit__(None, None, None)
    target = window_dir() / str(result.get("windowId") or "unknown-window")
    write_json(target / f"recovery-{now_local().strftime('%Y%m%dT%H%M%S%z')}.json", result)
    print(f"RESTORE {'VERIFIED' if result['verified'] else 'PENDING'} {json.dumps(result, sort_keys=True)}")
    return 0 if result["verified"] else EXIT["RESTORE_PENDING"]


def main_checkout() -> Path:
    """Every worktree's timer would run the main checkout: resolve it."""
    try:
        common = subprocess.run(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
                                cwd=ROOT, check=True, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=10).stdout.strip()
        return Path(common).parent
    except (OSError, subprocess.SubprocessError):
        return ROOT


def render_units(config: dict, out: str | None) -> int:
    if config["serial"] == "UNKNOWN":
        print(f"UNITS ERROR the unit names its phone: {SERIAL_HOW_TO}", file=sys.stderr)
        return 2
    tools = {name: shutil.which(name) for name in ("adb", "node")}
    missing = [name for name, path in tools.items() if path is None]
    if missing:
        print(f"UNITS ERROR not on PATH: {', '.join(missing)} (the unit's PATH is built from them)",
              file=sys.stderr)
        return 2
    root = main_checkout()
    script = root / "apps/lab/overnight-window.py"
    path_dirs = []
    for directory in [str(Path(p).parent) for p in tools.values()] + ["/usr/local/bin", "/usr/bin", "/bin"]:
        if directory not in path_dirs:
            path_dirs.append(directory)
    start = parse_clock(config["start"], "start")
    length = window_length_s(start, parse_clock(config["end"], "end"))
    stop_s = int(STOP_GRACE_S + TERM_GRACE_S + KILL_GRACE_S + NIGHT_RECOVERY_S + RESTORE_BUDGET_S + 60)
    runtime_s = int(config["maxArmLeadS"] + length + stop_s + RESTORE_RETRY_S + PACK_TIMEOUT_S * 4)
    env = {"PATH": ":".join(path_dirs), "FNAF_SERIAL": config["serial"],
           "FNAF_WINDOW_START": config["start"], "FNAF_WINDOW_END": config["end"],
           "FNAF_WINDOW_BATTERY_FLOOR": str(config["batteryFloorPercent"])}
    python = sys.executable or "/usr/bin/python3"
    service = "\n".join([
        "# Rendered by apps/lab/overnight-window.py units; edit the flags there, not here.",
        "[Unit]",
        "Description=FNaF 2 overnight device window (Companion queue on the owner's phone)",
        f"Documentation=file://{root}/docs/operations/DEVICE-SAFETY.md",
        "",
        "[Service]",
        "Type=exec",
        f"WorkingDirectory={root}",
        *[f"Environment={key}={value}" for key, value in env.items()],
        f"ExecStart={python} {script} run --live --confirm-live",
        "# However the window ended -- even SIGKILL -- put back what it recorded.",
        f"ExecStopPost={python} {script} restore --live --confirm-live",
        "# SIGTERM to the runner only: it stops its queue child in order, then restores.",
        "KillMode=mixed",
        f"TimeoutStopSec={stop_s}",
        f"RuntimeMaxSec={runtime_s}",
        "",
    ])
    timer = "\n".join([
        "# Rendered by apps/lab/overnight-window.py units.",
        "[Unit]",
        f"Description=Open the FNaF 2 overnight device window at {config['start']}",
        "",
        "[Timer]",
        f"OnCalendar=*-*-* {start.strftime('%H:%M:%S')}",
        "# A missed start is not made up later: the window refuses outside its hours anyway.",
        "Persistent=false",
        "AccuracySec=1min",
        "",
        "[Install]",
        "WantedBy=timers.target",
        "",
    ])
    units = {"fnaf2-overnight-window.service": service, "fnaf2-overnight-window.timer": timer}
    if out is None:
        for name, text in units.items():
            print(f"# ---- {name}\n{text}")
        return 0
    directory = Path(out).expanduser()
    directory.mkdir(parents=True, exist_ok=True)
    for name, text in units.items():
        (directory / name).write_text(text, encoding="utf-8")
        print(f"UNITS wrote {directory / name}")
    print("UNITS nothing was enabled; systemctl --user daemon-reload, then enable the timer yourself")
    return 0


def parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Overnight device window for the Companion queue")
    parser.add_argument("command", nargs="?", default="run",
                        choices=("run", "preflight", "restore", "units"))
    parser.add_argument("--live", action="store_true", help="touch the phone (run, restore)")
    parser.add_argument("--confirm-live", action="store_true", help="required with --live")
    parser.add_argument("--serial", default=None,
                        help="the phone (else FNAF_SERIAL, ANDROID_SERIAL, then the local profile)")
    parser.add_argument("--start", default=None, help=f"window start HH:MM local (default {DEFAULT_START})")
    parser.add_argument("--end", default=None, help=f"window end HH:MM local (default {DEFAULT_END})")
    parser.add_argument("--battery-floor", type=int, default=None,
                        help=f"percent (default {BATTERY_FLOOR_PERCENT}; env FNAF_WINDOW_BATTERY_FLOOR)")
    parser.add_argument("--temperature-ceiling", type=float, default=None,
                        help=f"battery Celsius (default {TEMPERATURE_CEILING_C})")
    parser.add_argument("--lock-wait", type=float, default=None,
                        help=f"seconds a locked phone is waited for (default {int(LOCK_WAIT_S)})")
    parser.add_argument("--max-arm-lead", type=float, default=None,
                        help=f"seconds before the start a window may be armed (default {int(MAX_ARM_LEAD_S)})")
    parser.add_argument("--out", default=None, help="units: directory to write the unit files to")
    parser.add_argument("--json", action="store_true", help="preflight: print JSON")
    args = parser.parse_args(argv)
    if args.battery_floor is None and os.environ.get("FNAF_WINDOW_BATTERY_FLOOR"):
        try:
            args.battery_floor = int(os.environ["FNAF_WINDOW_BATTERY_FLOOR"])
        except ValueError:
            parser.error("FNAF_WINDOW_BATTERY_FLOOR must be an integer")
    if args.live != args.confirm_live:
        parser.error("--live and --confirm-live go together")
    if args.live and args.command not in ("run", "restore"):
        parser.error(f"{args.command} takes no --live")
    if args.command == "restore" and not args.live:
        parser.error("restore writes settings: pass --live --confirm-live")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse(argv)
    try:
        config = resolve_config(args)
    except ConfigError as error:
        print(f"WINDOW ERROR {error}", file=sys.stderr)
        return 2
    if args.command == "units":
        return render_units(config, args.out)
    if args.command == "preflight":
        return preflight(config, args.json)
    if args.command == "restore":
        return restore_command(config)
    if not args.live:
        return dry_run(config)
    if config["serial"] == "UNKNOWN":
        print(f"WINDOW ERROR a live window needs a serial: {SERIAL_HOW_TO}", file=sys.stderr)
        return 2
    return Window(config).run()


if __name__ == "__main__":
    raise SystemExit(main())
