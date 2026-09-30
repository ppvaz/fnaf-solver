# `@sixam/desktop`

The one composition root of the final layout ([ADR 0002](../../docs/decisions/0002-kernel-contexts-vocabulary.md)).
It composes; it does not decide. It holds three doors onto the contexts:

- the **device command line** (`src/device-cli.js`, `npm run device:*`), the
  only path onto a phone;
- the **`fnaf-solver` MCP server** (`src/companion-mcp.mjs`, `npm run
  device:mcp`), with the Companion tools (`src/mcp.js`), the solver
  interface's verbs and the lab's read-only verbs;
- the **operator verbs**, `npm run lab -- <verb>`: status, next, start,
  commit, end, morning and doctor ([`docs/operations/LAB.md`](../../docs/operations/LAB.md)).

It is the `@sixam/desktop` workspace (the device app's package, `@sixam/device`
until ADR 0002's Play move), and as an application it may import any package:
`@sixam/play` for the campaign, `@sixam/review` for the queries, the kernel and
source. The campaign itself -- the executor, state machine, runner, ports, HID
schedule and night anchor -- is Play's ([`packages/play`](../../packages/play/README.md)).
The device profiles stay in [`apps/device/profiles/`](../device/README.md),
because retained records cite that path with the profile's sha256.

## The device command line

`device-cli.js campaign` chooses the profile, loads the default ports module
(`packages/play/src/campaign/modern-campaign-ports.js`), and plays a validated
bundle only with `--live --confirm-live`. `tools/device/night-run.sh` drives it
for every night, and forwards that pair only when it is itself given `--live
--confirm-live`: it is dry by default (ADR 0002). The serial comes from
`--serial`, `FNAF_SERIAL` or the untracked local profile
(`tools/device/local-profile.mjs`). Commands: `device:campaign`,
`device:preflight`, `device:clockmap` and `device:grade`; the names are stored
(CI and the overnight queue call them) and only their target moved. Artifacts:
campaign directories under ignored `artifacts/`, which `npm run evidence --
pack` turns into committed run packs. The fixture service path, its
composition roots, the seam-calibration fixture and the `dry-run`, `live` and
`calibrate` commands were retired on 2026-09-25 (`docs/ARCHIVED-ROUTES.md`).

```sh
npm run device:campaign -- --dry-run --json
npm run device:campaign -- --guided --json
npm run device:preflight -- --profile hid-mediaprojection --json
```

The first validates the complete story ladder, Nights 1 through 6 followed by
the Night 7 Custom Night 10/20 target, and its bounded retry/proof contract
without touching a phone. The second prints the one-time calibration
checklist. The third performs closed, read-only ADB discovery: exactly one
ready device, the pinned FNaF 2 build, awake/unlocked state, game focus,
`/system/bin/hid`, and Companion. A `HOLD` is expected when the phone is
absent or not ready; it does not become qualification evidence.

Preflight also records the venue identity (ADR 0002, decision 1): the game's
version and install times, the OS build fingerprint and security patch, the
Companion's version and a hash of the serial. Play parses it
(`@sixam/play`, `phone/android-venue`) and the kernel compares it
(`compareVenueIdentity`) with a `qualification-v2` passed with
`--qualification` and any `venue-binding-v1` passed with `--venue-binding
FILE`: `UNBOUND` and `MATCH` pass, `DRIFT` fails and names each field and the
remedy, `UNKNOWN` holds. The rules are in
[`docs/operations/DEVICE-SAFETY.md`](../../docs/operations/DEVICE-SAFETY.md#venue-identity-pedro-2026-09-29).

A live campaign also requires `--bundle DIR` with one full-night plan per
requested night, `--calibration FILE` with measured Custom Night menu and dial
readback geometry, and an artifact-bound `DEVICE_MEASURED` qualification. The
campaign returns `HOLD` until those files and the device-local executor are
present; it never guesses a Custom Night coordinate or treats a completed
executor as a win. The lease, abort and release rules are DEVICE-SAFETY's.

```sh
npm run device:emit -- --winner tools/device/campaign-night7-k3-winner.json --out /tmp/k3
npm run device:campaign -- --bundle /tmp/k3 --nights 7 --profile hid-mediaprojection
```

That is the phone-free dry run CI performs over a committed winner.
Coordinates and transport details come from the profile; they are never
inferred from a policy or conversation.

## The `fnaf-solver` MCP server

`npm run device:mcp` runs the stdio server; its project configuration is
checked in as `.mcp.json` (Claude Code) and `opencode.json` (OpenCode), and
Codex registers it once ([`docs/device/COMPANION-MCP.md`](../../docs/device/COMPANION-MCP.md)).
The Companion tools are `cue.setup`, `cue.queue.enqueue`, `cue.queue.list` and
`cue.queue.run`: enqueue and list work without a phone; run returns a safe
HOLD while the phone is absent, locked, asleep or ambiguous and leaves the job
pending. The server cannot unlock the phone, tap the game, send HID, run a
shell or write qualification evidence. All MCP instances share a
kernel-released per-device lease: setup and queue draining for one ADB serial
are serialized, and a competing operation returns `HOLD device-busy` or waits
when a bounded wait was asked for. `cue.queue.enqueue` takes an optional
idempotency key so retries from several agents do not duplicate jobs.

## The lab

The pure queries are in `@sixam/review` (`consequence.mjs`, `mistakes.mjs`,
`roadmap.mjs`, the promotions query), and the lab joins them with git, this
host's `/proc`, the Companion queue and the push-gate record. The MCP server
serves `status`, `next` and `doctor` from the same functions as `lab.status`,
`lab.next` and `lab.doctor`. Every answer is a `claim-envelope-v1`. The lab
writes only its own untracked state (`artifacts/lab/session.json`, then
`artifacts/lab/sessions/<id>.json`), never commits, never touches the phone,
prints every remedy without running it, and never writes the owner's override.

| File | Kind | Purpose and interface |
|---|---|---|
| `src/device-cli.js` | CLI | `npm run device:campaign`, `device:preflight`, `device:clockmap`, `device:grade` (the `fnaf2-device` bin): the campaign's command line, above. `tools/architecture-test.js` holds its `--confirm-live` gate and refuses a second live command. |
| `src/mcp.js` | module | `createCompanionMcp()`: the Companion tools over `tools/device/companion-setup.sh` and `companion-queue.sh`, a closed vocabulary with no coordinates, HID or shell. |
| `src/companion-mcp.mjs` | MCP server | The `fnaf-solver` stdio server (`npm run device:mcp`): the four `cue.*` tools, the solver verbs of `@sixam/review/solver` (`describe`, `query`, `review`, `promote`, `check`), `jobs`, `truth` and `lab.status`, `lab.next`, `lab.doctor`, fourteen tools in all, every answer a `claim-envelope-v1`. Was `tools/device/companion-mcp.mjs`. |
| `src/lab.mjs` | module | `createLab({root})`: the seven verbs over one checkout, each returning a validated envelope, and `LAB_VERBS`, the verb table every door reads. `status` joins HEAD and its push-gate record (`tools/push-gate.mjs` appends `push-gate-run-v1` lines to the main checkout's `artifacts/lab/push-gate.jsonl`), sync with origin as of the last fetch, each ROADMAP step's state, the promotions query, the lease (the owner record, never the lock), the queue (`companion-queue.py list --json`), the overnight window's records, ADRs still proposed, and the doctor's count. `next` ranks an open session, doctor findings that stop every commit, each step not closed whose needs are closed (ROADMAP order), pending decisions and the push gate. `start` writes the session and prints the matching mistake-register entries. `commit --dry` runs `.githooks/commit-msg` itself on the staged set and message, and classes the stage. `end` classes each first-parent commit since the session's base (or `--since`) and closes the session. `morning` reads windows, queue activity and packs since the last 18:00. `doctor` checks hooks, stale PENDING jobs (72 h), orphaned push-gate worktrees, idle unlocked agent worktrees (24 h), the `@sixam` scope, the local profile, generated-catalog drift at HEAD (in a throwaway worktree, as push-gate builds one), memory under 1536 MB beside a process over 1 GB, and untracked winners. Tests replace the promotions query, packs, queue and host. |
| `src/cli.mjs` | CLI | `npm run lab -- <verb> [--json]`: text, or the envelope with `--json`. Exit 0 for a claim, 1 for a refusal or a predicted hook refusal, 2 on a usage error. |
| `test/device-cli.test.js` | check | The device CLI's grammar: help is side-effect free; unknown, missing and retired commands (`dry-run`, `live`, `calibrate`) and malformed `clockmap` calls fail closed; a one-attempt diagnostic campaign is accepted and zero attempts refused. `test:contracts`. |
| `test/companion-mcp.test.mjs` | check | Stdio MCP regression: initialize, the tool catalog (the four `cue.*` names first and unchanged, at most fifteen tools, none an actuator, every schema closed), queue persistence and refusals, every verb and resource in `claim-envelope-v1`, `truth` over a synthetic local dump and refused without one, a refused promote, and no write under `docs/evidence`. `test:contracts`. Was `tools/device/test-companion-mcp.mjs`. |
| `test/lab.test.mjs` | check | Every verb against temporary git repositories that copy the real hook, register and ROADMAP: status without and with a push-gate record, a proposed ADR pending until a commit carries the override; `commit --dry` refusing a docs-only stage, accepting it with a prior-evidence reference (still bookkeeping), an evidence record (consequential) and controller code alone (UNKNOWN); a session over docs-only, evidence and code-with-gate commits giving 2:1; `next` ranking a fix, then S1's queue command, then S2, with S3 blocked; eleven planted doctor findings, each with its remedy, then none once fixed; `morning` over a window record, a failed night job and an uncommitted win pack. `test:unit`. |

## Scripts

Entry points and checks that lived in `tools/` until the ADR 0002 layout
moved them here, with the description their tool index gave them.

| Script | Kind | What it does |
|---|---|---|
| `src/night.js <fnaf2\|fnaf1\|fnaf1-custom\|fnaf1-winner> [runner options]` (`npm run night`) | device action launcher | One entry point for a night on the phone: runs `tools/device/night-run.sh`, `fnaf1-night-run.sh`, `fnaf1-custom-run.sh` or `fnaf1-winner.mjs` (a committed FNaF 1 winner, re-run from its pinned commit) with the options untouched (each keeps its own lease, confirm flags and dry run; every runner is dry unless given `--live --confirm-live`, and a live one reads the serial from `FNAF_SERIAL` or the local profile), waits through a Ctrl-C for the runner's own abort, then packs every FNaF 1 run directory the night created (`npm run evidence -- pack`). FNaF 2's runner packs its own campaigns. |
| `test/night.test.js` | check | Phone-free: fake runners in a throwaway tree; the arguments reach the runner untouched, a new FNaF 1 run directory is packed even when the runner exits nonzero, older and other games' directories are not, FNaF 2 is only dispatched, and an unknown game is refused. |
| `src/probe.js` | report | `npm run probe`. Asks this machine for README.md's prerequisites and prints one line per check (`ok`, `warn` or `missing`): Node 20+ (CI uses 22), `npm ci`, Java 17, Python 3.12 with Pillow, NumPy and SciPy, ffmpeg, a full-history clone, and Docker for the rebuild; then a `Ready:` line per route (Story, Strategies, Claims, Full tests, Rebuild, and Phone, which is never probed) and one `Next:` suggestion. The versions are read from `ci.yml`. It runs only version flags, `git rev-parse` and `docker info` on a local socket: no phone, no network (a daemon at `DOCKER_HOST` or behind a remote context is named, not contacted). Node built-ins only, so it runs before `npm ci`; it always exits 0. |
| `test/probe.test.js` | check | Runs `apps/desktop/src/probe.js` on this machine for its shape, on an empty PATH (every external check `missing`, exit 0), and on fake `java`, `python3`, `ffmpeg`, `git` and `docker` programs that pin the parsing; the fake docker records any `docker info`, and a remote context or `DOCKER_HOST` must leave no record. `test:unit`. |
