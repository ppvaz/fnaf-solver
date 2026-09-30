# shellcheck shell=bash
# The one title/menu selector. Source this; do not re-derive it.
#
# plans/13 keeps four facts apart, and the runners used to collapse all four
# into a single environment variable named `NIGHT`:
#
#   GameConfig  which night is being played              (6, or custom dials)
#   MenuTarget  which title item gets pressed            (newGame|continue|sixthNight|customNight)
#   SaveState   what the save cursor actually holds      (only an observation can say)
#   Policy      which gated plan is executing            (recipe.mjs + human-gate.mjs)
#
# `NIGHT=continue` was all four at once: a menu action standing in for a night
# identity, resolved by `NIGHT_TAP=$TAP_CONTINUE; [ "$NIGHT" = 6th ] &&
# NIGHT_TAP=$TAP_6TH` in four separate scripts, none of which ever looked at the
# screen. `Continue` does not say which night the save cursor owns, and after
# the target device's save was lost it does not say the item is even there.
#
# So: every press goes through menu_select, every menu_select needs a positive
# observation of the item it is about to press, and New Game -- which is
# save-destructive and has never been pressed by any route -- additionally needs
# a deliberate capability the caller must set for that one run.
#
# Requires coords.sh to have been sourced (for the measured tap coordinates).

MENU_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# How stale an observation may be when the tap goes out. A title screen is
# static, so this is generous; it exists to catch an observation taken before a
# long unrelated step rather than to model animation.
#
# The age is measured from when the observation RETURNED -- see menu_observe.
# Measuring it from when the observation started made this limit a limit on the
# observer's own latency, which is not what it is for.
MENU_STALE_MS="${MENU_STALE_MS:-2000}"
# Set to 1, for one run, to permit the save-destructive New Game press. It is
# never inferred from a missing Continue: plans/13 is explicit that New Game is
# not a fallback.
MENU_ALLOW_SAVE_RESET="${MENU_ALLOW_SAVE_RESET:-0}"
MENU_PACKAGE="${MENU_PACKAGE:-com.scottgames.fnaf2}"
# One-frame UI contact measured on the Custom Night screen at 60 fps.
# Gameplay timing remains owned by the separately qualified night driver.
MENU_CONTACT_MS=17
# The canonical target build (README: v2.0.7, Fusion build 296). The version is
# checked, but it cannot identify the game on its own -- see the comment on
# menu_require_target_build.
MENU_TARGET_VERSION="${MENU_TARGET_VERSION:-2.0.7}"

# The measured title model for the canonical build on the calibrated handset.
# Device-specific in exactly the way coords.sh is, and defaulted for the same
# reason: a runner that has to be told where the title items are will be run
# without being told.
TITLE_MODEL="${TITLE_MODEL:-$MENU_HERE/models/title-moto-g56-v207.json}"

MENU_ITEMS=""
MENU_UNKNOWN=""
MENU_OBSERVED_MS=0

# `date +%s%3N` is a GNU extension: BSD date prints a literal "N" and the
# subtraction that follows would then be nonsense rather than an error. This
# runs on the host, not inside the timed policy, so a python3 call is cheap
# enough and correct everywhere.
menu_now_ms() { python3 -c 'import time; print(int(time.time() * 1000))'; }

# MenuTarget -> the measured tap coordinate. This is the only table.
menu_coord() {
  case "$1" in
    newGame)     printf '%s' "$TAP_NEWGAME" ;;
    continue)    printf '%s' "$TAP_CONTINUE" ;;
    sixthNight)  printf '%s' "$TAP_6TH" ;;
    # Measured 2026-09-06 after the operator beat 6th Night and the item first
    # appeared: see models/title-moto-g56-v207.json customNight_note. The row
    # was band-scanned independently; this is not a spacing-derived point.
    customNight) printf '%s' "$TAP_CUSTOM" ;;
    *)           echo "menu: not a MenuTarget: $1" >&2; return 3 ;;
  esac
}

# Observe the title screen. Sets MENU_ITEMS on success, MENU_UNKNOWN otherwise.
# Never decides anything: menu_select does that.
menu_observe() {
  local line
  MENU_ITEMS=""; MENU_UNKNOWN=""
  line=$(TITLE_MODEL="$TITLE_MODEL" python3 "$MENU_HERE/title-observe.py" --adb 2>/dev/null) || true
  # Stamped AFTER the observation, not before it.
  #
  # It was stamped before, so the "age" the staleness guard measured included
  # the observation's own duration -- and that duration is not small: the
  # observer runs a screencap plus a model classification, measured at ~1497 ms
  # median idle on this phone and ~2.3 s under run conditions, where
  # screenrecord and the Companion are both capturing. Against a 2000 ms
  # limit, that refused a perfectly valid title with "the title observation is
  # 2376 ms old", aborting a Night 1 run on the title screen.
  #
  # The guard's own comment says it exists "to catch an observation taken
  # before a long unrelated step rather than to model animation". Here the
  # observation *was* the long step, so it fired for the reason it explicitly
  # disclaims. Raising the limit would have hidden that; the number was never
  # wrong, the clock was measuring the wrong interval.
  MENU_OBSERVED_MS=$(menu_now_ms)
  case "$line" in
    items=*)   MENU_ITEMS="${line#items=}" ;;
    unknown=*) MENU_UNKNOWN="${line#unknown=}" ;;
    *)         MENU_UNKNOWN="observer-produced-no-verdict" ;;
  esac
  [ -n "$MENU_ITEMS" ]
}

menu_has_item() {
  # A herestring, not a pipeline. `printf | tr | grep -q` reports 141 under
  # `set -o pipefail` because grep exits on the first match and tr dies of
  # SIGPIPE -- the guard then reads false exactly when the pattern matched.
  # That bug has already cost this repository two silent nights.
  grep -qx "$1" <<<"$(tr ',' '\n' <<<"$MENU_ITEMS")"
}

# The target game must be installed, and must be the target GAME.
#
# Found the hard way on 2026-08-26: the phone had `com.scottgames.fnaf2`
# missing entirely and `com.scottgames.fivenightsatfreddys` -- Five Nights at
# Freddy's *1* -- installed that morning instead. What the plans recorded as
# "the target-device save was lost" was the FNaF 2 app being gone.
#
# The trap worth guarding is that **both games ship as versionName 2.0.7** on
# Android, so a version check alone passes on the wrong game. The package name
# is what identifies it; the version only says which build of it.
#
# Without this, the first symptom is "game is not focused", which reads as a
# transient and sends you looking at window state instead of at the fact that
# there is nothing to focus.
menu_require_target_build() {
  local packages version others
  packages=$(adb shell pm list packages 2>/dev/null || true)
  if ! grep -qx "package:$MENU_PACKAGE" <<<"$packages"; then
    echo "menu: $MENU_PACKAGE is not installed on this device" >&2
    others=$(grep -i 'scottgames' <<<"$packages" || true)
    if [ -n "$others" ]; then
      echo 'menu: these Scott Games packages are present instead:' >&2
      sed 's/^/      /' <<<"$others" >&2
      echo 'menu: note that FNaF 1 and FNaF 2 both report versionName 2.0.7,' >&2
      echo '      so the package name is the only thing that identifies the game.' >&2
    fi
    echo "menu: install the canonical target build and re-run; nothing here" >&2
    echo '      applies to another game or another build.' >&2
    return 3
  fi
  version=$(adb shell dumpsys package "$MENU_PACKAGE" 2>/dev/null     | sed -n 's/.*versionName=\([^ ]*\).*/\1/p' | head -1)
  [ "$version" = "$MENU_TARGET_VERSION" ] || {
    echo "menu: $MENU_PACKAGE is version ${version:-unknown}, not the calibrated" >&2
    echo "      $MENU_TARGET_VERSION -- coordinates, screen models and the sourced" >&2
    echo '      event model are all pinned to that build' >&2
    return 3
  }
}

# The game must be the focused window before anything is pressed. dumpsys
# prints several mCurrentFocus lines and the first is often null mid-transition,
# so match the package across all of them rather than taking -m1.
menu_focused() {
  local focus
  focus=$(adb shell dumpsys window 2>/dev/null || true)
  grep -q "mCurrentFocus=.*$MENU_PACKAGE" <<<"$focus"
}

# The guarded press. Refuses on: an unknown MenuTarget, an uncalibrated
# coordinate, lost focus, an observation the observer could not make, an item
# that is not on screen, a stale observation, and -- for New Game -- a missing
# capability.
menu_select() {
  local target=$1 xy age
  xy=$(menu_coord "$target") || return 3

  menu_require_target_build || return 3

  menu_focused || {
    echo "menu: $MENU_PACKAGE is not the focused window; refusing to press $target" >&2
    return 3
  }

  menu_observe || {
    echo "menu: cannot see the title screen ($MENU_UNKNOWN); refusing to press $target" >&2
    case "$MENU_UNKNOWN" in title-model-*|no-title-model) cat >&2 <<'HINT'
menu: this build has no usable title model, and one is not invented here.
      Capture title frames for each save state and run
        tools/device/title-observe.py --measure < frame.png
      then write the separating thresholds into a title-model-v1 file and point
      TITLE_MODEL at it. Until then no route may press a title item.
HINT
    ;; esac
    return 3
  }

  menu_has_item "$target" || {
    echo "menu: $target is not on the title screen (saw: ${MENU_ITEMS:-nothing}); refusing" >&2
    return 3
  }

  if [ "$target" = newGame ]; then
    # Save-destructive, and never a fallback for a missing Continue.
    [ "$MENU_ALLOW_SAVE_RESET" = "1" ] || {
      echo 'menu: New Game erases the save and needs MENU_ALLOW_SAVE_RESET=1 for this run' >&2
      return 3
    }
    # The authorization is recorded, and records nothing about the device: no
    # serial, no path, no account. Plan 09's provenance rules apply to this
    # line as much as to a capture.
    echo "menu: New Game authorized for this run (MENU_ALLOW_SAVE_RESET=1); the save will be erased"
  fi

  age=$(( $(menu_now_ms) - MENU_OBSERVED_MS ))
  [ "$age" -le "$MENU_STALE_MS" ] || {
    echo "menu: the title observation is ${age} ms old (limit ${MENU_STALE_MS} ms); refusing to press $target" >&2
    return 3
  }

  # A one-frame (17 ms) contact. Fusion polls touch per frame; this is the
  # shortest contact measured to register on the calibrated Custom Night UI.
  adb shell input swipe $xy $xy "$MENU_CONTACT_MS"
  echo "menu: pressed $target at $xy (observed ${age} ms earlier: $MENU_ITEMS)"
}
