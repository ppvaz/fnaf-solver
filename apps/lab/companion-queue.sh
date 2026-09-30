#!/bin/bash
# Persistent, safe Companion job queue. This entry point deliberately does
# not source select-adb.sh: enqueue/list must work while the phone is absent.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$HERE/companion-queue.py" "$@"
