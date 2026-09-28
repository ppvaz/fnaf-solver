#!/usr/bin/env python3
"""Per-game build record for the rebuilt Clickteam games (recompile-game-builds-v1).

One row per game, derived from the files each step left outside the repository:
the converter's log and generated sources, the pinned host binary and assets,
a bounded no-input harness boot (its trace, audio trace and log), the Android
libmain.so and APK, and the game's committed recompile-audio-v1 record. Every
value is a count, a name, a hash or a status; no game content is copied.

  game-builds.py record --out RESULT.json --game fnaf1 --ccn FILE --gamesrc DIR --convert-log FILE \\
      [--binary FILE --assets FILE --pinned DIR] [--boot DIR] [--libmain FILE --apk FILE --package NAME] \\
      [--audio RECORD] [--blocker TEXT]         (adds or replaces the game's row)
  game-builds.py check RESULT.json ...        re-derive statuses and the evidenceId, and resolve
                                               each row's audio record in tools/recompile/results

A boot dir holds the harness run: trace (CHOWDREN_TRACE), audio-trace, run.log
(the container's output, ending "exit N") and env.
"""
import argparse
import glob
import hashlib
import json
import os
import re
import sys

SCHEMA = 'recompile-game-builds-v1'
HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, 'results')
STEPS = ('conversion', 'host', 'boot', 'apk')


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def frame_names(gamesrc):
    names = {}
    for path in glob.glob(os.path.join(gamesrc, 'frame*_1.cpp')):
        m = re.search(r'frame(\d+)_1\.cpp$', path)
        text = open(path, errors='replace').read()
        n = re.search(r'name = std::string\("((?:[^"\\]|\\.)*)"', text)
        if m and n:
            names[int(m.group(1)) - 1] = n.group(1)
    return names


def conversion(opts):
    log = open(opts.convert_log, errors='replace').read()
    m = re.search(r'^convert exit (\d+)', log, re.M)
    code = int(m.group(1)) if m else None
    events = glob.glob(os.path.join(opts.gamesrc, 'events_*.cpp'))
    invalid = resolved = 0
    for path in events:
        text = open(path, errors='replace').read()
        invalid += len(re.findall(r'media\.play_id\(INVALID_ASSET_ID', text))
        resolved += len(re.findall(r'media\.play_id\(SOUND_', text))
    return {
        'status': 'OK' if code == 0 and os.path.exists(os.path.join(opts.gamesrc, 'CMakeLists.txt')) else 'FAILED',
        'exitCode': code,
        'ccnSha256': sha256(opts.ccn),
        'frames': len(frame_names(opts.gamesrc)),
        'eventFiles': len(events),
        'truncatedFramesSkipped': len(re.findall(r'^skipping truncated frame', log, re.M)),
        'omittedActions': len(re.findall(r'^action omitted', log, re.M)),
        'mp3Decoded': len(re.findall(r'MP3 decoded to WAV', log)),
        'silencedSounds': len(re.findall(r'missing -> silence', log)),
        'playSites': {'resolved': resolved, 'invalid': invalid},
    }


def boot(opts, names):
    d = opts.boot
    log = open(os.path.join(d, 'run.log'), errors='replace').read()
    m = re.findall(r'^exit (\d+)', log, re.M)
    code = int(m[-1]) if m else None
    visits, rows, stop = [], 0, None
    last = None
    for line in open(os.path.join(d, 'trace'), errors='replace'):
        seeded = re.match(r'# frame (-?\d+) seeded', line)
        if seeded:
            idx = int(seeded.group(1))
            visits.append({'frame': idx, 'name': names.get(idx, 'UNKNOWN'), 'updates': 0})
            last = visits[-1]
        elif line.startswith('# stop'):
            stop = line[2:].strip()
        elif not line.startswith('#') and line.strip():
            rows += 1
            if last is not None:
                last['updates'] += 1
    plays = 0
    at = os.path.join(d, 'audio-trace')
    if os.path.exists(at):
        plays = sum(1 for l in open(at) if not l.startswith('#') and l.split()[3:4] == ['play'])
    env = {}
    for line in open(os.path.join(d, 'env')):
        if '=' in line:
            k, v = line.rstrip('\n').split('=', 1)
            if k.startswith('CHOWDREN_') and k not in ('CHOWDREN_INPUT', 'CHOWDREN_TRACE', 'CHOWDREN_AUDIO_TRACE', 'CHOWDREN_SNAP_DIR'):
                env[k] = v
    titled = [v for v in visits if re.search(r'title|menu', v['name'], re.I)]
    crashed = code not in (0, None) or bool(re.search(r'Segmentation fault|core dumped|Aborted', log))
    return {
        'status': 'CRASH' if crashed else ('OK' if stop else 'NO_STOP_LINE'),
        'exitCode': code, 'env': env, 'updates': rows, 'stop': stop,
        'visits': visits,
        'reachedTitle': ('YES' if any(v['updates'] > 0 for v in titled) else 'NO') if names else 'UNKNOWN',
        'audioInitialized': 'Audio initialized' in log,
        'glErrors': len(re.findall(r'^Mesa: User error|^OpenGL error', log, re.M)),
        'samplePlays': plays,
    }


def apk(opts):
    out = {'status': 'OK', 'file': os.path.basename(opts.apk), 'sha256': sha256(opts.apk),
           'bytes': os.path.getsize(opts.apk), 'package': opts.package}
    if opts.libmain:
        out['libmainSha256'] = sha256(opts.libmain)
        out['libmainBytes'] = os.path.getsize(opts.libmain)
    return out


def evidence_id(result):
    body = dict(result)
    body.pop('evidenceId', None)
    text = json.dumps(body, separators=(',', ':'), ensure_ascii=False, sort_keys=True)
    return 'recompile-game-builds-%s' % hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


def first_blocker(row):
    for step in STEPS:
        s = row.get(step)
        if not isinstance(s, dict) or s.get('status') != 'OK':
            return step
    return None


def cmd_record(opts):
    result = json.load(open(opts.out)) if os.path.exists(opts.out) else {
        'schema': SCHEMA, 'claimLevel': 'MODEL_ONLY', 'fidelity': 'rebuilt-runtime',
        'question': 'Does each build-296 game convert, build for the host, boot under the harness '
                    'without input, and package as an Android APK, with its sounds reaching the mixer?',
        'rows': []}
    names = frame_names(opts.gamesrc) if os.path.isdir(opts.gamesrc) else {}
    row = {'game': opts.game, 'conversion': conversion(opts)}
    if opts.binary:
        row['host'] = {'status': 'OK', 'binarySha256': sha256(opts.binary), 'assetsSha256': sha256(opts.assets),
                       'pinned': os.path.basename(os.path.normpath(opts.pinned)) if opts.pinned else None}
    else:
        row['host'] = {'status': 'NOT_BUILT'}
    row['boot'] = boot(opts, names) if opts.boot else {'status': 'NOT_RUN'}
    row['apk'] = apk(opts) if opts.apk else {'status': 'NOT_BUILT'}
    if opts.audio:
        a = json.load(open(opts.audio))
        row['audio'] = {'evidenceId': a['evidenceId'], 'record': os.path.basename(opts.audio),
                        'declared': a['answer']['declared'], 'resolvedFiles': a['answer']['resolvedFiles'],
                        'auditionNonSilent': a['answer']['auditionNonSilent']}
    else:
        row['audio'] = 'UNKNOWN'
    row['firstFailedStep'] = first_blocker(row)
    row['blocker'] = opts.blocker
    result['rows'] = [r for r in result['rows'] if r['game'] != opts.game] + [row]
    result['rows'].sort(key=lambda r: r['game'])
    result['evidenceId'] = evidence_id(result)
    with open(opts.out, 'w') as f:
        json.dump(result, f, indent=1, sort_keys=True)
        f.write('\n')
    print('%s: %s %s' % (result['evidenceId'], opts.game,
                          ', '.join('%s %s' % (s, row[s]['status']) for s in STEPS)))


def check(path, results_dir=RESULTS):
    result = json.load(open(path))
    if result.get('schema') != SCHEMA:
        raise AssertionError('%s: schema %r' % (path, result.get('schema')))
    for row in result['rows']:
        if first_blocker(row) != row['firstFailedStep']:
            raise AssertionError('%s: %s firstFailedStep %r is not %r' % (path, row['game'], row['firstFailedStep'], first_blocker(row)))
        b = row['boot']
        if b.get('status') in ('OK', 'CRASH', 'NO_STOP_LINE'):
            if sum(v['updates'] for v in b['visits']) != b['updates']:
                raise AssertionError('%s: %s boot visits do not sum to its updates' % (path, row['game']))
        a = row['apk']
        if a.get('status') == 'OK' and not re.match(r'^[0-9a-f]{64}$', a['sha256']):
            raise AssertionError('%s: %s apk sha256 malformed' % (path, row['game']))
        if isinstance(row['audio'], dict):
            rec = os.path.join(results_dir, row['audio']['record'])
            if not os.path.exists(rec):
                raise AssertionError('%s: %s audio record %s is not committed' % (path, row['game'], row['audio']['record']))
            if json.load(open(rec))['evidenceId'] != row['audio']['evidenceId']:
                raise AssertionError('%s: %s audio evidenceId differs from %s' % (path, row['game'], rec))
    if evidence_id(result) != result['evidenceId']:
        raise AssertionError('%s: evidenceId %s is not %s' % (path, result['evidenceId'], evidence_id(result)))
    return result


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('record')
    for name in ('out', 'game', 'ccn', 'gamesrc', 'convert-log'):
        r.add_argument('--' + name, required=True)
    for name in ('binary', 'assets', 'pinned', 'boot', 'libmain', 'apk', 'package', 'audio', 'blocker'):
        r.add_argument('--' + name)
    c = sub.add_parser('check')
    c.add_argument('records', nargs='+')
    opts = ap.parse_args()
    if opts.cmd == 'record':
        cmd_record(opts)
    else:
        for path in opts.records:
            res = check(path)
            print('%s: %s rechecked (%s)' % (res['evidenceId'], path, ', '.join(
                '%s: %s' % (r['game'], r['firstFailedStep'] or 'all steps OK') for r in res['rows'])))


if __name__ == '__main__':
    main()
