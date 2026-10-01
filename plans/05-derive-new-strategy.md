# Derivation, tiers 2–3: a structurally new strategy

**Status:** reopened 2026-08-28 for a second, broader invention campaign. The
first pass remains complete: it found the **Six-Seven Strat** (also **CAM 67** /
**Deep 7**) in the old model, and the subsequently extracted Android route graph
refuted CAM 06/07 as a full cover because several routes cross off-camera transit
markers. `CAM-6-7-STRATEGY.md` remains a derivation record, not an awaiting
candidate. What changed is the research substrate: the Android model, exact RNG,
negative controls, 1200-seed gates, policy probes and dominance-pruned search
methods are now sufficiently sourced to support a genuinely new search language.
The reopened work must not rerun the closed static-cover or three-phase grids.

## Goal

Derive a 10/20 strategy structurally different from Minus 7, using the simulator as
the fitness function. Stretch goal (tier 3): one that is new to the community, not a
rediscovery.

## The idea

The chokepoint comment in `src/config.js` is the seed: the three-camera loop works
because every stallable route passes through CAM 10/04/07 one move from its start
room. That is a graph property, and alternatives can be enumerated:

- different camera covers of the route graph (other chokepoint sets, other cadences),
- hybrid schemes — deliberately let specific animatronics past their chokepoint and
  handle them with mask/vent light instead of stalls, stall the rest,
- schemes that trade stun coverage for slack elsewhere (fewer flashes per cycle).

Search: enumerate candidate structures from the route graph, compile each into a cycle
script (or decision table), evaluate with the plan 04 harness — seed sweep, worst-luck
sweep, jitter curve.

## Prior art (searched 2026-08-19)

No public project uses machine learning — or any automated search — to *derive* FNaF
strategy. What exists:

- Screen-automation bots with hand-coded strategy:
  [kevvit/fnafbot](https://github.com/kevvit/fnafbot) (FNaF 1 Night 7, sprite matching
  + scripted responses) and
  [kalebwbishop/FNAF_Bot](https://github.com/kalebwbishop/FNAF_Bot) (FNaF 1 4/20 —
  uses a CNN, but only for recognising animatronics in camera feeds; the strategy is a
  fixed hand-coded sequence). ML as eyes, never as the strategist.
- The closest methodological precedent: Shooter25's in-game bot mod (2024) plays
  brayden's strategy perfectly to *measure its consistency* (104 wins / 1 death —
  see `MINUS-3-STRATEGY.md` §4). Hand-coded execution of a human-derived strategy;
  the same remove-the-human validation idea as this repo's simulator, but not search
  and not learning.
- All strategy innovation, Minus 7 included, comes from humans reasoning over the
  decompiled mechanics
  ([TheBones5's FNaF 2 AI breakdown](https://steamcommunity.com/sharedfiles/filedetails/?id=2996224710),
  the [10/20 guide videos](https://www.youtube.com/watch?v=FizTzjyGP3U),
  the [Max Mode list](https://sites.google.com/view/maxmodelist/main-list/ml-primary)
  community).

Two conclusions baked into this plan:

- **The niche is open.** Simulator-driven strategy search over the known mechanics has
  no published precedent, which raises the odds a survivor here is genuinely new —
  though the novelty check against the plan 01 meta doc still stands.
- **Search over learning, deliberately.** The mechanics are fully known, discrete and
  low-dimensional — the regime where explicit simulation + enumeration beats a learned
  policy. RL would spend millions of episodes rediscovering what the route graph says
  for free, and a learned policy is a black box that can't be turned into a teachable
  human routine. A trainer needs human-executable scripts, so this plan searches; it
  does not train an agent.

## Online frontier refresh (2026-08-28)

The reopened campaign includes an online novelty check, not just a local-document
comparison. A fresh search found no clearly new post-Minus-Toys structure, but that
is a best-effort result, never proof of absence:

- Shooter25's May 2025 [Minus Toys guide](https://www.youtube.com/watch?v=55msMR86BHE)
  credits ZachScream as the inventor and gives the public 10-second loop. A December
  2025 [current guide](https://www.youtube.com/watch?v=48c-YN62rsQ) still presents
  Minus Toys as the leading practical strategy.
- February 2026 player reports document the same load-bearing boundaries the model
  must test: the split CAM 11/CAM 09 state, Golden Freddy five-second intervals, and
  uninterrupted mask time for BB/Mangle. See the
  [Minus Toys discussion](https://www.reddit.com/r/technicalFNaF/comments/1r8oo5a/fnaf_2_minus_toys_strategy/)
  and its [follow-up](https://www.reddit.com/r/technicalFNaF/comments/1rdlstq/fnaf_2_minus_toys_continued_foxy_bbmangle/).
- A 2026 "new 10/20 strat" claim was quickly identified by the community as an
  existing Minus Two routine, with inventor attribution corrected afterward. That
  [rediscovery record](https://www.reddit.com/r/technicalFNaF/comments/1ruafkj/babe_wake_up_new_1020_strat_just_dropped_read/)
  is why package 8 requires mechanic-level comparison and creator/source tracing,
  not name or timing comparison.

The public web remains poorly indexed and video/Discord-heavy. Before any novelty
claim, repeat searches across the original creators, `technicalFNaF`, current guide
videos and the public bot census; record query date and ambiguous matches.

## The honest caveats (write them into any result)

1. **Model coverage.** The engine models the mechanics *Minus 7* depends on.
   Post-chokepoint routing is explicitly an approximation and several constants are
   `[CALIBRATED]`. Tier 2/3 candidates will lean on exactly those parts, so a
   "200/200 seeds" verdict is a verdict about the model, not the game. Every
   candidate's mechanical dependencies must be listed, and the approximated ones
   sourced (plan 01 / plan 03 overlap) before trusting the sim.
2. **Novelty.** A decade of max-mode grinding plus the decompiled game means most
   viable structures are probably known. Expect rediscovery; check every survivor
   against the plan 01 meta doc before claiming anything.
3. **Transfer.** Anything that survives ships as *sim-verified, needs human validation
   in the real game* — and only Pedro can run that validation.

## Work

1. ~~Extract the route graph and enumerate camera covers~~ — done first against
   the original modeled graph in `tools/strategysearch.mjs`; five minimal grounded
   covers, with Six-Seven's CAM
   06/07 the unique
   two-camera cover. Hybrid tanking was unnecessary once a full two-camera cover
   survived, and remains a possible later search branch.
2. ~~Compile and evaluate candidates~~ — done against the original modeled graph;
   Six-Seven passed those historical clean, worst-luck and jitter sweeps.
3. ~~Audit the approximated mechanics~~ — done. The Android extraction added the
   blind transit routes that invalidate the candidate as a full cover; this is a
   refutation for the target build, not a request for more seed search.
4. ~~Compare against documented prior art and write up the result~~ — done; no CAM
   06/07 match found, but novelty is explicitly not claimed.
5. Trainer mode: intentionally not started; the Android graph refuted its candidate.

## Reopened campaign (2026-08-28)

The first five packages above stay closed and auditable. This campaign adds four
mandatory packages; it reopens the goal, not the refuted candidate.

6. **Define the novel-policy language.** Inventory the remaining sourced levers
   and compile policies that can be state-dependent, event-triggered,
   unequal-cadence and cross-cycle. Explicitly include policies outside Minus 7's
   emitted timing geometry: selective route release, intentional office-state
   transitions, controlled blackout cover, split-camera states, and machine-only
   policies that can later be simplified for a human. Exclude exact duplicates of
   the Plan 05 static covers, Plan 06's 125 phase schedules, and Plan 16's Minus 7
   knob search. **Gate:** every observable and transition used by the language is
   cited to the Android source ledger or labeled as a model dependency, and a
   duplicate-policy control proves the old families are rejected.
7. **Run a broad invention search.** Reuse the exact RNG, deterministic replay,
   negative controls, Pareto/dominance pruning and 1200-seed admission gate, but
   search policy structure as well as timings. Optimize survival first and then
   input cost, state memory and human executability; retain machine-only survivors
   rather than prematurely forcing every result into a fixed loop. **Gate:** a
   reproducible frontier plus a recorded account of the structures explored and
   pruned.
8. **Interrogate survivors and invent the strategy.** Trace why each frontier
   member works, minimize it, name its essential mechanic, and compare it against
   the documented public frontier. A candidate is not called novel merely because
   its numeric schedule differs. **Gate:** either one structurally distinct
   candidate with provenance, ablations and novelty review, or an explicit negative
   for this policy language that leaves the overall invention path open to a new
   language.
9. **Cross the model boundary.** Turn the strongest candidate into an auditable
   device or instrumented-build experiment. Stock-APK evidence remains the final
   game-fidelity oracle; Plan 17's in-APK controller may be used to measure a policy
   perfectly before translation to human or external execution. **Gate:** observed
   real-engine evidence for the load-bearing mechanic and an honest promotion or
   rejection record.

## Implementation plan (2026-08-28)

Concrete build-out of packages 6–9, scoped to the Custom Night target. All new
tooling lives in `tools/invent/`, parallel to `tools/minus7/`. Every number this
campaign produces is a statement about the model until package 9 — write "in the
simulator" on all of them.

### Decisions taken (Pedro to override if wrong)

- **Representation: an ordered rule-list plus a small register bank.** A policy
  is `{ registers: N, rules: [{ when: Predicate, do: Action }, ...] }`. Each
  decision tick the interpreter evaluates rules top-to-bottom and fires the
  first whose predicate is true. Chosen over a behavior tree or FSM because it
  is the representation a survivor can be read back from as a human routine
  (the tier-3 goal) and the easiest to ablate rule-by-rule. Phase behaviour is
  expressed with `ticksSince`/`everyN` predicates and a register, not a
  dedicated state machine.
- **Action grain: semantic.** The search interprets a genome into one semantic
  action per decision tick against the exact engine, reusing
  `packages/propose/parked/minus7/sim.ts`'s vocabulary (`MASK_ON`, `HALL_FLASH`, `WIND`,
  `cam:NN`, …). Frame-level lowering through `packages/propose/parked/minus7/policy.ts` happens only in
  package 9. Rationale: the semantic layer searches ~100× faster and matches how
  a human or an in-engine build would act; the device actuator is a
  package-9 concern.
- **Decision tick: the sourced 5 s scheduler tick** (`C.FPS * 5`), with an
  event-driven wake on blackout-start, BB-opening, and Foxy-departure so a
  policy can react inside a cycle. Not every frame — a per-frame genome is
  unsearchable and unlike anything executable.

### Package 6 — the policy language

- **6a. Custom Night observation surface.** `tools/invent/observe.mjs`: extend
  `view()` to all eleven characters (locations/stages, stun timers, committed
  attacks), the two resources, monitor/mask/camera state, and the event flags
  above. Every field carries a one-line provenance tag: a group citation into
  `docs/android/UNIFIED-SOURCED-ENGINE-FACT-INDEX.md`, or `[MODEL]` for an
  approximated one (post-chokepoint routing, vent departures, blackout forcing).
  Cross-check the tagged-sourced subset against Plan 17's internal-state tuple —
  a policy may not read something an in-engine build could not.
  **Gate:** `test-observe.mjs` asserts every field is tagged and that the
  `[MODEL]` set equals the known approximation list (so a new approximation
  cannot slip in untagged).
- **6b. Grammar, genome ops, interpreter.** `tools/invent/policy-lang.mjs`:
  the Predicate AST (observation-field reads, `<`/`<=`/`==`/`>=`/`>`, boolean
  and/or/not, register reads, `ticksSince(event)`, `everyN(period, phase)`),
  the Action set (the semantic vocabulary + register writes), a seeded random
  genome generator, `mutate`/`crossover`, `serialize`/`parse` (round-trip
  exact), and a pure deterministic `interpret(genome, obs) -> action`.
  **Gate:** `test-policy-lang.mjs` — serialize/parse round-trips; interpreter
  purity (same obs → same action, no retained state beyond declared registers);
  and a hand-written rule-list reproduces `packages/propose/parked/minus7/reactive-policy.ts`'s `decide()`
  on a 200-seed sample, proving the language is expressive enough to contain the
  known reactive policy.
- **6c. Duplicate-policy control.** Encode one Plan 05 static cover and one
  Plan 06 phase schedule as genomes; the search's novelty filter must classify
  both as known-family and prune them. **Gate:** part of `test-policy-lang.mjs`.
  **Closed 2026-09-02 against the register, not a local list.** The privileged
  surface classified against its own `KNOWN_FAMILIES` — two families asserted in
  prose — while `packages/propose/bindings/closed-families.json` recorded three with
  citations, so the search pruned against less than the repository knows.
  `tools/invent/closed-families.mjs` now implements the register's rule names
  against a genome, as `packages/propose/bin/policy/closed-families.ts` does against an
  observation-language program: one register, two interpreters, and the gate
  fails if the register names a rule this surface has not implemented. The
  static cover and the phase schedule are now the SAME closure
  (`unconditioned-schedule`, plans 05/06/16) because the frame clock is not a
  game fact, and the two families the privileged list lacked are carried —
  `timing-only-mutation` prunes a retune of the reference policy,
  `audio-anchored-branch` matches nothing here and is checked to match nothing
  for the right reason (no privileged read has an audio counterpart).

**Partial delivery against a different surface (2026-09-02) — package 6 stays
open.** ROADMAP B1 needs the language to range over facts *the controller can
observe within its measured budget*, which is the `Observer` surface, not 6a's
privileged Custom Night view of `Sim` internals. What landed for that surface:
`packages/propose/src/policy/observation-language.js` (the measured per-fact
observation budget, with all four audio facts `UNKNOWN` and excluded, and the
host round trip `UNKNOWN`), an observation-conditioned branch construct in
`packages/propose/bin/policy/policy-grammar.ts`, and a mechanical duplicate control in
`tools/device/closed-families.{json,mjs}` that classifies any unconditioned
schedule into the family Plans 05/06/16 closed by recorded negative. That
satisfies 6c's intent for the branch language and none of 6b's: there is no
rule-list/register genome, no `serialize`/`parse` round trip, and no proof that
the language contains `packages/propose/parked/minus7/reactive-policy.ts`'s `decide()`. The two
observation surfaces are disjoint in privilege and the plan must say which one
the campaign searches before 6b is written. See `plans/PROGRESS.md`
§"Plan 05 — Custom Night invention campaign", 2026-09-02.

### Package 7 — the search

*Superseded 2026-09-25 ([`ROADMAP.md`](ROADMAP.md) gate table): the 1200-seed
admission gate below predates the project's 3000-seed rule; a survivor is
admitted at 3000 seeds and confirmed on a held-out block, and the search now
feeds step S3, a census over policies.*

- **7a. Harness.** `tools/invent/search.mjs`: rollout = `interpret` →
  semantic action → exact engine, seeded like `packages/propose/parked/minus7/search.ts`.
  1200-seed admission gate reused verbatim. Pareto front over
  (survival ↑, input count ↓, registers ↓, rule count ↓). Negative controls:
  the empty policy and a random-genome baseline run every generation so a
  "solved" claim always has a floor beside it.
- **7b. Targets and difficulty probes.** `tools/invent/targets.mjs`: the ten
  single-threat vectors (`{ <dial>: 20 }`), then a pair set pruned to
  interacting pairs (drop a pair when the two single-threat survivors compose
  without new deaths). Each target first gets a difficulty probe — empty-policy
  and reactive-baseline (`minus7/policy.mjs` `decide`, adapted) survival over
  1200 seeds. A target the reactive baseline already clears >95% is recorded as
  "no invention needed" and skipped. **This is the first real check-in point:**
  if reaction clears every single-threat vector, the campaign moves straight to
  pairs/triples and says so.
- **7c. Run.** Per non-trivial target: search, record the frontier and a
  pruning log (structures tried, why each was dropped). **Gate:** a reproducible
  frontier file per target plus the log.

### Package 8 — interrogate and name

Per frontier survivor: ablate each rule (measure the survival delta), drop
rules with zero delta, name the essential mechanic, and run the novelty review
from the "Online frontier refresh" section (record query date, creators,
`technicalFNaF`, current guide videos, bot census; a numeric-schedule
difference is not novelty). **Gate:** per target, a structurally distinct named
policy with provenance + ablations, or an explicit negative.

**The ablation instrument landed 2026-09-02; the package stays open on naming
and novelty review.** `tools/invent/ablate.mjs` drops each rule, measures the
survival delta, and minimizes to the rules that carry it — proving the drop by
re-measuring rather than assuming the inert rules were independent, and falling
back to one-at-a-time removal under an explicit budget when they are not. It
exists because package 7c's degenerate candidate cleared both duplicate
controls: its branches read observations, so the syntactic control passed it,
and they fire on 2.3–2.5% of decisions, above the declared 1% branch floor. The
new verdict `no-load-bearing-rule` reaches that case by measurement instead of
by raising a threshold until it gave the wanted answer. `campaign.mjs` now runs
it on every frontier entry at the admission cohort (`--ablate=N`, `0` disables)
and the artifact travels with the frontier. First result, and it is about the
BASELINE rather than a survivor: on the `bb` single-threat target at 60 seeds,
only **4 of the reference policy's 16 rules** move survival at all. That is a
statement about that target and that cohort, not about `decide()` on Night 7.

**The box interrogation closed the naming and novelty review for the two bb
frontiers, and both are recorded negatives (2026-09-02).**
`tools/invent/box-anatomy.mjs` measures the axis `death-anatomy.mjs` cannot:
the music box. Pedro's ruling — holding the monitor down to keep Balloon Boy
out is NEVER viable as a strategy, because there is ALWAYS a box to be wound;
admissible only as an endgame cutoff once remaining charge provably outlasts
the night — is encoded as a measured verdict, not an assertion. At 300 seeds
per target (`box-anatomy-bb{,+foxy}.json` beside the frontiers):

- Both winners spend **zero wind decisions**. The box drains deterministically
  (full → empty in 16.7 s, g653-660), and every death and every win is the
  AI-0 escape ladder (g494-497: 3 stages then hops at 5%/s, then the 1-in-10
  office roll): march p50 ≈ 165 s, p90 ≈ 240 s, max observed ≈ 370 s against a
  403.3 s residual. Deaths are Puppet 298/300 and 299/300; all three wins had
  the box EMPTY at 6 AM with the Puppet already out mid-hop. The frontier
  rates are P(ladder outruns the residual), a dice race — no cutoff banked.
- One mechanic, two clothes: the **frozen office**. `press('cam:NN')` selects
  only while the monitor is already up (plant-model.js:330), so SWEEP's cam
  presses are refused monitor-down and its light presses land as HALL-LIGHT
  pulses — the bb winner is a mis-compiled hall flasher. Neither genome ever
  raises the monitor (0 monitor-up frames), which freezes BB at his
  monitor-gated final hop (g417; 0/300 openings, 0/300 inside) and lets the
  pulses pin Foxy's D below the fire band at every 5 s roll (0/300 locks;
  bb+foxy max D ≈ 12-16 with the roll instant zeroed, bb drifts to ≈ 27-30 in
  Parts while pinned in the hall).
- **Novelty review, queries dated 2026-09-02:** BB's monitor-gated entry and
  the "close enough to 6 AM" escape are prior public knowledge (FNaF wiki BB
  pages, Steam discussions — the same shape as the measured luck race), and
  the only music-box challenge found keeps the box ABOVE 50% (a YouTube
  self-imposed run), the opposite of refusal. No public strategy proposes
  full-night monitor refusal, consistent with the ruling: the box forbids it.
  Nothing here is claimed as novel and nothing is promotable.
- **Harness consequence:** `rollout()` counts `windDecisions` and every
  frontier entry now self-declares `boxPosture` (`winds` | `box-refusal`) —
  an annotation retained beside the entry, never a silent prune. The gate for
  a future bb/bb+foxy claim is now concrete: a wind-bearing genome that keeps
  the box charged through the measured cutoff (~403.3 s frame-exact on a full
  box), which necessarily raises the monitor (CAM 11), unfreezes BB, and
  forces the mask game.

### Package 9 — cross the boundary

Take the strongest survivor across targets, lower its semantic actions to
frame-level through `packages/propose/parked/minus7/policy.ts`, run it under `--device-actuator`, and
measure it in Plan 17's in-engine build as the perfect oracle before any human
or device translation. **Gate:** observed real-engine evidence for the
load-bearing mechanic; honest promote/reject in this plan and `PROGRESS.md`.

### Sequencing

6a → 6b → 6c → 7a → 7b (**check in here**) → 7c → 8 → 9. Packages 6 and 7a are
pure infrastructure with no survival claim; 7b is the first point where the
model says something about the game's configuration space.

## Progress log (reopened campaign)

- **2026-08-28 — target chosen, engine unblocked.** Pedro's call: the search
  aims at the **Custom Night configuration space** (systematic single- then
  pair-threat vectors first), where no published human routine exists to
  rediscover. `8694c1b` adds `Sim` `opts.customNight` — an `AI_DIALS` vector
  replacing the night-7 table — plus `peakAi`/`canAct` overloads so a policy can
  ask what a vector arms. `sourcetest.mjs` pins it. This was the only engine
  blocker; Plan 16's search infra (`snapshot`/`restore`, exact RNG, 1200-seed
  gate, dominance pruning) is reusable. The build-out is planned above
  (§"Implementation plan"); next concrete action is **pkg 6a**,
  `tools/invent/observe.mjs` — the tagged Custom Night observation surface. See
  `plans/PROGRESS.md` §"Plan 05 — Custom Night invention campaign".

## Done when

The original pass met its done condition by recording the sourced refutation. The
reopened campaign is done only when a structurally distinct candidate crosses the
model boundary, or when its current policy language is closed by a reproducible
negative and the next materially different language is named. One exhausted grid no
longer makes the invention path dormant.
