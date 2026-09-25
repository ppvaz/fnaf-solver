#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/cue-helper-java-test.XXXXXX")"
trap 'rm -rf "$TEST_TMP"' EXIT HUP INT TERM
# Find a JDK rather than assuming one machine's. This used to hardcode the
# Homebrew prefix as the fallback, which made the check pass on the laptop that
# wrote it and fail everywhere else -- including CI, where JAVA_HOME is not
# guaranteed. Order: an explicit JAVA_HOME, then whatever javac is on PATH,
# then the Homebrew prefix.
#
# There is no skip path. A check that quietly does nothing when its toolchain
# is missing reads as coverage, and this repository has already paid for that
# once with a grading step that graded a file which did not exist.
# A candidate must actually COMPILE, not merely exist. macOS ships
# /usr/bin/javac as a stub that is present, executable, and on PATH, and then
# exits with "Unable to locate a Java Runtime" -- so an `-x` test picks it over
# a real JDK sitting beside it. Probe each candidate with -version.
JDK_ROOT=""
for candidate in "${JAVA_HOME:-}" \
                 "$(dirname "$(dirname "$(command -v javac 2>/dev/null || echo /nonexistent/bin/javac)")")" \
                 /opt/homebrew/opt/openjdk /usr/lib/jvm/default-java; do
  [ -n "$candidate" ] || continue
  [ -x "$candidate/bin/javac" ] || continue
  "$candidate/bin/javac" -version >/dev/null 2>&1 || continue
  JDK_ROOT="$candidate"
  break
done
if [ -z "$JDK_ROOT" ]; then
  echo "no working JDK found: set JAVA_HOME or put a real javac on PATH" >&2
  echo "this check compiles Cue Helper host contracts on the host; it needs no phone or Android SDK" >&2
  exit 2
fi
JAVAC="$JDK_ROOT/bin/javac"
JAVA="$JDK_ROOT/bin/java"

# --release, not -source/-target: the latter compiles against the running JDK's
# system modules and warns that the result may not run on 17.
"$JAVAC" -encoding UTF-8 --release 17 -d "$TEST_TMP" \
  "$HERE/src/com/ppvaz/fnafcompanion/CueDetector.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/AudioAnalyzer.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/PhaseClock.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/PixelWatch.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/PanAnchor.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/ScreenIdentity.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/NightOnsetLatch.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/ScreenStats.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/NormalizedRect.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/RoiSpec.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/OverlayGeometry.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/OverlayCollisionDetector.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/OverlayRegionFilter.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/OverlaySnapshot.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/BatteryLifeDetector.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/MonitorStateDetector.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/CameraSelectionDetector.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/OverlayCaptureGate.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/OverlayMetrics.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/OverlayCueArbiter.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/OverlaySnapshotRetention.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/CycleLesson.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/TeachPanel.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/NativeRegions.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/Fnaf1Lesson.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/Fnaf3Lesson.java" \
  "$HERE/src/com/ppvaz/fnafcompanion/Fnaf4Lesson.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/CueDetectorTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/AudioAnalyzerTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/PhaseClockTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/PixelWatchTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/PanAnchorTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/BatteryLifeDetectorTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/ScreenIdentityTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/NightOnsetLatchTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/ScreenStatsTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/OverlayContractTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/OverlayMetricsTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/OverlaySnapshotRetentionTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/CycleLessonTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/TeachPanelTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/NativeRegionsTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/Fnaf1LessonTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/Fnaf3LessonTest.java" \
  "$HERE/test/com/ppvaz/fnafcompanion/Fnaf4LessonTest.java"
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.CueDetectorTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.NativeRegionsTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.Fnaf1LessonTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.Fnaf3LessonTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.Fnaf4LessonTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.AudioAnalyzerTest
$JAVA -cp "$TEST_TMP" com.ppvaz.fnafcompanion.PhaseClockTest
$JAVA -cp "$TEST_TMP" com.ppvaz.fnafcompanion.PixelWatchTest
$JAVA -cp "$TEST_TMP" com.ppvaz.fnafcompanion.PanAnchorTest
$JAVA -cp "$TEST_TMP" com.ppvaz.fnafcompanion.ScreenIdentityTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.NightOnsetLatchTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.ScreenStatsTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.OverlayContractTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.OverlayMetricsTest
"$JAVA" -cp "$TEST_TMP" com.ppvaz.fnafcompanion.OverlaySnapshotRetentionTest
"$JAVA" -Dteach.vector="$HERE/../../tools/device/testdata/teach-lesson-night7-k3.txt" \
  -cp "$TEST_TMP" com.ppvaz.fnafcompanion.CycleLessonTest
"$JAVA" -Dteach.model="$HERE/../../tools/device/models/teach-panel-v1.json" \
  -cp "$TEST_TMP" com.ppvaz.fnafcompanion.TeachPanelTest

# Video capture is independent of the optional audio receiver. Keep this
# source-level guard beside the host tests because MainActivity itself needs
# Android framework classes and cannot be executed on the host JVM.
capture_method="$(awk '
  /private void toggleCapture\(\)/ { active=1 }
  active { print }
  active && /^    private Button themedButton/ { exit }
' "$HERE/src/com/ppvaz/fnafcompanion/MainActivity.java")"
case "$capture_method" in
  *bluetoothConnected*|*ensureBluetoothReady*|*showAudioSetupDialog*)
    echo "capture flow: FAILED (video start regained an audio prerequisite)" >&2
    exit 1
    ;;
esac
case "$capture_method" in
  *requestProjection\(\)*) ;;
  *) echo "capture flow: FAILED (video start does not request projection)" >&2; exit 1 ;;
esac
echo "capture flow: optional audio does not gate video start"

overlay_refresh="$(awk '
  /private void refreshOverlayControls\(String status\)/ { active=1 }
  active { print }
  active && /^    private void toggleOverlay\(\)/ { exit }
' "$HERE/src/com/ppvaz/fnafcompanion/MainActivity.java")"
case "$overlay_refresh" in
  *"overlayButton.setText(overlayEnabled ? \"Disable overlay\" : \"Enable overlay\")"*) ;;
  *) echo "overlay controls: FAILED (button label is not stable)" >&2; exit 1 ;;
esac
case "$overlay_refresh" in
  *"overlayButton.setText"*"line.substring"*)
    echo "overlay controls: FAILED (status text is embedded in the button)" >&2
    exit 1
    ;;
esac
echo "overlay controls: status is separate from the stable action button"

identity_gate="$(awk '
  /public void onCapturedScreenIdentity\(int identity\)/ { active=1 }
  active { print }
  active && /^    public void onCaptureStopped\(\)/ { exit }
' "$HERE/src/com/ppvaz/fnafcompanion/OverlayController.java")"
case "$identity_gate" in
  *"ScreenIdentity.isRecognizedGameScreen(identity)"*"identity == ScreenIdentity.UNKNOWN"*"detach(null)"*"target-not-game"*) ;;
  *) echo "overlay identity gate: FAILED (foreign capture does not detach)" >&2; exit 1 ;;
esac
echo "overlay identity gate: foreign capture detaches the HUD"

catalog="$HERE/assets/runners/catalog.json"
if [ ! -f "$catalog" ]; then
  echo "runner catalog: FAILED (catalog asset is missing)" >&2
  exit 1
fi
for required in '"schema": "runner-catalog-v1"' '"enabled": false' '"claimLevel": "MODEL_ONLY"' \
                '"id": "minus-toys"' '"id": "minus3"' '"id": "minus7"' \
                '"id": "golden-freddy"'; do
  if ! grep -F -q "$required" "$catalog"; then
    echo "runner catalog: FAILED (missing $required)" >&2
    exit 1
  fi
done
runner_gate="$HERE/src/com/ppvaz/fnafcompanion/RunnerCatalog.java"
for required in '"READY".equals(readiness)' '"DEVICE_MEASURED".equals(gateClaimLevel)' \
                'sixAmProof && planBoundToProof && adaptersReady'; do
  if ! grep -F -q "$required" "$runner_gate"; then
    echo "runner readiness gate: FAILED (missing $required)" >&2
    exit 1
  fi
done
echo "runner catalog: unready and unproven routes remain disabled"

if ! grep -F -q 'for (int night = 1; night <= 7; night++)' "$runner_gate" \
    || ! grep -F -q 'for (JSONObject strategy : strategyEntries)' "$runner_gate"; then
  echo "runner catalog: FAILED (route picker is not ordered by night)" >&2
  exit 1
fi
echo "runner catalog: route picker is ordered by night"

if [ "$(node -p "require('$catalog').strategies.at(-1).id")" != "minus-toys" ]; then
  echo "runner catalog: FAILED (Minus Toys is not last within each night)" >&2
  exit 1
fi
echo "runner catalog: Minus Toys is last within each night"
