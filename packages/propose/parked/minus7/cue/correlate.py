#!/usr/bin/env python3
"""Full-rate waveform correlation: the confirming stage of the cue detector.

The band-energy score compares the *shape* of 16 coarse bands and discards
phase, so anything with a similar coarse spectrum scores like the cue. Menu
audio does: a title-screen capture that cannot contain a movement thud scored
0.900 against one. That stage has recall, not precision.

This stage has precision. The game plays back the exact PCM of the sample the
APK ships, so the capture contains that waveform, not merely something shaped
like it. Normalised cross-correlation is near zero for anything uncorrelated no
matter how its spectrum looks, and survives an additive mix: measured on real
night background, a thud at equal level scores 0.505, the same background with
nothing injected scores 0.049, and the menu that fooled the band stage scores
0.183.

Used as a cascade: the cheap stage proposes, this one confirms.

  from correlate import best_match
  score, onset_s = best_match(window_samples, reference_samples, at_s)
"""
import cmath
import math
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import features  # noqa: E402

# How far either side of a proposed position to search. The band stage aligns
# to a 16 ms hop and its own template core may sit anywhere inside the sample,
# so the confirming search has to be wider than that error.
SEARCH_S = 0.60
CORE_S = 0.40


def _next_pow2(n):
    size = 1
    while size < n:
        size <<= 1
    return size


def _fft(values, inverse=False):
    n = len(values)
    data = list(values)
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
    sign = 2j if inverse else -2j
    while size <= n:
        step = cmath.exp(sign * math.pi / size)
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
    if inverse:
        data = [v / n for v in data]
    return data


def core_window(samples, seconds=CORE_S):
    """The reference's most energetic stretch, and where it starts inside it.

    The offset matters. The match is found at the core's position, so the
    sample's own onset is that much earlier; reporting the core as the onset
    would bias every timestamp by a fixed amount.
    """
    count = int(seconds * features.RATE)
    if count >= len(samples) or count <= 0:
        return samples, 0
    squares = [v * v for v in samples]
    running = sum(squares[:count])
    best_sum, best_at = running, 0
    for start in range(1, len(squares) - count + 1):
        running += squares[start + count - 1] - squares[start - 1]
        if running > best_sum:
            best_sum, best_at = running, start
    return samples[best_at:best_at + count], best_at


def scan(window, reference, block=32768):
    """Normalised cross-correlation at every position, by overlap-save.

    This is the detector, not a confirmer. Gating it behind the band stage
    inherits that stage's recall, and on real night audio the band stage's own
    best match turned out to be noise -- so a candidate list is not evidence of
    absence. Scanning directly is.
    """
    template, core_at = core_window(reference)
    m = len(template)
    if m == 0 or len(window) < m:
        return [], 0
    energy = math.sqrt(sum(v * v for v in template))
    if energy <= 0:
        return [], 0
    size = _next_pow2(max(block, 2 * m))
    hop = size - m + 1
    fb = _fft([complex(v, 0.0) for v in template] + [0j] * (size - m))
    fb = [v.conjugate() for v in fb]

    prefix = [0.0]
    for value in window:
        prefix.append(prefix[-1] + value * value)

    out = [0.0] * (len(window) - m + 1)
    start = 0
    while start < len(out):
        chunk = window[start:start + size]
        if len(chunk) < size:
            chunk = chunk + [0.0] * (size - len(chunk))
        fa = _fft([complex(v, 0.0) for v in chunk])
        corr = _fft([a * b for a, b in zip(fa, fb)], inverse=True)
        for lag in range(min(hop, len(out) - start)):
            local = prefix[start + lag + m] - prefix[start + lag]
            if local > 0:
                out[start + lag] = corr[lag].real / (energy * math.sqrt(local))
        start += hop
    return out, core_at


def best_match(window, reference, at_s, search_s=SEARCH_S):
    """Peak normalised cross-correlation of `reference` near `at_s`.

    Returns (score, onset_seconds); score is 0..1, and the onset is the
    reference sample's own start, not its core's.
    """
    template, core_at = core_window(reference)
    m = len(template)
    if m == 0:
        return 0.0, at_s
    centre = int(at_s * features.RATE) + core_at
    span = int(search_s * features.RATE)
    lo = max(0, centre - span)
    hi = min(len(window), centre + span + m)
    segment = window[lo:hi]
    if len(segment) < m:
        return 0.0, at_s

    energy = math.sqrt(sum(v * v for v in template))
    if energy <= 0:
        return 0.0, at_s

    # Correlation by FFT, then normalise each lag by the signal's local energy,
    # so the score is a shape-and-phase agreement rather than a loudness match.
    size = _next_pow2(len(segment) + m)
    fa = _fft([complex(v, 0.0) for v in segment] + [0j] * (size - len(segment)))
    fb = _fft([complex(v, 0.0) for v in template] + [0j] * (size - m))
    corr = _fft([a * b.conjugate() for a, b in zip(fa, fb)], inverse=True)

    prefix = [0.0]
    for value in segment:
        prefix.append(prefix[-1] + value * value)

    best_score, best_at = 0.0, at_s
    for lag in range(0, len(segment) - m + 1):
        local = prefix[lag + m] - prefix[lag]
        if local <= 0:
            continue
        score = corr[lag].real / (energy * math.sqrt(local))
        if score > best_score:
            best_score = score
            best_at = (lo + lag - core_at) / float(features.RATE)
    return best_score, best_at
