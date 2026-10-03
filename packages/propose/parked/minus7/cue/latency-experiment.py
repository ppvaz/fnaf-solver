#!/usr/bin/env python3
"""Run and analyse the phone -> external-audio latency experiment.

The phone remains the game/display source.  The configured external receiver
is the temporary A2DP endpoint and authoritative PCM consumer.  This command owns the boring
parts of a run so that a session is not reconstructed from shell history:

  packages/propose/parked/minus7/cue/latency-experiment.py preflight --connect
  packages/propose/parked/minus7/cue/latency-experiment.py run ...        # retired with Companion 0.2.0
  packages/propose/parked/minus7/cue/latency-experiment.py analyze /path/to/session

``run`` requires FNaF 2 to be focused and the Companion to be running.  It
does not launch either application or inject game input.  During the run,
produce the event being measured in the game (the default analysis pairs the
BB vent arrival's bright->dark visual transition with sample 17's bang).

Raw game audio is never written inside the repository.  The session directory
contains the WAV/RAW outside the repository, the visual TSV, clock samples,
authority/bridge logs, a captured fact sidecar, and a JSON report.  If the reference samples are absent,
the run still records evidence and reports ``analysis=NOT_RUN`` instead of
silently pretending that no cue occurred.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import pathlib
import re
import select
import signal
import shutil
import statistics
import subprocess
import sys
import threading
import time


HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[4]


def default_mac() -> str | None:
    """The phone's Bluetooth address: FNAF_BT_MAC, else the untracked local profile's btMac.

    The order local-profile.ts's btMac() reads them in; the handset's address is
    not committed (ADR 0002 decision 8)."""
    mac = os.environ.get("FNAF_BT_MAC")
    if mac:
        return mac
    try:
        value = json.loads((REPO / "tools/device/local-profile.json").read_text(encoding="utf-8")).get("btMac")
    except (OSError, ValueError, AttributeError):
        return None
    return value if isinstance(value, str) else None
QUERY = REPO / "packages/play/bin/companion/query-companion.sh"
AUTHORITY = HERE / "audio-authority.py"
COLLECT_FACTS = HERE / "collect-facts.py"
DEFAULT_REFS = pathlib.Path("/private/tmp/fnaf2-cue-refs")
DEFAULT_OUT = pathlib.Path.home() / "fnaf-apks" / "fnaf2-latency-experiments"
PCM_RATE = 48_000
PCM_CHANNELS = 2
PCM_BYTES_PER_SAMPLE = 4  # BlueALSA S24_LE in a 32-bit container.
PCM_BYTES_PER_FRAME = PCM_CHANNELS * PCM_BYTES_PER_SAMPLE
READ_BYTES = PCM_BYTES_PER_FRAME * 480  # at most 10 ms per host read
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$")
MIN_REPEATED_EVENTS = 3


def mono_ns() -> int:
    return time.monotonic_ns()


def fail(message: str) -> "NoReturn":
    raise RuntimeError(message)


def run(command: list[str], *, timeout: float = 15.0) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, text=True, capture_output=True,
                              timeout=timeout, check=False)
    except FileNotFoundError as error:
        fail("missing command: %s" % error.filename)
    except subprocess.TimeoutExpired:
        fail("command timed out: %s" % " ".join(command))


def parse_snapshot(text: str) -> int:
    if "visual=OBSERVED" not in text:
        fail("Companion returned no observed visual snapshot: %s" % text.strip())
    match = re.search(r"snapshotNs=(\d+)", text)
    if not match:
        fail("Companion response has no snapshotNs: %s" % text.strip())
    return int(match.group(1))


def helper_snapshot() -> str:
    result = run([str(QUERY), "loopback"], timeout=25)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        fail("visual preflight failed: %s" % detail)
    return result.stdout.strip()


def sync_clock(count: int = 7) -> dict:
    """Estimate device-monotonic minus host-monotonic with NTP-style bounds."""
    samples = []
    for _ in range(count):
        before = mono_ns()
        result = run([str(QUERY), "loopback"], timeout=25)
        after = mono_ns()
        if result.returncode != 0:
            continue
        try:
            device_ns = parse_snapshot(result.stdout)
        except RuntimeError:
            continue
        midpoint = (before + after) // 2
        samples.append({
            "host_before_ns": before,
            "host_after_ns": after,
            "host_mid_ns": midpoint,
            "device_ns": device_ns,
            "rtt_ns": after - before,
            "offset_device_minus_host_ns": device_ns - midpoint,
        })
    if not samples:
        fail("could not synchronize host and Companion monotonic clocks")
    selected = min(samples, key=lambda item: item["rtt_ns"])
    return {
        "clock_domain": "host_monotonic_ns / helper_monotonic_ns",
        "method": "midpoint of host request round trip; selected minimum RTT",
        "samples": samples,
        "selected": selected,
    }


def clock_offset_at_device(sync: dict, device_ns: int) -> int:
    """Interpolate the measured device-host offset at a device timestamp."""
    samples = sorted(sync["samples"], key=lambda item: item["device_ns"])
    if len(samples) == 1:
        return samples[0]["offset_device_minus_host_ns"]
    if device_ns <= samples[0]["device_ns"]:
        return samples[0]["offset_device_minus_host_ns"]
    if device_ns >= samples[-1]["device_ns"]:
        return samples[-1]["offset_device_minus_host_ns"]
    for left, right in zip(samples, samples[1:]):
        if left["device_ns"] <= device_ns <= right["device_ns"]:
            span = right["device_ns"] - left["device_ns"]
            frac = (device_ns - left["device_ns"]) / float(span or 1)
            lo = left["offset_device_minus_host_ns"]
            hi = right["offset_device_minus_host_ns"]
            return round(lo + frac * (hi - lo))
    return sync["selected"]["offset_device_minus_host_ns"]


def device_to_host_ns(sync: dict, device_ns: int) -> int:
    return device_ns - clock_offset_at_device(sync, device_ns)


def merge_clocks(*clocks: dict | None) -> dict | None:
    samples = []
    for clock in clocks:
        if clock:
            samples.extend(clock.get("samples", []))
    if not samples:
        return None
    samples.sort(key=lambda item: item["device_ns"])
    return {
        "clock_domain": "host_monotonic_ns / helper_monotonic_ns",
        "method": "merged NTP-style midpoint samples from session start/end",
        "samples": samples,
        "selected": min(samples, key=lambda item: item["rtt_ns"]),
    }


def bluetooth_connected(mac: str) -> bool:
    result = run(["bluetoothctl", "info", mac])
    return bool(re.search(r"^\s*Connected:\s+yes\s*$", result.stdout,
                          re.MULTILINE))


def try_connect(mac: str, wait_s: float = 15.0) -> bool:
    result = run(["bluetoothctl", "connect", mac], timeout=20)
    if result.returncode != 0 and "InProgress" not in result.stdout + result.stderr:
        return False
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        if bluetooth_connected(mac):
            return True
        time.sleep(0.5)
    return bluetooth_connected(mac)


def route_check(mac: str) -> tuple[bool, str]:
    result = run([sys.executable, str(AUTHORITY), "--check", "--mac", mac])
    text = (result.stdout or result.stderr).strip()
    return result.returncode == 0, text


def preflight(mac: str, connect: bool = False) -> dict:
    required = ["adb", "bluetoothctl", "bluealsa-cli", "ffmpeg"]
    missing = [name for name in required if shutil.which(name) is None]
    if missing:
        fail("missing required commands: %s" % ", ".join(missing))
    if not QUERY.is_file():
        fail("missing visual query tool: %s" % QUERY)
    if not AUTHORITY.is_file():
        fail("missing audio authority: %s" % AUTHORITY)

    adb = run(["adb", "get-state"])
    if adb.returncode != 0 or adb.stdout.strip() != "device":
        fail("ADB has no usable phone; run `adb devices -l`")

    bt_before = bluetooth_connected(mac)
    if not bt_before and connect:
        bt_before = try_connect(mac)
    if not bt_before:
        fail("Bluetooth phone is not connected (%s); pair/select the configured receiver "
             "as the phone's audio output, or rerun with --connect" % mac)

    ready, route = route_check(mac)
    if not ready:
        fail("BlueALSA A2DP route is not ready: %s" % route)

    snapshot = helper_snapshot()
    return {
        "adb": adb.stdout.strip(),
        "bluetooth_mac": mac,
        "bluetooth_connected": True,
        "audio_route": route,
        "visual_snapshot": snapshot,
    }


def monitor_process_exists() -> bool:
    if shutil.which("pgrep") is None:
        return False
    return subprocess.run(["pgrep", "-x", "bluealsa-aplay"],
                          stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL).returncode == 0


def stop_monitor(mac: str) -> str | bool:
    """Release BlueALSA's exclusive PCM and remember how to restore audio."""
    service_active = False
    if shutil.which("systemctl") is not None:
        service_active = subprocess.run(
            ["systemctl", "is-active", "--quiet", "bluealsa-aplay.service"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
        if service_active:
            subprocess.run(["systemctl", "stop", "bluealsa-aplay.service"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           check=False)
            time.sleep(0.3)
            if not monitor_process_exists():
                return "systemd"

    if monitor_process_exists() and shutil.which("pkill") is not None:
        subprocess.run(["pkill", "-x", "bluealsa-aplay"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(0.3)
        if not monitor_process_exists():
            return True
        fail("could not release bluealsa-aplay's exclusive PCM")
    return False


def restore_monitor(mac: str, was_running: str | bool) -> None:
    if not was_running:
        return
    if was_running == "systemd" and shutil.which("systemctl") is not None:
        subprocess.run(["systemctl", "start", "bluealsa-aplay.service"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       check=False)
        return
    if shutil.which("bluealsa-aplay") is None or monitor_process_exists():
        return
    subprocess.Popen(["bluealsa-aplay", "--profile-a2dp", "--volume=software", mac],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def write_wav_from_raw(raw_path: pathlib.Path, wav_path: pathlib.Path) -> None:
    """Use the same S24-in-S32 -> 16-bit conversion as capture-bt-audio.sh."""
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
               "-f", "s32le", "-ar", str(PCM_RATE), "-ac", str(PCM_CHANNELS),
               "-i", str(raw_path), "-af", "volume=256", str(wav_path)]
    result = run(command, timeout=60)
    if result.returncode != 0:
        fail("ffmpeg could not create %s: %s" % (wav_path, result.stderr.strip()))


def stop_process(process: subprocess.Popen | None, timeout: float = 4.0) -> None:
    """Stop a child through its Python cleanup path before using SIGTERM."""
    if process is None or process.poll() is not None:
        return
    try:
        process.send_signal(signal.SIGINT)
        process.wait(timeout=timeout)
        return
    except (subprocess.TimeoutExpired, OSError):
        pass
    try:
        process.terminate()
        process.wait(timeout=1.0)
        return
    except (subprocess.TimeoutExpired, OSError):
        pass
    try:
        process.kill()
        process.wait(timeout=1.0)
    except (subprocess.TimeoutExpired, OSError):
        pass


def wait_for_path(path: pathlib.Path, process: subprocess.Popen,
                  timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists():
            return
        if process.poll() is not None:
            fail("audio authority exited before creating %s" % path)
        time.sleep(0.05)
    fail("audio authority did not create %s" % path)


def logged_process(command: list[str], log_path: pathlib.Path,
                   handles: list[object]) -> subprocess.Popen:
    handle = log_path.open("x")
    handles.append(handle)
    return subprocess.Popen(command, stdout=handle, stderr=subprocess.STDOUT,
                            start_new_session=True)


def authority_capture_result(run_dir: pathlib.Path) -> dict:
    metadata_path = run_dir / "audio.raw.meta.json"
    raw_path = run_dir / "audio.raw"
    if not metadata_path.is_file():
        return {"status": "error", "error": "authority metadata missing",
                "raw": str(raw_path)}
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return {"status": "error", "error": "invalid authority metadata: %s" % error,
                "raw": str(raw_path)}
    result = dict(metadata)
    result["raw"] = str(raw_path)
    result["wav"] = str(run_dir / "audio.wav")
    if metadata.get("status") != "complete" or metadata.get("frames", 0) <= 0:
        result["status"] = "error"
        result.setdefault("error", "authority captured no complete PCM")
        return result
    write_wav_from_raw(raw_path, run_dir / "audio.wav")
    result["status"] = "complete"
    return result


def dump_helper_log(path: pathlib.Path) -> None:
    result = run(["adb", "logcat", "-d", "-v", "brief", "-s",
                  "FnafCueHelper:I", "*:S"], timeout=20)
    text = result.stdout or result.stderr or ""
    path.write_text(text, encoding="utf-8")


def capture_a2dp(mac: str, run_dir: pathlib.Path, seconds: float,
                 started: threading.Event, stop: threading.Event,
                 result_box: dict) -> None:
    raw_path = run_dir / "audio.raw"
    wav_path = run_dir / "audio.wav"
    pcm = "/org/bluealsa/hci0/dev_%s/a2dpsnk/source" % mac.replace(":", "_")
    monitor_was_running = False
    proc = None
    first_before = None
    first_after = None
    total_bytes = 0
    nonzero_bytes = 0
    start_ns = None
    try:
        monitor_was_running = stop_monitor(mac)
        start_ns = mono_ns()
        result_box["capture_start_ns"] = start_ns
        proc = subprocess.Popen(["bluealsa-cli", "open", pcm], stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL)
        started.set()
        deadline = start_ns + int(seconds * 1e9)
        with raw_path.open("xb") as raw:
            while not stop.is_set() and mono_ns() < deadline:
                remaining = max(0.001, (deadline - mono_ns()) / 1e9)
                readable, _, _ = select.select([proc.stdout], [], [], min(0.1, remaining))
                if not readable:
                    if proc.poll() is not None:
                        fail("bluealsa-cli ended before capture deadline")
                    continue
                before = mono_ns()
                block = os.read(proc.stdout.fileno(), READ_BYTES)
                after = mono_ns()
                if not block:
                    fail("bluealsa-cli returned an empty PCM stream")
                if first_before is None:
                    first_before, first_after = before, after
                raw.write(block)
                total_bytes += len(block)
                nonzero_bytes += sum(1 for value in block if value)
        proc.terminate()
        proc.wait(timeout=2)
        if total_bytes == 0:
            fail("A2DP PCM capture contained no frames")
        complete_bytes = total_bytes - (total_bytes % PCM_BYTES_PER_FRAME)
        if complete_bytes != total_bytes:
            with raw_path.open("r+b") as raw:
                raw.truncate(complete_bytes)
            total_bytes = complete_bytes
        write_wav_from_raw(raw_path, wav_path)
        sample_zero_estimate = ((first_before + first_after) // 2
                                if first_before is not None else None)
        result_box.update({
            "raw": str(raw_path),
            "wav": str(wav_path),
            "pcm_path": pcm,
            "rate": PCM_RATE,
            "channels": PCM_CHANNELS,
            "bytes_per_frame": PCM_BYTES_PER_FRAME,
            "frames": total_bytes // PCM_BYTES_PER_FRAME,
            "bytes": total_bytes,
            "nonzero_fraction": nonzero_bytes / float(max(1, total_bytes)),
            "capture_start_ns": start_ns,
            "first_read_before_ns": first_before,
            "first_read_after_ns": first_after,
            "sample_zero_host_ns_estimate": sample_zero_estimate,
            "sample_zero_uncertainty_ms": (
                (first_after - first_before) / 2e6
                if first_before is not None else None),
            "status": "complete",
        })
    except Exception as error:  # preserve the reason for the manifest
        result_box.update({"status": "error", "error": str(error),
                           "capture_start_ns": start_ns})
    finally:
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
        restore_monitor(mac, monitor_was_running)
        started.set()


def read_visual(path: pathlib.Path) -> list[tuple[int, int]]:
    rows = []
    if not path.is_file():
        return rows
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines()[1:]:
        fields = line.split("\t")
        if len(fields) < 4 or fields[3] != "OBSERVED":
            continue
        try:
            rows.append((int(fields[0]), int(fields[2])))
        except ValueError:
            continue
    return rows


def otsu(values: list[int]) -> tuple[int, float, float] | None:
    if not values or max(values) - min(values) < 8:
        return None
    best = None
    for cut in range(min(values) + 1, max(values)):
        dark = [v for v in values if v <= cut]
        bright = [v for v in values if v > cut]
        if not dark or not bright:
            continue
        wd, wb = len(dark) / len(values), len(bright) / len(values)
        score = wd * wb * (statistics.mean(dark) - statistics.mean(bright)) ** 2
        if best is None or score > best[0]:
            best = (score, cut, statistics.mean(dark), statistics.mean(bright))
    return None if best is None else (best[1], best[2], best[3])


def visual_arrivals(rows: list[tuple[int, int]], min_dwell_s: float = 2.0) -> dict:
    split = otsu([luma for _, luma in rows])
    if split is None:
        return {"state": "UNKNOWN", "reason": "luma-does-not-split", "events": []}
    threshold = split[0]
    runs: list[list[object]] = []
    for timestamp, luma in rows:
        dark = luma <= threshold
        if runs and runs[-1][0] == dark:
            runs[-1][2] = timestamp
        else:
            runs.append([dark, timestamp, timestamp])
    events = []
    for index in range(1, len(runs)):
        previous, current = runs[index - 1], runs[index]
        bright_s = (int(previous[2]) - int(previous[1])) / 1e9
        dark_s = (int(current[2]) - int(current[1])) / 1e9
        if (previous[0] is False and current[0] is True and
                bright_s >= min_dwell_s and dark_s >= min_dwell_s):
            events.append(int(current[1]))
    return {
        "state": "OBSERVED",
        "threshold": threshold,
        "dark_mean": round(split[1], 3),
        "bright_mean": round(split[2], 3),
        "snapshots": len(rows),
        "runs": len(runs),
        "events_device_ns": events,
    }


def audio_hits(wav_path: pathlib.Path, refs_dir: pathlib.Path, handle: int,
               threshold: float, prominence: float, confirm: float) -> dict:
    sys.path.insert(0, str(HERE))
    import correlate  # noqa: PLC0415
    import detect  # noqa: PLC0415
    import features  # noqa: PLC0415

    samples = features.load_window(wav_path)
    if not samples:
        return {"state": "UNKNOWN", "reason": "empty-audio", "hits": []}
    refs = detect.load_references(refs_dir)
    if handle not in refs:
        return {"state": "UNKNOWN", "reason": "missing-reference-%d" % handle,
                "hits": []}
    frames = features.band_frames(samples)
    levels = features.frame_levels(samples)
    excluded = detect.clipped_frames(samples)
    curve = detect.score_curve(frames, refs[handle])
    candidate_indexes = detect.peaks(curve, threshold, len(refs[handle]), excluded,
                                     prominence)
    reference_path = refs_dir / ("s%04d.wav" % handle)
    reference = features.load_window(reference_path)
    hits = []
    for index in candidate_indexes:
        proposed = index * features.HOP / float(features.RATE)
        score, onset = correlate.best_match(samples, reference, proposed)
        if score >= confirm:
            hits.append({
                "onset_s": round(onset, 6),
                "band_score": round(curve[index], 6),
                "correlation": round(score, 6),
                "level_db_above_background": round(
                    detect.level_above_background(levels, index, len(refs[handle])), 3),
            })
    return {
        "state": "OBSERVED",
        "handle": handle,
        "threshold": threshold,
        "prominence": prominence,
        "confirm": confirm,
        "candidates": len(candidate_indexes),
        "hits": hits,
    }


def authority_fact_hits(path: pathlib.Path, cue: str) -> dict:
    """Read the live shadow detections delivered by the external authority."""
    if not path.is_file():
        return {"state": "UNKNOWN", "reason": "audio-facts-missing", "hits": []}
    fact_type = "cue-" + cue
    records = 0
    hits = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as error:
        return {"state": "UNKNOWN", "reason": "audio-facts-unreadable: %s" % error,
                "hits": []}
    for line in lines:
        try:
            fact = json.loads(line)
        except json.JSONDecodeError:
            continue
        records += 1
        if (fact.get("type") != fact_type or fact.get("state") != "OBSERVED"
                or fact.get("value") is not True):
            continue
        timestamp_ms = fact.get("t_observed", fact.get("t_received"))
        if not isinstance(timestamp_ms, (int, float)):
            continue
        hits.append({
            "observed_ms": float(timestamp_ms),
            "confidence": float(fact.get("confidence", 0.0)),
            "correlation": float(fact.get("confidence", 0.0)),
        })
    return {"state": "OBSERVED", "fact_type": fact_type,
            "records": records, "hits": hits}


def fact_hits_as_audio_events(facts: dict, sample_zero: int | None) -> list[dict]:
    """Convert authority monotonic-ms observations to the pairing shape."""
    if sample_zero is None:
        return []
    events = []
    for hit in facts.get("hits", []):
        host_ns = round(hit["observed_ms"] * 1e6)
        events.append({
            "onset_s": (host_ns - sample_zero) / 1e9,
            "correlation": hit["correlation"],
            "authority_observed_ms": hit["observed_ms"],
        })
    return events


def pair_events(visual_events: list[int], audio_events: list[dict],
                sample_zero: int | None, sync: dict | None,
                match_window_ms: float) -> tuple[list[dict], list[int]]:
    if sample_zero is None or sync is None:
        return [], list(visual_events)
    candidates = []
    for visual_index, visual_device_ns in enumerate(visual_events):
        visual_host_ns = device_to_host_ns(sync, visual_device_ns)
        for hit_index, hit in enumerate(audio_events):
            audio_host_ns = sample_zero + round(hit["onset_s"] * 1e9)
            distance = abs(audio_host_ns - visual_host_ns)
            if distance <= match_window_ms * 1e6:
                candidates.append((distance, visual_index, hit_index,
                                   visual_device_ns, visual_host_ns, hit,
                                   audio_host_ns))

    # A detector hit is one physical observation.  Greedy nearest matching
    # over all admissible pairs prevents a single audio hit from being reused
    # for multiple visual transitions.  Ties resolve in input order, and the
    # final list is restored to visual order for readable reports.
    assigned_visual = set()
    assigned_audio = set()
    pairs = []
    for distance, visual_index, hit_index, visual_device_ns, visual_host_ns, hit, audio_host_ns \
            in sorted(candidates, key=lambda item: (item[0], item[1], item[2])):
        if visual_index in assigned_visual or hit_index in assigned_audio:
            continue
        assigned_visual.add(visual_index)
        assigned_audio.add(hit_index)
        pairs.append({
            "visual_device_ns": visual_device_ns,
            "visual_host_ns": visual_host_ns,
            "audio_onset_s": hit["onset_s"],
            "audio_host_ns": audio_host_ns,
            "audio_minus_visual_ms": round(
                (audio_host_ns - visual_host_ns) / 1e6, 3),
            "correlation": hit["correlation"],
            "audio_hit_index": hit_index,
            "distance_ms": round(distance / 1e6, 3),
        })
    pairs.sort(key=lambda item: item["visual_device_ns"])
    unmatched_visual = [event for index, event in enumerate(visual_events)
                        if index not in assigned_visual]
    return pairs, unmatched_visual


def percentile(values: list[float], quantile: float) -> float | None:
    """Linear-interpolated percentile, including the n=1 case."""
    if not values:
        return None
    if not 0.0 <= quantile <= 1.0:
        raise ValueError("quantile must be between 0 and 1")
    ordered = sorted(values)
    position = quantile * (len(ordered) - 1)
    lower = int(math.floor(position))
    upper = int(math.ceil(position))
    if lower == upper:
        return ordered[lower]
    fraction = position - lower
    return ordered[lower] + fraction * (ordered[upper] - ordered[lower])


def latency_statistics(pairs: list[dict], visual_events: list[int],
                       audio_hits: list[dict], unmatched_visual: list[int],
                       blackout_window_ms: float = 750.0) -> dict:
    """Summarize the requested T_audio_detect - T_visual_detect measure.

    ``jitter_ms`` is the p95-p50 tail spread of the signed latency samples;
    ``mad_jitter_ms`` is also retained as a robust scale estimate.  Audio hits
    that cannot be assigned to a visual event are counted as orphan/extra
    audio observations, while visual events without a unique audio assignment
    are counted as losses.  No loss is silently converted into a zero latency.
    """
    if not math.isfinite(blackout_window_ms) or blackout_window_ms <= 0:
        raise ValueError("blackout window must be positive")
    values = [float(pair["audio_minus_visual_ms"]) for pair in pairs]
    used_audio = {pair["audio_hit_index"] for pair in pairs}
    p50 = percentile(values, 0.50)
    p95 = percentile(values, 0.95)
    median = p50
    deviations = ([abs(value - median) for value in values]
                  if median is not None else [])
    mad = percentile(deviations, 0.50)
    visual_count = len(visual_events)
    audio_count = len(audio_hits)
    paired_count = len(pairs)
    unmatched_audio_count = audio_count - len(used_audio)
    residuals = ([value - median for value in values]
                 if median is not None else [])
    residual_abs = [abs(value) for value in residuals]
    positive_max = max((value for value in values if value > 0), default=0.0)
    if not values:
        temporal_decision = {
            "state": "UNKNOWN",
            "reason": "no-paired-events",
            "blackout_window_ms": blackout_window_ms,
        }
    else:
        loss_free = not unmatched_visual and unmatched_audio_count == 0
        sufficient_sample_count = len(values) >= MIN_REPEATED_EVENTS
        if not sufficient_sample_count:
            compensation_verdict = "insufficient-repeated-events"
        elif positive_max <= blackout_window_ms:
            compensation_verdict = ("supported-within-window" if loss_free
                                    else "within-window-but-losses")
        else:
            compensation_verdict = "not-guaranteed-within-window"
        temporal_decision = {
            "state": "OBSERVED",
            "blackout_window_ms": blackout_window_ms,
            "minimum_repeated_events": MIN_REPEATED_EVENTS,
            "sufficient_sample_count": sufficient_sample_count,
            "loss_free": loss_free,
            "recommended_timestamp_compensation_ms": round(-median, 3),
            "residual_p95_abs_ms": round(percentile(residual_abs, 0.95), 3),
            "residual_max_abs_ms": round(max(residual_abs), 3),
            "positive_delay_max_ms": round(positive_max, 3),
            "remaining_causal_budget_ms": round(
                blackout_window_ms - positive_max, 3),
            "timestamp_compensation": (
                compensation_verdict),
            "note": (
                "compensation shifts timestamps only; it cannot make an audio "
                "fact arrive before its physical/detector delay"),
        }
    return {
        "state": "OBSERVED" if values else "UNKNOWN",
        "definition": "T_audio_detect - T_visual_detect; positive means audio later",
        "sample_count": paired_count,
        "min_ms": round(min(values), 3) if values else None,
        "p50_ms": round(p50, 3) if p50 is not None else None,
        "p95_ms": round(p95, 3) if p95 is not None else None,
        "max_ms": round(max(values), 3) if values else None,
        "max_abs_ms": round(max(abs(value) for value in values), 3) if values else None,
        "jitter_ms": round(p95 - p50, 3) if p50 is not None and p95 is not None else None,
        "jitter_definition": "p95_ms - p50_ms",
        "mad_jitter_ms": round(1.4826 * mad, 3) if mad is not None else None,
        "minimum_repeated_events": MIN_REPEATED_EVENTS,
        "sufficient_sample_count": len(values) >= MIN_REPEATED_EVENTS,
        "temporal_decision": temporal_decision,
        "losses": {
            "visual_events": visual_count,
            "audio_hits": audio_count,
            "paired_events": paired_count,
            "visual_without_audio": len(unmatched_visual),
            "audio_without_visual": unmatched_audio_count,
            "visual_loss_rate": round(
                len(unmatched_visual) / visual_count, 6) if visual_count else None,
            "audio_orphan_rate": round(
                unmatched_audio_count / audio_count, 6) if audio_count else None,
            "pair_rate": round(paired_count / visual_count, 6) if visual_count else None,
        },
    }


def analyse_session(run_dir: pathlib.Path, refs: pathlib.Path,
                    handle: int, threshold: float, prominence: float,
                    confirm: float, sync: dict | None = None,
                    match_window_ms: float = 2_000.0,
                    blackout_window_ms: float = 750.0,
                    authority_cue: str = "bang") -> dict:
    visual = visual_arrivals(read_visual(run_dir / "visual.tsv"))
    audio_path = run_dir / "audio.wav"
    if not audio_path.is_file():
        return {"state": "NOT_RUN", "reason": "audio-wav-missing", "visual": visual}
    if not refs.is_dir():
        return {"state": "NOT_RUN", "reason": "reference-directory-missing",
                "visual": visual}
    audio = audio_hits(audio_path, refs, handle, threshold, prominence, confirm)
    metadata_path = run_dir / "audio.json"
    try:
        metadata = json.loads(metadata_path.read_text())
    except (OSError, json.JSONDecodeError):
        return {"state": "UNKNOWN", "reason": "audio-metadata-missing",
                "visual": visual, "audio": audio}
    if sync is None:
        clocks = []
        for clock_name in ("clock-start.json", "clock-end.json"):
            try:
                clocks.append(json.loads((run_dir / clock_name).read_text()))
            except (OSError, json.JSONDecodeError):
                pass
        sync = merge_clocks(*clocks)
    sample_zero = metadata.get("sample_zero_host_ns_estimate")
    pairs, unmatched_visual = pair_events(
        visual.get("events_device_ns", []), audio["hits"], sample_zero,
        sync, match_window_ms)
    statistics_report = latency_statistics(
        pairs, visual.get("events_device_ns", []), audio["hits"], unmatched_visual,
        blackout_window_ms)
    authority_facts = authority_fact_hits(run_dir / "audio-facts.jsonl", authority_cue)
    live_audio = fact_hits_as_audio_events(
        authority_facts, sample_zero)
    live_pairs, live_unmatched_visual = pair_events(
        visual.get("events_device_ns", []), live_audio, sample_zero, sync,
        match_window_ms)
    live_statistics = latency_statistics(
        live_pairs, visual.get("events_device_ns", []), live_audio,
        live_unmatched_visual, blackout_window_ms)
    primary_statistics = (live_statistics if live_audio else statistics_report)
    return {
        "state": "OBSERVED",
        "visual": visual,
        "audio": audio,
        "pairs": pairs,
        "unmatched_visual_events": unmatched_visual,
        "statistics": primary_statistics,
        "offline_statistics": statistics_report,
        "authority_facts": authority_facts,
        "live_fact_pairs": live_pairs,
        "live_fact_statistics": live_statistics,
        "statistics_source": ("authority-t_observed" if live_audio
                               else "offline-audio-onset"),
        "authority_cue": authority_cue,
        "match_window_ms": match_window_ms,
        "blackout_window_ms": blackout_window_ms,
        "interpretation": (
            "positive audio_minus_visual means audio detection was later; "
            "each visual event is paired with its nearest audio hit within "
            "the configured match window"
        ),
    }


def create_run_dir(out_dir: pathlib.Path, name: str) -> pathlib.Path:
    if not SAFE_NAME.fullmatch(name):
        fail("name must contain only letters, numbers, ., _, and -")
    # Keep the caller's spelling for the returned path (notably `/var` versus
    # macOS's `/private/var` symlink), while resolving only for the repository
    # safety check. This makes manifests reproducible without weakening it.
    requested = out_dir.expanduser()
    resolved = requested.resolve()
    if REPO == resolved or REPO in resolved.parents:
        fail("refusing to write game audio inside the repository: %s" % resolved)
    try:
        requested.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        fail("cannot create output directory %s: %s" % (out_dir, error))
    stamp = time.strftime("%Y%m%dT%H%M%S", time.localtime())
    base = requested / (stamp + "-" + name)
    candidate = base
    suffix = 2
    while candidate.exists():
        candidate = pathlib.Path(str(base) + "-" + str(suffix))
        suffix += 1
    candidate.mkdir()
    return candidate


def run_experiment(args: argparse.Namespace) -> int:
    """Retired with Companion 0.2.0 (2026-09-27).

    The live run fed the APK's authenticated audio-fact port through
    ``bridge-audio-authority.py`` and logged the ``GET`` single-pixel luma
    through ``query-companion.sh watch``. The Companion no longer accepts
    audio facts (its audio path was the ESP32 bench receiver, now removed) and
    the luma reducers are discontinued sensors, so a new session cannot be
    captured this way. ``analyze`` still reads every retained session.
    """
    print("latency-experiment: run is retired: the Companion (0.2.0) has no audio-fact "
          "port and no GET luma; reanalyse retained sessions with `analyze`", file=sys.stderr)
    return 2


def command_preflight(args: argparse.Namespace) -> int:
    result = preflight(args.mac, args.connect)
    print("ADB=READY")
    print("BLUETOOTH=READY mac=%s" % args.mac)
    print("AUDIO=%s" % result["audio_route"])
    print("VISUAL=READY")
    return 0


def command_analyze(args: argparse.Namespace) -> int:
    run_dir = pathlib.Path(args.session).expanduser().resolve()
    if not run_dir.is_dir():
        print("no session directory: %s" % run_dir, file=sys.stderr)
        return 2
    manifest_path = run_dir / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        print("invalid manifest: %s" % error, file=sys.stderr)
        return 2
    detector = manifest.get("detector", {})
    refs_arg = args.refs or manifest.get("refs") or str(DEFAULT_REFS)
    result = analyse_session(
        run_dir, pathlib.Path(refs_arg).expanduser(),
        args.handle if args.handle is not None else manifest.get("event_handle", 17),
        args.threshold if args.threshold is not None else detector.get("threshold", 0.45),
        args.prominence if args.prominence is not None else detector.get("prominence", 0.05),
        args.confirm if args.confirm is not None else detector.get("confirm", 0.35),
        sync=None,
        match_window_ms=(args.match_window_ms if args.match_window_ms is not None
                         else detector.get("match_window_ms", 2000.0)),
        blackout_window_ms=(args.blackout_window_ms if args.blackout_window_ms is not None
                            else detector.get("blackout_window_ms", 750.0)),
        authority_cue=manifest.get("authority", {}).get("cue", "bang"),
    )
    output = run_dir / "analysis.json"
    output.write_text(json.dumps(result, indent=2) + "\n")
    print("ANALYSIS %s" % output)
    print("VISUAL_EVENTS %d" % len(result.get("visual", {}).get("events_device_ns", [])))
    print("AUDIO_HITS %d" % len(result.get("audio", {}).get("hits", [])))
    print("PAIRS %d" % len(result.get("pairs", [])))
    print("LIVE_FACT_PAIRS %d" % len(result.get("live_fact_pairs", [])))
    stats = result.get("statistics", {})
    if stats.get("sample_count"):
        print("LATENCY p50=%.3fms p95=%.3fms max=%.3fms jitter=%.3fms" % (
            stats["p50_ms"], stats["p95_ms"], stats["max_ms"], stats["jitter_ms"]))
    losses = stats.get("losses", {})
    if losses:
        print("LOSSES visual_without_audio=%s audio_without_visual=%s pair_rate=%s" % (
            losses.get("visual_without_audio", "UNKNOWN"),
            losses.get("audio_without_visual", "UNKNOWN"),
            losses.get("pair_rate", "UNKNOWN")))
    return 0


def parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--mac", default=default_mac())
    common.add_argument("--connect", action="store_true",
                        help="try to connect the paired phone to the configured receiver")
    command = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = command.add_subparsers(dest="command", required=True)
    sub.add_parser("preflight", parents=[common], help="check phone, BT, audio, and visual paths")
    run_parser = sub.add_parser("run", parents=[common], help="capture both modalities and analyse")
    run_parser.add_argument("--seconds", type=float, default=60.0)
    run_parser.add_argument("--name", default="manual-event")
    run_parser.add_argument("--outdir", default=str(DEFAULT_OUT))
    run_parser.add_argument("--refs", default=str(DEFAULT_REFS))
    run_parser.add_argument("--handle", type=int, default=17)
    run_parser.add_argument("--threshold", type=float, default=0.45)
    run_parser.add_argument("--prominence", type=float, default=0.05)
    run_parser.add_argument("--confirm", type=float, default=0.35)
    run_parser.add_argument("--match-window-ms", type=float, default=2000.0,
                            help="maximum visual/audio pairing distance")
    run_parser.add_argument("--blackout-window-ms", type=float, default=750.0,
                            help="blackout response window used by the temporal decision")
    run_parser.add_argument("--authority-profile", default="g56-bluealsa-a2dp-v1",
                            help="calibration profile published by the external authority")
    run_parser.add_argument("--authority-socket",
                            help="explicit temporary authority socket (for a supervisor-coordinated pilot)")
    run_parser.add_argument("--authority-model",
                            help="external cue-model-v1 for shadow acoustic facts")
    run_parser.add_argument("--authority-cue", default="bang",
                            help="model cue name whose live fact timestamps are analysed")
    run_parser.add_argument("--shadow-cue", action="append", dest="shadow_cues", default=[],
                            help="explicitly enable a named authority template as shadow-only")
    analyse_parser = sub.add_parser("analyze", help="reanalyse an existing session")
    analyse_parser.add_argument("session")
    analyse_parser.add_argument("--refs", help="reference directory; defaults to the run manifest")
    analyse_parser.add_argument("--handle", type=int)
    analyse_parser.add_argument("--threshold", type=float)
    analyse_parser.add_argument("--prominence", type=float)
    analyse_parser.add_argument("--confirm", type=float)
    analyse_parser.add_argument("--match-window-ms", type=float)
    analyse_parser.add_argument("--blackout-window-ms", type=float)
    return command


def main() -> int:
    args = parser().parse_args()
    if not args.mac:
        raise SystemExit("no Bluetooth address: pass --mac, set FNAF_BT_MAC, or run node packages/play/bin/phone/local-profile.ts set-bt-mac <mac>")
    try:
        if args.command == "preflight":
            return command_preflight(args)
        if args.command == "run":
            if args.seconds <= 0 or args.seconds > 3600:
                print("--seconds must be in 1..3600", file=sys.stderr)
                return 2
            return run_experiment(args)
        return command_analyze(args)
    except RuntimeError as error:
        print("latency-experiment: %s" % error, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
