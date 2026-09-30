# Android internal-audio capture does not match the audible mix

> **Correction, 2026-08-31:** the 2026-08-30 phone -> ESP32 A2DP -> Wi-Fi/UDP
> PCM -> same-phone helper experiment had severe loss problems. The ESP32 PCM
> return path is therefore **retracted as a live-control architecture**. The
> ESP32 remains useful as a local audio-DSP/reflex coprocessor: it consumes
> audio locally and emits timestamped semantic cue/health facts, not a
> continuous PCM stream for the phone to analyze. The experiment did not retain
> a loss-rate or latency-percentile record, so this is a qualitative calibrated
> rejection. See [`REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md`](REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md)
> for the controlling architecture. The Android findings below still establish
> why a genuinely external audible-mix endpoint is needed for FAST-mixer cues.

This note records an FNaF 2 mobile recording artifact reported on the owned
Android build and independently described by other players. It matters beyond
sharing gameplay clips: any future audio-cue detector must establish what the
capture API actually receives before treating recorded audio as game state.

## Outcome

The device owner reports that every internal-audio capture made from the game
contains the music-box winding sound and Mangle's radio/static continuously,
including periods when those sounds were not audible during play. This is
almost certainly an application/runtime playback-capture bug, not damaged
recordings or intended gameplay audio.

Independent reports describe the same signature:

- A [2025 FNaF 2 Android report](https://www.reddit.com/r/fivenightsatfreddys/comments/1ksk7g7/)
  names Mangle's sound, the music box, and hallway ambience appearing at full
  volume in a screen recording despite not being heard during play.
- A [2022 mobile report](https://www.reddit.com/r/fivenightsatfreddys/comments/vkf8dl/)
  describes Mangle's static being present throughout the recording but absent
  while playing.
- A [2024 remastered-mobile report](https://www.reddit.com/r/fivenightsatfreddys/comments/1etjatc/)
  describes Mangle's radio and office animatronic audio persisting through the
  recording.
- Closely related artifacts are reported in other mobile Clickteam FNaF ports:
  [UCN music-box audio throughout a recording](https://www.reddit.com/r/fivenightsatfreddys/comments/1umy8tw/),
  [UCN Phantom Mangle and BB/JJ sounds present only in the recording](https://www.reddit.com/r/fivenightsatfreddys/comments/1b8nr1v/),
  and [similar Sister Location and UCN internal-audio behavior](https://www.reddit.com/r/fivenightsatfreddys/comments/1cakfqn/).

These are community observations rather than an official Clickteam or game bug
ticket. Their exact match across different recorders, devices, years, and
Clickteam FNaF ports is strong corroboration, but it does not by itself locate
the defect.

## What is known, and what is inferred

`[SOURCED]` Android's `AudioPlaybackCapture` API copies eligible application
playback into a recorder. Capture eligibility depends on the source
application's usage and capture policy. It is an internal playback path, not a
microphone recording of the phone speaker. Android also states that capturing
audio this way does not affect the latency of the application whose audio is
captured. See the official
[`AudioPlaybackCapture` overview](https://developer.android.com/media/platform/av-capture)
and
[`AudioPlaybackCaptureConfiguration` reference](https://developer.android.com/reference/android/media/AudioPlaybackCaptureConfiguration).

`[SOURCED, runtime side]` (event sheet, 2026-08-29) FNaF 2's Clickteam runtime
**does** leave every ambient loop playing and gate audibility purely by channel
volume:

- **g60 / g61** (Start of Frame, `Set channel volume`) set the initial mix.
  g61 **zeroes channels 2, 3, 8, 9, 13, 16, 30, 31** — every conditionally-heard
  loop starts silent.
- **g62–g68** (Start of Frame, then `Every 500…3000 ms`) issue `Play sample if
  not already playing` on each loop's own channel, so the loop is *always
  running* regardless of game state — the timer just re-arms it.
- Game state then raises the muted channels: the mask groups drive channel 8
  (breathing), the blackout groups channel 9, the box danger level channels 13
  (g596–600), Mangle proximity channel 16 (g732/733).

So on the runtime side the mechanism is not a guess: the loops never stop, only
their volume moves. `[INFERRED]` remains only for the Android half — that
`AudioPlaybackCapture` reads the pre-volume channel or otherwise ignores the
volume automation, which is what lets the recorder receive loops the live mix
silences. Do **not** elevate the Android half to a sourced rule; the runtime
half above now is one.

### Sound-handle map (event sheet, cross-checked by the device owner's ear)

| handle | file | Fusion name | channel | what it is | volume driven by |
|---|---|---|---|---|---|
| 3 | s0003 | `'C'` | 3 | room ambience | g61→0, g109/g110 |
| 9 | s0009 | `'d'` | 8 | **mask-up breathing** | g61→0; mask groups g281/g283/g287–297 |
| 10 | s0010 | `'s'` | 9 | **blackout / camera-signal-lost** | g448 mutes when `in danger == 0` **and** `your view`.AV1 `== 0`; g449/g478 → 60 |
| 15 | s0015 | `'M'` | 13 | **the music box** | g596→0 (not viewing CAM 11); g597 40 / g598–599 15 / g600 5 by `music button` v0 (box level) |
| 20 | s0020 | `'e'` | 16 | **Mangle** | g61→0; g732/g733 → 40 (Mangle proximity) |
| 33 | s0033 | `'WinD'` | 12 | winding ratchet (see phase-clock section) | not on this system — g637/g644 `Play sample` per 500 ms tick |
| 60 | s0060 | `'W'` | 31 | hall ambience ("someone near the hall" — owner uses it as a W. Foxy watch cue); exact volume gate not yet traced | g61→0; g68 keeps it looping |

This **corrects the 2026-08-29 detectability study's guesses**: s0020 is Mangle,
not the music-box tune; s0010 is the blackout sound, not Mangle static; the
music box is **s0015**, which that study never tested. The study's conclusion is
unaffected — it mixed WinD against two real stationary game loops and the
identities do not change the matched-filter result — but re-run any SBR number
with s0015 + s0020 as the bed.

The repository's adb harness uses Android's shell `screenrecord`. That tool's
documented output is video-only; an OEM screen recorder or a purpose-built
`AudioPlaybackCapture` helper is a different path. See AOSP's
[`screenrecord` shell documentation](https://android.googlesource.com/platform/frameworks/base/+/84bf8073a8a80cf464eba1dada0eb7585f9943d5/docs/html/tools/help/shell.jd).

## Consequence for an audio-cue detector

Internal capture cannot be assumed to represent the player's audible mix. In
particular:

- Mangle/static and music-box energy may be permanently present in the PCM,
  even when gameplay says those cues are inactive.
- The same Mangle static signature can occur in the CAM 11/winding-camera
  context and at the office/right-vent context. The sample handle alone does
  not identify which context is active; a controller must keep those labels
  separate and never treat CAM 11 static by itself as an office threat.
- A detector trained from shared screen recordings could learn the capture
  artifact instead of the intended cue.
- Windowed capture around a known game tick reduces processing work, but does
  not remove an always-present contaminating loop.
- BB's short laughs may still be separable by a narrow time-frequency template;
  this must be demonstrated against raw PCM from the target phone rather than
  assumed from what the operator hears.

Before audio controls any Night 7 action, collect labeled positive and negative
windows from the target build and inspect their waveform/spectrogram. Include
negative windows with Mangle present and with the music box winding. The first
acceptance test is whether BB laughs remain distinguishable under the captured
background; end-to-end timing is a separate test after that.

The historical on-device boundary, window schedule, failure semantics, and
promotion gates are preserved in
[`plans/08-audio-cue-controller.md`](../../plans/08-audio-cue-controller.md).
The current boundary moves PCM and detection to the external audio authority;
the APK does not assume or advertise an on-device audio reader.

## Bluetooth silently empties the capture (2026-08-25)

`AudioPlaybackCapture` taps the phone's mix. **A2DP offload does not go through
that mix**, so with Bluetooth headphones connected the helper receives
zero-filled buffers -- and reports itself healthy while doing it.

Night 6-42 is the worked example. It recorded **71 s of a live Night 6 in which
Balloon Boy was visibly on the Game Area camera at 19.4 s**, and every one of
its 1142784 samples was exactly zero. Throughout, the helper logged
`audio=OBSERVED rate=16000 frames=... rms=0 peak=0` with the frame counter
advancing normally, and the run's cue trace carried `rms max 0, peak max 0`
across all 561 samples. `dumpsys audio` said `Devices: bt_a2dp(80)` on every
stream. Nothing in the pipeline could tell that from a quiet night.

This is the same shape as every other failure in this repository: a sensor that
knows one way to be working must not be what says the capture is fine. So:

- `trial.sh` refuses to start with `CUE_AUDIO=1` while audio is routed to
  A2DP, rather than recording silence through the night;
- `scan-night.sh` fails (exit 3) on an all-zero capture instead of reporting a
  clean scan, because **silence is not "no bangs", it is no observation**.

Two traps found while wiring that guard, both worth keeping:

- **`grep -q` must not be on the right of a pipe under `set -o pipefail`.** It
  exits the instant it matches, the writer takes SIGPIPE, and the pipeline
  reports 141 -- so the `if` reads false however well the pattern matched. This
  skipped the Bluetooth guard twice, and two nights recorded silence anyway
  before it was noticed. Piping into `grep -c` and comparing hides the bug,
  because `-c` reads to the end; a herestring avoids it entirely.
- **The helper now releases its capture workers when stopped and uses a
  session-scoped control socket.** Asking a running instance to stop and start
  capture again no longer fails with `java.io.IOException: Address already in
  use`. After installing the renamed package, use `adb shell am force-stop
  com.fnaf2.cuehelper` and relaunch when a clean consent session is needed.

## Practical recording workarounds

For a clip intended to match what the player heard, record the physical output
with a microphone or an external audio path instead of Android internal audio.
That trades some quality and convenience for an honest audible mix. Bluetooth
output is not a dependable fix because an internal recorder may capture before
the speaker/headphone route.

There is no established in-game repair in the sources above. Post-processing
may reduce the persistent layer, but it cannot be trusted to reconstruct the
original mix perfectly.

## The winding tick (sample 33) as a phase reference — 2026-08-29

A candidate use of recorded audio that is *not* a threat cue: the music-box
winding ratchet. `readdump.py sounds 3 33` → **groups 637 and 644 only**, both
playing `Sample 'WinD'` (handle 33, `res/raw/s0033.wav`, a 0.284 s mono burst)
on a `Time: 500 loops: 0` — a global "Every 500 ms" Fusion timer — while the
wind button is held and `viewing == 11`. g637 is the mouse twin, g644 the
touch twin. One handle, one channel, no random bank: it is always sample 33.

Why it is interesting: it is **strictly 2 Hz on a fixed frame grid** (the timer
is global and free-running, not restarted on wind press), so each onset carries
`frame mod 30`. That is a phase reference — the thing `MINUS-3-STRATEGY.md` §3's
device refutation says open-loop Minus Toys lacks. And **every strategy on every
night must wind** (the Puppet is always armed), so it is a phase source for the
whole device-pilot program, not one strategy.

**Detectability (synthetic study, 2026-08-29):**

- The coarse **band-energy / recall stage is useless** — s0033's band profile is
  0.97-similar to a tonal contaminant candidate.
- A **per-tick waveform matched filter** (`correlate.best_match` at the known
  grid position) is clean: ≈0.8 normalised xcorr at 0 dB SBR, ≈0.3 at −12 dB vs
  a ~0.09 off-grid floor. Single tick reliable to ≈ −10..−12 dB SBR.
- **Folding that score across the ~60-tick 2 Hz grid** adds ≈+9 dB → phase
  recovery to ≈ **−20 dB SBR** when the tick is buried, with a **sub-millisecond**
  folded onset (inside the ±33 ms `DEVICE_EPOCH_LATCH` bracket).
- **In the realistic regime it is not close.** Leaked music-box + Mangle loops
  both at full volume, WinD at ~equal RMS over them: **57/57 grid ticks
  recovered** (median grid-corr 0.685), **0/57 in the no-WinD control**
  (0.080 grid, 0.081 off-grid). While you are actually winding, WinD is a
  foreground broadband transient and the stationary loops correlate ~0.08
  against it.
- **Naive epoch-folding on an energy envelope does NOT work** — the always-on
  ambient loops carry their own sub-0.5 s periodicity and a crude onset envelope
  mislocates the ratchet by 25–140 ms. Matched-filter-over-fold + bed
  subtraction (`detect.subtract`) is the shape; not built yet.
- **No other game audio is a phase-clock candidate** — the mask SFX (g254/g267/
  g270/g274) are one-shot press-triggered sounds, not periodic; a masked loop
  would anchor to the press, not the game grid. Only g637/g644's global 500 ms
  timer gives absolute phase.

**The section's own warning still applies.** Whether sample 33 *also* leaks
continuously is **unmeasured**:

- **It leaks:** the wind-gate is lost (tick ≠ winding), but a continuous leak
  still folds to a 2 Hz phase — usable as a pure phase source *if* the leak
  rides the same global 500 ms timer.
- **It doesn't:** an external-mic capture of the audible mix is clean, and the
  tick doubles as an "am I actually winding" confirmation.

The contaminants themselves are **not yet sourced to handles** — s0035 is the
Night-1 phone call, not the music-box tune; unverified candidates are s0020
(tonal), s0009 (noise), s0010 (74 s loop, g66).

Modelled as `WIND_TICK_SAMPLE`/`WIND_TICK_FRAMES` in `config.js`, emitted as a
`wind-tick` event, pinned by `sourcetest.mjs`.

## Discrete SFX are on the fast mixer and NOT captured — settled 2026-08-29

The winding tick, and every other discrete `Play sample` cue, **does not appear
in the internal capture on this device.** Confirmed three independent ways
against `n1-minustoys-calib-01` (Moto g56, `com.scottgames.fnaf2` 2.0.7+26):

1. **Ear** — 318 s of the real internal capture, audited by the device owner:
   no winding tick anywhere, just a continuous loop bed.
2. **Matched filter** — `s0033` injected into the capture scores 0.89/0.70/0.43
   at +6/0/−6 dB SBR (pipeline works), but matched-filter scan of the real
   capture at 656 onset candidates is at the ~0.045 noise floor for s0033,
   s0015 and s0020. Capture RMS is identical winding vs not-winding (0.994).
3. **`dumpsys media.audio_flinger` while winding** — FNaF (uid 10741) runs
   ~12 tracks on `AudioOut_15` = `AUDIO_OUTPUT_FLAG_DEEP_BUFFER` (the ambient
   loops, `Usg` 1 = USAGE_MEDIA) **plus one track (id 4999, session 14409) on
   `AudioOut_1D` = `AUDIO_OUTPUT_FLAG_FAST`** — the FastMixer thread,
   `mixPeriod=5.33 ms`. That fast track flips active↔standby every ~0.5 s with a
   **12513-frame (0.284 s at 44.1 kHz) burst = WinD's exact length.** WinD *is*
   that fast track.

**Mechanism.** Two AOSP topologies exist. Classic
([latency design](https://source.android.com/docs/core/audio/latency/design)):
"the normal mixer's sink is a blocking pipe to the fast mixer's track 0" — one
HAL output, and playback capture *does* get SoundPool. The g56 instead has
**three separate output threads each with its own `AudioStreamOut`**
(`AudioOut_D` PRIMARY, `AudioOut_15` DEEP_BUFFER, `AudioOut_1D` FAST), combined
only downstream at the HAL. `AudioPlaybackCapture` taps the normal mixer's
software output; the FAST stream is a sibling it never sees. **Device-specific:
a phone with the classic topology would capture these cues.**

**Not a tagging or policy issue.** `Application/CSoundPlayer.java:125` builds
`new AudioAttributes.Builder().setUsage(14).setContentType(4).setLegacyStreamType(3)`
— `setUsage(14)` is `USAGE_GAME`, which *is* capturable (and the runtime
resolves it to USAGE_MEDIA anyway via the legacy stream type). No
`setAllowedCapturePolicy` opt-out. Manifest `targetSdk=36`, no
`allowAudioPlaybackCapture` override. Music and SFX carry the same attributes —
music is captured, SFX are not — so it is purely the fast-mixer routing.

**Every fix is privileged:**

| Approach | Verdict on this phone |
|---|---|
| `setprop af.fast_track_multiplier 0` (drop SoundPool to the normal mixer) | **Denied** — `user` build, no root (tested: "Failed to set property"). |
| [XAudioCapture](https://github.com/wzhy90/XAudioCapture) (LSPosed) | Doesn't apply — it force-adds the *capture policy*; FNaF already allows capture. Needs Xposed regardless. |
| Tap the FAST HAL output / HAL loopback (`tinyalsa`) | System/root only. |

### Consequences

- **The winding-tick phase clock via internal capture is refuted.** External-mic
  capture of the audible mix (BT A2DP sink on a Linux box, or a wired 3.5 mm
  tap) is the only non-root path; the recompile's openal-soft `Play sample`
  hook is the frame-perfect one.
- **`plans/08` (the audio-cue controller) is blocked on this device.** BB's
  laughs are samples 21/23/24 — the same SoundPool/fast path. The Companion's
  2026-08-24 "PCM was nonzero" result was the ambient bed, never the vocals. An
  on-device `AudioPlaybackCapture` cue controller cannot hear discrete cues here
  without root.
- Recorded audio is still useful for **offline detector proofing** — an external
  mix recording can validate a detector that a rooted or recompiled build would
  then run live.
- **Do not assume an A2DP receiver solves this.** In theory the Bluetooth
  encoder is downstream of the HAL mix, but a receiver must first prove it is
  decoding the stream correctly. The Linux-receiver experiment below found a
  corrupt aptX HD stream, so it is not evidence that the game mix was captured.
  **Superseded later the same day:** the fault was isolated to PipeWire's
  receive path; BlueALSA passed the two-tone control (SBC and aptX HD) and the
  winding tick matched at NC 0.44–0.56 — see §"Linux Bluetooth receiver" and
  §"The A2DP mix DOES carry the fast-mixer SFX" below.
- **Flagship audio path (Pedro, 2026-08-30):** all cue work targets the
  validated external BlueALSA A2DP capture from now on
  (`packages/play/bin/audio/capture-bt-audio.sh`); internal capture stays settled-dead on this
  device. Night 2's vent-stage BB/Mangle tracking is the first consumer
  (`MINUS-3-STRATEGY.md` §9 "Night 2 detection scoping").

## Linux Bluetooth receiver: aptX HD failure and SBC control — 2026-08-29

This is a live-device finding, recorded specifically to prevent a repeat of a
bad conclusion: **a PipeWire/BlueZ node and advancing frames are not proof that
the PCM is valid.**

### What failed

The Moto g56 was paired as an A2DP source to this Linux PC. PipeWire exposed
`bluez_input.10_2B_1C_DA_18_2C.2`, and the phone reported the link using aptX
HD (48 kHz, 24-bit stereo). WAV files recorded from that node sounded like
static, not FNaF audio. The device owner independently audited them and
rejected them as game audio.

This was then checked without involving FNaF: a known two-tone WAV (440 Hz,
then 880 Hz) was copied to the phone, played through VLC, and recorded from the
same receiver node. The capture did **not** contain the expected two successive
tones. Therefore the defect is in, or before, this Linux aptX HD decode/capture
path; it cannot be blamed on a missed game action or an FNaF capture quirk.

### Current blocker

No file recorded through this PC's aptX HD A2DP-source node is usable as game
audio. In particular, the following artifacts are diagnostics only and must
not be used to train, validate, or time an audio cue detector:

- `/tmp/fnaf-wind-a2dp-1788034934.wav`
- `/tmp/fnaf-a2dp-windpair-1788035173.wav`
- `/tmp/phone-a2dp-tone-capture-1788035596.wav`

The earlier assertion that the receiver had captured the fully rendered game
mix was wrong and is superseded by this control test.

### SBC control result — failed (2026-08-29)

The phone was explicitly switched to SBC. Android then reported
`codecName:SBC`, 44.1 kHz, 16-bit stereo, and PipeWire reported
`api.bluez5.codec = "sbc"` with profile `a2dp-source`. The visible Android
settings summary still displayed aptX HD, but its live rate/bit-depth dials and
`dumpsys bluetooth_manager` show that summary was stale.

The two-tone control was repeated through that SBC link. Its spectrogram was
broadband static, with neither the 440 Hz nor the subsequent 880 Hz tone. Thus
forcing the mandatory baseline codec **did not repair the receiver**. The
failure is broader than the proprietary aptX HD decoder and remains isolated to
the **PipeWire** Bluetooth A2DP-source receive/decode/capture path. It does
not yet establish that the PC radio, BlueZ transport, or phone-to-PC A2DP link
is broken.

The Debian dock's microphone/privacy indicator appeared during these captures.
That was investigated rather than assumed: the live PipeWire graph showed
`pw-record:input_FL/FR` linked directly to
`bluez_input.10_2B_1C_DA_18_2C.2:output_FL/FR`, while those same Bluetooth
ports fed the PC's ALC257 speaker sink. There was no link from
`alsa_input...analog-stereo` (the laptop microphone) to the recorder. The
indicator is PipeWire's generic recording privacy signal; it is **not** proof
that the WAVs came from the microphone.

The active BlueZ transport is also structurally valid: its local endpoint is
the A2DP Audio Sink (`0000110b`), exactly what a PC receiving a phone's A2DP
source should use. Its SBC configuration is 44.1 kHz joint stereo, 8 subbands,
16 blocks, bitpool 2–53. The Intel 9560 Bluetooth controller reported link
quality 213/255 during the experiment. These checks narrow the remaining
problem to the BlueZ/PipeWire receiver implementation or its interaction with
this phone, rather than a microphone fallback, wrong A2DP direction, invalid
SBC negotiation, or an obviously weak radio link.

### Independent-decoder follow-up — in progress

The BlueALSA A2DP-sink backend (v4.3.1) was installed as a deliberately
independent receiver. It owns a matching PC-side source PCM:
`/org/bluealsa/hci0/dev_10_2B_1C_DA_18_2C/a2dpsnk/source` (S16_LE, stereo,
44.1 kHz, SBC). Its automatic player has that PCM open exclusively, so a direct
raw-PMC capture correctly returned `Device or resource busy`. This is not a
decoder error. Stop the automatic `bluealsa-aplay` service temporarily, run the
same 440 Hz → 880 Hz source through `bluealsa-cli open`, and inspect the raw
PCM. This test isolates PipeWire: a clean BlueALSA capture makes PipeWire the
fix target; a noisy one moves the fault lower to BlueZ/radio/phone interaction.

**Result: passed.** With `bluealsa-aplay` stopped, the direct BlueALSA PCM
capture (`/tmp/fnaf-sbc-check/bluealsa-tone-02.wav`) contained 440 Hz for
0.0–2.0 s, then 880 Hz for 2.0–4.0 s, then silence. This is the expected source
file structure. It proves that the phone-to-PC SBC transport and the BlueALSA
decoder are sound. The failure is therefore specific to PipeWire 1.4.2's
`api.bluez5.a2dp.source` path on this host; **BlueALSA is the validated
capture path** for an external audible-mix recording.

### Optional aptX HD follow-up

Restoring Android's default codec selection correctly renegotiated aptX HD
(48 kHz / 24-bit stereo); BlueZ showed an active Qualcomm aptX HD transport.
However, Debian's stock BlueALSA service starts without optional codecs and
reported only `A2DP-sink: SBC`, so it deliberately exposed no PCM for that
transport. This is a local service configuration limit, not proof that aptX HD
is corrupt.

To test HD, override the service to include its compiled codecs (for example,
`--all-codecs`), restart BlueALSA, then repeat the same two-tone acceptance
test. Do not promote aptX HD merely because it negotiated: it becomes the
preferred capture codec only if the direct BlueALSA PCM contains the expected
tones. SBC remains the validated fallback.

**Result: passed after a Debian-version correction.** The installed BlueALSA
4.3.1 does not implement the newer `--all-codecs` switch. Its service was
instead configured with `-c aptX-HD`; status then showed `A2DP-sink: SBC
aptX-HD`. WirePlumber was stopped and the A2DP profile reconnected so that the
two sound servers did not compete for BlueZ endpoints. This matters:
WirePlumber logged that multiple PipeWire/PulseAudio/BlueALSA instances trying
to manage the same Bluetooth audio transport can cause problems.

BlueALSA then exposed an active aptX HD source PCM: 48 kHz stereo, `S24_LE`.
The direct tone control again contained 440 Hz from 0.0–2.0 s and 880 Hz from
2.0–4.0 s. `S24_LE` here carries valid 24-bit samples in the low bits of a
32-bit container; normalising a standard 32-bit decode by `volume=256` is
needed for a conventional 16-bit audition WAV. This is a container-conversion
detail, not noise or a decoder failure. **aptX HD via exclusive BlueALSA is now
validated and is the preferred external game-audio path on this PC.**

### Resolution procedure (PipeWire path blocked; BlueALSA validated)

1. Do **not** record more game audio through PipeWire's Bluetooth receiver; its
   mandatory SBC control failed.
2. For this PC, stop `bluealsa-aplay` and read the validated BlueALSA source
   PCM with `bluealsa-cli open` while recording. Do not run PipeWire and
   BlueALSA as competing A2DP endpoint owners for the same capture.
3. Restart `bluealsa-aplay` afterwards if PC speaker/headphone monitoring is
   wanted (`sudo systemctl start bluealsa-aplay`).
4. Only after the tone control passes, repeat a deliberately audible FNaF action
   and label the resulting PCM. Node existence, packet flow, and non-zero RMS
   are insufficient acceptance criteria.

The configuration attempt to restrict WirePlumber to SBC with
`override.bluez5.codecs = [ sbc ]` did not take effect on this host: after a
WirePlumber restart and reconnect, the negotiated codec remained aptX HD. Do
not treat that configuration fragment as a fix. Selecting SBC on the phone did
force SBC successfully, but the controlled PCM remained invalid.

Sources for the resolution: Android documents that A2DP negotiates a supported
codec and that users can disable HD Bluetooth audio codecs in Settings
([AOSP Bluetooth services](https://source.android.com/docs/core/connect/bluetooth/services)).
WirePlumber documents the per-user configuration-fragment mechanism and codec
override property
([WirePlumber configuration](https://pipewire.pages.freedesktop.org/wireplumber/daemon/configuration/modifying_configuration.html)).

## The A2DP mix DOES carry the fast-mixer SFX — winding tick matched, 2026-08-29

The step-4 test above ran: FNaF 2 (`com.scottgames.fnaf2` 2.0.7+26, Moto g56)
driven to a night, music box wound, captured through the validated
**phone → aptX HD → BlueALSA → `bluealsa-cli open` → raw S24_LE/32-bit** path
with `bluealsa-aplay` and WirePlumber stopped. Container normalised `volume=256`,
resampled to 48 kHz mono. Reference: `res/raw/s0033.wav` pulled straight from
`base.apk` (`packages/source/decompile/extract-samples.sh` — sample handle 33 `'WinD'`, 12513
samples / 0.284 s at 44.1 kHz, the exact fast-track burst length recorded in
"Discrete SFX are on the fast mixer" above).

**Result: the winding tick is present in the A2DP capture.** Normalised
matched-filter (`s0033` vs the recording, energy-normalised sliding correlation):

| window | max NC | notes |
|---|---|---|
| on-device `AudioPlaybackCapture` while winding (`n1-minustoys-calib-01`, prior finding) | **0.045** | noise floor — tick absent, the FAST-mixer sibling stream |
| this BlueALSA capture, not winding (t=40–50 s) | 0.09–0.15 | true not-winding baseline on the same path |
| this BlueALSA capture, winding (t≈6–30 s) | **0.44–0.56** | isolated peaks clearing 0.35; ~4× the not-winding baseline, ~10× the on-device floor |

For calibration the same pipeline scores injected `s0033` at 0.89 / 0.70 / 0.43
for +6 / 0 / −6 dB sample-to-bed ratio, so 0.56 corresponds to roughly a 0-dB
tick under the CAM 11 static bed.

**So the Bluetooth encoder really is downstream of the full HAL mix.** The
`AUDIO_OUTPUT_FLAG_FAST` SoundPool stream that `AudioPlaybackCapture` never sees
*is* combined into the A2DP stream. This recovers the non-root path for
`plans/08` offline detector proofing and for the winding-tick phase clock
(`MINUS-3-STRATEGY.md` §9), and BB's laughs (samples 21/23/24, same fast path)
should come with it.

**Not yet resolved — the 2 Hz phase grid.** This was a single hand-wound take:
matched peaks in the winding window are sparse (0–2 per 2 s, not the 4 per 2 s a
clean 2 Hz train would give) and an envelope autocorrelation does not lock at
0.500 s (best-fit period 0.497 s but phase-jitter std ≈ 66 ms). Cause is
undetermined — intermittent hand contact, low sample-to-bed ratio clipping all
but the loudest ticks, or A2DP delivery jitter smearing the grid. **The
frame-vs-wall-locked question (`MINUS-3-STRATEGY.md` §9) needs a scripted
continuous wind with a quieter camera bed and a timestamped capture**, not this
recording.

**Also observed, and it matters for cue timing:** the A2DP stream **suspends on
true silence.** A capture spanning a night→menu transition showed ~3 s of exact
zero samples (`peak=0`, not a noise floor) during the silent load screen, then
audio resumed. Any absolute-time cue anchor off this path has to expect a
resume gap after every silent stretch. Content is also band-limited to
~10.5 kHz — consistent with the game's own low-rate assets, and a useful sanity
check that a capture is the game mix and not broadband noise or a mic fallback.

**Reproduce.** `packages/play/bin/audio/capture-bt-audio.sh <seconds>` wraps it:
`bluealsa-cli open /org/bluealsa/hci0/dev_<mac>/a2dpsnk/source` to a raw file
(nothing else may hold that PCM), then `ffmpeg -f s32le -ar 48000 -ac 2 -i raw
-af volume=256 out.wav`. Reference samples: `packages/source/decompile/extract-samples.sh
~/fnaf-apks/fnaf2/base.apk` pulls `res/raw/sNNNN.*` by handle. Raw artifacts and
the winding reference: `~/fnaf-apks/audio-capture-2026-08-29/` and
`~/fnaf-apks/bt-audio-captures/` (outside the repo, game content).

## Can the target phone consume its own A2DP stream? — no on stock, 2026-08-30

This was checked after proposing a phone-only controller: could the g56 enable
Android's A2DP-sink role, pair to itself, and receive the full HAL mix without
another physical endpoint? **Not on the stock, unrooted target.** This is two
different constraints, not merely a missing app:

1. **The sink profile is a disabled system service.** AOSP ships the ordinary
   phone configuration with `profile_supported_a2dp_sink=false`; current AOSP's
   `A2dpSinkService.isEnabled()` starts it only when the system Bluetooth
   property enables that profile. `BluetoothA2dpSink` is a hidden framework
   API, not a profile an ordinary application can instantiate. Sources:
   [AOSP Bluetooth config](https://android.googlesource.com/platform/packages/apps/Bluetooth/+/main/res/values/config.xml),
   [A2dpSinkService](https://android.googlesource.com/platform/packages/modules/Bluetooth/+/refs/heads/master/android/app/src/com/android/bluetooth/a2dpsink/A2dpSinkService.java),
   [hidden BluetoothA2dpSink API](https://android.googlesource.com/platform/packages/modules/Bluetooth/+/refs/heads/main/framework/java/android/bluetooth/BluetoothA2dpSink.java).
2. **An A2DP role is still one end of a link to a remote peer.** The source
   service checks that the remote device advertises the A2DP Sink UUID before
   it connects; the sink native interface likewise accepts a remote
   `BluetoothDevice` address. Enabling source and sink concurrently therefore
   permits connections to other devices in both roles. It does not synthesize
   a second peer or route the local source back to the local sink. Sources:
   [A2dpService](https://android.googlesource.com/platform/packages/modules/Bluetooth/+/refs/heads/main/android/app/src/com/android/bluetooth/a2dp/A2dpService.java),
   [A2dpSinkNativeInterface](https://android.googlesource.com/platform/packages/modules/Bluetooth/+/refs/heads/master/android/app/src/com/android/bluetooth/a2dpsink/A2dpSinkNativeInterface.java),
   [Bluetooth BR/EDR baseband](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core-61/out/en/br-edr-controller/baseband-specification.html).

The second conclusion is an architectural inference from the profile and
baseband contracts: neither Android nor the Bluetooth specification offers a
"pair this controller to its own address" operation. The radio link is between
distinct Bluetooth devices. Android's `a2dpConcurrentSourceSink` feature flag
does not change that contract.

The live target agrees. A read-only `adb shell dumpsys bluetooth_manager` on
the Moto g56 reported:

```
Enabled Profile Services: A2DP
A2DP Source State: Enabled
A2DP Sink State: Disabled
SDP A2DP source handle: 65539
SDP A2DP sink handle: 0
```

There is a further application boundary even if a custom system image enables
the sink: the system Bluetooth service owns the AVDTP connection and decoder;
it does not publish the decoded PCM as a public `AudioRecord` source for the cue
helper. A local software loop would therefore require a Bluetooth/audio-stack
patch in addition to enabling the role.

Rejected near-misses:

- **Virtual Bluetooth controller:** AOSP RootCanal can create virtual
  controllers and peers, but it is emulator/test infrastructure. AOSP's own
  physical-device setup requires a built system component and `adb root`, so it
  is not a stock-phone escape hatch
  ([RootCanal](https://android.googlesource.com/platform/packages/modules/Bluetooth/+/refs/heads/master/tools/rootcanal/),
  [Pandora setup](https://android.googlesource.com/platform/packages/modules/Bluetooth/+/43ebbf5565851af3e0de28b2089af7c98ad07c65/android/pandora/server/README.md)).
- **Decode outbound packets from HCI snoop:** full BTSnoop can contain HCI
  packets, but Android stores it under `/data/misc/bluetooth/logs` and documents
  extraction through a bug report. That is a privileged/post-run diagnostic,
  not a low-latency PCM feed available to the controller
  ([AOSP Bluetooth debugging](https://source.android.com/docs/core/connect/bluetooth/verifying_debugging)).
- **Same-phone microphone:** this is an acoustic recording, not A2DP. It remains
  suitable for post-run experiments, not the controller timing loop (§"Practical
  recording workarounds" and `plans/08` gate 1).

**Consequence.** For the original stock, unrooted game, consuming the discrete
FAST-mixer cues live requires a genuinely external audible-mix endpoint: the
validated BlueALSA receiver, a proven A2DP-sink MCU, or a wired tap. A rooted or
custom-ROM phone could remain physically standalone, but then a direct FAST-HAL
tap is simpler and lower-latency than manufacturing an A2DP self-loop. The
recompiled game remains the clean phone-only route: report `Play sample`
directly before audio routing.

## Retracted: phone → ESP32 → same-phone PCM loopback

**Retraction, 2026-08-31.** The architecture in this section was implemented
as an experiment and rejected after severe loss in its returned PCM path. It is
kept below as a boundary/prior-art record, not as a runtime recommendation.
The supported direction is local ESP32 DSP -> timestamped semantic fact ->
belief/reflex controller; see
[`REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md`](REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md).

The experimental target was deliberately a physical loop rather than a second
on-phone capture API:

```
FNaF 2 on phone -> Bluetooth A2DP -> ESP32 sink
ESP32 decoded PCM -> Wi-Fi UDP 49710 -> Companion on the same phone
Companion -> detector / recorder / AudioTrack -> built-in speaker
```

The word **callback** does not remove the return transport. ESP-IDF invokes
`a2dp_data_callback()` *inside the ESP32* after its A2DP sink has decoded SBC
into interleaved signed 16-bit PCM. The callback provides a transient local
buffer; it is not an Android callback and does not cross back to the phone.
`send_pcm()` therefore copies that PCM into sequenced, timestamped UDP
datagrams. The helper receives them on port 49710, validates the packet header
and sequence, then feeds the same returned samples to the analyzer, WAV sink,
and optional `AudioTrack` monitor. No DAC/ADC or acoustic microphone leg is
involved.

Returning the complete stream needs a real data channel. At 44.1 kHz, stereo,
16-bit, the payload alone is **176,400 bytes/s**; health and detected-event
facts are tiny enough for a low-bandwidth control link, but human monitoring
is not. The ESP32's Wi-Fi AP is therefore not redundant with the A2DP callback:
A2DP carries the game mix *to* the ESP32, while Wi-Fi carries the decoded mix
back to the phone.

### Internet precedent search — 2026-08-30

No public implementation was located for the exact self-returning topology
above, especially as a workaround for a device-specific Android fast-mixer
capture omission. This is a search result, not a claim that nobody has ever
built one. The individual pieces all have public precedent:

- Espressif documents an A2DP sink whose receive callback exposes decoded
  audio, and the open-source
  [ESP32-A2DP](https://github.com/pschatzmann/ESP32-A2DP) library likewise
  exposes the PCM stream to application code. These establish the
  `A2DP -> decoded PCM callback` half, not a return to the source phone. See
  [Espressif's A2DP API](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/bluetooth/esp_a2dp.html).
- An [ESP32 multi-room implementation](https://www.reddit.com/r/esp32/comments/1vqw4z8/esp32_based_multiroom_audio_system/)
  uses an ESP32 as Bluetooth ingress and distributes the resulting audio over
  Wi-Fi/UDP. That is the same bridge shape, but its Wi-Fi consumers are other
  playback nodes rather than the originating phone.
- A [Chromecast private-listening build](https://www.reddit.com/r/raspberry_pi/comments/12dtx2x/how_i_set_up_my_chromecast_to_transmit_sound_to/)
  routes source audio through a Raspberry Pi and back to a phone over Wi-Fi.
  It establishes the external-receiver-to-phone listening pattern, but the
  source is a Chromecast, not that same phone.
- Android network players such as
  [Aurelay](https://github.com/IshuSinghSE/aurelay) receive raw PCM over the
  network and render it with Android audio output. That is the final
  `network PCM -> phone speaker` leg in isolation.

So the building blocks are conventional; their composition here is unusual.
The project uses it because Android's documented
[`AudioPlaybackCaptureConfiguration`](https://developer.android.com/reference/android/media/AudioPlaybackCaptureConfiguration.html)
is a player/policy-filtered capture facility, not a promise of the complete
post-HAL signal delivered to an external A2DP sink. On the g56 the measured
FAST and DEEP_BUFFER sibling streams make that distinction load-bearing.

The closest implementation also exposes the main engineering risk: Bluetooth
Classic and Wi-Fi share the ESP32's 2.4 GHz radio. The multi-room precedent
above reports enough contention/jitter to split ingress and distribution over
two microcontrollers. This project keeps one ESP32 for now, so PCM sequence
numbers, capture timestamps, bounded queues, loss counters, and a startup
jitter buffer are correctness requirements rather than optional polish.

### Legacy: listening while capturing through the host

The two sound servers must not both manage Bluetooth. WirePlumper keeps this
PC's own card; BlueALSA owns the phone, exclusively. Persistent config,
`~/.config/wireplumber/wireplumber.conf.d/60-fnaf-phone-sbc.conf`:

```
monitor.bluez.enabled = false
wireplumber.profiles = { main = { monitor.bluez = disabled } }
```

`sudo systemctl edit bluealsa` → `ExecStart=` then
`ExecStart=/usr/bin/bluealsa -S -p a2dp-source -p a2dp-sink -c aptX-HD`
(Debian's 4.3.1 has no `--all-codecs`).

- **Hear the phone:** `bluealsa-aplay --profile-a2dp --volume=software <mac>`
  streams it to the default PipeWire sink, where it mixes with normal desktop
  audio — so PC sound and game sound both reach the headphones at once.
- **Hear the phone *during* a capture:** `capture-bt-audio.sh` stops
  `bluealsa-aplay` for the capture window (single-consumer PCM), tees the raw
  stream to the default sink at +48 dB so monitoring never drops, and restarts
  `bluealsa-aplay` on exit.

The reboot state described here was superseded by the persistent setup below.

### Current host modes and loss acceptance — 2026-09-22

The reboot note above is historical.  The host now has a persistent two-mode
setup, and the ownership invariant remains: **BlueALSA owns Bluetooth media
endpoints; WirePlumber manages the PC's non-Bluetooth devices with its BlueZ
monitor disabled.**  BlueALSA's system service enables both `a2dp-source`
(PC -> headphones) and `a2dp-sink` (phone -> PC capture).

The failure found on 2026-09-22 was not a codec failure.  A user PipeWire
fragment unconditionally constructed an ALSA sink for the WH-1000XM6.  When
the headphones were off, the BlueALSA ALSA plugin returned `ENODEV`; that
optional object's failure aborted PipeWire itself.  The daemon restarted every
three seconds, taking WirePlumber with it.  The repair is
`flags = [ nofail ]` on that optional `context.objects` entry.  A missing
headset now omits only that sink and leaves the built-in audio graph running.
The Brave-specific forced target was also removed: desktop clients follow the
current default sink and therefore fall back when Bluetooth disappears.

`~/.local/bin/bluealsa-wh1000xm6-route` owns the remaining lifecycle, and
`bluealsa-wh1000xm6-route.service` runs its `watch` command in the user systemd
session.  It watches only the headphone playback PCM
`.../dev_<headphone-mac>/a2dpsrc/sink`.  When that PCM appears, it restarts
the optional PipeWire object once and selects it as the default.  It does not
react to the phone capture PCM
`.../dev_10_2B_1C_DA_18_2C/a2dpsnk/source`, so connecting the FNaF source does
not rebuild the desktop graph.  `~/fix-bt-audio.sh` is a compatibility wrapper
for the router's `regular` command.

The two operator modes are:

- `~/.local/bin/bluealsa-wh1000xm6-route regular` — leave capture isolation,
  connect the WH-1000XM6, expose its BlueALSA PCM as a PipeWire sink, and make
  it the desktop default.
- `~/.local/bin/bluealsa-wh1000xm6-route fnaf` — set a runtime isolation guard
  and disconnect the WH-1000XM6.  This keeps a simultaneous headphone A2DP
  stream out of the phone-capture radio budget.  It does not alter or consume
  the phone PCM.
- `~/.local/bin/bluealsa-wh1000xm6-route status` — report the Bluetooth link,
  BlueALSA PCM, PipeWire node, isolation guard, and current default sink.

The PipeWire `nofail` repair and the FNaF recorder are different layers:
`capture-bt-audio.sh` reads BlueALSA directly, so disabling `nofail` is not a
valid capture A/B.  It merely restores the desktop daemon crash loop.  Compare
the retained pre-repair sidecars with new captures under identical continuous
content.  The old sidecars are a rough, non-paired baseline: the 2026-09-22
census found 13 S24_LE/48-kHz captures with mean missing fraction 0.2385 and 6
S16_LE/44.1-kHz captures with mean 0.0765; none was `CONTINUOUS`.  Different
run lengths and content make those aggregate means diagnostic, not a codec
ranking.

Use `--start`/`--stop` for an acceptance capture.  That path reads the
negotiated PCM format and emits the duration/loss sidecar; the fixed-seconds
audition path does not provide the same acceptance evidence.

```bash
cd ~/Projects/fnaf2-1020
~/.local/bin/bluealsa-wh1000xm6-route fnaf
mkdir -p ~/fnaf-apks/bt-audio-captures

tag="after-audio-route-fix-$(date +%Y%m%dT%H%M%S)"
base="$HOME/fnaf-apks/bt-audio-captures/$tag"

packages/play/bin/audio/bt-audio-link.sh --ensure
packages/play/bin/audio/capture-bt-audio.sh --start "$base"
# Keep the same continuous title/menu music or in-game ambience playing for
# 300 seconds.  Do not lock the phone or allow another Bluetooth audio stream.
packages/play/bin/audio/capture-bt-audio.sh --stop "$base"

jq '{format,rate,channels,wallDurationMs,audioDurationMs,missingMs,missingFraction,timeAxis}' \
  "$base.bt.json"
```

Run three 300-second repetitions per condition.  A transport passes only when
every repetition has `timeAxis = "CONTINUOUS"`, which this recorder defines as
`abs(missingFraction) <= 0.005`.  The A2DP stream is known to suspend on true
silence, so a silent loading interval confounds wall duration with packet loss;
continuous known content is mandatory for this comparison.  Restore desktop
headphone mode afterwards with `~/fix-bt-audio.sh`.
