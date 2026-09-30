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
The device profiles are Play's too, in
[`packages/play/profiles/fnaf2/moto-g56/`](../../packages/play/profiles/fnaf2/moto-g56/)
since 2026-09-30; records written before then cite `apps/device/profiles/`,
and their readers follow the file through git's renames.

## The device command line

`device-cli.js campaign` chooses the profile, loads the default ports module
(`packages/play/src/campaign/modern-campaign-ports.js`), and plays a validated
bundle only with `--live --confirm-live`. `packages/play/bin/phone/night-run.sh` drives it
for every night, and forwards that pair only when it is itself given `--live
--confirm-live`: it is dry by default (ADR 0002). The serial comes from
`--serial`, `FNAF_SERIAL` or the untracked local profile
(`packages/play/bin/phone/local-profile.mjs`). Commands: `device:campaign`,
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
FILE`: `MATCH` passes, `DRIFT` fails and names each field and the remedy,
`UNKNOWN` holds, and `UNBOUND` passes an inspection but fails a live campaign.
`--bind-venue FILE --by NAME` records a binding from the phone. The rules are in
[`docs/operations/DEVICE-SAFETY.md`](../../docs/operations/DEVICE-SAFETY.md#venue-identity-pedro-2026-09-29).

A live campaign also requires `--bundle DIR` with one full-night plan per
requested night, `--calibration FILE` with measured Custom Night menu and dial
readback geometry, and an artifact-bound `DEVICE_MEASURED` qualification. The
campaign returns `HOLD` until those files and the device-local executor are
present; it never guesses a Custom Night coordinate or treats a completed
executor as a win. The lease, abort and release rules are DEVICE-SAFETY's.

```sh
npm run device:emit -- --winner packages/propose/bindings/fnaf2/campaign-night7-k3-winner.json --out /tmp/k3
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
| `src/mcp.js` | module | `createCompanionMcp()`: the Companion tools over `packages/play/bin/companion/companion-setup.sh` and `companion-queue.sh`, a closed vocabulary with no coordinates, HID or shell. |
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
| `npm run device:emit -- --winner winner.json --out artifacts/run-001 [--forbid-mechanic ID ...]` | compiler/check | Converts a `winner-v1` into an immutable `device-bundle-v1`: `manifest.json`, one `night-N.plan` per requested night, the resolved `profile.json`, and hashed transport-neutral `artifact.json` semantic blocks. It validates interpreter syntax, controls, contacts/timings, policy/night/profile identity, content hashes, and a bounded exact-engine replay before returning `READY`; the strategy registry contains `minus-toys`, `minus3`, and `minus7`. `--forbid-mechanic fnaf2.camera-split` refuses `minus-toys` and `minus3`, which require the split. |
| `npm run device:campaign -- --guided [--json]` | guided preflight | Prints the single Custom Night calibration session: measured menu/dial points, readback boxes, and start control. It does not touch a phone. |
| `npm run device:campaign -- --live --confirm-live --bundle DIR --calibration FILE --qualification FILE` | supported-live gate | Runs closed ADB preflight plus campaign gates; it remains `HOLD` until a matching Night 6/7 bundle, measured Custom Night calibration, external `DEVICE_MEASURED` qualification, device-local executor, and positive lifecycle/save proof ports are composed. |
| `apps/desktop/src/night.js <fnaf2\|fnaf1\|fnaf1-custom\|fnaf1-winner> [runner options]` (`npm run night`) | device action launcher | One entry point for a night on the phone: runs `packages/play/bin/phone/night-run.sh`, `fnaf1-night-run.sh`, `fnaf1-custom-run.sh` or `fnaf1-winner.mjs` (a committed FNaF 1 winner, re-run from its pinned commit) with the options untouched (each keeps its own lease, confirm flags and dry run; every runner is dry unless given `--live --confirm-live`, and a live one reads the serial from `FNAF_SERIAL` or the local profile), waits through a Ctrl-C for the runner's own abort, then packs every FNaF 1 run directory the night created (`npm run evidence -- pack`). FNaF 2's runner packs its own campaigns. |
| `apps/desktop/test/night.test.js` | check | Phone-free: fake runners in a throwaway tree; the arguments reach the runner untouched, a new FNaF 1 run directory is packed even when the runner exits nonzero, older and other games' directories are not, FNaF 2 is only dispatched, and an unknown game is refused. |
| `apps/desktop/src/probe.js` | report | `npm run probe`. Asks this machine for README.md's prerequisites and prints one line per check (`ok`, `warn` or `missing`): Node 20+ (CI uses 22), `npm ci`, Java 17, Python 3.12 with Pillow, NumPy and SciPy, ffmpeg, a full-history clone, and Docker for the rebuild; then a `Ready:` line per route (Story, Strategies, Claims, Full tests, Rebuild, and Phone, which is never probed) and one `Next:` suggestion. The versions are read from `ci.yml`. It runs only version flags, `git rev-parse` and `docker info` on a local socket: no phone, no network (a daemon at `DOCKER_HOST` or behind a remote context is named, not contacted). Node built-ins only, so it runs before `npm ci`; it always exits 0. |
| `apps/desktop/test/probe.test.js` | check | Runs `apps/desktop/src/probe.js` on this machine for its shape, on an empty PATH (every external check `missing`, exit 0), and on fake `java`, `python3`, `ffmpeg`, `git` and `docker` programs that pin the parsing; the fake docker records any `docker info`, and a remote context or `DOCKER_HOST` must leave no record. `test:unit`. |
| `apps/desktop/test/test-fnaf1-winner.mjs` | check | Phone-free: for every committed FNaF 1 route winner, a re-run executes the pinned route byte for byte or nothing -- the replay materializes the commit whole, its lease and arguments are the won command's, the pinned runner's own parser reads them as the won options, workspace packages resolve inside the pinned tree, and the tree's runner refuses the winner's night while its route drifts. The winner names the census of its own route (`census`), which must be of its pinned grid420 at its commit with the options its runner passed, on today's timing model, whose counts add up, and whose first listed losses and some held-out wins replay as recorded with the pinned policy; no census, the tree route's census, other options, a loss a frame off and counts that do not add up are each refused by name. Controls: the old unguarded runner fails the property; a changed byte, a lost executable bit, a workspace link into the checkout, a pin the commit lacks, an abbreviated or absent commit and a command with shell syntax are each refused by name; winner custody tells an untracked, a committed and a locally edited winner apart; a winner whose pins the tree holds runs from the tree. Needs full history (CI: `fetch-depth: 0`). `test:unit`. |
| `apps/desktop/bin/fnaf1-custom-run.mjs` | module | The implementation behind `fnaf1-custom-run.sh`; refuses a live run without the lease, refuses calibration at any dial but 0, refuses 1/9/8/7 and a `grid420` run without detectors. |
| `apps/desktop/test/test-native-regions.mjs` | check | Phone-free gates for FNaF 1's input rules and the device lane, and for the REGION codec, the FNaF 1 classifier (including the flicker rule) and the Custom Night runner's refusals. |
| `apps/desktop/bin/fnaf1-custom-run.sh [--dry-run] \| --live --confirm-live --dials F,B,C,X --mode calibrate-empty\|grid420 [--detectors FILE] [--winner FILE \| --route tree] [--teach] [--video] [--stop-after-ms MS] [--label NAME]` | **device action** | Dry without `--live` (no adb, no lease, no serial). One FNaF 1 Custom Night under the serial lease (serial from `FNAF_SERIAL` or the local profile), observed only through the Companion (SNAP for the title and dials, REGION for the night). It enters by the menu probe's measured path, sets the dials with a read after each press, presses Ready, and records every native-region frame. `calibrate-empty` (0/0/0/0 only) runs an open-loop tour of every route control; `grid420` drives `packages/propose/bin/census/fnaf1-device-lane.mjs`'s policy on the phone from the first office frame, with the lane's `PHONE_OPTIONS`. A grid420 night a committed FNaF 1 winner names runs from the tree only while the tree holds that winner's pinned files byte for byte (`routeStatus`); a drifted tree is refused with the replay command, unless `--route tree` runs the tree's route knowingly. Every grid420 record carries the route's file hashes and whether they are a winner's. `--teach` narrates the night on the Companion's FNaF 1 teach panel; `--video` records a local demonstration video, which starves the helper's capture (see CLAUDE.md). It leaves by a title-gated restart. |
| `apps/desktop/bin/deathchart.mjs --night=N[,N...] [--runs=1200] [--cols=2] [--out=F.png]` | report | **What is killing a night**, as one SVG. The model gate counts every death and prints only its top four; on Night 2 that cut reads "Foxy, mostly" when Foxy is 58% and the office is 42%. This charts the whole census by the engine's own `kill()` reasons -- never a taxonomy invented here -- one pie plus its full detail table per night, colour fixed per character so two panels can be compared. Survival is printed with its Wilson interval, and each cause also carries its **median time of death** on the in-game clock -- `death-census.py`'s lesson, that faces without times ship the wrong cause. Writes a PNG via the same headless Chrome the `--browser` checks use, keeping the SVG source beside it; with no Chrome it says `UNKNOWN(...)` and exits 3 rather than leaving a PNG nobody wrote. A **simulator** census: it prices no screencap, dropped contact or desync, and the image says so and stamps its build. A new engine death cause with no slice fails `test-deathchart.mjs` rather than vanishing from the picture. It prices Propose's model gate, so Review cannot hold it, and it renders through `tools/chrome.mjs`, which Propose's command lines may not import (`tools/architecture-test.js`, rule `propose-bin`), so it sits with the composition root. |
| `apps/desktop/test/test-deathchart.mjs` | check | Mock regression for the death chart. Pins the three ways it could silently lose a death: an engine `kill()` reason with no slice (read off `packages/source/src/games/fnaf2/plant-model.js`, not a second list here), slices ordered by count rather than by character (which repaints Foxy between two panels meant to be compared), and a label overrunning its count column. Also pins that the image names its night, sample, bar and build, and that it says it is a simulator census. |
| `apps/desktop/test/test-native-regions.mjs` | check | Phone-free gate for the REGION codec, the FNaF 1 classifier (including the flicker rule), the teach panels' clearance of every region a route reads, and the Custom Night runner's refusals. |
