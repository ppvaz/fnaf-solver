# `@sixam/play`

Play is the Embodiment context of [ADR 0002](../../docs/decisions/0002-kernel-contexts-vocabulary.md):
what the campaign executor sends and reads through on the phone. It imports
only `@sixam/kernel`, `@sixam/source` and Node built-ins, and nothing imports
it but `@sixam/propose` and the applications (`tools/architecture-test.js`).

| Folder | What it holds |
|---|---|
| `src/campaign/` | The campaign executor, moved from `apps/device`: the artifact and device-local executors, the HID schedule and device shell, the control-effect grader, the adb bridge and physical ports, the campaign state machine, runner, proof, preflight, bundle and composition, the custom-night procedure, the night anchor, the timed start and the venue bindings. `modern-campaign-ports.js` is the one module here that composes the HID transport. `@sixam/play/campaign/<name>`. |
| `src/coach/` | The teach feed the Companion's panel narrates (`cycle-lesson.js`). `@sixam/play/coach/<name>`. |
| `src/venues/phone/` | The phone's transports: the HID wire (`hid.js`), the Cue Helper control protocol (`cue-helper.js`) and the Companion status record (`companion-status.js`). |
| `src/phone/` | Clocks and clock maps (`clocks.js`), night-onset detection (`night-onset.js`), the pan-aware control anchor (`control-anchor.js`), control exclusion (`control-exclusion.js`) and the venue parser (`android-venue.js`). |
| `src/venues/sim/` | The Sim venue's observer: what a player could see, sampled at the device cadence (was `@sixam/core/sensing`). `@sixam/play/sim`. |
| `src/player/` | The player's belief and estimator, unknown-safe (was `@sixam/core/estimation`). `@sixam/play/player`. |
| `src/clocks/` | The Plan 21 winding-tick phase clock and its estimator (was `@sixam/core/timing`). `@sixam/play/clocks`. |
| `src/sensors/fnaf2/` | **Deprecated.** The FNaF 2 grid/luma readers the executor still consults: the monitor, camera and calibration-state rules and the button strokes. |
| `test/` | Their tests and the `dumpsys package` fixtures, in the root `test:contracts` lane. |

Public API: `src/index.js` (the export set `@sixam/adapters` had) and the
subpaths `@sixam/play/venues/phone/<name>`, `@sixam/play/phone/<name>`,
`@sixam/play/sensors/fnaf2/<name>`, `@sixam/play/sim`, `@sixam/play/player` and
`@sixam/play/clocks`. The Sim observer, the player and the clocks keep core's
host-global rule (no DOM, process or wall clock); `tools/belieftest.mjs`,
`estimatortest.mjs`, `phaseclocktest.mjs` and `reactivetest.mjs` test them.
`packages/core/src/sensing/index.js` stays as a shim over `@sixam/play/sim`
for `tools/device/minus-toys-plan.mjs`, whose bytes every Minus Toys bundle
hashes (`core.sensing-shim`).

**The campaign.** `CampaignStateMachine` (`src/campaign/campaign.js`) is the
lifecycle seam above the executor. It requires positive menu and intro
identity, records bounded attempts, treats unknown observations as `HOLD`,
advances story Nights 1 through 5 through their night-specific save/roll-through
proof, advances Night 6 after a verified save cursor or newly visible Custom
Night item, and advances Night 7 after all ten 20 dials plus Puppet 15 are read
back and the return to the menu is observed. `AdbDeviceBridge` supplies the
read-only discovery/preflight port; it exposes no arbitrary shell or game-input
method. `DeviceLocalArtifactExecutor` is the deterministic test/local executor;
`AdbDeviceLocalArtifactExecutor` is the physical one: it expands the declared
opening and repeat-cycle blocks, encodes them through the HID transport, and
transfers one fixed script whose delays execute on the phone. Plans are
compiled into bounded state-conditioned blocks: monitor operations name an
UP/DOWN target, camera coordinates require two agreeing UP observations, and
office controls require DOWN; UNKNOWN or a failed bounded retry aborts and
releases all contacts instead of continuing by toggle parity. Neither executor
promotes a claim; `composeCampaignPorts` binds the selected executor to a
validated campaign bundle, and `modern-campaign-ports.js` is the default ports
module the device command line loads (`apps/desktop/src/device-cli.js`). The
result contract records every attempt, death retry, positive terminal proof,
Custom Night readback, and save/menu proof.

Monitor state comes from a calibrated `monitor-rule-v1` artifact
(`src/sensors/fnaf2/monitor-rule.js`), fitted offline by
`tools/device/monitor-calibrate.py` and read through the helper's `GRID` verb;
`cameraSelected` from `camera-rule-v1` (`src/sensors/fnaf2/camera-rule.js`,
`tools/device/camera-calibrate.py`). Without a fitted rule, or on a stale,
off-identity, blackout-dark or mid-animation frame, the detector returns
`UNKNOWN` with the reason and the executor refuses to act on it. The profiles
(`apps/device/profiles/`) bind each rule's digest; the Moto g56 100 ms and 17 ms
profiles are separate qualification candidates, and a 100 ms result never
promotes the 17 ms one.

**Deprecated sensors.** CLAUDE.md discontinued the 20x9 point-sampled grid,
grid-fitted rules and luma reducers on 2026-09-24/25. The four modules in
`src/sensors/fnaf2/` are exactly those readers, moved unchanged: they are to be
converted to rules over native region pixels (FNaF 2's pipeline after
recalibration), never extended. Each is registered with lifecycle `legacy` in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json)
(`play.sensor.fnaf2-*`), with that removal gate.

**Venue identity.** `phone/android-venue.js` turns the text of fixed read-only
queries into the kernel's `venue-identity-v1`. The queries are `dumpsys
package` for the game and the Companion, and `getprop` for the build
fingerprint, the security patch and the time zone. It hashes the serial and
drops it, and it records any field it cannot read, or whose shape it does not
know, as `null` with the reason. The adb bridge runs the queries; this module
never opens adb. Its fixtures are shaped like current and Android 10 `dumpsys
package` output.

The transport modules are codecs over injected ports. They own report
encoding, coordinate conversion, authentication framing and protocol parsing,
but never open adb, select a policy, or claim that a legal write was accepted by
the game: a legal HID send is not evidence of acceptance. The composition root
wires the ports at the edge, and `tools/architecture-test.js` confines the HID
transport to the device runners.

**Moved from `packages/adapters` (ADR 0002).** One path stays there:
`packages/adapters/src/button-strokes.js`, a symbolic link to
`src/sensors/fnaf2/button-strokes.js`, because the retained
`full06-responses-20260928` result records that path with the file's sha256 and
`tools/recompile/test-phone-encounter-replay.mjs` compares them
(`adapters.button-strokes-link`).

The capability registry, the actuator and sensor classes and the fixture
adapters that served the retired fixture service path were removed on
2026-09-25 (`docs/ARCHIVED-ROUTES.md`).
