#!/usr/bin/env python3
"""Phone-free contract for shadow-only visual death-cause observations."""
import importlib.util
import json
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent


def load():
    spec = importlib.util.spec_from_file_location("death_cause", HERE / "death-cause.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def frame(kind, variant=0):
    im = Image.new("RGB", (1280, 576), (8, 8, 10))
    d = ImageDraw.Draw(im)
    if kind == "foxy":
        # A deliberately coarse jumpscare-like positive. The real model is
        # built from labelled frames, not from this fixture; this only checks
        # the envelope and UNKNOWN protocol.
        d.ellipse((260 + variant, 50, 1010, 565), fill=(130, 35, 20))
        d.polygon(((250, 280), (450, 160), (650, 290), (830, 150), (1050, 300)),
                  fill=(205, 70, 28))
        d.rectangle((420, 300, 850, 435), fill=(18, 15, 14))
        d.rectangle((500, 215, 585, 270), fill=(235, 235, 190))
        d.rectangle((700, 205, 785, 260), fill=(235, 235, 190))
    elif kind == "marionette":
        # A deliberately coarse Puppet/Marionette-shaped positive. The real
        # model is built from labelled frames; this fixture checks that the
        # label travels through the same shadow-only protocol as Foxy.
        d.ellipse((275 + variant, 35, 1005, 570), fill=(235, 235, 225))
        d.ellipse((370, 145, 520, 285), fill=(8, 8, 12))
        d.ellipse((760, 145, 910, 285), fill=(8, 8, 12))
        d.ellipse((290, 245, 430, 390), fill=(210, 35, 40))
        d.ellipse((850, 245, 990, 390), fill=(210, 35, 40))
        d.rectangle((570, 220, 710, 390), fill=(100, 28, 125))
        d.rectangle((610, 370, 670, 510), fill=(100, 28, 125))
        d.arc((455, 305, 825, 520), 10, 170, fill=(190, 25, 35), width=16)
    elif kind == "withered-chica":
        # A coarse Withered Chica-shaped positive. The retained device model
        # is trained from labelled video frames; this fixture only checks that
        # the label is accepted and remains a shadow-only fact.
        d.ellipse((220 + variant, 25, 1060, 575), fill=(190, 155, 45))
        d.ellipse((330, 115, 520, 290), fill=(235, 230, 205))
        d.ellipse((760, 115, 950, 290), fill=(235, 230, 205))
        d.ellipse((375, 165, 485, 255), fill=(150, 35, 125))
        d.ellipse((805, 165, 915, 255), fill=(150, 35, 125))
        d.polygon(((390, 265), (890, 265), (780, 385), (500, 385)), fill=(210, 75, 25))
        d.rectangle((350, 350, 930, 555), fill=(18, 15, 14))
        for x in range(390, 900, 85):
            d.polygon(((x, 340), (x + 45, 340), (x + 58, 410), (x + 12, 410)), fill=(230, 225, 190))
            d.polygon(((x + 15, 475), (x + 58, 475), (x + 45, 535), (x + 2, 535)), fill=(230, 225, 190))
    elif kind == "withered-bonnie":
        # A coarse Withered Bonnie-shaped positive: the lavender head whose
        # face is missing, so the endoskeleton shows through a dark cavity
        # with two red pinprick eyes, over the red bowtie. The retained device
        # model is trained from labelled video frames
        # (death-cause-withered-bonnie-moto-g56-v207.json, built 2026-09-12
        # from the Night 5 jumpscare at 271.90-272.20 s); this fixture only
        # checks that the label travels through the same shadow-only protocol.
        # It is kept away from the Marionette fixture, which is also a pale
        # face on black: the separation here rests on the lavender mass and
        # the bowtie, not on the dark cavity the two share.
        d.ellipse((265 + variant, 40, 1015, 570), fill=(120, 115, 190))
        d.ellipse((430, 0, 560, 180), fill=(120, 115, 190))
        d.ellipse((720, 0, 850, 180), fill=(120, 115, 190))
        d.rectangle((420, 170, 860, 420), fill=(14, 12, 18))
        d.ellipse((520, 250, 560, 290), fill=(205, 30, 30))
        d.ellipse((720, 250, 760, 290), fill=(205, 30, 30))
        for x in range(440, 840, 70):
            d.rectangle((x, 380, x + 45, 440), fill=(225, 222, 210))
        d.polygon(((560, 500), (720, 500), (640, 560)), fill=(190, 25, 35))
    elif kind == "toy-chica":
        # A coarse Toy Chica-shaped positive: the bright yellow beaked face
        # with the pink cheeks. The retained device model is trained from
        # labelled video frames (death-cause-toy-chica-moto-g56-v207.json,
        # built 2026-09-11 from the Night 5 jumpscare at 309.82-309.92 s);
        # this fixture only checks that the label travels through the same
        # shadow-only protocol as the others.
        # Deliberately far from the Withered Chica fixture in the 16x9 BOX
        # feature space: both characters are yellow birds, so the separation
        # here rests on the large pink cheek blocks and the white bib, not on
        # the beak. On the retained device frames the two separate at 0.264
        # without any such help.
        d.ellipse((215 + variant, 20, 1065, 575), fill=(255, 225, 60))
        d.ellipse((330, 95, 545, 310), fill=(255, 255, 252))
        d.ellipse((735, 95, 950, 310), fill=(255, 255, 252))
        d.ellipse((395, 150, 490, 250), fill=(12, 10, 12))
        d.ellipse((800, 150, 895, 250), fill=(12, 10, 12))
        d.ellipse((200, 270, 420, 440), fill=(255, 95, 175))
        d.ellipse((860, 270, 1080, 440), fill=(255, 95, 175))
        d.rectangle((330, 470, 960, 575), fill=(255, 255, 250))
        d.rectangle((400, 350, 890, 460), fill=(20, 16, 18))
        for x in range(420, 870, 70):
            d.rectangle((x, 345, x + 46, 395), fill=(255, 255, 250))
    elif kind == "mangle":
        # A coarse Mangle-shaped positive: the mangled white/pink endoskeleton
        # face with the split jaw. The retained device model is trained from
        # labelled video frames (death-cause-mangle-moto-g56-v207.json, built
        # 2026-09-11 from the Night 5 jumpscare at 267.34-267.46 s); this
        # fixture only checks that the label travels through the same
        # shadow-only protocol as the others.
        d.ellipse((235 + variant, 30, 1045, 570), fill=(238, 232, 220))
        d.ellipse((300, 120, 470, 300), fill=(242, 150, 170))
        d.ellipse((820, 120, 990, 300), fill=(242, 150, 170))
        d.ellipse((355, 175, 420, 245), fill=(25, 20, 22))
        d.ellipse((865, 175, 930, 245), fill=(25, 20, 22))
        d.rectangle((360, 330, 930, 545), fill=(16, 14, 16))
        for x in range(380, 900, 80):
            d.polygon(((x, 320), (x + 52, 320), (x + 40, 400), (x + 12, 400)),
                      fill=(245, 240, 225))
            d.polygon(((x + 12, 470), (x + 52, 470), (x + 40, 540), (x, 540)),
                      fill=(245, 240, 225))
        d.ellipse((560, 250, 720, 340), fill=(240, 120, 150))
    elif kind == "office":
        d.rectangle((0, 500, 1280, 555), fill=(105, 25, 70))
        d.rectangle((30, 80, 220, 120), fill=(200, 200, 200))
        d.rectangle((850, 80, 1120, 190), fill=(20, 40, 80))
    else:
        d.rectangle((80, 80, 1100, 500), fill=(40, 45, 90))
        for x in range(150, 1100, 120):
            d.rectangle((x, 120, x + 30, 150), fill=(240, 240, 240))
    return im


def main():
    dc = load()
    failed = 0

    def check(ok, message):
        nonlocal failed
        if not ok:
            print(f"FAIL {message}")
            failed += 1

    with tempfile.TemporaryDirectory() as root:
        root = Path(root)
        positive = root / "positive"
        negative = root / "negative"
        marionette_positive = root / "marionette-positive"
        chica_positive = root / "withered-chica-positive"
        mangle_positive = root / "mangle-positive"
        toychica_positive = root / "toy-chica-positive"
        bonnie_positive = root / "withered-bonnie-positive"
        positive.mkdir(); negative.mkdir()
        marionette_positive.mkdir()
        mangle_positive.mkdir()
        toychica_positive.mkdir()
        bonnie_positive.mkdir()
        chica_positive.mkdir()
        for i in range(3):
            frame("foxy", i * 3).save(positive / f"p{i}.png")
            frame("marionette", i * 3).save(marionette_positive / f"p{i}.png")
            frame("withered-chica", i * 3).save(chica_positive / f"p{i}.png")
            frame("mangle", i * 3).save(mangle_positive / f"p{i}.png")
            frame("toy-chica", i * 3).save(toychica_positive / f"p{i}.png")
            frame("withered-bonnie", i * 3).save(bonnie_positive / f"p{i}.png")
        frame("office").save(negative / "office.png")
        frame("title").save(negative / "title.png")
        model = dc.build_model(positive, negative)
        check(model["authorized_for"] == "shadow",
              "the visual death model was not hard-bound to shadow mode")
        check(model["training"]["positive_images"] == 3 and
              model["training"]["negative_images"] == 2,
              "the model did not record its labelled sample counts")
        check(dc.classify_image(frame("foxy", 1), model)["state"] == "OBSERVED",
              "a labelled Foxy-shaped frame was not observed")
        marionette_model = dc.build_model(positive_root=marionette_positive,
                                          negative_root=negative,
                                          label="marionette")
        check(marionette_model["label"] == "marionette" and
              dc.classify_image(frame("marionette", 1), marionette_model)["state"] == "OBSERVED",
              "a labelled Marionette-shaped frame was not observed")
        chica_model = dc.build_model(positive_root=chica_positive,
                                     negative_root=negative,
                                     label="withered-chica")
        mangle_model = dc.build_model(positive_root=mangle_positive,
                                      negative_root=negative,
                                      label="mangle")
        check(mangle_model["label"] == "mangle" and
              dc.classify_image(frame("mangle", 1), mangle_model)["state"] == "OBSERVED",
              "a labelled Mangle envelope is built and observed")
        toychica_model = dc.build_model(positive_root=toychica_positive,
                                        negative_root=negative,
                                        label="toy-chica")
        check(toychica_model["label"] == "toy-chica" and
              dc.classify_image(frame("toy-chica", 1), toychica_model)["state"] == "OBSERVED",
              "a labelled Toy Chica envelope is built and observed")
        # Toy Chica and Withered Chica are the pair most likely to collapse into
        # each other, and on the retained device frames they do not: the
        # withered-chica model refuses the Toy Chica jumpscare at 0.264.
        check(dc.classify_image(frame("toy-chica", 1), chica_model)["state"] == "UNKNOWN" and
              dc.classify_image(frame("withered-chica", 1), toychica_model)["state"] == "UNKNOWN",
              "the Toy Chica and Withered Chica envelopes refuse each other")
        check(dc.classify_image(frame("toy-chica", 1), mangle_model)["state"] == "UNKNOWN" and
              dc.classify_image(frame("mangle", 1), toychica_model)["state"] == "UNKNOWN",
              "the Toy Chica and Mangle envelopes refuse each other")
        bonnie_model = dc.build_model(positive_root=bonnie_positive,
                                      negative_root=negative,
                                      label="withered-bonnie")
        check(bonnie_model["label"] == "withered-bonnie" and
              dc.classify_image(frame("withered-bonnie", 1), bonnie_model)["state"] == "OBSERVED",
              "a labelled Withered Bonnie envelope is built and observed")
        # Withered Bonnie and the Marionette are both a pale-edged face over a
        # dark cavity, so they are the pair most likely to collapse here.
        check(dc.classify_image(frame("withered-bonnie", 1), marionette_model)["state"] == "UNKNOWN" and
              dc.classify_image(frame("marionette", 1), bonnie_model)["state"] == "UNKNOWN",
              "the Withered Bonnie and Marionette envelopes refuse each other")
        # Two cause models must never both claim the same death: the retained
        # Night 5 pair (mangle, withered-chica) is separable on real frames at
        # distance 0.33, and the fixtures must not collapse that either.
        check(dc.classify_image(frame("mangle", 1), chica_model)["state"] == "UNKNOWN" and
              dc.classify_image(frame("withered-chica", 1), mangle_model)["state"] == "UNKNOWN",
              "the Mangle and Withered Chica envelopes refuse each other")
        check(chica_model["label"] == "withered-chica" and
              dc.classify_image(frame("withered-chica", 1), chica_model)["state"] == "OBSERVED",
              "a labelled Withered Chica-shaped frame was not observed")
        # --- the metric, and why it is recorded in the model -----------------
        # Euclidean distance over raw RGB is a brightness metric in disguise:
        # it is what let the withdrawn withered-bonnie model put a dark
        # jumpscare next to a dark office. Cosine compares colour DIRECTION, so
        # dimming a frame must not move it out of its own envelope.
        def dim(image, factor):
            out = image.copy()
            out.putdata([tuple(int(c * factor) for c in px) for px in out.getdata()])
            return out

        cosine_model = dc.build_model(positive_root=bonnie_positive,
                                      negative_root=negative,
                                      label="withered-bonnie", metric="cosine")
        check(cosine_model["metric"] == "cosine",
              "the model did not record the metric it was fitted under")
        check(dc.classify_image(frame("withered-bonnie", 1), cosine_model)["state"] == "OBSERVED",
              "a cosine model did not observe its own positive")
        check(dc.classify_image(dim(frame("withered-bonnie", 1), 0.45), cosine_model)["state"]
              == "OBSERVED",
              "a cosine model lost its positive to a brightness change alone")
        # And the failure it has to keep: a differently coloured frame at the
        # same brightness is still refused, or the metric has bought nothing.
        check(dc.classify_image(frame("toy-chica", 1), cosine_model)["state"] == "UNKNOWN",
              "a cosine model accepted a different character")

        # Backward compatibility is load-bearing: the three retained device
        # models were fitted under euclid and carry no metric field, so their
        # thresholds would mean nothing if the default moved.
        check(dc.DEFAULT_METRIC == "euclid", "the default metric moved under the retained models")
        legacy = dict(cosine_model)
        legacy.pop("metric")
        euclid_model = dc.build_model(positive_root=bonnie_positive,
                                      negative_root=negative, label="withered-bonnie")
        check(euclid_model.get("metric") == "euclid",
              "a model built without a metric did not record euclid")
        check(dc.classify_image(frame("withered-bonnie", 1), legacy)["distance"]
              != dc.classify_image(frame("withered-bonnie", 1), cosine_model)["distance"],
              "a model with no metric field was not read as euclid")

        unknown = dc.classify_image(frame("office"), model)
        check(unknown["state"] == "UNKNOWN",
              "an office control became a Foxy cause")
        bad = dc.classify_image(Image.new("RGB", (1000, 576), (0, 0, 0)), model)
        check(bad["state"] == "UNKNOWN" and "aspect" in bad["reason"],
              "an uncalibrated sensor geometry was not refused")

        # The lifecycle authority is still independent. A cause label can
        # close only after the last office segment and a captured tail; an
        # isolated Foxy-looking observation in the middle of a night is not a
        # death verdict.
        timeline_spec = importlib.util.spec_from_file_location(
            "run_timeline", HERE / "run-timeline.py")
        timeline = importlib.util.module_from_spec(timeline_spec)
        timeline_spec.loader.exec_module(timeline)
        th = {"staticRoughnessMin": 12}
        not_terminal = timeline.terminal_outcome(
            [["office", 0, 5]], ["office"] * 5, [0] * 5, 1, th,
            [None, "foxy", None, None, None])
        check(not_terminal["outcome"] == "unknown",
              "an in-night cause observation overrode lifecycle authority")
        terminal = timeline.terminal_outcome(
            [["office", 0, 3], ["other", 3, 5]],
            ["office", "office", "office", "other", "other"],
            [0] * 5, 1, th, [None, None, None, "foxy", None])
        check(terminal["outcome"] == "death" and terminal["cause"] == "foxy" and
              terminal["evidence"] == "visual-foxy-jumpscare",
              "post-office Foxy cause did not produce shadow death evidence")
        puppet_terminal = timeline.terminal_outcome(
            [["office", 0, 3], ["other", 3, 5]],
            ["office", "office", "office", "other", "other"],
            [0] * 5, 1, th,
            cause_events=[{"cause": "marionette", "at_s": 3.0,
                            "through_s": 3.5, "samples": 4}])
        check(puppet_terminal["outcome"] == "death" and
              puppet_terminal["cause"] == "marionette" and
              puppet_terminal["evidence"] == "visual-marionette-jumpscare",
              "post-office Marionette cause did not produce shadow death evidence")
        # A sixam lookalike BEFORE the night (title/intro frames) is not a
        # clear: night5-anchor4 graded "clear -- sixam at 24.5s" on a night
        # whose HUD first appeared at 29.2 s and that died at 368 s.
        pre_night = timeline.terminal_outcome(
            [["sixam", 0, 2], ["intro", 2, 3], ["office", 3, 6], ["other", 6, 8]],
            ["sixam", "sixam", "intro", "office", "office", "office", "other", "other"],
            [0] * 8, 1, th)
        check(pre_night["outcome"] != "clear",
              "a sixam read before the night's first office frame was taken as a clear")
        post_night = timeline.terminal_outcome(
            [["office", 0, 6], ["sixam", 6, 8]],
            ["office"] * 6 + ["sixam"] * 2, [0] * 8, 1, th)
        check(post_night["outcome"] == "clear" and post_night["at_s"] == 6.0,
              "a sixam after the night is the clear")
        chica_terminal = timeline.terminal_outcome(
            [["office", 0, 3], ["other", 3, 5]],
            ["office", "office", "office", "other", "other"],
            [0] * 5, 1, th,
            cause_events=[{"cause": "withered-chica", "at_s": 3.0,
                            "through_s": 3.5, "samples": 4}])
        check(chica_terminal["outcome"] == "death" and
              chica_terminal["cause"] == "withered-chica" and
              chica_terminal["evidence"] == "visual-withered-chica-jumpscare",
              "post-office Withered Chica cause did not produce shadow death evidence")
        latest_puppet_terminal = timeline.terminal_outcome(
            [["office", 0, 3], ["other", 3, 6]],
            ["office", "office", "office", "other", "other", "other"],
            [0] * 6, 1, th,
            cause_events=[{"cause": "marionette", "at_s": 2.0,
                            "through_s": 2.0, "samples": 1},
                           {"cause": "marionette", "at_s": 3.0,
                            "through_s": 3.5, "samples": 4},
                           {"cause": "marionette", "at_s": 4.0,
                            "through_s": 4.5, "samples": 4}])
        check(latest_puppet_terminal["outcome"] == "death" and
              latest_puppet_terminal["at_s"] == 4.0,
              "an earlier lookalike cause was not excluded in favour of the final episode")

        # Cause sampling is deliberately independent from the coarse lifecycle
        # cadence. Patch only the decoder so this remains a phone-free unit
        # test, and assert that the requested high-rate cadence is passed
        # through rather than silently reusing the lifecycle rate.
        original_decode = timeline.decode
        seen_fps = []
        small_frames = [
            frame("office").resize((640, 288)).tobytes(),
            frame("marionette", 1).resize((640, 288)).tobytes(),
            frame("marionette", 2).resize((640, 288)).tobytes(),
            frame("title").resize((640, 288)).tobytes(),
        ]
        def fake_decode(path, sample_fps):
            seen_fps.append(sample_fps)
            return iter(small_frames)
        timeline.decode = fake_decode
        try:
            candidates = timeline.scan_cause_frames(
                "ignored.mp4", 12.0, [(dc, marionette_model)])
        finally:
            timeline.decode = original_decode
        check(seen_fps == [12.0],
              "cause scanner reused the lifecycle cadence")
        check(len(candidates) == 1 and candidates[0]["cause"] == "marionette" and
              candidates[0]["at_s"] == round(1 / 12, 4),
              "high-rate scanner did not retain a transient Marionette episode")

    if failed:
        print(f"{failed} death-cause check(s) failed")
        return 1
    print("death cause: labelled visual Foxy/Mangle/Marionette/Toy-Chica/"
          "Withered-Bonnie/Withered-Chica envelopes are shadow-only and lifecycle-safe")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
