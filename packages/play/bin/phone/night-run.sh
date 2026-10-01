#!/usr/bin/env bash
# One command per device attempt, any night: record, run, reconstruct, reset.
# (Named night5-run.sh until 2026-09-13; it drove Nights 5 and 6 alike.)
#
# Every previous attempt was assembled by hand across two terminals (PROGRESS,
# 2026-09-11): start `screenrecord`, run the campaign, stop the recording, pull
# it, hash it, run `phase-reconstruct.mjs`, run `run-timeline.py`, then drive
# the phone back to the title. Six manual steps is six ways to lose an attempt,
# and mistake-register entry 6 says every aborted attempt leaves the game
# mid-night. This script is that sequence with the failure handling attached:
#
#   - fail-fast: every input path, the serial, and every downstream tool are
#     checked for EXISTENCE before the phone is touched (mistake 5: a wrong
#     tool path failed silently behind `&& echo` twice).
#   - fail-safe: an EXIT trap always stops the recording, always pulls what was
#     captured, and always drives the game back to an OBSERVED title, whether
#     the campaign passed, failed, or the operator killed it.
#
# Usage:
#   packages/play/bin/phone/night-run.sh --label baseline [--bundle DIR] [--night N]
#                              [--serial ID] [--calibration FILE] [--no-video] [--no-grade]
#                              [--bt-audio] [--teach-overlay] [--live --confirm-live]
#
# Dry by default (Pedro, 2026-09-29; ADR 0002): without --live it prints the
# campaign command it would run and touches no phone -- no adb call, no lease,
# no serial needed. A live night needs --live and --confirm-live, the same pair
# the campaign CLI requires, and both are forwarded to it. Until 2026-09-29 no
# flag meant live and --dry-run was the opt-out; --dry-run is still accepted.
#
# The serial is --serial, else FNAF_SERIAL, else the untracked local profile
# (packages/play/bin/phone/local-profile.ts, ADR 0002 decision 8). No default: a live run
# with none of the three refuses before it touches anything.
set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
cd "$ROOT"
ORIGINAL_ARGS=("$@")

LABEL=""
BUNDLE="artifacts/night5-moved"
QUALIFICATION="docs/evidence/qualification-hid-mediaprojection-night5-20260911-seam-corrected.json"
PROFILE="hid-mediaprojection"
SERIAL=""            # --serial; else FNAF_SERIAL, else the local profile (resolved below)
NIGHT=5
SAVE_CURSOR=""
# Night 7 is the Custom Night: the campaign sets the ten dials to 20 through
# the measured dial screen (custom-night-calibration-v1, one guided session
# on this build) and refuses without it. Story nights ignore it.
CALIBRATION=""
ARM_MODE="observe-once"
VIDEO=1
GRADE=1               # --no-grade: keep and hash the recording, skip grade-run.sh (cohort loops grade later)
BT_AUDIO=0            # --bt-audio: retain the phone's A2DP mix via BlueALSA (packages/play/bin/audio/capture-bt-audio.sh)
BT_AUDIO_BASE=""
TRACE=1
TRACE_SECONDS="${FNAF_TRACE_SECONDS:-900}"
FRAME_TRACE=0
STATIC_READOUT=0      # --static-readout: native camera-view pixels through the night (needs --frame-trace)
STATIC_MODEL="packages/play/profiles/fnaf2/moto-g56/static-view-moto-g56-v207.json"
INPUT_TRACE=1
FORCE_TRACE=0
LIVE=0               # --live: actuate the phone (with --confirm-live)
CONFIRM_LIVE=0
DRY_FLAG=0           # --dry-run: the default, kept as an explicit spelling
TEACH=0               # --teach-overlay: the helper narrates the cycle on its teach panel (a demonstration run)
EXTRA=()

while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --bundle) BUNDLE="$2"; shift 2 ;;
    --qualification) QUALIFICATION="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --serial) SERIAL="$2"; shift 2 ;;
    --night) NIGHT="$2"; shift 2 ;;
    --save-cursor) SAVE_CURSOR="$2"; shift 2 ;;
    --calibration) CALIBRATION="$2"; shift 2 ;;
    --arm-blocking) ARM_MODE="blocking"; shift ;;
    --arm-observe-once) ARM_MODE="observe-once"; shift ;;
    # For plans with no #arm-verify declaration (the minus7 catalog): the
    # campaign layer refuses an armMode without an arm-verified plan, and the
    # executor itself treats a missing armVerification as pre-verified.
    --arm-none) ARM_MODE="none"; shift ;;
    --dials) DIALS="$2"; shift 2 ;;
    --no-trace) TRACE=0; shift ;;
    --force-trace) FORCE_TRACE=1; shift ;;
    --frame-trace) FRAME_TRACE=1; shift ;;
    --static-readout) STATIC_READOUT=1; shift ;;
    --no-input-trace) INPUT_TRACE=0; shift ;;
    --trace-seconds) TRACE_SECONDS="$2"; shift 2 ;;
    --no-video) VIDEO=0; shift ;;
    --no-grade) GRADE=0; shift ;;
    --bt-audio) BT_AUDIO=1; shift ;;
    --teach-overlay) TEACH=1; shift ;;
    --live) LIVE=1; shift ;;
    --confirm-live) CONFIRM_LIVE=1; shift ;;
    --dry-run) DRY_FLAG=1; shift ;;
    --) shift; EXTRA+=("$@"); break ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

die() { printf 'night-run: %s\n' "$1" >&2; exit 2; }
say() { printf '\n=== %s\n' "$1"; }

[ -n "$LABEL" ] || die "--label is required (it names the artifacts)"
[ "${SAVE_CURSOR:-}" != "" ] || SAVE_CURSOR="$NIGHT"

# ---- dry unless --live ------------------------------------------------------
[ "$DRY_FLAG" = 1 ] && [ "$LIVE" = 1 ] && die "--dry-run and --live are mutually exclusive"
if [ "$LIVE" = 1 ]; then
  [ "$CONFIRM_LIVE" = 1 ] || die "a live night needs both --live and --confirm-live"
  DRY=0
else
  DRY=1
fi

# ---- the serial: --serial, FNAF_SERIAL, the local profile, or a refusal ------
# A dry run proceeds without one: it never addresses the phone.
if [ -z "$SERIAL" ]; then
  if serial_out="$(node "$HERE/local-profile.ts" serial 2>&1)"; then
    SERIAL="$serial_out"
  elif [ "$DRY" = 0 ]; then
    die "live night refused: ${serial_out#local-profile: }"
  fi
fi

# ---- the serial lease --------------------------------------------------------
# Every other live runner (fnaf1-*, fnaf3-run.sh, fnaf4-run.sh) re-executes
# itself under device-lock-exec.py; until 2026-09-27 this one took no lease at
# all, so a FNaF 2 night could start on a phone another agent was driving. A
# live run takes the lease here, before its first adb call, and keeps it
# through the EXIT trap's reset (device-lock-exec.py relays the interrupt and
# waits). A caller that already holds the lease -- the queue's night job inside
# an overnight window -- passes FNAF_LEASE_HELD=1, the marker fnaf4-run.sh takes
# as FNAF4_LEASE_HELD. A dry run touches no phone and takes no lease.
[ "$DRY" = 1 ] || case "$SERIAL" in ''|*[!A-Za-z0-9._:-]*) die "--serial is invalid: $SERIAL" ;; esac
if [ "$DRY" = 0 ] && [ "${FNAF_LEASE_HELD:-}" != 1 ]; then
  exec python3 "$HERE/../../src/safety/device-lock-exec.py" "$SERIAL" -- \
    env FNAF_LEASE_HELD=1 FNAF_SERIAL="$SERIAL" bash "$HERE/night-run.sh" "${ORIGINAL_ARGS[@]}"
fi

# ---- fail-fast: inputs and tools exist before the phone is touched ----------
TITLE_MODEL_PATH="packages/play/profiles/fnaf2/moto-g56/title-moto-g56-v207.json"
CAUSE_MODEL_PATH="packages/play/profiles/fnaf2/moto-g56/death-cause-withered-chica-moto-g56-v207.json"
TRACE_TOOL="packages/play/bin/probe/atrace-input.sh"
for path in "$BUNDLE/manifest.json" "$QUALIFICATION" "$TITLE_MODEL_PATH" \
            packages/propose/bin/report/phase-reconstruct.mjs packages/review/bin/grade/run-timeline.py \
            packages/play/src/sensors/screencap/title-observe.py packages/play/bin/probe/inputtrace.py \
            "$TRACE_TOOL" apps/desktop/src/device-cli.ts apps/desktop/src/evidence.ts; do
  [ -e "$path" ] || die "missing required input: $path"
done
# A dry run stops short of the phone: it asks adb nothing, not even get-state.
if [ "$DRY" = 0 ]; then
  command -v adb >/dev/null || die "adb is not on PATH"
  adb -s "$SERIAL" get-state >/dev/null 2>&1 || die "device $SERIAL is not reachable"
fi

# Mistake-register 8: ask the phone what it offers BEFORE paying for an
# instrument. This handset advertises `android.inputmethod` and no
# `android.input.inputevent`, so the Perfetto input trace can only ever produce
# NO APP DISPATCH SLICES -- and it was still wired on by default, so every
# attempt carried a 900 s trace and every pipeline printed a FAILED step for a
# question this phone cannot answer. `plans/PROGRESS.md` recorded that negative
# on 2026-08-30 and a full night was spent rediscovering it on 2026-09-11.
#
# capabilities.ts is the one place that knows, so this asks it rather than
# re-deriving the answer here. `--force-trace` keeps the trace anyway (a
# different handset, or a deliberate SurfaceFlinger-only capture).
if [ "$DRY" = 0 ] && [ "$TRACE" = 1 ] && [ "$FORCE_TRACE" = 0 ]; then
  if FNAF_SERIAL="$SERIAL" node -e '
      import("./packages/play/bin/phone/capabilities.ts").then(m => {
        const d = m.probe(process.env.FNAF_SERIAL);
        if (d.perfettoDataSources === null) process.exit(2);
        process.exit(d.perfettoDataSources.includes("android.input.inputevent") ? 0 : 1);
      }).catch(() => process.exit(2));' 2>/dev/null; then
    :
  else
    case $? in
      1) TRACE=0
         printf 'trace    SKIPPED -- no android.input.inputevent on %s; the Perfetto\n' "$SERIAL"
         printf '         input trace cannot produce app dispatch rows here (see\n'
         printf '         npm run device:capabilities). --force-trace overrides.\n' ;;
      *) printf 'trace    capability UNREADABLE; keeping the trace on\n' >&2 ;;
    esac
  fi
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUNID="night${NIGHT}-${LABEL}-${STAMP}"
# The helper's trace label is at most 48 plain-ASCII characters
# (query-companion.sh refuses longer ones). A --frame-trace run whose run id
# is longer starts normally, loses its trace at `trace start`, and finishes as
# a blind attempt: night7-night7-anchoredj9-aim2315-tf-20260913T233252Z (52
# characters, the label already carried the night prefix) did exactly that on
# 2026-09-13. Refuse before touching the phone.
if [ "$STATIC_READOUT" = 1 ] && [ "$FRAME_TRACE" != 1 ]; then
  die "--static-readout reads the camera static against the frame trace's own image clock: add --frame-trace"
fi
if [ "$FRAME_TRACE" = 1 ] && [ "${#RUNID}" -gt 48 ]; then
  die "--frame-trace needs a run id of at most 48 characters; '$RUNID' has ${#RUNID} (the label gets 'night${NIGHT}-' and a 16-character stamp)"
fi
OUTDIR="artifacts/runs/$RUNID"
mkdir -p "$OUTDIR" captures
# A teach run carries the helper's panel in its video. The marker names the
# panel's rectangle so every later reading of this run knows it is there; the
# video instruments are not panel-aware, so grading is left to
# `run-timeline.py --exclude-rect` over that rectangle.
if [ "$TEACH" = 1 ]; then
  cp packages/play/profiles/fnaf2/moto-g56/teach-panel-v1.json "$OUTDIR/teach-panel.json"
  if [ "$GRADE" = 1 ]; then
    printf 'teach    the panel is in the video: grade-run.sh skipped; TERMINAL via run-timeline.py --exclude-rect 10,310,590,410\n'
    GRADE=0
  fi
fi
DEVICE_VIDEO="/sdcard/${RUNID}.mp4"
HOST_VIDEO="captures/${RUNID}.mp4"

printf 'run      %s\nbundle   %s\nserial   %s\nnight    %s (save cursor %s)\narm      %s\nout      %s\n' \
  "$RUNID" "$BUNDLE" "${SERIAL:-UNKNOWN (a dry run needs none)}" "$NIGHT" "$SAVE_CURSOR" "$ARM_MODE" "$OUTDIR"

REC_PID=""
FRAME_TRACE_PID=""
INPUT_TRACE_PID=""
FRAME_TRACE_STARTED=0
RESET_DONE=0
ANALYZED=0
CAMPAIGN_CODE=""
CAMPAIGN_DIR=""

# The Companion's native frame trace, which is the instrument that measured
# the mask button's appearance in the first place (absent to 322 ms after
# monitor-down, faint at ~337 ms, fully visible at ~382.5 ms) and the one
# `actuation-frame-metric.py` and `input-frame-align.py` both read.
#
# Perfetto cannot answer the same question on this handset: it advertises
# `android.inputmethod` and no `android.input.inputevent`, so there is no app
# dispatch source to capture and `inputtrace.py` correctly reports
# NO APP DISPATCH SLICES.
#
# OPT-IN, deliberately. The trace drains the same ImageReader the executor's
# own gate reads, so a traced run is a MEASUREMENT run and not a win attempt.
# It also cannot start before the campaign: preflight force-stops the helper to
# restart capture, which would kill an in-flight trace. So it waits for the
# night to be live and starts there, covering the steady loop rather than the
# opening.
start_frame_trace() {
  [ "$FRAME_TRACE" = 1 ] || return 0
  printf 'PENDING\n' > "$OUTDIR/frame-trace.state"
  # Start on evidence.started: the campaign emits it once its preflight has
  # restarted the helper's capture (which would drop an earlier trace), about
  # 16 s before the night's onset. Later triggers missed the onset: night-go
  # opened night5-anchor1's trace 4.0 s after it, and hid.schedule-start
  # (4.09 s before anchor3's release) plus the helper's ~1.4 s from start
  # command to first frame opened anchor3's already inside the night -- so
  # neither run could check the latch or the delivered epoch against frames.
  ( waited_ms=0 started=0
    while [ "$waited_ms" -lt 240000 ]; do
      if grep -q '"type":"evidence.started"' "$OUTDIR/campaign.log" 2>/dev/null; then
        if packages/play/bin/companion/query-companion.sh trace start "$RUNID" >/dev/null 2>&1; then
          printf '\nframe trace started (label %s)\n' "$RUNID"
          started=1
        else
          printf '\nframe trace: START FAILED -- nothing will be captured\n' >&2
          printf 'START-FAILED\n' > "$OUTDIR/frame-trace.state"
          return 0
        fi
        break
      fi
      sleep 0.25; waited_ms=$((waited_ms + 250))
    done
    if [ "$started" != 1 ]; then
      printf '\nframe trace: the schedule never started; nothing was traced\n' >&2
      printf 'NO-NIGHT\n' > "$OUTDIR/frame-trace.state"
      return 0
    fi

    # The trace lives in the Companion's projection. `restartAfterAbort` in
    # modern-campaign-ports.js calls `restartCompanionCapture`, whose contract
    # is "stop any current helper projection" -- which drops the in-flight
    # buffer. On 2026-09-12 (night5-strokes1) that path ran after a 120 s
    # terminal-wait abort and the whole trace was lost: start reported OK, stop
    # reported "did not stop", status read OFF, and no file was ever written.
    # So the trace must be pulled the moment the NIGHT ends, never when the
    # campaign PROCESS ends. gameover/sixam lead the restart by minutes; the
    # abort event itself still leads the capture restart by a game relaunch and
    # a title wait, so it is a usable last resort.
    #
    # A terminal label counts only AFTER a `state=night` observation. On
    # 2026-09-13 the Custom Night dial screen (every dial at 20) read as
    # `state=gameover` to the lifecycle observer, and this loop pulled the
    # trace on it 6-8 s before the night began on seven of twelve Night 7
    # runs (i5, i6, j4-j8): every one of those traces ends in the black intro
    # with no NIGHT frame, and the helper spent the night on its slow
    # detector path (about 8 fps, 400 ms old reads) because the trace was
    # already stopped. screenstate.py now refuses that screen too; this
    # ordering rule is the instrument's own guard against the next lookalike.
    waited=0
    while [ "$waited" -lt 1200 ]; do
      if awk '
            /"type":"observation","label":"state=night"/ { seen = 1 }
            seen && /"label":"state=(gameover|sixam)"/ { found = 1; exit }
            /"type":"campaign\.abort\.restart"/ { found = 1; exit }
            /"type":"campaign\.attempt\.(complete|failed)"/ { found = 1; exit }
            END { exit found ? 0 : 1 }
          ' "$OUTDIR/campaign.log" 2>/dev/null; then
        pull_frame_trace "the night ended"
        return 0
      fi
      sleep 1; waited=$((waited + 1))
    done
    pull_frame_trace "the trace hit its own 1200 s cap" ) &
  FRAME_TRACE_PID=$!
  FRAME_TRACE_STARTED=1
}

# Pulls once and records what actually landed. Never pipes the stop into a
# pager: mistake-register "gates are verified by exit status" applies to any
# command whose exit code is the answer, and `| tail` returns tail's 0.
pull_frame_trace() {
  local why="$1" out="${FRAME_TRACE_OUT:-captures/frame-traces}" state before after
  state="$(cat "$OUTDIR/frame-trace.state" 2>/dev/null || echo PENDING)"
  case "$state" in PULLED|START-FAILED|NO-NIGHT|LOST) return 0 ;; esac
  printf 'PULLING\n' > "$OUTDIR/frame-trace.state"
  mkdir -p "$out"
  before="$(ls -1 "$out" 2>/dev/null | wc -l)"
  say "pulling the native frame trace ($why)"
  if FRAME_TRACE_OUT="$out" packages/play/bin/companion/query-companion.sh trace stop; then
    after="$(ls -1 "$out" 2>/dev/null | wc -l)"
    if [ "$after" -gt "$before" ]; then
      printf 'PULLED\n' > "$OUTDIR/frame-trace.state"
      ls -1t "$out" | head -1 | tee "$OUTDIR/frame-trace.file"
      return 0
    fi
  fi
  printf 'LOST\n' > "$OUTDIR/frame-trace.state"
  printf 'night-run: FRAME TRACE LOST -- stop did not yield a file (%s)\n' "$why" >&2
  packages/play/bin/companion/query-companion.sh trace status 2>&1 | tail -1 >&2 || true
}

stop_frame_trace() {
  [ "$FRAME_TRACE_STARTED" = 1 ] || return 0
  FRAME_TRACE_STARTED=0
  [ -n "$FRAME_TRACE_PID" ] && kill "$FRAME_TRACE_PID" 2>/dev/null
  pull_frame_trace "the campaign process exited"
  printf 'frame trace  %s%s\n' "$(cat "$OUTDIR/frame-trace.state" 2>/dev/null || echo UNKNOWN)" \
    "$([ -s "$OUTDIR/frame-trace.file" ] && printf ' (%s)' "$(cat "$OUTDIR/frame-trace.file")")"
}

# The camera static re-rolls its blend coefficient from the game's Random(50) every 100 ms (Office g58), so the
# static's opacity over the camera picture reads the random stream out (docs/evidence/full06-static-readout-*).
# OPT-IN with --frame-trace: a measurement run. native-regions.ts records the model's static_view rectangle on every
# copied frame, starting where the frame trace starts (evidence.started), into captures/static-readouts/, which is
# never packed: the rows carry raw native pixels (publishing boundary). It never touches the executor's reads (the
# FNaF 2 executor reads no REGION).
STATIC_READOUT_PID=""
start_static_readout() {
  [ "$STATIC_READOUT" = 1 ] || return 0
  mkdir -p captures/static-readouts
  printf 'PENDING\n' > "$OUTDIR/static-readout.state"
  ( waited_ms=0
    while [ "$waited_ms" -lt 240000 ]; do
      if grep -q '"type":"evidence.started"' "$OUTDIR/campaign.log" 2>/dev/null; then
        printf 'RECORDING\n' > "$OUTDIR/static-readout.state"
        if FNAF_LEASE_HELD=1 FNAF_SERIAL="$SERIAL" node packages/play/bin/phone/native-regions.ts record --model "$STATIC_MODEL" --set static \
             --seconds 520 --out "captures/static-readouts/$RUNID.jsonl" >/dev/null 2>"$OUTDIR/static-readout.err"; then
          printf 'RECORDED\n' > "$OUTDIR/static-readout.state"
        else
          printf 'FAILED\n' > "$OUTDIR/static-readout.state"
        fi
        return 0
      fi
      sleep 0.25; waited_ms=$((waited_ms + 250))
    done
    printf 'NO-NIGHT\n' > "$OUTDIR/static-readout.state" ) &
  STATIC_READOUT_PID=$!
}

stop_static_readout() {
  [ -n "$STATIC_READOUT_PID" ] || return 0
  pkill -INT -P "$STATIC_READOUT_PID" 2>/dev/null || true
  kill "$STATIC_READOUT_PID" 2>/dev/null || true
  STATIC_READOUT_PID=""
  printf 'static readout  %s (captures/static-readouts/%s.jsonl)\n' "$(cat "$OUTDIR/static-readout.state" 2>/dev/null || echo UNKNOWN)" "$RUNID"
}

# Kernel input events for the whole attempt: the injection side of actuation
# latency. L = the frame where a control's effect appears (frame trace) minus
# the kernel timestamp of the HID report that caused it. getevent is streamed
# to the host with no device argument, so it also reports the "FNAF Timed
# Touch" device the campaign creates after this starts. Which clock its
# timestamps use is NOT assumed: the device's /proc/uptime and the helper's
# monotonic/boottime pair in the frame trace header let the reader decide,
# because the two clocks differ by the phone's suspended time. Only runs with
# a frame trace capture it -- without the effect side it measures nothing.
start_input_trace() {
  [ "$INPUT_TRACE" = 1 ] && [ "$FRAME_TRACE" = 1 ] || return 0
  printf '# getevent -lt on %s, started host %s, device uptime %s\n' "$SERIAL" \
    "$(date +%s.%N)" "$(adb -s "$SERIAL" shell cat /proc/uptime 2>/dev/null | tr -d '\r')" \
    > "$OUTDIR/input-events.txt"
  adb -s "$SERIAL" shell getevent -lt >> "$OUTDIR/input-events.txt" 2>&1 &
  INPUT_TRACE_PID=$!
  printf 'input    %s/input-events.txt\n' "$OUTDIR"
}

stop_input_trace() {
  [ -n "$INPUT_TRACE_PID" ] || return 0
  kill "$INPUT_TRACE_PID" 2>/dev/null || true
  wait "$INPUT_TRACE_PID" 2>/dev/null || true
  INPUT_TRACE_PID=""
  # A killed adb client can leave the remote reader running.
  adb -s "$SERIAL" shell 'pkill -x getevent' >/dev/null 2>&1 || true
  printf '# stopped host %s, device uptime %s\n' "$(date +%s.%N)" \
    "$(adb -s "$SERIAL" shell cat /proc/uptime 2>/dev/null | tr -d '\r')" >> "$OUTDIR/input-events.txt"
  printf 'input    %s lines retained\n' "$(grep -c '' "$OUTDIR/input-events.txt" 2>/dev/null || echo 0)"
}

# GNU stat prints a size with -c, BSD stat (macOS) with -f; the run summary
# must not lose the size line on either host.
file_bytes() { stat -c %s "$1" 2>/dev/null || stat -f %z "$1"; }

stop_bt_audio() {
  [ "$BT_AUDIO" = 1 ] && [ -n "$BT_AUDIO_BASE" ] || return 0
  local wav
  if wav="$("$HERE/../audio/capture-bt-audio.sh" --stop "$BT_AUDIO_BASE" 2>>"$OUTDIR/bt-audio.err")"; then
    cp "$BT_AUDIO_BASE.bt.json" "$OUTDIR/bt-audio.json"
    printf 'bt-audio %s (%s bytes raw)\n' "$wav" "$(file_bytes "$BT_AUDIO_BASE.bt.raw")"
  else
    printf 'bt-audio NONE RETAINED (%s)\n' "$(tail -1 "$OUTDIR/bt-audio.err")" >&2
  fi
  BT_AUDIO_BASE=""
}

stop_recording() {
  stop_bt_audio
  [ "$VIDEO" = 1 ] || return 0
  [ -n "$REC_PID" ] || return 0
  say "stopping recording"
  adb -s "$SERIAL" shell 'pkill -INT screenrecord' >/dev/null 2>&1 || true
  wait "$REC_PID" 2>/dev/null || true
  REC_PID=""
  # screenrecord needs a moment to finalize the container after SIGINT.
  local waited=0
  while [ "$waited" -lt 10 ]; do
    sleep 1; waited=$((waited + 1))
    adb -s "$SERIAL" shell "pgrep screenrecord" >/dev/null 2>&1 || break
  done
  sleep 2
  if adb -s "$SERIAL" shell "test -s '$DEVICE_VIDEO'" 2>/dev/null; then
    adb -s "$SERIAL" pull "$DEVICE_VIDEO" "$HOST_VIDEO" >/dev/null 2>&1 \
      && adb -s "$SERIAL" shell "rm -f '$DEVICE_VIDEO'" >/dev/null 2>&1 || true
  fi
  if [ -s "$HOST_VIDEO" ]; then
    printf 'video    %s (%s bytes)\n' "$HOST_VIDEO" "$(file_bytes "$HOST_VIDEO")"
    sha256sum "$HOST_VIDEO" | tee "$OUTDIR/video.sha256"
  else
    printf 'video    NONE RETAINED\n' >&2
  fi
}

# Mistake-register 6: every aborted attempt leaves the game mid-night. The
# reset is unconditional and its result is OBSERVED, never assumed.
reset_device() {
  [ "$RESET_DONE" = 0 ] || return 0
  RESET_DONE=1
  say "returning the phone to an observed title"
  adb -s "$SERIAL" shell am force-stop com.scottgames.fnaf2 >/dev/null 2>&1 || true
  sleep 2
  adb -s "$SERIAL" shell monkey -p com.scottgames.fnaf2 -c android.intent.category.LAUNCHER 1 \
    >/dev/null 2>&1 || true
  local tries=0 state=""
  while [ "$tries" -lt 20 ]; do
    sleep 2; tries=$((tries + 1))
    state="$(adb -s "$SERIAL" exec-out screencap -p \
      | TITLE_MODEL="$TITLE_MODEL_PATH" python3 packages/play/src/sensors/screencap/title-observe.py 2>/dev/null || true)"
    case "$state" in items=*) break ;; esac
  done
  printf 'title    %s\n' "${state:-unknown=no-read}" | tee "$OUTDIR/post-run-title.txt"
  case "$state" in
    items=*) ;;
    *) printf 'night-run: WARNING the phone did not return to an observed title\n' >&2 ;;
  esac
}

# The full post-run pipeline. It runs from the EXIT trap, so it runs on a pass,
# on a campaign failure, and on an operator Ctrl-C alike -- Pedro's standing
# requirement is that no attempt depends on anyone remembering to invoke it.
# Every stage is independently guarded: a stage with no input says so and the
# rest still run.
analyze() {
  [ "$ANALYZED" = 0 ] || return 0
  ANALYZED=1

  # This run's own campaign directories, read from the `evidence.started` rows
  # the campaign wrote to THIS run's log -- never the newest artifacts/campaign-*.
  # night5-strokes4 (2026-09-12) was refused at preflight (manifest engine
  # source hash mismatch), produced no campaign, and `ls -dt | head -1` handed
  # it strokes3's directory: its verdict.txt and run-report.json were another
  # run's facts, 16 gates and 2 corrections for a night that never ran. The
  # same night, night5-contact200a's campaign restarted after an abort and
  # produced TWO directories; `head -1` of an mtime sort picked the second
  # (19 gates, 3 corrected) and the run's own 37-gate, 372.5 s first attempt
  # appeared nowhere in its verdict. So every attempt is reported, in order,
  # and the first one is the directory grade-run.sh's modern steps read.
  ATTEMPT_DIRS=()
  while IFS= read -r dir; do
    [ -n "$dir" ] && [ -d "$dir" ] && ATTEMPT_DIRS+=("$dir")
  done < <(grep -o '"type":"evidence.started","evidenceDirectory":"[^"]*"' "$OUTDIR/campaign.log" 2>/dev/null \
    | sed 's/.*"evidenceDirectory":"//; s/"$//' || true)
  CAMPAIGN_DIR="${ATTEMPT_DIRS[0]:-}"
  # grade-run.sh resolves the bundle by this pointer, so its modern steps run
  # without anyone passing a path.
  [ -n "$CAMPAIGN_DIR" ] && printf '%s\n' "$CAMPAIGN_DIR" > "captures/$RUNID-campaign-dir.txt"
  export GRADE_CAMPAIGN_DIR="$CAMPAIGN_DIR" GRADE_NIGHT="$NIGHT"
  {
    printf 'run          %s\n' "$RUNID"
    printf 'bundle       %s\n' "$BUNDLE"
    printf 'campaign dir %s\n' "${CAMPAIGN_DIR:-NONE}"
    [ "${#ATTEMPT_DIRS[@]}" -gt 1 ] && printf 'attempts     %s (each reported below)\n' "${#ATTEMPT_DIRS[@]}"
    printf 'campaign exit %s\n' "${CAMPAIGN_CODE:-KILLED}"
  } | tee "$OUTDIR/verdict.txt"

  if [ "${#ATTEMPT_DIRS[@]}" -gt 0 ]; then
    attempt=0
    for dir in "${ATTEMPT_DIRS[@]}"; do
      attempt=$((attempt + 1))
      suffix=""
      [ "$attempt" -gt 1 ] && suffix="-attempt$attempt"
      say "modern campaign bundle (attempt $attempt of ${#ATTEMPT_DIRS[@]}: $dir)"
      printf -- '--- attempt %s of %s: %s ---\n' "$attempt" "${#ATTEMPT_DIRS[@]}" "$dir" | tee -a "$OUTDIR/verdict.txt"
      node packages/review/bin/grade/run-report.ts --run "$dir" 2>&1 \
        | tee -a "$OUTDIR/verdict.txt" || true
      node packages/review/bin/grade/run-report.ts --run "$dir" --json \
        > "$OUTDIR/run-report$suffix.json" 2>/dev/null || true

      say "delivered phase against the model band (attempt $attempt)"
      node packages/propose/bin/report/phase-reconstruct.mjs --run "$dir" --night "$NIGHT" \
        --out "$OUTDIR/phase$suffix.json" 2>&1 | tee "$OUTDIR/phase$suffix.log" || true
    done
  else
    printf 'night-run: no campaign directory was produced; executor facts UNKNOWN\n' >&2
  fi

  # Every video instrument this repository owns, through its own aggregator.
  # grade-run.sh resolves captures/<RUN>.mp4 by name, which is why the harness
  # names the recording after the run id.
  if [ -s "$HOST_VIDEO" ] && [ "$GRADE" = 0 ]; then
    say "video instruments skipped (--no-grade); grade later with packages/review/bin/grade/grade-run.sh $RUNID"
  elif [ -s "$HOST_VIDEO" ]; then
    say "video instruments (grade-run.sh)"
    # Streamed, not buffered. Reading a finished log is how a still-decoding
    # pipeline gets mistaken for a stopped one; grade-run.sh now prints a
    # [k/N pct%] line per step and a heartbeat while a step runs, and that is
    # only useful if it arrives while it happens.
    # Headroom for the OS, as enforced numbers rather than a hope (Pedro,
    # 2026-09-12: "never exhaust the machine"). This host has 12 cores and
    # 7.8 GB, so memory is the real ceiling:
    #   - the whole grading tree runs in a user scope inside a shared slice
    #     with a kernel-enforced MemoryMax, so an instrument that runs away is
    #     throttled or killed inside the slice, never the desktop or a live night;
    #   - it is pinned to cores 2-9 with taskset, leaving 0-1 and 10-11 free.
    #     A user scope cannot pin CPUs here: only cpu/memory/pids are
    #     delegated, so `-p AllowedCPUs=` is ACCEPTED AND SILENTLY IGNORED
    #     (verified: the process still reported cpus=0-11). taskset is the
    #     placement; the cgroup is the memory and CPU-time ceiling.
    #   - GRADE_CPUSET must be passed: grade-run.sh re-pins every step to its
    #     own default of core 0, which would override the outer taskset and
    #     land every decoder on a reserved core.
    # Without systemd-run the same placement and niceness still apply.
    GRADE_ENV=(env GRADE_CPUSET="${GRADE_CPUSET:-2-9}")
    # grade-run.sh's rule: pin where taskset exists; macOS has none.
    GRADE_WRAP=(nice -n 10)
    command -v taskset >/dev/null 2>&1 && GRADE_WRAP+=(taskset -c "${GRADE_CPUSET:-2-9}")
    # ONE ceiling for all grading, not one per run. With the phone released
    # before the analysis, gradings overlap by design (and other sessions
    # regrade in parallel), so a per-run MemoryMax would multiply: two live
    # 3G scopes can exceed this 7.8 GB host. Every grading scope therefore
    # joins fnaf2-grade.slice, and the SLICE carries the limit, so the kernel
    # enforces it across everything placed there however many overlap.
    # Verified: set-property --runtime works on a slice before it exists, the
    # limit lands on the slice, and concurrent scopes share it.
    GRADE_SLICE="${GRADE_SLICE:-fnaf2-grade.slice}"
    if command -v systemd-run >/dev/null 2>&1 &&
       systemctl --user set-property --runtime "$GRADE_SLICE" \
         MemoryMax="${GRADE_SLICE_MEMORY_MAX:-3G}" MemoryHigh="${GRADE_SLICE_MEMORY_HIGH:-2500M}" \
         CPUQuota="${GRADE_SLICE_CPU_QUOTA:-800%}" >/dev/null 2>&1 &&
       systemd-run --user --scope -q --slice="$GRADE_SLICE" true >/dev/null 2>&1; then
      GRADE_WRAP=(systemd-run --user --scope -q --slice="$GRADE_SLICE" "${GRADE_WRAP[@]}")
    fi
    "${GRADE_ENV[@]}" "${GRADE_WRAP[@]}" packages/review/bin/grade/grade-run.sh "$RUNID" 2>&1 | tee "$OUTDIR/grade.log" || true
    grep -E "^(outcome|terminal|survival|  clear|  death)" "$OUTDIR/grade.log" \
      >> "$OUTDIR/verdict.txt" 2>/dev/null || true
  else
    printf 'night-run: no retained video; every video instrument was skipped\n' >&2
    printf 'video        NONE RETAINED\n' >> "$OUTDIR/verdict.txt"
  fi

  # Custody that outlives artifacts/: the campaign's text evidence and this run's
  # derived facts go to docs/evidence/runs/, and every recording and frame is
  # named there by sha256 only (packages/review/src/evidence-pack.ts). The Plan 12 gate reads
  # that directory on any checkout; commit it. Its log goes to captures/, not to
  # $OUTDIR, because a file written into the run directory while it is packed
  # would change the pack. A later regrade that adds files needs --replace.
  if [ "${#ATTEMPT_DIRS[@]}" -gt 0 ]; then
    say "evidence pack"
    node apps/desktop/src/evidence.ts pack "$RUNID" 2>&1 | tee "captures/$RUNID-pack.log" || true
  fi

  say "verdict"
  cat "$OUTDIR/verdict.txt"
}

on_exit() {
  local code=$?
  # An outer lease wrapper can relay a second interrupt while this EXIT
  # handler is already resetting the phone. Do not interrupt the bounded
  # physical cleanup; restore normal signal handling before host analysis.
  trap '' INT TERM HUP
  set +e
  stop_frame_trace
  stop_static_readout
  stop_input_trace
  stop_recording
  # The phone is released BEFORE the analysis, not after it. Nothing in
  # analyze() talks to the device: it reads the pulled video, the pulled frame
  # trace and the host-side campaign bundle. With the old order the phone sat
  # idle for the whole 12-39 min pipeline and the next attempt could not start
  # until the grading of this one had finished.
  reset_device
  trap - INT TERM HUP
  say "phone released -- the next attempt may start; analysis continues host-side"
  analyze
  say "run $RUNID finished with exit code $code"
  printf 'artifacts    %s\n' "$OUTDIR"
  exit "$code"
}
trap on_exit EXIT

# ---- the attempt -----------------------------------------------------------
if [ "$NIGHT" = 7 ] && [ -z "$CALIBRATION" ]; then
  CALIBRATION="packages/play/profiles/fnaf2/moto-g56/custom-night-calibration-v1.json"
fi
[ -z "$CALIBRATION" ] || [ -f "$CALIBRATION" ] || die "calibration file not found: $CALIBRATION"
CAMPAIGN=(node apps/desktop/src/device-cli.ts campaign
  --profile "$PROFILE" --serial "${SERIAL:-UNKNOWN}" --nights "$NIGHT" --max-attempts 1
  --bundle "$BUNDLE" --qualification "$QUALIFICATION" --json)
# The save cursor is a STORY observation (campaign.js: storySaveCursor must
# equal the first story night of the chain); the Custom Night has none.
[ "$NIGHT" = 7 ] || CAMPAIGN+=(--save-cursor "$SAVE_CURSOR")
[ -z "$CALIBRATION" ] || CAMPAIGN+=(--calibration "$CALIBRATION")
# Place the schedule release at the helper's latched night onset + an epoch
# (mod one game second) instead of wherever the ~1 Hz office classifier fires.
# The aim is NOT a literal here: it is registered per binding in
# packages/propose/bindings/fact-register.mjs (ANCHOR_AIMS) next to the evidence that
# derived it, and looked up by the bundle's own winner hash, so a rebinding
# cannot inherit a number priced for another policy. No entry, or an entry
# whose evidence fails its checks, means no anchor: the release happens the
# old way and the reason is printed. NIGHT_ANCHOR_AIM_MS=off forces that;
# NIGHT_ANCHOR_AIM_MS=<ms> overrides the register (say why in the label).
# The aim is confirmed only at whole seconds 0..maxK past the onset -- on
# binding fnv1a-81b5e51c epoch 3233 scores 2673/3000 and night5-anchor1
# delivered exactly that k -- so the register's maxK travels with the aim and
# the executor refuses a later k. NIGHT_ANCHOR_MAX_K=<k> overrides it; with no
# bound at all the anchor is OFF. Every anchor refusal at run time also
# releases at once.
BUNDLE_WINNER_HASH="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).winnerHash ?? ""))' "$BUNDLE/manifest.json" 2>/dev/null || true)"
# A death-targeting bundle (gate DEATH_TARGETED, packages/propose/bin/plans/death-prediction.mjs)
# exists to test a model prediction of a death. The prediction is retained
# beside the run BEFORE the campaign starts, so the read-out cannot be fitted
# to the outcome, and it is printed so the operator knows what the run claims.
if node -e '
const m = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (!m.gate?.prediction) process.exit(1);
require("fs").writeFileSync(process.argv[2], JSON.stringify(m.gate.prediction, null, 2) + "\n");
const p = m.gate.prediction;
console.log(`predict  ${m.gate.status === "DEATH_TARGETED" ? "DEATH-TARGETING run" : "prediction on record (gate " + m.gate.status + ")"}: model wins ${p.wins}/${p.replays} over ${p.phasesMs.length} phases`);
for (const k of p.killers) console.log(`predict  ${k.killer} ${(100 * k.share).toFixed(0)}%  t p10 ${k.tSeconds.p10.toFixed(0)} p50 ${k.tSeconds.p50.toFixed(0)} p90 ${k.tSeconds.p90.toFixed(0)} s`);
' "$BUNDLE/manifest.json" "$OUTDIR/prediction.json" 2>/dev/null; then
  printf 'predict  retained %s/prediction.json\n' "$OUTDIR"
fi
if [ -z "${NIGHT_ANCHOR_AIM_MS:-}" ]; then
  if aim="$(node packages/propose/bindings/fact-register.mjs --anchor-aim "$BUNDLE_WINNER_HASH" 2>"$OUTDIR/anchor-aim.err")"; then
    NIGHT_ANCHOR_AIM_MS="$aim"
    printf 'anchor   aim %s ms from the fact register for binding %s\n' "$aim" "$BUNDLE_WINNER_HASH"
  else
    NIGHT_ANCHOR_AIM_MS=off
    printf 'anchor   OFF -- %s\n' "$(cat "$OUTDIR/anchor-aim.err")"
  fi
fi
# An EXPLICIT aim must never be silently downgraded to off. The lookups below
# exist for the register path; when an operator states an aim, a missing maxK or
# period is a usage error and has to say so. On 2026-09-20 two Night 6 runs were
# launched with NIGHT_ANCHOR_AIM_MS set, both released unanchored because the
# period lookup failed on an unregistered binding, and the single "anchor OFF"
# line was read as a register note rather than as the override being discarded --
# so a 255 ms change in the request moved the delivered epoch by 10 ms and was
# briefly written up as a hardware limit.
ANCHOR_AIM_EXPLICIT=0
[ -n "${NIGHT_ANCHOR_AIM_MS:-}" ] && [ "${NIGHT_ANCHOR_AIM_MS:-}" != off ] && ANCHOR_AIM_EXPLICIT=1
if [ "$NIGHT_ANCHOR_AIM_MS" != off ] && [ -z "${NIGHT_ANCHOR_MAX_K:-}" ]; then
  if max_k="$(node packages/propose/bindings/fact-register.mjs --anchor-max-k "$BUNDLE_WINNER_HASH" 2>"$OUTDIR/anchor-max-k.err")"; then
    NIGHT_ANCHOR_MAX_K="$max_k"
  elif [ "$ANCHOR_AIM_EXPLICIT" = 1 ]; then
    die "NIGHT_ANCHOR_AIM_MS=$NIGHT_ANCHOR_AIM_MS was given but no maxK is registered for $BUNDLE_WINNER_HASH; state NIGHT_ANCHOR_MAX_K too rather than releasing unanchored"
  else
    NIGHT_ANCHOR_AIM_MS=off
    printf 'anchor   OFF -- %s\n' "$(cat "$OUTDIR/anchor-max-k.err")"
  fi
fi
# The aim is a phase of ONE game timer, and the timer differs by night: Night
# 5's bands are on the one-second grid, Night 6's on the five-second Foxy roll
# (g337). The period is registered beside the aim; an override must state it
# (NIGHT_ANCHOR_PERIOD_MS=<ms>).
if [ "$NIGHT_ANCHOR_AIM_MS" != off ] && [ -z "${NIGHT_ANCHOR_PERIOD_MS:-}" ]; then
  if period="$(node packages/propose/bindings/fact-register.mjs --anchor-period-ms "$BUNDLE_WINNER_HASH" 2>"$OUTDIR/anchor-period.err")"; then
    NIGHT_ANCHOR_PERIOD_MS="$period"
  elif [ "$ANCHOR_AIM_EXPLICIT" = 1 ]; then
    die "NIGHT_ANCHOR_AIM_MS=$NIGHT_ANCHOR_AIM_MS was given but no period is registered for $BUNDLE_WINNER_HASH; state NIGHT_ANCHOR_PERIOD_MS too (Night 5 is 1000, Night 6/7 the 5000 ms Foxy roll) rather than releasing unanchored"
  else
    NIGHT_ANCHOR_AIM_MS=off
    printf 'anchor   OFF -- %s\n' "$(cat "$OUTDIR/anchor-period.err")"
  fi
fi
# A bundle whose gate was scored at an anchor epoch (manifest.anchorEpochMs,
# packages/propose/bin/plans/bundle.mjs) holds only there: released unanchored it runs a phase
# no census has seen, on Night 6 one the model loses to Foxy. Refuse, do not
# "release the old way".
BUNDLE_ANCHOR_EPOCH_MS="$(node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).anchorEpochMs; process.stdout.write(v === undefined ? "" : String(v))' "$BUNDLE/manifest.json" 2>/dev/null || true)"
if [ -n "$BUNDLE_ANCHOR_EPOCH_MS" ] && [ "$NIGHT_ANCHOR_AIM_MS" = off ]; then
  die "bundle $BUNDLE_WINNER_HASH is qualified at anchor epoch $BUNDLE_ANCHOR_EPOCH_MS ms but no anchor is available; refusing to release it at a drawn phase"
fi
if [ "$NIGHT_ANCHOR_AIM_MS" != off ]; then
  CAMPAIGN+=(--night-anchor-aim-ms "$NIGHT_ANCHOR_AIM_MS" --night-anchor-max-k "$NIGHT_ANCHOR_MAX_K" --night-anchor-period-ms "$NIGHT_ANCHOR_PERIOD_MS")
  # An anchor-qualified bundle must never run at a drawn phase: strict.
  [ -z "$BUNDLE_ANCHOR_EPOCH_MS" ] || CAMPAIGN+=(--night-anchor-strict --night-anchor-authorize-on-latch)
  printf 'anchor   release at night onset + %s ms + k x %s ms, k <= %s\n' "$NIGHT_ANCHOR_AIM_MS" "$NIGHT_ANCHOR_PERIOD_MS" "$NIGHT_ANCHOR_MAX_K"
fi
# Pedro's standing direction: the arm check does not block the schedule.
#
# It is not a preference, it is the difference between a winnable night and an
# unwinnable one. In `blocking` mode the executor parks the HID stream at the
# end of the opening prefix, waits ARM_SETTLE_MS (600) plus at least one more
# 250 ms poll for a second agreeing read, and then delivers EVERY later press
# that much late -- `phaseLagMs` in adb-device-local-executor.js. The two
# retained 2026-09-11 runs measured 1320 ms and 6695 ms of it.
#
# observe-once starts the schedule first and observes alongside it, so it adds
# no suffix shift at all. That is worth having, but it is NOT by itself a phase
# fix, and nothing here should be read as one: the model's response to
# delivered phase is banded over each 1000 ms game second -- night 5 loses on
# [116.67,166.67), [316.67,366.67), [416.67,800) and [916.67,966.67) -- and the
# night origin is bracketed wider than that whole period (1852 ms on the
# 2026-09-12 run). Until the origin is pinned the delivered phase is
# effectively uniform, which is the model's own 1375/3000 uncontrolled-phase
# result. Read phase-reconstruct.mjs, never a single tolerance number.
[ "$ARM_MODE" = "observe-once" ] && CAMPAIGN+=(--arm-observe-once)
# --arm-none must be forwarded too: the CLI defaults armMode to blocking, and
# blocking is refused for plans with no #arm-verify (the minus7 catalog).
[ "$ARM_MODE" = "none" ] && CAMPAIGN+=(--arm-none)
# Night 7 dial vector (JSON). The Custom Night menu opens with the 4/20 preset
# by default; passing the vector here only fixes the readback expectation.
[ -n "${DIALS:-}" ] && CAMPAIGN+=(--night7-dials "$DIALS")
[ "$TEACH" = 1 ] && CAMPAIGN+=(--teach-overlay)
if [ "$DRY" = 1 ]; then
  printf 'DRY RUN, the phone is not actuated (add --live --confirm-live for a live night):\n  %s\n' "${CAMPAIGN[*]} ${EXTRA[*]:-}"
  [ "$STATIC_READOUT" = 1 ] && printf 'static readout (from evidence.started): FNAF_LEASE_HELD=1 node packages/play/bin/phone/native-regions.ts record --model %s --set static --seconds 520 --out captures/static-readouts/%s.jsonl\n' "$STATIC_MODEL" "$RUNID"
  # Nothing was started on the phone, so nothing is stopped or reset either.
  # The EXIT trap force-stops the game, relaunches it and screencaps its title;
  # until 2026-09-27 a dry run still ran it and put FNaF 2 in front of an app
  # the phone's owner was using (test-night-run-dry.ts).
  trap - EXIT
  exit 0
fi
CAMPAIGN+=(--live --confirm-live)
[ "${#EXTRA[@]}" -eq 0 ] || CAMPAIGN+=("${EXTRA[@]}")

if [ "$VIDEO" = 1 ]; then
  say "starting retained recording"
  adb -s "$SERIAL" shell "rm -f '$DEVICE_VIDEO'" >/dev/null 2>&1 || true
  adb -s "$SERIAL" shell "screenrecord --size 1280x576 --bit-rate 12000000 --time-limit 0 '$DEVICE_VIDEO'" &
  REC_PID=$!
  sleep 2
  adb -s "$SERIAL" shell "pgrep screenrecord" >/dev/null 2>&1 \
    || die "screenrecord did not start"
fi
# The audible mix over Bluetooth A2DP (docs/device/AUDIO-WITNESS-MAP.md): the
# only path that carries the FAST-mixer cues -- the vent bang and the footsteps
# that fire on the game's five-second grid. Game audio never lives inside the
# repository; the capture goes beside the other Bluetooth captures and the run
# directory keeps its sidecar (host-clock stamps) and a pointer.
if [ "$BT_AUDIO" = 1 ]; then
  BT_AUDIO_BASE="$HOME/fnaf-apks/bt-audio-captures/$RUNID"
  mkdir -p "$(dirname "$BT_AUDIO_BASE")"
  # The link is not assumed up: after a host reboot the bond survives and the
  # transport does not. bt-audio-link.sh connects the A2DP profile from this
  # side, or taps the paired host in the phone's Bluetooth settings, and exits
  # 0 only on capture-bt-audio.sh --check READY. Runs before any game input.
  if ! "$HERE/../audio/bt-audio-link.sh" --ensure >"$OUTDIR/bt-audio-link.txt" 2>&1; then
    die "bt-audio link not READY: $(tail -1 "$OUTDIR/bt-audio-link.txt")"
  fi
  printf 'bt-audio link %s\n' "$(tail -1 "$OUTDIR/bt-audio-link.txt")"
  # The mix is the whole phone's: another app's started player masks the game
  # (FNaF 4 n5c, 2026-09-27: a background app's title music, a deaf night).
  if ! node "$HERE/../companion/audio-players.ts" --serial "$SERIAL" --target com.scottgames.fnaf2 >"$OUTDIR/audio-players.json" 2>&1; then
    die "audio preflight refused: $(cat "$OUTDIR/audio-players.json")"
  fi
  if bt_pid="$("$HERE/../audio/capture-bt-audio.sh" --start "$BT_AUDIO_BASE" 2>"$OUTDIR/bt-audio.err")"; then
    printf 'bt-audio capturing (pid %s) -> %s.bt.raw\n' "$bt_pid" "$BT_AUDIO_BASE"
  else
    die "bt-audio capture refused: $(cat "$OUTDIR/bt-audio.err")"
  fi
fi

# Perfetto input dispatch, bracketing the campaign.
#
# This is the one instrument that can say whether the GAME received a press or
# whether it never arrived -- `inputtrace.py` reports app MotionEvents, contact
# lengths and latched contacts. grade-run.sh has always had the slot and has
# always printed "input trace: none" because nothing captured one.
#
# It answers the standing question about the ~13% of cycles whose mask press is
# lost: the loop presses the camdrop's monitor at +14000, the sourced
# monitor-down animation is 367 ms, and the mask press follows at +14400 -- a
# 33 ms margin. If the app received that MotionEvent and the mask did not
# toggle, the game refused it inside the animation; if the event never arrived,
# the cause is below the game and the seam is innocent.
#
# atrace-input.sh runs the command only once Perfetto reports its data sources
# started, so a trace that cannot start fails the attempt instead of quietly
# producing an untraced run.
say "campaign"
CAMPAIGN_CMD=("${CAMPAIGN[@]}")
if [ "$TRACE" = 1 ]; then
  printf 'trace    %s-input.pftrace (%ss)\n' "$RUNID" "$TRACE_SECONDS"
  CAMPAIGN_CMD=("$TRACE_TOOL" "$RUNID" "$TRACE_SECONDS" -- "${CAMPAIGN[@]}")
fi
start_frame_trace
start_static_readout
start_input_trace
set +e
"${CAMPAIGN_CMD[@]}" 2>&1 | tee "$OUTDIR/campaign.log"
CAMPAIGN_CODE=${PIPESTATUS[0]}
set -e
printf 'campaign exit %s\n' "$CAMPAIGN_CODE" | tee "$OUTDIR/campaign.exit"

exit "$CAMPAIGN_CODE"
