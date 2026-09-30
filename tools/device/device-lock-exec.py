#!/usr/bin/env python3
"""Run one host device operation while holding the shared serial lease."""

from __future__ import annotations

import os
import signal
import subprocess
import sys

from companion_device_lock import DeviceBusy, DeviceLock


def main() -> int:
    if len(sys.argv) < 4 or sys.argv[2] != "--":
        print("usage: device-lock-exec.py SERIAL -- COMMAND [ARGS...]", file=sys.stderr)
        return 2
    serial = sys.argv[1]
    command = sys.argv[3:]
    try:
        with DeviceLock(serial) as lease:
            # `subprocess.run()` lets SIGINT/SIGTERM kill this lease holder
            # before its child can write its own terminal evidence. A bounded
            # game runner handles those signals by releasing HID, finalizing
            # audio, and (when explicitly requested) restarting the game.
            # Relay the signal and keep the lease until that cleanup returns.
            child: subprocess.Popen[str] | None = None

            def relay(signum: int, _frame: object) -> None:
                if child is not None and child.poll() is None:
                    child.send_signal(signum)

            original = {
                signal.SIGINT: signal.signal(signal.SIGINT, relay),
                signal.SIGTERM: signal.signal(signal.SIGTERM, relay),
            }
            try:
                child = subprocess.Popen(command, env={
                    **os.environ, "CUE_HELPER_LEASE_OWNER_PID": str(lease.owner_pid),
                })
                return child.wait()
            finally:
                for signum, previous in original.items():
                    signal.signal(signum, previous)
    except DeviceBusy as error:
        print(f"DEVICE HOLD reason=device-busy serial={serial} detail={error}",
              file=sys.stderr)
        return 75
    except OSError as error:
        print(f"DEVICE ERROR command-start-failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
