# Python 2.7 + the patched mmfparser. Lists a build-296 mobile CCN's sound bank
# (handle space, records: bank index, handle, flags, rate, name) and every
# Sample event parameter (frame, group, ACE, handle, name as stored), and
# matches each handle to its res/raw file by the runtime's own rule
# (SoundPoolSounds.load: res/raw/s%04d by handle). Prints one JSON object.
# Content-free: names, handles, sizes and magic numbers only; no audio.
#
#   PYTHONDONTWRITEBYTECODE=1 python probe-sounds.py <anaconda> <application.ccn> [<res/raw dir>]
import glob
import json
import os
import sys

sys.path.insert(0, sys.argv[1])
from mmfparser.bytereader import ByteReader
from mmfparser.data.gamedata import GameData

MAGIC = {'RIFF': 'wav', 'OggS': 'ogg', 'ID3': 'mp3', 'fLaC': 'flac', 'MThd': 'midi'}


def magic_of(path):
    with open(path, 'rb') as f:
        head = f.read(4)
    for k, v in MAGIC.items():
        if head.startswith(k):
            return v
    if len(head) >= 2 and ord(head[0]) == 0xff and (ord(head[1]) & 0xe0) == 0xe0:
        return 'mp3'
    return 'unknown:' + head.encode('hex')


def main():
    raw_dir = sys.argv[3] if len(sys.argv) > 3 else None
    # The parser prints its notes ("(unknown chunk ...)") to stdout; keep
    # stdout for the one JSON object.
    out_stream, sys.stdout = sys.stdout, sys.stderr
    game = GameData(ByteReader(open(sys.argv[2], 'rb')), loadImages=False)
    bank = []
    sounds = game.sounds
    for index, s in enumerate(sounds.items if sounds else []):
        row = {'index': index, 'handle': s.handle, 'flags': s.flags,
               'named': bool(s.flags & 0x100), 'rate': s.sampleRate,
               'lengthField': s.checksum,
               'name': s.name.decode('utf-8') if isinstance(s.name, str) else s.name}
        if raw_dir:
            found = sorted(glob.glob(os.path.join(raw_dir, 's%04d.*' % s.handle)))
            row['resource'] = [os.path.basename(p) for p in found]
            if len(found) == 1:
                row['bytes'] = os.path.getsize(found[0])
                row['format'] = magic_of(found[0])
        bank.append(row)
    uses = []
    frame_errors = []
    for fi, frame in enumerate(game.frames):
        try:
            frame.load()
        except Exception as e:
            frame_errors.append({'frame': fi, 'error': str(e)[:120]})
            continue
        if not frame.events:
            continue
        for gi, grp in enumerate(frame.events.items):
            for kind, aces in (('condition', grp.conditions), ('action', grp.actions)):
                for ace in aces:
                    for p in ace.items:
                        if type(p.loader).__name__ != 'Sample':
                            continue
                        try:
                            name = str(ace.getName())
                        except Exception:
                            name = '?'
                        uses.append({'frame': fi, 'group': gi, 'kind': kind, 'ace': name,
                                     'handle': p.loader.handle,
                                     'flags': p.loader.flags.getFlags()})
    out = {'schema': 'recompile-sound-probe-v1', 'build': game.productBuild,
           'handleCount': getattr(sounds, 'handleCount', None) if sounds else None,
           'records': len(bank), 'bank': bank, 'uses': uses,
           'frameErrors': frame_errors}
    if raw_dir:
        files = sorted(os.path.basename(p) for p in glob.glob(os.path.join(raw_dir, 's[0-9][0-9][0-9][0-9].*')))
        handles = set(b['handle'] for b in bank)
        out['rawFiles'] = len(files)
        out['rawWithoutRecord'] = [f for f in files if int(f[1:5]) not in handles]
    sys.stdout = out_stream
    print json.dumps(out, sort_keys=True)


if __name__ == '__main__':
    main()
