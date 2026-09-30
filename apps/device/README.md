# `@fnaf2-1020/device`

The device app is the campaign executor and the only composition root that
reaches a phone: `cli.js campaign` chooses the profile, composes the ports in
`modern-campaign-ports.js`, and plays a validated bundle only with `--live
--confirm-live`. `tools/device/night-run.sh` drives it for every night, and
forwards that pair only when it is itself given `--live --confirm-live`: it is
dry by default (ADR 0002). The serial comes from `--serial`, `FNAF_SERIAL` or the
untracked local profile (`tools/device/local-profile.mjs`).

Public surface: the CLI and the Cue Helper MCP (`mcp.js`). Dependencies: core
and adapters. Commands: `device:campaign`, `device:preflight`,
`device:clockmap` and `device:grade`. Artifacts: campaign
directories under ignored `artifacts/`, which `npm run evidence -- pack` turns
into committed run packs. The fixture `DeviceControlService`, `composeDevice`,
`composeModernDevice`, the seam-calibration fixture and the `dry-run`, `live`
and `calibrate` commands were retired on 2026-09-25 (`docs/ARCHIVED-ROUTES.md`).

The campaign control plane is available through safe dry-run, guided, and
read-only preflight entry points:

```sh
npm run device:campaign -- --dry-run --json
npm run device:campaign -- --guided --json
npm run device:preflight -- --profile hid-mediaprojection --json
```

The first validates the complete story ladder, Nights 1 through 6 followed by
the Night 7 Custom Night 10/20 target, and its bounded retry/proof contract
without touching a phone. The second performs closed, read-only ADB discovery:
exactly one ready
device, the pinned FNaF 2 build, awake/unlocked state, game focus, `/system/bin/hid`,
and Cue Helper. A `HOLD` is expected when the phone is absent or not ready; it
does not become qualification evidence.

### Venue identity

Preflight also records the venue identity (ADR 0002, decision 1). Its
`venue-identity-v1` record holds:

- the game's `versionName`, `versionCode`, `firstInstallTime` and
  `lastUpdateTime`, with the time zone they are printed in;
- the OS build fingerprint and security patch;
- the Companion's version;
- a hash of the serial, never the serial.

The adapter parses the record (`@fnaf2-1020/adapters`, `transports/android-venue`)
from fixed read-only `dumpsys package` and `getprop` queries. Core compares it
(`compareVenueIdentity`) with what the run is bound to: a `qualification-v2`
passed with `--qualification`, and any `venue-binding-v1` that names this
profile or winner, passed with `--venue-binding FILE`. The result is
`device-preflight-v2` with `venue` and a `venue-identity` check:

- `UNBOUND` records the identity and passes. Every committed profile is
  unbound today.
- `MATCH` passes.
- `DRIFT` fails. It names each field from what to what, and gives the remedy:
  re-qualify, or roll the game back.
- `UNKNOWN` holds, because a bound field was unreadable.

In a live campaign, `qualification-venue` reports a drifted `qualification-v2`
as demoted from `QUALIFIED` to `CANDIDATE`. The venue is kept in the campaign
result's preflight event (`campaignVenue(result)`). `venue.js` loads the
bindings and prints the venue block. The rules are in
[`docs/operations/DEVICE-SAFETY.md`](../../docs/operations/DEVICE-SAFETY.md#venue-identity-pedro-2026-09-29).

`--guided` prints the one-time calibration checklist. A live campaign also
requires `--bundle DIR` with one full-night plan per requested night,
`--calibration FILE` containing measured Custom Night menu/dial readback
geometry, and an artifact-bound `DEVICE_MEASURED` qualification. The campaign
returns `HOLD` until those files and the modern device-local executor are
present; it never guesses a Custom Night coordinate or treats a completed
executor as a win. Night 6 selects the measured `6th Night` item by default
and requires positive post-win Custom Night visibility (Continue is available
only when its save cursor is separately observed at Night 7). Night 7 advances
only after all ten 20 dials plus Puppet 15 are read back and the menu return is
observed.

```sh
npm run device:emit -- --winner tools/device/campaign-night7-k3-winner.json --out /tmp/k3
npm run device:campaign -- --bundle /tmp/k3 --nights 7 --profile hid-mediaprojection
```

That is the phone-free dry run CI performs over a committed winner. Coordinates
and transport details come from the profile; they are never inferred from a
policy or conversation.

Research winners use a separate, content-addressed handoff before any device
lane is considered: `npm run device:emit -- --winner winner.json --out
artifacts/run-001` writes `winner.json`, `manifest.json`, `night-N.plan`,
`profile.json`, and a hashed `artifact.json` containing the transport-neutral
semantic blocks, then validates the interpreter vocabulary, timing/contact
budget, identity, hashes, and bounded replay. The modern campaign CLI consumes
that exact bundle through `modern-campaign-ports.js`; its device-local executor
sends one bounded HID schedule to the phone and does not import the historical
trial lane. Plans are compiled into bounded state-conditioned blocks: monitor
operations name an UP/DOWN target, camera coordinates require two agreeing UP
observations, and office controls require DOWN. UNKNOWN or a failed bounded
retry aborts and releases all contacts instead of continuing by toggle parity.

`CampaignStateMachine` is the lifecycle seam above that executor. It requires
positive menu and intro identity, records bounded attempts, treats unknown
observations as `HOLD`, advances story Nights 1 through 5 through their
night-specific save/roll-through proof, advances Night 6 after a verified save
cursor or newly visible Custom Night item, and advances Night 7 after a
verified return to the menu. `AdbDeviceBridge` supplies the read-only
discovery/preflight port; it intentionally exposes no arbitrary shell or
game-input method.

`DeviceLocalArtifactExecutor` is the deterministic test/local adapter.
`AdbDeviceLocalArtifactExecutor` is the physical adapter: it expands the
declared opening and repeat-cycle blocks, encodes them through the HID adapter,
and transfers one fixed script whose delays execute on the phone. Neither
executor promotes a claim; `composeCampaignPorts` binds the selected executor
to a validated campaign bundle. The result contract records every attempt,
death retry, positive terminal proof, Custom Night readback, and save/menu
proof.

Monitor state comes from a calibrated `monitor-rule-v1` artifact
(`packages/adapters/src/monitor-rule.js`), fitted offline from labeled
2400x1080 frames by `tools/device/monitor-calibrate.py`. The rule anchors on
the monitor's map layout drawing — present if and only if the monitor is up,
independent of the camera feed — read through the helper's `GRID` verb. The
fitted g56 rule (`models/monitor-rule-moto-g56-v207.json`) carries four map
anchors plus two covered-office anchors; every anchor must agree before the
fact votes. Without a fitted rule — or when the frame is stale, off-identity,
blackout-dark, mid-animation, or otherwise ambiguous — the detector returns
`UNKNOWN` with the reason and the service refuses actuation. Composition
requires the profile's `calibrations.monitorRule` to carry the artifact
digest, so an unbound or mismatched rule cannot drive a run. A future
helper-emitted explicit `monitorUp` field supersedes the derived value
frame-by-frame.

`cameraSelected` is the sibling fact (`camera-rule-v1`,
`packages/adapters/src/camera-rule.js`, fitted by
`tools/device/camera-calibrate.py` from `models/camera-rule-moto-g56-v207.json`):
the twelve map buttons are measured watch pixels, the selected one renders
yellow (bright ~194, dimmed ~96 while the wind control is held) against
cool-grey unselected. Exactly one lit button names the camera; zero and
several lit buttons are distinct UNKNOWN reasons so a camera transition and
the Android double-camera glitch stay separable in telemetry. The live
MediaProjection observation payload carries this camera measurement alongside
the game-UI `batteryPercent` measurement from the same fresh snapshot; neither
fact is an actuator command or a substitute for the monitor detector's
qualification.

The Moto g56 100 ms and 17 ms profiles are deliberately separate
qualification candidates. Both remain `dryRunOnly` until their own
MediaProjection monitor-state detector, HID transport, atomic compound macros,
and artifact-bound physical qualification pass. A 100 ms result never promotes
the 17 ms profile.

The optional JSON-RPC/MCP-shaped adapter exposes bounded semantic tools over
the same service (`devices.list`, `profiles.resolve`, `device.preflight`,
`session.*`, `sensor.sample`, `actuator.apply`, `trajectory.execute`, artifact
inspection, and the safe Cue Helper tools). It never exposes arbitrary shell or
raw tap coordinates.

For a real stdio MCP server that can be shared by Codex, Claude Code, and
OpenCode, run `npm run device:mcp`. Its project configuration is checked in as
`.mcp.json` (Claude Code) and `opencode.json` (OpenCode). The exposed Cue
Helper tools are `cue.setup`, `cue.queue.enqueue`, `cue.queue.list`, and
`cue.queue.run`. Queue enqueue/list work without a phone; queue run returns a
safe HOLD while the phone is absent, locked, asleep, or ambiguous and leaves
the job pending. The server cannot unlock the phone, tap the game, send HID,
or write qualification evidence.

All MCP instances share a kernel-released per-device lease. Multiple agents
may enqueue/list concurrently, but setup and queue draining for the same ADB
serial are serialized; a competing operation returns `HOLD device-busy` or
waits when a bounded wait was requested.
`cue.queue.enqueue` accepts an optional idempotency key so retries from several
agents do not create duplicate setup jobs.
