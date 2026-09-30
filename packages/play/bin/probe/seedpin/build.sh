#!/usr/bin/env bash
# Build the device-side seed pinner into pinner.dex and optionally push it with seedpin.sh.
#
#   packages/play/bin/probe/seedpin/build.sh [--push SERIAL]
#
# Uses the same Android SDK lookup as android/companion/build.sh. The pinner is run on the phone as
# the shell user through app_process; see seedpin.sh for what it does to the wall clock and the
# caps that bound it.
set -Eeuo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then SDK_ROOT="$ANDROID_SDK_ROOT"
elif [[ -d "${HOME}/.local/toolchains/android-sdk" ]]; then SDK_ROOT="${HOME}/.local/toolchains/android-sdk"
else SDK_ROOT="${HOME}/Library/Android/sdk"; fi
BUILD_TOOLS="${ANDROID_BUILD_TOOLS_VERSION:-36.0.0}"
PLATFORM="${ANDROID_PLATFORM_VERSION:-36}"
ANDROID_JAR="$SDK_ROOT/platforms/android-$PLATFORM/android.jar"
D8="$SDK_ROOT/build-tools/$BUILD_TOOLS/d8"
[ -e "$ANDROID_JAR" ] || { echo "seedpin build: no $ANDROID_JAR" >&2; exit 2; }
[ -x "$D8" ] || { echo "seedpin build: no $D8" >&2; exit 2; }
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
javac --release 11 -cp "$ANDROID_JAR" -d "$OUT/classes" "$HERE/Pinner.java"
"$D8" --min-api 29 --lib "$ANDROID_JAR" --output "$OUT" "$OUT"/classes/*.class
cp "$OUT/classes.dex" "$HERE/pinner.dex"
echo "built $HERE/pinner.dex ($(wc -c < "$HERE/pinner.dex") bytes)"
if [ "${1:-}" = --push ]; then
  SERIAL="${2:?--push needs a serial}"
  adb -s "$SERIAL" push "$HERE/pinner.dex" /data/local/tmp/pinner.dex >/dev/null
  adb -s "$SERIAL" push "$HERE/seedpin.sh" /data/local/tmp/seedpin.sh >/dev/null
  echo "pushed pinner.dex and seedpin.sh to $SERIAL:/data/local/tmp"
fi
