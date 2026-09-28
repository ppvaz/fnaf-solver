# FNaF 2 Observatory: the research frontier

**Accepted direction, Pedro, 2026-09-27:** record and push this assessment,
then act on its first experiment. This is a research interface within
[ROADMAP S2](../../plans/ROADMAP.md#s2-fidelity-at-the-level-of-encounters),
feeding S3-S7 as their prerequisites become available. It creates no new claim
ceiling and does not replace the roadmap's dependency order.

## The question that comes first

Which assumption causes a reconstructed encounter that the phone did not show?
Optimise hypothesis separation: prefer an experiment whose possible observations
distinguish competing explanations, rather than one that merely makes a large
phone/model mismatch. A first observed disagreement locates where a difference
becomes visible; it does not establish the first hidden-state divergence.

The [September 27 rebuild comparison](../evidence/rebuild-phone-encounters-20260927.json)
is DIVERGENT on four retained phone nights. On Night 7 `full-06`, window 6 is
empty on the phone, but contains Withered Bonnie in all five rebuild variants.
The model generally shares that occupied window. Replayed inputs and the
Android runtime clock remain competing explanations upstream of both host
programs. An eligibility bug is a hypothesis, not an established cause.

## Priorities

| Order | Direction | Consequence and dependency |
|---|---|---|
| 1 | Causal reconstruction, hidden clocks, system identification | Advance S2 by separating mechanics from input and clock assumptions at a retained encounter disagreement. |
| 2 | Timing topology, adversarial timing, bottleneck resources | Extend existing phase and robustness scans; distinguish whole-schedule phase, per-contact timing, duration and observation delay. Host surfaces remain MODEL_ONLY. |
| 3 | Counterfactuals and active experiment selection | Compare narrowly controlled replay branches, then select a physical experiment that separates their predictions. Validate manual selection before automating it in S7. |
| 4 | Belief estimation, information value, minimal sufficient state | Need credible transition and observation models; numerical posteriors require explicit priors, likelihoods and validation. |
| 5 | Strategy phase transitions, equivalence classes, constraint synthesis | Explore in MODEL_ONLY while S2 remains open. Name the policy family, state/trace projection, timing assumptions and held-out block. |
| 6 | Cross-game transfer, cross-device invariants, autonomous discovery | Cross-game work is already S6. A second handset is required for cross-device claims; autonomous discovery is S7's destination. |

The [Night 7 phase census](../evidence/fnaf2-night7-phase-census-20260925.json)
finds no route-selection benefit from knowing the seed across four bindings and
121 phases. This is scoped to that MODEL_ONLY family. It gives phase and delivery
uncertainty more immediate demonstrated control value than seed identification.

Timing plateaus must retain every disjoint band, the sampling resolution and
the tested perturbation family. A sampled all-win interval is not a worst-case
robustness proof. The [robustness comparison](../evidence/night7-robustness-20260925.json)
also shows that the preset schedule's stronger lateness tolerance does not make
its won epochs deliverable by the current anchor.

## First experiment: full-06, window 6

**Target artifact:** a generated, hash-bound MODEL_ONLY comparison that states
whether replacing the nightly median landing latency with individually observed
landings makes window 6 empty in the rebuild, and what happens in the model on
the same inputs. Reuse the existing replay and scoring contracts.

1. Verify the committed winner, seed, retained press schedule, trace, binary
   and model options against their hashes. Reproduce the median-latency control.
2. Extract individual observable monitor and mask transitions from the retained
   trace, with the preceding positive state and a bounded time bracket. Frame
   visibility is an observation of a response, not Android input dispatch.
3. Substitute only supported landings. Keep unobservable contacts UNKNOWN;
   label any unchanged median-based contact as an assumption and retain coverage.
   Do not infer release acceptance from a press response.
4. Replay on the same clock and compare window 6, the earlier read windows,
   the terminal, and the model/rebuild difference. Bind the result to the exact
   mapping and input hashes; retain a check that re-derives its conclusions.
5. If the mismatch persists, narrow only the input explanation actually tested.
   If it disappears, test sensitivity to the retained landing brackets before
   treating that explanation as supported. Neither result proves equivalence.

A subsequent same-phase phone twin needs a valid seed measurement and per-press
observations under the existing device safety contract. No phone interaction is
required for the first host experiment.

## Five synchronized panes

| Pane | First useful content |
|---|---|
| World | Retained phone observations beside model and rebuild states; unobserved phone transitions are UNKNOWN. |
| Clock | Separate sends, response/landing brackets, captured frames, reconstructed updates and contact durations. |
| Belief | Surviving causal explanations and their assumptions; probabilities only when an explicit inference model supports them. |
| Policy | The committed schedule and each precisely identified counterfactual change. |
| Evidence | Source hashes, observation coverage, claim ceilings and unresolved ambiguities, also visible in every other pane. |

The mechanical microscope can show eligibility, roll, destination, arrival,
entry, occupied window and departure edges in the host programs. The phone
overlay shows only edges it actually observes. Missing occupancy, an unlabelled
occupant and an observed empty window are distinct facts.

**First Observatory milestone:** it supports an experiment that rules out one
named explanation for a retained encounter mismatch. A five-pane interface by
itself does not close a roadmap step. Implementation starts with the experiment
and its evidence; the visualization consumes that result.
