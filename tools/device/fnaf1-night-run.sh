#!/usr/bin/env bash
# One FNaF 1 device attempt under the shared serial lease.  The JS runner
# refuses a live invocation without FNAF1_LEASE_HELD=1, so callers cannot
# accidentally bypass this wrapper while a Cue Helper/device operation owns
# the phone.
#
# Dry unless --live (ADR 0002): without it the runner prints its bindings and
# touches no phone, so it needs no serial and takes no lease.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE=0
for arg in "$@"; do [ "$arg" != --live ] || LIVE=1; done
[ "$LIVE" = 1 ] || exec node "$HERE/fnaf1-night-run.mjs" "$@"
# FNAF_SERIAL, else the untracked local profile; no default (ADR 0002 decision 8).
SERIAL="$(node "$HERE/local-profile.mjs" serial)" || exit 2

if [ "${FNAF1_LEASE_HELD:-}" != 1 ]; then
  exec python3 "$HERE/device-lock-exec.py" "$SERIAL" -- \
    env FNAF1_LEASE_HELD=1 FNAF_SERIAL="$SERIAL" node "$HERE/fnaf1-night-run.mjs" "$@"
fi
exec env FNAF_SERIAL="$SERIAL" node "$HERE/fnaf1-night-run.mjs" "$@"
