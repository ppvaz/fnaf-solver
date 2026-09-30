#!/bin/bash
# Run inside the toolchain container, from the external generated gamesrc dir.
# Requires Xvfb and glxinfo. CHOWDREN_* passes through to the patched runtime.
# CHOWDREN_TIMEOUT_SECONDS bounds the process even if the target frame is absent.
set -u
Xvfb :77 -screen 0 1280x800x24 -nolisten tcp >/tmp/chowdren-xvfb.log 2>&1 &
recompile_xpid=$!
trap 'kill "$recompile_xpid" 2>/dev/null || true' EXIT
export DISPLAY=:77 LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe ALSOFT_DRIVERS=null
for ((attempt=0; attempt<50; attempt++)); do
    glxinfo -B >/dev/null 2>&1 && break
    sleep 0.1
done
if ! glxinfo -B >/dev/null 2>&1; then
    echo 'Xvfb GL readiness failed' >&2
    exit 3
fi
timeout --kill-after=5 "${CHOWDREN_TIMEOUT_SECONDS:-120}" "${CHOWDREN_BINARY:-./build-h/Chowdren}"
