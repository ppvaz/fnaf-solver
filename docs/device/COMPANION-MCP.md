# Companion MCP

The repository includes a project-local stdio MCP server, `fnaf-solver`, at
`apps/desktop/src/companion-mcp.ts` (it was `tools/device/companion-mcp.mjs`
until ADR 0002's Play move made `apps/desktop` the composition root). It carries two surfaces: the safe Companion
operations, and steps 1-5 of the solver interface of
[Plan 28](../../plans/28-solver-interface.md), with the operator's read-only
`lab.*` verbs beside them: fourteen tools in all. Neither exposes a tap, a
coordinate, HID input, a shell command or a rebuild.

## The solver interface

Start with `describe({game})`. Every answer below is a
`claim-envelope-v1` ([`packages/kernel/src/claim-envelope.ts`](../../packages/kernel/src/claim-envelope.ts),
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
  "cite": ["plans/ROADMAP.md", "packages/propose/bin/census/census.mjs"], "remedy": "..." }
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
| `truth` | The game's own event sheet, read from **your** local dump (Plan 28 step 5). `op: "events"` with `{game, query}`: the event groups that read or write one target -- an object (`object` by name, or `handle`), optionally one of its alterable values (`value`) or flags (`flag`); a global value (`global`); or one group (`frame` and `group`) -- narrowed by `frame`, `access` (`read`, `write`, `any`) and `limit`. Each match is its frame, its group id (`g###`) and every condition and action as parsed fields (object type and number, the object resolved through the handle scramble K, each parameter), never the dump's text; a hit the dump does not pin down (an indexed read, a flag number computed at run time) says `certain: false`. `op: "object"` with `{game, name \| handle}`: type, the frames whose events reference it, created-by and destroyed-by. `op: "decode"` with `{path, game}`: runs the local CTFAK event-text dumper on an APK or CCN on this host, estimates K by object-type agreement, caches the dump outside the repository and binds it to the game named. Every answer is `SOURCED` and cites `fnaf://truth/<game>/frame/<n>/group/<g>`; `npm run review -- truth events\|object\|decode` is the same call from a shell. | reads; `decode` writes only the local cache and vault |
| `jobs` | The queue tools below, answering in the envelope: `op` `enqueue` (with `cue.queue.enqueue`'s arguments), `list`, or `run` (`waitSeconds`, `intervalSeconds`). Each op refuses an argument it does not take. | as `cue.queue.*` |
| `lab.status`, `lab.next`, `lab.doctor` | The operator's verbs ([`../operations/LAB.md`](../operations/LAB.md)), the same functions `npm run lab -- status\|next\|doctor` calls: where the work stands (HEAD and its push-gate record, each ROADMAP step's state, promotions, the phone lease and queue, pending decisions), what to take next in the ROADMAP order, and what is broken on this host with each remedy. `lab.doctor` leaves out the catalog-drift check, which builds a worktree. | read-only |

**Where the dump comes from.** The server ships the decoder, not the decoded
data (Plan 28): no dump, decoded text or game asset is tracked, and the tests
build a synthetic dump from the dumper's grammar at run time. `truth` reads the
dump each host makes from its own copy of the game, named in the untracked
`packages/source/decompile/local-vault.json` or in the file
`$SIXAM_TRUTH_VAULT` names:

```json
{ "schema": "truth-local-vault-v1",
  "games": { "com.scottgames.fnaf2": { "dump": "/abs/path/events-android.txt" } },
  "cache": "~/.cache/sixam-truth",
  "decoder": { "ctfakSrc": "/abs/ctfak-checkout", "dotnet": "/abs/dotnet" } }
```

With no dump for a game, `truth` refuses (`no-local-dump`) and names the
decode; `describe` reports Plan 28's gap 2 closed and says `no local dump
configured on this host`. `decode` refuses a path inside the repository, a file
that is neither an APK nor a CCN, and a missing toolchain (`decoder-absent`,
naming `CTFAK_SRC`, `DOTNET_ROOT` and
[`regen-dump.sh`](../../packages/source/decompile/regen-dump.sh)). A game `k`
pinned in the vault that object-type agreement contradicts is refused
(`handle-scramble`). The estimate cannot tell a K that permutes objects within
one type class, and every answer says so.

Resources, each a read-only projection in the same envelope:
`fnaf://chronicle`, `fnaf://evidence/graph`, `fnaf://contracts`,
`fnaf://refuted` (chronicle negatives and the parked routes of
[`../ARCHIVED-ROUTES.md`](../ARCHIVED-ROUTES.md)), and the templates
`fnaf://game/{pkg}/controls` (one game's `control-catalog-v1`) and
`fnaf://truth/{game}/frame/{frame}/group/{group}` (one cited event group of
your local dump, read back; a refusal where none is configured).

The verbs live in [`packages/review/src/solver.mjs`](../../packages/review/src/solver.ts),
so the MCP server, the review CLI and a later wiki or desk share one verb table;
`truth` is Source's own reading, [`packages/source/decompile/truth.ts`](../../packages/source/decompile/truth.ts).
Not here yet (Plan 28 step 6): `sim.*` and `device.*` over the gated simulation
and device paths.

## The Companion queue

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
codex mcp add fnaf-solver -- node "$PWD/apps/desktop/src/companion-mcp.ts"
```

The registration stores the absolute path, so repeat it after moving or
cloning the repository elsewhere. Check it with `codex mcp list`.

For a direct smoke test independent of a CLI:

```sh
npm run device:mcp
```

The process speaks newline-delimited MCP JSON-RPC on stdin/stdout; logs and
diagnostics belong on stderr so clients can keep the transport clean.
