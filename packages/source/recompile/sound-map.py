#!/usr/bin/env python3
"""The sound mapping table of a rebuilt mobile game (recompile-sound-map-v1).

For every sound-bank record: its Fusion handle, bank index and name, the length
the CCN declares for it (CSoundBank.preLoad's handleToLength, in ms) and its
frequency; the res/raw file the retail runtime opens for it (SoundPoolSounds.load
and MediaSound.setSoundSettings: "raw/s%04d" formatted with the HANDLE) with that
file's sha256, duration, rate and channels; the converted asset id and the
generated events that play it; and, from an audition capture of the rebuilt
runtime's mixer, the length it decoded and how well its output correlates with
the handle's file and with the file the bank index would name. Anchors are
phone-measured pairs (a handle and the file heard for it) the table must
reproduce. Content-free: names, hashes, lengths and scores.

  sound-map.py record --game fnaf2 --probe PROBE.json --raw-dir RES_RAW --gamesrc DIR \\
      --audition TRACE:WAVE [--anchor HANDLE=FILE:NOTE ...] [--solo NAME=RESULT.json ...] \\
      [--scope KEY=VALUE ...] --out RESULT.json
  sound-map.py check RESULT.json ...

check re-derives, without any audio: the file name from each handle, the
declared-length agreement, the asset id from the bank index, every anchor's
file, the summary counts and the evidenceId.
"""
import argparse
import array
import glob
import hashlib
import json
import math
import os
import re
import subprocess
import wave

SCHEMA = 'recompile-sound-map-v1'
LENGTH_TOLERANCE_MS = 30


def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()


def ffprobe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration',
                          '-of', 'json', path], capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    s = j['streams'][0]
    return {'codec': s.get('codec_name'), 'rate': int(s['sample_rate']), 'channels': int(s['channels']),
            'durationMs': round(float(j['format']['duration']) * 1000.0, 1)}


def decode(path, rate):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 's16le', '-ac', '1', '-ar', str(rate), '-'],
                         capture_output=True, check=True).stdout
    a = array.array('h')
    a.frombytes(raw[:len(raw) // 2 * 2])
    return a


def mono_mix(path):
    with wave.open(path, 'rb') as w:
        rate, ch = w.getframerate(), w.getnchannels()
        a = array.array('h')
        a.frombytes(w.readframes(w.getnframes()))
    try:
        import numpy as np
        m = np.frombuffer(a.tobytes(), dtype=np.int16).astype(float).reshape(-1, ch).mean(axis=1)
        return rate, m
    except ImportError:
        return rate, [sum(a[i:i + ch]) / float(ch) for i in range(0, len(a) - ch + 1, ch)]


def best_ncc(mix, start, ref, lag, step):
    try:
        import numpy as np
    except ImportError:
        np = None
    top = -1.0
    if not len(ref):
        return None
    r = (np.asarray(ref, dtype=float) if np else list(ref))
    if np is not None:
        r = r - r.mean()
        rn = float((r * r).sum())
    for off in range(-lag, lag + 1, step):
        a = start + off
        if a < 0 or a + len(ref) > len(mix):
            continue
        x = mix[a:a + len(ref)]
        if np is not None:
            x = x - x.mean()
            den = math.sqrt(float((x * x).sum()) * rn)
            c = float((x * r).sum()) / den if den else 0.0
        else:
            mx, mr = sum(x) / len(x), sum(r) / len(r)
            num = sum((p - mx) * (q - mr) for p, q in zip(x, r))
            den = math.sqrt(sum((p - mx) ** 2 for p in x) * sum((q - mr) ** 2 for q in r))
            c = num / den if den else 0.0
        top = max(top, c)
    return round(top, 3)


def evidence_id(result):
    body = dict(result)
    body.pop('evidenceId', None)
    text = json.dumps(body, separators=(',', ':'), ensure_ascii=False, sort_keys=True)
    return 'recompile-sound-map-%s' % hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


def summarize(rows, anchors):
    return {
        'records': len(rows),
        'handleNotIndex': sum(1 for r in rows if r['handle'] != r['bankIndex']),
        'declaredLengthMatchesHandleFile': sum(1 for r in rows if r['declaredMatchesHandleFile']),
        'declaredLengthMatchesIndexFile': sum(1 for r in rows if r['declaredMatchesIndexFile']),
        'auditionBetterOnHandleFile': sum(1 for r in rows if r['audition'].get('nccHandleFile') is not None
                                          and r['audition']['nccHandleFile'] > (r['audition'].get('nccIndexFile') or 0)),
        'auditionScored': sum(1 for r in rows if r['audition'].get('nccHandleFile') is not None),
        'anchorsReproduced': sum(1 for a in anchors if a['reproduced']),
        'anchors': len(anchors),
    }


def cmd_record(opts):
    probe = json.loads(open(opts.probe).read().strip().splitlines()[-1])
    defines = {}
    for line in open(os.path.join(opts.gamesrc, 'assets.h')):
        m = re.match(r'#define (SOUND_\w+) (\d+)\s*$', line)
        if m:
            defines[int(m.group(2))] = m.group(1)
    sites = {}
    for path in sorted(glob.glob(os.path.join(opts.gamesrc, 'events_*.cpp'))):
        event = None
        for line in open(path, errors='replace'):
            m = re.match(r'\s*// event (\d+_\d+)', line)
            if m:
                event = m.group(1)
            for m in re.finditer(r'media\.play_id\((SOUND_\w+)', line):
                sites.setdefault(m.group(1), []).append(event)
    params = {}
    for u in probe['uses']:
        params[u['handle']] = params.get(u['handle'], 0) + 1
    files = {}
    for path in glob.glob(os.path.join(opts.raw_dir, 's[0-9][0-9][0-9][0-9].*')):
        files[int(os.path.basename(path)[1:5])] = path
    trace, wav = opts.audition.split(':', 1)
    rate, mix = mono_mix(wav)
    windows = {}
    starts = {}
    for line in open(trace):
        f = line.split()
        if len(f) > 5 and f[3] == 'audition':
            if f[5] == 'start':
                kv = dict(zip(f[6::2], f[7::2]))
                starts[int(f[4])] = (float(f[2]), float(kv['length_ms']), float(kv['hold_ms']))
            elif f[5] == 'end' and int(f[4]) in starts:
                windows[int(f[4])] = starts.pop(int(f[4]))
    lag, step = int(0.08 * rate), max(1, rate // 4000)
    rows = []
    for b in probe['bank']:
        h, i = b['handle'], b['index']
        fh, fi = files.get(h), files.get(i)
        infoh = ffprobe(fh) if fh else None
        infoi = ffprobe(fi) if fi else None
        row = {
            'handle': h, 'bankIndex': i, 'name': b['name'], 'flags': b['flags'],
            'declaredLengthMs': b['lengthField'], 'declaredRate': b['rate'],
            'file': os.path.basename(fh) if fh else None, 'fileSha256': sha256(fh) if fh else None,
            'fileDurationMs': infoh['durationMs'] if infoh else None, 'fileRate': infoh['rate'] if infoh else None,
            'fileChannels': infoh['channels'] if infoh else None, 'fileCodec': infoh['codec'] if infoh else None,
            'indexFile': os.path.basename(fi) if fi else None,
            'declaredMatchesHandleFile': bool(infoh and abs(infoh['durationMs'] - b['lengthField']) <= LENGTH_TOLERANCE_MS),
            'declaredMatchesIndexFile': bool(infoi and abs(infoi['durationMs'] - b['lengthField']) <= LENGTH_TOLERANCE_MS),
            'assetId': i, 'define': defines.get(i), 'sampleParameters': params.get(h, 0),
            'events': sites.get(defines.get(i), []),
        }
        aud = {}
        if i in windows:
            wall, length, hold = windows[i]
            aud['decodedLengthMs'] = round(length, 1)
            # the first 250 ms of sound after the file's own leading silence
            ref_len = int(min(hold / 1000.0, 0.25) * rate)
            for key, path in (('nccHandleFile', fh), ('nccIndexFile', fi)):
                if path is None:
                    aud[key] = None
                    continue
                ref = decode(path, rate)
                lead = next((k for k, v in enumerate(ref) if abs(v) >= 16), 0)
                if lead / float(rate) * 1000.0 > hold - 50:
                    aud[key] = None      # the audition window ends before this file makes a sound
                    continue
                aud[key] = best_ncc(mix, int((wall + lead / float(rate)) * rate), ref[lead:lead + ref_len], lag, step)
        row['audition'] = aud
        rows.append(row)
    anchors = []
    for spec in opts.anchor or []:
        handle, rest = spec.split('=', 1)
        fname, note = rest.split(':', 1)
        row = next((r for r in rows if r['handle'] == int(handle)), None)
        anchors.append({'handle': int(handle), 'file': fname, 'note': note,
                        'mappedFile': row['file'] if row else None,
                        'reproduced': bool(row and row['file'] and row['file'].split('.')[0] == fname.split('.')[0])})
    solos = {}
    for spec in opts.solo or []:
        name, path = spec.split('=', 1)
        s = json.load(open(path))
        solos[name] = {'asset': s['asset'], 'plays': s['plays'], 'summary': s['summary']}
    result = {'schema': SCHEMA, 'game': opts.game, 'claimLevel': 'MODEL_ONLY', 'fidelity': 'rebuilt-runtime',
              'rule': 'res/raw/s%04d formatted with the bank record\'s handle (SoundPoolSounds.load, '
                      'MediaSound.setSoundSettings); a Sample parameter names that handle',
              'lengthToleranceMs': LENGTH_TOLERANCE_MS, 'handleCount': probe['handleCount'],
              'scope': dict(kv.split('=', 1) for kv in (opts.scope or [])),
              'rows': rows, 'anchors': anchors, 'soloCaptures': solos}
    result['summary'] = summarize(rows, anchors)
    result['evidenceId'] = evidence_id(result)
    with open(opts.out, 'w') as f:
        json.dump(result, f, indent=1, sort_keys=True, ensure_ascii=False)
        f.write('\n')
    print('%s: %s' % (result['evidenceId'], json.dumps(result['summary'], sort_keys=True)))


def check(path):
    result = json.load(open(path))
    if result.get('schema') != SCHEMA:
        raise AssertionError('%s: schema %r' % (path, result.get('schema')))
    tol = result['lengthToleranceMs']
    for r in result['rows']:
        if r['file'] is not None and not r['file'].startswith('s%04d.' % r['handle']):
            raise AssertionError('%s: handle %d maps to %s, not s%04d.*' % (path, r['handle'], r['file'], r['handle']))
        if r['assetId'] != r['bankIndex']:
            raise AssertionError('%s: handle %d asset %d is not its bank index %d' % (path, r['handle'], r['assetId'], r['bankIndex']))
        want = r['fileDurationMs'] is not None and abs(r['fileDurationMs'] - r['declaredLengthMs']) <= tol
        if want != r['declaredMatchesHandleFile']:
            raise AssertionError('%s: handle %d declaredMatchesHandleFile is not its lengths\'' % (path, r['handle']))
        if r['fileSha256'] is not None and not re.match(r'^[0-9a-f]{64}$', r['fileSha256']):
            raise AssertionError('%s: handle %d sha256 malformed' % (path, r['handle']))
    for a in result['anchors']:
        row = next((r for r in result['rows'] if r['handle'] == a['handle']), None)
        ok = bool(row and row['file'] and row['file'].split('.')[0] == a['file'].split('.')[0])
        if ok != a['reproduced'] or not ok:
            raise AssertionError('%s: anchor handle %d -> %s not reproduced' % (path, a['handle'], a['file']))
    if summarize(result['rows'], result['anchors']) != result['summary']:
        raise AssertionError('%s: summary is not its rows\'' % path)
    if evidence_id(result) != result['evidenceId']:
        raise AssertionError('%s: evidenceId %s is not %s' % (path, result['evidenceId'], evidence_id(result)))
    return result


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('record')
    for name in ('game', 'probe', 'raw-dir', 'gamesrc', 'audition', 'out'):
        r.add_argument('--' + name, required=True)
    r.add_argument('--anchor', action='append')
    r.add_argument('--scope', action='append')
    r.add_argument('--solo', action='append')
    c = sub.add_parser('check')
    c.add_argument('records', nargs='+')
    opts = ap.parse_args()
    if opts.cmd == 'record':
        cmd_record(opts)
    else:
        for path in opts.records:
            res = check(path)
            print('%s: %s rechecked (%d records, %d/%d anchors)' % (
                res['evidenceId'], path, res['summary']['records'], res['summary']['anchorsReproduced'],
                res['summary']['anchors']))


if __name__ == '__main__':
    main()
