# Stock-APK RNG seed recovery

Status: **research/shadow tooling only**. The game APK is not modified, and an
inferred seed is not a control authority.

## Findings

The Android build's runtime uses one global 16-bit Fusion RNG stream:

```text
state = (state * 31415 + 1) mod 65536
Random(N) = floor(state * N / 65536)
```

The APK has no frame seed chunk, so the runtime seeds the stream from the low
16 bits of `System.currentTimeMillis()` when the night/frame is initialized.
The sourced implementation and regression vectors are in
[`packages/source/src/games/fnaf2/rng.ts`](../../packages/source/src/games/fnaf2/rng.ts)
and the source ledger records the decompilation evidence in
[`docs/android/ANDROID-SOURCE-STATUS.md`](../android/ANDROID-SOURCE-STATUS.md#implemented-android-mechanics).

There are only 65,536 possible initial seeds. That makes candidate enumeration
cheap, but it does not make passive recovery exact: the external controller
does not see hidden calls, hidden results, or the game's current RNG state.
Every `Random(N)` call advances the same stream. An extra or missing call
therefore shifts all later predictions.

The simulator's explicit `seed` option is a reproducibility input, not evidence
of the seed used by a stock-device run. The simulator is seeded from the host
unless a caller supplies a device-derived candidate.

## Method 2: device-time candidates

`AdbDeviceBridge.clockSample()` performs one fixed read-only
`adb shell date +%s%3N` command and returns the device epoch time, host midpoint,
round-trip time, clock offset, and a conservative uncertainty bound. It does
not inspect or modify the game process. Capture samples with:

```sh
node tools/device/seed-clock.mjs --serial SERIAL --samples 8 --interval-ms 50 \
  > clock-samples.json
```

The sampler calibrates the clock relationship; it does not know when the game
seeded itself. Pair the sample with the best available night-start marker from
the HID/session trace. If the marker is an epoch-millisecond timestamp on the
host, the helper combines the marker with a selected sample and makes a
conservative inclusive time window:

```sh
node packages/source/test/seed-recovery.ts marker-window clock-samples.json \
  --sample-index 0 --host-marker-ms 1760000000123 \
  --marker-uncertainty-ms 8

node packages/source/test/seed-recovery.ts clock-window clock-sample.json
```

`clock-window` is a convenience for a sample taken at the event itself.
`marker-window` is the normal path when the sample and game-start marker are
separate. The direct form is also available when the device-time window is
already known:

```sh
node packages/source/test/seed-recovery.ts window \
  --center-ms 1760000000123 --half-width-ms 8
```

The window wraps correctly at the 65,536 ms seed boundary and de-duplicates
seeds. A timestamp uncertainty of ±8 ms normally produces up to 17 seed
candidates. A window of 65,536 ms or more produces the complete seed space.

Timestamp-only recovery is therefore a narrowing step, not proof of an exact
seed. The relevant uncertainty is the time at which the game calls its seed
initializer, not the time at which the host sent a command.

## Method 3: observation filtering

There are two filters in
[`packages/source/src/games/fnaf2/seed-recovery.ts`](../../packages/source/src/games/fnaf2/seed-recovery.ts).

### Exact roll observations

Use this when a trace establishes a particular global RNG draw and its result
or predicate. Draw indexes are zero-based from the night seed. Hidden draws can
be skipped by specifying a later `drawIndex`.

```json
{
  "mode": "rolls",
  "candidates": [4660, 4661, 4662],
  "observations": [
    {"drawIndex": 0, "bound": 20, "relation": "<", "threshold": 10, "outcome": true},
    {"drawIndex": 1, "bound": 500, "result": 123}
  ]
}
```

Run it with:

```sh
node packages/source/test/seed-recovery.ts filter roll-trace.json --mode=rolls
```

This filter can scan all 65,536 seeds quickly. It is exact only if the draw
index, bound, and observed result/predicate are correct.

### Simulator event observations

Use this when the action trace is known and a screen/audio annotation can be
translated into a sourced simulator event. Positive observations require an
event in the specified frame/range. Negative observations require that no
matching event occurred in the specified range.

```json
{
  "mode": "events",
  "candidates": [0, 1, 2, 3],
  "simOptions": {"night": 7, "lethal": false},
  "actions": [
    {"atFrame": 0, "kind": "tap", "action": "monitor"},
    {"atFrame": 120, "kind": "hold", "action": "wind", "durationFrames": 90}
  ],
  "observations": [
    {"event": "foxy-arrive", "frame": 600, "toleranceFrames": 2},
    {"event": "mangle-static", "minFrame": 300, "maxFrame": 300,
     "data": {"context": "cam11", "present": true}}
  ],
  "untilFrame": 600,
  "maxCandidates": 4096
}
```

Run it with:

```sh
node packages/source/test/seed-recovery.ts filter event-trace.json --mode=events
```

Event replay is intentionally capped at 4,096 candidates by default because it
runs the full simulator once per candidate. The time-window method should
normally reduce the set before this step. `lethal` defaults to false during
filtering so later annotations can be compared in one replay; do not use
post-death annotations as evidence from a real run. A deliberate full-space
event scan must opt in with both `--all-seeds` and
`--max-candidates=65536`; it is usually much slower than roll filtering.

## What counts as useful evidence

Strong evidence is a high-confidence event with a narrow frame window and a
known action history. A raw screenshot, delayed audio cue, or absent cue is not
automatically a negative observation. Preserve sensor latency, dropped reads,
and ambiguous frames as uncertainty rather than forcing a Boolean result.

An inferred seed should be considered **candidate**, **narrowed**, or
**unique-under-model**. `unique-under-model` means only one candidate survives
the supplied trace and source model; it does not prove that the commercial
game's hidden state matched the model.

## Viability decision

For the current unmodified stock APK, timestamp-plus-observation filtering is
viable for run forensics, shadow tracking, and model diagnosis. It is not yet a
safe live dependency. The current controller should continue to plan across
seed uncertainty and use visible-state verification. If a future run leaves a
single candidate early and that candidate remains stable across independent
observations, record the result as evidence first; do not silently switch the
live policy to seed-conditioned actions.
