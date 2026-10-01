# ADR 0002: Kernel, contexts and vocabulary

**Status:** proposed 2026-09-29; accepted by the commit that carries Pedro's
`PEDRO-OK`. M5b's code waits on it.
**Decision:** freeze the vocabulary, the principles, the evidence labels,
GameRun, custody and Annotation, and the five contexts, and treat everything
else as v1, expected to move. The kernel changes only by a later ADR.

## Context

Plan 22 closed 2 of its 10 rows, and on 2026-09-25 `903ffab` deleted its ports
because nothing that played a night used them. The objectives have converged
since (ROADMAP S1-S7), but the means still churn: from 09-01 to 09-28
`tools/device` saw 791 file changes, and `tools/recompile` had 49 commits in
five days. This ADR therefore freezes only what has at least two consumers
today. It was drafted from an eleven-report architecture review against HEAD
`1b76e7e` and from Pedro's answers of 2026-09-29, listed at the end.

## The five contexts

Each context sits in one charter layer, and CLAUDE.md's five layers stay.

| Context | Layer | Owns |
|---|---|---|
| Source | Truth | acquire, decompile, read, derive, recompile; one Rulebook per game, the night model, Sim rules (`[SOURCED gN]`), the identity chain APK -> CCN -> dump -> Rulebook and CCN + patch -> binary |
| Propose | Decision | strategies, policies (the finite IR of `policy-program-v1`), controllers (`controller-v1`), experiments with competing explanations, census populations, `translate` |
| Play | Embodiment | venues, the player runtime, campaigns and save state, probes and calibrations, admissibility, the phone's safety envelope |
| Review | Proof | instruments that classify, measure and tag, and write annotations; claims, promotions and status are queries. Review never imports Play or Propose. |
| Teach | Understanding | the trainer: people as players, coaches, lessons, exercises; its 13 registered contracts |

Two placements differ from `PROJECT-CHARTER.md`'s layer table, and this ADR
records them:

1. **The recompile's build lives in Source (Truth).** The charter lists the
   faithful recompile under Embodiment. The build is a second reading of the
   same compiled logic; running it is a venue in Play.
2. **Calibrations are produced in Play and recorded as Truth.** The charter
   lists calibration under Truth. The probes that measure them run in Play;
   the facts they produce carry the `CALIBRATED` source label.

Imports run `kernel <- source <- play <- propose -> review -> source`.

## The kernel

Every context shares these. New stored formats take kernel names
(`game-run-v1`, `annotation-v1`), and readers lift v1 records into them.

- **Time:** `Update` (the game's loop index, primary on stepped venues), `Ms`,
  `Interval{lo, hi}`, `ClockDomain` (device-monotonic, boottime, phone wall,
  host), a `ClockTrace` per domain, and a night-clock kind per Rulebook:
  accumulator (FNaF 1, 2) or wall clock (FNaF 3, 4).
- **Labels, closed enums that never promote one another:** `ClaimLevel`
  (`MODEL_ONLY | FIXTURE | DEVICE_MEASURED`) and `SourceLabel`
  (`SOURCED | CALIBRATED | MEASURED | INFERRED | MODEL | UNKNOWN(reason)`).
- **Reading:** what a sensor reads (stored as `label` in old events).
- **Fact<T>:** `{signal, value | UNKNOWN(reason), at, receivedAt?, producer, quality?}`.
- **Press:** `{control, kind: tap | hold(ms) | holdUntil(fact) | ensure(state), at, contacts?}`,
  with `PressResult` `landed | lost | merged | refused(why) | unstable | UNKNOWN`.
- **Outcome:** `SixAM | Death{by, how, rule, at} | Timeout | Aborted(why) | Invalid(why) | UNKNOWN`,
  plus `wouldDie[]` for non-lethal runs. Venues report an outcome; Review decides it.
- **Seed:** provenance `natural | pinned(bracket) | identified` and belief
  `known | candidates(set) | unknown`. Adversarial is an RNG mode, not a seed.
  "Origin" keeps its code meaning, the night's time zero.
- **RunSpec, GameRun, Census:** a GameRun is one night played once, with its
  spec, venue, `runMode`, clocks, before/night/after events, reported outcome,
  witnesses and custody. A Census is a computation over a population (policy,
  family, seeds, held-out block, perturbation, constants) with its counts.
- **Annotation:** `{subject, instrument@version, class | measure | tag, value,
  inputs: Hash[], by, status: standing | superseded(by) | retracted}`. The
  subject may be a GameRun, a set of them, a Census, a rule `g###`, a policy, a
  calibration or a chronicle entry.
- **Claim:** a statement plus the query that decides it.
- **Experiment, Projection, Divergence:** an experiment names its competing
  explanations and the observation that separates them; a comparison names the
  projection it looks at; a divergence records the first observed disagreement
  and the first divergent hidden state.
- **VenueIdentity:** runtime, placement, game `versionCode` with install and
  update time, OS build fingerprint and patch level, Companion version, handset
  hash, instrumentation. Any change demotes a qualification.

Ports: Rulebook, Venue (with capabilities, including steppable), Player
(Controller, Policy or Person, with an optional Coach), Instrument,
ContentVault, EvidenceVault. Sensor and Actuator are named but provisional: a
port becomes an interface only at its third implementation. Verbs: `propose`,
`play(spec, venue, dry | shadow | replay | live)`, `probe`, `review`, `query`,
`translate`.

The 47 contracts in `packages/core/contracts/register.json` keep their ids.
Eight map to the kernel, 5 to Propose, 20 to Play, 1 to Review and 13 to Teach.
`session-manifest-v1` and `device-artifact-v1` are deprecated, and the two
grid-based rules are converted, not extended.

## Vocabulary

The first seven words are **Source, Rulebook, Venue, GameRun, Press, Review,
Claim**. New words enter through prose and through code that is created or
moved. **Stored names never change:** schema and contract ids, JSON keys,
control ids, Sim event strings (they feed winner hashes) and npm script names.

| Use | Not | Why |
|---|---|---|
| label (claim level, source label) | label for a sensor output | "label" is the central invariant; a sensor's output is a Reading |
| Instrument | Step | `grade-run.sh`'s word; "step" means S1-S7 and lesson steps |
| Update | Frame (as time) | a Clickteam frame is a scene |
| producer | Fact.source | avoids the Source context |
| Seed (provenance, belief) | Origin | "origin" is a night's time zero |
| night model | Clockwork | `games/night-model.js` exists |
| runMode | mode | "Minus 3 mode" and "10/20 mode" are plan titles |

`winner`, `binding`, `anchor`, `rung` and `claim level` keep their glossary
meanings.

## Principles

1. One meaning per word, checked against the repository before a name is adopted.
2. UNKNOWN is a value with a reason, never a default.
3. Venues report outcomes; Review decides them.
4. Nothing about current state is written as prose. Status is a query.
5. The kernel changes only by a recorded decision (an ADR).
6. Every port has a bench on the fastest venue that measures its metric. The
   code under change never computes its own metric.
7. No sandbox. Claim-bearing cohorts and censuses are pre-registered.
   Diagnostic sweeps name the explanation they test.
8. Change locality: an ordinary extension touches one implementation, one
   registration and its tests. Everything carries a lifecycle state and an owner.
9. Stored names never change. Files may move; their stored names may not.
   A path cited inside a frozen JSON record is read as relative to the commit
   that wrote it.
10. Rule of three for ports.
11. An independent witness decides a promotion: a graded video, or a save
    advancement read by another instrument, must agree with the venue's report.
    The attester and the custody class show beside every number.
12. The world under a venue is measured, not assumed. Drift refuses the run and
    demotes the qualification.

**Plan 22's principles:** 3, 4, 6, 7 and 9 are kept; 1 is rewritten ("the
Source is canonical"); **2 and 5 are dropped (Pedro, 2026-09-29)**; 8 is
dropped by principle 7 above, and `research/sandbox` retires in M5b. The
charter paragraph that restates Plan 22's principle 2 ("research interfaces to
the same evidence base, not rival projects") is reconciled in commit C.

## What is frozen, and what is v1

**Frozen:** the vocabulary and its mapping from every existing name; the
principles; the two label enums; GameRun, custody and Annotation; the five
contexts; the venue-grid method with its shared-assumptions register; stored
names; principle 11.

**v1, expected to move:** Sensor and Actuator; where decisions run (host or
Companion) until S4; the MCP verbs and the claim envelope until Plan 28 lands;
Review's tag semantics; Census and Population details until S3; the
Sim/recompile split if S2 shows the rebuild is faithful; the least-certain
placements in the package layout.

## Consequences

- M5b (`packages/review`, kernel types, a pack importer, a promotions query
  that re-derives the 47 edges) may start once this ADR is accepted. It has no
  time-box (Pedro, 2026-09-29).
- The rename keeps Plan 27's name, `fnaf-solver`, and the `@sixam/*` scope.
  The MCP server becomes `fnaf-solver` in commit A. GitHub does not redirect
  project Pages after a rename, so `ppvaz.github.io/fnaf2-1020/` breaks; every
  link changes in the rename commit, and the old repository name is never
  recreated, because that would end the git redirect.
- Archived plans are frozen byte for byte. A link inside one that a move breaks
  stays broken, and the link check excludes `plans/archive/`.

## Pedro's decisions, 2026-09-29

Taken with this ADR, in answer to the architecture review's open questions.

| # | Question | Decision |
|---|---|---|
| 1 | Play auto-update | Off for FNaF 1-4. Preflight records `versionCode`, first-install and last-update time, build fingerprint and security patch, and refuses on drift from the bound profile. |
| 2 | Overnight window and notifications | Do Not Disturb and heads-up suppression on at window open, the prior setting restored at close; the window refuses if it cannot set them. |
| 3 | Does an Invalid run spend a campaign attempt? | No. The campaign holds after two consecutive Invalid runs. |
| 4 | Visitors' phone runs | Not project evidence. Only handsets qualified under the project's custody count. |
| 5 | README rewrite | Staged by an agent with links and numbers verified at HEAD; Pedro commits it. |
| 6 | Gameplay GIFs | A written exception: at most two README clips, each 4 MB or less; a gate refuses any other game media. The four `tearing-vs-flash` test frames were removed in `b253d98`. |
| 7 | GPL-derived patches | SPDX identifiers and licence texts under `tools/recompile`, and a root `NOTICE` naming what is not MIT. Done in `b253d98`, with REUSE-style `.license` sidecars, because a record cites a patch's sha256. |
| 8 | Handset serial | Read from an untracked local profile with no default; a gate refuses new occurrences; frozen evidence keeps it; no history rewrite. |
| 9 | GitHub topics and description | Applied 2026-09-29 (19 topics to 15). |
| 10 | Commits from a corporate address and from `t <t@t>` | A `.mailmap`; no history rewrite. Done in `b253d98`. Reversed 2026-09-30 (Pedro): history rewritten with `git filter-repo`; the address is gone from every commit and the `.mailmap` from every tree, with dates and contents unchanged (`docs/evidence/history-rewrite-20260930.json` maps the old hashes to the new). Since then commit-msg, pre-push and `test:unit` refuse any address outside GitHub's noreply form (`tools/commit-identity.mjs`). |
| 11 | The Content Vault's host | This Debian host is Pedro's own; the vault stays here and is replicated to the peer. |
| 12 | Decompiled dump text | Cite, never quote: tracked or pushed text may cite `g###`, a file and a line, and paraphrase, but never copy dump lines. A commit-msg check refuses dump-shaped text. Past commits stay. |
| 13 | This ADR | Drafted by an agent, signed by Pedro. |
| 14 | Plan 22 principles 2 and 5 | Dropped. |
| 15 | The trademark in `fnaf-solver` | Kept, as descriptive use with a non-affiliation notice. |
| 16 | The Pages URL after the rename | The break is accepted. |
| 17 | The MCP server's name | `fnaf-solver`. |
| 18 | S5 participants | Pedro only until a second person plays; a written protocol and consent form come before anyone else's attempt is recorded. |
| 19 | The coach during counted study nights | Off. Coached nights are practice and never count toward `P(win | H)`. |
| 20 | Withdrawal | A participant's attempts stay in the local Evidence Vault, out of git, until they sign off at the study's close; after sign-off they are committed under a pseudonym and frozen. |
| 21 | Time-box for M5b | None. |
| 22 | Closing conditions for S5-S7, and an end state | Drafted in `plans/ROADMAP.md` for Pedro's review. |
| 23 | "No new horizon plan in the week a step closes" | Rejected. |
| 24 | Editing a link in an archived plan after a move | No. |
