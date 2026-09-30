#!/usr/bin/env python3
"""Which AudioFlinger output thread carries a process's tracks? (content-free)

Reads a saved `adb shell dumpsys media.audio_flinger` and prints, as one JSON
object, every output thread (name, output flags, standby) that lists an active
or fast track of the given pid, with the track rows' kind (fast track "F<n>"
or normal) and sample rate. The rebuild's capture switch
(debug.rebuild.audio_capture, android/audio_route.h) should move its track
from the AUDIO_OUTPUT_FLAG_FAST thread to a PRIMARY or DEEP_BUFFER one.

  af-tracks.py DUMPSYS.txt PID
"""
import json
import re
import sys


def main():
    path, pid = sys.argv[1], sys.argv[2]
    threads, cur = [], None
    for line in open(path, errors='replace'):
        m = re.match(r'Output thread (\S+), name (\S+), tid \d+, type \d+ \((\w+)\)', line)
        if m:
            cur = {'thread': m.group(2), 'type': m.group(3), 'flags': None, 'standby': None, 'tracks': []}
            threads.append(cur)
            continue
        if line.startswith('Input thread'):
            cur = None
            continue
        if cur is None:
            continue
        m = re.match(r'\s+AudioStreamOut: \S+ flags (\S+) \(([^)]*)\)', line)
        if m:
            cur['flags'] = m.group(2)
        m = re.match(r'\s+Standby: (\w+)', line)
        if m:
            cur['standby'] = m.group(1)
        # track rows: "    F1    17907    yes    6690/  10783 ..." (fast) or "          17907 ... 6690/ 10783"
        m = re.match(r'\s+(F\d+|\S*)\s+(\d+)\s+(yes|no)\s+(\d+)/\s*(\d+)\s+.*?\s(\d{4,6})\s+(\d+)\s', line)
        if m and m.group(4) == pid and 'removeTrack' not in line and 'AT::' not in line:
            cur['tracks'].append({'kind': 'fast' if m.group(1).startswith('F') else 'normal',
                                  'slot': m.group(1) or None, 'sampleRate': int(m.group(6))})
    hits = [{k: t[k] for k in ('thread', 'type', 'flags', 'standby', 'tracks')} for t in threads if t['tracks']]
    print(json.dumps({'pid': pid, 'outputs': hits}, indent=1))


if __name__ == '__main__':
    main()
