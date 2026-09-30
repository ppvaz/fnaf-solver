# Cue Helper MCP

The repository includes a project-local stdio MCP server at
`tools/device/cue-helper-mcp.mjs`. It exposes only the safe Cue Helper
operations:

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
