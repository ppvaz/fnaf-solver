#!/bin/bash
# LIVE DEVICE ACTION. Exercise the legal camera-feed-light intersection and a
# separately state-gated hall-light pulse.
#
# The stream is intentionally phase-split. The wrapper will not write camdrop
# until monitor-up is observed, and will not write hallLight until monitor-down,
# mask-down, and both bottom buttons are observed on two fresh atomic FRAMEs.
# No mask control is emitted; mask-up -> hallLight and mask-up -> monitor are
# refused routes, not fallback schedules.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG=com.scottgames.fnaf2
OUT="${OUT:-intersection-camdrop-hall-v1}"
PROBE_NIGHT="${PROBE_NIGHT:-continue}"
CAPTURE_DIR="$HERE/../../../../captures"
REMOTE_STREAM="/data/local/tmp/$OUT-$$.hid"
FIFO=""
HID_PID=""
FRAME_TRACE_STARTED=0
FD_OPEN=0
DEVICE_READY=0
TRACE_STOP_FAILED=0

case "$OUT" in
  ''|*[!A-Za-z0-9._-]*) echo "OUT must be plain ASCII" >&2; exit 2 ;;
esac
[ "${#OUT}" -le 48 ] || { echo "OUT must be at most 48 characters" >&2; exit 2; }

CONTACT_MS="${CONTACT_MS:-33}"
CAMDROP_LEAD_MS="${CAMDROP_LEAD_MS:-150}"
CAMDROP_MONITOR_MS="${CAMDROP_MONITOR_MS:-$CONTACT_MS}"
CAMDROP_TAIL_MS="${CAMDROP_TAIL_MS:-67}"
HALL_MS="${HALL_MS:-$CONTACT_MS}"
PRE_RAISE_MS="${PRE_RAISE_MS:-100}"
POST_HALL_MS="${POST_HALL_MS:-1500}"
GATE_TIMEOUT_MS="${GATE_TIMEOUT_MS:-8000}"
GATE_POLL_MS="${GATE_POLL_MS:-50}"

for value_name in CONTACT_MS CAMDROP_LEAD_MS CAMDROP_MONITOR_MS CAMDROP_TAIL_MS HALL_MS \
    PRE_RAISE_MS POST_HALL_MS GATE_TIMEOUT_MS GATE_POLL_MS; do
  value="${!value_name}"
  case "$value" in ''|*[!0-9]*) echo "$value_name must be a whole number" >&2; exit 2 ;; esac
done
[ "$GATE_TIMEOUT_MS" -ge 1000 ] && [ "$GATE_TIMEOUT_MS" -le 30000 ] || {
  echo "GATE_TIMEOUT_MS must be 1000..30000" >&2; exit 2; }
[ "$GATE_POLL_MS" -ge 20 ] && [ "$GATE_POLL_MS" -le 1000 ] || {
  echo "GATE_POLL_MS must be 20..1000" >&2; exit 2; }

mkdir -p "$CAPTURE_DIR"
for suffix in hid register.jsonl raise.jsonl camdrop.jsonl hall.jsonl intersection.json \
    initial-office-gate.jsonl monitor-up-gate.jsonl office-gate.jsonl hid.log; do
  [ ! -e "$CAPTURE_DIR/$OUT.$suffix" ] || {
    echo "refusing to overwrite $CAPTURE_DIR/$OUT.$suffix" >&2; exit 2; }
done

# Generate and validate the split plan before selecting or touching the device.
SPLIT_OUT="$CAPTURE_DIR/$OUT" CONTACT_MS="$CONTACT_MS" \
  CAMDROP_LEAD_MS="$CAMDROP_LEAD_MS" CAMDROP_MONITOR_MS="$CAMDROP_MONITOR_MS" \
  CAMDROP_TAIL_MS="$CAMDROP_TAIL_MS" HALL_MS="$HALL_MS" \
  PRE_RAISE_MS="$PRE_RAISE_MS" POST_HALL_MS="$POST_HALL_MS" \
  node "$HERE/hid-intersection-probe.mjs" > "$CAPTURE_DIR/$OUT.hid"

# shellcheck source=select-adb.sh
. "$HERE/../phone/select-adb.sh"
DEVICE_READY=1

cleanup() {
  local status=$?
  set +e
  if [ "$FD_OPEN" -eq 1 ]; then
    exec 3>&-
    FD_OPEN=0
  fi
  if [ -n "$HID_PID" ]; then
    kill "$HID_PID" 2>/dev/null || true
    wait "$HID_PID" 2>/dev/null || true
  fi
  if [ "$FRAME_TRACE_STARTED" -eq 1 ]; then
    FRAME_TRACE_STARTED=0
    bash "$HERE/../companion/query-companion.sh" trace stop || TRACE_STOP_FAILED=1
  fi
  [ -n "$FIFO" ] && rm -f "$FIFO"
  adb shell "rm -f $REMOTE_STREAM" >/dev/null 2>&1 || true
  adb shell "am force-stop $PKG" >/dev/null 2>&1 || true

  # Every live attempt, including a gate refusal, must leave the game at a
  # known title/menu state. This is deliberately unconditional after device
  # selection and is followed by the authoritative title observer.
  if ! bash "$HERE/../companion/companion-setup.sh" --screen menu --wait 60; then
    echo "RESTORE FAIL Companion setup did not reach menu" >&2
    status=1
  fi
  if title_line="$(TITLE_MODEL="$HERE/../../profiles/fnaf2/moto-g56/title-moto-g56-v207.json" \
      python3 "$HERE/../../src/sensors/screencap/title-observe.py" --adb 2>/dev/null)"; then
    echo "RESTORE TITLE $title_line"
    case "$title_line" in items=*) ;; *) status=1 ;; esac
  else
    echo "RESTORE FAIL title observer did not produce a verdict" >&2
    status=1
  fi
  [ "$TRACE_STOP_FAILED" -eq 0 ] || status=1
  exit "$status"
}
trap cleanup EXIT

if ! adb shell "pm list packages" | grep -Fx "package:$PKG" >/dev/null; then
  echo "$PKG is not installed on this device" >&2
  exit 1
fi
window_state="$(adb shell dumpsys window 2>/dev/null | tr -d '\r' || true)"
grep -Fq 'isKeyguardShowing=true' <<<"$window_state" && {
  echo "the device is locked; unlock it and leave the screen on, then rerun" >&2
  exit 1
}

adb push "$CAPTURE_DIR/$OUT.hid" "$REMOTE_STREAM" >/dev/null
adb shell "am start -n $PKG/.Main" >/dev/null
for _ in $(seq 1 40); do
  focus="$(adb shell dumpsys window 2>/dev/null | tr -d '\r' | grep 'mCurrentFocus' || true)"
  grep -Fq "$PKG" <<<"$focus" && break
  sleep 0.5
done
focus="$(adb shell dumpsys window 2>/dev/null | tr -d '\r' | grep 'mCurrentFocus' || true)"
grep -Fq "$PKG" <<<"$focus" || {
  echo "the game never took focus; aborting before any HID input" >&2; exit 1; }

# Activity focus can precede the first usable title frame after a cold launch.
# menu_select is deliberately fail-closed, so wait for one positive title
# observation before asking it to make the guarded Continue press. Without this
# read, a clean device restart can burn a live attempt before any HID report.
title_ready=0
for _ in $(seq 1 20); do
  title_line="$(TITLE_MODEL="$HERE/../../profiles/fnaf2/moto-g56/title-moto-g56-v207.json" \
    python3 "$HERE/../../src/sensors/screencap/title-observe.py" --adb 2>/dev/null || true)"
  case "$title_line" in
    items=*) title_ready=1; break ;;
  esac
  sleep 0.25
done
[ "$title_ready" -eq 1 ] || {
  echo "the game did not produce a usable title observation; aborting before any HID input" >&2
  exit 1
}

# shellcheck source=coords.sh
. "$HERE/../phone/coords.sh"
# shellcheck source=menu.sh
. "$HERE/../phone/menu.sh"

FIFO="$(mktemp -u)"
mkfifo "$FIFO"
adb shell "hid -" < "$FIFO" > "$CAPTURE_DIR/$OUT.hid.log" 2>&1 &
HID_PID=$!
exec 3> "$FIFO"
FD_OPEN=1
cat "$CAPTURE_DIR/$OUT.register.jsonl" >&3
echo "hid registered over stdin at the title (pid $HID_PID)"

menu_select "$PROBE_NIGHT" || {
  echo "abort: could not select $PROBE_NIGHT on the observed title" >&2; exit 1; }
state=""
for _ in $(seq 1 40); do
  state="$(adb exec-out screencap -p 2>/dev/null | \
    python3 "$HERE/../../src/sensors/screencap/screenstate.py" 2>/dev/null | tail -1)"
  [ "$state" = night ] && break
  sleep 0.25
done
[ "$state" = night ] || {
  echo "abort: $PROBE_NIGHT was selected but no night started (saw '$state')" >&2
  exit 1
}

game_focused() {
  local current
  current="$(adb shell dumpsys window 2>/dev/null | tr -d '\r' | grep 'mCurrentFocus' || true)"
  grep -Fq "$PKG" <<<"$current"
}

gate() {
  local target=$1 log=$2
  game_focused || { echo "state gate $target refused: game lost focus" >&2; return 1; }
  node "$HERE/intersection-state-gate.mjs" --target "$target" \
    --timeout-ms "$GATE_TIMEOUT_MS" --poll-ms "$GATE_POLL_MS" --log "$log"
}

echo "waiting for initial office: monitor-down, mask-down, both bottom buttons"
gate office "$CAPTURE_DIR/$OUT.initial-office-gate.jsonl"
echo "initial office gate passed; starting native frame trace"
bash "$HERE/../companion/query-companion.sh" trace start "$OUT"
FRAME_TRACE_STARTED=1

echo "writing monitor raise phase"
game_focused || { echo "monitor raise refused: game lost focus" >&2; exit 1; }
cat "$CAPTURE_DIR/$OUT.raise.jsonl" >&3

echo "waiting for positive monitor-up gate before camera-light hold"
gate monitor-up "$CAPTURE_DIR/$OUT.monitor-up-gate.jsonl"
echo "monitor-up gate passed; writing legal cameraFeedLight-held camdrop"
game_focused || { echo "camdrop refused: game lost focus" >&2; exit 1; }
cat "$CAPTURE_DIR/$OUT.camdrop.jsonl" >&3

echo "waiting for positive office gate before hallLight"
gate office "$CAPTURE_DIR/$OUT.office-gate.jsonl"
echo "office gate passed; writing standalone hallLight pulse"
game_focused || { echo "hallLight refused: game lost focus" >&2; exit 1; }
cat "$CAPTURE_DIR/$OUT.hall.jsonl" >&3
exec 3>&-
FD_OPEN=0

# The final hall phase contains its own post-roll delay. Wait for the HID
# process to consume EOF without allowing a hung remote process to hold the
# trace indefinitely.
for _ in $(seq 1 15); do
  kill -0 "$HID_PID" 2>/dev/null || break
  sleep 1
done
kill "$HID_PID" 2>/dev/null || true
wait "$HID_PID" 2>/dev/null || true
HID_PID=""

FRAME_TRACE_STARTED=0
bash "$HERE/../companion/query-companion.sh" trace stop
echo "intersection probe complete; visual game acceptance remains UNKNOWN"
