# fnaf2-1020

Everything needed to understand, derive, and execute a winning strategy in *Five
Nights at Freddy's 2*'s **10/20 mode** — built on a decompile of the modern
Android release rather than on folklore.

**Canonical target:** `com.scottgames.fnaf2` v2.0.7, the modern Android release-7
build (Fusion build 296, August 2025). PC and community material is kept as
attributed supporting research, never silently merged into Android rules.

**Mission:** make this 10/20 night understandable, learnable, and demonstrably
controllable through an evidence-labelled model, proven policies, and claims
that real-device evidence can support. The five-layer program — truth,
understanding, decision, embodiment, and proof — is stated in the
[project charter](PROJECT-CHARTER.md).

The currently usable public output is a touch trainer that drills the **Minus
7** strategy on a phone. It is backed by a simulator whose every constant carries
its evidence, a search lab that keeps negative results, a real-device harness,
and an emerging constrained-controller path. Human training, stock-device
control, and the faithful-recompile route all use the same evidence base rather
than competing to define the project.

**[Play the trainer →](https://ppvaz.github.io/fnaf2-1020/)**

![lesson brief](docs/brief.png)

## What's here

- **[The trainer](#the-trainer)** — ten-lesson drill ladder for Minus 7,
  touch-first, graded in milliseconds against measured lopsided windows.
- **[The model](docs/android/ANDROID-SOURCE-STATUS.md)** — the Android night loop
  in `src/engine.js`, every constant labelled `[SOURCED]`, `[CALIBRATED]` or
  `[INFERRED]`, with the ledger enforced by `tools/sourcetest.mjs` rather than
  merely asserted in prose.
- **[The decompile](docs/android/SOURCE-DUMP-GUIDE.md)** — how the event sheet was
  extracted and read, including the **XOR-28 object-handle scramble** that
  silently corrupts every naive Clickteam Fusion Android dump.
- **[Strategy research](#strategy-research)** — the 10/20 meta from 2014 onward,
  the searches this repo ran, and what they closed.
- **[On-device validation](#on-device-validation)** — adb harness, recorded-trial
  grading, and a libc-free on-phone classifier.
- **[Project charter](PROJECT-CHARTER.md)** — the shared vision, mission, scope,
  and claim discipline for the trainer and controller research.
- **[Docs index](docs/README.md)** — all of the above, routed by question.

## What Minus 7 is

The classic strategy flashes **CAM 10**, **CAM 04** and **CAM 07** every five
seconds to hold seven animatronics on their routes. Foxy, Golden Freddy and
Balloon Boy are handled by hand.

The core loop, on every time ending in **2** or **7**:

> cams down → mask flick → flash the hall → cams up → CAM 10 → CAM 04 → CAM 07 → CAM 11 → wind

> **Android provenance (2026-08-20):** the 400-frame (6.67 s) camera-flash
> stall is **decompile-confirmed on the owned release-7 binary** — the flash
> groups load it from a `stun time` counter that nothing ever rewrites. A
> same-week audit briefly declared it disabled; that reading came from the
> runtime's XOR-scrambled object-handle table, now corrected in the tooling
> (a discovery that affects every Clickteam Android decompile). The corrected
> source model passes the shipped schedule 200/200; see
> [`ANDROID-CAMERA-STALL.md`](docs/android/ANDROID-CAMERA-STALL.md).

Ten inputs in about 1.5 seconds, then three and a half seconds of winding. Full mechanical detail,
with sources, is in [MINUS-7-STRATEGY.md](docs/strategy/MINUS-7-STRATEGY.md).

Strategy by **Niko Frost** (13 December 2023). This repo is a practice tool, not the strategy.

## The trainer

### Why a trainer

Minus 7 has no unwinnable RNG — every loss is a mechanical mistake. That makes it exactly the kind
of skill a drill machine can teach, and exactly the kind that is miserable to learn inside a
7-minute run where one slip ends the night.

### The lessons

Ten steps, each adding one thing and hiding every control it doesn't need:

| # | Lesson | Adds |
|---|---|---|
| 1 | The beat | tapping on `:X2` / `:X7`, nothing else on screen |
| 2 | The sweep | CAM 10 / 04 / 07 with the camera light |
| 3 | Sweep, then wind | CAM 11 and the hold-drag to WIND |
| 4 | Down and back | the office half: cams down, mask, hall flash, up |
| 5 | The whole cycle | both halves, nothing lethal |
| 6 | The cycle, for real | Foxy and Golden Freddy live |
| 7 | Hearing Balloon Boy | cams down across every 5s interval |
| 8 | The duel | the ~0.7s reaction window after his leaving bang |
| 9 | Full night | 7:00, real RNG |
| 10 | Worst luck | every roll pinned to the worst case |

Each needs N clean passes in a row to unlock the next. A rhythm lane shows the upcoming inputs
scrolling toward a hit line with their tolerance windows, the control you should touch next gets a
ring, and every input is graded in milliseconds.

Every screen is a night-shift console: phosphor amber on warm black, and anything you are timed on
— clock, offsets, stun bars, the lane — set in mono with tabular figures, so a digit never shifts
under your eye. Each control keeps one colour everywhere it appears: the chip on the lesson brief,
the glyph on the rhythm lane and the button under your thumb all agree. `How it works` is the whole
strategy on one board — the ten-input pass, why the 6.66 s stun never lapses, the three rooms, and
what has to be handled by hand.

The two faces, **Chakra Petch** and **IBM Plex Mono**, ship with the repo as latin-subset woff2 in
`assets/fonts/` (both SIL OFL), so the trainer looks right on a phone with no internet.

**Timing is never slowed down.** The whole skill is absolute timing, so practising at 0.8× would
build the wrong reflexes. Lessons get easier by removing controls and threats, never by distorting
the clock — only the grading tolerance is loosened early on, and only as far as the routine allows.

Each step is graded against its own **measured, lopsided** window rather than one symmetric number.
The mask has 450 ms of room early and about 50 ms late, because on Android the mask blocks the
flashlight (g75/g84) and a mask still on when the hall flash is due swallows the flash that resets
Foxy — the hall flash is the mirror image, 50 ms early and 267 ms late. The rhythm lane draws those
windows at their real shape, so the asymmetry is visible before you are graded on it. A lesson's own
tolerance is a ceiling on that, never a licence: no drill calls an input safe that the simulator
says ends the night. The numbers come from `cyclesearch --steps`; see
[plan 04](plans/04-optimize-minus-7.md).

### Calibration

Button placement is the point of a touch trainer, so every control — all 12 cameras, both lights,
mask, monitor, vents and wind — can be dragged to move and resized by its corner handle.

`Settings → Calibrate layout` opens an inert session with the simulation stopped and game input
disabled, so dragging a control never doubles as pressing it. Overlapping controls are flagged red,
because overlapping touch targets silently swallow inputs.

`Settings → Save this layout as the code default` posts the layout to the dev server, which writes
it into `src/config.js` and rebuilds. Anywhere else, it hands you the JSON.

The shipped camera map is traced from a screenshot of the real in-game map and sized to that
image's aspect ratio, so the thumb path between 11 / 10 / 04 / 07 matches the game.

### Sound

Cues are synthesised — no audio files ship with this repo. Each control has its own pitch, so a
correct cycle has a recognisable tune and a wrong one is audibly wrong. There is an optional
metronome on the `:X2` / `:X7` anchors and haptic feedback on every input.

If you own FNaF 2 you can load sounds from your own copy into `Settings → Your own sounds`. They are
stored in IndexedDB on your device, are never uploaded, and are not part of the page. **No game
assets are distributed here.**

### Running it

The published copy is at **<https://ppvaz.github.io/fnaf2-1020/>** — served straight from
`master`, because the source runs as ES modules with nothing to build. Being https it is a secure
context, so wake lock and vibration work there; the LAN URL below is plain http and they do not.

No dependencies, no build step for development:

```sh
python3 tools/serve.py 8731      # serves the repo, and accepts saved layouts
```

Then open `http://<your-ip>:8731/index.html` on your phone, on the same network. The source runs
directly as ES modules — there is nothing to build for development.

For a single self-contained file (one HTML with every module, the CSS and the fonts inlined,
nothing external):

```sh
python3 tools/build.py           # -> dist/index.html
```

`dist/` is not committed. The bundler derives module order from the imports, so adding a file needs
no list to be updated.

Note that a plain-`http` LAN URL is not a secure context, so wake lock and vibration are disabled.

A run insists on full screen: browser chrome appearing or disappearing resizes the viewport, and
every control is placed as a percentage of it, so the buttons you calibrated would move under your
thumbs mid-run. If the request is refused or you leave full screen, a bar says so and the next touch
on the stage asks again.

## The model and its evidence

The canonical mechanics source is the owned modern-Android event-sheet extraction.
[Reading the source dump](docs/android/SOURCE-DUMP-GUIDE.md) explains what that extraction is,
how it is organised, the XOR-28 handle scramble that makes it readable, and the
`tools/dump/` commands used to source a rule from it — read it before citing a
group number. Community PC reverse engineering is retained as attributed supporting research, not
silently merged into Android rules. Constants are marked `[SOURCED]`, `[CALIBRATED]`,
or `[INFERRED]` in `src/config.js`; the live implementation gaps are tracked in
[Android source status](docs/android/ANDROID-SOURCE-STATUS.md). The
[office endgame audit](docs/android/ANDROID-OFFICE-ENDGAME.md) pins the exported camera/mask
states and the 45-frame defense / 300-frame resolution chain. The
[PC confirmation ledger](docs/android/PC-DECOMP-CHECKLIST.md) is deferred and non-blocking.
Post-chokepoint routing remains an approximation: it only runs once you have already
broken the stun loop.

The forensic comparison with Shooter25's embedded PC practice bot—and why
Minus 7 stays time-driven while reactive policies need vision or direct game
state—is in [Shooter25 practice mod](docs/in-engine/SHOOTER25-PRACTICE-MOD.md). Its extracted
controller registers, actuator mapping, and state transitions are in the
[Shooter25 bot state machine](docs/in-engine/SHOOTER25-BOT-STATE-MACHINE.md). The staged
Android instrumentation proposal is in those notes and
[Trainer-in-game](docs/in-engine/TRAINER-IN-GAME.md).

## Strategy research

The simulator exists to answer questions the game cannot be asked directly. Three
searches run against the sourced model over a shared worker pool: `cyclesearch`
hill-climbs timing variants around the shipped cycle (and produces the per-step
windows the trainer grades against), `strategysearch` enumerates fixed
camera-cover strategies over the sourced route graph, and `gatesearch` searches
short policies that react to visible state.

What they have established is mostly **negative**, and that is kept on purpose:

- **Six-Seven** (CAM 06/07) was derived by the search and then refuted by the
  extracted route graph — Withered Freddy transits rooms those cameras never see.
  [`CAM-6-7-STRATEGY.md`](docs/strategy/CAM-6-7-STRATEGY.md)
- **Minus Two and Minus Toys have different Android verdicts.** The glitchless
  Minus Two probe scores 16/200, losing structurally to the sourced
  *consecutive*-mask semantics. The Android double-camera state is real,
  implemented in the engine, and deliberately armed on the target phone:
  `viewing` and the `your view` marker can disagree after a stale-sample monitor
  raise, allowing the glitched CAM 09 light to target the Toys. The deterministic
  Minus Toys model clears 200/200 normal and 100/100 pinned-worst seeds; its
  no-split control clears 0/200. A graded open-loop Night 2 device attempt then
  failed through the BB→Foxy chain. A later Night 1 calibration showed zero
  desync and no measurable drift, so the failure's clock explanation remains
  qualified pending a monitor-stressing run — not overturned. The 16/200 Minus
  Two result is not a Minus Toys verdict.
  [`MINUS-3-STRATEGY.md`](docs/strategy/MINUS-3-STRATEGY.md)
- **Every gate-aware policy family searched scores 0/150** once the 45-frame
  defense fuse and 300-frame resolution chain are modeled — including two
  apparent 150/150 results that were retracted as model errors.
  [`GATE-SEARCH.md`](docs/strategy/GATE-SEARCH.md)
- Searching the sourced graph **independently re-derived Minus 7** as the only
  robust minimal three-camera cover.

The full lineage, from 2014 reaction play to two independent zero-RNG proofs, is
in [`STRATEGY-HISTORY.md`](docs/strategy/STRATEGY-HISTORY.md).

## On-device validation

An event sheet says what the code intends; only the phone says what it does.
[`ON-DEVICE-VALIDATION.md`](docs/device/ON-DEVICE-VALIDATION.md) covers the adb
harness — guarded, recorded, aborting on lost focus or wrong night state — and the
video tools that grade a recorded trial for camera sweeps, mask intervals and
music-box level.

The unusual piece is
[`screencheck`](docs/device/ON-DEVICE-SCREEN-CHECKS.md): a freestanding, static,
libc-free AArch64 binary that runs nearest-template classification *on the phone*,
so only a verdict crosses adb rather than a frame. Models are gated on
leave-one-out separation and replayed through the real native classifier before
anything is allowed to act on them.

### Nobody else has actuated a phone

This is the part of the project with no prior art, and it is worth saying
plainly because it sets what "hard" means here.

The [public bot census](docs/research/FNAF-BOT-CENSUS.md) (2026-08-26) mapped
every discoverable FNaF gameplay bot. **Every external stock-game bot in it
drives a Windows desktop** — Win32 `GetPixel`/`SetCursorPos`/`SendInput`, or
PyAutoGUI/BetterCam/MSS. Touch input was inside the census's stated scope and
returned no entry; no project uses a phone, an emulator, `scrcpy`,
`uiautomator`, or Appium. The strongest open 10/20 bot,
[`jasonclone/fnaf2bot`](https://github.com/jasonclone/fnaf2bot), reports about
one run in three on PC. It is a negative result over what is publicly
discoverable, not a proof that no private attempt exists.

On a desktop, `SendInput` is synchronous, sub-millisecond and never dropped, and
a pixel read is immediate. None of that survives the trip to a phone. Measured
on the target handset, in a 5000 ms cycle with roughly **680 ms free**:

| Constraint | Measured | PC equivalent |
|---|---|---|
| Bare contact must be held | **≥ 100 ms** — Fusion polls touch once per frame and drops anything shorter | none |
| Camera select spacing | **120 ms** proven; the idealised 267 ms three-camera sweep the published figure assumes has never been produced | none |
| Monitor press after a mask press | lost **9/15** below 180 ms, **0/17** at or above — the monitor bar is not drawn while the mask is up | none |
| One `screencap` | **225 ms** of the cycle's 680 ms of slack | immediate |
| Macro anchor lateness | **49–93 ms** late, wall-timed | none |

So the actuator's error budget is a first-class part of the problem rather than
a rounding error, which is why this repository has an actuator model
(`tools/device/actuator.mjs`), a model gate that refuses plans no hand could
execute (`tools/device/human-gate.mjs`), and a desync census of presses the game
accepted versus presses it dropped. A policy that clears in the simulator and
cannot survive the phone's actuator is a policy this project does not have.

Prior art helps with the *policy* — Shooter25's state machine and Couraeel's
controller decomposition are good — and with nothing at all below it. See
[`FNAF-BOT-IMPLEMENTATION-COMPARISON.md`](docs/research/FNAF-BOT-IMPLEMENTATION-COMPARISON.md).

## Tests

All headless, all dependency-free — the browser ones drive Chrome over the DevTools Protocol
(Node 22's built-in WebSocket), no Puppeteer.

Before adding a new script, check the canonical [tool index](tools/TOOLS.md).
It covers every maintained developer, simulator, browser, device, and
source-dump tool, including which commands assert and which only report.

```sh
node tools/test.ts              # the whole suite
node tools/test.ts --engine     # fast headless checks for each edit
node tools/test.ts --engine --extended # include exhaustive model sweeps
node tools/test.ts --browser    # Chrome checks only — about four minutes
node tools/test.ts --reports    # also print the diagnostic tools
```

The fast engine checks are the ones to run on every edit. The default full suite
and CI additionally run the extended model sweeps, which replay campaign-wide
seed sets and timing margins. The browser checks are slow
for a reason that will not go away: the trainer never slows the clock, so driving
a lesson to a pass costs that lesson's real duration. Engine checks run concurrently,
so that group costs its slowest member rather than the sum. Browser checks run
serially by default so CPU contention cannot corrupt timing grades; `--parallel`
opts into a faster but less isolated run.

Chrome is found at the macOS bundle path or on `PATH`; `$CHROME` overrides. The
runner builds `dist/` and starts `tools/serve.py` itself unless one is already
answering on 8731.

Two common focused runs are:

```sh
node tools/simtest.mjs --sweep   # a perfect cycle vs. 200 seeds
node tools/bbtest.mjs 200        # ...including Balloon Boy; --worst for worst-luck
                                 # --assert to fail rather than just print
node tools/bbtest.mjs 60 --jitter=200   # how much lateness is survivable
```

The [tool index](tools/TOOLS.md) is the complete command catalog, including the
search, browser, Android-device, visual-classification, and source-dump tools.
The three strategy-search tools share `tools/pool.mjs`; `--serial` pins them to
one worker, which must produce identical output.

What they establish:

- A correctly played cycle clears **200/200 seeds**, and **100/100 on worst luck**, with zero stun
  lapses — matching the community's claim that Minus 7 has no unwinnable RNG.
- Lateness has a real cost, but the headline number depends on the error model. `bbtest --jitter`
  moves every input row independently, which also randomises how long each flash is held, and under
  it the cycle is 45% at 100-120 ms and 0% from 150 ms. Hold each press and its release together
  (`cyclesearch --curve --profile=flat`) and the same cycle survives **100% at 200 ms**. The
  older "~35% at 200 ms" is from a superseded engine; see
  [plan 04](plans/04-optimize-minus-7.md) for the cross-validated table.
- Lateness is not one budget. The per-step windows (`cyclesearch --steps`) range from
  267 ms wide on `monitor-up` to over 1.2 s on `wind`, and they are lopsided: the hall
  flash cannot go **50 ms early** and the mask cannot come off **50 ms late**.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). One rule outranks the rest: **no game
assets and no decompiled content, ever** — this repository publishes derived
knowledge only.

Findings that belong to somebody else's project are tracked for upstreaming in
[UPSTREAM-LEDGER.md](UPSTREAM-LEDGER.md), including the Clickteam handle-scramble
discovery, the CTFAK patches, and the PAIRIP anti-tamper finding.

## Licence

MIT, for this code. The bundled fonts are under the SIL Open Font License 1.1 — see
`assets/fonts/`. *Five Nights at Freddy's 2* is © Scott Cawthon; no game assets are included.
