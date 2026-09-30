#!/usr/bin/env python3
"""Retain one BlueALSA PCM stream with receipt-time bounds.

``bluealsa-cli open`` writes raw PCM without timestamps. The former shell
recorder stamped its wall interval before the process had opened the PCM and
after its termination wait, so setup and teardown looked like lost Bluetooth
samples. This helper owns the child process and records the first and final
received PCM blocks. It also catches an interactive SIGINT/SIGTERM, terminates
the child in a private session, and writes a terminal state file before exit.

Receipt timing is not a cue clock: callers still need continuous known content
before they may treat its duration comparison as transport acceptance.
"""

from __future__ import annotations

import argparse
import json
import os
import selectors
import signal
import subprocess
import sys
import time
from pathlib import Path


def wall_ms() -> int:
    return time.time_ns() // 1_000_000


def mono_ms() -> int:
    return time.monotonic_ns() // 1_000_000


def write_json(path: Path, value: dict) -> None:
    """Atomically publish a state readers may inspect while this process runs."""
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pcm", required=True)
    parser.add_argument("--raw", required=True, type=Path)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--stderr", required=True, type=Path)
    parser.add_argument("--format", required=True, choices=("S16_LE", "S24_LE", "S24_3LE", "S32_LE"))
    parser.add_argument("--rate", required=True, type=int)
    parser.add_argument("--channels", required=True, type=int)
    parser.add_argument("--bluealsa-cli", default="bluealsa-cli")
    args = parser.parse_args()
    if not args.pcm.startswith("/org/bluealsa/"):
        parser.error("--pcm must name a BlueALSA object path")
    if not (1 <= args.rate <= 384_000 and 1 <= args.channels <= 8):
        parser.error("--rate/--channels are out of bounds")
    for path in (args.raw, args.state, args.stderr):
        if not path.is_absolute():
            parser.error(f"{path} must be an absolute path")
        path.parent.mkdir(parents=True, exist_ok=True)
    return args


def main() -> int:
    args = parse_args()
    width = 4 if args.format in {"S24_LE", "S24_3LE", "S32_LE"} else 2
    bytes_per_second = args.rate * args.channels * width
    state: dict = {
        "schema": "bt-audio-stream-v1",
        "status": "STARTING",
        "collectorPid": os.getpid(),
        "pcm": args.pcm,
        "format": args.format,
        "rate": args.rate,
        "channels": args.channels,
        "bytesPerSecond": bytes_per_second,
        "startedWallMs": wall_ms(),
        "startedMonotonicMs": mono_ms(),
        "firstPcmWallMs": None,
        "firstPcmMonotonicMs": None,
        "firstChunkBytes": 0,
        "lastPcmWallMs": None,
        "lastPcmMonotonicMs": None,
        "lastChunkBytes": 0,
        "rawBytes": 0,
        "chunks": 0,
        "maxInterChunkGapMs": 0,
    }
    write_json(args.state, state)

    requested_signal: str | None = None

    def stop(signum: int, _frame: object) -> None:
        nonlocal requested_signal
        if requested_signal is None:
            requested_signal = signal.Signals(signum).name

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)

    child: subprocess.Popen[bytes] | None = None
    selector = selectors.DefaultSelector()
    stderr_handle = args.stderr.open("wb")
    raw_handle = args.raw.open("wb")
    terminate_sent_at: int | None = None
    previous_chunk_mono: int | None = None
    previous_chunk_audio_ms: float | None = None
    # Keep one receipt timestamp within roughly 20 ms of the source clock.
    # A 64 KiB read can contain hundreds of milliseconds of already-buffered
    # PCM, making a healthy stream look like one large reception gap.
    read_size = max(1_024, min(8_192, bytes_per_second // 50))

    def consume(block: bytes) -> None:
        nonlocal previous_chunk_mono, previous_chunk_audio_ms
        arrived_wall, arrived_mono = wall_ms(), mono_ms()
        if state["firstPcmMonotonicMs"] is None:
            state["firstPcmWallMs"] = arrived_wall
            state["firstPcmMonotonicMs"] = arrived_mono
            state["firstChunkBytes"] = len(block)
        if previous_chunk_mono is not None:
            state["maxInterChunkGapMs"] = max(state["maxInterChunkGapMs"], arrived_mono - previous_chunk_mono)
            # This is diagnostic provenance, not an acceptance threshold: the
            # capture's duration comparison remains the continuity gate.
            excess = max(0.0, arrived_mono - previous_chunk_mono - (previous_chunk_audio_ms or 0.0))
            state["maxInterChunkExcessMs"] = max(state.get("maxInterChunkExcessMs", 0.0), round(excess, 3))
        previous_chunk_mono = arrived_mono
        previous_chunk_audio_ms = 1000.0 * len(block) / bytes_per_second
        raw_handle.write(block)
        raw_handle.flush()
        state["rawBytes"] += len(block)
        state["chunks"] += 1
        state["lastPcmWallMs"] = arrived_wall
        state["lastPcmMonotonicMs"] = arrived_mono
        state["lastChunkBytes"] = len(block)

    exit_code = 3
    try:
        child = subprocess.Popen(
            [args.bluealsa_cli, "open", args.pcm], stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=stderr_handle, bufsize=0,
            # Ctrl-C applies to the collector; it then stops this child and
            # retains the terminal byte bound instead of abandoning the run.
            start_new_session=True,
        )
        state.update({"status": "RUNNING", "sourcePid": child.pid})
        write_json(args.state, state)
        assert child.stdout is not None
        descriptor = child.stdout.fileno()
        os.set_blocking(descriptor, False)
        selector.register(descriptor, selectors.EVENT_READ)
        stream_closed = False
        while not stream_closed:
            now = mono_ms()
            if requested_signal and terminate_sent_at is None:
                terminate_sent_at = now
                if child.poll() is None:
                    child.terminate()
            if terminate_sent_at is not None and child.poll() is None and now - terminate_sent_at > 1500:
                child.kill()
            ready = selector.select(timeout=0.05)
            for _key, _mask in ready:
                while True:
                    try:
                        block = os.read(descriptor, read_size)
                    except BlockingIOError:
                        break
                    if not block:
                        stream_closed = True
                        break
                    consume(block)
            if child.poll() is not None and not ready:
                try:
                    block = os.read(descriptor, read_size)
                except BlockingIOError:
                    block = b""
                if block:
                    consume(block)
                else:
                    stream_closed = True
        if child.poll() is None:
            child.wait(timeout=2)
        state["sourceReturnCode"] = child.returncode
        first, last = state["firstPcmMonotonicMs"], state["lastPcmMonotonicMs"]
        if first is None or last is None or state["rawBytes"] == 0:
            state["status"] = "NO_PCM"
        else:
            # Receipt timestamps are taken after each read.  The first one
            # therefore marks the end of its first PCM block, while the last
            # one marks the end of its final block.  Put only the first block
            # back onto the left edge; adding the final block would double it
            # and makes unequal read sizes report false loss.
            state["sampleSpanMs"] = round((last - first) + 1000.0 * state["firstChunkBytes"] / bytes_per_second, 3)
            state["status"] = "STOPPED" if requested_signal else "ENDED"
        state["requestedSignal"] = requested_signal
        state["stoppedWallMs"] = wall_ms()
        state["stoppedMonotonicMs"] = mono_ms()
        exit_code = 0 if state["status"] in {"STOPPED", "ENDED"} else 3
    except BaseException as error:
        state["status"] = "FAILED"
        state["error"] = f"{type(error).__name__}: {error}"
        state["requestedSignal"] = requested_signal
        state["stoppedWallMs"] = wall_ms()
        state["stoppedMonotonicMs"] = mono_ms()
        if child is not None and child.poll() is None:
            child.kill()
    finally:
        try:
            selector.close()
            raw_handle.close()
            stderr_handle.close()
        finally:
            write_json(args.state, state)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
