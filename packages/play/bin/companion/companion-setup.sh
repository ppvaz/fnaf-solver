#!/bin/bash
# Image-free Companion setup and target-menu check.
#
# This wrapper selects exactly one ADB device, then delegates all UI work to
# companion-setup.py. The Python command may tap only named controls belonging
# to the helper or Android's projection-consent dialog; it never sends a game
# control coordinate.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../phone/select-adb.sh"
exec python3 "$HERE/companion-setup.py" "$@"
