#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/fnaf1-teach-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
# The same JDK probe as android/companion/test.sh: a candidate must actually
# run. macOS puts a /usr/bin/javac stub on PATH that exits with "Unable to
# locate a Java Runtime", so falling back to `command -v javac` picked the stub
# over the Homebrew JDK beside it. No skip path: a missing JDK fails the check.
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
  exit 2
fi
JAVAC="$JDK_ROOT/bin/javac"
JAVA="$JDK_ROOT/bin/java"
"$JAVAC" -encoding UTF-8 --release 17 -d "$TMP" \
  "$HERE/src/com/ppvaz/fnaf1teach/Fnaf1TeachContract.java" \
  "$HERE/test/com/ppvaz/fnaf1teach/Fnaf1TeachContractTest.java"
"$JAVA" -cp "$TMP" com.ppvaz.fnaf1teach.Fnaf1TeachContractTest
