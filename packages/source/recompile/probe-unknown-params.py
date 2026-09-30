import sys
sys.path.append('/work')
from mmfparser.bytereader import ByteReader
from mmfparser.data.gamedata import GameData
from mmfparser.data.chunkloaders.parameters.names import getName as pname

g = GameData(ByteReader(open('/input/application.ccn', 'rb')), loadImages=False)

seen = {}
for fi, frame in enumerate(g.frames):
    try:
        frame.load()
    except Exception as e:
        print 'frame %d load failed: %r' % (fi, e)
        continue
    events = getattr(frame, 'events', None)
    if not events:
        continue
    for gi, grp in enumerate(events.items):
        for kind, aces in (('C', grp.conditions), ('A', grp.actions)):
            for ace in aces:
                try:
                    tn = ace.getTypeName()
                except Exception:
                    tn = '?'
                for pi, p in enumerate(ace.items):
                    if getattr(p, 'raw', None) is None:
                        continue
                    key = (p.code, ace.objectType, ace.num, kind)
                    rec = (fi, gi, tn, ace.objectType, ace.num, pi,
                           len(ace.items), p.size, p.raw)
                    seen.setdefault(key, []).append(rec)

for key in sorted(seen):
    code, ot, num, kind = key
    recs = seen[key]
    print '=== code %d  %s objectType=%d num=%d  (%d occurrences) ===' % (
        code, kind, ot, num, len(recs))
    for (fi, gi, tn, ot, num, pi, npar, size, raw) in recs[:6]:
        print '  frame %d grp %d  %s  param %d/%d  size=%d  raw[%d]=%s' % (
            fi, gi, tn, pi, npar, size, len(raw), raw.encode('hex'))
