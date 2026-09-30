# Documentation index

Research notes for [fnaf2-1020](../README.md). The repository's claims live here;
the code only implements them.

Two conventions run through everything below. **Evidence labels** — `[SOURCED]`,
`[CALIBRATED]`, `[INFERRED]`, `[MODEL]` — say where a number came from, and a
rule enters the simulator only when it earns one. **Retractions stay put**: when
a result is refuted, the document keeps its original reasoning and gains a
correction at the top, because the wrong turn is usually the useful part.

The [project charter](../PROJECT-CHARTER.md) defines how the trainer, model,
controller research, and device evidence form one program.

## Start here

| If you want to… | Read |
|---|---|
| See what the phone has actually cleared | [`../README.md`](../README.md) — the device record, newest first |
| Learn the vocabulary this project uses | [`GLOSSARY.md`](GLOSSARY.md) |
| Learn the strategy the trainer teaches | [`strategy/MINUS-7-STRATEGY.md`](strategy/MINUS-7-STRATEGY.md) |
| See how 10/20 was solved, historically | [`strategy/STRATEGY-HISTORY.md`](strategy/STRATEGY-HISTORY.md) |
| Judge whether the simulator can be trusted | [`android/ANDROID-SOURCE-STATUS.md`](android/ANDROID-SOURCE-STATUS.md) |
| Read the game's event sheet yourself | [`android/SOURCE-DUMP-GUIDE.md`](android/SOURCE-DUMP-GUIDE.md) |
| Decompile a Clickteam Android game | [`android/SOURCE-DUMP-GUIDE.md` §4](android/SOURCE-DUMP-GUIDE.md) — the handle scramble |
| Run something against a real phone | [`device/ON-DEVICE-VALIDATION.md`](device/ON-DEVICE-VALIDATION.md) |
| Recover stock-APK RNG seed candidates without modifying the APK | [`device/RNG-SEED-RECOVERY.md`](device/RNG-SEED-RECOVERY.md) |
| Understand the project's scope and claim discipline | [`../PROJECT-CHARTER.md`](../PROJECT-CHARTER.md) |
| See what completely solving the game would mean, and where we stand on that ladder | [`research/SOLVING-FNAF2.md`](research/SOLVING-FNAF2.md) |
| Prioritize the research frontier and the Observatory's first encounter experiment | [`research/FNAF2-OBSERVATORY.md`](research/FNAF2-OBSERVATORY.md) |
| Read what the project has learned | [`chronicle/README.md`](chronicle/README.md) |
| Read how far the project got, in twelve generated chapters | [`portal/story.html`](portal/story.html) |
| Understand why facts stay hidden here, and where to look next | [`operations/WHY-FACTS-HIDE.md`](operations/WHY-FACTS-HIDE.md) |
| Find the right command | [`../tools/README.md`](../tools/README.md) (one index per tool directory) |
| Pick up unfinished work | [`../plans/`](../plans/) |
| Understand current package ownership | [`architecture/README.md`](architecture/README.md) |
| Review dependency direction | [`architecture/DEPENDENCY-GRAPH.md`](architecture/DEPENDENCY-GRAPH.md) |
| Review migration shims and removal gates | [`architecture/COMPATIBILITY.md`](architecture/COMPATIBILITY.md) |
| Find where the same thing is implemented twice | [`architecture/DUPLICATE-IMPLEMENTATION-MAP.md`](architecture/DUPLICATE-IMPLEMENTATION-MAP.md) |
| Review the generated contract and command catalogs | [`architecture/generated/README.md`](architecture/generated/README.md) |
| Read the workspace/core decision | [`decisions/0001-workspaces-and-core.md`](decisions/0001-workspaces-and-core.md) |
| Read the kernel, contexts and vocabulary decision, and Pedro's 2026-09-29 answers | [`decisions/0002-kernel-contexts-vocabulary.md`](decisions/0002-kernel-contexts-vocabulary.md) |
| Inspect evidence retention and claim ceilings | [`evidence/README.md`](evidence/README.md) |
| Re-derive every promotion edge and S1's open items from the committed packs | `npm run review -- query promotions` ([`../packages/review/README.md`](../packages/review/README.md)); the kernel types it reads in are in [`../packages/kernel/README.md`](../packages/kernel/README.md) |
| Run device work safely | [`operations/DEVICE-SAFETY.md`](operations/DEVICE-SAFETY.md) |
| Start and end a session: where things stand, what to take next, whether the hook will accept a commit, the session's ratio, the morning report, and what is broken on this host | `npm run lab -- status` ([`operations/LAB.md`](operations/LAB.md)) |
| See what each grade-run.sh video step feeds, which a frame trace can replace, and how the recording is decoded once | [`operations/GRADE-PIPELINE-STEPS.md`](operations/GRADE-PIPELINE-STEPS.md) |
| Understand research operations | [`research/ARCHITECTURE.md`](research/ARCHITECTURE.md) |

## Campaign milestones

The device record, newest first. Each row is a terminal the phone actually
reached; the claim each one supports is stated in its own record, and none of
them is a Plan 12 promotion.

| Date | Milestone | Record |
|---|---|---|
| 2026-09-17 | The Night 6 model gap was **two wall clocks**, not a Foxy rule: host and phone stamps stood 1374.8 ms apart. Corrected, the route reaches 6 AM on all 65,536 seeds | [`night6-model-gap-two-clocks`](evidence/night6-model-gap-two-clocks-20260917.json) |
| 2026-09-17 | All ten Custom Night presets clear 3000/3000 in four lanes, and the 50 ms animation floor that finding exposed. `MODEL_ONLY`; no phone was run | [`night7-preset-sweep`](evidence/night7-preset-sweep-20260917.json) |
| 2026-09-16 | Night 6 seed-lock census: the clock bracket is sound, and the model decorrelates before the bits arrive | [`night6-h-seedlock-census`](evidence/night6-h-seedlock-census-20260916.json) |
| 2026-09-14 | Night 7 reliability, predeclared ten-run cohort: **3 wins, 7 deaths**, one excluded before any gameplay input | [`night7-cohort-k2-result`](evidence/night7-cohort-k2-result-20260914.json) |
| 2026-09-14 | Night 7 at the 4/20 vector: the Minus 3 loop reduced to maskless and ventless | [`night7-420-first-6am-minimal3`](evidence/night7-420-first-6am-minimal3-20260914.json) |
| 2026-09-14 | **The first 10/20 6 AM on the device** — `golden-freddy`, all ten dials 20, binding k2 anchored at aim 2433 on the 5000 ms grid, 42 of 42 cycle gates agreed | [`night7-first-6am-k2`](evidence/night7-first-6am-k2-20260914.json) |
| 2026-09-13 | **The first Night 6 6 AM on the device** — binding h, anchored on the five-second Foxy roll grid, flash 100 ms ahead of the roll; Custom Night unlocked | [`night6-first-6am-anchoredh`](evidence/night6-first-6am-anchoredh-20260913.md) |
| 2026-09-12 | **The first Night 5 6 AM on the phone** — the run, its proof, and what it is and is not evidence for | [`night5-first-6am`](evidence/night5-first-6am-20260912.md) |
| 2026-09-08 | Story Nights 3 and 4 cleared open loop | [`victory-night3`](evidence/victory-night3-20260908.json), [`victory-night4`](evidence/victory-night4-20260908.json) |
| 2026-09-07 | Story Nights 1 and 2, the second graded from retained evidence after the proof gate was corrected | [`victory-night1`](evidence/victory-night1-20260907.json), [`victory-night2`](evidence/victory-night2-20260907.json) |

## Campaign records, in detail

Curated, newest first — the bindings, refutations, retractions and forensics
behind the milestones above. **This list is not the complete record.** Ninety-nine
evidence records live in [`evidence/`](evidence/); use `npm run evidence -- list`
for all of them and [`evidence/README.md`](evidence/README.md) for the policy
that governs them.

| What it shows | Record |
|---|---|
| See all 47 `PROMOTED_BY` edges re-derived byte for byte from the committed packs, attestations and winners, each with its attester and custody class, and S1's open items derived: two MODEL_ONLY winners no pack names, `UNTRACKED_WINNER_DEBT` 1 of 1 | [`evidence/review-promotions-20260929.json`](evidence/review-promotions-20260929.json) |
| See why Withered Freddy never reaches the office on Night 7 routes: the dump's return edge, branch and per-second random draw the model lacks | [`evidence/withered-freddy-route-night7-20260915.json`](evidence/withered-freddy-route-night7-20260915.json) |
| See Foxy's dump A/B chain, why the literal chain still does not reproduce the phone's k2 Foxy deaths (they come in encounter-free cycles), and how Foxy's skipped draws scramble seed-specific encounter predictions | [`evidence/foxy-chain-night7-20260915.json`](evidence/foxy-chain-night7-20260915.json) |
| See the rules fixed before the k3 twin nights (two Start taps at one phone wall-clock residue, one control) that test clock seeding | [`evidence/night7-k3-twin-nights-predeclaration-20260915.json`](evidence/night7-k3-twin-nights-predeclaration-20260915.json) |
| See the k3 twin nights measured: Start taps and night onsets on the phone clock, the office load timeline, eyehole identities per cycle, and the verdict under the predeclared rules | [`evidence/night7-k3-twin-nights-result-20260915.json`](evidence/night7-k3-twin-nights-result-20260915.json) |
| See every random draw the game's office screen makes (113 groups, ~84 per second unconditional) against the model's 22, and why seed-specific predictions cannot line up yet | [`evidence/rng-draw-audit-office-20260915.json`](evidence/rng-draw-audit-office-20260915.json) |
| See two full k3 nights with the game's log streamed live: the office frame's 16-seed window 73.5-88.5 ms before the night onset, both wins, and why the window is not scored yet | [`evidence/night7-k3-seedlog-nights-20260915.json`](evidence/night7-k3-seedlog-nights-20260915.json) |
| See the first k3 Night 7 carrying the native frame trace: full-03 aborted before the night when the trace start overlapped the clock-stamp probe, and full-04 kept a 6556-frame trace and a 13-seed window, then died at about 105 s | [`evidence/night7-k3-frametrace-nights-20260915.json`](evidence/night7-k3-frametrace-nights-20260915.json) |
| See whether the game seeds its RNG from the phone clock: 65,536 nights, the clock link measured, and why blackout-loop onsets could not identify a seed | [`evidence/seed-clock-forensics-night6-20260914.json`](evidence/seed-clock-forensics-night6-20260914.json) |
| See where the anchored Night 6 release aims: Foxy's five-second roll grid, the winning band 2.9-4.95 s, and the 50 ms split-arming holes | [`evidence/night6-anchor-aim-20260913.json`](evidence/night6-anchor-aim-20260913.json) |
| See the anchored Night 6 binding refuted twice by Golden Freddy, the g778 read the model lacked, and the corrected model's verdict | [`evidence/night6-anchored-golden-freddy-20260913.md`](evidence/night6-anchored-golden-freddy-20260913.md) |
| See where the corrected Night 6 release aims: mask off at 8960, band 5033-5417 on the Foxy roll grid, aim 0 with k=1 | [`evidence/night6-anchor-aim-b-20260913.json`](evidence/night6-anchor-aim-b-20260913.json) |
| See three anchored Night 6 runs inside the band: the measured input latency and onset bias, and the mask window that does not hold Balloon Boy | [`evidence/night6-anchored-band-runs-20260913.md`](evidence/night6-anchored-band-runs-20260913.md) |
| See the first graded run with its Bluetooth audio: binding e dead to Foxy at the flash inside the model band, the vent bang at NC 0.79, the WinD ticks recovered by folding, and the -0.35 % audio clock drift | [`evidence/night6-anchorede2-audio-20260913.md`](evidence/night6-anchorede2-audio-20260913.md) |
| See binding f: the longer camdrop light changed nothing, FLAT post-mask flashes precede both Night 6 deaths after 2 AM | [`evidence/night6-anchoredf3-20260913.md`](evidence/night6-anchoredf3-20260913.md) |
| See binding g: five cycles further, the same death; the post-mask flash lands 50-80 ms before the roll it must beat | [`evidence/night6-anchoredg1-20260913.md`](evidence/night6-anchoredg1-20260913.md) |
| **See the first Night 6 6 AM on the device**: binding h, anchored on the five-second Foxy roll grid, flash 100 ms ahead of the roll; Custom Night unlocked | [`evidence/night6-first-6am-anchoredh-20260913.md`](evidence/night6-first-6am-anchoredh-20260913.md) |
| See the first full Night 7 (10/20) attempt: Golden Freddy preset, latch-authorized anchor, Balloon Boy through the mask window at 2 AM | [`evidence/night7-anchoredi6-20260913.md`](evidence/night7-anchoredi6-20260913.md) |
| See why every frozen Night 7 trace ended in the intro: the dial screen read as a game over and the runner pulled the trace 6-8 s before the night | [`evidence/night7-trace-pulled-on-dial-screen-20260913.md`](evidence/night7-trace-pulled-on-dial-screen-20260913.md) |
| See the fourth Night 5 6 AM: the hallfix knobs with no post-mask hall flash at all (the camdrop reset alone), with its camdrop encounter census | [`evidence/night5-fourth-6am-noflash-20260913.json`](evidence/night5-fourth-6am-noflash-20260913.json) |
| See why Night 5 still loses with clean contacts, and what to try next | [`evidence/night5-contacts-clean-still-losing-20260912.md`](evidence/night5-contacts-clean-still-losing-20260912.md) |
| See the Night 5 mask window's measured position tolerance, and why the gate killed its own cycle | [`evidence/night5-mask-window-tolerance-20260912.md`](evidence/night5-mask-window-tolerance-20260912.md) |
| See why longer loop cycles were refuted, and what route changes are now closed | [`evidence/night5-longer-cycle-refuted-20260912.md`](evidence/night5-longer-cycle-refuted-20260912.md) |
| See the hall flash graded per cycle from the trace and the video, the mask-off lockout it runs into, where `hallOffsetMs` can move in the model, and the two clean-contact deaths | [`evidence/night5-hall-lockout-and-offset-sweep-20260912.json`](evidence/night5-hall-lockout-and-offset-sweep-20260912.json) |
| See where the anchored Night 5 release aims and the model bands that priced it | [`evidence/night5-anchor-aim-20260912.json`](evidence/night5-anchor-aim-20260912.json) |
| See the first Night 5 6 AM on the phone: the run, its proof, and what it is and is not evidence for | [`evidence/night5-first-6am-20260912.md`](evidence/night5-first-6am-20260912.md) |
| See what the first Night 5 6 AM cost: the nights, the killers, the wrong turns and what each one cost | [`evidence/night5-first-6am-cost-20260912.md`](evidence/night5-first-6am-cost-20260912.md) |
| See the second Night 5 6 AM, the mask window that made it, and the first measured actuation latency | [`evidence/night5-second-6am-mask5plus-20260912.md`](evidence/night5-second-6am-mask5plus-20260912.md) |
| See the first death-prediction run: Night 6, Foxy named and three times too early, and the swallowed hall flash that explains it | [`evidence/night6-foxy-prediction-20260912.md`](evidence/night6-foxy-prediction-20260912.md) |
| See the encounter corpus: which Withered the mask met, per cycle, labelled by the operator from the eyehole view | [`evidence/encounter-corpus-20260912.json`](evidence/encounter-corpus-20260912.json) |
| See the measured Night 5 delivered phase, and a hall measurement retracted twice | [`evidence/night5-phase-measured-and-hall-open-20260912.md`](evidence/night5-phase-measured-and-hall-open-20260912.md) |
| Read why the Withered Bonnie visual cause model was withdrawn, and what metric replaced euclid | [`evidence/withered-bonnie-visual-model-withdrawn-20260912.md`](evidence/withered-bonnie-visual-model-withdrawn-20260912.md) |

## Android source and fidelity

The canonical target is `com.scottgames.fnaf2` v2.0.7 — modern Android release-7,
Fusion build 296, August 2025.

- [`ANDROID-SOURCE-STATUS.md`](android/ANDROID-SOURCE-STATUS.md) — the accuracy
  ledger, and the project's most load-bearing document. Enforced by
  `tools/sourcetest.mjs` so a corrupted mechanism cannot hide behind unchanged
  survival statistics.
- [`UNIFIED-SOURCED-ENGINE-FACT-INDEX.md`](android/UNIFIED-SOURCED-ENGINE-FACT-INDEX.md)
  — every `[SOURCED]` engine fact in one place: a master constant table, then a
  section per subsystem, each with its group citations and the document that
  owns it. A digest and router, not a new authority — the ledger and the other
  pages still win on any disagreement.
- [`SOURCE-DUMP-GUIDE.md`](android/SOURCE-DUMP-GUIDE.md) — chain of custody from
  APK to readable event sheet, the file format, and **the XOR-28 handle
  scramble**. Read §4 before citing any group number; every dump produced before
  2026-08-20 had Toy↔Withered pairs silently swapped.
- [`ANDROID-CAMERA-STALL.md`](android/ANDROID-CAMERA-STALL.md) — the 400-frame
  (6.67 s) camera-flash stun that Minus 7 stands on, and the audit that first got
  it wrong.
- [`ANDROID-OFFICE-ENDGAME.md`](android/ANDROID-OFFICE-ENDGAME.md) — the 45-frame
  defense fuse and 300-frame resolution chain.
- [`ANDROID-GROUP-MAP.md`](android/ANDROID-GROUP-MAP.md) — coverage of all 1332
  office-frame groups, so blind spots stay a list rather than a feeling.
- [`PC-DECOMP-CHECKLIST.md`](android/PC-DECOMP-CHECKLIST.md) — the PC 1.033
  cross-platform boundary. Deferred, non-blocking.

## Strategy

- [`STRATEGY-HISTORY.md`](strategy/STRATEGY-HISTORY.md) — the whole 10/20 lineage,
  from reaction play to two independent zero-RNG proofs.
- [`MINUS-7-STRATEGY.md`](strategy/MINUS-7-STRATEGY.md) — exact input sequence for
  the strategy the trainer drills.
- [`MINUS-3-STRATEGY.md`](strategy/MINUS-3-STRATEGY.md) — the cam-stall family.
  The Android split-camera mechanism transfers; the tested open-loop device
  policy does not yet transfer reliably. §7–9 keep those verdicts separate.
- [`VENT-CAMP-STRATEGY.md`](strategy/VENT-CAMP-STRATEGY.md) — the right-vent-camp
  lineage up to brayden's timer strategy.
- [`CAM-6-7-STRATEGY.md`](strategy/CAM-6-7-STRATEGY.md) — a strategy this project
  derived and then **refuted**, kept as the derivation record.
- [`GATE-SEARCH.md`](strategy/GATE-SEARCH.md) — gate-aware policy search. Closed
  at 0/150, including two retracted false positives.

## On-device

- [`android/companion/README.md`](../android/companion/README.md) — the unified
  MediaProjection APK, its build/run procedure, and first target-device soak.
- [`CUE-HELPER-MCP.md`](device/CUE-HELPER-MCP.md) — the bounded MCP/queue
  interface for safe helper setup and read-only device readiness checks.
- [`OVERLAY-QUALIFICATION.md`](device/OVERLAY-QUALIFICATION.md) — the retained
  evidence protocol and structural validator for the non-interactive HUD's
  touch, target-suppression, self-capture, latency, resource, and lifecycle
  gates.
- [`HID-MULTITOUCH.md`](device/HID-MULTITOUCH.md) — the two traps in stock
  Android multitouch, the phone's measured input budget, and the Night 6 route
  priced against the actuator it actually has. **Read this before claiming
  anything about a device run's configuration or its failure**; CLAUDE.md's
  read-before-concluding table points here, and it was missing from this index
  until 2026-08-26 despite being the most-cited device page in the repository.
- [`ACCESSIBILITY-VS-HID-BENCHMARK.md`](device/ACCESSIBILITY-VS-HID-BENCHMARK.md)
  — online evidence check and the qualification matrix for a hostless
  AccessibilityService actuator versus the existing on-device UHID path.
- [`ON-DEVICE-VALIDATION.md`](device/ON-DEVICE-VALIDATION.md) — the adb harness,
  its hard-won safety rules, and findings against the real build.
- [`ON-DEVICE-SCREEN-CHECKS.md`](device/ON-DEVICE-SCREEN-CHECKS.md) — the
  libc-free on-phone classifier, its model-building discipline, and measured
  latency.
- [`OBSERVATION-CORPUS-INVENTORY.md`](device/OBSERVATION-CORPUS-INVENTORY.md) —
  every current visual, audio, video, HID, trace, model, clock, producer, and
  consumer; the provenance gaps the shared session schema must close.
- [`ONE-PIXEL-VISION.md`](device/ONE-PIXEL-VISION.md) — an educational case
  study in reducing a visual bot sensor from a full screenshot to one tested
  logical pixel, with Android capture and audio analogues.
- [`ANDROID-AUDIO-CAPTURE.md`](device/ANDROID-AUDIO-CAPTURE.md) — the mobile
  recording bug that exposes normally inaudible Mangle/music-box loops, its
  evidence boundary, and the implications for an audio-cue detector.
- [`AUDIO-WITNESS-MAP.md`](device/AUDIO-WITNESS-MAP.md) — every night-frame
  sample handle, what it would tell the pilot, and the instruments to build;
  the five-second grid phase first.
- [`REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md`](device/REAL-TIME-CLOSED-LOOP-ARCHITECTURE.md)
  — the event-driven, three-loop controller boundary. Hardware roles are
  profile-selected capabilities: an ESP32 may bridge, process, host a reflex,
  participate in actuation, or be absent.
- [`RUN-TELEMETRY.md`](device/RUN-TELEMETRY.md) — what a night run should
  record, ten diagnostic signals ranked by value per millisecond of a cycle
  that has only ~680 ms free.
- [`RNG-SEED-RECOVERY.md`](device/RNG-SEED-RECOVERY.md) — sourced RNG facts,
  device-time candidate windows, observation filters, and the boundary between
  useful shadow evidence and live control authority.
- [`../plans/19-video-reactive-controller.md`](../plans/19-video-reactive-controller.md)
  and [`../plans/20-belief-state-cycle-controller.md`](../plans/20-belief-state-cycle-controller.md)
  — the current stock-device sensing/controller build and its uncertainty-aware
  planning layer.

## In-engine and prior art

- [`research/FNAF-BOT-CENSUS.md`](research/FNAF-BOT-CENSUS.md) — franchise-wide
  census of public stock-game bots, modified/in-engine controllers, simulations,
  RL agents, TAS, chat control, and verified false positives.
- [`research/FNAF-BOT-IMPLEMENTATION-COMPARISON.md`](research/FNAF-BOT-IMPLEMENTATION-COMPARISON.md)
  — source-level comparison with every substantive scope in this repository,
  including its simulator, trainer, Android sensing/actuation, and evidence gaps.
- [`research/FOUR-GAME-NIGHTS.md`](research/FOUR-GAME-NIGHTS.md)
  — all four games' nights read out of the dumps with one reader: the four
  clocks and why they are not one mechanism, the four difficulty tables, a draw
  census whose "timer-driven" column means two different things, and a FNaF 1
  seed census that clears every night and 4/20 at 3000/3000.
- [`research/FNAF-SENSOR-ABLATION-RUNS.md`](research/FNAF-SENSOR-ABLATION-RUNS.md)
  — public challenge runs read as ablation experiments: which observation
  channels and controls are actually load-bearing in FNaF 1 and 3, checked
  against our own event dumps rather than left at the public record.
- [`research/FNAF4-AUDIO-INDEPENDENCE.md`](research/FNAF4-AUDIO-INDEPENDENCE.md)
  — FNaF 4 opens by saying it relies on sound cues; this asks whether audio is
  actually required, and finds an anti-cheat that forces the state a schedule
  cannot hear.
- [`research/FNAF4-CONTROL-SURFACE.md`](research/FNAF4-CONTROL-SURFACE.md)
  — FNaF 4's controls read off the labels the game draws on itself on Night 1,
  the rule that destroys those labels at 3 AM, and the two configuration
  settings that decide whether any control map is valid.
- [`research/ANDROID-BOT-LANDSCAPE.md`](research/ANDROID-BOT-LANDSCAPE.md) and
  [`research/ANDROID-INPUT-AND-OBSERVATION.md`](research/ANDROID-INPUT-AND-OBSERVATION.md)
  — the two integral survey reports, retained in full. **No number in either is
  a measurement of this handset.** Their distilled conclusions live in
  [`device/HID-MULTITOUCH.md`](device/HID-MULTITOUCH.md); read these for the
  evidence and the method, or before re-asking a question they closed.
- [`TRAINER-IN-GAME.md`](in-engine/TRAINER-IN-GAME.md) — could the trainer live
  inside the game?
- [`IN-ENGINE-PILOT-RECOMPILE.md`](in-engine/IN-ENGINE-PILOT-RECOMPILE.md) — APK
  injection is blocked by PAIRIP; the CCN→Chowdren recompile path is the
  alternative.
- [`SHOOTER25-PRACTICE-MOD.md`](in-engine/SHOOTER25-PRACTICE-MOD.md) — forensic
  comparison with the closest existing precedent.
- [`SHOOTER25-BOT-STATE-MACHINE.md`](in-engine/SHOOTER25-BOT-STATE-MACHINE.md) —
  its controller reconstructed as a state machine.

## Project

- [`ARCHITECTURE-AUDIT.md`](ARCHITECTURE-AUDIT.md) — ranked cross-cutting
  structural findings, each with what it costs the mission and where it is
  resolved. Retractions and resolutions are recorded in place.
- [`architecture/LEGIBILITY-FOLLOWUPS.md`](architecture/LEGIBILITY-FOLLOWUPS.md)
  — open architecture findings for human and agent legibility, with evidence,
  owners, priorities, and acceptance checks.
- [`ARCHIVED-ROUTES.md`](ARCHIVED-ROUTES.md) — code that left the tree (the
  recompile toolchain, the ESP32 bridge, the invention engine, closed searches),
  the tag that holds it, and how to restore a path.
- [`../UPSTREAM-LEDGER.md`](../UPSTREAM-LEDGER.md) — give-back ledger: what this
  project owes upstream, and where each item stands.
