#!/bin/bash
# Use as CHOWDREN_BINARY with run-harness.sh. Read-only debugger instrumentation.
# CHOWDREN_DEBUG_BINARY is the rebuilt executable; CHOWDREN_GDB_SCRIPT is one
# of probes/*.gdb, matched to the patch checkpoint documented in README.md.
set -eu
exec gdb -q -nx --batch --return-child-result \
    -x "${CHOWDREN_GDB_SCRIPT:?set a checkpoint-matched GDB script}" \
    --args "${CHOWDREN_DEBUG_BINARY:?set the rebuilt executable}"
