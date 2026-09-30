#!/bin/bash
# build-apk.sh: package the recompiled FNaF 2 (libmain.so + libSDL2.so) and its
# Assets.dat into a debug-signed APK for Pedro's own phone. A personal research
# build, never distributed, and an explicit exception Pedro asked for
# (2026-09-27) to CLAUDE.md's "no separate APKs" rule. No Gradle: javac, d8,
# aapt2, zipalign and apksigner, as android/companion/build.sh does.
#
#   packages/source/recompile/android/build-apk.sh --libs DIR --sdl DIR --assets FILE --out FILE \
#       [--package org.fnaf<N>rebuild.play] [--label TEXT]
#
# --libs holds libmain.so (the game-CMakeLists.txt build), --sdl the SDL2 source
# tree (its Java classes) and libSDL2.so's build directory via --sdl-lib, --assets
# the pinned Assets.dat. --package (default org.fnaf2rebuild.play) and --label
# name one game's build, so each game installs beside the others. Everything is
# written outside the repository: the APK carries game art.
#
# The activity's theme lays the window into the display cutout on the short
# edges (android:windowLayoutInDisplayCutoutMode, API 28+). Without it the g56
# kept the window out of its 115 px camera cutout (window 2285x1080 of 2400x1080
# at [115,0]), and the FULL stretch squeezed the image 4.8% and shifted it right.
set -euo pipefail

LIBS= SDL= SDL_LIB= ASSETS= OUT=
PACKAGE=org.fnaf2rebuild.play
LABEL="FNaF 2 Rebuild (research)"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --libs) LIBS=$2; shift 2 ;;
        --sdl) SDL=$2; shift 2 ;;
        --sdl-lib) SDL_LIB=$2; shift 2 ;;
        --assets) ASSETS=$2; shift 2 ;;
        --out) OUT=$2; shift 2 ;;
        --package) PACKAGE=$2; shift 2 ;;
        --label) LABEL=$2; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done
[[ "$PACKAGE" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$ ]] || { echo "bad --package: $PACKAGE" >&2; exit 2; }
case "$LABEL" in
    *'<'*|*'>'*|*'&'*|*'"'*) echo "--label may not hold < > & or a double quote" >&2; exit 2 ;;
esac
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
mkdir -p "$WORK/classes" "$WORK/dex" "$WORK/assets" "$WORK/apk/lib/arm64-v8a" \
    "$WORK/res/values" "$WORK/res/values-v28" "$WORK/flat"

# The fullscreen theme, and on API 28+ the same theme laid into the cutout.
cat > "$WORK/res/values/styles.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="RebuildTheme" parent="@android:style/Theme.NoTitleBar.Fullscreen" />
</resources>
EOF
cat > "$WORK/res/values-v28/styles.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="RebuildTheme" parent="@android:style/Theme.NoTitleBar.Fullscreen">
        <item name="android:windowLayoutInDisplayCutoutMode">shortEdges</item>
    </style>
</resources>
EOF

cat > "$WORK/AndroidManifest.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="$PACKAGE" android:versionCode="1" android:versionName="0.1">
    <uses-feature android:glEsVersion="0x00010001" android:required="true" />
    <application android:label="$LABEL" android:hasCode="true"
        android:extractNativeLibs="true" android:allowBackup="false"
        android:hardwareAccelerated="true"
        android:theme="@style/RebuildTheme">
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

# A GL ES 2.0 libmain.so (game-CMakeLists.txt's default since the GLES2
# renderer) declares ES 2.0; a -DCHOWDREN_GLES1=ON build keeps ES 1.1.
if grep -q -a 'libGLESv2\.so' "$LIBS/libmain.so"; then
    sed -i 's/android:glEsVersion="0x00010001"/android:glEsVersion="0x00020000"/' "$WORK/AndroidManifest.xml"
fi

# SDL's Java side (SDLActivity loads libSDL2.so and libmain.so).
"$JAVA_HOME/bin/javac" --release 11 -nowarn -cp "$ANDROID_JAR" -d "$WORK/classes" \
    "$SDL"/android-project/app/src/main/java/org/libsdl/app/*.java
"$BT/d8" --release --min-api 24 --lib "$ANDROID_JAR" --output "$WORK/dex" \
    $(find "$WORK/classes" -name '*.class')

cp "$ASSETS" "$WORK/assets/Assets.dat"
"$BT/aapt2" compile -o "$WORK/flat" "$WORK/res/values/styles.xml" "$WORK/res/values-v28/styles.xml"
"$BT/aapt2" link -o "$WORK/base.apk" -I "$ANDROID_JAR" --manifest "$WORK/AndroidManifest.xml" \
    --min-sdk-version 24 --target-sdk-version 34 --debug-mode -A "$WORK/assets" -0 dat \
    "$WORK"/flat/*.flat

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
echo "$OUT $PACKAGE $(stat -c %s "$OUT") bytes, sha256 $(sha256sum "$OUT" | cut -c1-16)"
