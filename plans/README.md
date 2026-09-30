# Plans

Future work across the evidence model, strategy research, human trainer, and
constrained controllers, one file per ask, written to be picked up cold in any
later session. The trainer remains the current public application, but it is one
consumer of the canonical model rather than the architectural root. See the
[`PROJECT-CHARTER.md`](../PROJECT-CHARTER.md) for the shared scope and claim
discipline. Listed below in plan order; each entry names its own
dependencies.

**The path — every thread to its last consequence, steps S1-S7, and the gates
loosened or archived for it (Pedro, 2026-09-25):** [`ROADMAP.md`](ROADMAP.md).
It supersedes the triage below wherever they disagree, and the plans' own
"gate" sections where its gate table names them.

**What each session did against those steps:** [`PROGRESS.md`](PROGRESS.md).

Triage of 2026-09-17 (kept for its reasoning; the path above is current):

- **The device campaign has cleared every night.** Nights 1–4 on 2026-09-07/08,
  Night 5 on 09-12, Night 6 on 09-13, and Night 7 — Custom Night `golden-freddy`,
  all ten dials 20 — on 09-14, all `DEVICE_MEASURED` under profile
  `hid-mediaprojection`. None of them has a Plan 12 promotion edge, and the only
  reliability cohort is Night 7's, at **3 wins in 10 predeclared runs**. This
  supersedes the 2026-09-02 triage that reported the profile as dry-run-only.
- **What won is not what the plans predicted.** The winning bindings are
  open-loop Minus Toys schedules whose *release* is anchored to the game's own
  5000 ms movement-roll grid, supervised by a belief gate. That is neither the
  blind macro Plan 10 deprecates nor the closed loop Plan 20 designs, and no
  plan owned it when it landed.
- **The bottleneck is now model fidelity, not execution.** Until 2026-09-17 the
  model killed every censused seed on nights the phone had won; the cause was a
  two-wall-clock instrument error, not a rule. The remaining free parameter is
  the frame period, and the next physical test is one binding re-run with
  `--frame-trace`. Nothing above mechanical fidelity — policy search, optimality,
  a viability kernel — can start before that closes.
- **Plan 02 is closed as a device question and open as a trainer one.** Minus
  Toys is the route that wins on hardware; what Plan 02 still asks for is the
  second *trainer mode*, which no device result delivers.
- **Most untouched work:** Plan 03, a real reactive-grading mode; its Android
  vent/mask/light sourcing is complete, but the reactive coach, decision table,
  lesson ladder, and grading remain unimplemented.
- **Plan 04's runnable experiment is complete:** per-step model windows and an
  explicitly inferred human-error profile now exist. The next useful input is
  measured trainer timing by step — practice runs through `/save-trace` and
  `tools/tracereport.mjs`, not another invented profile.
- **Plan 05 is reopened for invention.** Its original static-cover pass remains a
  sourced negative. Do not rerun Plan 06's closed 125-schedule family or
  Plan 16's Minus 7 timing grid and call it novelty. Note that its admission
  gate is described at 1200 seeds while the project's census standard is 3000;
  the gate, not the prose, is what lags.
- **Plan 17 is the focused in-APK campaign.** Straight re-signing remains blocked
  by measured PAIRIP behavior, but same-process hooks, loader/runtime approaches,
  CCN mutation/rebuild and Chowdren recompilation are active hypotheses. The target
  is a traceable personal research APK with internal observation and actuation.
- **Plans 22–24 are foundations, not claims.** Plan 22 owns the phase-1
  workspace, contracts, profiles, and composition boundaries; Plan 23 owns the
  read-only Cue Helper HUD qualification; Plan 24 owns replay-only exercises,
  activity gating, and adaptive training.
- **Plan 25 is the horizon list** written after the Night 7 clear, and is the
  only plan authored with that clear as its premise.

Ownership and dependencies (2026-09-17):

- **Plan 09 defines the shared evidence substrate.** Its schemas, validator, and
  producers are implemented, and real phone manifests now exist from the
  campaign runs.
- **Plan 10 closes the stock-device controller loop.** The legacy `trial.sh`
  route remains a comparison lane. Its package 0 boundary is qualified and
  flying; its act-then-verify loop is not.
- **Plan 11 makes simulator policy comparisons fair.** It can proceed beside
  Plan 09 after their observation record is agreed, and does not require RL.
- **Plan 12 owns promotion and claims.** Rungs 4, 5 and 7 have been reached on
  the phone and **none has been promoted**; recording those promotions, or
  declining to, is live work.
- **Plan 13 owns campaign and all-night support.** The full story ladder and
  Custom Night 7 are cleared with bound artifacts, Custom Night readback,
  lifecycle proof, and save/menu advancement. Reliability is what remains.
- **Plan 14 owns device portability.** A versioned `device-profile-v1`, adapter
  registry, profile-bound calibration IDs, semantic control maps, and mismatch
  preflight exist. Second-device validation remains open; every number above was
  measured on one handset.
- **Plan 15 owns sensor independence.** A game fact is taught once and each
  capture method reads it through a declared, calibrated adapter. Plan 19 owns
  the native-resolution visual watchlist; BB cross-sensor calibration remains
  open.

Plans that are done or resolved live in [`archive/`](archive/), unchanged and
still numbered here: 01, 06 and 16 since 2026-09-24. So does the part of the
progress log written before 2026-09-09.

1. [01-research-pass.md](archive/01-research-pass.md) — sourced docs for the 10/20 meta.
   Prerequisite for 02, 03 and the novelty check in 05.
2. [02-minus-3-mode.md](02-minus-3-mode.md) — Minus 3 as a second trainer mode.
3. [03-right-vent-camp-mode.md](03-right-vent-camp-mode.md) — right vent camp mode;
   needs a reactive coaching model, the biggest piece.
4. [04-optimize-minus-7.md](04-optimize-minus-7.md) — slack-maximise the existing
   script. No dependencies; runnable today.
5. [05-derive-new-strategy.md](05-derive-new-strategy.md) — first derivation pass
   produced **Six-Seven**, then the sourced route graph refuted it; reopened for a
   broader stateful/event-driven policy invention campaign that excludes the closed
   grids.
6. [06-hybrid-strategy-search.md](archive/06-hybrid-strategy-search.md) — first gate-aware
   pass complete: Minus Right, monitor denial and 125 clock-phased combinations all
   fail after the sourced per-unit Withered endgames are modeled. See
   [`GATE-SEARCH.md`](../docs/strategy/GATE-SEARCH.md).
7. [07-tooling-consolidation.md](07-tooling-consolidation.md) — queued tooling
   correctness fixes and consolidation opportunities found by the 2026-08-23
   all-tools audit; take the contract fixes first and refactor opportunistically.
8. [08-audio-cue-controller.md](08-audio-cue-controller.md) — audio-cue research:
   the target phone's internal capture cannot hear the critical fast-mixer cues
   without root; external A2DP is the validated slower path now composed by
   Plan 19 P6 and Plan 20.
9. [09-observation-corpus.md](09-observation-corpus.md) — versioned multimodal
   session, holdout, and replay contract for lifecycle, actuator-state, visual,
   and audio observations.
10. [10-stock-device-controller.md](10-stock-device-controller.md) — explicit
    observation/belief/policy/action/verification controller, extracted in
    shadow from the existing device route.
11. [11-policy-interface-and-baselines.md](11-policy-interface-and-baselines.md)
    — exact-engine policy adapter, measured fault injection, and independently
    reimplemented Jason/Shooter25/Couraeel-style baselines.
12. [12-end-to-end-evidence-campaign.md](12-end-to-end-evidence-campaign.md) —
    claim ladder and promotion gates from offline replay through a Night 6
    cohort and, only after separate qualification, 10/20.
13. [13-campaign-and-all-night-support.md](13-campaign-and-all-night-support.md)
    — save-safe lifecycle, per-night policy qualification, fresh-save story
    progression, and verified Custom Night configuration.
14. [14-device-portability-and-profiles.md](14-device-portability-and-profiles.md)
    — normalized canvas/controller coordinates behind a device profile, models
    and timing bound to the profile they were measured under, and a bounded
    new-device calibration session.
15. [15-sensor-independent-observations.md](15-sensor-independent-observations.md)
    — one definition per game fact, one calibrated adapter per capture method,
    and a refusal for every pairing that has not been calibrated.
16. [16-constrained-policy-search.md](archive/16-constrained-policy-search.md) —
    dominance-pruned beam search over the device plan's timing geometry
    (evaluated through `human-gate.mjs` at 1200 seeds), targeting the item 10/11
    Foxy-reset decoupling and the Night 7 opener, with machine-readable
    provenance so a winning candidate ships its `[SOURCED]`/`[ASSUMED]`
    dependency list. Structured vehicle for `PROGRESS.md` item 9.
17. [17-in-apk-bot.md](17-in-apk-bot.md) — laser-focused same-process bot campaign:
    test retail hooks, modified-package, loader/shim, CCN rebuild and faithful
    recompile routes until one APK can observe, decide and act internally with an
    auditable trace.
18. [18-modern-tooling.md](18-modern-tooling.md) — nine tooling additions, each
    tied to a documented failure: `shellcheck` + footgun fixtures, `tsc --checkJs`
    on the engine, a confidence-interval helper for the gates, a property-based
    harness, an on-device input-dispatch trace, a `scrcpy` capture path, a pinned
    Python toolchain, executable-doc number checks, and a devcontainer. No new
    runtime dependency, no build step.
19. [19-video-reactive-controller.md](19-video-reactive-controller.md) — the
    stock-device visual loop: calibrated native-resolution watchlist facts,
    animation-safe blackout reaction, observe-only promotion, and a delayed
    external-A2DP audio slow path.
20. [20-belief-state-cycle-controller.md](20-belief-state-cycle-controller.md)
    — the architecture above the sensor and driver plans: a hardware-agnostic,
    uncertainty-aware digital twin that evaluates and verifies bounded next
    cycles instead of replaying a fixed macro; bridge, processor, reflex, and
    actuator roles are selected by capability/profile contracts.
21. [21-policy-program-synthesis.md](21-policy-program-synthesis.md) — a shared
    policy-program IR, structural strategy search, and simulator-to-phone
    equivalence gate so the invention engine can synthesize complete pilots
    rather than timing permutations.
22. [22-architecture-and-developer-experience-refactor.md](22-architecture-and-developer-experience-refactor.md)
    — architectural umbrella: a `@fnaf2-1020/*` workspaces monorepo, canonical
    core package, trainer as a leaf application, conventional automation
    vocabulary, capability-aware sensor/actuator adapters, first-class research
    experiments, strict typed/runtime contracts, fast deterministic test lanes,
    a profile-driven device service and optional actuator MCP, generated
    knowledge indexes/portal, a legible repository front door, and a
    characterized migration away from the monolithic device shell path.
23. [23-cue-helper-overlay-hud.md](23-cue-helper-overlay-hud.md) — a single
    transparent, non-interactive Cue Helper HUD over the stock game, with one
    shared ROI geometry authority, separate sensor/debug and decision/run
    modes, fail-closed cue expiry, and explicit touch-through, target-overlay-
    suppression, self-capture, latency, and lifecycle qualification gates.
24. [24-adaptive-prediction-coach.md](24-adaptive-prediction-coach.md) — a
    follow-up training layer for contextual prediction, recognition, timing,
    and strategy micro-sims, with a conservative activity gate, independently
    resolved outcomes, censored uncertainty, adaptive skill modeling, and a
    strict separation between the non-interactive live HUD and measured
    response channels.
25. [25-horizons-beyond-the-ladder.md](25-horizons-beyond-the-ladder.md) —
    five horizons after the Night 7 clear, each with what exists, a first
    physical milestone and a success condition: solve the game across all
    Custom Night vectors, a clean-room recompile verified against the phone by
    trace equivalence, a self-running experiment loop, machine-found routes a
    human can hold, and the method moved to a second Clickteam game.
26. [26-second-target-fnaf-1-3-4.md](26-second-target-fnaf-1-3-4.md) —
    expansion to the other three night games, all four now installed on the
    campaign handset. Supersedes Plan 25's ordering for horizon 5: the CCN
    headers are identical (runtime 770.0, build 296), the seed chunk is absent
    in all four so the RNG model transfers, and the handle-scramble constant
    was recovered for FNaF 3/4 (`K=29`, empirically, pending jadx). Names the
    community strategy for each game, the prior-art gap (FNaF 3 and 4 have no
    source-available autonomous player), and the decoupling cost
    (`CONTROL_VOCABULARY`, 113 sites). Its custody gate was lifted on
    2026-09-25 (ROADMAP S6).
27. [27-pivot-and-rebrand.md](27-pivot-and-rebrand.md) — done 2026-09-30: the rename to
    `fnaf-solver` (repo) and `@sixam/*` (scope, 719 specifiers), split into
    four mechanical commits plus one structural pivot. Establishes that
    `com.scottgames.fnaf2` inside `docs/evidence/` is a *measurement* and must
    be frozen, that the companion APK's application ID is device state rather
    than branding and must not change. Its sequencing was restated on
    2026-09-25: after ROADMAP S1's first promotion edge, in a quiet window
    (new-game code already exists, so "before any" no longer applies).
28. [28-solver-interface.md](28-solver-interface.md) — the interface an outside
    caller (or their agent) uses instead of investigating by hand: one MCP
    surface over all four games, six namespaces, built on a shared
    `claim-envelope-v1` that carries the evidence label, the citation, the
    `standing`/`superseded`/`retracted` status and an explicit `notMeasured`
    field on every answer. Ships the decoder rather than the decoded data, so
    the publishing boundary holds and one server serves four titles; refuses
    the mistake register's known-bad moves with a citation and a remedy; and
    keeps promotion human-only. Re-measures the custody reading (148 runs,
    7 `DEVICE_MEASURED`, debt 11 of 13, still zero promotion edges), which
    supersedes CLAUDE.md's 2026-09-17 numbers. Starts after ROADMAP S1's first
    promotion edge (restated 2026-09-25).
