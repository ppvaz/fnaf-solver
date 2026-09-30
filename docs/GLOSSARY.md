# Glossary

These are the names a new reader should use. The same vocabulary is exported
from [`packages/source/src/clockwork/vocabulary.js`](../packages/source/src/clockwork/vocabulary.js)
so prose, policies, artifacts, and device profiles can share one meaning.

Physical bindings below are quoted from the current Moto g56 profile. They are
that profile's values, not constants: a different handset means a new
calibration, and a changed binding means a new qualification.

| Term | Meaning |
|---|---|
| **Android target** | `com.scottgames.fnaf2` v2.0.7, release-7 / Fusion build 296; the only device target this project claims. |
| **actuator** | The component that sends a semantic control to the game. It may be simulated, fixture-backed, ADB-based, or HID-based; it does not prove that the game accepted the input. |
| **camera feed** | The selected camera view shown after raising the monitor. |
| **camera selection** | A semantic `cam:N` control, such as `cam:9`; it changes the selected feed and is distinct from flashing that feed. |
| **cameraFeedLight** | The physical camera-feed flash control. On the current Moto g56 profile it is `{900,540}`, the calibrated cam-flash/hall-flash intersection position. |
| **hallLight** | The physical standalone office/hall beam control. On the current profile it is `{1200,540}` and is intentionally distinct from `cameraFeedLight`. |
| **leftVentLight / rightVentLight** | The actual office vent-light controls, not camera flashing. The left control is `{350,615}` and the right control is `{2050,615}` on the current profile. |
| **wind** | The music-box winding control. The short name is retained because it is the game's established action; it never means a flashlight or vent light. |
| **mask** | The Freddy mask transition control. |
| **monitor** | The camera-monitor raise/lower transition control. |
| **model `light`** | A simulator-only, source-faithful context-dependent action: camera flash while the monitor is up, hall flash while it is down. It must not be used as a modern physical profile name. |
| **artifact** | A content-addressed, validated semantic handoff for one or more device-night plans. It contains no strategy reconstruction or raw coordinates. |
| **device profile** | The versioned physical binding from canonical semantic controls to screen points, plus actuator/sensor calibrations. |
| **bundle** | The host-built package containing the selected winner, plans, resolved profile, manifest, replay data, and compiled artifact. |
| **plan** | A finite timed schedule before compilation; it names semantic controls and timing, not HID reports or screen coordinates. |
| **winner** | A model-gated policy record whose strategy, knobs, engine hash, seed set, and claim level are bound together. |
| **binding** | One named, hashed winner as it was actually flown: its knobs, its anchor aim, and the bundle built from it. Bindings are lettered per night (`h`, `k2`, `c2`) and a winning one is committed as `tools/device/campaign-night<N>-<name>-winner.json`. |
| **anchor** | The measured release instant that places a whole schedule against the game's own 5000 ms movement-roll grid. A run without an anchor has an unmeasured phase, not a default one. |
| **seed** | The deterministic RNG input for one simulator replay. A seed result is model evidence, not a device result. |
| **qualification** | Evidence authorizing a particular actuator/profile/policy boundary for a stated claim level; changing physical control bindings requires a new qualification or rebind. |
| **claim level** | `MODEL_ONLY`, `FIXTURE`, or `DEVICE_MEASURED`; higher levels require their own evidence and do not inherit from lower levels. |
| **device-measured** | A claim supported by a real stock-device observation under the named profile and calibration, not merely by a successful model replay. |
| **desync** | The controller's believed monitor/mask state no longer matches the game's observed state; open-loop parity must not be treated as truth after this point. |
| **arm verification** | The opening check that confirms the required camera highlights/viewing state before the timed night loop is allowed to continue. |
| **Mangle marker 122 / opening** | The sourced intermediate Mangle state at the office entrance. A monitor raise after she reaches it can move her inside; it is not the same as an already committed attack. |
| **rung** | The Plan 12 evidence level a run advances. A complete model gate or host-side refactor is not a 6 AM device success. |
| **consequential artifact** | For this project, a graded on-device run bundle, real device evidence, a promotion, or trainer code. Plans, docs, and host-only gates are bookkeeping until paired with that evidence. |

## Names that are not synonyms

The old spellings `light`, `hall`, `ventL`, `ventR`, and `ventl` may still
appear in simulator or historical compatibility code. They are not synonyms in
the modern device vocabulary: in particular, `ventl` must never silently mean
the physical `leftVentLight`, and the simulator's `light` must never silently
choose between `cameraFeedLight` and `hallLight` at the profile boundary.

## Evidence labels

`[SOURCED]`, `[CALIBRATED]`, `[INFERRED]`, and `[MODEL]` say where a number came
from, and a rule enters the simulator only when it earns one. `UNKNOWN` is the
value for a missing or ambiguous measurement; it is never replaced by a
plausible default. See the [documentation index](README.md) and the
[evidence policy](evidence/README.md).
