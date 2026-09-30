#!/bin/bash
# Sample the already-running Companion capture without touching the game.
# Defaults to 41 one-minute samples: a 40-minute endpoint-to-endpoint soak
# matching the unresolved memory gate in android/companion/README.md.
#
# Each sample reads the versioned status (`query-companion.sh status`,
# companion-status-v1): capture on, frames advancing, frame age, fps, content
# geometry, and the named target, whose package must hold focus. Any game the
# Companion is pointed at can be soaked; a helper older than 0.2.0 has no
# STATUS and fails the first sample.
set -euo pipefail

SAMPLES="${1:-41}"
INTERVAL_SECONDS="${2:-60}"
OUTPUT="${3:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PACKAGE="com.ppvaz.fnafcompanion"

case "$SAMPLES" in
  ''|*[!0-9]*) echo "samples must be a positive integer" >&2; exit 2 ;;
esac
case "$INTERVAL_SECONDS" in
  ''|*[!0-9]*) echo "interval must be a positive integer" >&2; exit 2 ;;
esac
[ "$SAMPLES" -gt 0 ] || { echo "samples must be a positive integer" >&2; exit 2; }
[ "$INTERVAL_SECONDS" -gt 0 ] || {
  echo "interval must be a positive integer" >&2
  exit 2
}

if [ -z "$OUTPUT" ]; then
  OUTPUT="$ROOT/captures/cue-helper/soak-$(date +%Y%m%d-%H%M%S).tsv"
fi
[ ! -e "$OUTPUT" ] || { echo "refusing to overwrite: $OUTPUT" >&2; exit 2; }
mkdir -p "$(dirname "$OUTPUT")"

. "$HERE/select-adb.sh"
adb get-state >/dev/null

# Keep long-lived resource telemetry coherent with the active helper session.
if [ "${COMPANION_DEVICE_LOCK_HELD:-0}" != 1 ]; then
  export COMPANION_DEVICE_LOCK_HELD=1
  exec python3 "$HERE/device-lock-exec.py" "$ANDROID_SERIAL" -- "$0" "$@"
fi

initial_pid="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
case "$initial_pid" in
  ''|*[!0-9]*)
    echo "cue helper is not running; start capture and grant consent first" >&2
    exit 1
    ;;
esac

printf 'sample\telapsed_s\tepoch_s\tpid\tpss_kb\trss_kb\tthreads\tthermal\tframes\tframe_age_ms\tfps\tcontent_width\tcontent_height\tvisible\ttarget_focused\ttarget\n' \
  > "$OUTPUT"

started=$SECONDS
previous_frames=-1
failed=0
i=1
while [ "$i" -le "$SAMPLES" ]; do
  elapsed=$((SECONDS - started))
  epoch="$(date +%s)"
  pid="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
  case "$pid" in
    ''|*[!0-9]*)
      echo "sample $i: cue-helper process disappeared" >&2
      failed=1
      pid=0
      ;;
  esac
  if [ "$pid" != 0 ] && [ "$pid" != "$initial_pid" ]; then
    echo "sample $i: cue-helper process restarted ($initial_pid -> $pid)" >&2
    failed=1
  fi

  meminfo="$(adb shell dumpsys meminfo "$PACKAGE" 2>/dev/null | tr -d '\r' || true)"
  pss="$(printf '%s\n' "$meminfo" | awk '
    /TOTAL PSS:/ {
      for (i = 1; i <= NF; i++) if ($i == "PSS:") { print $(i + 1); exit }
    }
    $1 == "TOTAL" && $2 ~ /^[0-9]+$/ { fallback = $2 }
    END { if (fallback != "") print fallback }
  ' | head -n1)"
  [ -n "$pss" ] || pss=-1

  process_status=""
  if [ "$pid" != 0 ]; then
    process_status="$(adb shell cat "/proc/$pid/status" 2>/dev/null | tr -d '\r' || true)"
  fi
  rss="$(printf '%s\n' "$process_status" | awk '$1 == "VmRSS:" { print $2; exit }')"
  threads="$(printf '%s\n' "$process_status" | awk '$1 == "Threads:" { print $2; exit }')"
  [ -n "$rss" ] || rss=-1
  [ -n "$threads" ] || threads=-1

  status="$("$HERE/query-companion.sh" status 2>/dev/null | tr -d '\r' || true)"
  field() { printf '%s\n' "$status" | tr ' ' '\n' | sed -n "s/^$1=//p" | head -n1; }
  capture="$(field capture)"
  frames="$(field frames)"
  frame_age="$(field frameAgeMs)"
  fps="$(field fps)"
  content="$(field content)"
  visible="$(field visible)"
  target="$(field target)"
  thermal="$(field thermal)"
  case "$status" in
    'OK schema=companion-status-v1 '*) ;;
    *) echo "sample $i: no companion-status-v1 answer from the helper" >&2; failed=1 ;;
  esac
  if [ "$capture" != ON ]; then
    echo "sample $i: capture is ${capture:-UNKNOWN}, not ON" >&2
    failed=1
  fi
  case "$frames" in ''|*[!0-9]*) frames=-1 ;; esac
  case "$frame_age" in ''|*[!0-9]*) frame_age=-1 ;; esac
  case "$content" in
    [0-9]*x[0-9]*) content_width="${content%x*}"; content_height="${content#*x}" ;;
    *) content_width=-1; content_height=-1 ;;
  esac
  visible="${visible:-UNKNOWN}"
  fps="${fps:-UNKNOWN}"
  thermal="${thermal:-UNKNOWN}"
  target="${target:-NONE}"
  if [ "$frame_age" -lt 0 ] || [ "$frame_age" -gt 5000 ]; then
    echo "sample $i: the newest frame is not fresh (age ${frame_age} ms)" >&2
    failed=1
  fi
  if [ "$target" = NONE ]; then
    target_focused=0
    echo "sample $i: the Companion has no named target" >&2
    failed=1
  elif adb shell dumpsys window 2>/dev/null | \
      awk -v target="$target" 'index($0, "mCurrentFocus=") && index($0, target "/") { found=1 } END { exit !found }'; then
    target_focused=1
  else
    target_focused=0
    echo "sample $i: the target $target is not the focused window" >&2
    failed=1
  fi

  if [ "$i" -gt 1 ] && [ "$frames" -le "$previous_frames" ]; then
    echo "sample $i: frames did not advance ($previous_frames -> $frames)" >&2
    failed=1
  fi
  previous_frames=$frames

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$i" "$elapsed" "$epoch" "$pid" "$pss" "$rss" "$threads" "$thermal" \
    "$frames" "$frame_age" "$fps" "$content_width" "$content_height" "$visible" \
    "$target_focused" "$target" >> "$OUTPUT"

  printf 'sample %d/%d elapsed=%ss pid=%s pss=%sKiB rss=%sKiB frames=%s fps=%s target=%s thermal=%s\n' \
    "$i" "$SAMPLES" "$elapsed" "$pid" "$pss" "$rss" "$frames" "$fps" "$target" "$thermal"
  if [ "$i" -lt "$SAMPLES" ]; then
    sleep "$INTERVAL_SECONDS"
  fi
  i=$((i + 1))
done

awk -F '\t' '
  NR == 2 { first_pss=$5; first_rss=$6; min_pss=$5; max_pss=$5 }
  NR > 1 {
    last_pss=$5; last_rss=$6
    if ($5 >= 0 && (min_pss < 0 || $5 < min_pss)) min_pss=$5
    if ($5 > max_pss) max_pss=$5
  }
  END {
    printf "memory: PSS %d -> %d KiB (delta %+d, range %d..%d); RSS %d -> %d KiB (delta %+d)\n", \
      first_pss, last_pss, last_pss-first_pss, min_pss, max_pss, \
      first_rss, last_rss, last_rss-first_rss
  }
' "$OUTPUT"
echo "report: $OUTPUT"

if [ "$failed" -ne 0 ]; then
  echo "cue-helper soak observed one or more lifecycle/sensor failures" >&2
  exit 1
fi
