#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TEST_TMP="$(mktemp -d "${TMPDIR:-/tmp}/companion-java-test.XXXXXX")"
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
  echo "this check compiles the Companion's host contracts on the host; it needs no phone or Android SDK" >&2
  exit 2
fi
JAVAC="$JDK_ROOT/bin/javac"
JAVA="$JDK_ROOT/bin/java"

# --release, not -source/-target: the latter compiles against the running JDK's
# system modules and warns that the result may not run on 17.
#
# Every source that imports no Android class, and every *Test.java, found
# rather than listed: a hand list here let a new test sit uncompiled and
# unrun, the same drift that broke build.sh when HidControls.java joined src/.
SOURCES=()
while IFS= read -r source; do SOURCES+=("$source"); done \
  < <(grep -L '^import android\.' "$HERE"/src/com/ppvaz/fnafcompanion/*.java | sort)
TEST_SOURCES=()
while IFS= read -r source; do TEST_SOURCES+=("$source"); done < <(find "$HERE/test" -name '*.java' | sort)
TESTS=()
while IFS= read -r test; do TESTS+=("$test"); done < <(find "$HERE/test" -name '*Test.java' | sort)
if [ "${#TESTS[@]}" -eq 0 ]; then
  echo "no host tests found under $HERE/test" >&2
  exit 1
fi
"$JAVAC" -encoding UTF-8 --release 17 -d "$TEST_TMP" "${SOURCES[@]}" "${TEST_SOURCES[@]}"

# A test that is only compiled asserts nothing (tools/test-mistake-register.ts):
# each one found is run, with the fixture its class reads.
TESTDATA="$HERE/../../packages/play/test/testdata"
PROFILES="$HERE/../../packages/play/profiles/fnaf2/moto-g56"
for test in "${TESTS[@]}"; do
  class="$(basename "$test" .java)"
  props=()
  case "$class" in
    CompanionStatusTest) props=("-Dstatus.vector=$TESTDATA/companion-status-v1.txt") ;;
    TargetsTest) props=("-Dtargets.model=$PROFILES/companion-targets-v1.json") ;;
    HidControlsTest) props=("-Dhid.bundle=$HERE/assets/runners/generated/minus-toys") ;;
    CycleLessonTest) props=("-Dteach.vector=$TESTDATA/teach-lesson-night7-k3.txt") ;;
    TeachPanelTest) props=("-Dteach.model=$PROFILES/teach-panel-v1.json") ;;
  esac
  # bash 3.2 (macOS) treats "${empty[@]}" as unbound under set -u.
  "$JAVA" ${props[@]+"${props[@]}"} -cp "$TEST_TMP" "com.ppvaz.fnafcompanion.$class"
done

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
