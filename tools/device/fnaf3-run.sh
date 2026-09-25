#!/usr/bin/env bash
# One FNaF 3 night under the shared serial lease (see fnaf1-custom-run.sh).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERIAL="${FNAF_SERIAL:-ZF525F5BH5}"
case "$SERIAL" in ''|*[!A-Za-z0-9._:-]*) echo "fnaf3-run: FNAF_SERIAL is invalid" >&2; exit 2 ;; esac
if [ "${FNAF3_LEASE_HELD:-}" != 1 ]; then
  exec python3 "$HERE/device-lock-exec.py" "$SERIAL" -- \
    env FNAF3_LEASE_HELD=1 FNAF_SERIAL="$SERIAL" node "$HERE/fnaf3-run.mjs" "$@"
fi
exec node "$HERE/fnaf3-run.mjs" "$@"
