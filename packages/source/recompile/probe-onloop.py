import sys
sys.path.append('/work')
from mmfparser.bytereader import ByteReader
from mmfparser.data.gamedata import GameData

g = GameData(ByteReader(open('/input/application.ccn', 'rb')), loadImages=False)

for fi, frame in enumerate(g.frames):
    try:
        frame.load()
    except Exception as e:
        continue
    ev = frame.events
    if not ev:
        continue
    for gi, grp in enumerate(ev.items):
        for ci, cond in enumerate(grp.conditions):
            try:
                nm = cond.getName()
            except Exception:
                nm = '?'
            if 'oop' not in str(nm) and cond.objectType != -1:
                continue
            if str(nm) not in ('OnLoop', 'On Loop') and not (cond.objectType == -1 and cond.num in (-16,)):
                continue
            print 'frame %d grp %d cond %d/%d  name=%s objectType=%d num=%d  %d params' % (
                fi, gi, ci, len(grp.conditions), nm, cond.objectType, cond.num,
                len(cond.items))
            for pi, p in enumerate(cond.items):
                ld = p.loader
                info = type(ld).__name__ if ld is not None else 'None'
                extra = ''
                if hasattr(ld, 'items'):
                    extra = ' items=%d' % len(ld.items)
                    for ex in ld.items[:4]:
                        extra += ' <exp ot=%d num=%d>' % (ex.objectType, ex.num)
                if hasattr(ld, 'value'):
                    extra = ' value=%r' % ld.value
                if getattr(p, 'raw', None) is not None:
                    extra = ' RAW[%d]=%s' % (len(p.raw), p.raw.encode('hex'))
                print '   param %d: code=%d loader=%s%s' % (pi, p.code, info, extra)
