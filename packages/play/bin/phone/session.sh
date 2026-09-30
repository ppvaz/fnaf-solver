# shellcheck shell=bash
# Thread one session id and one monotonic origin through every producer.
#
# Sourced, never executed. `session-manifest.py` owns the file format; this
# owns the *threading*: the id is latched once by `fnaf_session_begin` and
# exported, so a helper started inside a run joins that run's manifest instead
# of inventing a second identity from a filename. That is the whole point --
# Plan 09 package 1 found artifacts that shared a basename and nothing else.
#
# Failure policy. Beginning a session may abort the caller: a run that cannot
# describe itself must not go on to collect evidence nobody can replay. Once
# the phone is live, a recording failure must NOT kill the night -- it marks
# the session faulted, says so on stderr, and finalize reports it. What is
# never allowed is a step that fails quietly and reads as coverage.
#
# Set FNAF2_MANIFEST=0 to disable recording entirely. That is for tooling that
# is testing something else; a device run that sets it produces evidence with
# no provenance, which is the state this plan exists to end.

FNAF2_SESSION_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FNAF2_SESSION_TOOL="$FNAF2_SESSION_HERE/../../../../tools/device/session-manifest.py"
FNAF2_MANIFEST="${FNAF2_MANIFEST:-1}"
FNAF2_SESSION_FAULT=0
# The build coords.sh, the screen models and the sourced event model are all
# pinned to. A model is authorized for THIS build; a phone carrying another one
# makes every model stale, and the manifest is where that becomes visible.
FNAF2_CALIBRATED_BUILD="2.0.7+26"

fnaf_session_active() {
  [ "$FNAF2_MANIFEST" = 1 ] && [ -n "${FNAF2_SESSION_RUN:-}" ]
}

fnaf_session_fault() {                          # message
  FNAF2_SESSION_FAULT=1
  export FNAF2_SESSION_FAULT
  echo "manifest: $1" >&2
}

# Begin (or join) a session for RUN. On success FNAF2_SESSION_ID and
# FNAF2_SESSION_RUN are exported; every later helper and subprocess uses them.
fnaf_session_begin() {                          # RUN COMMAND
  local run=$1 command=$2 out
  [ "$FNAF2_MANIFEST" = 1 ] || { echo "manifest: disabled (FNAF2_MANIFEST=0)" >&2; return 0; }
  if [ -n "${FNAF2_SESSION_RUN:-}" ]; then
    echo "manifest: joining session $FNAF2_SESSION_ID (started by $FNAF2_SESSION_RUN)" >&2
    return 0
  fi
  out=$(python3 "$FNAF2_SESSION_TOOL" start "$run" "command=$command") || {
    echo "manifest: could not start a session for $run; refusing to collect" >&2
    echo "          evidence that cannot name its build, clocks or models." >&2
    return 1
  }
  eval "$out"
  export FNAF2_SESSION_ID FNAF2_SESSION_RUN FNAF2_SESSION_ORIGIN_WALL_MS
  echo "manifest: session $FNAF2_SESSION_ID"
}

fnaf_session_record() {                         # OP key=value...
  fnaf_session_active || return 0
  python3 "$FNAF2_SESSION_TOOL" record "$FNAF2_SESSION_RUN" "$@" ||
    fnaf_session_fault "failed to record $1 ($*)"
}

fnaf_session_event() {                          # key=value...
  fnaf_session_active || return 0
  python3 "$FNAF2_SESSION_TOOL" event "$FNAF2_SESSION_RUN" "$@" ||
    fnaf_session_fault "failed to record event ($*)"
}

# Record an artifact only if it exists. A file the run never produced is not an
# artifact; it is a gap, and it is recorded as a fault so the manifest cannot
# imply the capture happened.
fnaf_session_artifact() {                       # PATH key=value...
  local path=$1; shift
  fnaf_session_active || return 0
  if [ -f "$path" ]; then
    fnaf_session_record artifact "file=$path" "$@"
  elif [ -d "$path" ]; then
    fnaf_session_record artifact "dir=$path" "$@"
  else
    fnaf_session_event kind=fault "fault.fault_kind=artifact-absent" \
      "fault.detail=${path##*/} was expected and never written" \
      "fault.degraded_to=not-recorded"
  fi
}

# Everything the manifest needs about the phone and the build, read once.
# ANDROID_SERIAL is deliberately not among them: a device serial never enters
# a manifest, and session-manifest.py refuses one anyway.
fnaf_session_probe_target() {                   # NIGHT CONFIGURATION SENSOR_PATH
  local night=$1 configuration=$2 sensor=$3
  local pkg=com.scottgames.fnaf2 dump version code model size width height t0 t1
  fnaf_session_active || return 0
  dump=$(adb shell dumpsys package "$pkg" 2>/dev/null | tr -d '\r' || true)
  version=$(awk -F'versionName=' '/versionName=/{split($2,a,/[ ,]/); print a[1]; exit}' <<<"$dump")
  code=$(awk -F'versionCode=' '/versionCode=/{split($2,a,/[ ,]/); print a[1]; exit}' <<<"$dump")
  model=$(adb shell getprop ro.product.model 2>/dev/null | tr -d '\r' || true)
  size=$(adb shell wm size 2>/dev/null | tr -d '\r' || true)
  # `wm size` prints Physical and possibly Override; the last one is in force.
  width=$(awk -F'x' '/[0-9]+x[0-9]+/{n=$0; sub(/.*: */,"",n); split(n,a,"x"); w=a[1]; h=a[2]} END{print (w>h?w:h)+0}' <<<"$size")
  height=$(awk -F'x' '/[0-9]+x[0-9]+/{n=$0; sub(/.*: */,"",n); split(n,a,"x"); w=a[1]; h=a[2]} END{print (w>h?h:w)+0}' <<<"$size")
  [ "$width" -gt 0 ] 2>/dev/null || { width=0; height=0; }

  fnaf_session_record target \
    "game_package=$pkg" \
    "game_version=${version:-unknown}" \
    "game_build=${version:-unknown}+${code:-unknown}" \
    "night=$night" \
    "configuration=$configuration" \
    "device_model=${model:-unknown}" \
    "display.width=$width" \
    "display.height=$height" \
    "display.orientation=landscape" \
    "sensor_path=$sensor"
  fnaf_session_record note \
    "text=display geometry is the physical panel long-side-first from \`wm size\` (${size//$'\n'/ }); orientation is landscape because the game presents landscape and coords.sh is calibrated in it"

  # The one measurement that makes the device's own clock comparable to the
  # host's. Bracketed, so the residual is the round trip rather than a guess.
  t0=$(python3 -c 'import time;print(int(time.time()*1000))')
  FNAF2_SESSION_DEVICE_MS=$(adb shell date +%s%3N 2>/dev/null | tr -d '\r' || true)
  t1=$(python3 -c 'import time;print(int(time.time()*1000))')
  case "${FNAF2_SESSION_DEVICE_MS:-}" in
    ''|*[!0-9]*)
      FNAF2_SESSION_DEVICE_MS=""
      fnaf_session_fault "could not read the device wall clock; no alignment edge" ;;
    *)
      FNAF2_SESSION_DEVICE_OFFSET=$(( FNAF2_SESSION_DEVICE_MS
        - ((t0 + t1) / 2 - FNAF2_SESSION_ORIGIN_WALL_MS) ))
      FNAF2_SESSION_DEVICE_RESIDUAL=$(( (t1 - t0) / 2 ))
      export FNAF2_SESSION_DEVICE_OFFSET FNAF2_SESSION_DEVICE_RESIDUAL ;;
  esac
  export FNAF2_SESSION_DEVICE_MS
}

# Close the session on whatever path got here. Callers pass the outcome they
# can actually defend; "unknown" is a legitimate answer and the only honest one
# for a runner that never graded its own recording.
fnaf_session_finalize() {                       # LIFECYCLE REASON
  local lifecycle=$1 reason=$2
  fnaf_session_active || return 0
  if [ -n "${FNAF2_SESSION_DEVICE_OFFSET:-}" ]; then
    # Declared here rather than at the probe because a clock's validity window
    # is only known once the session has an end. The raw device reading stays
    # raw in every event; this edge is what makes it comparable, and it carries
    # its own residual instead of pretending to be exact.
    fnaf_session_record clock domain=device_shell_wall_ms kind=wall units=ms \
      "origin_note=date +%s%3N inside adb shell (runner T0, epoch latch, cue trace). valid window is the measured offset extended by the host's own elapsed time" \
      "valid_from=$FNAF2_SESSION_DEVICE_OFFSET" \
      "valid_until=$(( FNAF2_SESSION_DEVICE_OFFSET + $(python3 -c "import time;print(int(time.time()*1000))") - FNAF2_SESSION_ORIGIN_WALL_MS ))"
    fnaf_session_record align from_domain=device_shell_wall_ms \
      to_domain=host_monotonic_ms \
      "offset=$FNAF2_SESSION_DEVICE_OFFSET" offset_units=ms \
      "method=adb shell date +%s%3N bracketed by the host wall clock" \
      "residual=${FNAF2_SESSION_DEVICE_RESIDUAL:-0}"
  fi
  if [ "$FNAF2_SESSION_FAULT" != 0 ]; then
    fnaf_session_record note \
      "text=INCOMPLETE: at least one fact failed to record during this run; see the fault events and the stderr log"
  fi
  python3 "$FNAF2_SESSION_TOOL" finalize "$FNAF2_SESSION_RUN" \
    "lifecycle=$lifecycle" "reason=$reason" || {
      echo "manifest: NOT VALID for $FNAF2_SESSION_RUN -- this run's evidence is" >&2
      echo "          unreplayable until the spool beside it is corrected." >&2
      return 1
    }
}
