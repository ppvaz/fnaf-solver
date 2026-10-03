#!/usr/bin/env bash
# Bring the phone's A2DP audio link to this host up, from either side, without
# a hand on the phone.
#
#   packages/play/bin/audio/bt-audio-link.sh --ensure [--game-package PACKAGE] [bt-mac]     # exit 0 only when capture-bt-audio.sh --check says READY
#   packages/play/bin/audio/bt-audio-link.sh --status [--game-package PACKAGE] [bt-mac]
#   packages/play/bin/audio/bt-audio-link.sh --tap-point NAME < ui.xml   # the parser alone: "X Y" for a uiautomator node
#   packages/play/bin/audio/bt-audio-link.sh --focus-package < dumpsys-window.txt   # the focused window's package, or nothing
#
# After a host reboot on 2026-09-15 the bond was intact on both sides and the
# link was down. `bluetoothctl connect` fails with le-connection-abort-by-local:
# the phone is dual-mode and bluetoothctl picks LE, while A2DP is a BR/EDR
# profile. Naming the profile works: org.bluez.Device1.ConnectProfile with the
# A2DP Source UUID brought the PCM up in under five seconds. That is the host
# side. When it does not (the phone can refuse an incoming profile connection),
# the phone side is Android's own Bluetooth settings: the paired host is listed
# by name under "Media devices", and a tap on it connects. Android exposes no
# shell command for a profile connection (`cmd bluetooth_manager` has only
# enable/disable), so the tap is found with `uiautomator dump`, never by fixed
# coordinates, and the app that was in front is restored afterwards.
#
# Menu-only device actions, and only with the game NOT the foreground window
# at the moment of the tap: this script never sends input to the game.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
A2DP_SOURCE_UUID=0000110a-0000-1000-8000-00805f9b34fb
DEFAULT_GAME=com.scottgames.fnaf2
SETTINGS_PACKAGE=com.android.settings
MODE="${1:?usage: bt-audio-link.sh --ensure|--status [--game-package PACKAGE] [bt-mac] | --tap-point NAME < ui.xml | --focus-package < dumpsys-window.txt}"
shift || true

# "X Y" of the centre of the first uiautomator node whose text is exactly NAME.
tap_point() {
  local name="$1"
  # -c, not `python3 -`: stdin must stay the XML, not the program.
  python3 -c '
import re, sys
name = sys.argv[1]; xml = sys.stdin.read()
for m in re.finditer(r"<node\b[^>]*?\btext=\"([^\"]*)\"[^>]*?\bbounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", xml):
    if m.group(1) == name:
        x0, y0, x1, y1 = map(int, m.groups()[1:])
        print((x0 + x1) // 2, (y0 + y1) // 2); sys.exit(0)
sys.exit(1)
' "$name"
}

# The package of the focused window in a `dumpsys window` on stdin, or nothing
# (mCurrentFocus=null while a window changes). Only the focused window counts:
# a backgrounded game keeps windows listed in the dump, so matching its name
# anywhere refused every tap once the game had been opened (2026-09-27, with
# the launcher in front).
focus_package() { sed -n 's/.*mCurrentFocus=Window{[^ ]* [^ ]* \([^ /}]*\).*/\1/p' | head -1; }

if [ "$MODE" = --focus-package ]; then
  focus_package
  exit 0
fi

if [ "$MODE" = --tap-point ]; then
  tap_point "${1:?--tap-point needs the device NAME}"
  exit $?
fi

GAME="$DEFAULT_GAME"
if [ "${1:-}" = --game-package ]; then
  GAME="${2:?--game-package needs an Android package name}"
  shift 2
fi
case "$GAME" in
  *[!A-Za-z0-9._]*|.*|*..*|*.)
    echo "bt-link: invalid Android package name '$GAME'" >&2
    exit 2
    ;;
esac
# The phone's address: the argument, else FNAF_BT_MAC or the untracked local
# profile (local-profile.ts bt-mac), never a committed default.
MAC="${1:-}"
[ -n "$MAC" ] || MAC="$(node "$HERE/../phone/local-profile.ts" bt-mac)" || exit 2
[ "$#" -le 1 ] || { echo "bt-link: too many arguments" >&2; exit 2; }
DEV_PATH="/org/bluez/hci0/dev_${MAC//:/_}"
PCM="/org/bluealsa/hci0/dev_${MAC//:/_}/a2dpsnk/source"

pcm_up() { timeout 10 bluealsa-cli list-pcms 2>/dev/null | grep -qx "$PCM"; }
host_connected() { bluetoothctl info "$MAC" 2>/dev/null | grep -q 'Connected: yes'; }
wait_pcm() { local s; for s in $(seq 1 "$1"); do pcm_up && return 0; sleep 1; done; return 1; }
check() { timeout 60 "$HERE/capture-bt-audio.sh" --check "$MAC" 2>&1 | tail -1; }

if [ "$MODE" = --status ]; then
  printf 'host-connected=%s pcm=%s\n' "$(host_connected && echo yes || echo no)" "$(pcm_up && echo up || echo down)"
  check
  exit 0
fi
[ "$MODE" = --ensure ] || { echo "unknown mode $MODE" >&2; exit 2; }

# Phone side, part 1: Bluetooth on.
if [ "$(adb shell settings get global bluetooth_on 2>/dev/null | tr -d '\r')" != 1 ]; then
  echo "bt-link: enabling Bluetooth on the phone" >&2
  adb shell svc bluetooth enable >/dev/null 2>&1 || true
  timeout 30 adb shell cmd bluetooth_manager wait-for-state:STATE_ON >/dev/null 2>&1 || true
fi

# Host side, part 1: this host's own adapter powered. On 2026-09-27 GNOME had
# Bluetooth switched off (org.gnome.SettingsDaemon.Rfkill BluetoothAirplaneMode
# true, both rfkill entries soft-blocked), and every ConnectProfile failed as if
# the phone had refused. GNOME's own switch is the one to flip; a hard block is
# a physical switch and is only reported.
host_powered() { bluetoothctl show 2>/dev/null | grep -q 'Powered: yes'; }
if ! host_powered; then
  rfk=(--session --dest org.gnome.SettingsDaemon.Rfkill --object-path /org/gnome/SettingsDaemon/Rfkill)
  if gdbus call "${rfk[@]}" --method org.freedesktop.DBus.Properties.Get org.gnome.SettingsDaemon.Rfkill \
      BluetoothAirplaneMode 2>/dev/null | grep -q true; then
    echo "bt-link: this host's Bluetooth is switched off in GNOME; switching it on" >&2
    gdbus call "${rfk[@]}" --method org.freedesktop.DBus.Properties.Set org.gnome.SettingsDaemon.Rfkill \
      BluetoothAirplaneMode '<false>' >/dev/null 2>&1 || true
    sleep 2
  fi
  bluetoothctl power on >/dev/null 2>&1 || true
  sleep 1
  if ! host_powered; then
    echo "audio-route=UNKNOWN reason=host-adapter-powered-off (rfkill: $(cat /sys/class/rfkill/rfkill*/soft 2>/dev/null | tr '\n' ' ')soft; hard block is a physical switch)"
    exit 1
  fi
fi

# Host side, part 2: the A2DP Source profile by name, not a bare connect.
# BT_LINK_SKIP_HOST=1 skips it, to exercise the phone-side path on purpose.
if ! pcm_up && [ "${BT_LINK_SKIP_HOST:-0}" != 1 ]; then
  echo "bt-link: host ConnectProfile A2DP source -> $MAC" >&2
  timeout 45 busctl call org.bluez "$DEV_PATH" org.bluez.Device1 ConnectProfile s "$A2DP_SOURCE_UUID" >/dev/null 2>&1 || true
  wait_pcm 10 || true
fi

# Phone side, part 2: the paired host's entry in Bluetooth settings.
if ! pcm_up; then
  host_name="$(bluetoothctl show 2>/dev/null | sed -n 's/^\s*Alias: //p' | head -1)"
  [ -n "$host_name" ] || { echo "bt-link: this host has no Bluetooth alias" >&2; exit 1; }
  front="$(adb shell dumpsys window 2>/dev/null | focus_package)"
  echo "bt-link: phone-side tap on '$host_name' in Bluetooth settings (front app: ${front:-none})" >&2
  adb shell am start -a android.settings.BLUETOOTH_SETTINGS >/dev/null 2>&1
  sleep 4
  # A connected host sits under "Media devices" on the first screen; a saved,
  # disconnected one sits under "Saved devices" below the fold (2026-09-15:
  # one swipe on the landscape g56 brought it into view). Dump, then swipe
  # the list up between attempts.
  point=""
  for attempt in 1 2 3 4; do
    [ "$attempt" -gt 1 ] && { adb shell input swipe 1200 950 1200 600 400 >/dev/null 2>&1 || true; sleep 1.5; }
    adb shell uiautomator dump /sdcard/fnaf-bt-ui.xml >/dev/null 2>&1 || true
    point="$(adb exec-out cat /sdcard/fnaf-bt-ui.xml 2>/dev/null | tap_point "$host_name" || true)"
    [ -n "$point" ] && break
  done
  adb shell rm -f /sdcard/fnaf-bt-ui.xml >/dev/null 2>&1 || true
  if [ -n "$point" ]; then
    # Only ever with Settings in front: refuse if anything else (the game, or
    # nothing) holds focus at the moment of the tap.
    now="$(adb shell dumpsys window 2>/dev/null | focus_package)"
    if [ "$now" != "$SETTINGS_PACKAGE" ]; then
      echo "bt-link: ${now:-no window} is in front, not $SETTINGS_PACKAGE; not tapping" >&2
    else
      # shellcheck disable=SC2086
      adb shell input tap $point >/dev/null 2>&1
      wait_pcm 20 || true
    fi
  else
    echo "bt-link: '$host_name' not found in the phone's Bluetooth settings" >&2
  fi
  adb shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
  if [ "$front" = "$GAME" ]; then
    adb shell am start -n "$GAME/.Main" >/dev/null 2>&1 || true
    sleep 6
  fi
fi

# The capture is a single consumer of the PCM. A root bluealsa-aplay.service
# (enabled at boot on this host, seen 2026-09-15) holds it and cannot be
# stopped by a user; say so with the command, before a run is launched on it.
if pgrep -x bluealsa-aplay >/dev/null && [ "$(ps -o user= -p "$(pgrep -x bluealsa-aplay | head -1)")" = root ]; then
  echo "bt-link: root bluealsa-aplay holds the PCM; run: sudo systemctl disable --now bluealsa-aplay" >&2
  exit 3
fi
result="$(check || true)"
printf '%s\n' "$result"
case "$result" in audio-route=READY*) exit 0 ;; *) exit 1 ;; esac
