#!/usr/bin/env bash
# One FNaF 1 menu probe under the shared serial lease.  The JS probe refuses a
# live invocation without FNAF1_LEASE_HELD=1, so a caller cannot reach the
# phone around this wrapper while a Companion/device operation owns it.
# Without --live the probe touches no phone, so it needs no serial and no lease.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE=0
for arg in "$@"; do [ "$arg" != --live ] || LIVE=1; done
[ "$LIVE" = 1 ] || exec node "$HERE/fnaf1-menu-probe.mjs" "$@"
# FNAF_SERIAL, else the untracked local profile; no default (ADR 0002 decision 8).
SERIAL="$(node "$HERE/local-profile.mjs" serial)" || exit 2

if [ "${FNAF1_LEASE_HELD:-}" != 1 ]; then
  exec python3 "$HERE/device-lock-exec.py" "$SERIAL" -- \
    env FNAF1_LEASE_HELD=1 FNAF_SERIAL="$SERIAL" node "$HERE/fnaf1-menu-probe.mjs" "$@"
fi
exec env FNAF_SERIAL="$SERIAL" node "$HERE/fnaf1-menu-probe.mjs" "$@"
