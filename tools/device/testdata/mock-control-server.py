#!/usr/bin/env python3
"""Protocol stand-in for the helper's control socket, for the forward transport.

Writes its listening port to the path given as the first argument, then answers
requests until it is killed. It mirrors the verbs the helper serves so the host
script is exercised end to end without a device.
"""
import pathlib
import socket
import sys

# Field-for-field with the device (Fnaf2Legacy.snapshotLine/readLine,
# OverlayController.status) and with the loopback mock in
# mock-adb-cue-helper.sh. Both transports must answer the same shape or a
# consumer that works over one silently fails over the other.
SNAPSHOT = "OK snapshotNs=9000 wallMs=1700000000000 visualCaptureNs=7800 nightOnsetImageNs=-1 visual=OBSERVED visualReason=none seq=121 ageUs=1200 content=2400x1080 visible=1 screen=FNAF2_NIGHT monitorUp=true monitorReason=native-stroke-monitor-up mask_button_downstroke=0 monitor_button_downstroke=140 watch=OFF spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa entries=12"
READ = "OK read=OBSERVED spec=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa seq=122 snapshotNs=10000 ageUs=1200 cam01_button=0 cam02_button=0 cam03_button=0 cam04_button=0 cam05_button=194 cam06_button=0 cam07_button=0 cam08_button=0 cam09_button=0 cam10_button=0 cam11_button=0 cam12_button=0"
OVERLAY = "OK overlay=READY teach=OFF f1=NONE f3=NONE f4=NONE"
STATUS = "OK schema=companion-status-v1 app=0.2.0 code=16 session=3 capture=ON captureReason=none content=2400x1080 visible=1 frames=18234 frameAgeMs=12 fps=59.8 target=com.scottgames.fnaf2 game=fnaf2 targetBuild=26:2.0.7 legacy=fnaf2 regions=0 regionSamples=0 regionFrames=0 lesson=NONE lessonState=OFF panel=NONE clearance=UNCHECKED overlayPermission=GRANTED lease=NONE battery=64 charging=1 thermal=NONE foreground=OTHER audioProbe=OFF snapshotNs=9000 wallMs=1700000000000"
SPEC = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


def answer(request):
    field = request.split()
    if not field:
        return "ERROR unknown-verb"
    if field[0] == "GET":
        return SNAPSHOT
    if field[0] == "WATCH" and len(field) == 3:
        if field[2] == "status":
            return "OK watch=OFF spec=" + SPEC + " entries=12"
        return "OK watch=ACTIVE spec=" + SPEC + " entries=12"
    if field[0] == "READ" and len(field) == 2:
        return READ
    if field[0] == "OVERLAY" and len(field) == 2:
        return OVERLAY
    if field[0] == "STATUS" and len(field) == 2:
        return STATUS
    return "ERROR unknown-verb"


server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("127.0.0.1", 0))
server.listen(4)
pathlib.Path(sys.argv[1]).write_text(str(server.getsockname()[1]))

while True:
    client, _ = server.accept()
    with client:
        request = client.recv(4096).decode("ascii", "replace").strip()
        client.sendall((answer(request) + "\n").encode("ascii"))
