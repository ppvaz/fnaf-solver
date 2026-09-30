#!/bin/bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SELECTOR="$HERE/select-adb.sh"
MOCK_ADB_LIST=""
MOCK_ADB_STATE="device"

adb() {
  if [ "${1:-}" = "devices" ] && [ "${2:-}" = "-l" ]; then
    printf '%s\n' "$MOCK_ADB_LIST"
    return 0
  fi
  if [ "${1:-}" = "-s" ] && [ "${3:-}" = "get-state" ]; then
    printf '%s\n' "$MOCK_ADB_STATE"
    return 0
  fi
  if [ "${1:-}" = "shell" ] && [ "${2:-}" = "wm" ] && [ "${3:-}" = "size" ]; then
    printf '%s\n' "${MOCK_ADB_SIZE:-Physical size: 1080x2400}"
    return 0
  fi
  echo "unexpected mock adb invocation: $*" >&2
  return 1
}

assert_selected() {
  local expected=$1 listing=$2 actual
  actual=$(
    unset ANDROID_SERIAL
    MOCK_ADB_LIST=$listing
    . "$SELECTOR" 2>/dev/null
    printf '%s' "$ANDROID_SERIAL"
  )
  [ "$actual" = "$expected" ] || {
    echo "expected $expected, selected $actual" >&2
    exit 1
  }
}

USB_LINE='FAKE0001 device usb:338690048X product:bogota model:moto_g56_5G'
WIFI_LINE='192.168.0.2:5555 device product:bogota model:moto_g56_5G'
BOTH_LIST=$'List of devices attached\n'"$USB_LINE"$'\n'"$WIFI_LINE"
WIFI_LIST=$'List of devices attached\n'"$WIFI_LINE"

assert_selected FAKE0001 "$BOTH_LIST"
assert_selected 192.168.0.2:5555 "$WIFI_LIST"

explicit=$(
  ANDROID_SERIAL=chosen-device
  MOCK_ADB_LIST='List of devices attached'
  . "$SELECTOR" 2>/dev/null
  printf '%s' "$ANDROID_SERIAL"
)
[ "$explicit" = chosen-device ] || { echo "explicit serial was replaced" >&2; exit 1; }

native_size=$(
  MOCK_ADB_LIST="$USB_LINE" MOCK_ADB_SIZE='Physical size: 1080x2400'
  . "$SELECTOR" 2>/dev/null
  fnaf_resolve_screenrecord_size native
)
[ "$native_size" = 2400x1080 ] || {
  echo "native screenrecord size was not resolved in landscape order: $native_size" >&2
  exit 1
}

explicit_size=$(
  MOCK_ADB_LIST="$USB_LINE"
  . "$SELECTOR" 2>/dev/null
  fnaf_resolve_screenrecord_size 1280x576
)
[ "$explicit_size" = 1280x576 ] || {
  echo "explicit derived screenrecord size was not preserved: $explicit_size" >&2
  exit 1
}

ambiguous_output=""
if ambiguous_output=$( (
  unset ANDROID_SERIAL
  MOCK_ADB_LIST=$'List of devices attached\n'"$USB_LINE"$'\nUSB2 device usb:2 model:second'
  . "$SELECTOR"
) 2>&1 ); then
  echo "multiple USB devices should be rejected" >&2
  exit 1
fi
case "$ambiguous_output" in
  *"multiple ready USB ADB devices"*) ;;
  *) echo "missing ambiguous-USB diagnostic: $ambiguous_output" >&2; exit 1 ;;
esac

missing_output=""
if missing_output=$( (
  unset ANDROID_SERIAL
  MOCK_ADB_LIST=$'List of devices attached\nemulator-5554 device product:sdk'
  . "$SELECTOR"
) 2>&1 ); then
  echo "non-phone transports should not be an implicit fallback" >&2
  exit 1
fi
case "$missing_output" in
  *"no ready USB or wireless ADB device"*) ;;
  *) echo "missing no-device diagnostic: $missing_output" >&2; exit 1 ;;
esac

echo "select-adb tests passed"
