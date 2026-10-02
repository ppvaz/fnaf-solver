"""Dependency-free statistical primitives matching packages/review/src/stat.ts.

The functions use proportions in [0, 1].  ``required_n`` is a planning
estimate; an observed sample should always be reported with its own Wilson
interval.
"""

import math
from typing import TypedDict

DEFAULT_Z = 1.959963984540054


class Interval(TypedDict):
    """A Wilson interval for successes out of trials, at z."""
    successes: int
    trials: int
    rate: float
    low: float
    high: float
    half_width: float
    z: float


class Verdict(Interval):
    """An interval held against a contract bar."""
    bar: float
    status: str
    ok: bool


class ProportionTest(TypedDict):
    """Two observed rates compared under a pooled-variance z test."""
    successes_a: int
    trials_a: int
    successes_b: int
    trials_b: int
    rate_a: float
    rate_b: float
    difference: float
    pooled: float
    z: float
    p_value: float
    critical_z: float


def _counts(successes: int, trials: int) -> None:
    if (not isinstance(successes, int) or not isinstance(trials, int) or
            trials <= 0 or successes < 0 or successes > trials):
        raise ValueError(
            "successes/trials must be integers with 0 <= successes <= trials "
            "and trials > 0"
        )


def _z(z: float) -> float:
    if not math.isfinite(z) or z <= 0:
        raise ValueError("z must be finite and greater than zero")
    return z


def _half_width(rate: float, trials: int, z: float) -> float:
    zz = z * z
    denominator = 1 + zz / trials
    return z * math.sqrt(rate * (1 - rate) / trials + zz / (4 * trials * trials)) / denominator


def wilson_interval(successes: int, trials: int, z: float = DEFAULT_Z) -> Interval:
    _counts(successes, trials)
    z = _z(z)
    rate = successes / trials
    zz = z * z
    denominator = 1 + zz / trials
    center = (rate + zz / (2 * trials)) / denominator
    half_width = _half_width(rate, trials, z)
    return {
        "successes": successes,
        "trials": trials,
        "rate": rate,
        "low": max(0.0, center - half_width),
        "high": min(1.0, center + half_width),
        "half_width": half_width,
        "z": z,
    }


def required_n(rate: float, half_width: float, z: float = DEFAULT_Z) -> int:
    if not math.isfinite(rate) or not 0 <= rate <= 1:
        raise ValueError("rate must be in [0, 1]")
    if not math.isfinite(half_width) or not 0 < half_width < 1:
        raise ValueError("half_width must be in (0, 1)")
    z = _z(z)
    lo, hi = 1, 1
    while _half_width(rate, hi, z) > half_width:
        hi *= 2
        if hi > 1_000_000_000:
            raise ValueError("requested half_width requires more than 1e9 observations")
    while lo < hi:
        mid = (lo + hi) // 2
        if _half_width(rate, mid, z) <= half_width:
            hi = mid
        else:
            lo = mid + 1
    return lo


def two_proportion_test(successes_a: int, trials_a: int, successes_b: int, trials_b: int,
                        z: float = DEFAULT_Z) -> ProportionTest:
    _counts(successes_a, trials_a)
    _counts(successes_b, trials_b)
    z = _z(z)
    rate_a = successes_a / trials_a
    rate_b = successes_b / trials_b
    pooled = (successes_a + successes_b) / (trials_a + trials_b)
    variance = pooled * (1 - pooled) * (1 / trials_a + 1 / trials_b)
    difference = rate_a - rate_b
    statistic = (0.0 if difference == 0 else math.copysign(math.inf, difference)
                 if variance == 0 else difference / math.sqrt(variance))
    p_value = math.erfc(abs(statistic) / math.sqrt(2))
    return {
        "successes_a": successes_a,
        "trials_a": trials_a,
        "successes_b": successes_b,
        "trials_b": trials_b,
        "rate_a": rate_a,
        "rate_b": rate_b,
        "difference": difference,
        "pooled": pooled,
        "z": statistic,
        "p_value": p_value,
        "critical_z": z,
    }


def contract_verdict(successes: int, trials: int, bar: float, z: float = DEFAULT_Z) -> Verdict:
    if not math.isfinite(bar) or not 0 <= bar <= 1:
        raise ValueError("bar must be in [0, 1]")
    interval = wilson_interval(successes, trials, z)
    status = ("PASS" if interval["low"] >= bar else
              "FAIL" if interval["high"] < bar else "INCONCLUSIVE")
    return {**interval, "bar": bar, "status": status, "ok": status == "PASS"}


def format_rate(successes: int, trials: int, digits: int = 1, label: str = "rate", z: float = DEFAULT_Z) -> str:
    result = wilson_interval(successes, trials, z)

    def percent(value: float) -> str:
        return f"{100 * value:.{digits}f}"
    return (f"{label} {percent(result['rate'])}% "
            f"[{percent(result['low'])}%, {percent(result['high'])}%] n={trials}")
