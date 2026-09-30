#!/usr/bin/env bash
# One FNaF 3 night under the shared serial lease (see fnaf1-custom-run.sh).
# Dry unless --live (ADR 0002): a dry run needs no serial and takes no lease.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LIVE=0
for arg in "$@"; do [ "$arg" != --live ] || LIVE=1; done
[ "$LIVE" = 1 ] || exec node "$HERE/fnaf3-run.mjs" "$@"
# FNAF_SERIAL, else the untracked local profile; no default (ADR 0002 decision 8).
SERIAL="$(node "$HERE/../../bin/phone/local-profile.mjs" serial)" || exit 2
if [ "${FNAF3_LEASE_HELD:-}" != 1 ]; then
  exec python3 "$HERE/../../src/safety/device-lock-exec.py" "$SERIAL" -- \
    env FNAF3_LEASE_HELD=1 FNAF_SERIAL="$SERIAL" node "$HERE/fnaf3-run.mjs" "$@"
fi
exec env FNAF_SERIAL="$SERIAL" node "$HERE/fnaf3-run.mjs" "$@"
