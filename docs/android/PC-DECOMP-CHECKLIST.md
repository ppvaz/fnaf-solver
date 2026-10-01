# PC 1.033 decomp confirmation ledger

> **Deferred as of 2026-08-20.** PC is not the current project target and this
> ledger is not a blocker. It is preserved for a future port-comparison pass.
> Canonical work now follows [`ANDROID-SOURCE-STATUS.md`](ANDROID-SOURCE-STATUS.md).

This is the archived cross-platform boundary. The executable used by the classic
10/20 community, Minus 7, and brayden's bot is the **PC 1.033 build**. Our owned
decompile is the modern Android release-7 build (Fusion build 296, August 2025).
An Android event proves what Android does; it is only a hypothesis about PC.

## Evidence labels

- **PC-confirmed** — read directly from the identified PC 1.033 event data/code.
- **PC-observed** — repeatable experiment or frame-counted PC footage, but not a
  source-level proof.
- **Community-derived** — attributed reverse engineering of PC 1.033; strong lead
  for locating the event, not a substitute for seeing it.
- **Mod-derived** — read from Shooter25's modified PC build. Useful for locating
  stock-looking logic and reconstructing the practice bot, but not proof that an
  event is unchanged from PC 1.033.
- **Android-confirmed** — read from our Android event sheet. Never silently promote
  this to PC-confirmed.
- **Model-only** — a simulator approximation or calibration value.

No item below is PC-confirmed yet. When a PC decompile becomes available, record
the executable version/hash and extraction tool revision before checking boxes.
Store derived mechanics and event references here; do not commit game assets or
decompiled event dumps.

> **Tooling warning (2026-08-20):** the modern Android runtime may XOR object
> handles with a per-build constant (`OI/COI.loadHeader`; 28 on the owned FNaF
> 2 Android build and 0 on FNaF 1 Android). Shooter25's PC build-295 extraction
> resolves coherently with an effective correction of 0; do not apply Android's
> 28 to it. Any new target still needs its own handle-map sanity check, or object
> names can be silently attached to the wrong events. See
> `ANDROID-SOURCE-STATUS.md`.

## Shooter25-mod coverage

Shooter25's practice executable is the full gameplay event sheet with mod and
bot changes, not a bot-only shell. It therefore contains search targets for
nearly every P0/P1 mechanic below: movement scheduling and routes, camera
stalls and mappings, office gates/queue, BB/Toy Bonnie/Foxy/Golden Freddy,
mask and panel timing, music box, battery, lights, and sound events. Its `#AI`
conditions are visibly spliced into ordinary input groups; see
[`SHOOTER25-BOT-STATE-MACHINE.md`](../in-engine/SHOOTER25-BOT-STATE-MACHINE.md).

No checklist box is checked from that artifact alone. Its base PC version is
not independently established and relevant events may be modified. Because
Android is this project's canonical mechanics target, use the mod primarily
to recover policy and instrumentation ideas; label any mechanical comparison
**Mod-derived** unless an untouched PC executable later confirms it.

## P0 — claims that can change strategy validity

| Done | Mechanic to locate in PC 1.033 | What Android currently says | Why a PC difference matters |
| --- | --- | --- | --- |
| [ ] | Global movement-opportunity scheduler and RNG expression | Every 5000 ms; `Random(20)+1 <= AI`; relevant AI capped at 15 | Changes every survival probability and phase search |
| [ ] | Camera-light stun duration, refresh rule, and target selection | **Android-confirmed (2026-08-20, post-XOR decode):** groups 450-457 load B = `stun time` = 400 frames per flash, home-camera exclusions 8/9/11, Paper Pals gets `400 - 50*night`; the separate look-hold pins Withereds and monitor-up Mangle and persists monitor-down via the parked marker | PC comparison is now about parity (does PC share the 400, the exclusions, and the parked-marker hold?), no longer about rescuing the mechanic |
| [ ] | Complete route graph for all seven stallable characters | Extracted Android routes include invisible transit markers and differ from old community diagrams | Determines camera covers; could reopen or close Six-Seven and other covers on PC |
| [ ] | Display-camera ↔ internal-room mapping | Android mapping is partly anchored and partly route-fitted | A wrong room label invalidates the claimed `10/04/07` cover |
| [ ] | Every per-edge gate: monitor polarity, office-light latch, mutex, and auxiliary counters | Android has `camsUp` finals, Withered Bonnie's inverted final, route-specific `new bonnie` gates, and `chicalookatyou` | These gates are the entire hybrid-strategy search space |
| [ ] | Balloon Boy route, movement chance, pending move, blind-spot entry, and cams-up entry | Android has a 3/4 move chance plus monitor/light-latch conditions | Minus 7's only routine attacker and the worst-luck proof |
| [ ] | Mask-time storage, early-leave rolls, guaranteed-leave threshold, and reset semantics | Android exposes cumulative counters, but the exact object identities/end states are still being decoded | Determines whether every BB attack is mechanically survivable |
| [ ] | Office threshold vs vent opening identities for every character | Android markers 122/123 are shared endgame states; exported object names are misleading | Prevents category errors such as treating a Withered as an ordinary vent camper |
| [ ] | Office queue and forcedown cadence | Android has per-10-second forcedown events for threshold occupants plus immediate monitor-state transitions; full ordering is not yet reconstructed | Brayden/RVC deliberately phase-locks blackouts over Foxy's checks |
| [ ] | Toy Bonnie vent-camera timer, right-vent-light stall, own-blackout sequence, leave rolls, and post-attack immunity | Android confirms a general office-light latch on two route edges and a 40-frame timer reset at one transit marker; this is not yet the PC RVC mechanism | Required to reproduce the 104–1 brayden bot result |
| [ ] | Foxy equation operator, random range, D/J update cadence, D-offset quirk, GOT-YOU arming, and kill gates | Current model combines community PC claims with partial Android confirmation | One frame/operator changes safe flash windows and RVC outcomes |
| [ ] | Golden Freddy office and hallway spawn/kill conditions, including monitor animations | Android has a separate monitor-raise hazard currently represented by a calibrated 18-frame window | Determines safe phase offsets; Android and PC are already suspected to differ |
| [ ] | Music-box capacity, drain/wind rates, and Puppet progression/flash stall | Android: capacity 2000, +300/s wind, night-7 drain 120/s; Puppet can roam | Determines whether a policy has enough resource slack to exist |
| [ ] | Night length and clock phase origin | Android: 60 fps model, 70 s per hour, seven-minute night | All fixed-cycle proofs depend on absolute phase |

## P1 — exact execution and calibration

| Done | Mechanic to locate in PC 1.033 | Android/model value to challenge | Why it matters |
| --- | --- | --- | --- |
| [ ] | Monitor up/down animation lengths and the exact frame state flips | Android model: 12 frames up, 22 down | Entry gates and Golden Freddy windows |
| [ ] | Mask on/off animation lengths and input acceptance | Android model: 12 frames on, 15 off | BB recovery budget and grading tolerances |
| [ ] | Post-mask flashlight lockout | Community PC claim: 16 frames; not modeled | Brayden's mask-off → Foxy-flash beat |
| [ ] | Hall-light physical hold vs scheduler-latched logical state | Android distinguishes immediate `white button` from one-second `new bonnie` latch | Short taps must not become a fake full second of Foxy exposure |
| [ ] | Whether either vent light consumes flashlight battery | Android event sheet decrements the shared battery while `white button` is active; confirm how vent widgets feed it | RVC battery viability |
| [ ] | Flashlight capacity and warning thresholds by night | Android: 3000 frames from night 5; blink at 500 | Full-night execution slack |
| [ ] | Input simultaneity/order within one Fusion tick | Android touch objects may not match PC mouse/keyboard event ordering | Flash-through-blackout and mask/monitor chords |
| [ ] | Sound-cue emission frames (vent bang, laugh, static, blackout) | Simulator cues are abstractions | Reaction-window training accuracy |

## P2 — ports, edge cases, and completeness

| Done | Question | Current lead |
| --- | --- | --- |
| [ ] | Does PC have Android's roaming Puppet route? | Likely port divergence; verify rather than assume |
| [ ] | Which vent does Mangle use, and are route directions platform-specific? | Android appears opposite some PC documentation |
| [ ] | Does the first/opening camera differ on Night 7? | Android changes it |
| [ ] | Are early-night AI tables and hourly escalations identical? | Android tables extracted; trainer mostly targets Night 7 |
| [ ] | Are scheduler events phase-shifted by pause, blackout count, lag, or frame skips? | Community reports a Foxy D-offset quirk on PC |
| [ ] | Which behaviors changed between PC 1.0 and 1.033? | Strategy history mentions obsolete pre-patch play; compare only after 1.033 is established |

## Revalidation protocol

For each checked item:

1. Record PC version/hash, frame, group/event number, object identity, conditions,
   actions, and timer units in a private extraction notebook.
2. Add only the derived rule and a compact event reference to this ledger.
3. Add a minimal deterministic regression in `packages/source/test/simtest.ts` (or a focused
   test) before changing the simulator.
4. Label the implementation `PC-confirmed`, `Android-confirmed`, or an explicit
   platform branch. Do not merge two ports into one rule merely because both
   produce plausible win rates.
5. Rerun Minus 7 controls, worst-luck BB, route-cover search, gate search, and the
   Brayden diagnostic. A simulator result becomes evidence only after the mechanic
   it exercises has cleared this ledger.

## What remains open today

- **Minus 7 itself is real on PC** because humans have completed it and the strategy
  has independent community validation. Our claim that `10/04/07` is the unique
  robust minimal cover is currently an **Android route-graph theorem**, not a PC
  decomp theorem.
- **Six-Seven is refuted for Android.** It remains unsupported—not revived—for PC
  until the PC route graph is extracted. Lack of PC source is not positive evidence
  for it.
- **Brayden's 104–1 result is a PC behavioral calibration target.** A mismatch from
  the Android-backed simulator diagnoses a platform/model gap; it does not refute
  the strategy.
