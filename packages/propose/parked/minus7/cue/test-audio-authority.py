#!/usr/bin/env python3
"""Phone-free contract checks for the external audio authority."""
import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("audio_authority", HERE / "audio-authority.py")
authority = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(authority)


def check_fact_contract():
    line = authority.fact_line(
        7, "wind-tick", value=True, confidence=0.875, source="audio-authority",
        profile="g56-esp32-a2dp-v1", observed_ms=90, received_ms=100,
        latency_min=10, latency_max=40)
    message = json.loads(line)
    assert message["schema"] == "fact-message-v1"
    assert message["source"] == "audio-authority"
    assert message["calibrationProfile"] == "g56-esp32-a2dp-v1"
    assert message["t_observed"] == 90
    assert message["t_received"] == 100
    assert message["value"] is True
    assert len(line) <= authority.MAX_FACT_BYTES

    unknown = json.loads(authority.fact_line(
        8, "audio-route", reason="receiver-disconnected", confidence=0.0,
        profile="g56-bluealsa-a2dp-v1", received_ms=101))
    assert unknown["state"] == "UNKNOWN"
    assert unknown["reason"] == "receiver-disconnected"
    assert "value" not in unknown

    for kwargs in (
        {"seq": -1},
        {"confidence": 1.1},
        {"latency_min": 50, "latency_max": 49},
        {"source": ""},
    ):
        values = {"seq": 0, "fact_type": "x", "value": 1, "received_ms": 1}
        values.update(kwargs)
        try:
            authority.fact_line(**values)
        except (TypeError, ValueError):
            pass
        else:
            raise AssertionError("invalid fact was accepted: %r" % kwargs)


def check_decode_and_matcher():
    args = type("Args", (), {
        "mac": authority.DEFAULT_MAC,
        "socket": None,
        "quiet": True,
        "source": "audio-authority",
        "profile": "g56-esp32-a2dp-v1",
        "model": None,
        "latency_min": 0,
        "latency_max": 1,
    })()
    decoder = authority.AudioAuthority(args)
    raw = bytearray()
    for _ in range(authority.DECIMATION):
        raw.extend((1_000_000).to_bytes(4, "little", signed=True))
        raw.extend((-1_000_000).to_bytes(4, "little", signed=True))
    samples = decoder.decode(raw)
    assert len(samples) == 1
    assert decoder.total_frames == authority.DECIMATION
    assert decoder.last_rms == 0.0
    assert decoder.last_peak == 0.0

    template = (0, 1000, -500, 700, -200, 400, -100, 300)
    matcher = authority.LiveMatcher([{
        "id": 33, "cue": "wind", "threshold": 0.9, "pcm": template,
    }])
    assert matcher.accept((9,) * 8, 1000) == []
    events = matcher.accept(template, 1000)
    assert len(events) == 1 and events[0][0] == "wind"
    assert events[0][1] > 0.99

    # Non-phase templates stay disabled unless a measurement explicitly opts
    # them into shadow facts. This must not silently become a control path.
    bang = authority.LiveMatcher([{
        "id": 17, "cue": "bang", "threshold": 0.9, "pcm": template,
    }])
    assert bang.accept(template, 1000) == []
    shadow_bang = authority.LiveMatcher([{
        "id": 17, "cue": "bang", "threshold": 0.9, "pcm": template,
    }], ["bang"])
    events = shadow_bang.accept(template, 1000)
    assert len(events) == 1 and events[0][0] == "bang"


def check_socket_publisher():
    with tempfile.TemporaryDirectory(prefix="fnaf2-authority-test-") as temp:
        path = Path(temp) / "facts.sock"
        publisher = authority.FactPublisher(str(path), stdout=False)
        publisher.start()
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            client.settimeout(1.0)
            client.connect(str(path))
            publisher.accept([publisher.server])
            publisher.fact("audio-route", value=True, received_ms=1)
            message = json.loads(client.recv(2048))
            assert message["source"] == "audio-authority"
            assert message["seq"] == 0
        finally:
            client.close()
            publisher.close()
        assert not path.exists()


def check_fact_collector():
    with tempfile.TemporaryDirectory(prefix="fnaf2-fact-collector-test-") as temp:
        root = Path(temp)
        socket_path = root / "facts.sock"
        output = root / "facts.jsonl"
        publisher = authority.FactPublisher(str(socket_path), stdout=False)
        publisher.start()
        collector = subprocess.Popen([
            sys.executable, str(HERE / "collect-facts.py"),
            "--socket", str(socket_path), "--output", str(output),
        ])
        try:
            for _ in range(100):
                publisher.accept([publisher.server])
                if publisher.clients:
                    break
                time.sleep(0.01)
            assert publisher.clients
            publisher.fact("audio-route", value=True, received_ms=2)
        finally:
            publisher.close()
        assert collector.wait(timeout=2) == 0
        line = json.loads(output.read_text(encoding="utf-8"))
        assert line["type"] == "audio-route"
        assert line["source"] == "audio-authority"


def check_bluealsa_route_gate():
    with tempfile.TemporaryDirectory(prefix="fnaf2-authority-route-") as temp:
        command = Path(temp) / "bluealsa-cli"
        command.write_text(
            "#!/bin/sh\n"
            "if [ \"$MOCK_BLUEALSA_ROUTE\" = ready ]; then\n"
            "  printf 'Running: true\\n'\n"
            "  exit 0\n"
            "fi\n"
            "if [ \"$MOCK_BLUEALSA_ROUTE\" = stopped ]; then\n"
            "  printf 'Running: false\\n'\n"
            "  exit 0\n"
            "fi\n"
            "exit 1\n",
            encoding="ascii")
        command.chmod(0o755)
        previous = os.environ.get("PATH", "")
        try:
            os.environ["PATH"] = temp + os.pathsep + previous
            path = authority.pcm_path(authority.DEFAULT_MAC)
            os.environ["MOCK_BLUEALSA_ROUTE"] = "ready"
            assert authority.route_ready(path)
            assert "transport=bluealsa" in authority.route_status(path, authority.DEFAULT_MAC)
            os.environ["MOCK_BLUEALSA_ROUTE"] = "stopped"
            assert not authority.route_ready(path)
            assert "a2dp-stream-not-running" in authority.route_status(path, authority.DEFAULT_MAC)
            os.environ["MOCK_BLUEALSA_ROUTE"] = "missing"
            assert not authority.route_ready(path)
            assert "a2dp-source-not-connected" in authority.route_status(path, authority.DEFAULT_MAC)
        finally:
            os.environ["PATH"] = previous
            os.environ.pop("MOCK_BLUEALSA_ROUTE", None)


def check_raw_capture_metadata():
    with tempfile.TemporaryDirectory(prefix="fnaf2-authority-raw-") as temp:
        root = Path(temp)
        command = root / "bluealsa-cli"
        command.write_text(
            "#!/usr/bin/env python3\n"
            "import struct, sys\n"
            "if sys.argv[1] == 'info':\n"
            "    print('Running: true')\n"
            "    sys.exit(0)\n"
            "if sys.argv[1] == 'open':\n"
            "    frame = struct.pack('<ii', 1000000, -1000000)\n"
            "    sys.stdout.buffer.write(frame * 100)\n"
            "    sys.stdout.buffer.flush()\n"
            "    sys.exit(0)\n"
            "sys.exit(2)\n",
            encoding="ascii",
        )
        command.chmod(0o755)
        raw = root / "capture.raw"
        previous = os.environ.get("PATH", "")
        try:
            os.environ["PATH"] = str(root) + os.pathsep + previous
            result = subprocess.run([
                sys.executable, str(HERE / "audio-authority.py"),
                "--mac", authority.DEFAULT_MAC, "--once", "--quiet",
                "--socket", str(root / "unused.sock"), "--raw-output", str(raw),
            ], text=True, capture_output=True, timeout=3)
        finally:
            os.environ["PATH"] = previous
        assert result.returncode == 3
        metadata = json.loads(Path(str(raw) + ".meta.json").read_text())
        assert metadata["status"] == "complete"
        assert metadata["frames"] == 100
        assert metadata["first_read_before_ns"] <= metadata["first_read_after_ns"]
        assert raw.stat().st_size == 100 * authority.PCM_BYTES_PER_FRAME


check_fact_contract()
check_decode_and_matcher()
check_socket_publisher()
check_fact_collector()
check_bluealsa_route_gate()
check_raw_capture_metadata()
print("audio authority: fact contract, external profile, decode, socket, and route gate passed")
