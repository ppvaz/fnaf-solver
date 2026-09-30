# `@sixam/trainer`

The trainer is the public browser application under the Understanding layer.
It owns UI, touch input, audio, assets, curriculum, coaching, and trainer
traces. It does not own sourced mechanics, device profiles, policy authority,
or live actuation; those come from `@sixam/core` and explicit device
services. The static HTML entry remains at the repository root for publishing,
while its browser modules live under this application.

Public API: the browser entry, `Coach`, and the DOM-free replay microtrainer
factory from `src/index.js`. The microtrainer builds prediction and timing
exercises from retained snapshots plus independently evidenced future facts;
recognition requires retained profile-bound crops and an `UNKNOWN` choice; and
strategy cases require visible exact-simulator `MODEL_ONLY` provenance. Its
`microtrainer-session-v1` records retain prompt, commitment, resolution,
latency, scheduler, source-fact, artifact, and split metadata without raw
media. Censored or unresolved exercises never receive a correctness score.
The adaptive skill model is an isolated per-player/profile consumer of those
records: it reports denominators and Wilson uncertainty, excludes holdout data
from training, and records capped selection probabilities; it cannot affect
game belief, safety, or device policy.
The renderer boundary also exposes campaign, Rhythm Highway, and Threat
Constellation descriptors with shared semantic grading and accessibility
capabilities. The shipped menu includes a clearly labelled offline
`FIXTURE / PRACTICE` Arcade Lab drawer with prediction answer flow and local
progress export/reset; retained/live corpus joins and the rhythm/spatial pilots
remain separate follow-up work.
The Rhythm Highway chart boundary also reuses canonical routine windows,
refuses dense-lane collisions, and keeps prediction outcomes out of chart data;
its real canvas and player qualification are still separate pilot work.
The Threat Constellation boundary similarly fixes profile-relative semantic
anchors and touch-target geometry, with explicit tap/hold/slider records and
non-pointer alternatives; the retained-corpus hit-circle pilot is not implied.
Dependency: core only. Commands: root `build:trainer`, `serve:trainer`, and
`test:trainer`. Artifacts: the ignored single-file trainer bundle and optional
trace captures. This app does not own the canonical model, device execution,
or claim promotion.
