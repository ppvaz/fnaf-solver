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
- **Artifact:** Pedro's `plan12-attestation.json` over a run pack (human-only,
  and agents never write one), and his decision on whether a pack recovered
  from its night-run log, which has lost `request.json`, can carry one.
- **Stands** (updated later on 2026-09-25):
  - 83 run packs under `docs/evidence/runs/`, 39 of them wins. Two wins with
    their original directories pass every check except the attestation. The
    other 37 were recovered from `campaign.log` and fail `manifestComplete`.
    The recovery is byte-identical where it can be checked
    ([custody recovery](../docs/evidence/custody-recovery-20260925.json)).
  - Night 5 `contact-final`, Night 6 `h` and Night 7 `k2` are packed from this
    machine; no peer machine is needed for them.
  - k3 8/10 and k2 3/10, computed from packs, reproduce the hand records' winning
    slots ([k3](../docs/evidence/night7-cohort-k3-computed-20260925.json),
    [k2](../docs/evidence/night7-cohort-k2-computed-20260925.json)).
  - **0 promotion edges.**
  - `UNTRACKED_WINNER_DEBT` 1 of 1 (Night 6 `a` no longer rebuilds).
  - No k2 or k3 video exists on this machine, by name or by content hash.
  - Read with `npm run evidence -- list` and `npm run evidence -- promote <run>`.
- **Absorbs** Plans 09 and 12.

### S2: Fidelity at the level of encounters

Two routes lead to one answer, and they run side by side.

- **S2a, on the phone.** A same-phase twin: the pinned 24850 night replayed at
  today's anchor phase, both nights frame-traced. This is the next physical
  test.
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
  - The recompile boots to the title screen with placeholder sprites
    ([recompile notes](../docs/in-engine/IN-ENGINE-PILOT-RECOMPILE.md)).
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
    policies.
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
    - The preset schedule has never run on the phone.
    - The lateness is `actuator.mjs`'s independent per-press draw, so this is a
      comparison between routes, not a cohort prediction.
- **Absorbs** Plans 02, 03, 04 and 24, and Plan 25 horizon 4.

### S6: The method on four games, and the interface

FNaF 1, 3 and 4 go through the same chain: dump, model, census, device lane,
pack, promotion. Then come the rebrand to `fnaf-solver` / `@sixam/*` (Plan 27)
and the solver MCP with its claim envelope (Plan 28).

- **Stands:**
  - **FNaF 1:** 4/20 reached 6 AM on 2 of 4 nights on the phone
    ([first 6 AM](../docs/evidence/fnaf1-420-first-6am-20260925.json)).
    `grid420` in the model's device lane, over all 65,536 seeds, scores:
    - typical: 65,536/65,536;
    - worst: 97.90%, 1369 of 1374 losses to Chica;
    - starved (the screenrecord case): 0.

    The two recorded nights died on the phone, which fits
    ([lane population](../docs/evidence/fnaf1-420-device-lane-population-20260925.json)).
    The committed winner pins the lane file as of `3aaf02c`, the 420-a win.
    `e6de745` has changed the route since, so a re-run from the tree does not
    execute the file that won.
  - **FNaF 3:** 65,536/65,536 in the model on all six nights, and Night 1 on the
    phone.
  - **FNaF 4:** model only ([four games](../docs/research/FOUR-GAME-NIGHTS.md)).
- **Absorbs** Plan 25 horizon 5 and Plans 26, 27 and 28.

### S7: The lab runs itself

A planner ranks the disagreements between phone, model and (after S2b) the
recompile. For each, it picks the run whose outcome refutes one of two
explanations. It emits only bundles and queued Cue Helper jobs, and never
arbitrary shell. The mistake registers become executable gates, and the lab
never promotes.

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
  code, recordings and game frames are never committed. What is published is the
  method and the equivalence evidence.
- **21^10 dial vectors** are reachable only through monotonicity, and that is a
  hypothesis to test, not a shortcut: Balloon Boy and Golden Freddy interact
  with other dials.
- **"Formally solved" is always conditional** on the decoded dump and on a model
  of how the phone delivers frames and touches.
- **One handset.** Plan 14 package 6 waits for a second device and is not
  counted against the path.
- **S5 needs people:** volunteers, consent and a predeclared protocol. Feedback
  comes only between attempts.
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

## Gates changed on 2026-09-25

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
| The 2026-09-02 roadmap | `plans/ROADMAP.md` | Had declared itself superseded on 2026-09-17 | **Archived.** |
| Fixture service path and the `device:dry-run` CI lane | CI, `CLAUDE.md` | Played no nights | Retired the same day in `6d78c7e`. CI now runs the campaign dry run over a committed winner. |

**Kept, because they serve the path:**

- the hook's mechanics, `PEDRO-OK` as human-only, and no hook bypass;
- a winner committed in the same commit, `UNTRACKED_WINNER_DEBT`, and
  `test-winners-rebuild.mjs`;
- the seam-slack floor;
- the 3000-seed rule with a held-out block;
- both mistake registers;
- result labels, and device safety;
- the publishing boundary;
- the Cue Helper queue when the phone is absent;
- "a refuted route's next commit is the next route's physical test".
