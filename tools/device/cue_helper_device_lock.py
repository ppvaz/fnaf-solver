#!/usr/bin/env python3
"""Kernel-released per-device lease for safe Cue Helper host operations."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import socket
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def main_checkout(root: Path = ROOT) -> Path:
    """The main checkout of this repository, seen from it or from any worktree.

    A worktree's `.git` is a file naming its own git dir, whose `commondir`
    leads back to the main checkout's `.git`. Until 2026-09-27 the lease and
    the queue lived under each checkout's own `captures/`, so an agent in a
    worktree took a different lock file for the same phone than the main
    checkout's overnight window held, and enqueued into a queue no window read.
    """
    marker = root / ".git"
    try:
        if marker.is_file():
            text = marker.read_text(encoding="utf-8").strip()
            if text.startswith("gitdir:"):
                gitdir = Path(text.split(":", 1)[1].strip())
                if not gitdir.is_absolute():
                    gitdir = (root / gitdir).resolve()
                common = gitdir / "commondir"
                if common.is_file():
                    common_dir = (gitdir / common.read_text(encoding="utf-8").strip()).resolve()
                    if common_dir.name == ".git":
                        return common_dir.parent
    except OSError:
        pass
    return root


def state_dir() -> Path:
    """Host-wide Cue Helper state: the lease files, the queue, pending restores."""
    return Path(os.environ.get("CUE_HELPER_STATE_DIR", str(main_checkout() / "captures/cue-helper")))


DEFAULT_LOCK_DIR = state_dir() / "locks"


class DeviceBusy(RuntimeError):
    """Another process currently owns the device lease."""


def lock_dir() -> Path:
    return Path(os.environ.get("CUE_HELPER_LOCK_DIR", str(state_dir() / "locks")))


def lock_path(serial: str) -> Path:
    digest = hashlib.sha256(serial.encode("utf-8")).hexdigest()[:24]
    return lock_dir() / f"device-{digest}.lock"


def parent_pid(pid: int) -> int:
    """`pid`'s parent: from /proc on Linux, from `ps` where there is none (macOS)."""
    if Path("/proc").is_dir():
        # comm can contain spaces and parentheses; fields after its final
        # ')' begin with state, then PPID.
        stat = Path(f"/proc/{pid}/stat").read_text(encoding="utf-8")
        return int(stat.rsplit(")", 1)[1].split()[1])
    return int(subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)],
                              capture_output=True, text=True, check=True).stdout)


def inherited_owner(serial: str, text: str) -> int | None:
    """Borrow only an explicit lease held by a still-running ancestor.

    The wrapper keeps the kernel lock while child tools (notably capture
    setup) use it. An environment value alone cannot authorize another agent.
    """
    try:
        owner = json.loads(text)
        if not isinstance(owner, dict):
            return None
        expected = int(os.environ.get("CUE_HELPER_LEASE_OWNER_PID", "0"))
        if (expected <= 1 or owner.get("pid") != expected
                or owner.get("serial") != serial or owner.get("host") != socket.gethostname()):
            return None
        pid = os.getppid()
        seen = set()
        while pid > 1 and pid not in seen:
            if pid == expected:
                return expected
            seen.add(pid)
            pid = parent_pid(pid)
    except (OSError, ValueError, TypeError, subprocess.CalledProcessError):
        pass
    return None


class DeviceLock:
    """One non-blocking, process-safe lease; the kernel releases it on exit."""

    def __init__(self, serial: str):
        if not serial or any(character.isspace() for character in serial):
            raise ValueError("device serial must be a non-empty token")
        self.serial = serial
        self.path = lock_path(serial)
        self.handle = None
        self.owner_pid = os.getpid()

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            self.handle.seek(0)
            owner = self.handle.read().strip()
            self.handle.close()
            self.handle = None
            inherited = inherited_owner(self.serial, owner)
            if inherited is not None:
                self.owner_pid = inherited
                return self
            detail = f" owner={owner}" if owner else ""
            raise DeviceBusy(f"device {self.serial} is already leased{detail}") from error
        self.handle.seek(0)
        self.handle.truncate()
        json.dump({
            "serial": self.serial,
            "pid": os.getpid(),
            "host": socket.gethostname(),
            "acquiredAt": time.time(),
        }, self.handle, sort_keys=True)
        self.handle.flush()
        return self

    def __exit__(self, *_):
        if self.handle is None:
            return
        self.handle.seek(0)
        self.handle.truncate()
        self.handle.flush()
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        self.handle.close()
        self.handle = None
