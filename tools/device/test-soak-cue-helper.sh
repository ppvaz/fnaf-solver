#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cue-helper-soak-test.XXXXXX")"
# query-cue-helper.sh stashes the endpoint it resolves; keep it out of captures/.
export CUE_HELPER_ENDPOINT_STASH="$TEMP_DIR/endpoint-stash"
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM

MOCK_BIN="$TEMP_DIR/bin"
mkdir -p "$MOCK_BIN"
ln -s "$HERE/testdata/mock-adb-cue-helper.sh" "$MOCK_BIN/adb"

REPORT="$TEMP_DIR/report.tsv"
PATH="$MOCK_BIN:$PATH" "$HERE/soak-cue-helper.sh" 1 1 "$REPORT" >/dev/null

header="$(sed -n '1p' "$REPORT")"
row="$(sed -n '2p' "$REPORT")"
case "$header" in
  *$'pss_kb\trss_kb\tthreads\tthermal\tframes\tframe_age_ms\tfps\tcontent_width\tcontent_height\tvisible\ttarget_focused\ttarget') ;;
  *) echo "missing report columns: $header" >&2; exit 1 ;;
esac
# Every value comes from the Companion's versioned status (companion-status-v1)
# except memory and threads, which come from the platform.
case "$row" in
  *$'7007\t51200\t64000\t7\tNONE\t18234\t12\t59.8\t2400\t1080\t1\t1\tcom.scottgames.fnaf2') ;;
  *) echo "unexpected parsed row: $row" >&2; exit 1 ;;
esac

if PATH="$MOCK_BIN:$PATH" "$HERE/soak-cue-helper.sh" 1 1 "$REPORT" >/dev/null 2>&1; then
  echo "existing reports must not be overwritten" >&2
  exit 1
fi

echo "cue-helper soak tests passed"
