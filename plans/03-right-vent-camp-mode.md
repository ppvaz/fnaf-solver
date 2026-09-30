# Trainer mode: right vent camp

**Status:** research done — see `VENT-CAMP-STRATEGY.md` (2026-08-19). Implementation
not started. Do after plan 02 — it reuses the strategy-picker work.

**Engine sourcing: DONE (2026-08-24).** Work item 1 is complete. §4 gaps 1-7 were
decoded in the 2026-08-20 sweep; the four that were still unmodelled are now
implemented and asserted in `packages/source/test/sourcetest.mjs` (118 -> 130 cases): the
post-mask flash lockout (gap 6 — `mask` reaches 0 only when the mmaskOff
animation ends, g10/g11, and Foxy's reset runs through it via g489 -> g745),
the `in danger` gate on every light (g75/g76/g77, g83/g88), the per-frame vent
light re-test that makes a held vent light die on the mask (g299 + g301/g303/
g320), and the mask press needing `being attacked by` = 0 (g267/g270). See
`ANDROID-SOURCE-STATUS.md` "2026-08-24: `mask = 0` means the animation, not the
press". Implementing gap 6 retimed the Minus 7 cycle — the old table's hall
flash never lit — so `DEFAULT_CYCLE` was re-derived by `cyclesearch`.

Items 2-5 (the reactive coach, the decision table, the lesson ladder, the
grading tests) are untouched. The "Engine risk" section below is now answered
for the vent/mask/light path; post-chokepoint routing remains the approximation
it always was.

**Research verdict:** teach **brayden's 2024 timer strategy**, the lineage's end
state — it is far more clock-anchored than this plan assumed. The reactive-coach
redesign shrinks to grading a four-way decision fork on monitor-down plus Toy Bonnie
episodes; the rhythm lane carries the rest. The RNG premise below stands (~99%
win rate under perfect play, bot-measured 104–1 — a calibration target for the sim).
The Foxy cadence conflict is resolved (doc §2/§4 gap 1): equation checked at 5 s,
GOT-YOU kill executed at 10 s or on a hall flash, blackout-gated — and the engine
already implements both halves. Remaining gaps are §4 items 2–7 plus the residual
Foxy nuances listed in gap 1.

## Goal

Right vent camp as a trainer mode. This is the pre-Minus 7 classic: reactive play built
on watching/listening and conditional mask decisions, not a fixed input loop.

## Why it's a design change, not just data

The current coaching model assumes a fixed timeline: the rhythm lane scrolls scripted
inputs toward a hit line, offsets are measured from a `:X2`/`:X7` anchor, grading is
"how late was this scripted input." Vent camp has no script — it has *situations* and
correct *responses*. Two structural consequences:

1. **A second coaching mode is needed:** reaction prompts and decision grading
   (did you mask for the right animatronic, was the reaction inside the window)
   instead of beat grading. The lane either gets a reactive variant or is replaced by
   a different display for this mode.
2. **Losable RNG breaks the trainer's core premise.** Minus 7 has no unwinnable rolls,
   so every loss is a mechanical mistake and pass/fail is meaningful. Vent camp can
   lose to RNG played perfectly. Pass criteria must change: grade the *decisions*, not
   survival — a death after correct play is a pass, a survival after a wrong mask call
   is flagged.

## Engine risk

Vent camp makes currently-approximate mechanics load-bearing: post-chokepoint routing
(explicitly an approximation today — Minus 7 never lets anyone get that far), vent
light behaviour details, and any `[CALIBRATED]` constants on the vent/mask path. These
need proper sourcing (plan 01 flags them) before the sim's verdicts can be trusted.

## Work

1. Source and implement the engine mechanics the strategy doc flagged; promote the
   relevant constants to `[SOURCED]`.
2. Design the reactive coach: situation detection, expected response, reaction window,
   decision grading, and how mistakes are replayed/explained.
3. Encode the strategy's decision table; lesson ladder that introduces one situation
   class at a time.
4. Simulate to characterise (not prove) it: loss rate over seeds under perfect play,
   so the trainer can tell the player what "good" looks like statistically.
5. Tests: decision-grading unit tests, seeded scenario tests per situation class.

## Done when

Vent camp is playable through its ladder, grading is decision-based with RNG deaths
not counted as failures, the load-bearing mechanics are sourced, and the README
explains how this mode's premise differs from Minus 7's.
