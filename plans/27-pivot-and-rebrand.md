# Pivot and rebrand: `fnaf2-1020` -> `fnaf-solver`

**Status: done 2026-09-30.** Commit A `1966a033` (scope and MCP server), B
`49a20f4e` (project identity), C `a5979520` (ADR 0002, PEDRO-OK) with the
README rewrite `a370950b`, D `6dd995cc` (per-game vocabulary, the leaked
executor rules, the profile game dimension) with the ADR 0002 moves, and R:
the README and docs links move to `ppvaz/fnaf-solver` in the commit that
precedes the GitHub rename. Proposed 2026-09-19, Pedro's directive. Names
chosen then:
the GitHub repository becomes **`fnaf-solver`**, the npm scope becomes
**`@sixam/*`**. The two are deliberately different: the repo name is
human-facing and wants FNaF discoverability, while the scope appears in 719
import specifiers and wants to be short, game-neutral, and never renamed again.

This plan covers two separable jobs. The **rebrand** is mechanical and touches
45% of the tree. The **pivot** is structural and touches 11 files. They should
not be done in the same commit.

## Why "solver" and not "solution"

Plan 25 horizon 1 is literally titled "Solve the game". The ambition is right;
the tense is not. This repository's discipline is a claim ladder, a retraction
rule, and negatives that stay discoverable — and as of 2026-09-17 it has
**zero `DEVICE_MEASURED` promotions on this machine**. "Solver" names the
activity and stays true either way; "Solution" asserts a result the evidence
ladder does not yet support. If horizon 1 lands, "solver" reads as modesty
rather than as a correction.

## Measured surface (2026-09-19)

| Token | Occurrences | Files | Action |
|---|---|---|---|
| `@fnaf2-1020/*` (scope) | 719 | 204 | -> `@sixam/*` |
| `fnaf2-1020` (bare: repo, dir, root pkg) | 755 | 224 | -> `fnaf-solver` |
| `com.scottgames.fnaf2` in code/config | — | 60 | parameterize per game |
| `com.scottgames.fnaf2` in evidence | — | **19** | **freeze — do not touch** |
| prose "FNaF 2" in `*.md` | 386 | — | case by case; most are correct |
| git remote | 1 | — | `ppvaz/fnaf2-1020` -> `ppvaz/fnaf-solver` |

## The rule that governs all of it: evidence is not branding

`com.scottgames.fnaf2` inside `docs/evidence/`, `docs/chronicle/` and the
device JSON records is **a measurement of what was actually run**, not a label
for this project. Nineteen files carry it in that sense.

**A global `sed` across the repository would falsify the evidence record.** It
would rewrite history into claiming runs happened against a target that did not
exist at the time. This repository keeps retractions and negatives
discoverable precisely so that cannot happen silently.

The same applies to prose: most of the 386 markdown mentions of "FNaF 2" are
*correct* — they describe FNaF 2 work, FNaF 2 mechanics, FNaF 2 results. Only
the ones that mean *"this project"* change. This is the reason the rebrand is a
reviewed edit and not a one-line command.

## The companion APK is already compatible — and must stay that way

Checked 2026-09-19. The Android companion is the only branding that lives **on
the handset**, and it came out lucky: everything expensive is already
game-neutral.

Already neutral, change nothing:

- package `com.ppvaz.fnafcompanion` (says `fnaf`, never `fnaf2`)
- Java namespace `com/ppvaz/fnafcompanion/...`
- FileProvider authority `com.ppvaz.fnafcompanion.files`
- icon resources `cue_helper_icon*`, theme `CueHelperTheme`

Only two artefacts carry the "2", both free to change:

- `android:label="FNaF 2 Companion"` — `AndroidManifest.xml:41`, user-facing
- `fnaf2-companion.apk` — `build.sh:136,138,140`, output filename

### Do not change the application ID

`com.ppvaz.fnafcompanion` is a **device-state identifier, not branding**.
Changing it forces an uninstall/reinstall, and on this handset that means:

- the **accessibility service grant is per-package** and must be re-granted by
  hand in Settings — it cannot be scripted, so it breaks unattended runs
- the **overlay (`SYSTEM_ALERT_WINDOW`) grant is per-package**
- MediaProjection capture consent is tied to the installed app
- Cue Helper reinstall has already caused a device-defect cascade once

The application ID stays. Rename the label and the artefact; nothing else.

Host-side, `.mcp.json` names the server `fnaf2-cue-helper`. Renaming it changes
the MCP tool names in every session (`mcp__fnaf2-cue-helper__*`), which is
cheap but not invisible — do it in the same commit as the scope so tool names
and imports move together.

## The pivot (structural, 11 files)

This is the part that actually makes the repo multi-game, and it is small:

1. **`CONTROL_VOCABULARY` becomes per-game.**
   `packages/core/src/control/vocabulary.js` is a frozen FNaF 2 enum bound to
   `CONTRACT:semantic-control-v1`, referenced at **113 sites across 11 files**.
   FNaF 1/3/4 share only `monitor`. A game module supplies its own vocabulary;
   the contract becomes parametric over it.
2. **Return leaked game rules to core.** `apps/device/src/service.js:32-33`
   decided which controls need the monitor up or down (removed with the fixture
   service path on 2026-09-25);
   `apps/device/src/artifact-executor.js:107-121` pins `camdrop` and
   `observe-left` to specific FNaF 2 controls. Both are mechanics living in a
   transport layer, which the charter forbids.
3. **Device profiles gain a game dimension.** `device-profile-v1` already
   carries `targetBuild` and a named `controlMap`, so this is mostly data —
   one profile per (game, handset) pair.
4. **Rewrite CLAUDE.md's consequence lock for multiple games.** It is currently
   phrased entirely in Night 7 / FNaF 2 terms. A four-game repo needs a rung
   definition that names its target.
5. **Reframe README and PROJECT-CHARTER** from "a FNaF 2 bot" to "a method for
   playing Clickteam night games under evidence, demonstrated on four".

## The move map (measured 2026-09-25)

Commit D's layout, written down so the quiet window is spent moving files, not
deciding where they go. The counts are from the tree at `18684d8`.

**The FNaF 2 cartridge already has a door.** 77 files import
`@fnaf2-1020/core/mechanics` and 26 import `@fnaf2-1020/core/control`; only 13
import a FNaF 2 module by its file path (8 of them `config.js`). Everything
behind the `mechanics` barrel except `rng.js` is FNaF 2. So the cartridge can
move behind the barrels first, with no consumer edited, and consumers can be
repointed at `games/fnaf2` afterwards, one import at a time.

| Today | After the move | Why |
|---|---|---|
| `core/src/mechanics/{plant-model,config,reduced-model,plant,seed-recovery}.js` (3626 lines) | `core/src/games/fnaf2/` | FNaF 2's plant, table and seed recovery: 368, 156, 61 and 20 FNaF 2 terms respectively |
| `core/src/mechanics/rng.js` | stays | the Fusion 16-bit RNG, shared by all four games |
| `core/src/control/{vocabulary,night-policy,controller,cycle-library,cycle-planner,cycle-controller}.js` | `core/src/games/fnaf2/control/` | the FNaF 2 control enum (pivot 1) and the Minus Toys cycle machinery |
| `core/src/control/{policy-ir,observation-language,ports}.js` | stays | the policy language: one FNaF 2 term between them, and the per-game vocabulary is what pivot 1 injects |
| `core/src/mechanics/games/{fnaf1,sim-fnaf1,policy-fnaf1}.js` + `graphs/fnaf1.json` | `core/src/games/fnaf1/{night,sim,policy}.js` + `graph.json` | one directory per game; FNaF 3 and 4 the same way |
| `core/src/mechanics/games/fnaf2.js` | `core/src/games/fnaf2/night.js` | FNaF 2's night in the shared shape; it already holds no numbers of its own |
| `core/src/mechanics/games/{index,night-model}.js` | `core/src/games/{index,night-model}.js` | the cross-game registry stays the one place a cross-game claim is checked |
| `adapters/src/{calibration-state-rule,button-strokes,control-exclusion}.js` | FNaF 2 data under the profile's game dimension (pivot 3) | FNaF 2 controls in the transport layer: 55, 16 and 15 FNaF 2 terms |
| `apps/device/src/artifact-executor.js:107-121` | the FNaF 2 cartridge's action table | the `camdrop` and `observe-left` pins (pivot 2); the other half of that leaked rule, `service.js:32-33`, left with the fixture service path on 2026-09-25 |
| the 26 `tools/device/*fnaf1*` files (7 of them models under `models/`) | `tools/device/fnaf1/` | FNaF 1's device lane, beside FNaF 2's rather than interleaved with it; owned by the FNaF 1 session, so it moves in the quiet window and not before |

Undecided, and named so the move does not decide them by accident:
`core/src/sensing/observer.js` (44 FNaF 2 terms: the watchlist is FNaF 2's
office), `estimation/estimator.js` (15) and `timing/phase-clock.js` (18) are
generic machinery written against FNaF 2's facts. They move only when a second
game's observer or estimator exists to show which half is generic.

Order inside Commit D: move the FNaF 2 files and leave the barrels
re-exporting them (the semantic traces are unchanged by construction: no line
of code changes), run every lane, then repoint consumers, then make the barrels
per-game. The vocabulary becomes a parameter last, because it is the one step
that changes code and not only paths.

## Sequencing, and the honest tradeoff

**Restated 2026-09-25** ([`ROADMAP.md`](ROADMAP.md), step S6): the rebrand
waits for S1's first promotion edge and a confirmed quiet window, not for
custody in full — some of it (the k3 cohort's media) may never be recovered.
The reasoning below, written 2026-09-19, is kept.

The rebrand is **bookkeeping** under the consequence lock, and the standing
directive is Night 7 reliability plus promotion of what is already won, blocked
on custody (`UNTRACKED_WINNER_DEBT` 13 of 13, zero `DEVICE_MEASURED` here).

The tradeoff is real in both directions:

- Renaming **gets monotonically more expensive** with every commit, and every
  line of FNaF 1/3/4 code written under `@fnaf2-1020` doubles the work later.
- But renaming **produces no evidence**, and doing it before custody is
  recovered spends the quiet window on something that moves no rung.

**Recommendation: recover custody first, then rebrand, then write any new-game
code.** The rebrand is the cheapest it will ever be at exactly that moment —
after the bundles are safe, before four games' worth of new modules exist.

A tree-wide rename also **collides hard with peer sessions**, which have staged
broadly with `git add -A`. This needs a confirmed quiet window, not just a
clean local tree.

## Execution order

Each step ends green before the next starts.

1. **Confirm the window.** No peer session holding a dirty tree; local tree
   clean; custody debt resolved or explicitly deferred by Pedro.
2. **Commit A — scope.** `@fnaf2-1020/*` -> `@sixam/*` across the 204 files,
   the 8 `package.json` names, and `.mcp.json`. Then `npm ci` (workspaces and
   the lockfile both move). Mechanical; no prose.
3. **Commit B — project identity.** Bare `fnaf2-1020` -> `fnaf-solver` in
   paths, URLs and root package name. Companion `android:label` and the APK
   artefact filename. **Evidence and chronicle files excluded by path.**
4. **Commit C — prose.** README, charter, CLAUDE.md, plans index: only the
   mentions that mean "this project". Reviewed by hand, not `sed`.
5. **Commit D — the pivot.** Per-game vocabulary and the two leaked rules.
   This one is code and gets a real review.
6. **GitHub rename last.** `ppvaz/fnaf2-1020` -> `ppvaz/fnaf-solver`. GitHub
   redirects the old URL so existing clones keep fetching, but tell peers to
   run `git remote set-url` explicitly rather than relying on the redirect.
7. **Local directory rename** is optional and last; nothing in the tree should
   depend on it. Note `~/.cache/fnaf2-pushgate-tmp` is a local cache path, not
   repo state — harmless to leave, trivial to move.

## Verification after each commit

Per the contracts lane, all three, checked by **exit status** and never piped:

```
npm run typecheck && npm run test:unit && npm run test:contracts
npm run device:emit -- --winner WINNER --out DIR && npm run device:campaign -- --bundle DIR --nights N
npm run push-gate            # TMPDIR=~/.cache/fnaf2-pushgate-tmp
```

`validate-references.js` is the gate that catches a broken cross-link after
steps 3 and 4; it currently resolves 49 stable IDs.

## Rollback

Each step is one commit touching one class of thing, so any red gate reverts a
single commit rather than unpicking a mixed edit. The GitHub rename is
reversible from the repository settings, and the redirect means step 6 cannot
strand a peer mid-work.

## Success

`git grep fnaf2-1020` returns nothing outside `docs/evidence/`,
`docs/chronicle/` and historical plan prose; the contracts lane and
`device:dry-run` are green; the companion still holds its accessibility and
overlay grants on the handset without a re-grant; and the first FNaF 1/3/4
module is written under `@sixam/*` rather than ported into it.
