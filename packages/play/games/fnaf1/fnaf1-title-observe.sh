#!/bin/bash
# Read only FNaF 1's title screen with its own calibrated model.
#
# `menu.sh` deliberately defaults TITLE_MODEL to FNaF 2's model because it is
# the FNaF 2 selector.  That default is unsafe for any other game: FNaF 1 and
# FNaF 2 share versionName 2.0.7 but not title geometry.  This wrapper removes
# any inherited TITLE_MODEL and passes FNaF 1's model explicitly, so omission
# cannot silently select the FNaF 2 sensor.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="$HERE/../../profiles/fnaf1/moto-g56/title-fnaf1-moto-g56-v207.json"

[ -r "$MODEL" ] || { echo "fnaf1-title-observe: model is unreadable: $MODEL" >&2; exit 2; }

exec env -u TITLE_MODEL python3 "$HERE/../../src/sensors/screencap/title-observe.py" --model "$MODEL" "$@"
