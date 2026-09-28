#!/usr/bin/env python3
"""FIXTURE regressions for audio-report.py and game-builds.py, then a recheck of every
committed recompile-audio-v1 and recompile-game-builds-v1 record (no binaries needed)."""
import array
import glob
import importlib.util
import json
import math
import os
import sys
import tempfile
import wave

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


audio = load('audio-report')
builds = load('game-builds')
soundmap = load('sound-map')


def write_wave(path, segments, rate=44100):
    """segments: (seconds, peak amplitude) of a 440 Hz tone; amplitude 0 is digital silence."""
    samples = array.array('h')
    for seconds, amp in segments:
        for i in range(int(seconds * rate)):
            v = int(round(amp * math.sin(2 * math.pi * 440 * i / rate)))
            samples.extend((v, v))
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples.tobytes())


def expect_failure(fn, *args):
    try:
        fn(*args)
    except AssertionError:
        return
    raise AssertionError('expected a refusal from %s' % fn.__name__)


with tempfile.TemporaryDirectory(prefix='audio-records-') as tmp:
    # A mix: 0.5 s silence, sound 0 loud for 0.4 s, 0.3 s silence, sound 1 at peak 10 (under the floor).
    wav = os.path.join(tmp, 'mix.wav')
    write_wave(wav, [(0.5, 0), (0.4, 8000), (0.3, 0), (0.4, 10), (0.4, 0)])
    trace = os.path.join(tmp, 'audition')
    with open(trace, 'w') as f:
        f.write('# audio-trace v1\n')
        f.write('-1 0 0.5000 audition 0 start length_ms 400.0 hold_ms 400.0 rate 44100\n')
        f.write('-1 0 0.9000 audition 0 end status 2\n')
        f.write('-1 0 1.2000 audition 1 start length_ms 400.0 hold_ms 400.0 rate 44100\n')
        f.write('-1 0 1.6000 audition 1 end status 2\n')
        f.write('-1 0 1.7000 audition 2 absent\n')
    run = os.path.join(tmp, 'run')
    with open(run, 'w') as f:
        f.write('1 3 0.5000 play 0 0 1 400.0 2\n1 9 1.2000 play 1 2 0 400.0 2\n1 10 1.3000 vol 2 50\n')
    probe = os.path.join(tmp, 'probe.json')
    json.dump({'schema': 'recompile-sound-probe-v1', 'build': 296, 'handleCount': 4, 'records': 3,
               'bank': [{'index': 0, 'handle': 1, 'flags': 288, 'named': True, 'rate': 44100, 'lengthField': 0,
                         'name': 'a', 'resource': ['s0001.wav'], 'bytes': 100, 'format': 'wav'},
                        {'index': 1, 'handle': 0, 'flags': 256, 'named': True, 'rate': 44100, 'lengthField': 0,
                         'name': 'b', 'resource': ['s0000.mp3'], 'bytes': 100, 'format': 'mp3'},
                        {'index': 2, 'handle': 3, 'flags': 256, 'named': True, 'rate': 44100, 'lengthField': 0,
                         'name': 'c', 'resource': [], 'bytes': None}],
               'uses': [{}, {}], 'rawFiles': 2, 'rawWithoutRecord': [], 'frameErrors': []}, open(probe, 'w'))
    src = os.path.join(tmp, 'gamesrc')
    os.mkdir(src)
    open(os.path.join(src, 'assets.h'), 'w').write('#define SOUND_A_0 0\n#define SOUND_B_1 1\n#define SOUND_C_2 2\n')
    open(os.path.join(src, 'events_1.cpp'), 'w').write(
        '    // event 4_3\n    media.play_id(SOUND_A_0, 1-1);\n    // event 5_3\n'
        '    media.play_id(SOUND_B_1, 3-1, 0);\n    media.play_id(INVALID_ASSET_ID, 1-1);\n')
    open(os.path.join(src, 'frame1_1.cpp'), 'w').write('    name = std::string("02-title", 8);\n')
    open(os.path.join(src, 'CMakeLists.txt'), 'w').write('project(Chowdren)\n')
    out = os.path.join(tmp, 'fixture-audio.json')

    class A:
        pass
    o = A()
    o.game, o.probe, o.gamesrc, o.audition = 'fixture', probe, src, trace + ':' + wav
    o.run, o.baseline, o.scope, o.limitation, o.out = ['night:' + run + ':' + wav], ['old:' + wav], ['binarySha256=x'], None, out
    audio.cmd_record(o)
    rec = audio.check(out)
    ans = rec['answer']
    assert ans['declared'] == 3 and ans['resolvedFiles'] == 2 and ans['missingFiles'] == 1, ans
    assert ans['transcodedMp3'] == 1 and ans['handleNotIndex'] == 3, ans
    assert ans['playSites'] == 2 and ans['soundsWithPlaySites'] == 2, ans
    assert ans['auditionMeasured'] == 2 and ans['auditionNonSilent'] == 1, ans
    assert ans['run:night:plays'] == 2 and ans['run:night:soundsPlayed'] == 2, ans
    assert rec['static']['invalidPlaySites'] == 1, rec['static']
    rows = {r['assetId']: r for r in rec['rows']}
    assert rows[0]['audition']['nonSilent'] is True and rows[0]['audition']['peak'] >= 7990, rows[0]
    assert rows[1]['audition']['nonSilent'] is False and rows[1]['audition']['peak'] <= 10, rows[1]
    assert rows[2]['audition'] == {'status': 'ABSENT'}, rows[2]
    assert rows[0]['events'] == ['4_3'] and rows[1]['events'] == ['5_3'], rows
    assert rows[1]['runs']['night']['loops'] == [0], rows[1]
    assert rec['runs']['night']['traceEvents'] == {'play': 2, 'vol': 1}, rec['runs']
    # a silent mix stays silent under the thresholds: openal-soft's dither is RMS 0.5, peak 1
    assert rec['baselines']['old']['nonSilent'] is True  # the fixture mix itself is loud
    tampered = dict(rec, answer=dict(ans, auditionNonSilent=2))
    json.dump(tampered, open(out + '.bad', 'w'))
    expect_failure(audio.check, out + '.bad')
    bad_row = json.loads(json.dumps(rec))
    bad_row['rows'][1]['audition']['nonSilent'] = True
    json.dump(bad_row, open(out + '.bad2', 'w'))
    expect_failure(audio.check, out + '.bad2')
    unknown = dict(rec['rows'][0], audition='UNKNOWN')
    partial = audio.totals([unknown], [])
    assert partial['auditionMeasured'] == 0 and partial['auditionNonSilent'] == 0, partial
    print('audio-report fixture: OK')

    # game-builds: one row from synthetic step outputs, its audio record in a scratch results dir.
    results = os.path.join(tmp, 'results')
    os.mkdir(results)
    os.rename(out, os.path.join(results, 'fixture-audio.json'))
    log = os.path.join(tmp, 'convert.log')
    open(log, 'w').write('skipping truncated frame: 29\naction omitted for unsupported expression: X\nconvert exit 0\n')
    boot_dir = os.path.join(tmp, 'boot')
    os.mkdir(boot_dir)
    open(os.path.join(boot_dir, 'trace'), 'w').write(
        '# frame tick draws graine values...\n# frame 0 seeded 1\n0 0 1 1 0\n0 1 1 1 0\n'
        '# stop total ticks 2 frame 0 tick 2\n')
    open(os.path.join(boot_dir, 'run.log'), 'w').write('Audio initialized: 1.1 ALSOFT\nexit 0\n')
    open(os.path.join(boot_dir, 'env'), 'w').write('CHOWDREN_HARNESS=1\nCHOWDREN_TRACE=x\nALSOFT_DRIVERS=null\n')
    open(os.path.join(boot_dir, 'audio-trace'), 'w').write('# v1\n0 0 0.1 play 0 0 1 10.0 2\n')
    apk = os.path.join(tmp, 'g.apk')
    open(apk, 'wb').write(b'PK')
    ccn = os.path.join(tmp, 'app.ccn')
    open(ccn, 'wb').write(b'PAMU')
    rec_path = os.path.join(tmp, 'builds.json')
    g = A()
    g.out, g.game, g.ccn, g.gamesrc, g.convert_log = rec_path, 'fixture', ccn, src, log
    g.binary, g.assets, g.pinned, g.boot = apk, ccn, os.path.join(tmp, 'pinned', 'abcd-ef01'), boot_dir
    g.libmain, g.apk, g.package, g.audio, g.blocker = apk, apk, 'org.fixture.play', os.path.join(results, 'fixture-audio.json'), None
    builds.cmd_record(g)
    res = builds.check(rec_path, results)
    row = res['rows'][0]
    assert row['firstFailedStep'] is None, row
    assert row['conversion']['frames'] == 1 and row['conversion']['truncatedFramesSkipped'] == 1, row['conversion']
    assert row['conversion']['playSites'] == {'resolved': 2, 'invalid': 1}, row['conversion']
    assert row['boot']['updates'] == 2 and row['boot']['visits'] == [{'frame': 0, 'name': '02-title', 'updates': 2}], row['boot']
    assert row['boot']['reachedTitle'] == 'YES' and row['boot']['samplePlays'] == 1, row['boot']
    assert row['boot']['env'] == {'CHOWDREN_HARNESS': '1'}, row['boot']['env']
    assert row['host']['pinned'] == 'abcd-ef01', row['host']
    # a second game without an APK: its first failed step is the apk
    g.game, g.apk, g.libmain, g.blocker = 'fixture2', None, None, 'no NDK in the fixture'
    builds.cmd_record(g)
    res = builds.check(rec_path, results)
    assert [r['game'] for r in res['rows']] == ['fixture', 'fixture2'], res['rows']
    assert res['rows'][1]['firstFailedStep'] == 'apk' and res['rows'][1]['apk'] == {'status': 'NOT_BUILT'}, res['rows'][1]
    broken = json.load(open(rec_path))
    broken['rows'][1]['firstFailedStep'] = None
    json.dump(broken, open(rec_path + '.bad', 'w'))
    expect_failure(builds.check, rec_path + '.bad', results)
    expect_failure(builds.check, rec_path, tmp)          # its audio record is not in that results dir
    print('game-builds fixture: OK')

    # sound-map: a two-record table checked from its rows; a file keyed by bank
    # index, a declared length off its file, or a lost anchor is refused.
    def smrow(handle, index, length, dur):
        return {'handle': handle, 'bankIndex': index, 'name': 'n%d' % handle, 'flags': 256,
                'declaredLengthMs': length, 'declaredRate': 44100, 'file': 's%04d.wav' % handle,
                'fileSha256': '0' * 64, 'fileDurationMs': dur, 'fileRate': 44100, 'fileChannels': 1,
                'fileCodec': 'pcm_s16le', 'indexFile': 's%04d.wav' % index,
                'declaredMatchesHandleFile': abs(dur - length) <= 30, 'declaredMatchesIndexFile': False,
                'assetId': index, 'define': 'SOUND_N_%d' % index, 'sampleParameters': 1, 'events': ['1_3'],
                'audition': {'decodedLengthMs': dur, 'nccHandleFile': 0.99, 'nccIndexFile': 0.05}}
    rows = [smrow(1, 0, 1000, 1001.0), smrow(0, 1, 500, 510.0)]
    anchors = [{'handle': 1, 'file': 's0001', 'note': 'fixture', 'mappedFile': 's0001.wav', 'reproduced': True}]
    sm = {'schema': soundmap.SCHEMA, 'game': 'fixture', 'claimLevel': 'MODEL_ONLY', 'fidelity': 'rebuilt-runtime',
          'rule': 'x', 'lengthToleranceMs': 30, 'handleCount': 2, 'rows': rows, 'anchors': anchors, 'soloCaptures': {}}
    sm['summary'] = soundmap.summarize(rows, anchors)
    sm['evidenceId'] = soundmap.evidence_id(sm)
    sm_path = os.path.join(tmp, 'sm.json')
    json.dump(sm, open(sm_path, 'w'))
    res = soundmap.check(sm_path)
    assert res['summary']['handleNotIndex'] == 2 and res['summary']['declaredLengthMatchesHandleFile'] == 2, res['summary']
    assert res['summary']['auditionBetterOnHandleFile'] == 2 and res['summary']['anchorsReproduced'] == 1, res['summary']
    for mutate in (lambda d: d['rows'][0].update(file='s0000.wav'),
                   lambda d: d['rows'][1].update(fileDurationMs=900.0),
                   lambda d: d['anchors'][0].update(file='s0002'),
                   lambda d: d['rows'][0].update(assetId=5)):
        bad = json.loads(json.dumps(sm))
        mutate(bad)
        json.dump(bad, open(sm_path + '.bad', 'w'))
        expect_failure(soundmap.check, sm_path + '.bad')
    print('sound-map fixture: OK')

# The committed records, rechecked from their rows alone.
for path in sorted(glob.glob(os.path.join(HERE, 'results', '*.json'))):
    try:
        schema = json.load(open(path)).get('schema')
    except ValueError:
        continue
    if schema == audio.SCHEMA:
        r = audio.check(path)
        print('%s: %s rechecked' % (r['evidenceId'], os.path.basename(path)))
    elif schema == builds.SCHEMA:
        r = builds.check(path)
        print('%s: %s rechecked' % (r['evidenceId'], os.path.basename(path)))
    elif schema == soundmap.SCHEMA:
        r = soundmap.check(path)
        print('%s: %s rechecked (%d/%d anchors)' % (r['evidenceId'], os.path.basename(path),
                                                    r['summary']['anchorsReproduced'], r['summary']['anchors']))
print('test-audio-records: PASS')
