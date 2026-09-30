#!/usr/bin/env python3
"""Regression for the alive/dead authority and the lifecycle refinement.

`screenstate.py` decides whether a night is running, and everything downstream
trusts it. On 2026-08-26 it was found to answer `night` to the "HELP WANTED"
newspaper -- the cutscene a New Game plays -- because that screen is bright
everywhere and the flashlight-meter test therefore passes. No route had ever
pressed New Game, so the gap had never been reachable; plans/13's fresh-save
ladder makes it reachable.

These fixtures are synthetic and prove the DECISION, not the thresholds. The
thresholds are measured on the phone and recorded in screenstate.py's docstring.
"""
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

warnings.simplefilter("ignore")
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
GEOMETRY = (2400, 1080)


def frame(bg, flash=False, maskbar=False):
    im = Image.new("RGB", GEOMETRY, bg)
    d = ImageDraw.Draw(im)
    if flash:                                  # the lit flashlight meter
        d.rectangle((95, 40, 260, 95), fill=(230, 230, 230))
    if maskbar:                                # the pink mask bar
        d.rectangle((70, 1000, 1180, 1045), fill=(200, 90, 120))
    return im


def striped_card(bg):
    """Full-width white stripes at the meter's height and mid-frame, black at y 500 and 700."""
    im = Image.new("RGB", GEOMETRY, (0, 0, 0))
    d = ImageDraw.Draw(im)
    for y0, y1 in ((62, 454), (594, 668), (757, 945)):
        d.rectangle((0, y0, GEOMETRY[0], y1), fill=(255, 255, 255))
    return im


def gameover_frame(bg, portraits=False):
    """The game over decision's two features, and the dial screen's third.

    Solid fills, not measured shapes: the face box wants red at >5% and the
    text box bright at >8% of a 32x32 downsample, so a 400x300 red block and
    16-of-80 px white bars clear both by a wide margin. The portraits are five
    grey blocks across the top band; the real band reads 0.215 bright against
    the 0.000 of every real game over, and the fixture only has to be on the
    same side of GAMEOVER_TOP_BRIGHT_MAX as the real dial screen."""
    im = frame(bg)
    d = ImageDraw.Draw(im)
    d.rectangle((1000, 550, 1400, 850), fill=(180, 40, 40))
    for x in range(920, 1430, 80):
        d.rectangle((x, 960, x + 16, 1030), fill=(255, 255, 255))
    if portraits:
        # Clear of the flashlight-meter box (x < 260): a bright block there
        # would make the fixture a night, not a dial screen.
        for i in range(5):
            x = 320 + i * 420
            d.rectangle((x, 50, x + 300, 250), fill=(150, 150, 150))
    return im


def noise_frame(seed=12345):
    """Deterministic per-pixel noise: the death static's signature is roughness,
    not brightness. The real one is DARK (frame mean 34.1), the same as the
    office, so a brightness test cannot separate them."""
    im = Image.new("L", (2400, 1080))
    px = im.load()
    state = seed
    for y in range(1080):
        for x in range(0, 2400, 1):
            state = (state * 1103515245 + 12345) & 0x7FFFFFFF
            px[x, y] = (state >> 16) % 90
    return im.convert("RGB")


def lifecycle(im, tmp):
    path = f"{tmp}/l.png"
    im.save(path)
    with open(path, "rb") as fh:
        out = subprocess.run([sys.executable, str(HERE / "lifecycle-observe.py")],
                             stdin=fh, capture_output=True, text=True, check=False)
    return out.stdout.strip()


def verdict(im, tmp):
    path = f"{tmp}/f.png"
    im.save(path)
    with open(path, "rb") as fh:
        out = subprocess.run([sys.executable, str(HERE / "screenstate.py")],
                             stdin=fh, capture_output=True, text=True, check=False)
    return out.stdout.strip()


def main():
    failed = 0
    dark, bright = (14, 14, 16), (200, 200, 198)
    with tempfile.TemporaryDirectory() as tmp:
        cases = [
            ("a dark office with a lit meter", frame(dark, flash=True), "night"),
            ("a dark office with the mask bar", frame(dark, maskbar=True), "night"),
            ("a dark screen with neither", frame(dark), "other"),
            # The regression. Bright everywhere, so the meter test passes on
            # brightness that is not a meter. It must not read as a night.
            ("a uniformly bright cutscene", frame(bright, flash=True), "other"),
            ("a uniformly bright screen", frame(bright), "other"),
            # The Night 7 intro card animating in (2026-09-14): full-width white
            # stripes, one across the flashlight meter, black at both global rows.
            # Six real cards read `night` and authorized the anchor early.
            ("the striped intro card", striped_card(dark), "other"),
            # The game over screen: red face mid-frame, bright text below it,
            # black above. The Custom Night dial screen has the same two
            # features (orange arrows and red portraits in the face box, the
            # white preset name in the text box) plus a band of bright
            # portraits along the top, and read as a game over on 2026-09-13,
            # which pulled the frame trace before the night began.
            ("a game over: red face, bright text, black above",
             gameover_frame(dark), "gameover"),
            ("the Custom Night dial screen: the same plus bright portraits",
             gameover_frame(dark, portraits=True), "other"),
        ]
        for name, im, want in cases:
            got = verdict(im, tmp)
            if got != want:
                print(f"FAIL {name}: expected {want!r}, got {got!r}")
                failed += 1
        # --- the lifecycle refinement, which adds classes and never overrides
        # the authority. The death path this reproduces was captured on a real
        # Night 1: night -> static -> gameover -> title, every frame named.
        # Text, not solid blocks. The real logo box overlaps screenstate's
        # flashlight box, and the real logo is thin strokes -- that box means
        # 40.8 on a title screen, well under the 90 that would call it a night.
        # A solid fill there makes the fixture a night, which is what the first
        # version of this test did.
        # Bars wide enough to survive the classifier's 32-column downsample --
        # a 2 px bar averages to grey and vanishes -- but sparse enough that the
        # box mean stays under screenstate's 90. 16 px every 80 px is 20%
        # coverage: mean about 51, bright fraction about 0.16 against a 0.05
        # threshold. The real logo measures 40.8 and 0.112.
        def strokes(draw, box, step=80, bar=16):
            x0, y0, x1, y1 = box
            for x in range(x0, x1 - bar, step):
                draw.rectangle((x, y0, x + bar, y1), fill=(255, 255, 255))

        d = ImageDraw.Draw
        title = frame(dark)
        t = d(title); strokes(t, (150, 40, 560, 140)); strokes(t, (1780, 830, 2310, 900))
        dialog = frame(dark)
        strokes(d(dialog), (150, 40, 560, 140))
        options = frame(dark)
        strokes(d(options), (1530, 100, 2030, 220))
        # --- the two dark screens, package 3's subject.
        #
        # Both are near-black with bright text in the clock band; what parts
        # them is the win confetti, which reads EXACTLY zero on sixteen real
        # intro frames from two recordings and 0.059+ on every real 6 AM frame.
        # These fixtures prove the DECISION, not the thresholds -- the numbers
        # come from the real capture and are recorded in lifecycle-observe.py.
        #
        # `black` has to be genuinely near-black: the `dark` used elsewhere in
        # this file means about 14, which is above the model's darkMeanMax of 5,
        # so reusing it would have made every case below fall through and pass
        # for the wrong reason.
        black = (2, 2, 2)

        def clock_text(im):
            """Bright glyphs where the clock sits: y 0.42-0.54, x 0.39-0.61.

            Thin strokes with gaps, not solid blocks. A seven-segment clock
            covers a wide span of COLUMNS while filling very little area -- the
            real 6 AM frame reads 0.153-0.203 clock columns at a frame mean of
            only 1.8-2.4. Solid blocks over the same span push the mean past the
            model's darkMeanMax of 5, which is exactly how the first version of
            this fixture failed: it stopped being a dark screen at all.
            """
            dr = d(im)
            for x in range(900, 1500, 10):
                dr.rectangle((x, 486, x + 6, 512), fill=(255, 255, 255))

        def confetti(im):
            """Saturated colour in the upper half. The intro card has none.

            Deliberately sparse. The threshold it must beat is 0.02% of the
            sampled upper half, and real confetti reads 0.059-0.326% -- so a
            dense field is not more faithful, it just drags the frame mean past
            darkMeanMax and stops the fixture being a dark screen at all.
            """
            dr = d(im)
            for i, c in enumerate(((240, 60, 60), (60, 240, 90), (70, 90, 245),
                                   (245, 230, 60), (240, 80, 220))):
                for j in range(5):
                    x = 200 + i * 430 + j * 70
                    y = 60 + ((i + j) % 5) * 74
                    dr.rectangle((x, y, x + 12, y + 12), fill=c)

        intro_card = frame(black); clock_text(intro_card)
        sixam = frame(black); clock_text(sixam); confetti(sixam)
        fade = frame(black)

        lifecycle_cases = [
            ("the story-night intro card", intro_card, "state=intro"),
            ("6 AM, which is the intro card plus win confetti", sixam, "state=sixam"),
            ("a fade is dark with no text, and says so", fade,
             "unknown=dark-frame-no-text"),
            ("static is roughness, not brightness", noise_frame(), "state=static"),
            ("the New Game newspaper", frame(bright, flash=True), "state=newspaper"),
            ("the title menu", title, "state=title"),
            ("the New Game confirmation", dialog, "state=titleDialog"),
            ("the Options screen", options, "state=options"),
            ("a night is left to the authority", frame(dark, flash=True), "state=night"),
            ("a game over is the authority's too", gameover_frame(dark), "state=gameover"),
        ]
        with tempfile.TemporaryDirectory() as tmp2:
            for name, im, want in lifecycle_cases:
                got = lifecycle(im, tmp2)
                if got != want:
                    print(f"FAIL lifecycle {name}: expected {want!r}, got {got!r}")
                    failed += 1
            # Whatever the dial screen is called, it is not a game over: that
            # label ends a night in night-run.sh's trace watcher.
            got = lifecycle(gameover_frame(dark, portraits=True), tmp2)
            if got == "state=gameover":
                print("FAIL lifecycle the Custom Night dial screen reads as a game over")
                failed += 1
        # --- the two callers must agree, at their two geometries.
        #
        # This is the control that would have caught the drift. grade-night.py
        # carried a hand copy of the predicate whose docstring said "frame for
        # frame" -- and stopped being that the moment screenstate gained the
        # global-brightness guard and the copy did not. It is the tool that
        # produces the only number that is a run length.
        sys.path.insert(0, str(HERE))
        import nightpredicate

        def video_frame(rgb, meter=False):
            """A raw 1280x576 RGB buffer, the geometry grade-night.py reads."""
            w, h = 1280, 576
            buf = bytearray(bytes(rgb) * (w * h))
            if meter:
                fx0, fy0, fx1, fy1 = nightpredicate.FLASH
                for y in range(int(fy0 * h), int(fy1 * h)):
                    for x in range(int(fx0 * w), int(fx1 * w)):
                        i = (y * w + x) * 3
                        buf[i:i + 3] = bytes((230, 230, 230))
            return bytes(buf)

        import importlib.util

        def load(name, filename):
            spec = importlib.util.spec_from_file_location(name, HERE / filename)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod

        gn = load("gn", "../../../../../tools/device/grade-night.py")
        dc = load("dc", "../../../../../tools/device/death-census.py")
        ss = load("ss", "screenstate.py")

        def watch_rows(rgb, meter=False):
            """The twelve RGBA scanlines `--adb-fast` pulls off the phone.

            The live watchdog path had no test at all: the audit that found the
            rule stated four times noted it "is never run", and it was the copy
            still carrying its own thresholds. It is in the agreement loop now,
            so the path that decides whether the phone is alive is checked by
            the same rows as the two that only read recordings."""
            ys = ss._covers((45, 55, 65, 75, 85, 1004, 1014, 1024, 1034, 1044,
                             500, 700))
            rows = []
            for y in ys:
                row = bytearray(bytes((*rgb, 255)) * ss.DEVICE_W)
                if meter and 40 <= y < 95:
                    for x in range(95, 260):
                        row[x * 4:x * 4 + 4] = bytes((230, 230, 230, 255))
                rows.append(bytes(row))
            return ys, rows

        # --- the alive interval: a HUD gap is the monitor, not a death.
        #
        # grade-night.py ended the run at the FIRST settle-long HUD-absent
        # stretch. The shipped controller lives on the monitor -- 3.5 s of every
        # 5 s cycle -- so that stretch happens every cycle, and the cleared
        # Night 1 (`n1-full-1640`, 418 s, save advanced Night 1 -> Night 2) was
        # graded at 6.5 s. Wrong by 64x, by the tool that produces the only
        # number this project treats as a run length.
        #
        # Flags are HUD-present per frame; `static` is the frame indices that
        # show the death static. settle=3 throughout.
        for name, flags, static, want_end in (
                # every cycle dips into the cams and comes back: never ended
                ("monitor dwells are not deaths",
                 [1]*5 + ([0]*4 + [1]*3) * 6, set(), None),
                # a real death: static, and the HUD never returns
                ("static that never returns ends the run",
                 [1]*10 + [0]*20, set(range(12, 30)), 10),
                # the 163 s failure: static, then a restarted night
                ("static then a restart still ends the run at the static",
                 [1]*10 + [0]*8 + [1]*12, set(range(11, 18)), 10),
                # a long DARK gap the run came back from is not a death
                ("a dark gap the HUD returns from is not a death",
                 [1]*10 + [0]*10 + [1]*10, set(), None)):
            got = gn.find_end(flags, 0, 3, lambda i, st=static: i in st)
            if got != want_end:
                print(f"FAIL alive-interval {name}: expected end {want_end}, got {got}")
                failed += 1

        # Four callers now, not two -- including the live --adb-fast
        # watchdog, which had never been run by anything. death-census.py
        # was the last copy of
        # the rule and the last ported (2026-08-26): it still carried the
        # pre-guard `fl[0]>90 or ...` and so read the New Game newspaper as a
        # running night. The last row below is that exact frame, and it is why
        # every caller is in this loop rather than only the ones that drifted
        # once.
        for name, rgb, meter, want in (
                ("dark office with a lit meter", (14, 14, 16), True, "night"),
                ("a dark screen", (14, 14, 16), False, "other"),
                ("a uniformly bright cutscene", (200, 200, 198), True, "other")):
            buf = video_frame(rgb, meter)
            ys, rows = watch_rows(rgb, meter)
            got = {
                "screenstate-png": verdict(frame(rgb, flash=meter), tmp),
                "screenstate-adb-fast": ss.state_from_rows(ys, rows),
                "grade-night": "night" if gn.is_night(buf) else "other",
                "death-census": "night" if dc.night(buf) else "other",
            }
            if set(got.values()) != {want}:
                print(f"FAIL callers disagree on {name}: {got} want={want!r}")
                failed += 1

        # The structural half: a fifth copy must not be able to appear
        # quietly. Every drift here began as a literal threshold typed into a
        # second file, so the thresholds themselves are what is forbidden
        # outside nightpredicate.py and this test.
        rule_fragments = ("mb[0]>50", "maskbar[0] > 50", "> maskbar[2] * 1.3",
                          "> mb[2]*1.3", "flash[0] > 90", "fl[0]>90")
        for path in sorted(HERE.glob("*.py")) + sorted(HERE.glob("*.sh")):
            if path.name in ("nightpredicate.py", "test-screenstate.py"):
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            for fragment in rule_fragments:
                if fragment in text:
                    print(f"FAIL {path.name} restates the alive/dead rule "
                          f"({fragment!r}); evaluate nightpredicate.is_night "
                          f"with a sampler instead")
                    failed += 1

    if failed:
        print(f"{failed} screenstate check(s) failed")
        return 1
    print("screenstate: a lit meter and a mask bar are nights, a frame bright all "
          "over is not; all four callers agree, live watchdog included, and no "
          "fourth copy restates the rule; lifecycle names "
          "static, newspaper, title, dialog, options")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
