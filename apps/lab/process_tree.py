"""Stop a lab runner and everything it started, with every wait bounded.

night-job.py stops a night runner that outlives its bound, companion-queue.py a
job, and overnight-window.py its queue child, the same way: SIGINT, then
SIGTERM, then SIGKILL, each followed by its grace. A runner's work runs in its
children (night-run.sh starts node, which starts adb), so the signals go to the
whole tree.

The tree is read from /proc on Linux and from one `ps` table where there is none
(macOS), as companion_device_lock.parent_pid reads a parent: one call lists
every process, where `pgrep -P` would cost one call per level. With neither, the
process itself is still signalled. Reading /proc unguarded once raised before
any signal was sent, and left a runner holding the phone past its bound.
"""

from __future__ import annotations

import os
import signal
import subprocess
from collections.abc import Callable, Sequence
from pathlib import Path

PROC = Path("/proc")
PS_COMMAND: tuple[str, ...] = ("ps", "-A", "-o", "pid=", "-o", "ppid=")
PS_TIMEOUT_S = 5.0
STOP_SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGKILL)


def parents_from_proc(proc: Path) -> dict[int, int] | None:
    """Each process's parent, from /proc; None where there is no /proc."""
    try:
        entries = os.listdir(proc)
    except OSError:
        return None
    parents: dict[int, int] = {}
    for entry in entries:
        if not entry.isdigit():
            continue
        try:
            stat = (proc / entry / "stat").read_text(encoding="utf-8")
            # comm may hold spaces and parentheses: fields resume after the last ')'.
            parents[int(entry)] = int(stat.rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            continue  # gone meanwhile
    return parents


def parents_from_ps(command: Sequence[str]) -> dict[int, int] | None:
    """Each process's parent, from one `ps` table; None where ps cannot answer."""
    try:
        result = subprocess.run(list(command), capture_output=True, text=True, timeout=PS_TIMEOUT_S, check=True)
    except (OSError, subprocess.SubprocessError):
        return None
    parents: dict[int, int] = {}
    for line in result.stdout.splitlines():
        fields = line.split()
        if len(fields) == 2 and fields[0].isdigit() and fields[1].isdigit():
            parents[int(fields[0])] = int(fields[1])
    return parents


def tree(pid: int, proc: Path | None = None, ps: Sequence[str] | None = None) -> list[int]:
    """`pid` and every descendant, `pid` first; just `pid` when no table can be read."""
    parents = parents_from_proc(PROC if proc is None else proc)
    if parents is None:
        parents = parents_from_ps(PS_COMMAND if ps is None else ps) or {}
    children: dict[int, list[int]] = {}
    for child, parent in parents.items():
        children.setdefault(parent, []).append(child)
    members: list[int] = []
    frontier = [pid]
    while frontier:
        current = frontier.pop()
        if current in members:
            continue
        members.append(current)
        frontier.extend(children.get(current, []))
    return members


def signal_tree(pid: int, signum: int) -> None:
    """Send `signum` to `pid` and its descendants; a member gone meanwhile is skipped."""
    for member in tree(pid):
        try:
            os.kill(member, signum)
        except (ProcessLookupError, PermissionError):
            pass


def stop(child: subprocess.Popen[str] | subprocess.Popen[bytes], send: Callable[[signal.Signals], None],
         graces: tuple[float, float, float], on_signal: Callable[[signal.Signals], None] | None = None,
         wait: Callable[[float], object] | None = None) -> bool:
    """SIGINT, SIGTERM, then SIGKILL through `send`, each followed by `wait(grace)`
    (by default the child's own exit). `send` raising ProcessLookupError means
    nothing is left to stop. True once the wait returns; False if the child
    outlived the last grace."""
    def await_exit(grace: float) -> object:
        return child.wait(timeout=grace)
    for signum, grace in zip(STOP_SIGNALS, graces):
        try:
            send(signum)
        except ProcessLookupError:
            return True
        if on_signal is not None:
            on_signal(signum)
        try:
            (wait or await_exit)(grace)
            return True
        except subprocess.TimeoutExpired:
            continue
    return False
