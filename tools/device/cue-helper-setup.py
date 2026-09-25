#!/usr/bin/env python3
"""Semantic, image-free Cue Helper setup and FNaF menu check.

The only input this tool can generate is a tap on a named helper button or a
named Android projection-consent button discovered from UIAutomator XML. It
does not know, accept, or emit game-control coordinates. The target is started
with ``am start`` and checked through the authenticated cue-helper protocol.
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

from cue_helper_device_lock import DeviceBusy, DeviceLock


ROOT = Path(__file__).resolve().parents[2]
HELPER_PACKAGE = "com.ppvaz.fnafcompanion"
TARGET_PACKAGE = "com.scottgames.fnaf2"
# The other targets the Companion serves. The helper has a screen identity
# only for FNaF 2; for these the setup ends when the game is launched, and the
# caller's own title gate (a SNAP read by its title model) says where it is.
OTHER_TARGETS = {"fnaf1": "com.scottgames.fivenightsatfreddys", "fnaf3": "com.scottgames.fnaf3",
                 "fnaf4": "com.scottgames.fnaf4"}
OVERLAY_SUPPRESSION_PERMISSION = "android.permission.HIDE_NON_SYSTEM_OVERLAY_WINDOWS"
UI_REMOTE = "/sdcard/cue-helper-setup-ui.xml"
UI_ALLOWED = {
    "helper": (HELPER_PACKAGE,),
    "system": ("com.android.systemui",),
}
BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
LOCKED_PATTERNS = (
    r"isKeyguardShowing\s*=\s*true",
    r"mShowingLockscreen\s*=\s*true",
    r"mKeyguardShowing\s*=\s*true",
    r"mDreamingLockscreen\s*=\s*true",
)


class SetupError(RuntimeError):
    pass


class SetupHold(SetupError):
    """A safe retryable state, not a failed setup or qualification result."""


def adb(*args: str, check: bool = True, timeout: float = 30.0) -> str:
    # Keep the executable injectable for the Node campaign wrapper and its
    # closed test double; the argument vocabulary below remains fixed.
    command = [os.environ.get("ADB_BIN", "adb"), *args]
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise SetupError(f"adb failed: {error}") from error
    output = result.stdout.replace("\r", "")
    if check and result.returncode != 0:
        detail = (result.stderr or output).strip()
        raise SetupError(f"adb {' '.join(args)} failed: {detail}")
    return output


def package_build(package: str) -> str:
    dump = adb("shell", "dumpsys", "package", package)
    code = re.search(r"\bversionCode=(\d+)\b", dump)
    name = re.search(r"\bversionName=([^\s]+)", dump)
    if not code or not name:
        raise SetupError(f"cannot read installed build for {package}")
    return f"{code.group(1)}:{name.group(1)}"


def overlay_suppression_status(package_dump: str) -> str:
    """Report the target's declared Android 12 overlay-hiding capability."""
    if OVERLAY_SUPPRESSION_PERMISSION in package_dump:
        return "REQUESTED_UNSUPPORTED"
    return "NOT_REQUESTED"


def launcher(package: str) -> str:
    output = adb("shell", "cmd", "package", "resolve-activity", "--brief", package)
    for line in reversed(output.splitlines()):
        value = line.strip()
        if value.startswith(package + "/"):
            return value
    raise SetupError(f"no launcher activity resolved for {package}")


def start(component: str) -> None:
    adb("shell", "am", "start", "-n", component)


def projection_active() -> bool:
    """Use Android's projection registry, not a possibly off-screen button."""
    try:
        state = adb("shell", "dumpsys", "media_projection")
    except SetupError:
        return False
    return (HELPER_PACKAGE in state and "TYPE_SCREEN_CAPTURE" in state)


def parse_ui(xml_text: str) -> ET.Element:
    try:
        return ET.fromstring(xml_text)
    except ET.ParseError as error:
        raise SetupError(f"UIAutomator returned malformed XML: {error}") from error


def ui_tree() -> ET.Element:
    # The remote file is overwritten on every dump; it is not a qualification
    # artifact and contains no screenshot or game-control trace.
    adb("shell", "uiautomator", "dump", UI_REMOTE, check=False, timeout=10)
    xml_text = adb("exec-out", "cat", UI_REMOTE, timeout=10)
    if not xml_text.strip():
        raise SetupError("UIAutomator returned an empty hierarchy")
    return parse_ui(xml_text)


def node_center(root: ET.Element, label: str, audience: str) -> tuple[int, int] | None:
    allowed = UI_ALLOWED[audience]
    for node in root.iter("node"):
        attrs = node.attrib
        if attrs.get("text") != label:
            continue
        if attrs.get("package") not in allowed:
            continue
        if attrs.get("class") != "android.widget.Button":
            continue
        if attrs.get("clickable") != "true" or attrs.get("enabled") != "true":
            continue
        match = BOUNDS.fullmatch(attrs.get("bounds", ""))
        if not match:
            continue
        left, top, right, bottom = (int(value) for value in match.groups())
        if right <= left or bottom <= top:
            continue
        return ((left + right) // 2, (top + bottom) // 2)
    return None


def tap_named(label: str, audience: str, timeout: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            center = node_center(ui_tree(), label, audience)
        except SetupError:
            center = None
        if center is not None:
            x, y = center
            print(f"ACTION tap package={audience} text={label!r} x={x} y={y}")
            # Coordinates are derived from the named, allowlisted node above.
            adb("shell", "input", "tap", str(x), str(y))
            return True
        time.sleep(0.25)
    return False


def has_named(label: str, audience: str) -> bool:
    try:
        return node_center(ui_tree(), label, audience) is not None
    except SetupError:
        return False


def start_capture() -> None:
    start(f"{HELPER_PACKAGE}/com.ppvaz.fnafcompanion.MainActivity")
    if projection_active() or has_named("Stop video capture", "helper"):
        print("CAPTURE already-running")
        return
    if not tap_named("Start video capture", "helper"):
        raise SetupError("helper capture button was not found")
    # Android 12+ uses this label on the target API. The fallback is for
    # compatible projection dialogs on other supported system images.
    if not tap_named("Share screen", "system", timeout=20.0):
        if not tap_named("Start now", "system", timeout=3.0):
            raise SetupError("projection consent dialog did not expose an approved action")
    deadline = time.monotonic() + 20.0
    while time.monotonic() < deadline:
        if projection_active() or has_named("Stop video capture", "helper"):
            print("CAPTURE started")
            return
        time.sleep(0.25)
    raise SetupError("capture did not reach the helper running state")


def restart_capture() -> None:
    """Replace an existing projection with a fresh user-approved session."""
    print("CAPTURE restarting")
    stop_capture()
    start_capture()


def start_probe() -> None:
    start(f"{HELPER_PACKAGE}/com.ppvaz.fnafcompanion.MainActivity")
    if not tap_named("CONFIG", "helper"):
        raise SetupError("helper CONFIG tab was not found")
    if has_named("Stop qualification probe", "helper"):
        print("PROBE already-running")
        return
    if not tap_named("Start qualification probe", "helper"):
        raise SetupError("qualification probe button was not found")
    print("PROBE requested (debug sensor-only; production gate is unchanged)")


def overlay_mode_button_label(mode: str) -> str:
    """Return the exact named UI control for one persisted overlay mode."""
    if mode == "debug":
        return "Overlay mode: SENSOR / DEBUG"
    if mode == "run":
        return "Overlay mode: DECISION / RUN"
    raise SetupError(f"unsupported overlay mode: {mode}")


def ensure_overlay_mode(mode: str | None) -> None:
    """Converge the helper's persisted overlay mode through its named UI."""
    if mode is None:
        return
    desired = overlay_mode_button_label(mode)
    other = overlay_mode_button_label("run" if mode == "debug" else "debug")
    start(f"{HELPER_PACKAGE}/com.ppvaz.fnafcompanion.MainActivity")
    if not tap_named("CONFIG", "helper"):
        raise SetupError("helper CONFIG tab was not found")
    if has_named(desired, "helper"):
        print(f"OVERLAY_MODE already={mode}")
        return
    if not tap_named(other, "helper"):
        raise SetupError(f"overlay mode control was not found; wanted {desired!r}")
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if has_named(desired, "helper"):
            print(f"OVERLAY_MODE set={mode}")
            return
        time.sleep(0.25)
    raise SetupError(f"overlay mode did not become {mode}")


def query_snapshot() -> tuple[int, str]:
    command = [str(ROOT / "tools/device/query-cue-helper.sh"), "loopback"]
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=35,
    )
    output = (result.stdout or result.stderr).replace("\r", "").strip()
    return result.returncode, output


def wait_for_screen(screen: str, timeout: float) -> str:
    expected = {
        "menu": "FNAF2_MENU",
        "night": "FNAF2_NIGHT",
    }[screen]
    deadline = time.monotonic() + timeout
    last = ""
    while time.monotonic() < deadline:
        code, output = query_snapshot()
        last = output
        if code == 0 and "visual=OBSERVED" in output and f"screen={expected}" in output:
            return output
        time.sleep(0.5)
    if screen == "night" and "screen=FNAF2_MENU" in last:
        raise SetupHold("target-not-night")
    raise SetupError(f"target {expected} was not observed before timeout; last={last}")


def stop_capture() -> None:
    adb("shell", "am", "force-stop", HELPER_PACKAGE)
    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline and projection_active():
        time.sleep(0.25)
    if projection_active():
        raise SetupError("helper projection did not stop before the restart deadline")
    print("CAPTURE stopped helper=force-stopped target=left-unchanged")


def device_ready_reason() -> str | None:
    """Check readiness again after taking the lease, closing the sleep/lock race."""
    try:
        power = adb("shell", "dumpsys", "power")
        if "mWakefulness=Awake" not in power:
            return "device-not-awake"
        windows = adb("shell", "dumpsys", "window", "policy")
    except SetupError:
        return "device-unavailable"
    if any(re.search(pattern, windows) for pattern in LOCKED_PATTERNS):
        return "device-locked"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Set up Cue Helper and verify the FNaF 2 menu without screenshots"
    )
    parser.add_argument("--install", action="store_true", help="install the checked-in APK first")
    parser.add_argument("--probe", action="store_true", help="start the debug-only sensor probe")
    parser.add_argument("--overlay-mode", choices=("debug", "run"), default=None,
                        help="set the persisted overlay mode (default: leave unchanged)")
    parser.add_argument("--restart-capture", action="store_true",
                        help="replace an active projection with a fresh consent session")
    parser.add_argument("--stop", action="store_true", help="stop helper capture and leave target unchanged")
    parser.add_argument("--screen", choices=("menu", "night"), default="menu",
                        help="screen identity to wait for after setup (default: menu)")
    parser.add_argument("--wait", type=float, default=20.0, help="screen wait timeout in seconds")
    parser.add_argument("--target", choices=("fnaf2", *OTHER_TARGETS), default="fnaf2",
                        help="game to launch after setup (only fnaf2 has a helper screen check)")
    args = parser.parse_args()
    if args.wait <= 0 or args.wait > 300:
        parser.error("--wait must be between 0 and 300 seconds")
    if args.stop and (args.install or args.probe or args.restart_capture or args.overlay_mode is not None):
        parser.error("--stop cannot be combined with --install, --probe, --restart-capture, or --overlay-mode")
    if args.probe and args.overlay_mode == "run":
        parser.error("--probe requires --overlay-mode debug or no explicit overlay mode")

    try:
        serial = os.environ.get("ANDROID_SERIAL", "")
        if not serial:
            raise SetupError("ANDROID_SERIAL was not selected by cue-helper-setup.sh")
        with DeviceLock(serial):
            ready_reason = device_ready_reason()
            if ready_reason is not None and not args.stop:
                print(f"SETUP HOLD reason={ready_reason} serial={serial}")
                return 75
            if args.stop:
                stop_capture()
                return 0

            adb("get-state")
            if args.install:
                apk = ROOT / "android/companion/build/fnaf2-companion.apk"
                if not apk.is_file():
                    raise SetupError(f"APK does not exist: {apk}")
                adb("install", "-r", str(apk), timeout=60.0)
                print(f"INSTALL helper={package_build(HELPER_PACKAGE)}")

            target_package = OTHER_TARGETS.get(args.target, TARGET_PACKAGE)
            helper_build = package_build(HELPER_PACKAGE)
            target_build = package_build(target_package)
            target_launcher = launcher(target_package)
            print(f"BUILD helper={helper_build} target={target_build} launcher={target_launcher}")
            target_dump = adb("shell", "dumpsys", "package", target_package)
            print("TARGET_SUPPRESSION status="
                  f"{overlay_suppression_status(target_dump)} "
                  f"permission={OVERLAY_SUPPRESSION_PERMISSION}")

            if args.restart_capture:
                restart_capture()
            else:
                start_capture()
            ensure_overlay_mode(args.overlay_mode)
            if args.probe:
                start_probe()
            start(target_launcher)
            if args.target != "fnaf2":
                print(f"SETUP PASS capture ready; {args.target} launched "
                      "(no helper screen identity for it: the caller's SNAP title gate reads it)")
                return 0
            try:
                snapshot = wait_for_screen(args.screen, args.wait)
            except SetupHold as error:
                # Keep cleanup inside the lease: another agent must not
                # observe or mutate the projection between the hold and the
                # force-stop. The next runner will restart it after the
                # operator manually enters night; no game input is generated.
                try:
                    stop_capture()
                except SetupError:
                    pass
                print(f"SETUP HOLD reason={error}")
                return 75
            overlay_code, overlay = query_snapshot_overlay()
            expected = "FNAF2_MENU" if args.screen == "menu" else "FNAF2_NIGHT"
            print(f"SCREEN_CHECK PASS screen={expected}")
            print(snapshot)
            print(f"OVERLAY_CHECK exit={overlay_code} {overlay}")
            print("SETUP PASS image-free semantic flow complete")
            return 0
    except DeviceBusy as error:
        serial = os.environ.get("ANDROID_SERIAL", "unknown")
        print(f"SETUP HOLD reason=device-busy serial={serial} detail={error}")
        return 75
    except SetupError as error:
        print(f"SETUP FAIL {error}", file=sys.stderr)
        return 1


def query_snapshot_overlay() -> tuple[int, str]:
    command = [str(ROOT / "tools/device/query-cue-helper.sh"), "overlay"]
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=35,
    )
    output = (result.stdout or result.stderr).replace("\r", "").strip()
    return result.returncode, output


if __name__ == "__main__":
    raise SystemExit(main())
