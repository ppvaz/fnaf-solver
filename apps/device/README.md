# `apps/device` (the device profiles)

The device app's code moved in ADR 0002's Play move: the campaign executor,
state machine, runner, ports, HID schedule, night anchor and the coach feed to
[`@sixam/play`](../../packages/play/README.md), and the command line and the
MCP glue to [`apps/desktop`](../desktop/README.md), the one composition root.
This folder is no longer a workspace.

What stays is `profiles/`, the resolved device profiles (`device-profile-v1`):

| Profile | What it is |
|---|---|
| `profiles/hid-mediaprojection.json` | The qualified Moto g56 profile every committed winner and CI's dry run use. |
| `profiles/hid-mediaprojection-17ms.json` | The 17 ms candidate, `dryRunOnly` until its own qualification. |
| `profiles/fixture-hid-screencap.json` | The test fixture profile. |

They stay at this path, unmoved and byte for byte, because stored hashes cover
it: 55 retained results in `tools/recompile/results/` record `profile:
apps/device/profiles/hid-mediaprojection.json` beside its `profileSha256`; the
recompile configs `tools/recompile/full06-response-experiment.json` (whose
sha256 `full06-responses-20260928` binds) and `phone-encounter-nights.json` name
it; `tools/recompile/schedule-to-input.mjs` defaults to it; and
`docs/evidence/graph.json` cites `fixture-hid-screencap.json` here. Each profile
is registered in
[`legacy-paths.json`](../../docs/architecture/generated/legacy-paths.json)
(`play.profile.*`, owned by `@sixam/play`), with the removal gate that would let
it move to `packages/play/profiles/fnaf2/moto-g56/`. A profile's bytes are also
what every bundle binds by sha256 (`profile.json`), so any change to one is a
new profile, never an edit.
