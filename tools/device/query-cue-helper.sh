#!/bin/bash
# Talk to the cue helper's authenticated snapshot socket.
#
#   query-cue-helper.sh status                    the versioned status (companion-status-v1)
#   query-cue-helper.sh target [PKG|GAME|clear]   read or name the Companion's target
#   query-cue-helper.sh lease LABEL|clear         show a lease label on the phone
#   query-cue-helper.sh [loopback|forward]        one FNaF 2 snapshot (default loopback)
#   query-cue-helper.sh overlay                   authenticated teach-panel status
#   query-cue-helper.sh latency [count]           time device-local snapshot reads
#   query-cue-helper.sh watchlist status|load HASH inspect/load the FNaF 2 camera watch
#   query-cue-helper.sh read                      read the active camera watch
#   query-cue-helper.sh trace start LABEL|stop|status
#                                                    pull a device-local frame trace
#
# snapshot, watchlist, read and trace are the FNaF 2 legacy readers
# (android/companion Fnaf2Legacy.java); they answer only while the target is
# retail FNaF 2. The 20x9 `grid` render and the luma `watch` log were retired
# with the discontinued sensors on 2026-09-27.
#
# The endpoint comes from the Companion's handshake file
# (files/companion-endpoint.properties, companion-endpoint-v1, read with
# run-as); the logcat announcement and the per-pid stash are the fallbacks
# for a helper older than 0.2.0.
#
# Transports:
#   loopback  device-side nc to 127.0.0.1:PORT. The exchange happens entirely
#             inside one adb shell, so it models what the on-device controller
#             will do without an adb round trip. Default.
#   forward   host-side client over `adb forward` to the helper's abstract
#             socket. Cable-bound: nothing on the device has to open a port.
#             Select with CUE_HELPER_TRANSPORT=forward.
#
# Audio is not an APK operation. Use `tools/cue/audio-authority.py` on the
# external receiver host for route checks, PCM, and fact messages.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PACKAGE="com.ppvaz.fnafcompanion"
OUT_DIR="${CUE_HELPER_CALIBRATION:-captures/cue-helper/calibration}"

VERB=snapshot
TRANSPORT="${CUE_HELPER_TRANSPORT:-loopback}"
case "${1:-}" in
  loopback|forward) TRANSPORT="$1" ;;
  status) VERB=status; shift ;;
  target) VERB=target; shift ;;
  lease) VERB=lease; shift ;;
  record) VERB=record; shift ;;
  latency) VERB=latency; shift ;;
  log) VERB=log; shift ;;
  grid|watch)
    echo "$1 is retired: the 20x9 grid and the luma watch are discontinued sensors (Companion 0.2.0); read native regions with tools/device/native-regions.mjs" >&2
    exit 2
    ;;
  watchlist) VERB=watchlist; shift ;;
  read) VERB=read; shift ;;
  trace) VERB=trace; shift ;;
  overlay) VERB=overlay; shift ;;
  model) VERB=model; shift ;;
  arm) VERB=arm; shift ;;
  result) VERB=result; shift ;;
  '') ;;
  *) echo "usage: query-cue-helper.sh [status|target|lease|loopback|forward|overlay|latency|watchlist|read|trace]" >&2; exit 2 ;;
esac
case "$VERB" in
  record|log|model|arm|result)
    echo "$VERB is no longer an APK operation; use tools/cue/audio-authority.py on the external receiver host" >&2
    exit 2
    ;;
esac
case "$TRANSPORT" in
  loopback|forward) ;;
  *) echo "unknown transport: $TRANSPORT (use loopback or forward)" >&2; exit 2 ;;
esac

if [ "$VERB" = target ]; then
  TARGET_NAME="${1:-}"
  case "$TARGET_NAME" in
    ''|clear) ;;
    *[!a-z0-9._-]*) echo "target must be a package, a game key, or clear" >&2; exit 2 ;;
  esac
fi

if [ "$VERB" = lease ]; then
  LEASE_LABEL="${1:?lease needs a label or clear}"
  case "$LEASE_LABEL" in
    *[!A-Za-z0-9._:@-]*) echo "lease label must be [A-Za-z0-9._:@-]" >&2; exit 2 ;;
  esac
  [ "${#LEASE_LABEL}" -le 48 ] || { echo "lease label must be at most 48 characters" >&2; exit 2; }
fi

if [ "$VERB" = latency ]; then
  COUNT="${1:-50}"
  case "$COUNT" in *[!0-9]*) echo "count must be a whole number" >&2; exit 2 ;; esac
  if [ "$TRANSPORT" != loopback ]; then
    echo "latency measures the device-local path; use the loopback transport" >&2
    exit 2
  fi
fi

if [ "$VERB" = watchlist ]; then
  WATCH_ACTION="${1:?watchlist needs status or load HASH}"
  case "$WATCH_ACTION" in
    status) ;;
    load)
      WATCH_HASH="${2:?watchlist load needs the spec hash}"
      case "$WATCH_HASH" in
        [0-9a-fA-F][0-9a-fA-F]*) ;;
        *) echo "watch spec hash must be hexadecimal" >&2; exit 2 ;;
      esac
      [ "${#WATCH_HASH}" -eq 64 ] || {
        echo "watch spec hash must be 64 hex characters" >&2; exit 2; }
      ;;
    *) echo "watchlist takes status or load HASH" >&2; exit 2 ;;
  esac
fi

if [ "$VERB" = log ]; then
  LOG_ACTION="${1:?log needs start or stop}"
  case "$LOG_ACTION" in
    start|stop) ;;
    *) echo "log takes start or stop" >&2; exit 2 ;;
  esac
  LABEL="${2:-night}"
fi

if [ "$VERB" = record ]; then
  PRE="${1:?record needs PRE seconds}"
  POST="${2:?record needs POST seconds}"
  LABEL="${3:-window}"
  case "$PRE$POST" in *[!0-9]*) echo "PRE and POST must be whole seconds" >&2; exit 2 ;; esac
fi

if [ "$VERB" = model ]; then
  MODEL_ACTION="${1:?model needs status or reload}"
  case "$MODEL_ACTION" in status|reload) ;; *) echo "model takes status or reload" >&2; exit 2 ;; esac
fi

if [ "$VERB" = arm ]; then
  WINDOW_ID="${1:?arm needs a window id}"
  CUE_SET="${2:?arm needs a cue set}"
  WINDOW_MS="${3:?arm needs a duration in milliseconds}"
  WINDOW_MODE="${4:-shadow}"
  case "$WINDOW_ID$CUE_SET" in *[!A-Za-z0-9._,-]*) echo "window and cues use plain names" >&2; exit 2 ;; esac
  case "$WINDOW_MS" in ''|*[!0-9]*) echo "window duration must be whole milliseconds" >&2; exit 2 ;; esac
  [ "$WINDOW_MS" -gt 0 ] && [ "$WINDOW_MS" -le 30000 ] || {
    echo "window duration must be 1..30000 ms" >&2; exit 2; }
  case "$WINDOW_MODE" in shadow|control) ;; *) echo "mode must be shadow or control" >&2; exit 2 ;; esac
fi

if [ "$VERB" = result ]; then
  WINDOW_ID="${1:?result needs a window id}"
  case "$WINDOW_ID" in *[!A-Za-z0-9._-]*) echo "window id must be a plain name" >&2; exit 2 ;; esac
fi

if [ "$VERB" = trace ]; then
  TRACE_ACTION="${1:?trace needs start LABEL, stop, or status}"
  case "$TRACE_ACTION" in
    start)
      TRACE_LABEL="${2:?trace start needs LABEL}"
      case "$TRACE_LABEL" in
        ''|*[!A-Za-z0-9._-]*) echo "trace label must be plain ASCII" >&2; exit 2 ;;
      esac
      [ "${#TRACE_LABEL}" -le 48 ] || {
        echo "trace label must be at most 48 characters" >&2; exit 2; }
      [ "$#" -eq 2 ] || { echo "trace start takes LABEL only" >&2; exit 2; }
      ;;
    stop|status)
      [ "$#" -eq 1 ] || { echo "trace $TRACE_ACTION takes no arguments" >&2; exit 2; }
      ;;
    *) echo "trace takes start LABEL, stop, or status" >&2; exit 2 ;;
  esac
fi

. "$HERE/select-adb.sh"
adb get-state >/dev/null

pid="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
case "$pid" in
  ''|*[!0-9]*) echo "cue helper is not running" >&2; exit 1 ;;
esac

# The focus guard exists so that a reading is *about the game*. Retrieving or
# starting a recording is not a reading, and requiring focus there strands a
# capture whenever a run ends with the game no longer in front.
case "$VERB" in
  snapshot|record|watchlist|read|trace|arm|result)
    needs_focus=1
    if [ "$VERB" = trace ] && [ "$TRACE_ACTION" != start ]; then
      needs_focus=0 # teardown/status may follow a focus change
    fi
    if [ "$needs_focus" -eq 1 ]; then
      if ! adb shell dumpsys window 2>/dev/null | \
          awk '/mCurrentFocus=.*com\.scottgames\.fnaf2/ { found=1 } END { exit !found }'; then
        echo "FNaF is not the focused physical-display window" >&2
        exit 1
      fi
    fi
    ;;
esac

# The Companion's handshake file first: it belongs to one capture session
# and cannot rotate out of a ring buffer. It must name the running pid.
endpoint_file="$(adb exec-out run-as "$PACKAGE" cat files/companion-endpoint.properties 2>/dev/null | tr -d '\r' || true)"
file_pid="$(printf '%s\n' "$endpoint_file" | sed -n 's/^pid=\([0-9][0-9]*\)$/\1/p')"
if printf '%s\n' "$endpoint_file" | grep -qx 'schema=companion-endpoint-v1' && [ "$file_pid" = "$pid" ]; then
  port="$(printf '%s\n' "$endpoint_file" | sed -n 's/^port=\([0-9][0-9]*\)$/\1/p')"
  socket="$(printf '%s\n' "$endpoint_file" | sed -n 's/^socket=\([^ ]*\)$/\1/p')"
  token="$(printf '%s\n' "$endpoint_file" | sed -n 's/^token=\([0-9a-f]*\)$/\1/p')"
else
  control="$(adb logcat -d --pid="$pid" -v brief -s FnafCueHelper:I '*:S' 2>/dev/null | \
    tr -d '\r' | awk '/control=(READY|DEGRADED)/ { line=$0 } END { print line }')"
  port="$(printf '%s\n' "$control" | sed -n 's/.*control=[A-Z][A-Z]* [a-z]*=[^ ]* port=\([^ ]*\).*/\1/p')"
  [ -n "$port" ] || port="$(printf '%s\n' "$control" | sed -n 's/.* port=\([^ ]*\).*/\1/p')"
  socket="$(printf '%s\n' "$control" | sed -n 's/.* socket=\([^ ]*\).*/\1/p')"
  token="$(printf '%s\n' "$control" | sed -n 's/.*token=\([0-9a-f][0-9a-f]*\).*/\1/p')"
fi

# The endpoint is announced ONCE, as a logcat line, and this script used to
# re-read it on every call. The handset's main log is a 256 KiB ring buffer, so
# on a long, noisy night that line rotates out and every later call fails with
# "no valid per-run cue-helper token found" although the helper is healthy.
# That is how night5-final2 and night5-rep4 (2026-09-12) lost their frame
# traces: `trace start` at night-go read a fresh line, `trace stop` at the end
# of the night found none. (The executor's own gate reads are not exposed: its
# AdbCueHelperPort discovers the endpoint once and reuses it.)
#
# So a valid endpoint is stashed the moment it is seen, keyed by the helper's
# pid, and reused only for that same process. The token belongs to a capture
# generation; restarting capture force-stops the helper, which gives a new pid
# and so correctly invalidates the stash. A new generation inside the SAME
# process would also mint a new token; that case is caught below by the
# helper's own "ERROR unauthorized" reply rather than trusted.
ENDPOINT_STASH="${CUE_HELPER_ENDPOINT_STASH:-$HERE/../../captures/.cue-helper-endpoint-${ANDROID_SERIAL:-default}}"
ENDPOINT_FROM_STASH=0
if [ "${#token}" -eq 32 ]; then
  ( umask 077
    mkdir -p "$(dirname "$ENDPOINT_STASH")" &&
      printf 'pid=%s\nport=%s\nsocket=%s\ntoken=%s\n' "$pid" "$port" "$socket" "$token" \
        > "$ENDPOINT_STASH.tmp" &&
      mv -f "$ENDPOINT_STASH.tmp" "$ENDPOINT_STASH" ) 2>/dev/null || true
elif [ -f "$ENDPOINT_STASH" ]; then
  stash_pid="$(sed -n 's/^pid=//p' "$ENDPOINT_STASH")"
  if [ -n "$stash_pid" ] && [ "$stash_pid" = "$pid" ]; then
    port="$(sed -n 's/^port=//p' "$ENDPOINT_STASH")"
    socket="$(sed -n 's/^socket=//p' "$ENDPOINT_STASH")"
    token="$(sed -n 's/^token=//p' "$ENDPOINT_STASH")"
    ENDPOINT_FROM_STASH=1
    echo "cue helper endpoint line rotated out of logcat; using the endpoint stashed for helper pid $pid" >&2
  else
    echo "cue helper endpoint line rotated out of logcat, and the stashed endpoint belongs to helper pid ${stash_pid:-none}, not $pid" >&2
  fi
fi
if [ "${#token}" -ne 32 ]; then
  echo "no valid per-run cue-helper token found" >&2
  exit 1
fi

host_port=""
cleanup() { [ -n "$host_port" ] && adb forward --remove "tcp:$host_port" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

if [ "$TRANSPORT" = loopback ]; then
  case "$port" in
    ''|*[!0-9]*) echo "cue helper has no live loopback port" >&2; exit 1 ;;
  esac
else
  case "$socket" in
    ''|none) echo "cue helper has no live abstract control socket" >&2; exit 1 ;;
  esac
  host_port="$(adb forward tcp:0 "localabstract:$socket" | tr -d '\r' | tail -n1)"
  case "$host_port" in
    ''|*[!0-9]*) echo "adb forward did not return a host port" >&2; exit 1 ;;
  esac
fi

# One request, one bounded line back. REC holds the socket for its post-roll,
# so the client timeout has to clear the longest window this script asks for.
# A stashed endpoint is trusted only while the helper accepts it. If the
# helper started a new capture generation in the same process it has a new
# token, and it answers the old one with "ERROR unauthorized": say so, so a
# stale stash reads as a stale stash and not as a mysterious failed command.
exchange() {
  local reply
  reply="$(exchange_raw "$1")"
  if [ "$ENDPOINT_FROM_STASH" = 1 ] && [ "$reply" = "ERROR unauthorized" ]; then
    echo "stashed cue helper endpoint is stale: helper pid $pid rejected its token; rerun tools/device/cue-helper-setup.sh" >&2
  fi
  printf '%s\n' "$reply"
}

exchange_raw() {
  if [ "$TRANSPORT" = loopback ]; then
    # $1 is deliberately unquoted: adb shell concatenates its arguments and
    # re-splits them on the device, so a quoted request with spaces arrives as
    # separate words anyway. Passing the port first and reassembling the rest
    # with "$*" is the only form that survives that round trip.
    # shellcheck disable=SC2086
    adb shell sh -s -- "$port" $1 <<'REMOTE' | tr -d '\r'
set -eu
port=$1
shift
printf '%s\n' "$*" | toybox nc -w 20 127.0.0.1 "$port"
REMOTE
  else
    # Not netcat: macOS BSD nc returns an empty body for this exchange even
    # though the forward itself is healthy.
    python3 - "$host_port" "$1" <<'CLIENT' | tr -d '\r'
import socket, sys
port, request = int(sys.argv[1]), sys.argv[2]
with socket.create_connection(("127.0.0.1", port), timeout=25) as client:
    client.sendall((request + "\n").encode("ascii"))
    chunks = []
    while b"\n" not in b"".join(chunks):
        block = client.recv(4096)
        if not block:
            break
        chunks.append(block)
sys.stdout.write(b"".join(chunks).decode("ascii", "replace").strip())
CLIENT
  fi
}

if [ "$VERB" = status ]; then
  response="$(exchange "STATUS $token")"
  printf '%s\n' "$response"
  case "$response" in
    'OK schema=companion-status-v1 '*) exit 0 ;;
    *) echo "cue helper status query failed (a helper older than 0.2.0 has no STATUS)" >&2; exit 1 ;;
  esac
fi

if [ "$VERB" = target ]; then
  if [ -n "$TARGET_NAME" ]; then
    response="$(exchange "TARGET $token $TARGET_NAME")"
  else
    response="$(exchange "TARGET $token")"
  fi
  printf '%s\n' "$response"
  case "$response" in 'OK target='*) exit 0 ;; *) exit 1 ;; esac
fi

if [ "$VERB" = lease ]; then
  response="$(exchange "LEASE $token $LEASE_LABEL")"
  printf '%s\n' "$response"
  case "$response" in 'OK lease='*) exit 0 ;; *) exit 1 ;; esac
fi

if [ "$VERB" = model ]; then
  response="$(exchange "MODEL $token $MODEL_ACTION")"
  printf '%s\n' "$response"
  case "$response" in OK\ detector=*) exit 0 ;; *) exit 1 ;; esac
fi

if [ "$VERB" = arm ]; then
  response="$(exchange "ARM $token $WINDOW_ID $CUE_SET now $WINDOW_MS $WINDOW_MODE")"
  printf '%s\n' "$response"
  case "$response" in OK\ armed=*) exit 0 ;; *) exit 1 ;; esac
fi

if [ "$VERB" = result ]; then
  response="$(exchange "RESULT $token $WINDOW_ID")"
  printf '%s\n' "$response"
  case "$response" in HIT\ *|MISS\ *|UNKNOWN\ *|PENDING\ *) exit 0 ;; *) exit 1 ;; esac
fi

if [ "$VERB" = snapshot ]; then
  response="$(exchange "GET $token")"
  printf '%s\n' "$response"
  case "$response" in
    'OK '*"visual=OBSERVED"*) ;;
    'OK '*) echo "cue helper returned a fail-closed observation" >&2; exit 1 ;;
    *) echo "cue helper control query failed" >&2; exit 1 ;;
  esac
  exit 0
fi

if [ "$VERB" = watchlist ]; then
  if [ "$WATCH_ACTION" = status ]; then
    response="$(exchange "WATCH $token status")"
  else
    response="$(exchange "WATCH $token $WATCH_HASH")"
  fi
  printf '%s\n' "$response"
  case "$response" in
    'OK watch='*) exit 0 ;;
    *) exit 1 ;;
  esac
fi

if [ "$VERB" = read ]; then
  response="$(exchange "READ $token")"
  printf '%s\n' "$response"
  case "$response" in
    'OK read='*) exit 0 ;;
    *) exit 1 ;;
  esac
fi

if [ "$VERB" = overlay ]; then
  response="$(exchange "OVERLAY $token")"
  printf '%s\n' "$response"
  case "$response" in
    'OK overlay='*) exit 0 ;;
    *) echo "cue helper overlay query failed" >&2; exit 1 ;;
  esac
fi

if [ "$VERB" = trace ]; then
  case "$TRACE_ACTION" in
    start)
      response="$(exchange "TRACE $token start $TRACE_LABEL")"
      printf '%s\n' "$response"
      case "$response" in
        'OK trace=ACTIVE'*) exit 0 ;;
        *) echo "cue helper frame trace did not start" >&2; exit 1 ;;
      esac
      ;;
    status)
      response="$(exchange "TRACE $token status")"
      printf '%s\n' "$response"
      case "$response" in
        'OK trace='*) exit 0 ;;
        *) echo "cue helper frame trace status failed" >&2; exit 1 ;;
      esac
      ;;
    stop)
      response="$(exchange "TRACE $token stop")"
      printf '%s\n' "$response"
      case "$response" in
        'OK trace=STOPPED '*|'OK trace=FULL '*) ;;
        *) echo "cue helper frame trace did not stop" >&2; exit 1 ;;
      esac
      name="$(printf '%s\n' "$response" | sed -n 's/.* file=\([^ ]*\).*/\1/p')"
      case "$name" in
        ''|*[!A-Za-z0-9._-]*) echo "trace stop returned an unsafe file name" >&2; exit 1 ;;
      esac
      mkdir -p "${FRAME_TRACE_OUT:-captures/frame-traces}"
      target="${FRAME_TRACE_OUT:-captures/frame-traces}/$name"
      if [ -e "$target" ]; then
        echo "refusing to overwrite $target" >&2
        exit 1
      fi
      adb exec-out run-as "$PACKAGE" cat "files/frame-traces/$name" > "$target"
      bytes="$(wc -c < "$target" | tr -d ' ')"
      if [ "$bytes" -lt 200 ]; then
        echo "pulled frame trace is empty ($bytes bytes)" >&2
        exit 1
      fi
      adb shell run-as "$PACKAGE" rm -f "files/frame-traces/$name" >/dev/null 2>&1 || true
      echo "wrote $target ($bytes bytes)"
      metric_args=("$HERE/actuation-frame-metric.py" "$target")
      if [ -n "${FRAME_TRACE_METRIC_START_NS:-}" ]; then
        metric_args+=(--start-ns "$FRAME_TRACE_METRIC_START_NS")
      fi
      if [ -n "${FRAME_TRACE_METRIC_END_NS:-}" ]; then
        metric_args+=(--end-ns "$FRAME_TRACE_METRIC_END_NS")
      fi
      # Keep this as the final line of a successful trace stop: every physical
      # actuation report carries the native-frame UNKNOWN percentage, and an
      # unbounded report says so explicitly instead of hiding setup frames.
      python3 "${metric_args[@]}"
      ;;
  esac
  exit 0
fi

if [ "$VERB" = latency ]; then
  # Plan 08 package 3, the "result receipt" leg. Everything is timed inside one
  # device shell against the device's own clock, so no adb round trip is
  # measured. The baseline pass times the same loop with the socket call
  # removed, because a forked `date` costs real milliseconds here and that cost
  # is part of what a shell-based controller would actually pay.
  samples="$(adb shell sh -s -- "$port" "$COUNT" "$token" <<'REMOTE' | tr -d '\r'
set -eu
port=$1
count=$2
token=$3
i=0
while [ "$i" -lt "$count" ]; do
  start=$(date +%s%N)
  printf 'GET %s\n' "$token" | toybox nc -w 2 127.0.0.1 "$port" >/dev/null 2>&1
  end=$(date +%s%N)
  echo "read $(( (end - start) / 1000 ))"
  i=$((i + 1))
done
i=0
while [ "$i" -lt "$count" ]; do
  start=$(date +%s%N)
  end=$(date +%s%N)
  echo "base $(( (end - start) / 1000 ))"
  i=$((i + 1))
done
REMOTE
)"
  printf '%s\n' "$samples" | python3 -c '
import sys

groups = {"read": [], "base": []}
for line in sys.stdin:
    parts = line.split()
    if len(parts) == 2 and parts[0] in groups:
        try:
            groups[parts[0]].append(int(parts[1]))
        except ValueError:
            pass

def pct(values, q):
    if not values:
        return float("nan")
    ordered = sorted(values)
    index = min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))
    return ordered[index]

for name, label in (("read", "snapshot read"), ("base", "shell baseline")):
    values = groups[name]
    if not values:
        print("%-14s no samples" % label)
        continue
    print("%-14s n=%-4d p50 %6.2f ms  p95 %6.2f ms  p99 %6.2f ms  max %6.2f ms"
          % (label, len(values), pct(values, 0.50) / 1000.0,
             pct(values, 0.95) / 1000.0, pct(values, 0.99) / 1000.0,
             max(values) / 1000.0))
if groups["read"] and groups["base"]:
    net = pct(groups["read"], 0.50) - pct(groups["base"], 0.50)
    print("socket cost at p50: %.2f ms" % (net / 1000.0))
'
  exit 0
fi

if [ "$VERB" = log ]; then
  if [ "$LOG_ACTION" = start ]; then
    on="$(exchange "CAL $token on")"
    case "$on" in
      'OK cal=on') ;;
      *) echo "could not enable calibration capture: $on" >&2; exit 1 ;;
    esac
    started="$(exchange "LOG $token start")"
    printf '%s\n' "$started"
    case "$started" in
      'OK log=started'*) ;;
      *) exchange "CAL $token off" >/dev/null 2>&1 || true; exit 1 ;;
    esac
    echo "capturing; stop with: tools/device/query-cue-helper.sh log stop [label]"
    exit 0
  fi

  response="$(exchange "LOG $token stop")"
  printf '%s\n' "$response"
  exchange "CAL $token off" >/dev/null 2>&1 || true
  case "$response" in
    'OK rec='*) ;;
    *) echo "continuous capture failed" >&2; exit 1 ;;
  esac
  start_ns="$(printf '%s\n' "$response" | sed -n 's/.* startNs=\([0-9][0-9]*\).*/\1/p')"
  case "$start_ns" in
    ''|*[!0-9]*)
      echo "continuous capture has no monotonic startNs anchor" >&2
      exit 1
      ;;
  esac
  name="$(printf '%s\n' "$response" | sed -n 's/.*rec=\([^ ]*\).*/\1/p')"
  mkdir -p "$OUT_DIR"
  target="$OUT_DIR/${LABEL}-${name}"
  sidecar="$target.meta.json"
  if [ -e "$target" ] || [ -e "$sidecar" ]; then
    echo "refusing to overwrite $target or its clock sidecar" >&2
    exit 1
  fi
  adb exec-out run-as "$PACKAGE" cat "files/calibration/$name" > "$target"
  adb shell run-as "$PACKAGE" rm -f "files/calibration/$name" >/dev/null 2>&1 || true
  bytes="$(wc -c < "$target" | tr -d ' ')"
  if [ "$bytes" -lt 45 ]; then
    echo "pulled capture is empty ($bytes bytes)" >&2
    exit 1
  fi
  python3 - "$target" "$sidecar" "$response" <<'PY'
import hashlib, json, pathlib, re, sys
wav = pathlib.Path(sys.argv[1])
sidecar = pathlib.Path(sys.argv[2])
response = sys.argv[3]
fields = dict(re.findall(r"([A-Za-z][A-Za-z0-9]*)=([^ ]+)", response))
required = ("rec", "frames", "rate", "bytes", "startNs")
if any(name not in fields for name in required):
    raise SystemExit("log-stop response lacks its clock/audio fields")
payload = {
    "schema": "cue-audio-anchor-v1",
    "wav": wav.name,
    "audio_sha256": hashlib.sha256(wav.read_bytes()).hexdigest(),
    "clock_domain": "helper_monotonic_ns",
    "start_ns": int(fields["startNs"]),
    "frames": int(fields["frames"]),
    "rate": int(fields["rate"]),
    "bytes": int(fields["bytes"]),
}
pathlib.Path(sidecar).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
PY
  echo "wrote $target ($bytes bytes)"
  echo "wrote $sidecar (helper monotonic sample-zero anchor)"
  exit 0
fi

# --- record -----------------------------------------------------------------
calibration_off() { exchange "CAL $token off" >/dev/null 2>&1 || true; }
trap 'calibration_off; cleanup' EXIT HUP INT TERM

on="$(exchange "CAL $token on")"
case "$on" in
  'OK cal=on') ;;
  *) echo "could not enable calibration capture: $on" >&2; exit 1 ;;
esac
# The ring only fills while calibration is on, so the pre-roll has to elapse.
sleep "$((PRE + 1))"

response="$(exchange "REC $token $PRE $POST")"
printf '%s\n' "$response"
case "$response" in
  'OK rec='*) ;;
  *) echo "calibration capture failed" >&2; exit 1 ;;
esac
name="$(printf '%s\n' "$response" | sed -n 's/.*rec=\([^ ]*\).*/\1/p')"

mkdir -p "$OUT_DIR"
target="$OUT_DIR/${LABEL}-${name}"
if [ -e "$target" ]; then
  echo "refusing to overwrite $target" >&2
  exit 1
fi
adb exec-out run-as "$PACKAGE" cat "files/calibration/$name" > "$target"
adb shell run-as "$PACKAGE" rm -f "files/calibration/$name" >/dev/null 2>&1 || true
bytes="$(wc -c < "$target" | tr -d ' ')"
if [ "$bytes" -lt 45 ]; then
  echo "pulled window is empty ($bytes bytes)" >&2
  exit 1
fi
echo "wrote $target ($bytes bytes)"
