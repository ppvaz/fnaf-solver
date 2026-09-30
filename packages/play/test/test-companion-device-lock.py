#!/usr/bin/env python3
"""Cross-process-safe lease regression for multiple agents sharing one phone."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
SAFETY = (HERE / "../src/safety").resolve()
SPEC = importlib.util.spec_from_file_location("companion_device_lock", SAFETY / "companion_device_lock.py")
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

with tempfile.TemporaryDirectory(prefix="companion-device-lock-") as directory:
    previous = os.environ.get("CUE_HELPER_LOCK_DIR")
    os.environ["CUE_HELPER_LOCK_DIR"] = directory
    try:
        first = MODULE.DeviceLock("one-device")
        with first:
            assert first.path.parent == Path(directory)
            try:
                with MODULE.DeviceLock("one-device"):
                    raise AssertionError("second agent acquired the same device lease")
            except MODULE.DeviceBusy:
                pass
        with MODULE.DeviceLock("one-device"):
            pass

        child = subprocess.Popen(
            [sys.executable, str(HERE / "../src/safety/device-lock-exec.py"), "one-device", "--",
             sys.executable, "-c",
             "import signal, sys; "
             f"sys.path.insert(0, {str(SAFETY)!r}); "
             "from companion_device_lock import DeviceLock; "
             "lease = DeviceLock('one-device'); "
             "lease.__enter__(); lease.__exit__(); "
             "signal.signal(signal.SIGTERM, lambda signum, frame: "
             "(print('child-signal=SIGTERM', flush=True), sys.exit(0))[1]); "
             "print('child-lease-acquired', flush=True); signal.pause()"],
            env=os.environ.copy(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True)
        try:
            assert child.stdout is not None
            assert child.stdout.readline().strip() == "child-lease-acquired"
            try:
                with MODULE.DeviceLock("one-device"):
                    raise AssertionError("independent agent acquired the same device lease")
            except MODULE.DeviceBusy:
                pass
            # Copying the owner's PID does not let an unrelated process join
            # it. Nor can the descendant's close have released the real lock.
            previous_owner = os.environ.get("CUE_HELPER_LEASE_OWNER_PID")
            os.environ["CUE_HELPER_LEASE_OWNER_PID"] = str(child.pid)
            try:
                try:
                    with MODULE.DeviceLock("one-device"):
                        raise AssertionError("an unrelated process forged inherited ownership")
                except MODULE.DeviceBusy:
                    pass
            finally:
                if previous_owner is None:
                    os.environ.pop("CUE_HELPER_LEASE_OWNER_PID", None)
                else:
                    os.environ["CUE_HELPER_LEASE_OWNER_PID"] = previous_owner
        finally:
            child.terminate()
            assert child.stdout is not None
            assert child.stdout.readline().strip() == "child-signal=SIGTERM"
            assert child.wait(timeout=5) == 0
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)

        # flock is held by the kernel, so termination must not strand the
        # serial for future agents.
        with MODULE.DeviceLock("one-device"):
            pass

        # A campaign's capture setup borrows the lease five processes below
        # the wrapper (bash, node, setup.sh, setup.py), so the ancestry walk
        # must work past the parent on hosts with no /proc (macOS). `; true`
        # keeps sh from exec'ing python in its own place.
        grandchild = subprocess.run(
            [sys.executable, str(HERE / "../src/safety/device-lock-exec.py"), "one-device", "--",
             "sh", "-c",
             f"{sys.executable} -c \""
             f"import sys; sys.path.insert(0, {str(SAFETY)!r}); "
             "from companion_device_lock import DeviceLock; "
             "lease = DeviceLock('one-device'); lease.__enter__(); lease.__exit__(); "
             "print('grandchild-lease-acquired')\"; true"],
            env=os.environ.copy(), capture_output=True, text=True, timeout=30)
        assert grandchild.stdout.strip() == "grandchild-lease-acquired", (grandchild.stdout, grandchild.stderr)
    finally:
        if previous is None:
            os.environ.pop("CUE_HELPER_LOCK_DIR", None)
        else:
            os.environ["CUE_HELPER_LOCK_DIR"] = previous

# One lease per phone for the whole host: a worktree resolves the main
# checkout's state directory, so it contends with the main checkout's
# overnight window instead of taking a private lock file (until 2026-09-27
# each checkout had its own captures/cue-helper/locks). The FNaF 1 replay's
# JavaScript mirror must agree.
with tempfile.TemporaryDirectory(prefix="companion-worktree-") as directory:
    main = Path(directory) / "main"
    worktree = Path(directory) / "elsewhere" / "wt"
    gitdir = main / ".git" / "worktrees" / "wt"
    gitdir.mkdir(parents=True)
    worktree.mkdir(parents=True)
    (gitdir / "commondir").write_text("../..\n", encoding="utf-8")
    (worktree / ".git").write_text(f"gitdir: {gitdir}\n", encoding="utf-8")
    assert MODULE.main_checkout(worktree) == main.resolve(), MODULE.main_checkout(worktree)
    assert MODULE.main_checkout(main) == main
    plain = Path(directory) / "not-a-checkout"
    plain.mkdir()
    assert MODULE.main_checkout(plain) == plain
    mirror = subprocess.run(
        ["node", "--input-type=module", "-e",
         f"import {{ mainCheckout }} from {json.dumps((HERE / '../../../packages/play/games/fnaf1/fnaf1-winner.mjs').as_uri())};"
         "process.stdout.write(mainCheckout(process.argv[1]));", str(worktree)],
        check=True, text=True, stdout=subprocess.PIPE)
    # The same directory, however spelled: on macOS the temporary directory
    # sits under the /var -> /private/var link, which Python resolves and the
    # mirror does not; both open the same lock file.
    assert Path(mirror.stdout).resolve() == main.resolve(), mirror.stdout
    previous = {key: os.environ.get(key) for key in ("CUE_HELPER_LOCK_DIR", "CUE_HELPER_STATE_DIR")}
    os.environ.pop("CUE_HELPER_LOCK_DIR", None)
    os.environ["CUE_HELPER_STATE_DIR"] = str(main / "captures/cue-helper")
    try:
        assert MODULE.lock_path("one-device").parent == main / "captures/cue-helper/locks"
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

print("Companion lease: descendants can borrow, unrelated owners cannot, parent lock survives child exit, "
      "kernel-release, and one host-wide lease for every worktree passed")
