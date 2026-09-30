#!/bin/bash
# Bracket a device command with a Perfetto input-dispatch trace.
#
# The trace is intentionally started outside trial.sh: it observes the same
# phone run without adding screencap work to the timed policy. The command
# after `--` is run only after Perfetto reports that its data sources started.
#
# Usage:
#   atrace-input.sh RUN [SECONDS] -- COMMAND [ARGS...]
#
# Output:
#   captures/RUN-input.pftrace
#   captures/RUN-video.mp4 when CAPTURE_SCREENRECORD=1
#   captures/RUN-surfaceflinger-latency.txt when SF_LAYER is set.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CAPTURES="$HERE/../../../../captures"
RUN="${1:-}"
TRACE_SECONDS="${2:-600}"
[ -n "$RUN" ] && [ -n "${2:-}" ] || {
  echo "usage: atrace-input.sh RUN SECONDS -- COMMAND [ARGS...]" >&2
  exit 2
}
shift 2
[ "${1:-}" = "--" ] && shift || {
  echo "usage: atrace-input.sh RUN SECONDS -- COMMAND [ARGS...]" >&2
  exit 2
}
[ "$#" -gt 0 ] || { echo "missing command after --" >&2; exit 2; }

case "$RUN" in
  ''|.*|*..*|*[!A-Za-z0-9_-]*)
    echo "RUN must use letters, numbers, dash, or underscore" >&2
    exit 2
    ;;
esac
case "$TRACE_SECONDS" in
  ''|*[!0-9]*) echo "SECONDS must be a positive integer" >&2; exit 2 ;;
esac
[ "$TRACE_SECONDS" -gt 0 ] || { echo "SECONDS must be positive" >&2; exit 2; }
PERFETTO_BUFFER_MB="${PERFETTO_BUFFER_MB:-256}"
case "$PERFETTO_BUFFER_MB" in
  ''|*[!0-9]*) echo "PERFETTO_BUFFER_MB must be a positive integer" >&2; exit 2 ;;
esac
[ "$PERFETTO_BUFFER_MB" -gt 0 ] || {
  echo "PERFETTO_BUFFER_MB must be positive" >&2
  exit 2
}
PERFETTO_APP="${PERFETTO_APP:-*}"
case "$PERFETTO_APP" in
  '*'|[A-Za-z0-9._-]*) ;;
  *) echo "PERFETTO_APP must be a package name or '*'" >&2; exit 2 ;;
esac
# Explicit-config ATrace app filters only attach to processes that are alive
# when the source starts on this handset. The live probes launch the game
# inside the bracketed command, so filtering here silently loses the actual
# actuation. Keep the explicit path all-app by default; a caller that has
# already started the target process may opt into the narrower filter.
PERFETTO_ATRACE_APPS="${PERFETTO_ATRACE_APPS:-*}"
case "$PERFETTO_ATRACE_APPS" in
  '*'|[A-Za-z0-9._-]*) ;;
  *) echo "PERFETTO_ATRACE_APPS must be a package name or '*'" >&2; exit 2 ;;
esac
# `sched` produces enough kernel events to overwrite a long input trace on the
# Moto g56. Keep a full-night capture focused on Android input/application
# slices by default; a short scheduler investigation may opt in explicitly.
PERFETTO_INCLUDE_SCHED="${PERFETTO_INCLUDE_SCHED:-0}"
case "$PERFETTO_INCLUDE_SCHED" in
  0|1) ;;
  *) echo "PERFETTO_INCLUDE_SCHED must be 0 or 1" >&2; exit 2 ;;
esac
# The light CLI categories do not request SurfaceFlinger's frame timeline.
# Enable this for frame-accurate animation work: it records the display's
# actual present timeline alongside the input trace. The ordinary input path
# stays smaller unless a caller asks for the authoritative presentation rows.
PERFETTO_INCLUDE_SURFACE="${PERFETTO_INCLUDE_SURFACE:-0}"
case "$PERFETTO_INCLUDE_SURFACE" in
  0|1) ;;
  *) echo "PERFETTO_INCLUDE_SURFACE must be 0 or 1" >&2; exit 2 ;;
esac
PERFETTO_ATRACE_CATEGORIES=(input view wm gfx)
[ "$PERFETTO_INCLUDE_SCHED" -eq 0 ] || PERFETTO_ATRACE_CATEGORIES+=(sched)
CAPTURE_SCREENRECORD="${CAPTURE_SCREENRECORD:-0}"
case "$CAPTURE_SCREENRECORD" in
  0|1) ;;
  *) echo "CAPTURE_SCREENRECORD must be 0 or 1" >&2; exit 2 ;;
esac
 # Canonical recordings retain the selected display's native geometry. A
 # smaller size remains available only as an explicit derived-capture override.
CAPTURE_SCREENRECORD_SIZE="${CAPTURE_SCREENRECORD_SIZE:-native}"
case "$CAPTURE_SCREENRECORD_SIZE" in
  native) ;;
  *[!0-9x]*|x*|*x|*x*x*) echo "CAPTURE_SCREENRECORD_SIZE must be native or WIDTHxHEIGHT" >&2; exit 2 ;;
  *) ;;
esac
if [ "$CAPTURE_SCREENRECORD_SIZE" != native ]; then
  CAPTURE_SCREENRECORD_WIDTH="${CAPTURE_SCREENRECORD_SIZE%x*}"
  CAPTURE_SCREENRECORD_HEIGHT="${CAPTURE_SCREENRECORD_SIZE#*x}"
  [ "$CAPTURE_SCREENRECORD_WIDTH" -gt 0 ] && [ "$CAPTURE_SCREENRECORD_HEIGHT" -gt 0 ] || {
    echo "CAPTURE_SCREENRECORD_SIZE dimensions must be positive" >&2
    exit 2
  }
fi
CAPTURE_SCREENRECORD_BITRATE="${CAPTURE_SCREENRECORD_BITRATE:-3000000}"
case "$CAPTURE_SCREENRECORD_BITRATE" in
  ''|*[!0-9]*) echo "CAPTURE_SCREENRECORD_BITRATE must be a positive integer" >&2; exit 2 ;;
esac
[ "$CAPTURE_SCREENRECORD_BITRATE" -gt 0 ] || {
  echo "CAPTURE_SCREENRECORD_BITRATE must be positive" >&2
  exit 2
}

OUTPUT="$CAPTURES/${RUN}-input.pftrace"
[ ! -e "$OUTPUT" ] || { echo "refusing to overwrite $OUTPUT" >&2; exit 2; }
VIDEO_OUTPUT="$CAPTURES/${RUN}-video.mp4"
if [ "$CAPTURE_SCREENRECORD" -eq 1 ] && [ -e "$VIDEO_OUTPUT" ]; then
  echo "refusing to overwrite $VIDEO_OUTPUT" >&2
  exit 2
fi
SF_OUTPUT="$CAPTURES/${RUN}-surfaceflinger-latency.txt"
if [ -n "${SF_LAYER:-}" ] && [ -e "$SF_OUTPUT" ]; then
  echo "refusing to overwrite $SF_OUTPUT" >&2
  exit 2
fi

# Select exactly one phone before the trace starts. This also keeps the
# subsequent plain `adb` commands on the same explicit transport.
# shellcheck source=select-adb.sh
. "$HERE/../phone/select-adb.sh"
if [ "$CAPTURE_SCREENRECORD" -eq 1 ]; then
  CAPTURE_SCREENRECORD_SIZE=$(fnaf_resolve_screenrecord_size "$CAPTURE_SCREENRECORD_SIZE") || exit 1
fi
PERFETTO_HELP=$(adb shell perfetto --help 2>&1 || true)
case "$PERFETTO_HELP" in
  *"Usage: perfetto"*) ;;
  *) echo "selected device has no usable perfetto client" >&2; exit 1 ;;
esac
mkdir -p "$CAPTURES"

REMOTE="/data/misc/perfetto-traces/${RUN}-input-$$.pftrace"
REMOTE_VIDEO="/sdcard/${RUN}-video-$$.mp4"
TRACE_PID=""
VIDEO_PID=""

finish() {
  status=$?
  set +e
  if [ -n "$TRACE_PID" ]; then
    # perfetto's documented termination path flushes the trace before exit.
    adb shell kill -TERM "$TRACE_PID" >/dev/null 2>&1
    ready=0
    for _ in $(seq 1 80); do
      if adb shell test -s "$REMOTE" >/dev/null 2>&1; then
        ready=1
        break
      fi
      sleep 0.25
    done
    if [ "$ready" -eq 1 ]; then
      if ! adb pull "$REMOTE" "$OUTPUT" >/dev/null; then
        echo "could not pull Perfetto trace" >&2
        [ "$status" -ne 0 ] || status=1
      else
        echo "saved ${OUTPUT#"$HERE/../../"}"
      fi
    else
      echo "Perfetto trace did not become readable: $REMOTE" >&2
      [ "$status" -ne 0 ] || status=1
    fi
    adb shell rm "$REMOTE" >/dev/null 2>&1
  fi
  if [ -n "$VIDEO_PID" ]; then
    adb shell kill -INT "$VIDEO_PID" >/dev/null 2>&1
    ready=0
    for _ in $(seq 1 80); do
      if ! adb shell kill -0 "$VIDEO_PID" >/dev/null 2>&1 &&
         adb shell test -s "$REMOTE_VIDEO" >/dev/null 2>&1; then
        ready=1
        break
      fi
      sleep 0.25
    done
    if [ "$ready" -eq 1 ]; then
      if ! adb pull "$REMOTE_VIDEO" "$VIDEO_OUTPUT" >/dev/null; then
        echo "could not pull screen recording" >&2
        [ "$status" -ne 0 ] || status=1
      else
        echo "saved ${VIDEO_OUTPUT#"$HERE/../../"}"
      fi
    else
      echo "screen recording did not finalize: $REMOTE_VIDEO" >&2
      [ "$status" -ne 0 ] || status=1
    fi
    adb shell rm "$REMOTE_VIDEO" >/dev/null 2>&1
  fi
  if [ -n "${SF_LAYER:-}" ]; then
    if ! adb shell dumpsys SurfaceFlinger --latency "$SF_LAYER" > "$SF_OUTPUT"; then
      echo "could not read SurfaceFlinger latency for '$SF_LAYER'" >&2
      [ "$status" -ne 0 ] || status=1
    else
      echo "saved ${SF_OUTPUT#"$HERE/../../"}"
    fi
  fi
  exit "$status"
}
trap finish EXIT HUP INT TERM

PERFETTO_CATEGORY_TEXT="${PERFETTO_ATRACE_CATEGORIES[*]}"
if [ "$PERFETTO_INCLUDE_SURFACE" -eq 1 ]; then
  # Explicit config mode is required to turn on the phone's actual frame
  # timeline. Keep the same input/view/gfx sources as the light CLI and add
  # SurfaceFlinger frame + frametimeline rows. The trace is still stopped by
  # the EXIT trap, so the command being bracketed defines its duration.
  PERFETTO_BUFFER_KB=$((PERFETTO_BUFFER_MB * 1024))
  PERFETTO_FTRACE_SCHED=""
  [ "$PERFETTO_INCLUDE_SCHED" -eq 0 ] || PERFETTO_FTRACE_SCHED='ftrace_events: "sched/sched_switch"'
  PERFETTO_ATRACE_APP=""
  [ "$PERFETTO_ATRACE_APPS" = "*" ] || PERFETTO_ATRACE_APP="atrace_apps: \"$PERFETTO_ATRACE_APPS\""
  PERFETTO_CONFIG=$(cat <<EOF
buffers: { size_kb: ${PERFETTO_BUFFER_KB} fill_policy: RING_BUFFER }
data_sources: { config: { name: "android.process_stats" } }
data_sources: { config: { name: "android.surfaceflinger.frametimeline" } }
data_sources: { config: { name: "android.surfaceflinger.frame" } }
data_sources: { config: { name: "android.surfaceflinger.layers" } }
data_sources: { config: { name: "track_event" track_event_config: {
  enabled_categories: "input"
  enabled_categories: "view"
  enabled_categories: "wm"
  enabled_categories: "gfx"
} } }
data_sources: { config: { name: "linux.ftrace" ftrace_config: {
  atrace_categories: "input"
  atrace_categories: "view"
  atrace_categories: "wm"
  atrace_categories: "gfx"
  ${PERFETTO_ATRACE_APP}
  ${PERFETTO_FTRACE_SCHED}
} } }
EOF
)
  pid_text=$(printf '%s\n' "$PERFETTO_CONFIG" | adb shell "perfetto --txt --background-wait --config - --out ${REMOTE}")
else
  pid_text=$(adb shell "perfetto --background-wait -t ${TRACE_SECONDS}s -b ${PERFETTO_BUFFER_MB:-256}mb --out ${REMOTE} -a '${PERFETTO_APP}' ${PERFETTO_CATEGORY_TEXT}")
fi
TRACE_PID=$(printf '%s\n' "$pid_text" | awk '/^[0-9]+$/{pid=$0} END{print pid}')
[ -n "$TRACE_PID" ] || {
  echo "Perfetto did not return a background session pid" >&2
  exit 1
}
echo "Perfetto input trace running (pid $TRACE_PID, max ${TRACE_SECONDS}s; ${PERFETTO_CATEGORY_TEXT}; atrace_apps=${PERFETTO_ATRACE_APPS})"
if [ "$CAPTURE_SCREENRECORD" -eq 1 ]; then
  SCREENRECORD_HELP=$(adb shell screenrecord --help 2>&1 || true)
  case "$SCREENRECORD_HELP" in
    *'Set to 0'*'remove the time limit'*) ;;
    *) echo "selected device cannot record an unbounded video" >&2; exit 1 ;;
  esac
  video_pid_text=$(adb shell "screenrecord --size ${CAPTURE_SCREENRECORD_SIZE} --bit-rate ${CAPTURE_SCREENRECORD_BITRATE} --time-limit 0 ${REMOTE_VIDEO} >/dev/null 2>&1 & echo \$!")
  VIDEO_PID=$(printf '%s\n' "$video_pid_text" | awk '/^[0-9]+$/{pid=$0} END{print pid}')
  [ -n "$VIDEO_PID" ] || {
    echo "screenrecord did not return a background pid" >&2
    exit 1
  }
  sleep 1
  adb shell kill -0 "$VIDEO_PID" >/dev/null 2>&1 || {
    echo "screenrecord exited before the command began" >&2
    exit 1
  }
  echo "screen recording running (pid $VIDEO_PID, ${CAPTURE_SCREENRECORD_SIZE}@${CAPTURE_SCREENRECORD_BITRATE})"
fi

"$@"
