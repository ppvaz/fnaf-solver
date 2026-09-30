#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/companion-query-test.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM

mkdir -p "$TEMP_DIR/bin"
ln -s "$HERE/../../test/testdata/mock-adb-companion.sh" "$TEMP_DIR/bin/adb"

# The forward transport speaks a real socket, so the mock serves one rather
# than shimming the client.
python3 "$HERE/../../test/testdata/mock-control-server.py" "$TEMP_DIR/port" &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
for _ in $(seq 1 100); do
  [ -s "$TEMP_DIR/port" ] && break
  sleep 0.02
done

MOCK_FORWARD_PORT="$(cat "$TEMP_DIR/port")"
export MOCK_FORWARD_PORT

# Every call stashes the endpoint it resolves; keep that out of the real
# captures/ directory.
COMPANION_ENDPOINT_STASH="$TEMP_DIR/endpoint-stash"
export COMPANION_ENDPOINT_STASH

# The FNaF 2 camera watch is authenticated separately from GET. Status does
# not activate it; a 64-hex spec hash does.
for transport in loopback forward; do
  status="$(CUE_HELPER_TRANSPORT="$transport" PATH="$TEMP_DIR/bin:$PATH" \
    "$HERE/query-companion.sh" watchlist status)"
  case "$status" in
    *"watch=OFF"*"entries=12"*) ;;
    *) echo "unexpected $transport watch status: $status" >&2; exit 1 ;;
  esac
  loaded="$(CUE_HELPER_TRANSPORT="$transport" PATH="$TEMP_DIR/bin:$PATH" \
    "$HERE/query-companion.sh" watchlist load \
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa)"
  case "$loaded" in
    *"watch=ACTIVE"*"entries=12"*) ;;
    *) echo "unexpected $transport watch load: $loaded" >&2; exit 1 ;;
  esac
  reading="$(CUE_HELPER_TRANSPORT="$transport" PATH="$TEMP_DIR/bin:$PATH" \
    "$HERE/query-companion.sh" read)"
  case "$reading" in
    *"pan_anchor"*|*"bb_left_luma"*|*"battery_bar"*|*"screen_grey_cells"*)
      echo "$transport watch read still carries a retired entry: $reading" >&2; exit 1 ;;
    *"OK read=OBSERVED"*"cam05_button=194"*"cam12_button=0"*) ;;
    *) echo "unexpected $transport watch read: $reading" >&2; exit 1 ;;
  esac
done

# The teach-panel status is a separate authenticated read. It must remain
# usable when the game is not focused.
for transport in loopback forward; do
  overlay_status="$(CUE_HELPER_TRANSPORT="$transport" PATH="$TEMP_DIR/bin:$PATH" \
    "$HERE/query-companion.sh" overlay)"
  case "$overlay_status" in
    *"overlay=READY teach=OFF"*) ;;
    *) echo "unexpected $transport overlay status: $overlay_status" >&2; exit 1 ;;
  esac
done

# Audio detector operations now belong to the external authority, not the APK.
# They must fail before touching adb so an old device-side command cannot look
# like a successful capture.
for verb in record log model arm result; do
  if PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" "$verb" \
      ${verb:+status} >/dev/null 2>&1; then
    echo "$verb must not be sent to the APK" >&2
    exit 1
  fi
done

# Both transports must answer the device's FNaF 2 field set, and neither may
# carry a field retired on 2026-09-27 (luma reducers, grid statistics, the pan
# anchor, battery and camera-selection facts, the audio stack).
for transport in loopback forward; do
  response="$(PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" "$transport")"
  case "$response" in
    'OK '*"visual=OBSERVED visualReason=none seq=121 ageUs=1200"*"screen=FNAF2_NIGHT monitorUp=true"*"mask_button_downstroke=0 monitor_button_downstroke=140"*) ;;
    *) echo "unexpected $transport response: $response" >&2; exit 1 ;;
  esac
  for retired in rgba= ' luma=' cam05_mean_luma= ' grey=' gridLuma= screenScore= detectorLatencyMs= \
                 cameraSelected= cameraHighlights= batteryPercent= mean_luma= pan_anchor audio=; do
    case "$response" in
      *"$retired"*) echo "$transport snapshot still carries retired $retired: $response" >&2; exit 1 ;;
    esac
  done
done

if PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" carrier-pigeon 2>/dev/null; then
  echo "an unknown transport must not be queried" >&2
  exit 1
fi

# The retired verbs refuse before touching adb.
for verb in grid watch; do
  if PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" "$verb" 1 >/dev/null 2>&1; then
    echo "$verb is retired and must refuse" >&2
    exit 1
  fi
done

# latency: the mock answers the device-side sample loop with fixed values, so
# this covers the reporter -- all three groups must survive to the summary.
summary="$(PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" latency 5)"
for label in "snapshot read" "shell baseline"; do
  case "$summary" in
    *"$label"*"n=5"*) ;;
    *) echo "latency summary lost the $label group: $summary" >&2; exit 1 ;;
  esac
done

# The endpoint is announced once in a 256 KiB logcat ring buffer. night5-final2
# and night5-rep4 lost their frame traces when that line rotated out before
# `trace stop`. A valid endpoint is stashed and reused only for the same pid.
rm -f "$COMPANION_ENDPOINT_STASH"
PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" watchlist status >/dev/null
[ -f "$COMPANION_ENDPOINT_STASH" ] || { echo "a valid endpoint was not stashed" >&2; exit 1; }
# GNU stat prints the octal mode with -c; BSD stat (macOS) with -f. Try both.
file_mode() { stat -c %a "$1" 2>/dev/null || stat -f %Lp "$1"; }
[ "$(file_mode "$COMPANION_ENDPOINT_STASH")" = 600 ] || { echo "endpoint stash must be mode 600" >&2; exit 1; }
grep -qx 'pid=7007' "$COMPANION_ENDPOINT_STASH" || { echo "stash lost the helper pid" >&2; exit 1; }
grep -qx 'token=0123456789abcdef0123456789abcdef' "$COMPANION_ENDPOINT_STASH" || { echo "stash lost the token" >&2; exit 1; }

# Scrape first, stash second: after a capture restart the helper keeps its pid
# but mints a new token, and announces it in a fresh line. A stale stash must
# never win over that line, and the line must replace the stale stash.
printf 'pid=7007\nport=49707\nsocket=com.fnaf2.cuehelper.control\ntoken=ffffffffffffffffffffffffffffffff\n' \
  > "$COMPANION_ENDPOINT_STASH"
PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" watchlist status >/dev/null
grep -qx 'token=0123456789abcdef0123456789abcdef' "$COMPANION_ENDPOINT_STASH" || {
  echo "a fresh endpoint line must replace a stale stashed token" >&2; exit 1; }

rotated_err="$TEMP_DIR/rotated.err"
rotated="$(MOCK_LOGCAT_ROTATED=1 PATH="$TEMP_DIR/bin:$PATH" \
  "$HERE/query-companion.sh" watchlist status 2>"$rotated_err")" || {
  echo "a rotated endpoint line must fall back to the same helper's stash: $(cat "$rotated_err")" >&2; exit 1; }
case "$rotated" in *"watch=OFF"*) ;; *) echo "stash fallback returned: $rotated" >&2; exit 1 ;; esac
grep -q 'using the endpoint stashed for helper pid 7007' "$rotated_err" || {
  echo "stash fallback must say it used the stash" >&2; exit 1; }

if MOCK_LOGCAT_ROTATED=1 MOCK_HELPER_PID=8008 PATH="$TEMP_DIR/bin:$PATH" \
    "$HERE/query-companion.sh" watchlist status >/dev/null 2>"$rotated_err"; then
  echo "a stash from another helper pid must not be used" >&2; exit 1
fi
grep -q 'belongs to helper pid 7007, not 8008' "$rotated_err" || {
  echo "a pid mismatch must be named: $(cat "$rotated_err")" >&2; exit 1; }

MOCK_LOGCAT_ROTATED=1 MOCK_UNAUTHORIZED=1 PATH="$TEMP_DIR/bin:$PATH" \
  "$HERE/query-companion.sh" watchlist status >/dev/null 2>"$rotated_err" || true
grep -q 'stashed Companion endpoint is stale' "$rotated_err" || {
  echo "a rejected stashed token must be reported as stale: $(cat "$rotated_err")" >&2; exit 1; }

# The versioned status is game-agnostic: no focus guard, both transports.
for transport in loopback forward; do
  status_line="$(CUE_HELPER_TRANSPORT="$transport" PATH="$TEMP_DIR/bin:$PATH" \
    "$HERE/query-companion.sh" status)"
  case "$status_line" in
    'OK schema=companion-status-v1 app=0.2.0 code=16 session=3 capture=ON '*"target=com.scottgames.fnaf2 game=fnaf2"*) ;;
    *) echo "unexpected $transport status: $status_line" >&2; exit 1 ;;
  esac
done
named="$(PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" target com.scottgames.fnaf4)"
case "$named" in 'OK target=com.scottgames.fnaf4 game=fnaf4 legacy=OFF') ;; *) echo "target naming failed: $named" >&2; exit 1 ;; esac
leased="$(PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" lease fnaf4-run:n5a)"
case "$leased" in 'OK lease=fnaf4-run:n5a') ;; *) echo "lease labelling failed: $leased" >&2; exit 1 ;; esac
if PATH="$TEMP_DIR/bin:$PATH" "$HERE/query-companion.sh" lease 'bad label' >/dev/null 2>&1; then
  echo "a lease label with a space must refuse" >&2; exit 1
fi

# The handshake file is the endpoint source when it names the running pid,
# even with no logcat announcement left; a file from another pid is ignored.
rm -f "$COMPANION_ENDPOINT_STASH"
from_file="$(MOCK_ENDPOINT_FILE=1 MOCK_LOGCAT_ROTATED=1 PATH="$TEMP_DIR/bin:$PATH" \
  "$HERE/query-companion.sh" status 2>"$rotated_err")" || {
  echo "the endpoint file must stand in for a rotated logcat line: $(cat "$rotated_err")" >&2; exit 1; }
case "$from_file" in 'OK schema=companion-status-v1 '*) ;; *) echo "endpoint-file status: $from_file" >&2; exit 1 ;; esac
if grep -q 'stashed' "$rotated_err"; then echo "the endpoint file must win over the stash" >&2; exit 1; fi
rm -f "$COMPANION_ENDPOINT_STASH"
if MOCK_ENDPOINT_FILE=1 MOCK_ENDPOINT_PID=4242 MOCK_LOGCAT_ROTATED=1 PATH="$TEMP_DIR/bin:$PATH" \
    "$HERE/query-companion.sh" status >/dev/null 2>&1; then
  echo "an endpoint file from another pid must not be used" >&2; exit 1
fi

echo "Companion query tests passed"
