#!/usr/bin/env python3
"""Which capture method a frame came from, and whether a model may read it.

plans/15. A classifier is calibrated against the pixels of one capture method.
Handing it a frame from another and resizing to fit is not a conversion -- it is
what makes a sensor mismatch look like a working reading. This module makes the
sensor explicit and makes the mismatch refuse.

The sensors this project can capture from, and why they are not interchangeable:

    screencap-2400x1080   the raw Android screencap. Every model in this
                          repository is calibrated on it.
    screenrecord-1280x576 the runner's diagnostic video. Same geometry ratio,
                          different encoder and a lossy one; usable for locating
                          things, not for thresholds.
    cue-helper-grid       the on-device MediaProjection read, 42 ms against
                          screencap's 225 ms. A DIFFERENT SCALER --
                          ON-DEVICE-VALIDATION.md records that its threshold was
                          never calibrated for exactly this reason, which is why
                          the fast sensor still cannot answer the BB question.

A caller that knows it is feeding a non-native frame says so, and gets the
reading with the adapter named. A caller that says nothing gets a refusal
instead of a plausible number.
"""
import warnings

warnings.simplefilter("ignore")

NATIVE = "screencap-2400x1080"
SENSORS = {
    "screencap-2400x1080": {"size": (2400, 1080), "calibrated": True},
    "screenrecord-1280x576": {"size": (1280, 576), "calibrated": False},
    "cue-helper-grid": {"size": None, "calibrated": False},
}


class SensorMismatch(Exception):
    """Raised instead of resizing a frame from an undeclared capture method."""


def open_frame(source, declared=None, native=NATIVE):
    """Open a frame, refusing a geometry the caller did not declare.

    `declared` names the capture method the frame came from. When it is None the
    frame must already be the native geometry; anything else is a mismatch and
    raises rather than being resized to fit.
    """
    from PIL import Image, UnidentifiedImageError
    try:
        image = Image.open(source).convert("RGB")
    except (OSError, UnidentifiedImageError):
        raise SensorMismatch("unreadable-frame")

    want = SENSORS[native]["size"]
    if image.size == want:
        return image, native

    if declared is None:
        raise SensorMismatch(
            f"sensor-mismatch:{image.size[0]}x{image.size[1]}; this model is "
            f"calibrated for {native}. Pass the capture method explicitly if you "
            "mean to read a frame from another sensor.")
    if declared not in SENSORS:
        raise SensorMismatch(f"unknown-sensor:{declared}")
    expect = SENSORS[declared]["size"]
    if expect is not None and image.size != expect:
        raise SensorMismatch(
            f"sensor-geometry:{image.size[0]}x{image.size[1]} is not "
            f"{declared}'s {expect[0]}x{expect[1]}")
    # Declared, so the caller owns the consequence. The reading is reported
    # against an adapter that has NOT been cross-calibrated; plans/15 package 4
    # is what would establish that it agrees with the native sensor.
    return image.resize(want), declared
