#!/bin/bash
# Select one phone transport for a caller that uses plain `adb` commands.
#
# An explicit ANDROID_SERIAL always wins. Otherwise prefer one healthy USB
# transport, falling back to one healthy wireless transport only when USB is
# absent. Never let adb's own "more than one device" failure happen midway
# through a timed trial.

fnaf_select_adb_transport() {
  local adb_bin="${ADB_BIN:-adb}" listing usb_serials wireless_serials candidates transport state

  if [ -n "${ANDROID_SERIAL:-}" ]; then
    state=$("$adb_bin" -s "$ANDROID_SERIAL" get-state 2>/dev/null || true)
    if [ "$state" != "device" ]; then
      echo "ANDROID_SERIAL is not a ready ADB device: $ANDROID_SERIAL" >&2
      return 1
    fi
    export ANDROID_SERIAL
    echo "ADB transport: $ANDROID_SERIAL (explicit)" >&2
    return 0
  fi

  if ! listing=$("$adb_bin" devices -l); then
    echo "could not list ADB devices" >&2
    return 1
  fi
  usb_serials=$(printf '%s\n' "$listing" | awk '
    $2 == "device" {
      for (i = 3; i <= NF; i++) {
        if ($i ~ /^usb:/) {
          print $1
          next
        }
      }
    }
  ')
  wireless_serials=$(printf '%s\n' "$listing" | awk '
    $2 == "device" {
      usb = 0
      for (i = 3; i <= NF; i++) if ($i ~ /^usb:/) usb = 1
      if (!usb && ($1 ~ /:/ || $1 ~ /^adb-/ || $1 ~ /_adb-tls-connect/)) print $1
    }
  ')

  if [ -n "$usb_serials" ]; then
    candidates=$usb_serials
    transport=USB
  else
    candidates=$wireless_serials
    transport=wireless
  fi

  # ADB serials contain no shell whitespace, so positional parameters provide
  # a Bash-3-compatible count without arrays or mapfile.
  set -- $candidates
  if [ "$#" -eq 0 ]; then
    echo "no ready USB or wireless ADB device found" >&2
    return 1
  fi
  if [ "$#" -ne 1 ]; then
    echo "multiple ready $transport ADB devices found; set ANDROID_SERIAL to one of:" >&2
    printf '  %s\n' "$@" >&2
    return 1
  fi

  ANDROID_SERIAL=$1
  export ANDROID_SERIAL
  state=$("$adb_bin" -s "$ANDROID_SERIAL" get-state 2>/dev/null || true)
  if [ "$state" != "device" ]; then
    echo "selected $transport ADB device is no longer ready: $ANDROID_SERIAL" >&2
    return 1
  fi
  echo "ADB transport: $ANDROID_SERIAL ($transport)" >&2
}

# Return the native landscape recording size for the selected display. Android
# reports the physical panel in its natural portrait order (1080x2400 on the
# calibrated Moto), while the game and every retained video are landscape.
# Keep the query here so every screenrecord caller uses the same device fact;
# callers may still pass an explicit smaller size only for a derived capture.
fnaf_native_screenrecord_size() {
  local adb_bin="${ADB_BIN:-adb}" sizes pair width height
  sizes=$("$adb_bin" shell wm size 2>/dev/null | tr -d '\r' || true)
  pair=$(printf '%s\n' "$sizes" | awk '
    /[0-9]+x[0-9]+/ {
      line = $0
      sub(/^.*: */, "", line)
      if (line ~ /^[0-9]+x[0-9]+$/) {
        split(line, dimensions, "x")
        width = dimensions[1] + 0
        height = dimensions[2] + 0
      }
    }
    END {
      if (width > 0 && height > 0)
        printf "%d %d\n", width, height
    }
  ')
  set -- $pair
  [ "$#" -eq 2 ] || {
    echo "could not resolve the selected device's native display size" >&2
    return 1
  }
  width=$1
  height=$2
  if [ "$width" -ge "$height" ]; then
    printf '%sx%s\n' "$width" "$height"
  else
    printf '%sx%s\n' "$height" "$width"
  fi
}

# Resolve `native` or validate an explicit WIDTHxHEIGHT override. This keeps
# the project-wide default native while making every reduced capture an
# intentional, visible exception at its call site.
fnaf_resolve_screenrecord_size() {
  local requested="${1:-native}"
  case "$requested" in
    native)
      fnaf_native_screenrecord_size
      return ;;
    *[!0-9x]*|x*|*x|*x*x*)
      echo "screenrecord size must be native or WIDTHxHEIGHT" >&2
      return 2 ;;
  esac
  local width="${requested%x*}" height="${requested#*x}"
  [ "$width" -gt 0 ] 2>/dev/null && [ "$height" -gt 0 ] 2>/dev/null || {
    echo "screenrecord size dimensions must be positive" >&2
    return 2
  }
  printf '%s\n' "$requested"
}

fnaf_select_adb_transport
