#!/usr/bin/env python3
"""No-device fixture test for the overnight window (overnight-window.py).

Every window here runs against a fake `adb` that keeps the phone's state in a
JSON file and logs every call, so the test can say exactly what the runner
asked of the phone. It never reaches a real device: the fake answers only its
own serial, and it is first on PATH with ADB_BIN unset.

Covered: the settings are recorded and restored, and each is read back, on a
normal end, on an abort (SIGINT to the process group, twice), on a job failure
(the real queue and the real setup, which borrows the window's lease), and at
the hard deadline (a child that ignores SIGINT and SIGTERM). The LOCKED,
IN_USE, POWER, LEASE_BUSY and OUTSIDE_WINDOW refusals change nothing. A killed
window's settings are recovered. The lease is free after every window. The
runner never writes lock-screen, airplane, Do Not Disturb or any setting
outside its list, never taps, and never issues a command the fake does not
know.
"""

from __future__ import annotations

import importlib.util
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WINDOW = HERE / "overnight-window.py"
SERIAL = "FAKE0001"
sys.path.insert(0, str(HERE))
from cue_helper_device_lock import DeviceBusy, DeviceLock  # noqa: E402

SPEC = importlib.util.spec_from_file_location("cue_helper_queue", HERE / "cue-helper-queue.py")
assert SPEC and SPEC.loader
QUEUE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(QUEUE)

FAKE_ADB = r'''#!/usr/bin/env python3
import fcntl, json, os, sys
path = os.environ["FAKE_ADB_STATE"]
args = sys.argv[1:]
serial = os.environ.get("ANDROID_SERIAL")
if args[:1] == ["-s"]:
    serial, args = args[1], args[2:]
out, code, known = "", 0, True
with open(path + ".lock", "a") as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    with open(path) as handle:
        state = json.load(handle)
    command = " ".join(args[1:]) if args[:1] == ["shell"] else None
    if args == ["devices", "-l"]:
        out = "List of devices attached\n" + (state["serial"] + " device usb:1-1\n" if state["present"] else "")
    elif not state["present"] or serial != state["serial"]:
        out, code = "error: device '%s' not found" % serial, 1
    elif args == ["get-state"]:
        out = "device"
    elif command is None:
        known, code = False, 1
    elif args[1:3] == ["settings", "get"]:
        out = state["settings"].get(args[3] + "/" + args[4], "null")
    elif args[1:3] == ["settings", "put"]:
        state["settings"][args[3] + "/" + args[4]] = args[5]
    elif args[1:3] == ["settings", "delete"]:
        state["settings"].pop(args[3] + "/" + args[4], None)
    elif command == "dumpsys power":
        out = "  mWakefulness=" + ("Awake" if state["awake"] else "Asleep")
    elif command == "dumpsys window policy":
        out = "  isKeyguardShowing=" + ("true" if state["keyguard"] else "false")
    elif command == "dumpsys window":
        out = "  mCurrentFocus=null\n  mCurrentFocus=Window{1a2b u0 %s}" % state["focus"]
    elif command == "dumpsys telephony.registry":
        out = "".join("  mCallState=%d\n" % value for value in state["calls"])
    elif command == "dumpsys battery":
        battery = state["battery"]
        out = ("Current Battery Service state:\n  AC powered: false\n  USB powered: %s\n"
               "  Wireless powered: false\n  Dock powered: false\n  status: 2\n  level: %d\n"
               "  scale: 100\n  temperature: %d\n" % (
                   "true" if battery["plugged"] else "false", battery["level"], battery["temp10"]))
    elif command == "dumpsys media_projection":
        out = "  com.ppvaz.fnafcompanion TYPE_SCREEN_CAPTURE" if state["projection"] else "  (none)"
    elif command == "dumpsys package com.ppvaz.fnafcompanion":
        out = state["helperDump"]
    elif command.startswith("dumpsys package "):
        out = ""
    elif command == ("cmd package resolve-activity --brief -a android.intent.action.MAIN "
                     "-c android.intent.category.HOME"):
        out = "priority=0 preferredOrder=0 match=0x108000 isDefault=true\ncom.fake.launcher/.Home"
    elif command == "input keyevent KEYCODE_HOME":
        state["focus"] = "com.fake.launcher/com.fake.launcher.Home"
    elif command == "am force-stop com.ppvaz.fnafcompanion":
        state["projection"] = False
    elif args[1:2] == ["getprop"]:
        out = {"ro.build.version.release": "15", "ro.build.version.sdk": "35",
               "ro.product.model": "fixture"}.get(args[2], "")
    elif command == "perfetto --query":
        out = "android.surfaceflinger.frame\nlinux.ftrace\n"
    elif command == "wm size":
        out = "Physical size: 1080x2400"
    elif command in ("ls /system/bin/hid", "ls /system/bin/screenrecord"):
        out = args[2]
    elif command == "pm list packages com.scottgames.fnaf2":
        out = "package:com.scottgames.fnaf2"
    elif args[1:2] == ["__fixture"]:
        state[args[2]] = json.loads(args[3])
    else:
        known, code = False, 1
    with open(path + ".log", "a") as log:
        log.write(json.dumps({"actor": os.environ.get("FAKE_ADB_ACTOR", "runner"),
                              "serial": serial, "args": args, "known": known}) + "\n")
    with open(path, "w") as handle:
        json.dump(state, handle)
print(out)
sys.exit(code)
'''

# Stands in for `cue-helper-queue.sh run --max-jobs 1`: one scripted step per call.
FAKE_QUEUE = r'''#!/usr/bin/env python3
import json, os, signal, subprocess, sys, time
script = os.environ["FAKE_QUEUE_SCRIPT"]
with open(script) as handle:
    steps = json.load(handle)
counter = script + ".n"
n = int(open(counter).read()) if os.path.exists(counter) else 0
open(counter, "w").write(str(n + 1))
with open(script + ".argv", "a") as handle:
    handle.write(json.dumps(sys.argv[1:]) + "\n")
step = steps[n] if n < len(steps) else "empty"
env = {**os.environ, "FAKE_ADB_ACTOR": "job"}
def adb(*args):
    subprocess.run(["adb", *args], env=env, check=True, stdout=subprocess.DEVNULL)
def fixture(key, value):
    adb("shell", "__fixture", key, json.dumps(value))
if step == "empty":
    print("QUEUE EMPTY")
    sys.exit(0)
print("RUNNING id=fake-%d kind=menu-check screen=menu" % n, flush=True)
if step == "drift":  # a job that opens the game, starts capture and moves a setting
    fixture("focus", "com.scottgames.fnaf2/com.scottgames.fnaf2.Main")
    fixture("projection", True)
    adb("shell", "settings", "put", "system", "screen_brightness", "200")
    step = "done"
if step == "use-phone":  # the owner picks the phone up during a job
    fixture("focus", "com.whatsapp/com.whatsapp.HomeActivity")
    step = "done"
if step == "done":
    print("DONE id=fake-%d\nQUEUE PAUSED done=1" % n)
    sys.exit(0)
if step == "hang":
    time.sleep(600)
if step == "stubborn":
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    print("stubborn: ignoring SIGINT and SIGTERM", flush=True)
    time.sleep(600)
sys.exit(9)
'''

DRIVER = r'''
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("overnight_window", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
for key, value in json.loads(sys.argv[2]).items():
    setattr(module, key, value)
sys.exit(module.main(sys.argv[3:]))
'''

FAST = {
    "JOB_TIMEOUT_S": 1.0, "CHILD_WAIT_S": 0.5, "QUEUE_INTERVAL_S": 0.1,
    "STOP_GRACE_S": 1.0, "TERM_GRACE_S": 1.0, "KILL_GRACE_S": 1.0,
    "RESTORE_BUDGET_S": 1.5, "RESTORE_RETRY_S": 0.0, "RESTORE_RETRY_POLL_S": 0.1,
    "LOCK_POLL_S": 0.2, "ARM_POLL_S": 0.1,
}
PRIOR = {
    "global/stay_on_while_plugged_in": "0", "system/screen_off_timeout": "30000",
    "system/screen_brightness": "120", "system/screen_brightness_mode": "1",
    "global/airplane_mode_on": "0", "global/zen_mode": "0",
}
RESTORED = {"global/stay_on_while_plugged_in", "system/screen_off_timeout",
            "system/screen_brightness", "system/screen_brightness_mode"}

failures: list[str] = []
passed = 0


def check(name: str, condition: bool, detail: object = "") -> None:
    global passed
    if condition:
        passed += 1
    else:
        failures.append(f"{name}: {detail}")


def clock(offset_s: float) -> str:
    return (datetime.now() + timedelta(seconds=offset_s)).strftime("%H:%M:%S")


class Case:
    def __init__(self, base: Path, name: str, lock_dir: Path, **state):
        self.dir = base / name
        self.dir.mkdir()
        self.bin = self.dir / "bin"
        self.bin.mkdir()
        (self.bin / "adb").write_text(FAKE_ADB, encoding="utf-8")
        (self.bin / "adb").chmod(0o755)
        self.fake_queue = self.dir / "fake-queue.py"
        self.fake_queue.write_text(FAKE_QUEUE, encoding="utf-8")
        self.fake_queue.chmod(0o755)
        self.driver = self.dir / "driver.py"
        self.driver.write_text(DRIVER, encoding="utf-8")
        self.state_path = self.dir / "phone.json"
        self.queue_file = self.dir / "jobs.json"
        self.window_dir = self.dir / "windows"
        self.steps = self.dir / "steps.json"
        self.lock_dir = lock_dir
        phone = {"serial": SERIAL, "present": True, "awake": True, "keyguard": False,
                 "focus": "com.fake.launcher/com.fake.launcher.Home", "calls": [0],
                 "battery": {"plugged": True, "level": 88, "temp10": 310},
                 "projection": False, "helperDump": "    versionCode=14 minSdk=29\n    versionName=0.1.14\n",
                 "settings": dict(PRIOR)}
        phone.update(state)
        self.state_path.write_text(json.dumps(phone), encoding="utf-8")

    def env(self) -> dict:
        env = {key: value for key, value in os.environ.items()
               if key not in ("ANDROID_SERIAL", "FNAF_SERIAL", "ADB_BIN", "CUE_HELPER_LEASE_OWNER_PID",
                              "FNAF_WINDOW_START", "FNAF_WINDOW_END", "FNAF_WINDOW_BATTERY_FLOOR")}
        env.update({"PATH": f"{self.bin}:{os.environ['PATH']}", "FAKE_ADB_STATE": str(self.state_path),
                    "FAKE_QUEUE_SCRIPT": str(self.steps), "CUE_HELPER_QUEUE_FILE": str(self.queue_file),
                    "CUE_HELPER_LOCK_DIR": str(self.lock_dir), "FNAF_WINDOW_DIR": str(self.window_dir)})
        return env

    def jobs(self, count: int, steps: list[str] | None = None) -> None:
        jobs = [QUEUE.make_job("menu-check", "menu", False, False) for _ in range(count)]
        self.queue_file.write_text(json.dumps(jobs) + "\n", encoding="utf-8")
        self.steps.write_text(json.dumps(steps or []), encoding="utf-8")

    def argv(self, command: str, *extra: str, fake_queue: bool = True, live: bool = True,
             start: float = -60.0, end: float = 120.0, constants: dict | None = None) -> list[str]:
        values = {**FAST, **(constants or {})}
        if fake_queue:
            values["QUEUE_COMMAND"] = [sys.executable, str(self.fake_queue)]
        return [sys.executable, str(self.driver), str(WINDOW), json.dumps(values), command,
                "--serial", SERIAL, "--start", clock(start), "--end", clock(end), "--lock-wait", "1",
                *(["--live", "--confirm-live"] if live else []), *extra]

    def run(self, command: str = "run", *extra: str, **options) -> subprocess.CompletedProcess:
        return subprocess.run(self.argv(command, *extra, **options), cwd=ROOT, env=self.env(),
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)

    def start(self, command: str = "run", *extra: str, **options) -> subprocess.Popen:
        return subprocess.Popen(self.argv(command, *extra, **options), cwd=ROOT, env=self.env(),
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                start_new_session=True)

    def phone(self) -> dict:
        return json.loads(self.state_path.read_text(encoding="utf-8"))

    def calls(self, actor: str | None = "runner") -> list[dict]:
        log = Path(f"{self.state_path}.log")
        rows = [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
        return [row for row in rows if actor is None or row["actor"] == actor]

    def writes(self) -> list[list[str]]:
        return [row["args"] for row in self.calls()
                if row["args"][1:3] in (["settings", "put"], ["settings", "delete"])]

    def record(self) -> dict:
        files = sorted(self.window_dir.glob("window-*/window.json"))
        return json.loads(files[-1].read_text(encoding="utf-8")) if files else {}

    def events_file(self) -> Path | None:
        files = sorted(self.window_dir.glob("window-*/events.jsonl"))
        return files[-1] if files else None

    def queue_jobs(self) -> list[dict]:
        return json.loads(self.queue_file.read_text(encoding="utf-8")) if self.queue_file.exists() else []


def lease_is_free(lock_dir: Path) -> bool:
    previous = os.environ.get("CUE_HELPER_LOCK_DIR")
    os.environ["CUE_HELPER_LOCK_DIR"] = str(lock_dir)
    try:
        with DeviceLock(SERIAL):
            return True
    except DeviceBusy:
        return False
    finally:
        if previous is None:
            os.environ.pop("CUE_HELPER_LOCK_DIR", None)
        else:
            os.environ["CUE_HELPER_LOCK_DIR"] = previous


def restored_to_prior(case: Case, name: str, record: dict) -> None:
    settings = case.phone()["settings"]
    check(f"{name}: every setting is back at its recorded value",
          all(settings.get(key) == value for key, value in PRIOR.items()),
          {key: settings.get(key) for key in PRIOR})
    restore = record.get("settings", {}).get("restore", {})
    check(f"{name}: the restore was read back and verified", restore.get("verified") is True, restore)
    check(f"{name}: every recorded setting has a restore row",
          {row["setting"] for row in restore.get("settings", [])} == set(PRIOR), restore)
    check(f"{name}: stay-awake was set to 7 and read back",
          record.get("settings", {}).get("applied", {}).get("global/stay_on_while_plugged_in")
          == {"value": "7", "readBack": "7"}, record.get("settings", {}).get("applied"))
    check(f"{name}: no pending-restore record is left",
          not list(case.window_dir.glob("pending-restore-*.json")))


def unchanged(case: Case, name: str) -> None:
    check(f"{name}: the runner wrote no setting", case.writes() == [], case.writes())
    check(f"{name}: the phone's settings are untouched", case.phone()["settings"] == PRIOR)
    check(f"{name}: no pending-restore record", not list(case.window_dir.glob("pending-restore-*.json")))


def pure_checks() -> None:
    """The window arithmetic, in process: no phone, no subprocess."""
    spec = importlib.util.spec_from_file_location("overnight_window", WINDOW)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    config = {"start": "01:30", "end": "07:00", "maxArmLeadS": 4 * 3600.0}
    at = lambda text: datetime.fromisoformat(text).astimezone()  # noqa: E731
    inside = module.window_for(at("2026-09-28T03:00:00"), config)
    check("pure: 03:00 is inside the 01:30-07:00 window",
          inside is not None and inside[0].strftime("%d %H:%M") == "28 01:30"
          and inside[1].strftime("%d %H:%M") == "28 07:00", inside)
    armed = module.window_for(at("2026-09-27T22:30:00"), config)
    check("pure: 22:30 arms the next night's window",
          armed is not None and armed[0].strftime("%d %H:%M") == "28 01:30", armed)
    check("pure: 20:00 is outside (earlier than the 4 h lead)",
          module.window_for(at("2026-09-27T20:00:00"), config) is None)
    check("pure: 07:00 is outside (the end is exclusive)",
          module.window_for(at("2026-09-28T07:00:00"), config) is None)
    spanning = {"start": "23:00", "end": "06:00", "maxArmLeadS": 0.0}
    late = module.window_for(at("2026-09-28T02:00:00"), spanning)
    check("pure: a window across midnight holds 02:00",
          late is not None and late[0].strftime("%d %H:%M") == "27 23:00"
          and late[1].strftime("%d %H:%M") == "28 06:00", late)
    # A host that slept through the deadline: the monotonic clock says an hour
    # remains, the wall clock says it passed two hours ago.
    slept = module.Deadline(3600.0, module.now_local() - timedelta(hours=3), module.mono())
    check("pure: a deadline the host slept through has passed", slept.passed(), slept.remaining())
    stepped = module.Deadline(3600.0, module.now_local(), module.mono() - 7200.0)
    check("pure: a deadline the monotonic clock passed has passed", stepped.passed(), stepped.remaining())
    check("pure: a future deadline has not passed",
          not module.Deadline(60.0, module.now_local(), module.mono()).passed())
    kinds = {token: module.classify_foreground([token], "com.fake.launcher")[0] for token in (
        "com.fake.launcher/.Home", "com.scottgames.fnaf2/.Main", "com.ppvaz.fnafcompanion/.MainActivity",
        "com.whatsapp/.HomeActivity", "NotificationShade", "com.android.systemui/.media.Permission")}
    check("pure: only the launcher, the Companion and the targets are not in use",
          kinds == {"com.fake.launcher/.Home": "ok", "com.scottgames.fnaf2/.Main": "ok",
                    "com.ppvaz.fnafcompanion/.MainActivity": "ok", "com.whatsapp/.HomeActivity": "in-use",
                    "NotificationShade": "in-use", "com.android.systemui/.media.Permission": "in-use"}, kinds)
    try:
        module.put_setting(SERIAL, "global/zen_mode", "0")
        check("pure: the window refuses to write Do Not Disturb", False)
    except ValueError:
        check("pure: the window refuses to write Do Not Disturb", True)
    try:
        module.put_setting(SERIAL, STAY, "7; reboot")
        check("pure: a setting value is a number or null, never shell text", False)
    except ValueError:
        check("pure: a setting value is a number or null, never shell text", True)


STAY = "global/stay_on_while_plugged_in"


def main() -> int:
    pure_checks()
    with tempfile.TemporaryDirectory(prefix="overnight-window-test-") as scratch:
        base = Path(scratch)
        lock_dir = base / "locks"
        cases: list[Case] = []

        def case(name: str, **state) -> Case:
            made = Case(base, name, lock_dir, **state)
            cases.append(made)
            return made

        # --- dry run: the default touches nothing
        dry = case("dry")
        dry.jobs(1)
        result = dry.run("run", live=False)
        check("dry: exit 0", result.returncode == 0, result.stdout)
        check("dry: says it is a dry run", "DRY RUN, the phone is not touched" in result.stdout, result.stdout)
        check("dry: no adb call at all", dry.calls(None) == [], dry.calls(None))
        check("dry: no window record", not dry.window_dir.exists())

        # --- units: rendered, never installed
        units = case("units")
        result = units.run("units", "--out", str(units.dir / "units"), "--start", "01:30", "--end", "07:00",
                           live=False)
        service = (units.dir / "units/fnaf2-overnight-window.service")
        timer = (units.dir / "units/fnaf2-overnight-window.timer")
        check("units: exit 0 and both files", result.returncode == 0 and service.exists() and timer.exists(),
              result.stdout)
        if service.exists() and timer.exists():
            text, timing = service.read_text(), timer.read_text()
            check("units: the service runs the live window and restores after it",
                  "run --live --confirm-live" in text and "restore --live --confirm-live" in text
                  and "ExecStopPost=" in text, text)
            check("units: SIGTERM reaches the runner only", "KillMode=mixed" in text, text)
            check("units: the service names its phone", f"Environment=FNAF_SERIAL={SERIAL}" in text, text)
            check("units: the timer fires at the window start",
                  "OnCalendar=*-*-* 01:30:00" in timing and "Persistent=false" in timing
                  and "Environment=FNAF_WINDOW_START=01:30" in text, timing)
        check("units: no adb call", units.calls(None) == [])

        # --- LEASE_BUSY: another owner holds the phone; nothing is asked of it
        busy = case("lease-busy")
        busy.jobs(1)
        os.environ["CUE_HELPER_LOCK_DIR"] = str(lock_dir)
        try:
            with DeviceLock(SERIAL):
                result = busy.run()
        finally:
            os.environ.pop("CUE_HELPER_LOCK_DIR", None)
        check("lease-busy: exit 75", result.returncode == 75, result.stdout)
        check("lease-busy: outcome", busy.record().get("outcome") == "LEASE_BUSY", busy.record().get("outcome"))
        check("lease-busy: no adb call", busy.calls(None) == [], busy.calls(None))
        check("lease-busy: the record says the lease was never held",
              busy.record().get("lease") == {"acquired": False, "released": False}, busy.record().get("lease"))

        # --- OUTSIDE_WINDOW: started hours before a window it may not arm for
        outside = case("outside")
        outside.jobs(1)
        result = outside.run("run", "--max-arm-lead", "0", start=5 * 3600, end=6 * 3600)
        check("outside: exit 75", result.returncode == 75, result.stdout)
        check("outside: outcome", outside.record().get("outcome") == "OUTSIDE_WINDOW", outside.record())
        check("outside: no adb call", outside.calls(None) == [], outside.calls(None))
        check("outside: no queue note is written",
              all("windowNote" not in job for job in outside.queue_jobs()), outside.queue_jobs())

        # --- LOCKED: waited for (bounded), never unlocked; a queue note is left
        locked = case("locked", keyguard=True)
        locked.jobs(1)
        began = time.monotonic()
        result = locked.run()
        waited = time.monotonic() - began
        record = locked.record()
        check("locked: exit 75", result.returncode == 75, result.stdout)
        check("locked: outcome LOCKED device-locked",
              (record.get("outcome"), record.get("reason")) == ("LOCKED", "device-locked"), record.get("reason"))
        check("locked: the wait was bounded by --lock-wait",
              any(e["type"] == "lock.wait" for e in record.get("events", [])) and waited < 30, waited)
        unchanged(locked, "locked")
        note = (locked.queue_jobs() or [{}])[0].get("windowNote", {})
        check("locked: the pending job carries the window's note",
              note.get("outcome") == "LOCKED" and note.get("windowId") == record.get("windowId"), note)
        check("locked: no queue child ran", not Path(f"{locked.steps}.argv").exists())

        # --- IN_USE: a foreign foreground app, and a ringing call
        foreign = case("in-use-app", focus="com.whatsapp/com.whatsapp.HomeActivity")
        foreign.jobs(1)
        result = foreign.run()
        check("in-use-app: exit 75", result.returncode == 75, result.stdout)
        check("in-use-app: outcome and reason",
              (foreign.record().get("outcome"), foreign.record().get("reason"))
              == ("IN_USE", "foreground=com.whatsapp"), foreign.record().get("reason"))
        unchanged(foreign, "in-use-app")
        calling = case("in-use-call", calls=[0, 1])
        calling.jobs(1)
        result = calling.run()
        check("in-use-call: exit 75 IN_USE",
              result.returncode == 75 and calling.record().get("outcome") == "IN_USE"
              and calling.record().get("reason") == "call-state=0,1", calling.record().get("reason"))
        unchanged(calling, "in-use-call")

        # --- POWER: below the floor
        low = case("power", battery={"plugged": True, "level": 30, "temp10": 300})
        low.jobs(1)
        result = low.run()
        check("power: exit 75 POWER below the floor",
              result.returncode == 75 and low.record().get("outcome") == "POWER"
              and low.record().get("reason", "").startswith("battery=30"), low.record().get("reason"))
        unchanged(low, "power")

        # --- preflight: every read, no write, a verdict
        fit = case("preflight")
        fit.jobs(1)
        result = fit.run("preflight", "--json", live=False)
        report = json.loads(result.stdout) if result.stdout.strip().startswith("{") else {}
        check("preflight: exit 0 FIT", result.returncode == 0 and report.get("phone") == {"outcome": "FIT"},
              result.stdout)
        check("preflight: reports every setting", set(report.get("settings", {})) == set(PRIOR), report)
        unchanged(fit, "preflight")
        shut = case("preflight-locked", keyguard=True)
        result = shut.run("preflight", live=False)
        check("preflight-locked: exit 75 LOCKED without waiting",
              result.returncode == 75 and '"LOCKED"' in result.stdout, result.stdout)
        unchanged(shut, "preflight-locked")

        # --- COMPLETE: two jobs, one of which moves a setting, opens the game and
        # starts capture; all of it is put back and the launcher is in front again.
        complete = case("complete")
        complete.jobs(2, ["drift", "done"])
        result = complete.run()
        record = complete.record()
        check("complete: exit 0", result.returncode == 0, result.stdout)
        check("complete: outcome COMPLETE", record.get("outcome") == "COMPLETE", record.get("outcome"))
        restored_to_prior(complete, "complete", record)
        rows = {row["setting"]: row for row in record.get("settings", {}).get("restore", {}).get("settings", [])}
        check("complete: the job's brightness drift was restored and read back",
              rows.get("system/screen_brightness", {}).get("before") == "200"
              and rows.get("system/screen_brightness", {}).get("action") == "restored", rows)
        check("complete: stay-awake went 0 -> 7 -> 0",
              complete.writes() == [["shell", "settings", "put", "global", "stay_on_while_plugged_in", "7"],
                                    ["shell", "settings", "put", "global", "stay_on_while_plugged_in", "0"],
                                    ["shell", "settings", "put", "system", "screen_brightness", "120"]],
              complete.writes())
        check("complete: capture the window started is stopped", complete.phone()["projection"] is False)
        check("complete: the launcher is in front again",
              complete.phone()["focus"].startswith("com.fake.launcher/"), complete.phone()["focus"])
        argv = [json.loads(line) for line in Path(f"{complete.steps}.argv").read_text().splitlines()]
        check("complete: the queue ran one job per call",
              len(argv) == 3 and all(a[:3] == ["run", "--max-jobs", "1"] for a in argv), argv)
        check("complete: the record has three child attempts",
              [job.get("kind") for job in record.get("jobs", [])] == ["done", "done", "empty"], record.get("jobs"))
        check("complete: lease acquired and released",
              record.get("lease") == {"acquired": True, "released": True}, record.get("lease"))

        # --- IN_USE during the window: the owner picked the phone up
        mid = case("in-use-mid")
        mid.jobs(2, ["use-phone"])
        result = mid.run()
        record = mid.record()
        check("in-use-mid: exit 75 IN_USE after the first job",
              result.returncode == 75 and record.get("outcome") == "IN_USE"
              and record.get("reason") == "foreground=com.whatsapp", (result.returncode, record.get("reason")))
        restored_to_prior(mid, "in-use-mid", record)
        check("in-use-mid: HOME was not pressed on the owner's app",
              not any(row["args"][1:3] == ["input", "keyevent"] for row in mid.calls()), mid.calls())

        # --- JOB_FAILED through the real queue and the real setup. The setup
        # borrows the window's lease (it would HOLD device-busy otherwise) and
        # fails at the helper build read, which this fixture leaves without a
        # versionCode.
        failed = case("job-failed", helperDump="    versionName=0.1.14\n")
        failed.jobs(1)
        result = failed.run(fake_queue=False)
        record = failed.record()
        job = (failed.queue_jobs() or [{}])[0]
        check("job-failed: exit 1 JOB_FAILED", result.returncode == 1 and record.get("outcome") == "JOB_FAILED",
              (result.returncode, record.get("outcome"), result.stdout[-1500:]))
        check("job-failed: the real job failed past the lease, not on it",
              job.get("state") == "FAILED" and "cannot read installed build" in job.get("result", "")
              and "device-busy" not in job.get("result", ""), job)
        restored_to_prior(failed, "job-failed", record)

        # --- DEADLINE: the child ignores SIGINT and SIGTERM; the window kills it
        # at its hard deadline and still restores before the window's end.
        late = case("deadline")
        late.jobs(1, ["stubborn"])
        result = late.run("run", end=14)
        record = late.record()
        attempts = record.get("jobs", [{}])
        check("deadline: exit 0 DEADLINE hard-deadline",
              result.returncode == 0 and (record.get("outcome"), record.get("reason")) == ("DEADLINE", "hard-deadline"),
              (result.returncode, record.get("outcome"), record.get("reason"), result.stdout[-1500:]))
        check("deadline: SIGINT, then SIGTERM, then SIGKILL",
              attempts and attempts[-1].get("signals") == ["SIGINT", "SIGTERM", "SIGKILL"], attempts)
        restored_to_prior(late, "deadline", record)
        closed = record.get("window", {}).get("closedAt", "")
        check("deadline: the window closed, restored, by its end",
              bool(closed) and datetime.fromisoformat(closed) <= datetime.fromisoformat(record["window"]["end"]),
              (closed, record.get("window", {}).get("end")))

        # --- ABORTED: SIGINT to the runner's process group mid-job, then again
        # during the cleanup; the second must not cut the restore short.
        abort = case("abort")
        abort.jobs(1, ["hang"])
        process = abort.start()
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            events = abort.events_file()
            if events and '"child.start"' in events.read_text():
                break
            time.sleep(0.05)
        os.killpg(process.pid, signal.SIGINT)
        time.sleep(0.3)
        try:
            os.killpg(process.pid, signal.SIGINT)
        except ProcessLookupError:
            pass
        output, _ = process.communicate(timeout=60)
        record = abort.record()
        check("abort: exit 130 ABORTED", process.returncode == 130 and record.get("outcome") == "ABORTED",
              (process.returncode, record.get("outcome"), output[-1500:]))
        check("abort: both interrupts were received", len(record.get("signals", [])) >= 2, record.get("signals"))
        check("abort: the child was stopped with SIGINT first",
              (record.get("jobs") or [{}])[-1].get("signals", [])[:1] == ["SIGINT"], record.get("jobs"))
        restored_to_prior(abort, "abort", record)

        # --- recovery: a killed window left stay-awake on; restore puts it back,
        # deleting a setting the window found unset.
        recovery = case("recovery", settings={**PRIOR, "global/stay_on_while_plugged_in": "7"})
        recovery.window_dir.mkdir(parents=True)
        digest = __import__("hashlib").sha256(SERIAL.encode()).hexdigest()[:16]
        (recovery.window_dir / f"pending-restore-{digest}.json").write_text(json.dumps({
            "schema": "overnight-window-pending-v1", "windowId": "window-killed", "serial": SERIAL,
            "prior": {**PRIOR, "global/stay_on_while_plugged_in": "null"}}), encoding="utf-8")
        result = recovery.run("restore")
        check("recovery: exit 0 and VERIFIED", result.returncode == 0 and "RESTORE VERIFIED" in result.stdout,
              result.stdout)
        check("recovery: the unset setting is unset again",
              "global/stay_on_while_plugged_in" not in recovery.phone()["settings"], recovery.phone()["settings"])
        check("recovery: the pending record is gone", not list(recovery.window_dir.glob("pending-restore-*.json")))
        before = len(recovery.calls(None))
        again = recovery.run("restore")
        check("recovery: nothing pending touches nothing",
              again.returncode == 0 and "NOTHING-PENDING" in again.stdout
              and len(recovery.calls(None)) == before, again.stdout)

        # --- across every window: the lease is free, and the vocabulary held
        check("the lease is free after every window", lease_is_free(lock_dir))
        forbidden = ("locksettings", "tap", "swipe", "svc", "reboot", "connectivity", "dismiss-keyguard",
                     "unlock", "wakeup")
        for made in cases:
            for row in made.calls():
                text = " ".join(row["args"])
                check(f"{made.dir.name}: every adb call is one the fake knows", row["known"], text)
                check(f"{made.dir.name}: no forbidden command ({text})",
                      not any(word in row["args"] or f"KEYCODE_{word.upper()}" in text for word in forbidden), text)
                if row["args"][1:3] in (["settings", "put"], ["settings", "delete"]):
                    check(f"{made.dir.name}: writes only restored settings ({text})",
                          f"{row['args'][3]}/{row['args'][4]}" in RESTORED, text)

    if failures:
        print("overnight window FAILED:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1
    print(f"overnight window: {passed} checks -- settings recorded, restored and read back on a normal end, "
          "an abort, a job failure and the hard deadline; LOCKED, IN_USE, POWER, LEASE_BUSY and "
          "OUTSIDE_WINDOW change nothing; a killed window is recovered; the lease is always released")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
