# The lab: operator verbs

`npm run lab -- <verb>` answers the questions a session starts and ends with,
from git, the committed evidence and this host, never from prose (ADR 0002
principle 4). Every verb prints text, or with `--json` the `claim-envelope-v1`
the `fnaf-solver` MCP server returns. Code: [`apps/desktop`](../../apps/desktop/README.md);
the pure queries are in [`@sixam/review`](../../packages/review/README.md).

| Verb | Answers |
|---|---|
| `status` | HEAD and whether `npm run push-gate` ran on it (the gate appends a record; none means "not run", with the command), sync with origin as of the last fetch, each ROADMAP step S1-S7 open, closed or UNKNOWN with its reason, the promotions summary, the phone lease and queue (stale PENDING jobs flagged), ADRs still proposed, and the doctor's finding count |
| `next` | The work to take now, ranked: an open session, doctor findings that stop every commit, then each step in the ROADMAP order that is not closed and whose needs are closed, with the command its open items call for; pending decisions; the push gate. Blocked steps are listed with what they wait on |
| `start --step S<n> --artifact "<what>"` | Records the session in untracked `artifacts/lab/session.json` and prints the mistake-register entries that apply to the step's areas or to words in the artifact |
| `commit --dry [-m MSG \| -F FILE]` | Whether `.githooks/commit-msg` would accept the staged set and message (the hook itself runs), and the stage's consequence class. The lab never commits |
| `end [--since SHA]` | The consequential:bookkeeping ratio of the commits since `start` (or `SHA`), the records they committed, and what stays open for the step |
| `morning [--since ISO]` | Overnight window records, queue activity and run packs since the last 18:00, and what to do about them; "nothing since" when there is nothing |
| `doctor [--no-catalog]` | Hooks, stale queue jobs, orphaned push-gate worktrees, idle agent worktrees, workspace links, the local profile, generated-catalog drift at HEAD, memory, untracked winners: each finding with the command that fixes it. It runs none |

A session goes `status`, `next`, `start`, `commit --dry` before each commit,
and `end`, whose ratio is the closing line CLAUDE.md asks for.

## The consequence class

`packages/review/src/consequence.mjs` reads paths only, and `commit --dry` and
`end` share it:

- **consequential**: the change stages a record (a run pack, the evidence
  graph, an evidence record under `docs/evidence/`, a host record under
  `tools/recompile/results/`, a committed winner, or staged `artifacts/`), or
  code in the Companion, the controller, the trainer or the solver interface
  with a gate in the same change;
- **bookkeeping**: docs, plans, markdown, gates alone, generated catalogs,
  configuration, or code outside those four areas, with no record;
- **UNKNOWN**: code in one of the four areas with no gate beside it, since
  paths cannot tell whether an existing gate exercises it. `end` counts it
  outside the ratio.

A reference to prior evidence in the message lets the hook accept a change, and
does not change its class.

## What it reads and writes

The lab reads the push-gate record (`artifacts/lab/push-gate.jsonl` in the main
checkout), the Cue Helper queue and lease files, the overnight window's records
and `/proc`. It writes only `artifacts/lab/session.json` and, at `end`,
`artifacts/lab/sessions/<id>.json`. `doctor` builds and removes one throwaway
worktree for the catalog check and deletes nothing else. Over MCP, `lab.status`,
`lab.next` and `lab.doctor` are read-only; `lab.doctor` there leaves out the
catalog check.
