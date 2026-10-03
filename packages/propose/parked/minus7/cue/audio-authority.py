#!/usr/bin/env python3
"""Live external audio authority for the FNaF 2 controller.

The phone is the A2DP source and an external receiver is the authoritative
audio observer.  The current backend owns one BlueALSA PCM reader and publishes bounded,
newline-delimited ``fact-message-v1`` messages to stdout and optionally to a
Unix stream socket.  It never sends audio through adb and never turns a
missing route into a negative cue claim.

Examples::

  packages/propose/parked/minus7/cue/audio-authority.py --check
  packages/propose/parked/minus7/cue/audio-authority.py --socket /tmp/fnaf2-audio.sock
  packages/propose/parked/minus7/cue/audio-authority.py --model /private/tmp/fnaf2-cues.txt

The model is the same ignored cue-model-v1 format exported for earlier
experiments.  A model is optional: without one the authority still publishes
route, level, and stream-health facts, but it publishes no cue detections.
The phase cue is enabled by model identity; other named templates require one
or more explicit ``--shadow-cue`` options for a timing experiment and remain
shadow facts only.
"""
import argparse
import base64
import collections
import hashlib
import json
import math
import os
import pathlib
import select
import socket
import struct
import subprocess
import sys
import time


FACT_SCHEMA = "fact-message-v1"
MAX_FACT_BYTES = 1024
PCM_RATE = 48_000
PCM_CHANNELS = 2
PCM_BYTES_PER_FRAME = 4 * PCM_CHANNELS
MODEL_RATE = 4_000
DECIMATION = PCM_RATE // MODEL_RATE
RAW_FRAMES_PER_READ = 4_800  # 100 ms
FACT_INTERVAL_MS = 1_000
DEFAULT_LATENCY_MIN_MS = 150
DEFAULT_LATENCY_MAX_MS = 250
DEFAULT_PROFILE = "g56-bluealsa-a2dp-v1"
DEFAULT_SOURCE = "audio-authority"
REPO = pathlib.Path(__file__).resolve().parents[5]


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


def monotonic_ms():
    return time.monotonic_ns() // 1_000_000


def pcm_path(mac):
    return "/org/bluealsa/hci0/dev_%s/a2dpsnk/source" % mac.replace(":", "_")


def bluealsa_running(info):
    """Return whether bluealsa-cli reports an active PCM producer."""
    for line in info.splitlines():
        key, separator, value = line.partition(":")
        if separator and key.strip().lower() == "running":
            return value.strip().lower() == "true"
    return False


def route_issue(path):
    """Return a stable route error, or None when PCM is actually running."""
    try:
        result = subprocess.run(
            ["bluealsa-cli", "info", path],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, check=False,
        )
    except OSError:
        return "bluealsa-cli-missing"
    if result.returncode != 0:
        return "a2dp-source-not-connected"
    if not bluealsa_running(result.stdout):
        # bluealsa-cli returns success for an existing transport even when its
        # producer is stopped. Treating that object as ready caused r10 to
        # start an authority that could never receive PCM.
        return "a2dp-stream-not-running"
    return None


def route_ready(path):
    return route_issue(path) is None


def route_status(path, mac):
    if not shutil_which("bluealsa-cli"):
        return "audio-route=UNKNOWN reason=bluealsa-cli-missing pcm=%s mac=%s" % (
            path, mac)
    issue = route_issue(path)
    if issue is None:
        return "audio-route=READY transport=bluealsa pcm=%s mac=%s" % (path, mac)
    return "audio-route=UNKNOWN reason=%s pcm=%s mac=%s" % (issue, path, mac)


def shutil_which(command):
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        candidate = pathlib.Path(directory) / command
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def fact_line(seq, fact_type, *, value=None, reason=None, confidence=1.0,
              source=DEFAULT_SOURCE, profile=DEFAULT_PROFILE, observed_ms=None,
              received_ms=None,
              latency_min=DEFAULT_LATENCY_MIN_MS,
              latency_max=DEFAULT_LATENCY_MAX_MS):
    if not isinstance(seq, int) or isinstance(seq, bool) or not 0 <= seq <= 0xffffffff:
        raise ValueError("seq must be an unsigned 32-bit integer")
    if not isinstance(fact_type, str) or not fact_type or len(fact_type) > 64:
        raise ValueError("fact type must be 1..64 characters")
    if not isinstance(source, str) or not source or len(source) > 64:
        raise ValueError("fact source must be 1..64 characters")
    if not isinstance(profile, str) or not profile or len(profile) > 96:
        raise ValueError("calibration profile must be 1..96 characters")
    if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) \
            or not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
        raise ValueError("confidence must be between 0 and 1")
    if not isinstance(latency_min, (int, float)) or not isinstance(latency_max, (int, float)) \
            or latency_min < 0 or latency_min > latency_max:
        raise ValueError("latency bounds must be ordered and non-negative")
    received_ms = monotonic_ms() if received_ms is None else received_ms
    if not isinstance(received_ms, (int, float)) or received_ms < 0:
        raise ValueError("received timestamp must be non-negative")
    if observed_ms is not None and (not isinstance(observed_ms, (int, float)) or observed_ms < 0):
        raise ValueError("observed timestamp must be non-negative")
    message = {
        "schema": FACT_SCHEMA,
        "seq": seq,
        "type": fact_type,
        "state": "OBSERVED" if reason is None else "UNKNOWN",
        "confidence": confidence,
        "source": source,
        "calibrationProfile": profile,
        "t_received": received_ms,
        "latencyMin": latency_min,
        "latencyMax": latency_max,
    }
    if reason is None:
        if not isinstance(value, (bool, int, float, str)):
            raise TypeError("fact values must be primitive")
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError("fact values must be finite")
        message["value"] = value
        if observed_ms is not None:
            message["t_observed"] = min(observed_ms, received_ms)
    else:
        message["reason"] = reason
    line = (json_dumps(message) + "\n").encode("utf-8")
    if len(line) > MAX_FACT_BYTES:
        raise ValueError("fact message exceeds 1024 bytes")
    return line


def json_dumps(value):
    # Compact and deterministic enough for the bounded wire contract.
    import json
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


class FactPublisher:
    def __init__(self, socket_path=None, stdout=True, source=DEFAULT_SOURCE):
        self.socket_path = pathlib.Path(socket_path) if socket_path else None
        self.stdout = stdout
        self.source = source
        self.server = None
        self.clients = set()
        self.seq = 0

    def start(self):
        if self.socket_path is None:
            return
        if self.socket_path.exists():
            if not self.socket_path.is_socket():
                raise RuntimeError("refusing to replace non-socket %s" % self.socket_path)
            self.socket_path.unlink()
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(str(self.socket_path))
        self.server.listen(8)
        self.server.setblocking(False)

    def sockets(self):
        return [self.server] if self.server is not None else []

    def accept(self, readable):
        if self.server is None or self.server not in readable:
            return
        while True:
            try:
                client, _ = self.server.accept()
            except BlockingIOError:
                return
            client.settimeout(0.1)
            self.clients.add(client)

    def publish(self, line):
        if self.stdout:
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()
        dead = []
        for client in self.clients:
            try:
                client.sendall(line)
            except OSError:
                dead.append(client)
        for client in dead:
            self.clients.discard(client)
            client.close()

    def fact(self, fact_type, **kwargs):
        kwargs.setdefault("source", self.source)
        line = fact_line(self.seq, fact_type, **kwargs)
        self.seq = (self.seq + 1) & 0xffffffff
        self.publish(line)

    def close(self):
        for client in list(self.clients):
            client.close()
        self.clients.clear()
        if self.server is not None:
            self.server.close()
        if self.socket_path is not None and self.socket_path.exists():
            self.socket_path.unlink()


def parse_model(path):
    """Read exported cue-model-v1 templates without importing app code."""
    lines = pathlib.Path(path).read_text(encoding="ascii").splitlines()
    if not lines or not lines[0].startswith("cue-model-v1 "):
        raise ValueError("model-header")
    header = dict(part.split("=", 1) for part in lines[0].split()[1:]
                  if "=" in part)
    profile = "external-" + header.get("calibration", "unknown")
    templates = []
    for line in lines[1:]:
        if not line.startswith("template "):
            continue
        fields = dict(part.split("=", 1) for part in line.split()[1:]
                      if "=" in part)
        try:
            raw = base64.b64decode(fields["pcm"], validate=True)
            pcm = struct.unpack("<%dh" % (len(raw) // 2), raw)
            threshold = float(fields["threshold"])
            handle = int(fields["id"])
        except (KeyError, ValueError, struct.error):
            raise ValueError("model-template")
        if not pcm or not any(pcm) or not 0.0 <= threshold <= 1.0:
            raise ValueError("model-template")
        templates.append({
            "cue": fields.get("cue", "cue"),
            "id": handle,
            "threshold": threshold,
            "pcm": tuple(pcm),
        })
    if not templates:
        raise ValueError("model-empty")
    digest = hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
    return profile, digest, templates


def normalized_correlation(window, template):
    if len(window) != len(template):
        return 0.0
    sum_window = sum(window)
    sum_template = sum(template)
    dot = 0.0
    window_energy = 0.0
    template_energy = 0.0
    for left, right in zip(window, template):
        left -= sum_window / len(window)
        right -= sum_template / len(template)
        dot += left * right
        window_energy += left * left
        template_energy += right * right
    if window_energy <= 0.0 or template_energy <= 0.0:
        return 0.0
    return max(-1.0, min(1.0, dot / math.sqrt(window_energy * template_energy)))


class LiveMatcher:
    def __init__(self, templates, shadow_cues=()):
        # Only the authoritative phase cue is enabled by default. A named
        # shadow cue is an explicit measurement opt-in; it is still just a
        # fact on the external link and cannot arm a controller action.
        enabled_shadow_cues = set(shadow_cues)
        self.templates = [item for item in templates
                          if item["id"] == 33 or item["cue"] in
                          ("wind", "wind-tick", "winding") or
                          item["cue"] in enabled_shadow_cues]
        self.maximum = max((len(item["pcm"]) for item in self.templates), default=0)
        self.samples = collections.deque(maxlen=self.maximum + MODEL_RATE // 4)
        self.last_event_ms = -10**12

    def accept(self, samples, now_ms):
        if not self.templates:
            return []
        self.samples.extend(samples)
        if len(self.samples) < self.maximum:
            return []
        source = tuple(self.samples)
        events = []
        for item in self.templates:
            size = len(item["pcm"])
            best = 0.0
            # At 4 kHz this bounded scan is cheap, and it prevents a chunk
            # boundary from hiding a short transient.
            for start in range(0, len(source) - size + 1, 8):
                score = normalized_correlation(source[start:start + size], item["pcm"])
                best = max(best, score)
            if best < item["threshold"] or now_ms - self.last_event_ms < 300:
                continue
            confidence = max(0.0, min(1.0,
                (best - item["threshold"]) / max(1e-9, 1.0 - item["threshold"])))
            events.append((item["cue"], best, confidence))
        if events:
            self.last_event_ms = now_ms
        return events


class AudioAuthority:
    def __init__(self, args):
        self.args = args
        self.path = pcm_path(args.mac)
        self.publisher = FactPublisher(args.socket, not args.quiet, args.source)
        self.pending = bytearray()
        self.downsample = []
        self.matcher = None
        self.profile = args.profile
        self.model_digest = None
        if args.model:
            profile, self.model_digest, templates = parse_model(args.model)
            self.matcher = LiveMatcher(templates, getattr(args, "shadow_cues", ()))
        self.last_health_ms = -10**12
        self.total_frames = 0
        self.last_rms = 0.0
        self.last_peak = 0.0
        raw_output = getattr(args, "raw_output", None)
        self.raw_path = pathlib.Path(raw_output).expanduser().resolve() \
            if raw_output else None
        self.raw_stream = None
        self.raw_bytes = 0
        self.raw_nonzero_bytes = 0
        self.first_read_before_ns = None
        self.first_read_after_ns = None
        if self.raw_path is not None:
            if self.raw_path == REPO or REPO in self.raw_path.parents:
                raise ValueError("refusing to write game audio inside the repository")
            self.raw_path.parent.mkdir(parents=True, exist_ok=True)

    def emit_unknown(self, fact_type, reason):
        self.publisher.fact(fact_type, reason=reason, confidence=0.0,
                            profile=self.profile, latency_min=self.args.latency_min,
                            latency_max=self.args.latency_max)

    def emit_health(self, ready, now_ms, reason=None):
        if now_ms - self.last_health_ms < FACT_INTERVAL_MS:
            return
        self.last_health_ms = now_ms
        if ready:
            self.publisher.fact("audio-route", value=True, confidence=1.0,
                                profile=self.profile,
                                latency_min=self.args.latency_min,
                                latency_max=self.args.latency_max)
            if self.total_frames:
                self.publisher.fact("audio-rms", value=round(self.last_rms, 6),
                                    confidence=1.0, profile=self.profile,
                                    latency_min=self.args.latency_min,
                                    latency_max=self.args.latency_max)
                self.publisher.fact("audio-peak", value=round(self.last_peak, 6),
                                    confidence=1.0, profile=self.profile,
                                    latency_min=self.args.latency_min,
                                    latency_max=self.args.latency_max)
        else:
            self.emit_unknown("audio-route", reason or "route-not-ready")

    def decode(self, raw):
        self.pending.extend(raw)
        frame_count = len(self.pending) // PCM_BYTES_PER_FRAME
        usable = frame_count * PCM_BYTES_PER_FRAME
        if not usable:
            return []
        data = self.pending[:usable]
        del self.pending[:usable]
        levels = []
        for offset in range(0, usable, PCM_BYTES_PER_FRAME):
            left, right = struct.unpack_from("<ii", data, offset)
            value = (left + right) / (2.0 * 8_388_608.0)
            levels.append(max(-1.0, min(1.0, value)))
        self.total_frames += frame_count
        self.last_rms = math.sqrt(sum(v * v for v in levels) / len(levels))
        self.last_peak = max((abs(v) for v in levels), default=0.0)
        self.downsample.extend(levels)
        output = []
        while len(self.downsample) >= DECIMATION:
            group = self.downsample[:DECIMATION]
            del self.downsample[:DECIMATION]
            output.append(round(sum(group) / DECIMATION * 32767.0))
        return output

    def run(self):
        process = None
        try:
            self.publisher.start()
            if self.raw_path is not None:
                self.raw_stream = self.raw_path.open("xb")
            while True:
                now_ms = monotonic_ms()
                if process is None:
                    issue = route_issue(self.path)
                    if issue is not None:
                        self.emit_health(False, now_ms, issue)
                        if self.args.once:
                            return 3
                        time.sleep(1.0)
                        continue
                    process = subprocess.Popen(
                        ["bluealsa-cli", "open", self.path],
                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                    )
                    self.emit_health(True, now_ms)
                readable, _, _ = select.select(
                    [process.stdout] + self.publisher.sockets(), [], [], 0.25)
                self.publisher.accept(readable)
                if process.stdout not in readable:
                    if self.args.once:
                        return 0
                    continue
                read_before_ns = time.monotonic_ns()
                raw = process.stdout.read(PCM_BYTES_PER_FRAME * RAW_FRAMES_PER_READ)
                read_after_ns = time.monotonic_ns()
                if not raw:
                    process.wait()
                    process = None
                    # A connected receiver may still have no PCM producer when
                    # the phone is silent. Rate-limit this condition exactly
                    # like other health facts; otherwise a fast EOF loop can
                    # flood the subscriber and the APK with UNKNOWN records.
                    self.emit_health(False, monotonic_ms(), "stream-ended")
                    if self.args.once:
                        return 3
                    time.sleep(1.0)
                    continue
                if self.first_read_before_ns is None:
                    self.first_read_before_ns = read_before_ns
                    self.first_read_after_ns = read_after_ns
                if self.raw_stream is not None:
                    self.raw_stream.write(raw)
                    self.raw_stream.flush()
                    self.raw_bytes += len(raw)
                    self.raw_nonzero_bytes += sum(1 for value in raw if value)
                samples = self.decode(raw)
                now_ms = monotonic_ms()
                self.emit_health(True, now_ms)
                if self.matcher:
                    for cue, score, confidence in self.matcher.accept(samples, now_ms):
                        fact_type = "wind-tick" if cue in ("wind", "wind-tick", "winding") else "cue-" + cue
                        self.publisher.fact(
                            fact_type, value=True, confidence=round(confidence, 6),
                            profile=self.profile, observed_ms=now_ms,
                            latency_min=self.args.latency_min,
                            latency_max=self.args.latency_max,
                        )
        finally:
            if process is not None:
                process.terminate()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    process.kill()
            if self.raw_stream is not None:
                self.raw_stream.close()
                metadata = {
                    "schema": "fnaf2-audio-authority-capture-v1",
                    "raw": str(self.raw_path),
                    "pcm_path": self.path,
                    "rate": PCM_RATE,
                    "channels": PCM_CHANNELS,
                    "bytes_per_frame": PCM_BYTES_PER_FRAME,
                    "frames": self.raw_bytes // PCM_BYTES_PER_FRAME,
                    "bytes": self.raw_bytes,
                    "nonzero_fraction": self.raw_nonzero_bytes / float(max(1, self.raw_bytes)),
                    "first_read_before_ns": self.first_read_before_ns,
                    "first_read_after_ns": self.first_read_after_ns,
                    "sample_zero_host_ns_estimate": (
                        (self.first_read_before_ns + self.first_read_after_ns) // 2
                        if self.first_read_before_ns is not None else None),
                    "sample_zero_uncertainty_ms": (
                        (self.first_read_after_ns - self.first_read_before_ns) / 2e6
                        if self.first_read_before_ns is not None else None),
                    "status": "complete" if self.raw_bytes else "error",
                }
                metadata_path = pathlib.Path(str(self.raw_path) + ".meta.json")
                metadata_path.write_text(json_dumps(metadata) + "\n", encoding="utf-8")
            self.publisher.close()


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="check the BlueALSA route and exit")
    parser.add_argument("--socket", help="Unix stream socket for fact messages")
    parser.add_argument("--mac", default=default_mac())
    parser.add_argument("--model", help="ignored cue-model-v1 exported from held-out data")
    parser.add_argument("--shadow-cue", action="append", dest="shadow_cues", default=[],
                        help="enable a named model template for shadow measurement only")
    parser.add_argument("--profile", default=DEFAULT_PROFILE)
    parser.add_argument("--source", default=DEFAULT_SOURCE,
                        help="fact source name shared by transport adapters")
    parser.add_argument("--latency-min", type=int, default=DEFAULT_LATENCY_MIN_MS)
    parser.add_argument("--latency-max", type=int, default=DEFAULT_LATENCY_MAX_MS)
    parser.add_argument("--quiet", action="store_true",
                        help="publish only to --socket, not stdout")
    parser.add_argument("--once", action="store_true",
                        help="perform one route/read attempt; intended for checks")
    parser.add_argument("--raw-output",
                        help="also retain the authoritative S32LE PCM outside the repository")
    args = parser.parse_args()
    if not args.mac:
        parser.error("no Bluetooth address: pass --mac, set FNAF_BT_MAC, or run node packages/play/bin/phone/local-profile.ts set-bt-mac <mac>")
    if not 0 <= args.latency_min <= args.latency_max:
        parser.error("latency bounds must be ordered and non-negative")
    if args.quiet and not args.socket:
        parser.error("--quiet requires --socket")
    if args.check and args.model:
        parser.error("--check does not load a model")
    return args


def main():
    args = arguments()
    path = pcm_path(args.mac)
    if args.check:
        print(route_status(path, args.mac))
        return 0 if route_issue(path) is None else 3
    try:
        return AudioAuthority(args).run()
    except (OSError, RuntimeError, ValueError) as error:
        print("audio-authority: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
