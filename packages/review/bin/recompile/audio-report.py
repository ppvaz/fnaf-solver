#!/usr/bin/env python3
"""Content-free audio record for a rebuilt Clickteam game (recompile-audio-v1).

The rebuilt runtime writes CHOWDREN_AUDIO_TRACE lines (media.cpp) and, under
openal-soft's wave backend (ALSOFT_DRIVERS=wave, ALSOFT_CONF naming the file),
the mixer's own output as a WAV. This joins the converter's view (the sound
bank from probe-sounds.py, the generated assets.h and every play site in the
generated events), an audition run (CHOWDREN_AUDIO_AUDITION: each sound alone
through the mixer) and bounded game runs into one record of derived numbers:
counts, lengths, RMS and peak levels in 16-bit sample units. No audio, frame
or game text other than sound names and event ids is written.

  audio-report.py record --game fnaf2 --probe probe.json --gamesrc DIR \\
      --audition TRACE:WAVE [--run NAME:TRACE:WAVE ...] [--baseline NAME:WAVE ...] \\
      [--scope KEY=VALUE ...] --out RESULT.json
  audio-report.py check RESULT.json ...     re-derive a record's totals and evidenceId

A window is NON-SILENT when its peak is at least PEAK_FLOOR and its RMS at
least RMS_FLOOR: openal-soft dithers a silent 16-bit mix to RMS 0.5, peak 1.
"""
import argparse
import array
import glob
import hashlib
import json
import math
import os
import re
import sys
import wave

SCHEMA = 'recompile-audio-v1'
PEAK_FLOOR = 16
RMS_FLOOR = 2.0
TAIL_S = 0.1          # an audition window runs to its end line plus this (mixer latency)
PLAY_WINDOW_S = 1.0   # a game-run play is measured over at most this much of its length


class Mix:
    """A 16-bit PCM WAV held as interleaved samples."""

    def __init__(self, path):
        with wave.open(path, 'rb') as w:
            if w.getsampwidth() != 2:
                raise ValueError('%s: expected 16-bit PCM' % path)
            self.rate = w.getframerate()
            self.channels = w.getnchannels()
            self.samples = array.array('h')
            self.samples.frombytes(w.readframes(w.getnframes()))
        if sys.byteorder == 'big':
            self.samples.byteswap()
        self.seconds = len(self.samples) / float(self.rate * self.channels)

    def window(self, start_s, end_s):
        a = max(0, int(start_s * self.rate)) * self.channels
        b = min(len(self.samples), int(end_s * self.rate) * self.channels)
        if b <= a:
            return {'rms': None, 'peak': None, 'nonSilent': None, 'samples': 0}
        part = self.samples[a:b]
        rms = math.sqrt(sum(x * x for x in part) / float(len(part)))
        peak = max(abs(min(part)), abs(max(part)))
        return {'rms': round(rms, 2), 'peak': peak, 'nonSilent': bool(peak >= PEAK_FLOOR and rms >= RMS_FLOOR),
                'samples': b - a}

    def overall(self, block_s=0.1):
        whole = self.window(0.0, self.seconds + 1.0)
        blocks = int(self.seconds / block_s)
        loud = sum(1 for i in range(blocks) if self.window(i * block_s, (i + 1) * block_s)['nonSilent'])
        return {'seconds': round(self.seconds, 3), 'rate': self.rate, 'channels': self.channels,
                'rms': whole['rms'], 'peak': whole['peak'], 'nonSilent': whole['nonSilent'],
                'blocks100ms': blocks, 'nonSilentBlocks100ms': loud}


def file_sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def read_trace(path):
    rows = []
    with open(path) as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            parts = line.split()
            rows.append({'frame': int(parts[0]), 'tick': int(parts[1]), 'wall': float(parts[2]),
                         'event': parts[3], 'args': parts[4:]})
    return rows


def static_census(gamesrc):
    """assets.h's sound defines and every generated play site, by event id."""
    defines = {}
    with open(os.path.join(gamesrc, 'assets.h')) as f:
        for line in f:
            m = re.match(r'#define (SOUND_\w+) (\d+)\s*$', line)
            if m:
                defines[int(m.group(2))] = m.group(1)
    sites = {}
    invalid = 0
    queries = {}
    for path in sorted(glob.glob(os.path.join(gamesrc, 'events_*.cpp'))):
        event = None
        with open(path) as f:
            for line in f:
                m = re.match(r'\s*// event (\d+_\d+)', line)
                if m:
                    event = m.group(1)
                for m in re.finditer(r'media\.play_id\((\w+)', line):
                    if m.group(1) == 'INVALID_ASSET_ID':
                        invalid += 1
                    else:
                        sites.setdefault(m.group(1), []).append(event)
                for m in re.finditer(r'media\.is_sample_playing\((\w+)', line):
                    queries.setdefault(m.group(1), []).append(event)
    return defines, sites, invalid, queries


def audition_rows(trace, mix):
    starts, out = {}, {}
    for r in trace:
        if r['event'] != 'audition':
            continue
        sid, what = int(r['args'][0]), r['args'][1]
        if what == 'start':
            kv = dict(zip(r['args'][2::2], r['args'][3::2]))
            starts[sid] = (r['wall'], float(kv['length_ms']), float(kv['hold_ms']), int(kv['rate']))
        elif what == 'end' and sid in starts:
            wall, length, hold, rate = starts.pop(sid)
            w = mix.window(wall, r['wall'] + TAIL_S)
            out[sid] = {'lengthMs': round(length, 1), 'holdMs': round(hold, 1), 'rate': rate,
                        'rms': w['rms'], 'peak': w['peak'], 'nonSilent': w['nonSilent']}
        elif what in ('absent', 'undecodable'):
            out[sid] = {'status': what.upper()}
    return out


def run_summary(trace, mix):
    per = {}
    plays = [r for r in trace if r['event'] == 'play']
    for r in plays:
        sid, channel, loop, length = int(r['args'][0]), int(r['args'][1]), int(r['args'][2]), float(r['args'][3])
        w = mix.window(r['wall'], r['wall'] + min(PLAY_WINDOW_S, max(length, 0.0) / 1000.0)) if mix else None
        p = per.setdefault(sid, {'plays': 0, 'channels': [], 'loops': [], 'first': None,
                                 'windowPeakMax': None, 'nonSilentWindows': 0})
        p['plays'] += 1
        if channel not in p['channels']:
            p['channels'].append(channel)
        if loop not in p['loops']:
            p['loops'].append(loop)
        if p['first'] is None:
            p['first'] = {'frame': r['frame'], 'tick': r['tick'], 'wallS': round(r['wall'], 3)}
        if w and w['peak'] is not None:
            p['windowPeakMax'] = max(p['windowPeakMax'] or 0, w['peak'])
            p['nonSilentWindows'] += int(bool(w['nonSilent']))
    events = {}
    for r in trace:
        events[r['event']] = events.get(r['event'], 0) + 1
    return per, {'traceEvents': events, 'plays': len(plays), 'distinctSounds': len(per),
                 'mix': mix.overall() if mix else 'UNKNOWN'}


def evidence_id(result):
    body = dict(result)
    body.pop('evidenceId', None)
    text = json.dumps(body, separators=(',', ':'), ensure_ascii=False)
    return 'recompile-audio-%s' % hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


def totals(rows, runs):
    """The answer's counts, derived from the rows alone (check re-derives them)."""
    t = {
        'declared': len(rows),
        'resolvedFiles': sum(1 for r in rows if r.get('resource')),
        'missingFiles': sum(1 for r in rows if not r.get('resource')),
        'transcodedMp3': sum(1 for r in rows if r.get('format') == 'mp3'),
        'handleNotIndex': sum(1 for r in rows if r['handle'] != r['bankIndex']),
        'playSites': sum(len(r['events']) for r in rows),
        'soundsWithPlaySites': sum(1 for r in rows if r['events']),
        'auditionNonSilent': sum(1 for r in rows if isinstance(r.get('audition'), dict) and r['audition'].get('nonSilent')),
        'auditionMeasured': sum(1 for r in rows if isinstance(r.get('audition'), dict) and r['audition'].get('rms') is not None),
    }
    for name in runs:
        played = [r for r in rows if name in r.get('runs', {})]
        t['run:%s:soundsPlayed' % name] = len(played)
        t['run:%s:plays' % name] = sum(r['runs'][name]['plays'] for r in played)
    return t


def cmd_record(opts):
    probe = json.load(open(opts.probe))
    defines, sites, invalid, queries = static_census(opts.gamesrc)
    at_trace, at_wave = opts.audition.split(':', 1)
    aud = audition_rows(read_trace(at_trace), Mix(at_wave))
    runs, run_meta = {}, {}
    for spec in opts.run or []:
        name, trace, wav = spec.split(':', 2)
        per, meta = run_summary(read_trace(trace), Mix(wav) if wav else None)
        runs[name], run_meta[name] = per, meta
    baselines = {}
    for spec in opts.baseline or []:
        name, wav = spec.split(':', 1)
        baselines[name] = Mix(wav).overall()
    rows = []
    for b in probe['bank']:
        # Mobile banks convert one asset per record in bank order (converter.py).
        sid = b['index']
        define = defines.get(sid)
        row = {'assetId': sid, 'define': define, 'bankIndex': b['index'], 'handle': b['handle'],
               'name': b['name'], 'named': b['named'], 'flags': b['flags'], 'rate': b['rate'],
               'resource': (b.get('resource') or [None])[0], 'format': b.get('format'),
               'bytes': b.get('bytes'),
               'events': sites.get(define, []), 'sampleQueries': queries.get(define, []),
               'audition': aud.get(sid, 'UNKNOWN')}
        row['runs'] = {name: per[sid] for name, per in runs.items() if sid in per}
        rows.append(row)
    scope = dict(kv.split('=', 1) for kv in (opts.scope or []))
    result = {
        'schema': SCHEMA, 'game': opts.game, 'claimLevel': 'MODEL_ONLY', 'fidelity': 'rebuilt-runtime',
        'question': 'Does every sound the converted game declares reach the rebuilt runtime\'s mixer, '
                    'and do the game\'s own events play them?',
        'scope': scope,
        'sourceHashes': {'probe': file_sha256(opts.probe),
                         'assetsHeader': file_sha256(os.path.join(opts.gamesrc, 'assets.h')),
                         'audition': [file_sha256(p) for p in opts.audition.split(':', 1)],
                         'runs': {spec.split(':', 2)[0]: [file_sha256(p) for p in spec.split(':', 2)[1:] if p]
                                  for spec in opts.run or []},
                         'baselines': {spec.split(':', 1)[0]: file_sha256(spec.split(':', 1)[1])
                                       for spec in opts.baseline or []}},
        'thresholds': {'peakFloor': PEAK_FLOOR, 'rmsFloor': RMS_FLOOR, 'auditionTailS': TAIL_S,
                       'playWindowS': PLAY_WINDOW_S, 'units': '16-bit sample values'},
        'probe': {'build': probe['build'], 'handleCount': probe['handleCount'], 'records': probe['records'],
                  'sampleParameters': len(probe['uses']), 'rawFiles': probe.get('rawFiles'),
                  'rawWithoutRecord': probe.get('rawWithoutRecord', []),
                  'frameErrors': len(probe.get('frameErrors', []))},
        'static': {'invalidPlaySites': invalid, 'definedSounds': len(defines)},
        'runs': run_meta, 'baselines': baselines, 'rows': rows,
    }
    result['answer'] = totals(rows, runs)
    result['limitations'] = opts.limitation or []
    result['evidenceId'] = evidence_id(result)
    with open(opts.out, 'w') as f:
        json.dump(result, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('%s: %s' % (result['evidenceId'], json.dumps(result['answer'], sort_keys=True)))


def check(path):
    result = json.load(open(path))
    if result.get('schema') != SCHEMA:
        raise AssertionError('%s: schema %r' % (path, result.get('schema')))
    runs = list(result.get('runs', {}).keys())
    want = totals(result['rows'], runs)
    if want != result['answer']:
        raise AssertionError('%s: answer %s is not the rows\' %s' % (path, result['answer'], want))
    for r in result['rows']:
        a = r['audition']
        if isinstance(a, dict) and a.get('rms') is not None:
            ns = bool(a['peak'] >= result['thresholds']['peakFloor'] and a['rms'] >= result['thresholds']['rmsFloor'])
            if ns != a['nonSilent']:
                raise AssertionError('%s: sound %d nonSilent is not its thresholds\'' % (path, r['assetId']))
    if evidence_id(result) != result['evidenceId']:
        raise AssertionError('%s: evidenceId %s is not %s' % (path, result['evidenceId'], evidence_id(result)))
    return result


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('record')
    r.add_argument('--game', required=True)
    r.add_argument('--probe', required=True)
    r.add_argument('--gamesrc', required=True)
    r.add_argument('--audition', required=True)
    r.add_argument('--run', action='append')
    r.add_argument('--baseline', action='append')
    r.add_argument('--scope', action='append')
    r.add_argument('--limitation', action='append')
    r.add_argument('--out', required=True)
    c = sub.add_parser('check')
    c.add_argument('records', nargs='+')
    opts = ap.parse_args()
    if opts.cmd == 'record':
        cmd_record(opts)
    else:
        for path in opts.records:
            res = check(path)
            print('%s: %s rechecked (%d sounds, %d audition non-silent)' % (
                res['evidenceId'], path, res['answer']['declared'], res['answer']['auditionNonSilent']))


if __name__ == '__main__':
    main()
