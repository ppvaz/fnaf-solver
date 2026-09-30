#!/usr/bin/env python3
"""Per-cycle ledger of when the phone's own frames show each control acting, against the update the replayed
contact acts on in a rebuild trace (ROADMAP S2b: did the replayed contacts register when the phone's did?).

usage: phone-input-ledger.py TRACE.tsv FIRST_ROW REBUILD_TRACE [--cycles N] [--period-ms 10000] [--json OUT]

Phone side (fnaf2-frame-trace-v3): the office update clock is the retained reconstruction (update 0 = the first
night frame, each later interval 1-3 updates under Fusion's catch-up), so every frame names the first update of
the pass that drew it. Per cycle the first frame of: the bottom-control signature turning `monitor-up` and back
to `office` (packages/adapters/src/button-strokes.js thresholds, 100 visible / 40 absent), the signature turning
`mask-on` and back, the office view brightening by 3 or more grid-mean-luma over the previous office frames (the
hall flash) and darkening again, and the window's right-eyehole occupant while the mask is on (grid cells rows 3-5,
columns 11-18 of the 20x9 RGB grid: hue 230-285 Withered Bonnie, hue 20-50 at saturation >= 0.55 Withered Chica).
Rebuild side: the first update of the same cycle where `viewing` > 0 / back to 0, the mask watch value != 0 / back
to 0, `viewing hall light` > 0 / back to 0, and `in danger` > 0 with the `in office` overlap letter.
A difference is phone update minus rebuild update; a display frame lags the update that drew it by an unmeasured
one or two frames, so differences within about 2 updates are not registration differences. DEVICE_MEASURED
frames against a MODEL_ONLY replay; nothing here is a phone claim about the game's rules."""
import argparse, bisect, colorsys, hashlib, json, sys

FRAME_MS = 1000 / 60
VISIBLE_MIN, ABSENT_MAX = 100, 40           # button-strokes.js
FLASH_LUMA_STEP, FLASH_BASELINE_FRAMES = 3, 25
EYEHOLE = (range(3, 6), range(11, 19))
OCCUPANT_MIN_CELLS, CELL_LUMA_MIN = 10, 6

def read_trace(path):
    with open(path) as f:
        head = f.readline()
        if not head.startswith('# schema=fnaf2-frame-trace-v'): raise SystemExit('not a fnaf2 frame trace')
        hdr = f.readline().rstrip('\n').split('\t')
        rows = [line.rstrip('\n').split('\t') for line in f if line.strip()]
    return hdr, rows

def office_clock(image_ns, first):
    deltas, pass_start = [FRAME_MS], [0]
    for k in range(first + 1, len(image_ns)):
        dt = (image_ns[k] - image_ns[k - 1]) / 1e6
        if dt <= 0: raise SystemExit(f'frame trace not increasing at row {k}')
        pass_start.append(len(deltas)); n = max(1, min(3, round(dt / FRAME_MS)))
        deltas.append(dt - (n - 1)); deltas.extend([1.0] * (n - 1))
    cum = [0.0]
    for d in deltas: cum.append(cum[-1] + d)
    return deltas, pass_start, cum

def signature(mask_ds, monitor_ds):
    if mask_ds >= VISIBLE_MIN and monitor_ds >= VISIBLE_MIN: return 'office'
    if mask_ds <= ABSENT_MAX and monitor_ds >= VISIBLE_MIN: return 'monitor-up'
    if mask_ds >= VISIBLE_MIN and monitor_ds <= ABSENT_MAX: return 'mask-on'
    return None

def eyehole_letter(grid_hex):
    b = bytes.fromhex(grid_hex); R = G = B = 0; n = 0
    for r in EYEHOLE[0]:
        for c in EYEHOLE[1]:
            rr, gg, bb = b[(r * 20 + c) * 3:(r * 20 + c) * 3 + 3]
            if 0.299 * rr + 0.587 * gg + 0.114 * bb >= CELL_LUMA_MIN: R += rr; G += gg; B += bb; n += 1
    if n < OCCUPANT_MIN_CELLS: return None
    h, s, _ = colorsys.rgb_to_hsv(R / n / 255, G / n / 255, B / n / 255); h *= 360
    if 230 <= h <= 285: return 'B'
    if 20 <= h <= 50 and s >= 0.55: return 'C'
    return None

def read_rebuild(path, frame, until_update):
    viewing, hall, danger, mask, occ = {}, {}, {}, {}, {}
    names = None
    with open(path) as f:
        for line in f:
            if not line.startswith('# '): continue
            p = line.split()
            if p[1] == 'overlaps': names = line.rstrip('\n')[len('# overlaps '):].split(':', 1)[1].split(','); continue
            if len(p) < 4 or p[2] != str(frame) or not p[3].isdigit(): continue
            u = int(p[3])
            if u > until_update: break
            if p[1] == 'counter':
                danger[u] = p[5] != '-' and int(p[5]) > 0; viewing[u] = p[7] != '-' and int(p[7]) > 0; hall[u] = p[8] != '-' and int(p[8]) > 0
            elif p[1] == 'overlap':
                vals = p[4:]; letter = None
                for nm, lt in (('old bonnie', 'B'), ('old chica', 'C'), ('old freddy', 'F'), ('new freddy', 'f')):
                    if nm in names and vals[names.index(nm)] == '1': letter = lt; break
                occ[u] = letter
            elif p[1] == 'watch':
                mask[u] = int(p[12])
    return viewing, hall, danger, mask, occ

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('trace'); ap.add_argument('first', type=int); ap.add_argument('rebuild')
    ap.add_argument('--cycles', type=int, default=7); ap.add_argument('--period-ms', type=float, default=10000)
    ap.add_argument('--mask-window-ms', type=float, default=4270, help='the window mask-on offset inside a cycle (the k3 route)')
    ap.add_argument('--frame', type=int, default=3); ap.add_argument('--json')
    a = ap.parse_args()
    hdr, rows = read_trace(a.trace); ix = {n: i for i, n in enumerate(hdr)}
    image_ns = [int(r[ix['image_ns']]) for r in rows]
    deltas, pass_start, cum = office_clock(image_ns, a.first)
    t = [(ns - image_ns[a.first]) / 1e6 for ns in image_ns]
    T = t[a.first:]
    sig = [signature(int(r[ix['mask_downstroke']]), int(r[ix['monitor_downstroke']])) for r in rows]
    mean = [int(r[ix['grid_mean_luma']]) for r in rows]
    until = int(a.cycles * a.period_ms / FRAME_MS) + 400
    viewing, hall, danger, mask, occ = read_rebuild(a.rebuild, a.frame, until)
    def flash(k):
        if sig[k] != 'office': return False
        prev = sorted(mean[j] for j in range(max(a.first, k - FLASH_BASELINE_FRAMES), k) if sig[j] == 'office')
        return len(prev) >= 8 and mean[k] >= prev[len(prev) // 2] + FLASH_LUMA_STEP
    def first_k(pred, k0, k1):
        for k in range(k0, k1):
            if pred(k): return k
    def first_u(pred, u0, u1):
        for u in range(u0, u1):
            if pred(u): return u
    def pk(k): return None if k is None else {'row': k, 'update': pass_start[k - a.first], 'ms': round(t[k], 1)}
    def pu(u): return None if u is None else {'update': u, 'ms': round(cum[u], 1)}
    cycles = []
    for cyc in range(a.cycles):
        base = cyc * a.period_ms
        k0 = bisect.bisect_left(T, base - 600) + a.first; k1 = bisect.bisect_left(T, base + a.period_ms - 500) + a.first
        u0 = bisect.bisect_left(cum, base - 600); u1 = bisect.bisect_left(cum, base + a.period_ms - 500)
        p_up = first_k(lambda k: sig[k] == 'monitor-up', k0, k1); p_dn = first_k(lambda k: sig[k] == 'office', p_up, k1) if p_up else None
        p_fl = first_k(flash, k0, k1); p_floff = first_k(lambda k: not flash(k), p_fl, k1) if p_fl else None
        # the window's mask: the first mask-on signature at or after the cycle's window offset
        kw = bisect.bisect_left(T, base + a.mask_window_ms - 300) + a.first
        p_mask = first_k(lambda k: sig[k] == 'mask-on', kw, k1); p_maskoff = first_k(lambda k: sig[k] == 'office', p_mask, k1) if p_mask else None
        p_occ = None
        if p_mask:
            for k in range(p_mask, min(k1, p_mask + 150)):
                letter = eyehole_letter(rows[k][ix['grid_hex']])
                if letter: p_occ = {'row': k, 'update': pass_start[k - a.first], 'ms': round(t[k], 1), 'letter': letter}; break
        r_up = first_u(lambda u: viewing.get(u, False), u0, u1); r_dn = first_u(lambda u: not viewing.get(u, True), r_up, u1) if r_up else None
        r_fl = first_u(lambda u: hall.get(u, False), u0, u1); r_floff = first_u(lambda u: not hall.get(u, True), r_fl, u1) if r_fl else None
        uw = bisect.bisect_left(cum, base + a.mask_window_ms - 300)
        r_mask = first_u(lambda u: mask.get(u, 0) != 0, uw, u1); r_maskoff = first_u(lambda u: mask.get(u, 1) == 0, r_mask, u1) if r_mask else None
        r_occ = first_u(lambda u: danger.get(u, False), u0, u1)
        def diff(k, u): return None if (k is None or u is None) else pass_start[k - a.first] - u
        events = {}
        for name, k, u in (('hallFlashOn', p_fl, r_fl), ('hallFlashOff', p_floff, r_floff), ('monitorUp', p_up, r_up), ('monitorDown', p_dn, r_dn),
                           ('maskOn', p_mask, r_mask), ('maskOff', p_maskoff, r_maskoff)):
            events[name] = {'phone': pk(k), 'rebuild': pu(u), 'phoneMinusRebuildUpdates': diff(k, u)}
        cycles.append({'cycle': cyc, 'window': cyc, 'events': events,
                       'occupant': {'phone': p_occ, 'rebuild': ({**pu(r_occ), 'letter': occ.get(r_occ)} if r_occ else None)}})
    sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
    out = {'schema': 'phone-input-ledger-v1', 'claimLevel': 'DEVICE_MEASURED frames against a MODEL_ONLY replay',
           'inputs': {'frameTrace': {'path': a.trace, 'sha256': sha(a.trace), 'first': a.first}, 'rebuildTrace': {'path': a.rebuild, 'sha256': sha(a.rebuild)}},
           'rule': {'signatureThresholds': {'visibleMin': VISIBLE_MIN, 'absentMax': ABSENT_MAX}, 'flashLumaStep': FLASH_LUMA_STEP,
                    'eyeholeCells': 'rows 3-5, columns 11-18', 'periodMs': a.period_ms, 'maskWindowMs': a.mask_window_ms,
                    'displayLagNote': 'a frame lags the update that drew it by an unmeasured 1-2 frames'},
           'cycles': cycles}
    print(f'{"cyc":>3} {"event":14} {"phone upd":>10} {"rebuild upd":>12} {"diff":>6}')
    for c in cycles:
        for name, e in c['events'].items():
            p = e['phone']['update'] if e['phone'] else '-'; r = e['rebuild']['update'] if e['rebuild'] else '-'
            d = e['phoneMinusRebuildUpdates']; print(f'{c["cycle"]:>3} {name:14} {p:>10} {r:>12} {("%+d" % d) if d is not None else "":>6}')
        o = c['occupant']; print(f'{c["cycle"]:>3} {"occupant":14} {(o["phone"]["letter"] + "@" + str(o["phone"]["update"])) if o["phone"] else "-":>10} {(str(o["rebuild"]["letter"]) + "@" + str(o["rebuild"]["update"])) if o["rebuild"] else "-":>12}')
    if a.json:
        with open(a.json, 'w') as f: json.dump(out, f, indent=1); f.write('\n')

if __name__ == '__main__':
    sys.exit(main())
