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
  *$'pss_kb\trss_kb\tthreads\tthermal_status\tstatus_age_s\tvisual_seq'*) ;;
  *) echo "missing report columns: $header" >&2; exit 1 ;;
esac
# status_age_s is the soak's epoch minus the mock logcat's `date +%s` stamp,
# which is taken later: a second boundary between the two reads gives -1.
# push-gate met exactly that on 2026-09-25; the soak itself accepts -2..5.
case "$row" in
  *$'7007\t51200\t64000\t7\t0\t0\t120\t1500\t2400\t1080\t1\t1\tFNAF2_NIGHT') ;;
  *$'7007\t51200\t64000\t7\t0\t-1\t120\t1500\t2400\t1080\t1\t1\tFNAF2_NIGHT') ;;
  *) echo "unexpected parsed row: $row" >&2; exit 1 ;;
esac

if PATH="$MOCK_BIN:$PATH" "$HERE/soak-cue-helper.sh" 1 1 "$REPORT" >/dev/null 2>&1; then
  echo "existing reports must not be overwritten" >&2
  exit 1
fi

echo "cue-helper soak tests passed"
