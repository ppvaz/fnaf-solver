# `@sixam/review`

Review is the Proof context of [ADR 0002](../../docs/decisions/0002-kernel-contexts-vocabulary.md):
it reads what a night left behind and decides what it shows. Venues report
outcomes; review decides them, and claims, promotions and status are queries
over what it reads. It holds the evidence tools that read committed run packs:
the campaign reader, the run-pack writer and reader, Plan 12 attestation and
promotion, and the cohort computation. They moved here from `tools/` on
2026-09-29, unchanged; `npm run evidence` (`tools/evidence.js`) composes them,
and its output did not change by a byte.

**Boundary.** Review never imports Play or Propose. In today's names it never
imports `apps/device`, `packages/adapters` or `packages/research`, and
`tools/architecture-test.js` refuses any module here that does, by a static
import, a re-export, a dynamic `import()` or a `require()`. The two campaign
validators it needs (`validateCampaignResult`, `validateSaveProof`) moved to
`@sixam/core/contracts` for that reason; `apps/device` re-exports them.
It still reaches `tools/device/bundle.mjs` to compile a committed winner to the
hash a bundle records (`trackedWinners`), and through it the research seed
helpers: that edge closes when `tools/device` is sorted by context (migration
M9).

**Stored names.** Every pack records `packer: tools/evidence-pack.mjs`, and the
pack digest an attestation binds covers it, so the value never changes. The old
path is a one-line re-export (`tools/evidence-pack.mjs`, registered in
`legacy-paths.json` as `review.evidence-pack-shim`).

Public API: the `./evidence-campaign`, `./evidence-pack`, `./evidence-promotion`
and `./evidence-cohort` subpaths. Dependency: core. Commands: `npm run
evidence` (verbs `list`, `show`, `diff`, `replay`, `why`, `pack`, `attest`,
`promote`, `promotions`, `recovery-check`, `cohort`). Tests: the root
`test:unit` lane runs `test/`.

The campaign reader and packer also preserve the CLI's retained `ERROR`
envelope when no validated result was returned. That row has an `UNKNOWN`
claim ceiling, no terminal, and cannot promote. Their tests cover this distinct
case as well as malformed results and the older `RESULT_LOST` recovery case.
An interrupted native campaign with its request and events but no result packs
as `incomplete-campaign`: those original files and frame hashes are retained,
only `result.json` is missing, and no terminal is inferred. A missing runner
verdict does not lose the run identity carried by its `evidence.started` log.

| Module | Kind | Purpose and interface |
|---|---|---|
| `src/evidence-campaign.mjs` | module | How the evidence index reads the phone's own nights: `isCampaignResult`, `campaignEntry` and `campaignPromotionChecks` over `artifacts/campaign-*/result.json`, a `{mode, status, result}` wrapper around a validated `device-campaign-result-v1`. A live campaign is `DEVICE_MEASURED`; an attempt is a `WIN` only with the `sixam` terminal and its `campaign-proof-v1` hash, otherwise `UNPROVEN_WIN`. The Plan 12 checks are the same four the CLI applies to sessions and bundles, and the attestation is never inferred: it is written over a pack by `attest`. Before 2026-09-18 the index reported every campaign as `UNRECOGNIZED_ARTIFACT` and zero device-measured runs on a machine holding 24 device wins. |
| `test/evidence-campaign.test.mjs` | check | Pins the campaign reading in `test:unit`: live wins are `DEVICE_MEASURED`, dry runs are `FIXTURE`, deaths and proofless wins are not wins, a malformed result is refused, and the promotion gate refuses a live win only for its missing attestation. No device. |
| `src/evidence-pack.mjs` | module | Frame-free run packs: a live campaign's `result.json`, `events.jsonl`, `request.json` and `observations.jsonl` plus `night-run.sh`'s derived facts (verdict, run report, phase, grade log, `.err` notes), written under `docs/evidence/runs/<run>/` so the Plan 12 gate reads them on any checkout. Pixel payloads (`PIXEL_KEYS`, today the 20x9 `maskCells` grid) become `{cells, sha256}`, machine paths become repository-relative or `~`, and every file not copied -- video, observer and death frames, raw logcat, `campaign.log` -- is listed as `withheld` by sha256 and size. It refuses rather than guesses: a long numeric array, a long hex or base64 run, or a NUL byte stops the pack. Deterministic, so a re-pack of an unchanged run is `UNCHANGED` and a `plan12-attestation.json` binds one exact pack sha256. `packManifestComplete` accepts recovered custody (Pedro, 2026-09-27) when the result and events came back, the cited log is withheld under the same sha256, and `lost` is listed; `attestationStatus` reads v2 attestations (author: a person, or an agent under delegation `pedro-2026-09-27`; every other check listed as verified) and legacy v1. Used by `npm run evidence -- pack` and by `night-run.sh` after every run. A FNaF 1 runner's directory (`probe.json`/`run.json` + `events.jsonl`) packs as kind `fnaf1-run` through `buildFnaf1Pack`, with no campaign result for the gate. A campaign directory that is gone is recovered from the night-run's `campaign.log` (`recoverFromRunLog`: the event rows and the result the CLI printed), and the pack says so in `custody` -- what was recovered, what is lost (`request.json`, `observations.jsonl`, frames, and the result of a campaign that threw, as `RESULT_LOST`), and the check it cites. `recoveryCheck` (`npm run evidence -- recovery-check`) re-runs that check over every campaign still on disk; `--timeline FILE` adds a video grade kept outside the run directory, refused unless it names the run's own recording. |
| `test/evidence-pack.test.mjs` | check | Builds a campaign and its night-run directory in a throwaway tree and pins what crosses into a pack: no media file, no pixel grid, no machine path, every frame still named by hash, unknown pixel fields and tampering refused, and the gate's five checks read from the pack. Then a campaign recovered from its log: rows byte for byte (numeric stamps included, stopping at the next campaign), the printed result and not the preflight, a thrown campaign packed as `RESULT_LOST`, a foreign timeline refused, the recovered win passing custody while its `lost` list still names `request.json`, a v1 attestation still read, and `recoveryCheck` telling an identical recovery from one that is not. `test:unit`. |
| `src/evidence-promotion.mjs` | module | Plan 12 attestation and promotion over committed run packs. `derivePromotion` re-derives every check but the attestation from the pack itself (file hashes; live `DEVICE_MEASURED` result; the executor's 6 AM: terminal, verification, `validateSaveProof`, the `campaign.terminal.from-executor` row, and no packed video grade that disagrees; custody, including the recovery check a recovered pack cites; the committed winner; and `claimIdentity`, a Custom Night named by its own menu readback) and lists each input's sha256. `attestPack` writes `plan12-attestation-v2` only when all pass, naming its author (a person, or an agent under Pedro's 2026-09-27 delegation). `recordPromotion` adds the `PROMOTED_BY` edge to `docs/evidence/graph.json` with the attestation, author and custody; `promotionSummary` counts packs, wins, attestations and promotions per night and reports stale edges. |
| `test/evidence-promotion.test.mjs` | check | Throwaway tree: an agent attestation over a re-derived win is accepted; a mismatched digest, an author without the delegation or a note, an unlisted check, an edited pack, a death, an uncommitted winner, a contradicting video grade and an unnamed Custom Night vector are refused; a recovered 10/20 win passes custody while its attestation and edge keep its `lost` list; the edge is recorded once and a stale one is reported. `test:unit`. |
| `src/evidence-cohort.mjs` | module | A cohort result computed from its run packs: reads a `cohort-predeclaration-v1`, finds each slot's packs by label (`<night>-<prefix>-rNN[b..z]-<stamp>`), and applies the predeclared rule -- executor terminal sixam AND video terminal clear, the video read from the pack's `grade.log` `TERMINAL:` line or `timeline.json` (`terminal.outcome`, run-timeline.py's shape). A run that never reached the night is excluded, the last of several is counted and the rest superseded, a sixam without a video grade is `UNGRADED`, and runs on another binding are named. A `RESULT_LOST` slot is decided by the video if it saw a death and is otherwise `UNKNOWN`, with the executor's last abort reason beside it. A declaration with `corners` computes each explicitly labelled corner separately, checks requested and observed dials against its vector, and emits a content-derived evidence ID; missing or mismatched dial evidence leaves it incomplete. Used by `npm run evidence -- cohort`. |
| `test/evidence-cohort.test.mjs` | check | Four-slot synthetic cohort of real packs: a win, a death, an ungraded sixam and an excluded-then-rerun slot, plus a superseding re-run on the wrong binding, a slot graded by run-timeline.py's own `timeline.json`, and a result-lost slot left `UNKNOWN` with its abort reason. Also checks multi-corner slot counts, missing runs, separate dial vectors, mismatched readback, exclusions, and stable result IDs. `test:unit`. |
