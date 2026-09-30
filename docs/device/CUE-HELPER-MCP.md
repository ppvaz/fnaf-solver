# Cue Helper MCP

The repository includes a project-local stdio MCP server, `fnaf-solver`, at
`tools/device/cue-helper-mcp.mjs`. It carries two surfaces: the safe Cue Helper
operations, and the first steps of the solver interface of
[Plan 28](../../plans/28-solver-interface.md). Neither exposes a tap, a
coordinate, HID input, a shell command or a rebuild.

## The solver interface

Start with `describe({game})`. Every answer below is a
`claim-envelope-v1` ([`packages/kernel/src/claim-envelope.js`](../../packages/kernel/src/claim-envelope.js),
registered in the contract register):

```json
{ "schema": "claim-envelope-v1", "claim": {}, "label": "DEVICE_MEASURED",
  "target": "com.scottgames.fnaf2", "cite": ["docs/evidence/graph.json"],
  "status": "standing", "supersededBy": null,
  "notMeasured": ["reliability: a promotion is one clear on the phone, not a rate"],
  "reproducer": "npm run review -- query promotions" }
```

or a refusal of a known-bad move:

```json
{ "schema": "claim-envelope-v1", "refused": true, "rule": "seed-floor",
  "because": "a win rate is quoted over 1200 seeds; ...",
  "cite": ["plans/ROADMAP.md", "tools/census.mjs"], "remedy": "..." }
```

`label` is a claim level (`MODEL_ONLY`, `FIXTURE`, `DEVICE_MEASURED`), a source
label (`SOURCED`, `CALIBRATED`, `MEASURED`, `INFERRED`, `MODEL`) or
`{"kind": "UNKNOWN", "reason": ...}`, never missing and never a bare
`UNKNOWN`. An answer that holds an UNKNOWN value names what it does not
measure. `target` is a game's Android package, or `repository` for an answer
about the repository's own registers. `reproducer` is a command in the
generated command registry, and every verb runs from a shell as
`npm run review -- <verb>`.

| Tool | What it answers | Effect |
|---|---|---|
| `describe` | One game's coverage map, joined from the registers: the control catalog, the contract register, the chronicle, the run packs and promotions, and the negative results. Each section carries its label; what a register cannot say is UNKNOWN with the reason; each of Plan 28's four gaps is a query. | read-only |
| `query` | `promotions` (every `PROMOTED_BY` edge re-derived from its pack), `packs`, `chronicle` (`negative: true` for refutations, retractions, negatives and superseded entries; `text` to search), `contracts`. | read-only |
| `review` | An instrument over one committed pack: `custody`, `outcome` (the venue's reported outcome beside any video grade), `promotion-checks`, `death-time` (refused while the death time is UNKNOWN). | read-only |
| `promote` | The `PROMOTED_BY` edge Plan 12 would record for a pack, or a `plan12-promotion` refusal naming the failing checks. It never writes an attestation or an edge: a caller of this interface cannot promote. | read-only |
| `check` | The four refusals, run on a statement before it is made: `seed-floor` (a win rate under 3000 seeds), `directional-reuse` (a constant used in another order than it was measured; CLAUDE.md mistake 10), `capabilities-first` (an instrument proposed without the phone's `device-capabilities-v1` report; mistake 8), `unknown-as-number` (an UNKNOWN consumed as a number). | read-only |
| `jobs.enqueue`, `jobs.list`, `jobs.run` | The queue tools below, answering in the envelope. | as `cue.queue.*` |

Resources, each a read-only projection in the same envelope:
`fnaf://chronicle`, `fnaf://evidence/graph`, `fnaf://contracts`,
`fnaf://refuted` (chronicle negatives and the parked routes of
[`../ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)), and the template
`fnaf://game/{pkg}/controls` (one game's `control-catalog-v1`).

The verbs live in [`packages/review/src/solver.mjs`](../../packages/review/src/solver.mjs),
so the MCP server, the review CLI and a later wiki or desk share one verb table.
Not here yet (Plan 28 steps 5 and 6): `truth.*` over the game's own event
sheet, and `sim.*` and `device.*` over the gated simulation and device paths.

## The Cue Helper queue

These four tools keep their names and their answers unchanged:

- `cue.setup` — image-free setup and menu/night identity check.
- `cue.queue.enqueue` — persist `setup`, `menu-check`, or `night-check`.
- `cue.queue.list` — inspect persisted job state.
- `cue.queue.run` — execute pending jobs only when exactly one ADB device is
  awake and unlocked.

The queue is useful when the phone is away or locked. Enqueue and list do not
need ADB. A runner started with `cue.queue.run` reports `HOLD` for an absent,
locked, asleep, or ambiguous device and leaves the job `PENDING`; it never
auto-unlocks the phone. `night-check` also waits for a manually entered night:
when the authenticated target is still at `FNAF2_MENU`, it stops the temporary
projection and returns the job to `PENDING` instead of marking it failed.
No operation accepts arbitrary shell text, coordinates, HID input, or game
controls.

Setup also reports whether the exact target package declares
`HIDE_NON_SYSTEM_OVERLAY_WINDOWS`. `NOT_REQUESTED` is only static evidence; it
does not replace runtime target-visibility and touch qualification.

All MCP processes share a kernel-released per-device lease. Multiple agents may
enqueue and inspect jobs at the same time, but direct setup and queue draining
cannot operate the same serial concurrently. A competing operation returns a
`HOLD` with `reason=device-busy` (or waits when a bounded wait was requested),
and a crashed client cannot leave the lease permanently held.

The same lease also covers long-lived qualification observation, helper soak
telemetry, and reviewed qualification-sidecar provisioning. The authenticated
read-only query command remains lock-free, so agents can inspect state without
blocking the active session.

`cue.queue.enqueue` also accepts an optional `idempotencyKey`. Repeating the
same logical request with that key returns `EXISTING` and the original job,
including after it has completed; use a new key when a deliberate rerun is
intended.

## CLI setup

Claude Code and OpenCode discover the checked-in project configuration when
started in the repository. Claude Code may ask for one-time approval of the
project `.mcp.json` server.

Codex CLI currently manages stdio MCP launchers from its user
`~/.codex/config.toml`, rather than discovering a repository-local MCP file.
Register this project once from the repository root; after that the server is
available to Codex sessions:

```sh
codex mcp add fnaf-solver -- node "$PWD/tools/device/cue-helper-mcp.mjs"
```

The registration stores the absolute path, so repeat it after moving or
cloning the repository elsewhere. Check it with `codex mcp list`.

For a direct smoke test independent of a CLI:

```sh
npm run device:mcp
```

The process speaks newline-delimited MCP JSON-RPC on stdin/stdout; logs and
diagnostics belong on stderr so clients can keep the transport clean.
