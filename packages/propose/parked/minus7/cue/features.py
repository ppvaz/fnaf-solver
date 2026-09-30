#!/usr/bin/env python3
"""Shared front end for cue audio: decode, downmix, and log-band features.

Plan 08's detector shape is deliberately deterministic signal processing, not
an ML runtime, and this repository's Python tools are stdlib-only. So the FFT
is here, in about thirty lines, rather than pulled in from numpy.

Everything downstream compares *shapes*, not levels: each frame's log-band
vector has its own mean removed, so a template matches the same sound played
quieter, and a broadband level shift cannot manufacture a score.

  from features import load_window, band_frames
"""
import cmath
import math
import wave

# 32 ms frames, 16 ms hop, at the capture rate the helper negotiates.
RATE = 16_000
FRAME = 512
HOP = 256
# Log-spaced edges. The bottom stops above the music-box winding fundamental
# and the top below the resampler's rolloff; ANDROID-AUDIO-CAPTURE.md records
# why the low end is contaminated on this phone.
BAND_LOW = 120.0
BAND_HIGH = 7000.0
BANDS = 16
# Bands quieter than this fraction of the loudest band in the same frame are
# floored *relative to that frame*. An absolute floor is not gain-invariant:
# drop the level far enough and empty bands pin to the epsilon while loud ones
# do not, which changes the shape of a sound purely because it got quieter.
BAND_FLOOR = 1e-7


def load_wav(path):
    """Return (samples, rate) as mono floats in -1..1, from a PCM wav."""
    with wave.open(str(path)) as handle:
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())
    if width != 2:
        raise ValueError("%s: expected 16-bit PCM, got %d-byte samples"
                         % (path, width))
    total = len(raw) // 2
    samples = [0.0] * (total // channels)
    for i in range(len(samples)):
        acc = 0
        base = i * channels * 2
        for c in range(channels):
            lo = raw[base + c * 2]
            hi = raw[base + c * 2 + 1]
            value = lo | (hi << 8)
            if value >= 0x8000:
                value -= 0x10000
            acc += value
        samples[i] = acc / (channels * 32768.0)
    return samples, rate


def resample(samples, rate, target=RATE):
    """Linear resample. Good enough: the features are 16 coarse bands."""
    if rate == target or not samples:
        return samples
    ratio = rate / float(target)
    count = int(len(samples) / ratio)
    out = [0.0] * count
    for i in range(count):
        position = i * ratio
        left = int(position)
        right = min(left + 1, len(samples) - 1)
        frac = position - left
        out[i] = samples[left] * (1.0 - frac) + samples[right] * frac
    return out


def load_window(path):
    """Decode any capture or reference sample to mono 16 kHz floats."""
    samples, rate = load_wav(path)
    return resample(samples, rate)


def _fft(values):
    """Iterative radix-2 Cooley-Tukey. len(values) must be a power of two."""
    n = len(values)
    data = list(values)
    # Bit-reversal permutation.
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            data[i], data[j] = data[j], data[i]
    size = 2
    while size <= n:
        step = cmath.exp(-2j * math.pi / size)
        half = size // 2
        for start in range(0, n, size):
            twiddle = 1 + 0j
            for k in range(half):
                even = data[start + k]
                odd = data[start + k + half] * twiddle
                data[start + k] = even + odd
                data[start + k + half] = even - odd
                twiddle *= step
        size <<= 1
    return data


_WINDOW = [0.5 - 0.5 * math.cos(2 * math.pi * i / (FRAME - 1))
           for i in range(FRAME)]


def _band_bins(rate=RATE, frame=FRAME, bands=BANDS):
    """Inclusive-exclusive FFT bin ranges for each log-spaced band."""
    edges = []
    for i in range(bands + 1):
        frac = i / float(bands)
        edges.append(BAND_LOW * (BAND_HIGH / BAND_LOW) ** frac)
    per_bin = rate / float(frame)
    ranges = []
    for i in range(bands):
        low = max(1, int(edges[i] / per_bin))
        high = max(low + 1, int(edges[i + 1] / per_bin))
        ranges.append((low, min(high, frame // 2)))
    return ranges


_BANDS = _band_bins()


def band_frames(samples, frame=FRAME, hop=HOP):
    """Mean-removed log-band energies, one vector per frame.

    Removing each frame's own mean is what makes the score level-invariant:
    the same cue played at a different volume keeps its shape.
    """
    out = []
    for start in range(0, max(0, len(samples) - frame + 1), hop):
        block = [samples[start + i] * _WINDOW[i] for i in range(frame)]
        spectrum = _fft([complex(v, 0.0) for v in block])
        energies = []
        for low, high in _BANDS:
            energy = 0.0
            for bin_index in range(low, high):
                value = spectrum[bin_index]
                energy += value.real * value.real + value.imag * value.imag
            energies.append(energy)
        loudest = max(energies)
        if loudest <= 0.0:
            out.append([0.0] * len(energies))
            continue
        floor = loudest * BAND_FLOOR
        vector = [math.log(max(e, floor)) for e in energies]
        mean = sum(vector) / len(vector)
        out.append([v - mean for v in vector])
    return out


def frame_levels(samples, frame=FRAME, hop=HOP):
    """Per-frame loudness in dB, deliberately *not* level-invariant.

    band_frames() removes each frame's mean so a cue matches at any volume.
    That is the right default and it discards real information: the game plays
    the same three Balloon Boy samples at channel-14 volume 25 on a route hop
    and 60 when he is on the camera being watched (g414-416 against g906), so
    level is what separates those two meanings. A policy that needs both reads
    the shape score from band_frames and the loudness from here.
    """
    out = []
    for start in range(0, max(0, len(samples) - frame + 1), hop):
        energy = 0.0
        for i in range(frame):
            value = samples[start + i] * _WINDOW[i]
            energy += value * value
        out.append(10.0 * math.log10(energy / frame + 1e-20))
    return out


def rms(samples):
    if not samples:
        return 0.0
    return math.sqrt(sum(v * v for v in samples) / len(samples))


def peak(samples):
    return max((abs(v) for v in samples), default=0.0)
