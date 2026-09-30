# `apps/desktop`

The composition root of the final layout ([ADR 0002](../../docs/decisions/0002-kernel-contexts-vocabulary.md)).
Today it holds the operator verbs, `npm run lab -- <verb>`: status, next, start,
commit, end, morning and doctor ([`docs/operations/LAB.md`](../../docs/operations/LAB.md)).
It is a plain folder, not a workspace: it has no dependencies of its own and
resolves `@sixam/*` through the root `node_modules`.

It composes; it does not decide. The pure queries are in `@sixam/review`
(`consequence.mjs`, `mistakes.mjs`, `roadmap.mjs`, the promotions query), and
this folder joins them with git, this host's `/proc`, the Cue Helper queue and
the push-gate record. The `fnaf-solver` MCP server serves `status`, `next` and
`doctor` from the same functions as `lab.status`, `lab.next` and `lab.doctor`.

Every answer is a `claim-envelope-v1`. The lab writes only its own untracked
state (`artifacts/lab/session.json`, then `artifacts/lab/sessions/<id>.json`),
never commits, never touches the phone, prints every remedy without running it,
and never writes the owner's override.

| File | Kind | Purpose and interface |
|---|---|---|
| `src/lab.mjs` | module | `createLab({root})`: the seven verbs over one checkout, each returning a validated envelope, and `LAB_VERBS`, the verb table every door reads. `status` joins HEAD and its push-gate record (`tools/push-gate.mjs` appends `push-gate-run-v1` lines to the main checkout's `artifacts/lab/push-gate.jsonl`), sync with origin as of the last fetch, each ROADMAP step's state, the promotions query, the lease (the owner record, never the lock), the queue (`cue-helper-queue.py list --json`), the overnight window's records, ADRs still proposed, and the doctor's count. `next` ranks an open session, doctor findings that stop every commit, each step not closed whose needs are closed (ROADMAP order), pending decisions and the push gate. `start` writes the session and prints the matching mistake-register entries. `commit --dry` runs `.githooks/commit-msg` itself on the staged set and message, and classes the stage. `end` classes each first-parent commit since the session's base (or `--since`) and closes the session. `morning` reads windows, queue activity and packs since the last 18:00. `doctor` checks hooks, stale PENDING jobs (72 h), orphaned push-gate worktrees, idle unlocked agent worktrees (24 h), the `@sixam` scope, the local profile, generated-catalog drift at HEAD (in a throwaway worktree, as push-gate builds one), memory under 1536 MB beside a process over 1 GB, and untracked winners. Tests replace the promotions query, packs, queue and host. |
| `src/cli.mjs` | CLI | `npm run lab -- <verb> [--json]`: text, or the envelope with `--json`. Exit 0 for a claim, 1 for a refusal or a predicted hook refusal, 2 on a usage error. |
| `test/lab.test.mjs` | check | Every verb against temporary git repositories that copy the real hook, register and ROADMAP: status without and with a push-gate record, a proposed ADR pending until a commit carries the override; `commit --dry` refusing a docs-only stage, accepting it with a prior-evidence reference (still bookkeeping), an evidence record (consequential) and controller code alone (UNKNOWN); a session over docs-only, evidence and code-with-gate commits giving 2:1; `next` ranking a fix, then S1's queue command, then S2, with S3 blocked; eleven planted doctor findings, each with its remedy, then none once fixed; `morning` over a window record, a failed night job and an uncommitted win pack. `test:unit`. |
