#!/usr/bin/env bash
# Scan one night's captured audio for Balloon Boy's vent bang.
#
#   packages/propose/parked/minus7/cue/scan-night.sh WAV [--refs DIR]
#
# Denoise first, then run the cascade. That order is measured, not assumed.
# Injecting 52 copies of sample 17 into 159.5 s of real night background and
# scanning the result:
#
#   raw                     3 of 52 confirmed   (6% recall)
#   afftdn denoised        27 of 52 confirmed  (52% recall, 27/27 true, 0 false)
#
# The capture clips -- night 6-40's live stretch had peak pinned at full-scale
# int16 on 55% of snapshots, and `evaluate.py` refuses three of the six archived
# recordings outright as "unusable: clipped". Clipping is what the band stage
# survives and the correlation stage does not, so removing it is worth more than
# any threshold change.
#
# The detectability floor, same method, denoised:
#
#   injected at   0 dB -> 27/52      -6 dB -> 17/52
#               -12 dB ->  7/52     -18 dB ->  0/52
#
# So a zero here means "no bang above about -12 dB relative to background", NOT
# "no bang". Quote it that way.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WAV="${1:?usage: scan-night.sh WAV [--refs DIR]}"
shift || true
REFS_ARG=()
case "${1:-}" in --refs) REFS_ARG=(--refs "${2:?--refs needs a directory}") ;; esac

# A step that cannot find its input must say so and fail, never print nothing
# and look like coverage. That is what silently grading a missing .mp4 did.
[ -f "$WAV" ] || { echo "scan-night: no audio at $WAV" >&2; exit 2; }

# Silence is not "no bangs". It is no observation, and reporting it as a clean
# scan is the same failure as grading a capture that does not exist.
#
# Night 6-42 recorded 71 s of a live night in which Balloon Boy was visibly on
# the Game Area camera, and every one of its 1142784 samples was exactly zero.
# The helper said `audio=OBSERVED rate=16000 frames=... rms=0 peak=0` throughout
# and its frame counter advanced normally, so nothing upstream noticed. The
# cause was the phone's audio being routed to Bluetooth: A2DP offload bypasses
# the mix AudioPlaybackCapture taps, so the session returns zero-filled buffers
# while still reporting healthy.
silence="$(python3 - "$WAV" <<'CHECK'
import sys, wave
with wave.open(sys.argv[1]) as handle:
    frames = handle.getnframes()
    raw = handle.readframes(frames)
print(("EMPTY" if frames == 0 else "SILENT" if not any(raw) else "OK"), frames)
CHECK
)" || { echo "scan-night: could not read $WAV" >&2; exit 2; }
case "$silence" in
  EMPTY*) echo "scan-night: $WAV holds no frames at all" >&2; exit 3 ;;
  SILENT*)
    echo "scan-night: ${WAV##*/} is digital silence -- all ${silence#SILENT } samples are zero." >&2
    echo "  That is a dead capture path, not a night without bangs. The usual cause is" >&2
    echo "  audio routed to Bluetooth (A2DP offload bypasses the captured mix). Disconnect" >&2
    echo "  it, confirm the helper reports a non-zero rms with the game audible, and" >&2
    echo "  re-run the night; this scan says nothing about Balloon Boy." >&2
    exit 3
    ;;
esac

DEN="$WAV"
if command -v ffmpeg >/dev/null 2>&1; then
  DEN="$(dirname "$WAV")/.$(basename "${WAV%.wav}")-denoised.wav"
  if ! ffmpeg -v error -y -i "$WAV" -af "afftdn=nf=-25,dynaudnorm=g=15" "$DEN" 2>/dev/null; then
    echo "scan-night: ffmpeg failed; scanning the raw capture at 6% recall" >&2
    DEN="$WAV"
  fi
else
  echo "scan-night: no ffmpeg; scanning the raw capture at 6% recall instead of 52%" >&2
fi

echo "bang scan (sample 17), denoised: ${DEN##*/}"
python3 "$HERE/detect.py" --scan --subtract --only 17 ${REFS_ARG[@]+"${REFS_ARG[@]}"} -- "$DEN"
status=$?
[ "$DEN" = "$WAV" ] || rm -f "$DEN"
exit "$status"
