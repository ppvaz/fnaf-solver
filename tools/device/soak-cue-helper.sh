#!/bin/bash
# Sample the already-running visual MediaProjection helper without touching
# the game. Defaults to 41 one-minute samples: a 40-minute endpoint-to-endpoint
# soak matching the unresolved memory gate in android/companion/README.md.
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
if [ "${CUE_HELPER_DEVICE_LOCK_HELD:-0}" != 1 ]; then
  export CUE_HELPER_DEVICE_LOCK_HELD=1
  exec python3 "$HERE/device-lock-exec.py" "$ANDROID_SERIAL" -- "$0" "$@"
fi

initial_pid="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
case "$initial_pid" in
  ''|*[!0-9]*)
    echo "cue helper is not running; start capture and grant consent first" >&2
    exit 1
    ;;
esac

printf 'sample\telapsed_s\tepoch_s\tpid\tpss_kb\trss_kb\tthreads\tthermal_status\tstatus_age_s\tvisual_seq\tvisual_age_us\tcontent_width\tcontent_height\tvisible\tgame_focused\tscreen\n' \
  > "$OUTPUT"

started=$SECONDS
previous_visual=-1
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

  thermal="$(adb shell dumpsys thermalservice 2>/dev/null | tr -d '\r' | awk -F': *' '/Thermal Status:/ { print $2; exit }' || true)"
  [ -n "$thermal" ] || thermal=-1

  if adb shell dumpsys window 2>/dev/null | \
      awk '/mCurrentFocus=.*com\.scottgames\.fnaf2/ { found=1 } END { exit !found }'; then
    game_focused=1
  else
    game_focused=0
    echo "sample $i: FNaF is not the focused physical-display window" >&2
    failed=1
  fi

  status="$(adb logcat -d --pid="$pid" -v epoch -s FnafCueHelper:I '*:S' 2>/dev/null | tr -d '\r' | awk '/visual=(OBSERVED|UNKNOWN) seq=/ { line=$0 } END { print line }')"
  status_epoch="$(printf '%s\n' "$status" | awk '{ value=$1; sub(/\..*/, "", value); print value }')"
  status_age=-1
  case "$status_epoch" in
    ''|*[!0-9]*) ;;
    *) status_age=$((epoch - status_epoch)) ;;
  esac
  visual="$(printf '%s\n' "$status" | sed -n 's/.*visual=OBSERVED seq=\([0-9][0-9]*\).*/\1/p')"
  visual_age="$(printf '%s\n' "$status" | sed -n 's/.*visual=OBSERVED.*ageUs=\([-0-9][0-9]*\) content=.*/\1/p')"
  content_width="$(printf '%s\n' "$status" | sed -n 's/.*content=\([0-9][0-9]*\)x[0-9][0-9]*.*/\1/p')"
  content_height="$(printf '%s\n' "$status" | sed -n 's/.*content=[0-9][0-9]*x\([0-9][0-9]*\).*/\1/p')"
  visible="$(printf '%s\n' "$status" | sed -n 's/.*visible=\([-0-9][0-9]*\).*/\1/p')"
  screen="$(printf '%s\n' "$status" | sed -n 's/.*visual=[A-Z]* seq=[0-9]* .* screen=\([A-Z0-9_]*\).*/\1/p')"

  if [ -z "$visual" ]; then
    echo "sample $i: no observed visual status found" >&2
    failed=1
  fi
  if [ "$status_age" -lt -2 ] || [ "$status_age" -gt 5 ]; then
    echo "sample $i: latest sensor status is not fresh (age ${status_age}s)" >&2
    failed=1
  fi
  visual="${visual:--1}"
  visual_age="${visual_age:--1}"
  content_width="${content_width:--1}"
  content_height="${content_height:--1}"
  visible="${visible:--1}"
  screen="${screen:-UNKNOWN}"

  if [ "$i" -gt 1 ]; then
    if [ "$visual" -le "$previous_visual" ]; then
      echo "sample $i: visual sequence did not advance ($previous_visual -> $visual)" >&2
      failed=1
    fi
  fi
  previous_visual=$visual

  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$i" "$elapsed" "$epoch" "$pid" "$pss" "$rss" "$threads" "$thermal" \
    "$status_age" "$visual" "$visual_age" "$content_width" "$content_height" "$visible" \
    "$game_focused" "$screen" >> "$OUTPUT"

  printf 'sample %d/%d elapsed=%ss pid=%s pss=%sKiB rss=%sKiB visual=%s screen=%s thermal=%s\n' \
    "$i" "$SAMPLES" "$elapsed" "$pid" "$pss" "$rss" "$visual" "$screen" "$thermal"
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
