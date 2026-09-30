# Audio witnesses: what the dumped samples could tell the device pilot (2026-09-13)

Written at Pedro's request at the end of the 2026-09-13 session, after the
Night 6 phase work showed the diagnosis now hangs on one quantity no video
instrument can see: the phase of the game's five-second timer. This page maps
every sample handle the night frame plays to the game event that plays it,
says which of those would be a witness for an open question, and names the
instruments that would consume them. Nothing here is built; every claim about
capture paths is from [`ANDROID-AUDIO-CAPTURE.md`](ANDROID-AUDIO-CAPTURE.md).

## Where audio capture stands

| path | status | what it carries |
|---|---|---|
| on-device `AudioPlaybackCapture` (Companion `audioRecord`) | works, wrong stream | the deep-buffer loops only (music box s0015, Mangle s0020, ambience). Every discrete `Play sample` cue is on the FAST mixer and absent. Settled 2026-08-29. |
| phone -> Bluetooth A2DP -> Linux BlueALSA (`bluealsa-cli open`, SBC) | decoder validated 2026-08-29; integrated as `night-run.sh --bt-audio`; transport continuity still unqualified | the full HAL mix: the winding tick s0033 matched at 0.44-0.56 NC while winding, 0.09-0.15 not winding. `capture-bt-audio.sh --start/--stop` supplies host-clock bounds and a loss sidecar; see `ANDROID-AUDIO-CAPTURE.md` §"Current host modes and loss acceptance". |
| phone -> ESP32 A2DP sink -> Wi-Fi PCM -> same phone | retracted 2026-08-31 (loss) | -- |
| ESP32 as local DSP -> timestamped cue facts | firmware archived 2026-09-24 (`firmware/esp32-audio-consumer`, [`../ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)), one shadow model (`~/fnaf-apks/cue-models/bang-shadow-g56-bluealsa-20260830.txt`, cue=bang id=17, threshold 0.35) | never connected on a graded run: every 2026-09-12/13 run reports `audio=ESP32 state=UNKNOWN reason=esp32-not-connected`, `audioAnalyzer=UNAVAILABLE reason=model-missing`. |
| extracted references (`~/fnaf-apks/cue-refs`) | partial | s0015-s0033 as wav (s0015/s0020 also ogg). Handles 3-14 and 34-66 are not extracted. `packages/source/decompile/extract-samples.sh` pulls from `base.apk`. |

## The handle map (event sheet `Play sample` / `PlayLoopingChannelSample`, night frame 3)

Generated from `~/fnaf-apks/fnaf2/events/all-events.txt` (every group that names
the handle, with its first conditions). "Witness" says what a detection would
establish for the pilot. Handles the menu/custom-night frames play (44-59, 61,
63-66) are omitted.

| handle | groups | game meaning [SOURCED from the conditions] | witness value |
|---|---|---|---|
| 3 | g61, g109-110 | room ambience loop | none |
| 9 | g61, g281-297 | mask-up breathing loop | **mask fully on / off instants** (g9 sets `mask` = 2 after the put-on animation; the breathing starts there): the mask-tick count Balloon Boy needs (g907) becomes observable per window |
| 10 | g448-449, g478 | blackout / camera-signal-lost loop; muted when `in danger` = 0 and `your view` alt1 = 0 | **`in danger` = 1 window** (g443-447 raise it, g538-548 clear it after 300 frames): the encounter window that refuses every light (g75). Would settle the seven FLAT flashes of night5-hallfix per cycle |
| 12, 62 | g71, g78-79, g575, g976 | the jumpscare scream (`being attacked by` > 0) | **death instant to the frame**; the video's death-static detector lags it by 5-20 s |
| 13 | g9-12 | camera/button UI clicks (KeyPressed) | our own presses landing in the game (acceptance witness, cf. the 33 ms lost contact) |
| 16 | g78, g88, g302, g304 | the flashlight click that plays when the light is pressed with `in danger` = 0 and **Balloon Boy overlapping the got-you box** (g78/g88), and the vent-light clicks (g302/g304) | **Balloon Boy inside**: the click that replaces the beam is the exact witness of the two 2026-09-13 deaths (c1 81 s, d2 150 s) |
| 17 | g691-694 | the vent bang, played when `cam 01` alt21 is set by an endpoint (g538-548: a repelled Withered leaves) or a route move (`THUD_SAMPLE` in the model: BB and the Withereds moving into a vent) | **a five-second-tick witness**: route moves fire on the `Every 5000 ms` rolls (g337-342); each bang timestamps the game's grid to the millisecond |
| 20 | g61, g732-733 | Mangle's radio, volume by proximity | Mangle position (the dormant-Mangle corner problem has no video feature yet) |
| 21, 23, 24 | g607-610, g743, g814 | Balloon Boy vocals ("hi", "hello", laugh; g814 every 2 s with BB at the got-you box) | **BB at the opening** (the window the mask must cover) and **BB inside** (the 2 s laugh loop) |
| 25-29 | g704-708 (`cam 01` alt5) | the five "hear footsteps" sounds, chosen by g698 when Withered Foxy overlaps `hear footsteps` (alt2 > 0: he is coming) | **Foxy in transit to the hall** -- his arrival roll (g337, a five-second tick) made audible |
| 30-32 | g709-711 (`cam 01` alt12) | Mangle movement sounds (`MANGLE_MOVEMENT_SAMPLES`) | Mangle moves, on the five-second grid |
| 33 | g637, g644 | `WinD`, the winding ratchet, every 500 ms while the wind button is held on CAM 11 | **split-arming witness**: a cycle with no WinD ticks is a failed arm (the model's 50 ms Puppet holes); and the 500 ms sub-grid of the game clock |
| 34 | g812 | plays when `blackout timer` >= 30 | the encounter's own sound (pairs with 10) |
| 35-40 | g751-756 | the phone calls, nights 1-6 | night identity, muted by the route |
| 41 | g0 | ambience (looping, StartOfFrame) | none |
| 42 | g790, g798 | the mute-call button | our press |
| 43 | g826 | the Puppet's music-box tune (looping while the sockpuppet is not on CAM 11) | **Puppet out of the box** |
| 60 | g61, g68 | hall ambience ("someone near the hall", owner's Foxy watch cue; gate untraced) | possible Foxy-in-hall witness, needs the volume gate traced |

Resolved by this table and not before: 16 is the BB-inside click, 17's route
triggers, 25-29 are Foxy's footsteps, 21/23/24's g814 loop is BB inside.
Unresolved: 60's volume gate; whether 17 also fires for BB's vent hop
(`bb.pending` in the model emits `THUD_SAMPLE` -- verify against g691-694's
alt21 writers before trusting it as a BB cue).

## Measured on the first capture (night6-anchorede2, 2026-09-13)

See [`night6-anchorede2-audio-20260913.md`](../evidence/night6-anchorede2-audio-20260913.md).
Strong at single-onset level: s0060 (0.95), s0010 (1.00), s0013 (0.99),
s0017 (0.79), s0062 (0.75), s0009 (0.59), s0005 (0.60), s0031 (0.54).
Fold-only: s0033 (WinD, z 6-16 per hold), s0025-29 (footsteps, NC <= 0.40).
Not detected on a run without Balloon Boy inside: s0016, s0021-24 (hi at 0.35).
Two corrections to the table above: s0017 also fires for the ENDPOINT bang
(g538-548, five seconds after an encounter), so it is a roll witness only when
no encounter precedes it; and the capture's time axis is only as good as the
transport -- aptX-HD through BlueALSA lost 7.6 % of samples, SBC is the
validated decoder control, and the sidecar now says CONTINUOUS or BROKEN.  A
2026-09-22 census of sidecars found no continuous historical capture; the
controlled acceptance gate is now three 300-second runs, each at no more than
0.5 % missing samples, under continuous content and FNaF-isolated host mode.

## What the open questions need, and which handle answers them

1. **The five-second grid phase.** Night 6 is won or lost by where the g337
   roll ticks fall in the 10 s cycle (band 150-380 ms wide). Today the phase is
   inferred from the helper's latched onset with a measured -70 ms bias; no
   instrument sees the ticks. Handles 17 (vent bang) and 25-29 (footsteps) fire
   on those ticks. A matched-filter onset list folded mod 5000 ms against the
   release instant gives the delivered phase per run **on the game's own grid**,
   and its drift over 420 s.
2. **Balloon Boy inside.** Two deaths on 2026-09-13 were BB walking through a
   4.5 s mask window; the model let him leave. Handle 16 (the light click with
   BB at the got-you box) and 21/23/24 (g814 laugh every 2 s) say when he came
   in, so the model's BB entry rule can be fixed against dated evidence.
3. **The refused flash.** Seven of 41 post-mask flashes on night5-hallfix never
   fired; the sourced cause is `in danger` (g75). Handle 10's un-muting is that
   latch. Per-cycle `in danger` windows would let the model's blackout timing be
   compared against the phone's.
4. **Death instant.** 12/62 replace the static detector's 5-20 s lag and put
   the killer's timing next to the last action.
5. **Arm verification.** 33 per cycle: no ticks, no split.

## Instruments this would justify

| instrument | consumes | produces | gate it feeds |
|---|---|---|---|
| `tools/device/bt-audio-capture.sh` | BlueALSA capture started/stopped by `night-run.sh` (new `--bt-audio`), host-clock stamped at start, aligned to the release by the HID release event | `captures/<run>.bt.wav` + `<run>.bt.json` (start stamp, rate, drops) | none (retention) |
| `packages/review/bin/report/tickphase.py` | the capture + `cue-refs` s0017, s0025-29, s0030-32 | onset list per handle; `gridPhaseMs` (mod 5000 vs release), per-cycle drift, NC scores | `phase-reconstruct.mjs` gains a `deliveredGridPhaseMs` beside `deliveredEpochMs`; the anchor evidence's `onsetBiasMs` becomes a measurement per run |
| `tools/device/bb-inside.py` | s0016, s0021/23/24 | BB-at-opening and BB-inside intervals | run-report's `encounter` section; the model's BB entry rule test |
| `tools/device/danger-windows.py` | s0010 envelope (loop un-muted) | `in danger` intervals per cycle | the FLAT-flash census (`bracket`), blackout timing vs model |
| `tools/device/death-cue.py` | s0012/s0062 | death instant, +-1 frame | `grade-run.sh` survival line, replacing the static heuristic when audio is present |
| `packages/source/decompile/extract-samples.sh` (extend) | `base.apk` | all handles 3-66 as wav under `cue-refs` | corpus for the above |
| `tools/device/wind-ticks.py` | s0033 | ticks per cycle, first-tick phase mod 500 | arm verification per cycle (replaces the model's arming-hole guess) |

Every one of these is offline on a retained capture, the same shape as the
video instruments in `grade-run.sh`; none touches the live loop, which
`REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md` reserves for the ESP32 facts.

## Order

1. Qualify transport continuity with the three-run acceptance gate in
   `ANDROID-AUDIO-CAPTURE.md`; do not read phase from a BROKEN time axis.
2. Extend `extract-samples.sh` to every night-frame handle (no device needed).
3. Verify alignment on a retained run: the WinD ticks at 500 ms must land on
   the wind holds the plan emitted.
4. `tickphase.py` on that capture: the first direct measurement of the game's
   five-second grid against the anchor. This is the instrument the Night 6
   band needs before the next anchored attempt is priced.
5. `bb-inside.py` and `death-cue.py`, then re-read the three 2026-09-13 deaths.
