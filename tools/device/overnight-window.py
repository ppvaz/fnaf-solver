#!/usr/bin/env python3
"""Compatibility path: the overnight window moved to apps/lab/overnight-window.py (ADR 0002 layout).

A host's installed systemd units name this path in ExecStart, and they are
rendered once per host (`overnight-window.py units`). This forwards every
argument unchanged until the units are re-rendered from the new path; it is
registered in legacy-paths.json as lab.overnight-window-path.
"""
import os
import sys
from pathlib import Path

TARGET = Path(__file__).resolve().parents[2] / "apps" / "lab" / "overnight-window.py"
os.execv(sys.executable, [sys.executable, str(TARGET), *sys.argv[1:]])
