# Roadmap: every thread to its last consequence

**Pedro's directive, 2026-09-25.** Take every plan and every thread of this
project, within what is possible, to its last consequence. Gates that are
superseded, obsolete, or that compete with that objective are loosened or
archived. This file states the intent, the path, the boundaries, and the gates
that changed.

It replaces the 2026-09-02 roadmap, which had declared itself superseded on
2026-09-17 and is kept unedited at
[`archive/ROADMAP-2026-09-02.md`](archive/ROADMAP-2026-09-02.md). Code comments
that name "ROADMAP Track A1" or "Track B" mean that file.

## The intent

Followed to their ends, the plans stop being twenty-odd efforts and become one
object: **a verified solver for the Clickteam build-296 night games.** It has
five parts:

- **Truth.** The game itself, recompiled and trace-equivalent to the phone, is
  the source of truth. The hand model becomes a cross-check.
- **Decision.** An exact table of what is winnable: `P_max` per night and per
  Custom Night vector, the viability kernel, and the robustness field.
- **Embodiment.** A controller that runs on the phone and plays close to that
  ceiling.
- **Understanding.** A human who can hold a machine-found route.
- **Proof.** Every answer carries its label and provenance, and negatives can be
  queried.

FNaF 2 at 10/20 stays the primary target. FNaF 1, 3 and 4 run on the same
runtime (Plan 26) and are the same method's other instances. "Solved" is used in
the sense of [`SOLVING-FNAF2.md`](../docs/research/SOLVING-FNAF2.md): mechanically
solved, then state estimation, then control, then globally optimised. The end
state depends on the constraints assumed, and every negative names the family it
searched.

## The path

The order below is the dependency order, not a calendar. Each step names what
closes it and the artifact that closes it. That artifact is what makes a commit
consequential. The "stands" line is a snapshot taken on 2026-09-25. **Trust the
named command over the snapshot**: the previous roadmap's status went stale for
fifteen days because it was written down instead of read.

### S1: Custody and the first promotion edge

- **Closes when** `docs/evidence/graph.json` holds a promotion edge for a packed
  win, and every committed winner's run is packed.
- **Artifact:** a `plan12-attestation.json` over a run pack and the
  `PROMOTED_BY` edge `promote` records for it. Since Pedro's two decisions of
  2026-09-27 (gate table below), an agent may write the attestation, only
  through `npm run evidence -- attest`, and a pack recovered from its night-run
  log is accepted fully while it still names what it lost.
- **Stands** (2026-09-27):
  - **47 promotion edges** in `docs/evidence/graph.json`, one per
    executor-proven 6 AM whose winner is committed: Nights 1-4 two each,
    Night 5 seven, Night 6 eight, Night 7 24 (21 at 10/20, one at BB+Foxy 20,
    two at BB+Golden 20). 36 are recovered custody. All were attested by an
    agent under delegation `pedro-2026-09-27`
    ([promotions](../docs/evidence/plan12-promotions-20260927.json)).
  - 180 run packs under `docs/evidence/runs/`, 48 of them executor wins. The
    refused win is `night7-n7-420-minimal-m3`: the Night 7 4/20 Minus 3 winner
    is held back by `test-seam-slack.mjs`, and its pack holds no dial readback.
    The video-only 6 AMs `night5-anchor4` and `night5-perfetto1` fail
    `terminalPass` and are not promoted.
  - The recovery is byte-identical where it can be checked
    ([custody recovery](../docs/evidence/custody-recovery-20260925.json)).
  - k3 8/10 and k2 3/10, computed from packs, reproduce the hand records' winning
    slots ([k3](../docs/evidence/night7-cohort-k3-computed-20260925.json),
    [k2](../docs/evidence/night7-cohort-k2-computed-20260925.json)). A
    promotion is one clear, not a reliability claim.
  - **Closed 2026-09-30:** every one of the 25 committed `winner-v1` bindings
    is named by a run pack. `campaign-toys-night5-winner.json` was packed on
    the phone (`d659cd62`, a death). The MODEL_ONLY
    `campaign-night1-minus7-winner.json` was retired to `bindings/fnaf2/retired/`
    on Pedro's word (Night 1's
    canonical schedule is the baked minimal one,
    `campaign-night1-minimal-winner.json`). Still open beside the closing
    condition: `UNTRACKED_WINNER_DEBT` is 1 of 1 (Night 6 `a` no longer
    rebuilds).
  - **Superseded the same day:** at 16:30 on 2026-09-27 Pedro had chosen
    "originals only" (a recovered pack cannot carry an attestation; `97b8fd2`).
    Later that day he chose "Accept fully" and delegated attestation to agents
    (gate table below); the later decision is the one in force.
  - No k2 or k3 video exists on this machine, by name or by content hash.
  - Read with `npm run evidence -- promotions`, `list`, and `promote <run>`.
- **Absorbs** Plans 09 and 12.

### S2: Fidelity at the level of encounters

Two routes lead to one answer, and they run side by side.

**Observatory direction (Pedro, 2026-09-27):** the
[research-frontier assessment](../docs/research/FNAF2-OBSERVATORY.md) prioritises
causal reconstruction, input/clock identification and timing topology. Its first
experiment replays `full-06` using individually observable press landings in
place of a nightly median, checking whether window 6 remains occupied. Its
interface milestone is an experiment that rules out a named explanation, not
the completion of a dashboard. This advances S2 and leaves S3-S7's dependencies
intact.

The first host experiment is retained in
[full06-per-contact-responses-20260928](../docs/evidence/full06-per-contact-responses-20260928.json):
the median control reproduces, but all three native-response variants keep
window 6 occupied and introduce an earlier disagreement. MODEL_ONLY; partial
visual-response substitutions are insufficient. Response lag, releases and
the runtime clock remain open, so this does not close S2.

- **S2a, on the phone.** A same-phase twin at a verified seed and anchor phase,
  both nights frame-traced. The 2026-09-27 repeated clock-pin protocol did not
  establish seed 24850: five interrupted attempts are retained, and pinned or
  backwards clock brackets now fail closed as UNKNOWN. Establish a valid seed
  measurement before another twin attempt; the target is unchanged.
- **S2b, on the host.** The clean-room recompile (Plan 17 route 5, Plan 25
  horizon 2) runs until it plays a night. Its trace is then compared with the
  simulator and with the phone.

Details:

- **Closes when** either:
  - the model and the phone agree on occupied mask windows on a traced night at
    that night's own seed, or
  - k2's schedule replayed into the recompiled game gives the same 6 AM and the
    same per-cycle ledger as the phone recording.
- **Artifact:** a frame-traced twin evidence record, or a trace-equivalence
  record.
- **Stands:**
  - The model matches outcomes, not encounters: 2 of 11 mask windows
    ([encounter fidelity](../docs/evidence/model-encounter-fidelity-20260918.json)).
  - Its nights run about half again as busy, with Withered Chica and Withered
    Freddy in excess.
  - On Night 7 it kills nights the phone wins.
  - The recompile reaches the office through corrected nested-child and timer
    dispatch (2026-09-27, 64 office updates). Initialization matches the sourced
    model, but RNG first differs at harness tick 5 / model frame 6. This is
    MODEL_ONLY and DIVERGENT, not equivalence
    ([comparison](../tools/recompile/results/night1-child-timer-sourced-20260927.json)).
  - The updated encounter record still leaves the gap open, including model
    deaths on phone-winning Night 7 runs
    ([encounters](../docs/evidence/model-encounter-fidelity-20260927.json)).
  - Winner schedules now replay into the rebuild and the model together
    (2026-09-27, seed 24850). Night 1 `minimal` and Night 7 `k3` reach 6 AM in
    both. Night 5 `contact-final` dies in the rebuild and wins in the model.
    The rebuild names its killer through a harness Counter watch: Withered Foxy,
    `being attacked by` = 4 from office update 23400
    ([record](../tools/recompile/results/night5-contact-final-replay-e616c431.json),
    `recompile-replay-232b3f74c48dc27a`).
    Every monitor and mask contact lands in both. Under the rebuild option set the
    draw streams of Night 1 and Night 7 match on all 25,201 office updates
    (MATCHED_PREFIX, `recompile-replay-afb6a9d36d6a2ba6`,
    `recompile-replay-1435024cd7ce7fb0`), and Night 5's matches to its terminal
    loop, the model dying to Withered Foxy on update 23400, where the rebuild
    writes `being attacked by` = 4 (`recompile-replay-7e8f8aeb1b5c78fb`).
    MODEL_ONLY, not equivalence
    ([k3 replay](../tools/recompile/results/night7-k3-replay-routeviews-20260927.json)).
  - Against the phone, the rebuild diverges on all four clock-seeded nights.
    Each was replayed on its own frame clock, with presses on their measured
    landing frames. The first disagreements come at windows 9, 10, 3 and 6. Each
    occupant arrived about 4 s before mask-on in every press and clock variant,
    and the model shares it, so the gap sits upstream of both programs.
    MODEL_ONLY
    ([rebuild vs phone](../docs/evidence/rebuild-phone-encounters-20260927.json),
    `recompile-phone-encounters-e18a527d01bcdb54`).
  - **The timing-reference lead is constrained at measured points; S2 remains
    open.** The coarse/fine press-phase × rate sweeps reproduce their controls
    and find no cell reproducing the phone's occupied windows. full-06 peaks at
    32/42; window 6 clears only on isolated phase cells that still disagree on
    at least eight other windows. The night-length bound limits a large
    accumulated-timer loss if the decoded shared-accumulator rule holds
    ([phase/rate sweep](../docs/evidence/phone-clock-sweep-20260928.json),
    `recompile-phone-clock-sweep-616ca1010c7259f7`). A separate frame-trace
    measurement puts full-06's hour-grid zero at first frame +3836.7 ms, within
    0.7 ms of anchor fire; full-04 has one pre-death transition and a -48.2 ms
    offset. Re-zeroing the model clock and delaying the schedule by the measured
    anchor-origin gap does not improve either night: the joint cells die after
    two compared windows on full-06 and three on full-04, while each control
    remains best
    ([hour grid](../docs/evidence/phone-hour-grid-20260928.json),
    [measured correction](../docs/evidence/phone-clock-zero-sweep-20260928.json)).
    The measured correction does not explain the encounters. The full-06
    response-bracket family is now exhaustively enumerated through window 6:
    29/29 relevant contacts have observed response brackets, two admit an
    alternate update tick, and all four combinations preserve windows 0-5 but
    leave model window 6 occupied by Withered Bonnie. At that window the model
    has Bonnie at ventL, with his office encounter starting 24 updates earlier;
    the response-ready rebuild reads Chica and the phone reader says empty.
    Their draw stream already split at update 205 under response-ready inputs
    and update 904 under the primary landed replay. This rules out the measured
    visual-response timing family as the explanation, not dispatch timing or
    release acceptance
    ([input bracket](../docs/evidence/phone-input-bracket-20260928.json),
    `recompile-phone-input-bracket-f7147f352c9115f7`). Compare Bonnie's route
    eligibility and encounter start in the rebuild against the model around
    the earlier draw split; the same-phase phone twin remains the physical
    separator. S2 stays open.
  - **The phone's own frames** put the hall flash's end 3-5 updates before the
    replayed hall contact in every flashed cycle (monitor -2..+1, mask
    0..-1), and the eyehole confirms B, C, empty, empty in windows 3-6;
    hall-contact shifts inside the measured bracket never empty window 6
    ([record](../docs/evidence/full06-input-registration-20260928.json),
    `s2-input-registration-b09be5c86b35a4a3`).
  - **Retracted 2026-10-01: the "40.0 s" Balloon Boy divergence.** That
    record's audio was read 30 s late: the reader paired each mask-sound
    onset with the nearest play within 1 s, and the mask sound repeats every
    window. Solved over the rebuild's monitor and mask plays, and bounded by
    the capture's own stamps, the phone's Balloon Boy hop vocals are at
    10.04, 15.08 and 20.04 s. At 15.03 s the rebuild plays echo1 where the
    phone plays echo3b, so the two draw streams differ at or before 15 s;
    the weaker 10.04 s read (the rebuild moves him silently out of CAM 10
    there) puts the difference at his first roll, at 5 s
    ([realignment](../docs/evidence/full06-audio-realignment-20261001.json),
    `s2-audio-realignment-f61f47d56098beb2`). DEVICE_MEASURED audio against
    MODEL_ONLY replays.
  - **No office start state explains full-06 (pre-registered, MODEL_ONLY,
    INCONCLUSIVE).** All 65,536 start states were replayed on the night's
    measured clock and landed contacts. The measured seed agrees through
    window 6, no better than 26,557 others; no state agrees past window 23 of
    42, and start states up to 12 draws from the seed never reach window 10.
    The model's per-window occupant rates are the phone's (empty 0.39,
    Withered Chica 0.31, Bonnie 0.27, Freddy 0.03 over 1,000 start states,
    against 14, 11, 11 and 2 of the phone's 38 windows; chi-square 0.49 on
    3 df), so the strong states' misses at Freddy's windows 22 and 26 are
    his rarity, not a mechanics gap; their misses at 31-32 exceed it
    ([rates](../docs/evidence/full06-occupancy-rates-20261001.json),
    `s2-occupancy-rates-58d23e496849b27b`). Keeping the
    measured seed, no single change before the first roll (an early contact
    shifted -3..+3 updates or removed, one or two draws more or fewer) fits
    both the audio and the windows, and none of the 14 seeds of the logcat
    bracket fits the audio
    ([sweep](../docs/evidence/full06-early-perturbation-20261001.json),
    `s2-early-perturbation-1c931f96a31dcb24`, pre-registered,
    NOT_SUPPORTED).
  - **The camera static reads the random stream out, too coarsely in the
    retained grid (pre-registered, two sweeps).** Office g58 re-rolls the
    static's blend coefficient from Random(50) every 100 ms, and in
    full-06's winding windows the retained frames' period-mean luma steps
    8.6-16 times above its within-period noise. Scanning every generator
    state against it identifies none (best r 0.69-0.78, at the chance
    maxima), and the held-out test of "the seed is right, the phone a few
    draws ahead" hits 1 of 4 windows (NOT_SUPPORTED), though small offsets
    recur
    ([readout](../docs/evidence/full06-static-readout-20261001.json),
    `s2-static-readout-f9d8879e0d3f3e49`;
    [confirmation](../docs/evidence/full06-static-readout-confirm-20261001.json),
    `s2-static-readout-confirm-6ccf7cf7ccd77fec`). The physical separator is
    a traced Night 7 whose camera-view region is read natively through the
    winding windows, so single draws resolve and the seed is checked state
    by state
    ([census](../docs/evidence/full06-stream-census-20261001.json),
    `s2-stream-census-45ad1201c90a4531`;
    [pre-registration](../docs/evidence/full06-stream-census-predeclaration-20261001.json)).
- **Absorbs** Plan 17 (route 5), Plan 25 horizon 2, and the model parts of
  Plans 15 and 19.

### S3: The ceiling, from a census over policies

- **Closes when** there is a `P_max` per story night and per Custom Night preset
  over all 65,536 seeds, with a held-out block, or a lower bound scoped to the
  family searched. It also needs the dial frontier (Balloon Boy x Foxy first),
  with its corner vectors run on the phone.
- **Artifact:** census records under `docs/evidence/`, each naming its policy
  family and held-out block, plus the device runs at the frontier corners.
- **Stands:**
  - Exhaustive censuses are routine, but over *fixed schedules*, not over
    policies; the one census over a policy family so far is the next bullet.
  - **Night 7 (10/20), policies j, k2, k3 released by their registered
    anchors: every deliverable epoch wins (exact lane, pre-registered).** The
    family is each binding at every integer-ms epoch of its anchor's effective
    interval (108 members, 32 schedule classes); a policy's value is its worst
    epoch. All 32 classes win all 3000 seeds of the development block (0..2999)
    and of the held-out block `held-out-32768` (3000 seeds outside the tuning
    cohorts), so `P_max` over this family >= 3000/3000 held-out, Wilson
    [0.99744, 1] at joint 0.95 over k3's 9 classes (k3 selected by the
    pre-registered tie order; j and k2 tie). The band is flat (E1 survives; the
    phase and the seed inside the band are ruled out), and the device lane,
    per-press lateness in the anchor's 47-82 ms band, also wins 3000/3000 for
    each binding. So k3's two phone losses lie outside what this lane models
    (an epoch outside the band, lateness beyond it), or in S2
    ([record](../docs/evidence/night7-anchor-band-census-20260930.json),
    `night7-anchor-band-census-1e49be7fa931a5aa`;
    [pre-registration](../docs/evidence/night7-anchor-band-census-predeclaration-20260930.json);
    held by `test-policy-census.mjs`). MODEL_ONLY. Scoped to three open-loop
    bindings; no seed-aware policy or story night has a policy census yet.
  - **Story Nights 1-7 (Night 7 = 10/20): `P_max = 1` in the model's exact
    lane, at each binding's declared phase.** All 26 committed `winner-v1`
    bindings, replayed as their gates replay them, win all 65,536 seeds, and
    the 56,970-seed held-out block matches
    ([winner census](../docs/evidence/fnaf2-winner-census-20260925.json),
    held by `test-winner-census.mjs`). k3 (8/10) and k2 (3/10) on the phone
    use bindings that score perfect here, so their gap to 1 lies in delivery
    (the phase is the axis that is not censused) and in S2, not in the seed.
  - **All ten Custom Night presets: `P_max = 1` in the exact lane at epoch 0.**
    Minus Toys at `PRESET_KNOBS` wins all 65,536 seeds of every preset, and
    each held-out block matches
    ([preset population](../docs/evidence/night7-preset-population-20260925.json),
    held by `test-night7-presets.mjs`). The device lanes and the epoch scan
    are still on the golden cohort
    ([preset sweep](../docs/evidence/night7-preset-sweep-20260917.json)), whose
    3000 uint32 seeds are 2932 distinct nights.
  - No lateness lane has a population census.
  - **No dial frontier in the Balloon Boy × Foxy or Balloon Boy × Golden
    Freddy plane (exact lane).** In each plane, every one of the 441 cells, with
    the other dials at 0 and at 20, is won on all 300 held-out seeds by the
    preset schedule and by k3 ([bb × foxy](../docs/evidence/night7-dial-plane-bb-foxy-20260925.json),
    [bb × golden](../docs/evidence/night7-dial-plane-bb-golden-20260925.json),
    held by `test-night7-presets.mjs`).
    - Nothing in those planes breaks the monotonicity that the 10/20 win
      relies on.
    - This supersedes the Plan 05 invention frontiers under
      `docs/evidence/invent/`, which put BB 20 + Foxy 20 at 0.25% on
      2026-09-02.
    - The natural corners to run on the phone are BB 20 + Foxy 20 and BB 20 +
      Golden Freddy 20, each with every other dial at 0.
- **Absorbs** Plans 05, 11 and 21, and Plan 25 horizon 1.
- **Needs S2:** a ceiling computed on a model that misses encounters is a
  ceiling of the model.

### S4: A controller that plays at the ceiling, on the phone

The Companion hosts the whole loop, with no host in it. It observes through
native regions and keeps a belief over the seed and the frame phase. It
identifies the seed during the night (65,536 -> 1), then plays that seed's plan.

- **Closes when** a predeclared Night 7 cohort reports its win rate against S3's
  `P_max`.
- **Artifact:** the cohort's run packs and its result record.
- **Stands:**
  - k3 reached 6 AM on 8 of 10 nights with an anchored open-loop schedule and a
    belief-gated supervisor
    ([k3 cohort](../docs/evidence/night7-cohort-k3-result-20260918.json)).
  - `seedpin` hits a 7-value window, and the exact value about one time in five.
  - Twins are proven but did not replay the night, because frame phase enters
    the random stream
    ([twins](../docs/evidence/night6-twin-nights-proven-20260918.json)).
  - **In the model, the phase decides a Night 7 night, not the seed.** Each of
    the four committed Night 7 bindings was run at every frame phase within
    ±1 s of its declared epoch, over 1000 held-out seeds
    ([phase census](../docs/evidence/fnaf2-night7-phase-census-20260925.json),
    held by `test-winner-census.mjs`).
    - 481 of the 484 cells are all-win or all-loss.
    - At no phase does choosing among the bindings with the seed known beat the
      best single binding.
    - Within this family, then, the belief that pays is over the frame phase,
      and identifying the seed adds nothing.
    - k2 and k3 differ at one frame (2566 ms), outside the effective interval
      [2410, 2445] ms that both of them win whole. So the model does not
      separate their cohorts.
    - All nine losses in those two cohorts were read from the recordings as
      Withered Foxy ([k2](../docs/evidence/night7-cohort-k2-result-20260914.json):
      7, k3: 2). These are visual reads, not instrument facts. It is the same
      death the k2 anchor register records just past the band's late edge, at
      2516.71 ms.
- **Absorbs** Plans 08, 10, 13, 14, 19, 20 and 23.
- **Needs** the seed-provenance axis below.

### S5: The human route

- The robustness field `δ*(x)` gives the route that maximises the worst-case
  timing margin.
- That route is certified on the phone with jitter injected at the human gate's
  level.
- The trainer and coach then teach it, and a person clears 10/20 on video, with
  the learning curve recorded.
- **Closes when** a person clears Night 7 at 10/20 on the retail phone on a
  counted, uncoached night, playing a route whose certification runs are
  packed, and every counted attempt before that clear, won or lost, is in the
  record as the learning curve.
- **Rules (Pedro, 2026-09-29, [ADR 0002](../docs/decisions/0002-kernel-contexts-vocabulary.md)):**
  - Pedro is the only participant until a second person plays. A written,
    predeclared protocol and consent form come before anyone else's attempt is
    recorded.
  - The coach is off on counted nights. Coached nights are practice and never
    count toward `P(win | H)`.
  - A participant's attempts stay in the local Evidence Vault, out of git, until
    they sign off at the study's close, so withdrawal before then is a real
    deletion. After sign-off they are committed under a pseudonym and frozen.
- **Artifact:**
  - the certification runs;
  - trainer code that a gate exercises;
  - the human attempt's record, made under a predeclared protocol with consent.
- **Stands:**
  - **At 10/20 in the model, the preset schedule (`PRESET_KNOBS`, epoch 0)
    keeps the widest per-press timing margin of the Night 7 candidates**
    ([robustness](../docs/evidence/night7-robustness-20260925.json), 500
    held-out seeds, held by `test-night7-presets.mjs`).
    - Every seed survives per-press lateness up to 100 ms.
    - The human gate's ±60 ms leaves it 257 of 500.
    - The committed bindings j, k2 and k3, the routes the phone runs, survive
      lateness only to 50 ms, and ±60 ms on 1 of 500.
    - Their phase bands are all about 133 ms wide.
    - The preset schedule has never run on the phone, and **as it stands it
      cannot be run anchored**. Its only won bands in 0-10 s are 0-100 ms and
      167-300 ms, earlier than any epoch the anchor can deliver (557 ms:
      `night-anchor.js`'s latch hold and lead, plus the register's onset bias
      and least latency). The committed bindings' bands, at 2.2-2.6 s, can
      be delivered. Using its lateness tolerance would need its schedule
      re-timed so a band lands at a deliverable epoch. Whether a re-timed
      copy keeps that tolerance is the open question.
    - The lateness is `actuator.mjs`'s independent per-press draw, so this is a
      comparison between routes, not a cohort prediction.
- **Absorbs** Plans 02, 03, 04 and 24, and Plan 25 horizon 4.

### S6: The method on four games, and the interface

FNaF 1, 3 and 4 go through the same chain: dump, model, census, device lane,
pack, promotion. Then come the rebrand to `fnaf-solver` / `@sixam/*` (Plan 27)
and the solver MCP with its claim envelope (Plan 28).

- **Closes when** all three hold:
  - FNaF 1, 3 and 4 have each been through the whole chain at least once: a
    committed winner, a census naming its family and held-out block, a device
    run pack of that winner, and a `PROMOTED_BY` edge for it;
  - the repository, packages and MCP server carry the `fnaf-solver` /
    `@sixam/*` names (Plan 27 commits A, B, C and R);
  - the `fnaf-solver` MCP server answers every Plan 28 verb in the claim
    envelope, and a contract test exercises each one.
- **Artifact:** the three games' promotion edges and census records, and the
  envelope's contract tests.
- **Stands:**
  - **FNaF 1:** 4/20 reached 6 AM on 2 of 4 nights on the phone
    ([first 6 AM](../docs/evidence/fnaf1-420-first-6am-20260925.json)).
    The route that won -- `grid420` as its pinned commit `3aaf02c` holds it,
    with the option its runner passed (`chicaByCamera: false`) -- scores in
    the model's device lane, over all 65,536 seeds
    ([`fnaf1-420-winner-route-population-20260927`](../docs/evidence/fnaf1-420-winner-route-population-20260927.json)):
    - typical: 65,536/65,536;
    - worst: 62,052/65,536 (94.684%; held out 53,953/56,970); the 3,484
      losses are Chica 1,905, blackout Bonnie 727, blackout Chica 461, Foxy 391;
    - starved (the screenrecord case): 0.

    The two recorded nights died on the phone, which fits. The 97.90% worst
    lane quoted before was `grid420` with the model's default
    `chicaByCamera: true` from a modified tree
    ([2026-09-25 census](../docs/evidence/fnaf1-420-device-lane-population-20260925.json)),
    not the route the phone ran. The committed winner names this census, and
    `test-fnaf1-winner.mjs` replays it with the pinned policy. `e6de745` has
    changed the route since, so the tree's runner refuses the winner's night
    and `npm run night -- fnaf1-winner` re-runs the pinned commit.
  - **FNaF 3:** Night 1 on the phone. The model's 65,536/65,536 on all six
    nights is retracted (2026-09-30): the model lacked attack stage 1's own
    exit (g252/g275). With it the community line reaches 60,081 (Night 1) down
    to 20,489 (Night 6) of 65,536, and 7,226 on Aggressive Nightmare
    ([`fnaf3-stage1-g275-census-20260930`](../docs/evidence/fnaf3-stage1-g275-census-20260930.json)).
  - **FNaF 4:** model only ([four games](../docs/research/FOUR-GAME-NIGHTS.md)).
  - **In the rebuild (2026-09-29, MODEL_ONLY, rebuilt-runtime).** A lockstep
    pilot wins each game's hardest night in the rebuilt runtime, and the game
    writes its own mark: FNaF 3 Aggressive Nightmare (`4thstar=1`,
    [`recompile-pilot-night-9bba02f11189549a`](../tools/recompile/results/fnaf3-aggressive-nightmare-20260929.json))
    and FNaF 4 Night 8, 20/20/20/20 (`beat8=1`,
    [`recompile-pilot-night-4a296d97011c3ae2`](../tools/recompile/results/fnaf4-night8-20260929.json)).
    FNaF 4's challenge stars are won on Night 7 too: `s6`
    ([`recompile-pilot-night-91ea0be07e47c961`](../tools/recompile/results/fnaf4-night7-s6-20260929.json))
    and `s5`
    ([`recompile-pilot-night-058228090b83d691`](../tools/recompile/results/fnaf4-night7-s5-20260929.json)).
    The recorded touches replay to an equal trace with no pilot. The
    controllers read the runtime's objects, so none of these is a device route
    or a census. The FNaF 3 controller wins 1 of 6 other seeds, the FNaF 4 one
    5 of 6.
  - **Over seed blocks (2026-09-30, MODEL_ONLY, rebuilt-runtime).** FNaF 4
    Night 8: `warden2` wins 2,996 of 3,000 predeclared held-out seeds
    ([`fnaf4-night8-warden2-holdout-20260930`](../docs/evidence/fnaf4-night8-warden2-holdout-20260930.json));
    `warden3` fixes the losses' main mechanism, and a predeclared 3,000-seed
    block of `warden3` plus per-seed search is open. FNaF 3 Aggressive
    Nightmare: a reactive controller wins about half, bounded by the sheet's
    audio budget; with per-seed search, 91 and then 97 of two predeclared
    100-seed blocks have a touch sequence that wins replayed with no pilot
    ([`fnaf3-search-block-20260930`](../docs/evidence/fnaf3-search-block-20260930.json),
    [`fnaf3-search-v2-block-20260930`](../docs/evidence/fnaf3-search-v2-block-20260930.json)).
    Neither game is shown winnable on every seed.
- **Absorbs** Plan 25 horizon 5 and Plans 26, 27 and 28.

### S7: The lab runs itself

A planner ranks the disagreements between phone, model and (after S2b) the
recompile. For each, it picks the run whose outcome refutes one of two
explanations. It emits only bundles and queued Companion jobs, and never
arbitrary shell. The mistake registers become executable gates, and the lab
never promotes. Its phone time is the overnight window (Pedro, 2026-09-27):
`apps/lab/overnight-window.py` runs the queue on his own phone from 01:30
to 07:00 and restores every setting it changed. Since his "Yes, play nights"
the same day, a queued `night` job plays one night of a committed winner
there (`apps/lab/night-job.py`). The title is observed before each night
and after it, and each night's pack is written in the morning.

- **Closes when** both hold:
  - a morning report refutes a mechanism that no person queued an experiment
    for, the runs that refuted it are packed, and a Review instrument, not the
    planner, confirms the refutation on re-read;
  - every entry in both mistake registers names the gate that enforces it, and
    that gate runs in a CI lane.
- **Artifact:** a morning report that refutes a mechanism nobody had queued,
  with the run bundles that did it.
- **Absorbs** Plan 25 horizon 3 and Plans 07, 18 and 22.

**Order.**
- **Now:** S1, which needs minutes of Pedro plus the peer machine.
- **Next:** S2a is the next physical test; S2b runs beside it.
- **Then:** S3 after S2, and S4 after S3.
- **S5** needs S3's robustness field.
- **S6** is already under way. Its gates are restated below.
- **S7** comes last, because it automates S2 to S5.

## The end state: Archive

The project ends in an Archive state, whether every step closes first or Pedro
stops it earlier. Archive is reached when all of these exist:

- a signed, frozen tag on a green commit;
- a final claims snapshot under `docs/evidence/`, produced by the promotions and
  census queries rather than written by hand, with the retractions and refuted
  routes included;
- the Content Vault and the toolchain archived: the Docker images saved by
  digest, the Python 2.7 converter environment exported, and the CTFAK and
  Anaconda forks pushed where Pedro chooses;
- the Evidence Vault replicated off this host, with a committed manifest that
  maps every hash the evidence cites to where it resolves;
- a "How to verify in 2030" page that starts from a clean clone and the
  archived images, and says which claims can still be re-checked and which
  cannot.

## Where the threads meet

- **The seed pin plus the table give a tool-assisted night on stock hardware.**
  Once `seedpin` and the frame phase are both controlled, a night becomes a
  lookup into the table. That is the clairvoyant solution of `SOLVING-FNAF2.md`,
  and it is a different claim from winning the observable game. Hence the new
  axis below.
- **The recompile plus the lab give a three-way arbiter.** Every disagreement
  classifies itself as a decoder error, a translation error, or a timing error.
- **The robustness field plus the coach:** the route that maximises the
  worst-case margin is the mathematically best *human* route, and it is what the
  trainer should teach.
- **Varying the game's constants** yields `P_max(θ)`, a difficulty phase
  diagram, for all four games.

## Boundaries: what "within possibilities" excludes

- **PAIRIP (Pedro, 2026-08-28).** No runtime attach to the retail APK, and no
  re-signing. The recompile is a personal research artifact. Dumps, generated
  code, recordings and game frames are never committed, except the two README
  clips (gate table below). Dump text is cited, never quoted (ADR 0002). What is
  published is the method and the equivalence evidence.
- **21^10 dial vectors** are reachable only through monotonicity, and that is a
  hypothesis to test, not a shortcut: Balloon Boy and Golden Freddy interact
  with other dials.
- **"Formally solved" is always conditional** on the decoded dump and on a model
  of how the phone delivers frames and touches.
- **One handset.** Plan 14 package 6 waits for a second device and is not
  counted against the path.
- **S5 needs people:** volunteers, consent and a predeclared protocol. Feedback
  comes only between attempts. Until a second person plays, Pedro is the only
  participant (S5's rules).
- **A belief-state solution** is tractable only if the state quotient collapses
  to few classes. That too is a hypothesis.

## Claim axis the path adds: seed provenance

A night's seed is `natural` (the game's wall clock), `pinned` (`seedpin` wrote
the clock) or `identified` (inferred during the night by the controller).

- A `pinned` win is a clairvoyant claim.
- It is labelled as one, and it is never merged into a natural-clock cohort.
- Plan 12 carries the rule.

## What counts as consequential now

A commit is consequential when it retains a verifiable record that closes or
advances a step above. That can be:

- device evidence or a run pack;
- a promotion;
- a frame-traced twin or trace-equivalence record;
- a census whose held-out block is named;
- code that a gate exercises in the Companion, the controller, the trainer or the
  solver interface.

Docs and plans alone remain bookkeeping. The `commit-msg` hook is unchanged:
host-side records land in `docs/evidence/`, which it already accepts. A host
result never stands in for a device claim, and the labels `MODEL_ONLY`, `FIXTURE`
and `DEVICE_MEASURED` still do not promote one another.

## Gates changed

Rows are from 2026-09-25 unless they carry another date.

| Gate | Where | Why it had to change | Now |
|---|---|---|---|
| "No host-side substitute work" | `CLAUDE.md`, `AGENTS.md`, charter | Forbade S2b, S3, S6 and S7, which are host-side by nature | **Loosened.** Host-side work counts when it retains a record for a step. It never stands in for a device claim. |
| Consequential = a Plan 12 rung or trainer code | same, and the hook's comment | Left the Truth and Decision steps with no consequential form | **Redefined** by the step list above. The hook's mechanics are unchanged. |
| "Laser-focus on 6 AM successes; nothing outranks the next graded run bundle" | `CLAUDE.md` | Superseded by the path. Its target now lives in S1 and S4. | **Replaced** by this file, with S1 first. |
| Plan 26 "does not start yet" | Plan 26 | Overtaken by its own work: FNaF 1 4/20 on the phone, FNaF 3 and 4 censuses | **Lifted.** |
| Plan 27 "custody first, then rebrand" | Plan 27 | Waited for custody in full, which may never come for k3's lost media | **Restated:** after S1's first promotion edge, in a confirmed quiet window. |
| Plan 28 "sits behind all three" | Plan 28 | Its reason stands, but "all of custody" is not its trigger | **Restated:** after S1's first promotion edge. |
| Plan 12 Gate A: "the exact emitted plan passes the current human/model gate" | Plan 12 | The human gate scores human execution at ±60 ms. A machine route is gated by the device lane at measured timings. | **Narrowed** to human-route claims (S5). |
| Plan 12 Gates C and D (shadow night, bounded branch) as prerequisites | Plan 12 | Written for a controller extracted from the legacy runner, which is archived. The anchored bindings reached rungs 4, 5 and 7 directly. | **Entry gates for a new closed-loop controller (S4)**, not prerequisites for promoting a run already won. |
| Plan 12 Gate G: "begin with shadow and bounded branches again", with holdouts for every Night 7 observation | Plan 12 | Would block promotion of the 10/20 wins already on the phone | **Loosened.** Promoting a won run needs what `evidence -- promote` checks: pack, terminal, committed winner, attestation. The Gate G list applies to a reliability or controller claim. |
| Plan 05's 1200-seed admission gate | Plan 05 | Superseded by the 3000-seed rule and a held-out block | **Superseded.** |
| `PROGRESS.md` dashboard and counting rule | `PROGRESS.md` | Measured completion of written plans (31%), not progress. Stale since 2026-09-04, and its "next gate" column named archived commands. | **Archived** to [`archive/PROGRESS-dashboard-2026-09-04.md`](archive/PROGRESS-dashboard-2026-09-04.md). The steps above replace it. |
| `npm run push-gate` runs every CI lane before a push | `tools/push-gate.mjs`, `.github/workflows/ci.yml`, `package.json` | Measured 2026-09-28 in the working tree: `test:unit` took 307 s, 278 s of them eight gates of five seconds or more (`test-night7-presets` 88 s, `test-fnaf1-census` 60 s, `test-overnight-window.py` 37 s, `test-fnaf3-census` 30 s, `test-night-job.py` 24 s, `test.mjs --gates` 16 s, `test-fnaf4-cues.py` 14 s, `test-winners-rebuild` 9 s) that no ordinary commit changes; every other CI lane takes about a second. Pedro: iteration time outranks re-running them locally. | **Loosened.** Those eight move to `npm run test:unit:slow`, a CI lane of its own (`Slow census gates`) that CI still runs on every push; the pre-push gate skips it by default and reports it unverified; `npm run push-gate -- --full` runs it here. |
| The 2026-09-02 roadmap | `plans/ROADMAP.md` | Had declared itself superseded on 2026-09-17 | **Archived.** |
| Fixture service path and the `device:dry-run` CI lane | CI, `CLAUDE.md` | Played no nights | Retired the same day in `6d78c7e`. CI now runs the campaign dry run over a committed winner. |
| "Agents never write `plan12-attestation.json`"; the attestation was "a person's file" | `CLAUDE.md` S1, `docs/evidence/README.md`, Plan 12, this file's S1 artifact, `tools/evidence-campaign.mjs` (since 2026-09-29 `packages/review/src/evidence-campaign.mjs`) | **2026-09-27, Pedro:** "i give agents full permission, this is bullshit bureaucracy that is impeding progress". It held every executor-proven 6 AM one check short of promotion. | **Loosened.** An agent may write the attestation under delegation `pedro-2026-09-27`, and only through `npm run evidence -- attest`, which re-derives every other check from the pack and refuses to write on any failure. `plan12-attestation-v2` names its author (`attestedBy: {kind: 'agent', delegation, note}`, or a person by name), binds the pack sha256, and lists each check verified with the sha256 of its inputs. `promote` records a `PROMOTED_BY` edge in `docs/evidence/graph.json` naming the author and the custody, and `list`/`show` print both. The delegation covers attestations only: `PEDRO-OK` stays human-only and no agent bypasses a hook. |
| `manifestComplete` requires `request.json`, so a pack recovered from its night-run log could not be promoted; recorded as "Pedro's decision" | `packPromotionChecks` (`tools/evidence-pack.mjs`, since 2026-09-29 `packages/review/src/evidence-pack.mjs`), `CLAUDE.md` S1, this file's S1 | **2026-09-27, Pedro**, on recovered packs: "Accept fully". | **Loosened.** A recovered pack's manifest is complete when its result and events came back, the log it cites is withheld under the same sha256, the recovery check it cites is byte-identical, and its `lost` list is present (`packManifestComplete`). The `lost` list stays in the pack, the attestation, the edge and every reading. |
| The Companion queue "cannot hold ... game-control actions" (setup and screen checks only) | `apps/lab/companion-queue.py`, the MCP `cue.queue.enqueue` | Pedro, 2026-09-27, asked whether overnight windows may play full nights unattended on his phone: "Yes, play nights". S7's phone time needs the queue to hold a night. | **Loosened, 2026-09-27**, by one word: `night`, one night of a *committed* winner file, run by the runner its schema fixes. It still takes no shell text, coordinates or timing. Only the overnight window claims one (`run --nights`), never `cue.queue.run`. It refuses unless the observed title offers that night, and fits inside the window's deadline. `night-run.sh` now takes the serial lease, and the lease and queue are host-wide. |
| "Recordings and game frames are never committed" | `CONTRIBUTING.md`, this file's Boundaries | `e6de745` re-added two gameplay GIFs (12.4 MB) the day after `701f5ab` dropped committed game frames, and the exception lived only in a commit message. | **Loosened, 2026-09-29, Pedro:** a written exception for at most two README clips, `docs/img/night7-teach-panel-cycle22.gif` and `docs/img/fnaf1-420-teach-panel-bonnie.gif`, each 4 MB or less. Any other game media is refused: the four `tearing-vs-flash` test frames were removed in `b253d98`, and the gate that refuses new media is open work. |

## Gates changed on 2026-09-27 (Companion rework)

| Gate | Where | Why it had to change | Now |
|---|---|---|---|
| Plan 23 overlay self-capture qualification (`OverlayCaptureGate`, sidecar, probe, `validate-`/`provision-overlay-qualification`, `overlay-qualification-observe.sh`) | Companion, `tools/device/` | It gated a full-screen sensor/debug HUD that drew the discontinued watchlist ROIs and never qualified, so every status line read `gate=UNQUALIFIED` even while a teach panel ran correctly | **Retired** with that HUD. The teach panels are gated by geometry: each is a window of exactly its lesson's rectangle, proved clear of every reader by host tests and, at runtime, of every registered region. |
| APK audio authority checks (`test-bridge-audio-authority.py`, `test-provision-cue-model.sh`, the `pcm-udp-v1` contract) | `tools/cue/`, `tools/device/`, core contracts | They tested the APK's ESP32/fact-port audio path, whose firmware was archived on 2026-09-24 | **Retired** with the path; the host A2DP path (`bt-audio-link.sh`, `fnaf4-cues.py`) is the audio route. |
| `test-watch-calibrate.py` and the luma watch entries | `tools/device/` | Calibrated luma reducers that CLAUDE.md discontinues and nothing live read | **Retired.** The twelve camera-button pixels that the arm check reads remain, quarantined in `Fnaf2Legacy`. |

**Kept, because they serve the path:**

- the hook's mechanics, `PEDRO-OK` as human-only, and no hook bypass;
- a winner committed in the same commit, `UNTRACKED_WINNER_DEBT`, and
  `test-winners-rebuild.mjs`;
- the seam-slack floor;
- the 3000-seed rule with a held-out block;
- both mistake registers;
- result labels, and device safety;
- the publishing boundary;
- the Companion queue when the phone is absent;
- "a refuted route's next commit is the next route's physical test".
