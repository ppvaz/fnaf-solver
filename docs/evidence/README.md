# Evidence policy

Supported commands that print a claim, comparison, rate, timing, or verdict
also emit a stable evidence ID and a versioned result artifact. `MODEL_ONLY`,
`FIXTURE`, and `DEVICE_MEASURED` are distinct ceilings; architecture changes do
not promote claims. Plan 12 is the only promotion ladder.

```sh
npm run evidence -- list
npm run evidence -- show RUN_ID
npm run evidence -- diff RUN_A RUN_B
npm run evidence -- replay RUN_ID
npm run evidence -- why RUN_ID
npm run evidence -- promote RUN_ID
```

`list`, `show`, `replay`, and `promote` recognize both runtime session bundles
and validated `device-bundle-v1` handoffs; historical manifests are labelled as
archives instead of being mistaken for malformed current sessions. Promotion
of a handoff still refuses until the external and Plan 12 gates are present.

Large or sensitive media is content-addressed and retained separately. The
manifest retains profile, policy/model hashes, clocks, capabilities,
calibrations, semantic commands, actuation results, lifecycle, grading, and
redaction. Research bundles additionally retain content-addressed spec/result
artifact refs, spec/result/manifest hashes, and a reproducer command; evidence
lookup verifies these before showing or diffing a run. `replay` reruns that
retained research spec through the shared deterministic evaluator and compares
the result hash. `promote` invokes the Plan 12 gate and returns a structured
refusal until external device evidence and a passing terminal result exist.
Generators may propose graph edges; humans approve support, refutation,
supersession, retraction, and promotion edges.

The [2026-09-05 calibration clock audit](calibration-clock-audit-20260905.json)
is a generated `calibration-stability-v2` REFUSED result, not a device-session
qualification or a promotion edge. It retains hashes and ambiguous trial
evidence so the project can distinguish exploratory map appearances from
verified mask/monitor/flash calibration. Reproducer and current hold:
[Plan progress](../../plans/PROGRESS.md).

Device handoff is a separate `winner-v1` -> `device-bundle-v1` step:
`npm run device:emit -- --winner winner.json --out artifacts/run-001` persists
the winner, resolved profile, night plans, hashed semantic `artifact.json`, and
bounded replay. The artifact consumer validates that exact bundle before any
runner can use it;
`npm run device:campaign -- --bundle DIR --nights N` without `--live` checks
it the same way, host-only. The campaign CLI composes
`apps/device/src/modern-campaign-ports.js` by default (or accepts an explicit
port module); it receives only compiled semantic blocks and bound hashes,
never the strategy interpreter or historical transport lane.

The all-night campaign adds a second proof layer: `device-campaign-result-v1`
records each bounded attempt, `campaign-proof-v1` requires a positive 6 AM
observation plus save/menu advancement, and `custom-night-calibration-v1`
binds all ten Custom Night dial controls to measured readback boxes. A local
executor completing its schedule is therefore still `UNVERIFIED` until the
terminal and save ports provide positive observations.

**Run packs: custody without frames.** A campaign directory lives under gitignored `artifacts/` on the machine that
played the night, and is ~135 KB of text beside ~85 MB of observer frames. The
gate reads only the text, so the text is what the repository keeps:

```sh
npm run evidence -- pack night6-n6h2-01-20260920T024030Z   # a night-run label or a campaign id
npm run evidence -- promote night6-n6h2-01-20260920T024030Z
```

`pack` writes `docs/evidence/runs/<run>/`: the campaign's `result.json`,
`events.jsonl`, `request.json` and `observations.jsonl`, and under `run/` the
derived facts `night-run.sh` kept (verdict, run report, phase, grade log,
anchor notes). `pack.json` records each file's sha256 and size, the original's
sha256, and what was redacted; the executor's 20x9 `maskCells` grid becomes
`{cells, sha256}` and machine paths become repository-relative. Every file it
does not copy — the video, observer and death frames, raw logcat,
`campaign.log` — is listed under `withheld` by sha256 and size, so the media
can be matched later wherever it is kept. The packer refuses a long numeric
array, a long hex or base64 run, or a NUL byte instead of publishing it.
`night-run.sh` packs every campaign it ran; commit the directory it names.
When the campaign retained an `ERROR` envelope instead of a validated result,
the pack preserves that error with an `UNKNOWN` claim ceiling. It supplies no
terminal result and cannot pass promotion; a video grade remains independent.

`list`, `show` and `promote` read packs on any checkout. For a pack, `promote`
adds a fifth check, `winnerCommitted`: the bundle's `winnerHash` must match a
committed `tools/device/*-winner.json`, as filed or as `compileBundle`
normalises it, or the night cannot be re-run from the tree;
`test-winners-rebuild.mjs` keeps every committed winner compiling. The attestation is a person's file beside the pack,
`plan12-attestation.json`:

```json
{ "schema": "plan12-attestation-v1", "status": "PASS", "packSha256": "<from promote>", "attestedBy": "...", "at": "..." }
```

It binds one exact pack: re-packing a run that changed, or editing any packed
file, changes the sha256 and voids it. Agents never write it.

A FNaF 1 runner's night packs the same way (`npm run evidence -- pack
fnaf1-...`): its `probe.json` and `events.jsonl`, whose captures are already
cited by sha256. It lists as `fnaf1-run`; the Plan 12 gate reads only the FNaF 2
campaign, so `promote` refuses it by name.

Every timestamp in a pack's `events.jsonl` has a declared clock: host wall,
host monotonic, phone monotonic, phone wall, plan time, duration or offset
(`packages/core/src/telemetry/event-clocks.js`, gated by
`tools/device/test-event-clocks.mjs`). Read a time through that table, never
by its magnitude; two wall clocks once stood 1374.8 ms apart. `run-report.mjs`
and `phase-reconstruct.mjs` run over a pack directory as over a campaign.

A cohort's result is computed from its packs rather than copied into a record:
`npm run evidence -- cohort docs/evidence/<cohort>-predeclaration-<date>.json`
applies the predeclared rule (executor sixam AND video clear) slot by slot and
reports excluded, superseded, ungraded and missing runs.
For a declaration with `corners`, each corner explicitly lists its consecutive
`rNN` labels. The result reports each corner and their total, verifies its
requested and observed dial vector from the packed request and menu readback,
and derives an evidence ID from the result. Missing dial evidence remains
unverified and prevents a complete result.

The architecture generator also emits
`docs/architecture/generated/reverse-links.json`. It is a navigational index
from stable IDs to source, test, fixture, and evidence references; it does not
grant a claim or promotion authority. `npm run test:retrieval` keeps the main
human-facing routes discoverable from newcomer questions.

A `device-bundle-v1` whose manifest gate is `DEATH_TARGETED` was built to test
a model prediction of a death, not to win. Its gate carries a
`death-prediction-v1` record (killer shares and death-time quantiles over the
epoch phases a drawn release can land on, 3000 replays minimum, written by
`tools/device/death-prediction.mjs` before the run and retained beside it as
`prediction.json`). Such a run is read as prediction versus observation; it is
never a route claim and never a Plan 12 rung, whatever its terminal. The
instrument and its first record are described in
[`docs/device/ON-DEVICE-VALIDATION.md`](../device/ON-DEVICE-VALIDATION.md)
("Death prediction and death targeting").
