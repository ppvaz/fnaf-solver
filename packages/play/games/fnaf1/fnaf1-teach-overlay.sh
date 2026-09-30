#!/usr/bin/env bash
# FNaF 1-only passive teaching presenter, under a bounded adb shell contract.
#
#   fnaf1-teach-overlay.sh --status
#   fnaf1-teach-overlay.sh --preflight
#   fnaf1-teach-overlay.sh --show|--update --night 1|2 --stage STAGE --run RUN_ID
#   fnaf1-teach-overlay.sh --clear
#
# It never launches a game, captures pixels, reads a title, or injects input.
# The APK must first be visibly launched by the user, granted overlay consent,
# and started as a foreground presenter from its own activity. Commands only
# update that existing passive service, and every result is verified through
# its DUMP-protected dumpsys line.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# FNAF_SERIAL, then ANDROID_SERIAL (fnaf1-night-run.mjs passes it), then the
# untracked local profile; no default (ADR 0002 decision 8).
SERIAL="${FNAF_SERIAL:-${ANDROID_SERIAL:-}}"
[ -n "$SERIAL" ] || SERIAL="$(node "$HERE/../../bin/phone/local-profile.mjs" serial)" || exit 2
PACKAGE="com.ppvaz.fnaf1teach"
SERVICE="$PACKAGE/.Fnaf1TeachOverlayService"
RECEIVER="$PACKAGE/.Fnaf1TeachCommandReceiver"
SCHEMA="fnaf1-teach-overlay-v1"

usage() {
  echo "usage: fnaf1-teach-overlay.sh --status|--preflight|--clear|(--show|--update --night 1|2 --stage STAGE --run RUN_ID)" >&2
  exit 2
}

case "$SERIAL" in ''|*[!A-Za-z0-9._:-]*) echo "fnaf1-teach: invalid serial" >&2; exit 2 ;; esac

stage_ok() {
  case "$1" in
    hands-off|left-calibration|left-watch|right-monitor-calibration|full-loop|night2-calibration) return 0 ;;
    *) return 1 ;;
  esac
}

status_line() {
  local line
  line="$(adb -s "$SERIAL" shell dumpsys activity service "$SERVICE" 2>/dev/null | \
    sed -n 's/^[[:space:]]*\(fnaf1-teach schema=.*\)$/\1/p' | tail -n 1)"
  if [ -z "$line" ]; then
    echo "fnaf1-teach schema=$SCHEMA status=UNKNOWN reason=service-not-running" >&2
    return 3
  fi
  case "$line" in
    "fnaf1-teach schema=$SCHEMA "*) printf '%s\n' "$line" ;;
    *) echo "fnaf1-teach schema=$SCHEMA status=UNKNOWN reason=service-contract-mismatch" >&2; return 3 ;;
  esac
}

field() {
  local key="$1" text="$2"
  sed -n "s/.*[[:space:]]$key=\([^[:space:]]*\).*/\1/p" <<<" $text" | tail -n 1
}

MODE="${1:-}"
case "$MODE" in
  --status)
    [ "$#" -eq 1 ] || usage
    status_line
    ;;
  --preflight)
    [ "$#" -eq 1 ] || usage
    line="$(status_line)" || exit $?
    status="$(field status "$line")"
    permission="$(field permission "$line")"
    attached="$(field attached "$line")"
    interactive="$(field interactive "$line")"
    if [ "$permission" != GRANTED ] || [ "$interactive" != false ] || [ "$attached" != false ] \
        || { [ "$status" != READY ] && [ "$status" != CLEAR ]; }; then
      echo "fnaf1-teach schema=$SCHEMA status=HOLD reason=presenter-not-ready detail=$line" >&2
      exit 3
    fi
    printf '%s\n' "$line"
    ;;
  --clear)
    [ "$#" -eq 1 ] || usage
    adb -s "$SERIAL" shell am broadcast -n "$RECEIVER" -a "$PACKAGE.CLEAR" >/dev/null || {
      echo "fnaf1-teach: CLEAR broadcast failed" >&2; exit 3;
    }
    for _ in $(seq 1 20); do
      line="$(status_line 2>/dev/null || true)"
      if [ "$(field status "$line")" = CLEAR ] && [ "$(field attached "$line")" = false ]; then
        printf '%s\n' "$line"; exit 0
      fi
      sleep 0.1
    done
    echo "fnaf1-teach schema=$SCHEMA status=UNKNOWN reason=clear-not-confirmed" >&2
    exit 3
    ;;
  --show|--update)
    [ "$#" -eq 7 ] || usage
    [ "${2:-}" = --night ] && [ "${4:-}" = --stage ] && [ "${6:-}" = --run ] || usage
    NIGHT="${3:-}"; STAGE="${5:-}"; RUN="${7:-}"
    case "$NIGHT" in 1|2) ;; *) echo "fnaf1-teach: night must be 1 or 2" >&2; exit 2 ;; esac
    stage_ok "$STAGE" || { echo "fnaf1-teach: unrecognized stage '$STAGE'" >&2; exit 2; }
    [[ "$RUN" =~ ^[a-z0-9][a-z0-9-]{0,95}$ ]] || { echo "fnaf1-teach: invalid run id" >&2; exit 2; }
    case "$MODE" in
      --show) ACTION="$PACKAGE.SHOW" ;;
      --update) ACTION="$PACKAGE.UPDATE" ;;
    esac
    # The action suffix is fixed; caller-provided fields stay individual adb
    # arguments and are never evaluated as shell text.
    adb -s "$SERIAL" shell am broadcast -n "$RECEIVER" -a "$ACTION" \
      --ei night "$NIGHT" --es stage "$STAGE" --es run "$RUN" >/dev/null || {
        echo "fnaf1-teach: $MODE broadcast failed" >&2; exit 3;
      }
    for _ in $(seq 1 20); do
      line="$(status_line 2>/dev/null || true)"
      if [ "$(field status "$line")" = VISIBLE ] && [ "$(field permission "$line")" = GRANTED ] \
          && [ "$(field attached "$line")" = true ] && [ "$(field interactive "$line")" = false ] \
          && [ "$(field night "$line")" = "$NIGHT" ] && [ "$(field stage "$line")" = "$STAGE" ] \
          && [ "$(field run "$line")" = "$RUN" ]; then
        printf '%s\n' "$line"; exit 0
      fi
      sleep 0.1
    done
    echo "fnaf1-teach schema=$SCHEMA status=UNKNOWN reason=$MODE-not-confirmed" >&2
    exit 3
    ;;
  *) usage ;;
esac
