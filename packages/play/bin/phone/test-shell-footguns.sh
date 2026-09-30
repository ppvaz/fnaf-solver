#!/bin/bash
# No-device regression for the three shell failures documented in CLAUDE.md.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
failed=0

fail() {
  echo "FAIL: $*" >&2
  failed=$((failed + 1))
}

# A short-circuiting grep closes its input early. Under pipefail the producer
# receives SIGPIPE, so a matching stream can report failure. This is the exact
# failure mode that skipped the Bluetooth guard on two recorded nights.
set +e
( set -o pipefail; yes match | grep -q match )
pipe_status=$?
set -e
[ "$pipe_status" -ne 0 ] || fail "the unsafe pipe unexpectedly hid SIGPIPE"

# The fixed shape reads the command output first and searches a herestring.
focus=$'mCurrentFocus=null\n  mCurrentFocus=Window{1 u0 com.scottgames.fnaf2/.Main}'
grep -Fq com.scottgames.fnaf2 <<<"$focus" ||
  fail "the herestring focus guard rejected a later game window"

# Keep the production focus guards from regressing to a streaming grep -q
# pipeline. The shellcheck gate catches new error-tier issues; this assertion
# names the particular lost-night pattern in the files that launch probes.
script="$HERE/../companion/collect-cue-audio.sh"
if grep -Eq 'grep mCurrentFocus[[:space:]]+[|][^|]' "$script" ||
    grep -Fq 'dumpsys window | grep -q' "$script"; then
  fail "$script still has a streaming dumpsys/grep -q guard"
fi

# A missing aborted-run filename must stop grading loudly. This is the fixed
# contract behind the old GRADE_RUN=1 -> "$OUT.mp4" no-op.
run="shell-footgun-missing-$$"
set +e
output="$("$HERE/../../../../packages/review/bin/grade/grade-run.sh" "$run" 2>&1)"
grade_status=$?
set -e
[ "$grade_status" -eq 2 ] || fail "missing-input grade exited $grade_status, not 2"
case "$output" in
  *"no capture found for $run"*) ;;
  *) fail "missing-input grade did not explain the absent capture" ;;
esac

[ "$failed" -eq 0 ] || exit 1
echo "shell footguns: pipefail guard, multiline focus, and missing-input grading pass"
