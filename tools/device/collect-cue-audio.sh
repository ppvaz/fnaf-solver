#!/usr/bin/env bash
# Collect labeled Balloon Boy vocal audio by cold-starting short nights.
#
#   tools/device/collect-cue-audio.sh [rounds] [seconds] [label]
#
# **Device action.** It cold-starts FNaF, presses 6th Night, mutes the opening
# call, and waits while Balloon Boy takes his route. It sends no other input:
# surviving is not the point, and a run that dies still contains the vocals.
#
# Plan 08 package 1 needs labeled positive windows. Each round is one fresh
# route from CAM 10, so the vocals arrive in a known early stretch and the rest
# of the round is negative background. Rounds are recorded as session
# boundaries in a sidecar TSV, because package 2's holdout must split by
# session and never by adjacent windows from one recording.
#
# The helper must already be capturing with FNaF focused; audio is pulled from
# it, and raw game audio stays in ignored captures/.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROUNDS="${1:-4}"
SECONDS_PER="${2:-60}"
LABEL="${3:-bb-route}"
OUT_DIR="${CUE_HELPER_CALIBRATION:-captures/cue-helper/calibration}"
PACKAGE="com.ppvaz.fnafcompanion"

case "$ROUNDS$SECONDS_PER" in *[!0-9]*) echo "rounds and seconds must be whole numbers" >&2; exit 2 ;; esac
# The helper buffers a night in memory and stops rather than wrapping.
budget=$(( ROUNDS * (SECONDS_PER + 30) ))
if [ "$budget" -gt 450 ]; then
  echo "requested ~${budget}s exceeds the helper's 480 s buffer; reduce rounds" >&2
  exit 2
fi

. "$HERE/select-adb.sh"
source "$HERE/session.sh"
adb get-state >/dev/null
source "$HERE/coords.sh"

state() {
  local attempt result
  for attempt in 1 2 3; do
    if result=$(adb exec-out screencap -p 2>/dev/null |
      python3 "$HERE/screenstate.py" 2>/dev/null); then
      printf '%s\n' "$result"
      return 0
    fi
    sleep 1
  done
  printf '%s\n' "unavailable"
}

pid="$(adb shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r' | awk '{print $1}')"
case "$pid" in
  ''|*[!0-9]*) echo "Companion is not running; start capture first" >&2; exit 1 ;;
esac

mkdir -p "$OUT_DIR"
SESSIONS="$OUT_DIR/${LABEL}-sessions.tsv"
if [ -e "$SESSIONS" ]; then
  echo "refusing to overwrite $SESSIONS" >&2
  exit 1
fi

adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell cmd statusbar collapse >/dev/null 2>&1 || true

OUT_ABS=$(cd "$OUT_DIR" && pwd)

# One session for the whole collection, not one per round. Package 4's holdout
# must split by complete capture session, and rounds inside one helper log
# share a PCM buffer and an origin -- so they are one session with round
# boundaries, never several.
fnaf_session_begin "$LABEL" "tools/device/collect-cue-audio.sh"
fnaf_session_probe_target 6 "cue-audio-$LABEL-${ROUNDS}x${SECONDS_PER}s" \
  "cue-helper-pcm"
fnaf_session_record env "ROUNDS=$ROUNDS" "SECONDS_PER=$SECONDS_PER" "LABEL=$LABEL"
# There is no timed plan here; the script itself is the policy, so it is the
# thing whose bytes identify what ran.
fnaf_session_record controller \
  "policy_version=collect-cue-audio/$LABEL" \
  plan_id=collect-cue-audio.sh \
  "plan_file=$HERE/collect-cue-audio.sh" \
  actuator=adb-input emitted_action_trace=null
fnaf_session_record helper token_present=false "process_identity=cue-helper-pid-$pid"

"$HERE/query-companion.sh" log start >/dev/null
LOG_T0=$(date +%s)
# The host wall clock the round table is written in. It is coarse -- seconds --
# and that is exactly why it is named rather than merged into anything finer.
fnaf_session_record clock domain=host_wall_s kind=wall units=s \
  "origin_note=date +%s latched at helper log start; the round table's start/night/end columns are offsets from it. One-second resolution, sufficient for round boundaries and for nothing sub-second" \
  valid_from=0 "valid_until=$budget"
# Both are the host's own clock, so this edge is a subtraction rather than a
# measurement -- and its residual is host_wall_s's one-second resolution, which
# is the reason the two are kept as separate domains at all.
fnaf_session_record align from_domain=host_wall_s to_domain=host_monotonic_ms \
  "offset=$(( LOG_T0 * 1000 - FNAF2_SESSION_ORIGIN_WALL_MS ))" offset_units=ms \
  "method=helper log start minus the session origin, both read from the host clock" \
  residual=1000
SESSION_CLOSED=0
stop_log() {
  local status=$?
  "$HERE/query-companion.sh" log stop "$LABEL" || true
  # EXIT fires after INT/TERM have already run this handler; closing twice
  # would report a missing spool as if the session had never existed.
  [ "$SESSION_CLOSED" -eq 0 ] || return 0
  SESSION_CLOSED=1
  # After log stop, so the WAV exists to be hashed.
  local wav=""
  for candidate in "$OUT_ABS/$LABEL"-cue-*.wav; do
    [ -f "$candidate" ] && wav="$candidate"
  done
  if [ -n "$wav" ]; then
    fnaf_session_artifact "$wav" artifact_id=night-audio role=collection-pcm \
      authority=primary-observation format=audio/wav complete=true truncated=false \
      retention=local-only clock_domain=null \
      redaction.contains_game_media=true redaction.contains_audio=true \
      redaction.commit_safe=false
    fnaf_session_record note \
      "text=the helper's PCM startNs is printed by log stop and not saved beside the WAV, so this audio carries no clock domain and the round table is the only join"
  fi
  fnaf_session_artifact "$OUT_ABS/${LABEL}-sessions.tsv" artifact_id=round-table \
    role=collection-round-boundaries authority=operational-metadata \
    format=text/tab-separated-values complete=true truncated=false \
    retention=local-only clock_domain=host_wall_s \
    redaction.contains_game_media=false redaction.contains_audio=false \
    redaction.commit_safe=true
  if [ "$status" -eq 0 ]; then
    fnaf_session_finalize unknown \
      "all $ROUNDS rounds ran; whether any contains a vocal is the detector's answer, not this script's" || true
  else
    fnaf_session_finalize aborted "collection exited with status $status" || true
  fi
}
trap stop_log EXIT HUP INT TERM

printf 'round\tstart_s\tnight_s\tend_s\tstate\n' > "$SESSIONS"
round=1
while [ "$round" -le "$ROUNDS" ]; do
  start=$(( $(date +%s) - LOG_T0 ))
  adb shell am force-stop com.scottgames.fnaf2
  sleep 1
  adb shell am start -n com.scottgames.fnaf2/.Main >/dev/null
  # A cold start shows a splash before the title takes focus; poll rather than
  # guessing a single sleep.
  # dumpsys prints more than one mCurrentFocus line and the first is often
  # `null` mid-transition, so match the package across all of them rather than
  # taking the first line.
  focused=""
  for i in $(seq 1 20); do
    focus="$(adb shell dumpsys window 2>/dev/null | tr -d '\r' |
      grep mCurrentFocus || true)"
    if grep -Fq com.scottgames.fnaf2 <<<"$focus"; then
      focused=yes
      break
    fi
    sleep 1
  done
  [ -n "$focused" ] || { echo "abort: game never took focus" >&2; exit 1; }
  sleep 4
  source "$HERE/menu.sh"
  menu_select sixthNight || {
    echo "abort: could not select sixthNight on the title screen" >&2
    exit 1
  }

  night=""
  for i in $(seq 1 40); do
    if [ "$(state)" = "night" ]; then
      night=$(( $(date +%s) - LOG_T0 ))
      break
    fi
    sleep 1
  done
  if [ -z "$night" ]; then
    echo "round $round: night never started" >&2
    printf '%d\t%d\t\t%d\tno-night\n' "$round" "$start" \
      "$(( $(date +%s) - LOG_T0 ))" >> "$SESSIONS"
    fnaf_session_event kind=fault sensor=screenstate \
      "fault.fault_kind=night-never-started" \
      "fault.detail=round $round reached no night within 40 s" \
      "fault.degraded_to=round-discarded" \
      source_clock=host_wall_s "source_t=$(( $(date +%s) - LOG_T0 ))"
    round=$(( round + 1 ))
    continue
  fi
  # The round boundary, in the log's own clock. The TSV keeps the same raw
  # offsets; this does not replace it, it makes it joinable to the session.
  fnaf_session_event kind=lifecycle outcome=night terminal=false \
    sensor=screenstate source_clock=host_wall_s "source_t=$night" \
    "note=round $round of $ROUNDS started"
  # Mute the opening call: samples 35-40 would sit on top of the whole early
  # stretch, which is exactly where Balloon Boy's vocals land.
  sleep 1
  adb shell input swipe $TAP_MUTE $TAP_MUTE 120
  echo "round $round: night at +${night}s, holding ${SECONDS_PER}s"
  sleep "$SECONDS_PER"
  printf '%d\t%d\t%d\t%d\tok\n' "$round" "$start" "$night" \
    "$(( $(date +%s) - LOG_T0 ))" >> "$SESSIONS"
  round=$(( round + 1 ))
done

echo "wrote $SESSIONS"
