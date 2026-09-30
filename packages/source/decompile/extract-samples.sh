#!/usr/bin/env bash
# Extract reference sound samples from the Android APK by Fusion sample handle.
#
#   packages/source/decompile/extract-samples.sh /path/to/base.apk [outdir] [handle ...]
#
# The samples are game content. Like the CCN and the event dump they live
# OUTSIDE the repository, and this script refuses to write anywhere inside it.
# Commit the fingerprint report from tools/cue/reference-report.py instead.
#
# Handles are the same numbers the event sheet plays: `readdump.py sounds 3`
# lists them, and res/raw/sNNNN.* in the APK is indexed by handle.
set -euo pipefail

APK=${1:?usage: extract-samples.sh <base.apk> [outdir] [handle ...]}
OUT=${2:-/private/tmp/fnaf2-cue-refs}
shift || true
shift || true
# Default set: plan 08's cue vocabulary -- BB's in-office taunt, the shared
# movement thud, his three vocals, and the footstep bank.
HANDLES=("$@")
[ ${#HANDLES[@]} -gt 0 ] || HANDLES=(16 17 21 23 24 25 26 27 28 29)

[ -f "$APK" ] || { echo "no APK at $APK" >&2; exit 1; }

REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
ABS_OUT="$(mkdir -p "$OUT" && cd "$OUT" && pwd)"
case "$ABS_OUT/" in
  "$REPO"/*) echo "refusing to extract game audio inside the repository: $ABS_OUT" >&2; exit 1 ;;
esac

for handle in "${HANDLES[@]}"; do
  name="$(printf 's%04d' "$handle")"
  member="$(unzip -Z1 "$APK" "res/raw/$name.*" 2>/dev/null | head -n1)"
  if [ -z "$member" ]; then
    echo "no res/raw/$name.* in $APK" >&2
    continue
  fi
  unzip -o -j -q "$APK" "$member" -d "$ABS_OUT"
  echo "$handle -> $ABS_OUT/$(basename "$member")"
done
