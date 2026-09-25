#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
    SDK_ROOT="$ANDROID_SDK_ROOT"
elif [[ -d "${HOME}/.local/toolchains/android-sdk" ]]; then
    SDK_ROOT="${HOME}/.local/toolchains/android-sdk"
else
    SDK_ROOT="${HOME}/Library/Android/sdk"
fi
JDK_ROOT="${JAVA_HOME:-/opt/homebrew/opt/openjdk}"
BUILD_TOOLS="${ANDROID_BUILD_TOOLS_VERSION:-36.0.0}"
PLATFORM="${ANDROID_PLATFORM_VERSION:-36}"
export JAVA_HOME="$JDK_ROOT"

AAPT2="$SDK_ROOT/build-tools/$BUILD_TOOLS/aapt2"
D8="$SDK_ROOT/build-tools/$BUILD_TOOLS/d8"
ZIPALIGN="$SDK_ROOT/build-tools/$BUILD_TOOLS/zipalign"
APKSIGNER="$SDK_ROOT/build-tools/$BUILD_TOOLS/apksigner"
ANDROID_JAR="$SDK_ROOT/platforms/android-$PLATFORM/android.jar"
JAVAC="$JDK_ROOT/bin/javac"
JAR="$JDK_ROOT/bin/jar"
KEYTOOL="$JDK_ROOT/bin/keytool"
BUILD_DIR="$SCRIPT_DIR/build"
CLASSES_DIR="$BUILD_DIR/classes"
DEX_DIR="$BUILD_DIR/dex"
RES_DIR="$SCRIPT_DIR/res"
ASSETS_DIR="$SCRIPT_DIR/assets"
KEYSTORE="$SCRIPT_DIR/debug.keystore"

for required in "$AAPT2" "$D8" "$ZIPALIGN" "$APKSIGNER" "$ANDROID_JAR" \
        "$JAVAC" "$JAR" "$KEYTOOL"; do
    if [[ ! -e "$required" ]]; then
        echo "missing required tool: $required" >&2
        exit 1
    fi
done

if [[ "$BUILD_DIR" != "$SCRIPT_DIR/build" ]]; then
    echo "refusing unexpected build directory: $BUILD_DIR" >&2
    exit 1
fi
rm -rf "$BUILD_DIR"
mkdir -p "$CLASSES_DIR" "$DEX_DIR"

"$AAPT2" compile \
    --dir "$RES_DIR" \
    -o "$BUILD_DIR/compiled-res.zip"

"$AAPT2" link \
    --manifest "$SCRIPT_DIR/AndroidManifest.xml" \
    -I "$ANDROID_JAR" \
    -R "$BUILD_DIR/compiled-res.zip" \
    -A "$ASSETS_DIR" \
    -0 otf \
    --auto-add-overlay \
    --min-sdk-version 29 \
    --target-sdk-version 36 \
    --version-code 15 \
    --version-name 0.1.14 \
    -o "$BUILD_DIR/base-unsigned.apk"

"$JAVAC" \
    -encoding UTF-8 \
    -source 17 \
    -target 17 \
    -classpath "$ANDROID_JAR" \
    -d "$CLASSES_DIR" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/MainActivity.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/RunnerCatalog.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/NightRunner.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/TermuxBridge.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/AccessibilityProbeActivity.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/AccessibilityGameProbeReceiver.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/AccessibilityProbeService.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/AudioAnalyzer.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/PhaseClock.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/CueDetector.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/PixelWatch.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/NativeRegions.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/PanAnchor.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/ScreenIdentity.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/NightOnsetLatch.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/ScreenStats.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/NormalizedRect.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/RoiSpec.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlayGeometry.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlayCollisionDetector.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlayRegionFilter.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlaySnapshot.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/BatteryLifeDetector.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/MonitorStateDetector.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/CameraSelectionDetector.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlayCaptureGate.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlayMetrics.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlayCueArbiter.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlaySnapshotRetention.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/CycleLesson.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/TeachPanel.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/Fnaf1Lesson.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/Fnaf1PanelView.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/Fnaf3Lesson.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/Fnaf3PanelView.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/Fnaf4Lesson.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/Fnaf4PanelView.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/TeachPanelView.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlayView.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/OverlayController.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/CaptureFileProvider.java" \
    "$SCRIPT_DIR/src/com/ppvaz/fnafcompanion/CaptureService.java"

"$JAR" --create --file "$BUILD_DIR/classes.jar" -C "$CLASSES_DIR" .
JAVA_HOME="$JDK_ROOT" "$D8" \
    --min-api 29 \
    --lib "$ANDROID_JAR" \
    --output "$DEX_DIR" \
    "$BUILD_DIR/classes.jar"

cp "$BUILD_DIR/base-unsigned.apk" "$BUILD_DIR/companion-with-dex-unsigned.apk"
zip -q -j "$BUILD_DIR/companion-with-dex-unsigned.apk" "$DEX_DIR/classes.dex"
"$ZIPALIGN" -f 4 \
    "$BUILD_DIR/companion-with-dex-unsigned.apk" \
    "$BUILD_DIR/companion-aligned.apk"

if [[ ! -f "$KEYSTORE" ]]; then
    "$KEYTOOL" -genkeypair \
        -keystore "$KEYSTORE" \
        -storepass android \
        -keypass android \
        -alias androiddebugkey \
        -dname "CN=Android Debug,O=Android,C=US" \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -noprompt >/dev/null
fi

"$APKSIGNER" sign \
    --ks "$KEYSTORE" \
    --ks-pass pass:android \
    --key-pass pass:android \
    --out "$BUILD_DIR/fnaf2-companion.apk" \
    "$BUILD_DIR/companion-aligned.apk"
"$APKSIGNER" verify --verbose "$BUILD_DIR/fnaf2-companion.apk"

echo "$BUILD_DIR/fnaf2-companion.apk"
