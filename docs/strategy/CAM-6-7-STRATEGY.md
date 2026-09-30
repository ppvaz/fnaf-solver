# FNaF 2 10/20 — Six-Seven Strat

### Simulator-derived research result (plan 05), 2026-08-19

> **Status: REFUTED by the decompile, 2026-08-19 (same day).** The validation
> gate this document demanded was cleared the hard way: the Android build was
> decompiled, the real route graph was extracted from the Office-frame event
> sheets, and the simulator was rebuilt on it (commit `eea7afd`). Under the
> sourced graph **no two-camera cover exists** — Withered Freddy's actual
> route runs through Game Area and two off-camera transit rooms that CAM
> 06/07 never see, and the modeled routes this strategy stood on were wrong
> in exactly the way the "What is still unproved" section feared. The
> strategy search over the sourced graph finds three minimal three-camera
> covers, of which only **4-7-10 — Minus 7's own flash loop — survives
> clean**. Six-Seven's death independently re-derived Minus 7 from source.
>
> The document below is preserved as written, as a record of a sim-derived
> candidate that was correctly quarantined until validation and did not
> survive it. The name is hereby freed for the next candidate worth memeing.

## Names

- **Six-Seven Strat** — primary name; the memorable community-facing name.
- **CAM 67** — compact codename, referring directly to the two-camera loop.
- **Deep 7** — descriptive alternate: it stalls the same seven animatronics as
  Minus 7, but catches them deeper in their routes.

All three names currently mean the same **untested, sim-derived CAM 06/07
candidate**. They must not be presented as a proven strategy until the validation
gate below is cleared.

## The candidate

Keep Minus 7's safe office half, but replace its three early chokepoints with the
unique two-camera cover of the modeled route graph:

> cams down → mask flick → flash hall → cams up → **CAM 06 → CAM 07** → CAM 11 → wind

Run it on every `:X2` / `:X7` anchor. The generated frame table is reproducible with
`node tools/strategysearch.mjs` (removed 2026-09-24; restore it from the tag in [`../ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)). This report uses 06 then 07 as the canonical order;
reversing the two is effectively identical in the simulator.

The graph argument is compact:

- CAM 06 (Right Air Vent) catches **Toy Bonnie, Withered Chica and Mangle**.
- CAM 07 (Main Hall) catches the remaining modeled routes: **Withered Bonnie,
  Withered Freddy, Toy Chica and Toy Freddy** (and can catch Mangle earlier).

This is not another timing tweak to Minus 7. It deliberately lets animatronics travel
deeper into the building and stalls them immediately before the office-side routes.
It removes one camera selection and one flash from every five-second cycle.

## Search and simulator result

`tools/strategysearch.mjs` enumerates every minimal set cover of `STALLED`, excludes
CAM 08/09 from the grounded pool because their starting-room occupants are normally
flash-immune, permutes each cover, and drives every order through the same Balloon
Boy-aware bot used to validate Minus 7.

The current route table has five minimal grounded covers:

- `02/03/07`
- `02/04/07`
- `04/07/10` (the Minus 7 set)
- `04/07/12`
- `06/07` — the only two-camera cover

For the Six-Seven Strat's CAM 06 → 07 order:

| Check | Result |
|---|---:|
| Clean seed sweep | **200 / 200** |
| Worst-luck sweep | **100 / 100** |
| Minimum music box | **41%** |
| Minimum flashlight power left | **1,830 / 3,000 frames** |
| Uniform jitter through 167 ms | **200 / 200** |
| Uniform jitter at 200 ms | **53 / 200 (27%)** |
| Uniform jitter at 250 ms | **1 / 200** |

The hard lateness ceiling is therefore unchanged from Minus 7 (167 ms), but the
candidate has more resource slack and a somewhat fatter failure tail. The important
result is structural, not the tail: two camera flashes cover the model instead of
three.

## What the sources support

The broad idea is mechanically plausible:

- The decompile-derived Technical-FNaF flashlight page says a camera-light hit makes
  an affected animatronic completely unable to move for 6.66 seconds, resets that
  timer on another hit, and queues a successful movement until the stun ends. Its
  listed exceptions are the Withereds in Parts/Service, the Toys on the Show Stage,
  and Mangle in the Prize Corner — not CAM 06 or CAM 07.
- The documented Right Air Vent occupants are Toy Bonnie, Withered Chica and Mangle,
  exactly the CAM 06 partition used above.
- Published route material places the other relevant characters in CAM 07, and the
  Technical-FNaF strategy table already treats camera-light stalling of Toy Bonnie as
  the property that makes the known zero-RNG strategies possible.

Sources:

1. Technical-FNaF Wiki — [(Fnaf 2) Flashlight Mechanics](https://technicalfnaf.fandom.com/wiki/%28Fnaf_2%29_Flashlight_Mechanics.)
2. Five Nights at Freddy's Wiki — [Right Air Vent / CAM 06](https://freddy-fazbears-pizza.fandom.com/wiki/Right_Air_Vent)
3. TechnicalFNaF route discussion — [Movement in FNaF 2](https://www.reddit.com/r/technicalFNaF/comments/1ehqri8/)
4. TechnicalFNaF discussion of Toy Bonnie's CAM 06 timer — [Toy Bonnie seems to come out of nowhere](https://www.reddit.com/r/technicalFNaF/comments/1rd9p3n/)

## What is still unproved

This is where the candidate can fail in the real game even though it is perfect in
the simulator:

1. **Toy Bonnie's CAM 06 transition is special.** Community reverse engineering
   describes an 8.33-second timer from CAM 06 into the blind spot, affected by camera
   state and the right vent light. The simulator instead gives him the same global
   five-second movement opportunity and generic stun handling as everyone else. We
   need to prove that repeated camera-light stuns reset or suspend that special timer.
2. **The route table is approximate and partly wrong.** Toy Bonnie's actual route has
   more rooms than `STALLED`; Withered Freddy can revisit CAM 07 / CAM 03. The set-cover
   property appears to survive those corrections, but the engine has not simulated
   their real transition code.
3. **Late-room edge cases are absent.** Forced monitor-downs, same-interval queued
   moves, image/state priority, and characters sharing CAM 06/07 may interact in ways
   Minus 7 avoids by freezing everyone one move from their start.
4. **Platform transfer is unknown.** The trainer targets Pedro's Android copy. Its
   animation and interval behavior have not been extracted, and mobile routes/timing
   are not safe to assume identical to PC 1.033.
5. **Novelty is unproved.** Searches for a CAM 06/07 or two-camera
   flash strategy found no published match, and it is absent from the Technical-FNaF
   strategy table. That is evidence of no obvious prior art, not proof nobody has
   tried it.

## Real-game validation protocol

Before building a trainer mode:

1. On a nonlethal/low-AI setup, let Toy Bonnie reach CAM 06 and flash it once per five
   seconds for long enough to prove he never enters the blind spot. Repeat for Mangle
   and Withered Chica.
2. Run the Six-Seven Strat (CAM 06/07) on 10/20 and record the first escape,
   including the character, clock
   digit, selected camera and whether the flash visibly registered.
3. If an escape occurs, inspect that exact transition in the owned Android decompile;
   update the engine before changing the routine.
4. Only after repeated full-night clears should this become a trainer mode. Until
   then its honest label is **sim-derived experiment**.

Further derivation beyond full camera covers is tracked in
[`plans/archive/06-hybrid-strategy-search.md`](../../plans/archive/06-hybrid-strategy-search.md). Its first
gate-aware pass is now complete: CAM 06-only “Minus Right” scored 0/150, CAM 06+07
as a reactive hybrid also scored 0/150, and the full post-mortem is in
[`GATE-SEARCH.md`](GATE-SEARCH.md).

**Minus 6 (2026-08-20): also refuted.** The last revival idea — keep the
06/07 cover and *tolerate* the one uncovered route through the sourced office
encounter — scored 0/200 (`node packages/propose/bin/minus6test.mjs`). Post-XOR correction
along the way: the route 06/07 never sees is Toy Freddy's, not Withered
Freddy's as the pre-XOR refutation above phrased it; W. Freddy is held at
CAM 07. The covered six never broke the stall — Toy Freddy's encounter
traffic (5 s of forced cams-down per visit, every ~25-30 s) leaked the others
past the single CAM 07 choke into the blind left tail. Details in
[`GATE-SEARCH.md`](GATE-SEARCH.md).
