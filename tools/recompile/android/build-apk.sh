#!/bin/bash
# build-apk.sh: package the recompiled FNaF 2 (libmain.so + libSDL2.so) and its
# Assets.dat into a debug-signed APK for Pedro's own phone. A personal research
# build, never distributed, and an explicit exception Pedro asked for
# (2026-09-27) to CLAUDE.md's "no separate APKs" rule. No Gradle: javac, d8,
# aapt2, zipalign and apksigner, as android/companion/build.sh does.
#
#   tools/recompile/android/build-apk.sh --libs DIR --sdl DIR --assets FILE --out FILE
#
# --libs holds libmain.so (the game-CMakeLists.txt build), --sdl the SDL2 source
# tree (its Java classes) and libSDL2.so's build directory via --sdl-lib, --assets
# the pinned Assets.dat. Everything is written outside the repository: the APK
# carries game art.
set -euo pipefail

LIBS= SDL= SDL_LIB= ASSETS= OUT=
while [[ $# -gt 0 ]]; do
    case "$1" in
        --libs) LIBS=$2; shift 2 ;;
        --sdl) SDL=$2; shift 2 ;;
        --sdl-lib) SDL_LIB=$2; shift 2 ;;
        --assets) ASSETS=$2; shift 2 ;;
        --out) OUT=$2; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done
for v in LIBS SDL SDL_LIB ASSETS OUT; do
    [[ -n "${!v}" ]] || { echo "missing --$(echo $v | tr A-Z_ a-z-)" >&2; exit 2; }
done
case "$(realpath -m "$OUT")" in
    "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"/*)
        echo "refusing to write the APK inside the repository: it carries game art" >&2; exit 2 ;;
esac

SDK_ROOT="${ANDROID_SDK_ROOT:-$HOME/.local/toolchains/android-sdk}"
BT="$SDK_ROOT/build-tools/${ANDROID_BUILD_TOOLS_VERSION:-36.0.0}"
ANDROID_JAR="$SDK_ROOT/platforms/android-${ANDROID_PLATFORM_VERSION:-36}/android.jar"
export JAVA_HOME="${JAVA_HOME:-$HOME/.local/toolchains/jdk21/usr/lib/jvm/java-21-openjdk-amd64}"
for tool in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner" "$ANDROID_JAR" \
            "$JAVA_HOME/bin/javac" "$JAVA_HOME/bin/keytool" \
            "$LIBS/libmain.so" "$SDL_LIB/libSDL2.so" "$ASSETS"; do
    [[ -e "$tool" ]] || { echo "missing: $tool" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/classes" "$WORK/dex" "$WORK/assets" "$WORK/apk/lib/arm64-v8a"

cat > "$WORK/AndroidManifest.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="org.fnaf2rebuild.play" android:versionCode="1" android:versionName="0.1">
    <uses-feature android:glEsVersion="0x00010001" android:required="true" />
    <application android:label="FNaF 2 Rebuild (research)" android:hasCode="true"
        android:extractNativeLibs="true" android:allowBackup="false"
        android:hardwareAccelerated="true"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
        <activity android:name="org.libsdl.app.SDLActivity" android:exported="true"
            android:screenOrientation="sensorLandscape" android:launchMode="singleInstance"
            android:configChanges="layoutDirection|locale|orientation|uiMode|screenLayout|screenSize|smallestScreenSize|keyboard|keyboardHidden|navigation"
            android:preferMinimalPostProcessing="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
EOF

# SDL's Java side (SDLActivity loads libSDL2.so and libmain.so).
"$JAVA_HOME/bin/javac" --release 11 -nowarn -cp "$ANDROID_JAR" -d "$WORK/classes" \
    "$SDL"/android-project/app/src/main/java/org/libsdl/app/*.java
"$BT/d8" --release --min-api 24 --lib "$ANDROID_JAR" --output "$WORK/dex" \
    $(find "$WORK/classes" -name '*.class')

cp "$ASSETS" "$WORK/assets/Assets.dat"
"$BT/aapt2" link -o "$WORK/base.apk" -I "$ANDROID_JAR" --manifest "$WORK/AndroidManifest.xml" \
    --min-sdk-version 24 --target-sdk-version 34 --debug-mode -A "$WORK/assets" -0 dat

cp "$LIBS/libmain.so" "$SDL_LIB/libSDL2.so" "$WORK/apk/lib/arm64-v8a/"
cp "$WORK/dex/classes.dex" "$WORK/apk/"
(cd "$WORK/apk" && zip -q -r "$WORK/base.apk" classes.dex lib)

"$BT/zipalign" -p -f 4 "$WORK/base.apk" "$WORK/aligned.apk"
KS="${REBUILD_KEYSTORE:-$(dirname "$OUT")/rebuild-debug.keystore}"
if [[ ! -f "$KS" ]]; then
    "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KS" -alias rebuild -keyalg RSA -keysize 2048 \
        -validity 10000 -storepass android -keypass android -dname "CN=FNaF 2 rebuild research" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass pass:android --key-pass pass:android --out "$OUT" "$WORK/aligned.apk"
"$BT/apksigner" verify "$OUT"
echo "$OUT $(stat -c %s "$OUT") bytes, sha256 $(sha256sum "$OUT" | cut -c1-16)"
