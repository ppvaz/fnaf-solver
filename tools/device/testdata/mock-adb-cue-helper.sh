#!/bin/bash
set -eu

if [ "${1:-}" = devices ] && [ "${2:-}" = -l ]; then
  printf '%s\n' 'List of devices attached' \
    'TEST123 device usb:1 product:test model:test_phone'
elif [ "${1:-}" = -s ] && [ "${3:-}" = get-state ]; then
  echo device
elif [ "${1:-}" = get-state ]; then
  echo device
elif [ "${1:-}" = shell ] && [ "${2:-}" = pidof ]; then
  # MOCK_HELPER_PID lets a test present a restarted helper process.
  echo "${MOCK_HELPER_PID:-7007}"
elif [ "${1:-}" = shell ] && [ "${2:-}" = dumpsys ] && [ "${3:-}" = meminfo ]; then
  echo 'TOTAL PSS: 51200 TOTAL RSS: 64000'
elif [ "${1:-}" = shell ] && [ "${2:-}" = dumpsys ] && [ "${3:-}" = package ]; then
  echo 'versionCode=26 versionName=2.0.7'
elif [ "${1:-}" = shell ] && [ "${2:-}" = cat ]; then
  printf '%s\n' 'Name: cue-helper' 'VmRSS: 64000 kB' 'Threads: 7'
elif [ "${1:-}" = shell ] && [ "${2:-}" = dumpsys ] && [ "${3:-}" = thermalservice ]; then
  echo 'Thermal Status: 0'
elif [ "${1:-}" = shell ] && [ "${2:-}" = dumpsys ] && [ "${3:-}" = cpuinfo ]; then
  echo '  2.0% 7007/com.ppvaz.fnafcompanion: 7007'
elif [ "${1:-}" = shell ] && [ "${2:-}" = dumpsys ] && [ "${3:-}" = window ]; then
  echo 'mCurrentFocus=Window{123 u0 com.scottgames.fnaf2/com.scottgames.fnaf2.Main}'
elif [ "${1:-}" = shell ] && [ "${2:-}" = sh ] && [ "${3:-}" = -s ]; then
  cat >/dev/null
  # MOCK_UNAUTHORIZED answers every exchange the way the helper answers a token
  # from an older capture generation (CaptureService.serveControlRequest).
  if [ "${MOCK_UNAUTHORIZED:-0}" = 1 ]; then echo 'ERROR unauthorized'; exit 0; fi
  # The latency verb sends PORT COUNT TOKEN, so an all-digit $6 is a sample
  # loop, not an exchange. Emit COUNT samples per group for the reporter.
  case "${6:-}" in
    [0-9]*)
      if ! printf '%s' "${6:-}" | grep -q '[^0-9]'; then
        i=0
        while [ "$i" -lt "$6" ]; do
          echo "read $((48000 + i))"
          echo "base $((22000 + i))"
          i=$((i + 1))
        done
        exit 0
      fi ;;
  esac
  # args: shell sh -s -- PORT VERB TOKEN [ARG]
  case "${6:-}/${8:-}" in
    # Keep these lines field-for-field with what the device sends: GET is
    # Fnaf2Legacy.snapshotLine(false, ...), READ is Fnaf2Legacy.readLine(),
    # OVERLAY is OverlayController.status(). Every consumer reads them as
    # k=v tokens; a mock that lags the device answers a shape no runner can
    # parse and lets a regression go green.
    GET/*) echo 'OK snapshotNs=9000 wallMs=1700000000000 visualCaptureNs=7800 nightOnsetImageNs=-1 visual=OBSERVED visualReason=none seq=121 ageUs=1200 content=2400x1080 visible=1 screen=FNAF2_NIGHT monitorUp=true monitorReason=native-stroke-monitor-up mask_button_downstroke=0 monitor_button_downstroke=140 watch=OFF spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa entries=12' ;;
    WATCH/status) echo 'OK watch=OFF spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa entries=12' ;;
    WATCH/*) echo 'OK watch=ACTIVE spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa entries=12' ;;
    READ/*|READ) echo 'OK read=OBSERVED spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa seq=122 snapshotNs=10000 ageUs=1200 cam01_button=0 cam02_button=0 cam03_button=0 cam04_button=0 cam05_button=194 cam06_button=0 cam07_button=0 cam08_button=0 cam09_button=0 cam10_button=0 cam11_button=0 cam12_button=0' ;;
    OVERLAY/*) echo 'OK overlay=READY teach=OFF f1=NONE f3=NONE f4=NONE' ;;
    STATUS/*) echo 'OK schema=companion-status-v1 app=0.2.0 code=16 session=3 capture=ON captureReason=none content=2400x1080 visible=1 frames=18234 frameAgeMs=12 fps=59.8 target=com.scottgames.fnaf2 game=fnaf2 targetBuild=26:2.0.7 legacy=fnaf2 regions=0 regionSamples=0 regionFrames=0 lesson=NONE lessonState=OFF panel=NONE clearance=UNCHECKED overlayPermission=GRANTED lease=NONE battery=64 charging=1 thermal=NONE foreground=OTHER audioProbe=OFF snapshotNs=9000 wallMs=1700000000000' ;;
    TARGET/com.scottgames.fnaf4) echo 'OK target=com.scottgames.fnaf4 game=fnaf4 legacy=OFF' ;;
    TARGET/*) echo 'OK target=com.scottgames.fnaf2 game=fnaf2 legacy=fnaf2' ;;
    LEASE/*) echo "OK lease=${8:-NONE}" ;;
    *) echo 'ERROR unknown-verb' ;;
  esac
elif [ "${1:-}" = exec-out ] && [ "${2:-}" = run-as ] && [ "${5:-}" = files/companion-endpoint.properties ]; then
  # MOCK_ENDPOINT_FILE serves the Companion's handshake file (companion-endpoint-v1);
  # MOCK_ENDPOINT_PID makes it belong to another process.
  if [ "${MOCK_ENDPOINT_FILE:-0}" = 1 ]; then
    printf 'schema=companion-endpoint-v1\napp=0.2.0\ncode=16\nsession=3\npid=%s\nport=49707\n' "${MOCK_ENDPOINT_PID:-7007}"
    printf 'socket=com.fnaf2.cuehelper.control.3\ntoken=%s\n' "${MOCK_ENDPOINT_TOKEN:-0123456789abcdef0123456789abcdef}"
  else
    echo 'run-as: cat: files/companion-endpoint.properties: No such file or directory' >&2
    exit 1
  fi
elif [ "${1:-}" = exec-out ] && [ "${2:-}" = run-as ]; then
  # 44-byte header plus a little payload, so the size guard is exercised.
  printf 'RIFF____WAVEfmt _________________________data____'
  printf '\0\0\1\0\2\0\3\0'
elif [ "${1:-}" = shell ] && [ "${2:-}" = run-as ]; then
  :
elif [ "${1:-}" = forward ] && [ "${2:-}" = --remove ]; then
  :
elif [ "${1:-}" = forward ]; then
  echo "${MOCK_FORWARD_PORT:?mock adb forward needs MOCK_FORWARD_PORT}"
elif [ "${1:-}" = logcat ]; then
  # MOCK_LOGCAT_ROTATED models the endpoint announcement having rotated out of
  # the 256 KiB ring buffer: the helper still logs, but no control= line is left.
  if [ "${MOCK_LOGCAT_ROTATED:-0}" = 1 ]; then
    echo "$(date +%s).000 I/FnafCueHelper(7007): RUNNING visual=OBSERVED seq=900 ageUs=1500 content=2400x1080 visible=1 screen=FNAF2_NIGHT"
  else
    echo "$(date +%s).000 I/FnafCueHelper(7007): RUNNING visual=OBSERVED seq=120 ageUs=1500 content=2400x1080 visible=1 screen=FNAF2_NIGHT control=READY port=49707 socket=com.fnaf2.cuehelper.control token=0123456789abcdef0123456789abcdef watch=OFF spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa entries=12 overlay=READY teach=OFF f1=NONE f3=NONE f4=NONE"
  fi
else
  echo "unexpected mock adb invocation: $*" >&2
  exit 1
fi
