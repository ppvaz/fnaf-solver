#!/bin/bash
# Gate for the post-night teardown. Mock adb, mock observer, no phone.
#
# The hazard is recorded, not hypothetical: on 2026-09-20 a capture loop
# force-stopped FNaF 3 during the post-night minigame and survived only because
# that game banks the night before the sequence rather than after it. So the
# assertion that matters here is negative and structural -- on every path where
# the title was not read, NO force-stop reaches the phone. A teardown that
# stops the game anyway after a timeout would pass a happy-path test and lose
# the next night's evidence.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOOL="$HERE/game-teardown.sh"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/fnaf2-teardown-test-XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

PKG="com.scottgames.fnaf3"
mkdir -p "$TMP/bin"

cat > "$TMP/bin/adb" <<'MOCK'
#!/bin/bash
case "$*" in
  *"get-state")            echo device; exit 0 ;;
  *"devices -l")           echo "List of devices attached"; exit 0 ;;
  *"dumpsys window")       printf '%s\n' "$MOCK_FOCUS"; exit 0 ;;
  *"am force-stop"*)       echo "$*" >> "$MOCK_STOPS"; exit 0 ;;
esac
echo "unexpected mock adb invocation: $*" >&2
exit 1
MOCK
chmod +x "$TMP/bin/adb"
export PATH="$TMP/bin:$PATH"
export ANDROID_SERIAL=MOCKSERIAL
export MOCK_FOCUS="  mCurrentFocus=Window{a1b2 u0 $PKG/com.unity3d.player.UnityPlayerActivity}"

# A title model only has to exist to get past the configuration check; the mock
# observer decides the read.
TITLE_MODEL="$TMP/model.json"; echo '{}' > "$TITLE_MODEL"; export TITLE_MODEL
export FNAF_TITLE_OBSERVE="$TMP/bin/title-observe"
cat > "$TMP/bin/title-observe" <<'MOCK'
#!/bin/bash
# MOCK_TITLE_AFTER observations return unknown before a confident read.
COUNT_FILE="$MOCK_OBSERVE_COUNT"
n=$(( $(cat "$COUNT_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$COUNT_FILE"
if [ "$n" -ge "${MOCK_TITLE_AFTER:-1}" ]; then
  echo "items=continue,newGame"; exit 0
fi
echo "unknown=ambiguous:title-gate:0.1455" >&2
exit 3
MOCK
chmod +x "$TMP/bin/title-observe"

PASS=0
fail() { echo "FAIL: $1" >&2; exit 1; }
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }

# Each case gets its own ledgers so a leaked stop cannot be blamed on a
# previous case.
reset() {
  MOCK_STOPS="$TMP/stops-$1"; export MOCK_STOPS; : > "$MOCK_STOPS"
  MOCK_OBSERVE_COUNT="$TMP/count-$1"; export MOCK_OBSERVE_COUNT; : > "$MOCK_OBSERVE_COUNT"
}
stops() { grep -c 'force-stop' "$MOCK_STOPS" 2>/dev/null || true; }

# 1. No night ran: the caller's assertion stands and the game is stopped.
reset plain
"$TOOL" "$PKG" > "$TMP/out-plain" 2>&1 || fail "plain teardown exited non-zero"
[ "$(stops)" = "1" ] || fail "plain teardown did not force-stop"
ok "no night ran: the game is stopped"

# 2. A night ran and the title reads at once: stop follows the read.
reset first
MOCK_TITLE_AFTER=1 FNAF_TEARDOWN_POLL_MS=1 "$TOOL" "$PKG" --after-night > "$TMP/out-first" 2>&1 ||
  fail "after-night with an immediate title read exited non-zero"
[ "$(stops)" = "1" ] || fail "after-night did not stop after a confident title read"
grep -q 'title confirmed' "$TMP/out-first" || fail "after-night did not report the read it acted on"
ok "night banked: the title read authorises the stop"

# 3. The sequence is still playing, then finishes: the tool waits it out.
reset later
MOCK_TITLE_AFTER=3 FNAF_TEARDOWN_POLL_MS=1 "$TOOL" "$PKG" --after-night > "$TMP/out-later" 2>&1 ||
  fail "after-night did not wait for a late title read"
[ "$(stops)" = "1" ] || fail "after-night did not stop once the title finally read"
[ "$(cat "$TMP/count-later")" = "3" ] || fail "after-night stopped polling early"
ok "post-night sequence: unknown keeps waiting, it does not decide"

# 4. THE REGRESSION. The title never reads: refuse, and leave the game running.
reset never
set +e
MOCK_TITLE_AFTER=9999 FNAF_TEARDOWN_POLL_MS=1 FNAF_TEARDOWN_DEADLINE_MS=30 \
  "$TOOL" "$PKG" --after-night > "$TMP/out-never" 2>&1
STATUS=$?
set -e
[ "$STATUS" = "3" ] || fail "a timed-out teardown must exit 3, got $STATUS"
[ "$(stops)" = "0" ] || fail "a timed-out teardown force-stopped the game -- this is the 2026-09-20 defect"
grep -q 'LEFT RUNNING' "$TMP/out-never" || fail "a timed-out teardown did not say the game was left running"
ok "deadline exceeded: refuses, and no force-stop reaches the phone"

# 5. The game is not on screen: its state cannot be read, so it is not acted on.
reset unfocused
set +e
MOCK_FOCUS="  mCurrentFocus=Window{c3d4 u0 com.android.launcher/com.android.launcher.Launcher}" \
  "$TOOL" "$PKG" --after-night > "$TMP/out-unfocused" 2>&1
STATUS=$?
set -e
[ "$STATUS" = "3" ] || fail "an unfocused game must refuse with 3, got $STATUS"
[ "$(stops)" = "0" ] || fail "an unfocused game was force-stopped; it may be backgrounded mid-night"
ok "unreadable state: refuses rather than guessing"

# 6. A missing model is a configuration error, answered now, not after the
#    whole deadline is spent printing unknown=no-title-model.
reset nomodel
set +e
TITLE_MODEL= "$TOOL" "$PKG" --after-night > "$TMP/out-nomodel" 2>&1
STATUS=$?
set -e
[ "$STATUS" = "2" ] || fail "a missing TITLE_MODEL must exit 2, got $STATUS"
[ "$(stops)" = "0" ] || fail "a missing TITLE_MODEL still force-stopped the game"
ok "missing title model: refused immediately, not after the deadline"

# 7. Usage.
reset usage
set +e
"$TOOL" > /dev/null 2>&1; NOARG=$?
"$TOOL" "$PKG" --whatever > /dev/null 2>&1; BADMODE=$?
"$TOOL" 'not a package!' --after-night > /dev/null 2>&1; BADPKG=$?
set -e
[ "$NOARG" = "2" ] && [ "$BADMODE" = "2" ] && [ "$BADPKG" = "2" ] ||
  fail "usage errors must exit 2 (got $NOARG/$BADMODE/$BADPKG)"
[ "$(stops)" = "0" ] || fail "a usage error force-stopped the game"
ok "usage errors refuse without touching the phone"

# 8. Structural: no other committed tool may force-stop a game package without
#    going through here. A second copy of this rule is a second place to get it
#    wrong, which is how the defect happened in the first place.
UNGATED=$(grep -rln 'am force-stop com\.scottgames\.fnaf[134]' "$HERE" --include='*.sh' --include='*.mjs' --include='*.py' 2>/dev/null || true)
[ -z "$UNGATED" ] ||
  fail "these stop a second game directly instead of via game-teardown.sh: $UNGATED"
ok "no second-game force-stop bypasses this tool"

echo "game teardown: $PASS checks -- a night is stopped only once its title has been read"
