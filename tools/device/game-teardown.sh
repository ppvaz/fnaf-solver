#!/bin/bash
# Stop a target game without destroying the evidence the run just created.
#
# On 2026-09-20 an ad-hoc capture loop force-stopped FNaF 3 *during* the
# post-night minigame -- the sequence that plays after a night completes.
# FNaF 3 happens to bank the night before that sequence, so the run survived by
# luck and its own provenance records the near miss
# (docs/evidence/fnaf3-first-night-20260920.json). Had the game banked after it
# instead, the teardown would have erased the result the run existed to create.
#
# The rule this encodes: after a night, a game is stopped only once the title
# screen has been READ. Nothing here waits a tuned interval and hopes, because
# the title read is not a proxy for the save -- it is the save. FNaF 3's Night 1
# was graded by exactly this observation ("the title afterwards reads LOAD GAME
# 2"), so a confident title read means the bank already happened and is already
# durable. That is why there is no settle constant in this file: a number
# invented here would be a floor anchored to the route it protects, which is
# mistake register entry 7.
#
# The deadline is a bound, not a measurement. The post-night sequence's length
# is UNKNOWN(not-measured) for every game here, so exceeding the deadline is
# never read as "it must be done by now". It fails the other way: the game is
# LEFT RUNNING and the caller is told, because a phone sitting on a minigame is
# recoverable by an operator and a force-stop through a save write is not.
#
#   game-teardown.sh PACKAGE                 # no night ran; stop it
#   game-teardown.sh PACKAGE --after-night   # a night ran; observe, then stop
#
# Exit codes: 0 stopped, 3 refused (game left running), 2 usage or I/O failure.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE="${1:-}"
MODE="${2:-}"

# A bound on the post-night sequence, not a measurement of it. Raise it for a
# game with a longer sequence; the failure mode of raising it is a slower
# teardown, and of lowering it a refusal, never a force-stop through a save.
TEARDOWN_DEADLINE_MS="${FNAF_TEARDOWN_DEADLINE_MS:-180000}"
# One observation costs a screencap plus a classify (~1 s on the calibrated
# handset), so this is spacing, not a duty cycle.
TEARDOWN_POLL_MS="${FNAF_TEARDOWN_POLL_MS:-5000}"
TITLE_OBSERVE="${FNAF_TITLE_OBSERVE:-$HERE/title-observe.py}"

usage() {
  echo "usage: game-teardown.sh PACKAGE [--after-night]" >&2
  exit 2
}

case "$PACKAGE" in
  ''|-*) usage ;;
  *[!a-zA-Z0-9._]*) echo "package must be an Android package name: $PACKAGE" >&2; exit 2 ;;
esac
case "$MODE" in
  ''|--after-night) ;;
  *) usage ;;
esac
case "$TEARDOWN_DEADLINE_MS:$TEARDOWN_POLL_MS" in
  *[!0-9:]*) echo "FNAF_TEARDOWN_DEADLINE_MS and FNAF_TEARDOWN_POLL_MS must be integers" >&2; exit 2 ;;
esac
[ "$TEARDOWN_POLL_MS" -gt 0 ] || { echo "FNAF_TEARDOWN_POLL_MS must be positive" >&2; exit 2; }

# shellcheck source=tools/device/select-adb.sh
. "$HERE/select-adb.sh"

# Not `date +%s%3N`: that is a GNU extension, and BSD date on the macOS host
# prints a literal "N", so the deadline arithmetic failed and --after-night
# aborted on its second poll whenever the title was not read on the first
# (menu.sh records the same pitfall).
now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }

stop_game() {
  adb shell am force-stop "$PACKAGE" >/dev/null 2>&1 ||
    { echo "teardown: force-stop failed for $PACKAGE" >&2; exit 2; }
  echo "teardown: stopped $PACKAGE"
}

if [ "$MODE" != "--after-night" ]; then
  # The caller asserts no night ran. That assertion is theirs to make; this
  # path exists so the observed path is never skipped by editing a flag out.
  stop_game
  exit 0
fi

# A missing model makes title-observe print `unknown=no-title-model` forever, so
# the whole deadline would be spent proving a configuration error. Refuse now.
[ -n "${TITLE_MODEL:-}" ] ||
  { echo "teardown: --after-night needs TITLE_MODEL (the per-game title model)" >&2; exit 2; }
[ -r "$TITLE_MODEL" ] ||
  { echo "teardown: TITLE_MODEL is not readable: $TITLE_MODEL" >&2; exit 2; }
[ -x "$TITLE_OBSERVE" ] ||
  { echo "teardown: title observer is not executable: $TITLE_OBSERVE" >&2; exit 2; }

# The decision depends on what this game is showing, so a game that is not on
# screen is not a state this tool may act on -- it could be backgrounded
# mid-night, which is the one case where stopping is destructive.
FOCUS="$(adb shell dumpsys window 2>/dev/null | grep 'mCurrentFocus=' | grep -c "$PACKAGE" || true)"
if [ "$FOCUS" = "0" ]; then
  echo "teardown: $PACKAGE is not the focused window; refusing to stop a game whose state cannot be read" >&2
  echo "teardown: left running" >&2
  exit 3
fi

DEADLINE=$(( $(now_ms) + TEARDOWN_DEADLINE_MS ))
POLL_SECONDS="$(awk -v ms="$TEARDOWN_POLL_MS" 'BEGIN { printf "%.3f", ms / 1000 }')"
OBSERVED=""
while :; do
  # title-observe exits 0 only on a confident read. Its `unknown` band is the
  # undecided interval, and one post-transition frame is explicitly not an
  # answer there -- so an unknown keeps waiting rather than deciding.
  if OBSERVED="$("$TITLE_OBSERVE" --adb 2>/dev/null)"; then
    echo "teardown: title confirmed ($OBSERVED); the night is banked"
    stop_game
    exit 0
  fi
  [ "$(now_ms)" -lt "$DEADLINE" ] || break
  sleep "$POLL_SECONDS"
done

echo "teardown: no title read within ${TEARDOWN_DEADLINE_MS} ms (last: ${OBSERVED:-none})" >&2
echo "teardown: $PACKAGE LEFT RUNNING on purpose -- a post-night sequence may still be writing the save" >&2
echo "teardown: drive it to the title by hand, then re-run, or stop it deliberately without --after-night" >&2
exit 3
