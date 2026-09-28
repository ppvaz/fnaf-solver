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

**First experiment retained (2026-09-28 UTC):**
[generated comparison](../evidence/full06-per-contact-responses-20260928.json),
`recompile-phone-encounters-9efc5551ed385de1`, MODEL_ONLY. The median control
reproduces its retained input rows, clock, draw stream, windows and outcomes.
All three response variants keep window 6 occupied (Chica in the rebuild,
Bonnie in the model; phone empty). They introduce an earlier disagreement at
window 2 and the rebuild dies to Toy Bonnie at 94.3 s, against the phone's win.
The strict mapping observes 85 monitor and 44 mask responses; allowing an
observed prior state after send raises mask coverage to 83, with 39 such cases.
These substitutions are insufficient. Input timing generally remains open:
visible response lag by action, releases, unsupported contacts and the runtime
clock were not identified. The early endpoint is a collective sensitivity,
not a proof across independent contact perturbations. This retains an S2
negative; it does not close S2 or the Observatory's stronger milestone below.

**Second experiment retained (2026-09-28 UTC):**
[phase × rate sweep](../evidence/phone-clock-sweep-20260928.json),
`recompile-phone-clock-sweep-616ca1010c7259f7`, MODEL_ONLY — the milestone's
first ruled-out explanation. Two predeclared grids (coarse ±10 s × ±8 %,
fine −200..+150 ms at 5–10 ms) sweep the two timing references both host
programs share, with each pass's control reproducing the retained replay byte
for byte. No cell of the constant-phase / uniform-rate family reproduces the
phone's occupied windows on any night with a full read: full-06 peaks at 32/42
(presses 50 ms early), window 6 clears on ten scattered cells that each still
disagree on ≥ 8 other windows, and the landscape is chaotic at 5–10 ms. A
corollary bounds the varying-error variant no grid can map: the phone's own
night length on the 6 AM night (420.19 s wall from origin against the
reconstruction's 420.01 s) caps accumulated timer loss — constant, uniform or
bursty — at about 1 s per night, an order of magnitude below the ~4–10 s the
encounter offsets need, since hours and rolls accumulate the same timer. A
shared timing-reference error is ruled out at constant-phase, uniform-rate and
accumulated-loss scales. Remaining upstream families: the per-press input
configuration, or a rule divergence both host programs inherited from the dump.
The physical separator is the S2a same-phase twin; the host-side one is the
eligibility microscope on full-06 window 6.

**Third experiment retained (2026-09-28 UTC):**
[phone hour grid](../evidence/phone-hour-grid-20260928.json),
`phone-hour-grid-20d3c13b0de8a50f`, DEVICE_MEASURED observations; and
[joint reference correction](../evidence/phone-clock-zero-sweep-20260928.json),
`recompile-phone-clock-sweep-0e3154b26906334e`, MODEL_ONLY. Five full-06
interstitials fit a 70 s grid whose zero is first frame +3836.7 ms, +0.7 ms
from anchor fire. full-04 supplies one pre-death transition at +3831.4 ms,
-48.2 ms from fire, too few observations to establish its rate. The host replay
then tested control, clock-zero-only, schedule-phase-only and the joint measured
correction on each traced night. The joint cells fail earlier than their
controls (2/2 compared on full-06; 3/3 on full-04), so this measured clock and
origin correction does not explain the encounter disagreement. The hour-grid
result is an observation about the displayed phone clock; by itself it does
not prove that encounter rolls use the same accumulator.

**Fourth experiment retained (2026-09-28 UTC):**
[full-06 response-bracket family](../evidence/phone-input-bracket-20260928.json),
`recompile-phone-input-bracket-f7147f352c9115f7`, MODEL_ONLY. All 29 relevant
mask/monitor contacts through window 6's 1500 ms read have an observed response
bracket. Twenty-seven brackets map to a single update; two monitor brackets
admit two updates each, giving four complete combinations. Each preserves
phone windows 0–5 and each still places Withered Bonnie in model window 6. The
mask press that starts window 6 itself maps to update 3864 across both ends of
its bracket. This exhausts the measured mask/monitor response ticks only;
wind and camera/light contacts retain the baseline timing mapping, and contact
releases shift with their press rather than receiving independent response
measurements.

The model's internal state shows Bonnie at the ventL opening from update 3627;
his office encounter starts at update 3840, 24 updates before window 6 at 3864.
At that window the response-ready recompile reads Chica, the model reads
Bonnie, and the retained phone eyehole read is empty. Their draw stream had
already split at update 205 under response-ready inputs and update 904 under
the primary landed control. That makes the remaining host question concrete:
compare Bonnie's route eligibility and encounter start in the rebuild against
the model, around the earlier draw split. The same-phase phone twin with a
valid seed and per-press landing reads remains the physical separator; S2
stays open.

## Contributions beyond FNaF

The broader candidate contributions are a benchmark for agents earning causal
explanations under imperfect observation/actuation; a three-implementation
diagnosis method with explicit shared assumptions; and executable evidence
discipline that turns observed inferential mistakes into checks. The latter
already exists as engineering; a research claim needs comparative validation.
The benchmark and autonomous discovery claims remain to be demonstrated.

Their components have precedent: [LearnLib black-box checking](https://link.springer.com/article/10.1007/s11334-019-00342-6),
[Csmith differential testing](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf),
[causal diagnosis of simulation gaps](https://proceedings.mlr.press/v229/huang23c.html),
and [The AI Scientist](https://arxiv.org/abs/2408.06292). The novelty hypothesis
concerns their demonstrated combination and results, not invention of those
fields. A focused literature comparison does not establish priority.

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
