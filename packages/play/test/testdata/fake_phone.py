#!/usr/bin/env python3
"""A fake phone for the overnight window and night-job fixtures. No device.

One JSON state file (FAKE_PHONE_STATE) stands for the handset: its settings,
lock and power, focus, calls, battery, the Companion's projection, and one
game (running or not, at its title or mid-night, which title items it shows).
`cmd notification set_dnd WORD` moves `global/zen_mode` as NotificationManager
does; the state's `dndFault` makes it fail ("error": a non-zero exit) or do
nothing ("ignored": exit 0, zen_mode unchanged).
Every stand-in below reads and writes that file under a lock and appends each
call to `<state>.log`, so a test can say exactly what was asked of the phone.

    fake_phone.py adb ...      stands in for `adb` (a known, closed vocabulary)
    fake_phone.py setup ...    for companion-setup.sh (capture, launch, FNAF2_MENU)
    fake_phone.py snap ...     for native-frame.mjs (a synthetic native title frame)
    fake_phone.py runner ...   for a night runner, given the real argv (FAKE_RUNNER_MODE)
    fake_phone.py audio ...    for bt-audio-link.sh --ensure

The title frames are drawn from a real title model's geometry: they prove the
plumbing from SNAP to title-observe.py to the night job's decision, never a
threshold (packages/play/test/testdata/make-title-fixture.py says the same of its own).
"""

from __future__ import annotations

import fcntl
import json
import os
import signal
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILES = HERE.parents[1] / "profiles"
sys.path.insert(0, str(HERE.parents[3] / "packages/play/src/safety"))  # the serial lease: Play's

SERIAL = "FAKE0001"
LAUNCHER = "com.fake.launcher/com.fake.launcher.Home"
COMPANION = "com.ppvaz.fnafcompanion"
PRIOR = {
    "global/stay_on_while_plugged_in": "0", "system/screen_off_timeout": "30000",
    "system/screen_brightness": "120", "system/screen_brightness_mode": "1",
    "global/airplane_mode_on": "0", "global/zen_mode": "0",
    "global/heads_up_notifications_enabled": "1",
}
# `cmd notification set_dnd` words -> the zen_mode NotificationManager stores.
DND_ZEN = {"off": "0", "all": "0", "priority": "1", "none": "2", "on": "2", "alarms": "3"}


def default_phone(**overrides) -> dict:
    phone = {"serial": SERIAL, "present": True, "awake": True, "keyguard": False, "focus": LAUNCHER,
             "calls": [0], "battery": {"plugged": True, "level": 88, "temp10": 310}, "projection": False,
             "helperDump": "    versionCode=14 minSdk=29\n    versionName=0.1.14\n", "settings": dict(PRIOR),
             "game": {"package": "com.scottgames.fnaf2", "running": False, "screen": None,
                      "items": ["continue", "customNight", "newGame", "sixthNight"]}}
    phone.update(overrides)
    return phone


class Phone:
    """The state file, locked for a read-modify-write."""

    def __init__(self, path: str | None = None):
        self.path = path or os.environ["FAKE_PHONE_STATE"]

    def __enter__(self) -> dict:
        self.lock = open(self.path + ".lock", "a")
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        with open(self.path) as handle:
            self.state = json.load(handle)
        return self.state

    def __exit__(self, *_):
        with open(self.path, "w") as handle:
            json.dump(self.state, handle)
        fcntl.flock(self.lock, fcntl.LOCK_UN)
        self.lock.close()


def sigint_blocked() -> bool | None:
    """Was this process started with SIGINT blocked (inherited from its parent)?"""
    try:
        for line in Path("/proc/self/status").read_text().splitlines():
            if line.startswith("SigBlk:"):
                return bool(int(line.split()[1], 16) & (1 << (signal.SIGINT - 1)))
    except OSError:
        pass
    return None


def log(actor: str, args: list[str], known: bool = True, serial: str | None = None, **extra) -> None:
    with open(os.environ["FAKE_PHONE_STATE"] + ".log", "a") as handle:
        handle.write(json.dumps({"actor": actor, "serial": serial, "args": args, "known": known,
                                 "sigintBlocked": sigint_blocked(), "at": time.time(), **extra}) + "\n")


def die_like_a_killed_child() -> None:
    """Exit exactly as a child a group SIGINT reached before its setsid():
    killed by SIGINT (the parent sees -2), even if SIGINT is blocked here."""
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGINT})
    os.kill(os.getpid(), signal.SIGINT)
    time.sleep(5)
    os._exit(1)


def focus_package(state: dict) -> str:
    return state["focus"].split("/", 1)[0]


def adb(argv: list[str]) -> int:
    """FAKE_ADB_DELAY_S slows every call, as a loaded host does. The state's
    `faults` ({"settings get": N, ...}) makes the next N calls of that kind die
    as a signal-killed child does, before they touch the phone."""
    args = list(argv)
    serial = os.environ.get("ANDROID_SERIAL")
    if args[:1] == ["-s"]:
        serial, args = args[1], args[2:]
    time.sleep(float(os.environ.get("FAKE_ADB_DELAY_S", "0")))
    out, code, known = "", 0, True
    actor = os.environ.get("FAKE_ADB_ACTOR", "runner")
    with Phone() as state:
        faults = state.setdefault("faults", {})
        kind = " ".join(args[1:3]) if args[:1] == ["shell"] else ""
        if faults.get(kind, 0) > 0:
            faults[kind] -= 1
            killed = True
        else:
            killed = False
    if killed:
        log(actor, args, True, serial, killed=True)
        die_like_a_killed_child()
    with Phone() as state:
        command = " ".join(args[1:]) if args[:1] == ["shell"] else None
        game = state["game"]
        if args == ["devices", "-l"]:
            out = "List of devices attached\n" + (state["serial"] + " device usb:1-1\n" if state["present"] else "")
        elif not state["present"] or serial != state["serial"]:
            out, code = f"error: device '{serial}' not found", 1
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
        elif args[1:4] == ["cmd", "notification", "set_dnd"] and len(args) == 5 and args[4] in DND_ZEN:
            fault = state.get("dndFault")
            if fault == "error":
                out, code = "Security exception: set_dnd refused by the fixture", 255
            elif fault != "ignored":
                state["settings"]["global/zen_mode"] = DND_ZEN[args[4]]
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
            out = f"  {COMPANION} TYPE_SCREEN_CAPTURE" if state["projection"] else "  (none)"
        elif command == f"dumpsys package {COMPANION}":
            out = state["helperDump"]
        elif command.startswith("dumpsys package "):
            out = ""
        elif command == ("cmd package resolve-activity --brief -a android.intent.action.MAIN "
                         "-c android.intent.category.HOME"):
            out = "priority=0 preferredOrder=0 match=0x108000 isDefault=true\n" + LAUNCHER
        elif command == "input keyevent KEYCODE_HOME":
            state["focus"] = LAUNCHER
        elif args[1:3] == ["am", "force-stop"] and len(args) == 4:
            package = args[3]
            if package == COMPANION:
                state["projection"] = False
            if package == game["package"]:
                game.update({"running": False, "screen": None})
            if focus_package(state) == package:
                state["focus"] = LAUNCHER
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
    # "runner" is the process under test; a scripted stand-in names itself.
    log(actor, args, known, serial)
    print(out)
    return code


def setup(argv: list[str]) -> int:
    """companion-setup.sh: capture on, the target launched; for FNaF 2 --screen
    menu, the helper's FNAF2_MENU identity (the game at its title)."""
    log("setup", argv)
    if os.environ.get("FNAF_LEASE_HELD") != "1" and not os.environ.get("CUE_HELPER_LEASE_OWNER_PID"):
        print("SETUP FAIL no lease")
        return 1
    with Phone() as state:
        if state["keyguard"] or not state["awake"]:
            print("SETUP HOLD reason=device-locked")
            return 75
        if "--stop" in argv:
            state["projection"] = False
            print("CAPTURE stopped helper=force-stopped target=left-unchanged")
            return 0
        state["projection"] = True
        game = state["game"]
        if not game["running"]:
            game.update({"running": True, "screen": "title"})
        state["focus"] = f"{game['package']}/{game['package']}.Main"
        if "--screen" in argv and game["screen"] != "title":
            print(f"SETUP FAIL target FNAF2_MENU was not observed before timeout; last=screen={game['screen']}")
            return 1
    print("SETUP PASS fixture")
    return 0


def title_png(model_path: Path, items: list[str], out: Path) -> None:
    """A native 2400x1080 frame lit where the model looks for its logo, its
    menu row and the given items; black everywhere else."""
    from PIL import Image, ImageDraw
    model = json.loads(model_path.read_text(encoding="utf-8"))
    image = Image.new("RGB", (2400, 1080), (0, 0, 0))
    draw = ImageDraw.Draw(image)

    def bar(box):
        x0, y0, x1, y1 = box
        height = y1 - y0
        draw.rectangle((x0, y0 + int(height * 0.35), x1, y0 + int(height * 0.65)), fill=(255, 255, 255))

    for gate in ("title_gate", "menu_gate"):
        if model.get(gate):
            bar(model[gate]["box"])
    band_w, band_h = model["band"]
    for name in items:
        x, y = model["items"][name]
        bar((x - band_w // 2 + band_w // 10, y - band_h // 2, x + band_w // 2 - band_w // 10, y + band_h // 2))
    image.save(out, "PNG")


def snap(argv: list[str]) -> int:
    """native-frame.mjs: needs the lease marker and a running projection."""
    log("snap", argv)
    out = Path(argv[argv.index("--out") + 1])
    if os.environ.get("FNAF_LEASE_HELD") != "1":
        print("native-frame: run under the serial lease", file=sys.stderr)
        return 2
    with Phone() as state:
        game = dict(state["game"])
        projection = state["projection"]
    if not projection:
        print("native-frame: no projection", file=sys.stderr)
        return 2
    from PIL import Image
    if game["running"] and game["screen"] == "title":
        model = PROFILES / os.environ.get("FAKE_TITLE_MODEL", "fnaf2/moto-g56/title-moto-g56-v207.json")
        title_png(model, game["items"], out)
    else:
        Image.new("RGB", (2400, 1080), (0, 0, 0)).save(out, "PNG")
    print(json.dumps({"out": str(out), "bytes": out.stat().st_size}))
    return 0


def audio(argv: list[str]) -> int:
    log("audio", argv)
    print("audio-route=READY fixture")
    return 0


def write_run_fixture(root: Path, run_id: str, night: int, bundle: str) -> None:
    """What night-run.sh leaves for a won night: its run directory and the
    campaign directory its log names (the shape evidence-pack.mjs packs)."""
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S.%f")[:-3] + "Z"
    campaign = root / "artifacts" / f"campaign-{stamp}"
    run = root / "artifacts" / "runs" / run_id
    campaign.mkdir(parents=True)
    run.mkdir(parents=True)
    started = {"type": "evidence.started", "evidenceDirectory": str(campaign)}
    (campaign / "result.json").write_text(json.dumps({"mode": "live", "status": "COMPLETE", "result": {
        "schema": "device-campaign-result-v1", "version": 1, "state": "COMPLETE", "specHash": "fnv1a-fixture",
        "completedNights": [night], "attempts": [{"attempt": 1, "mode": "live", "night": night, "status": "WIN",
                                                  "proofHash": "fnv1a-fixture",
                                                  "terminal": {"night": night, "outcome": "sixam", "sixAm": True}}],
        "events": []}}))
    (campaign / "events.jsonl").write_text(json.dumps(started) + "\n" + json.dumps(
        {"type": "lifecycle.actuation-halted", "reason": "post-night-static"}) + "\n")
    (campaign / "request.json").write_text(json.dumps({"bundle": {"specHash": "fnv1a-fixture"}}))
    (campaign / "observations.jsonl").write_text(json.dumps({"label": "items=customNight"}) + "\n")
    (run / "verdict.txt").write_text(f"run          {run_id}\nbundle       {bundle}\ncampaign dir {campaign}\n"
                                     "campaign exit 0\n")
    (run / "run-report.json").write_text(json.dumps({"schema": "device-run-report-v1", "stop": {"reason": "sixam"}}))
    (run / "campaign.log").write_text(json.dumps(started, separators=(",", ":")) + "\n")


def runner(argv: list[str]) -> int:
    """A night runner given the real argv. FAKE_RUNNER_MODE:
    win       plays a night to 6 AM, leaves the run fixture, resets to the title
    hang      mid-night until SIGINT, then exits WITHOUT resetting (the worst case)
    stubborn  mid-night, ignoring SIGINT and SIGTERM
    """
    from companion_device_lock import DeviceBusy, DeviceLock
    log("night-runner", argv)
    mode = os.environ.get("FAKE_RUNNER_MODE", "win")
    label = argv[argv.index("--label") + 1]
    night = int(argv[argv.index("--night") + 1])
    bundle = argv[argv.index("--bundle") + 1]
    marker = os.environ.get("FNAF_LEASE_HELD")
    # Nobody else can take the phone while the night runs.
    saved = os.environ.pop("CUE_HELPER_LEASE_OWNER_PID", None)
    try:
        with DeviceLock(SERIAL):
            leased = "FREE"
    except DeviceBusy:
        leased = "HELD"
    if saved is not None:
        os.environ["CUE_HELPER_LEASE_OWNER_PID"] = saved
    run_id = f"night{night}-{label}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    with open(os.environ["FAKE_PHONE_STATE"] + ".runner", "a") as handle:
        handle.write(json.dumps({"argv": argv, "marker": marker, "lease": leased, "mode": mode,
                                 "bundleManifest": (Path(bundle) / "manifest.json").is_file()}) + "\n")
    with Phone() as state:
        state["game"].update({"running": True, "screen": "night"})
    print(f"run      {run_id}", flush=True)
    if mode == "hang":
        signal.signal(signal.SIGINT, lambda *_: sys.exit(130))
        print("fake runner: mid-night, waiting for an interrupt", flush=True)
        time.sleep(600)
        return 1
    if mode == "stubborn":
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        print("fake runner: mid-night, ignoring SIGINT and SIGTERM", flush=True)
        time.sleep(600)
        return 1
    time.sleep(0.3)
    write_run_fixture(Path(os.environ["FAKE_RUNS_ROOT"]), run_id, night, bundle)
    with Phone() as state:
        state["game"]["screen"] = "title"
    print("campaign exit 0", flush=True)
    return 0


def main(argv: list[str]) -> int:
    role, rest = argv[0], argv[1:]
    return {"adb": adb, "setup": setup, "snap": snap, "audio": audio, "runner": runner}[role](rest)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
