# The Chronicle

The Chronicle is the repository's dated index of lessons, measurements, facts,
wrong turns, and trivia. It is deliberately a curated record rather than a
second evidence authority: every finding points back to a tracked path or a
commit, and the evidence record remains authoritative for a claim ceiling.

The source is split into one JSON file per checkpoint window under
[`entries/`](entries/). Add a new month by copying the checkpoint shape into a
new `YYYY-MM.json` file (a second checkpoint in one month takes a letter:
`2026-09b.json`, checkpoint `2026-09b`); do not edit the generated pages by
hand.

```sh
node tools/chronicle-harvest.mjs --since <previous-checkpoint-tip> --json
# review, keep, edit, or drop the candidates
npm run chronicle          # writes docs/portal/chronicle.html and docs/portal/story.html
node tools/test-chronicle.mjs
```

The schema vocabulary is documented in [`entry.schema.json`](entry.schema.json)
(v1) and [`entry-v2.schema.json`](entry-v2.schema.json) (v2), and enforced by
[`tools/chronicle-schema.mjs`](../../tools/chronicle-schema.mjs). The
generated views are [`../portal/chronicle.html`](../portal/chronicle.html) and
[`../portal/story.html`](../portal/story.html). They are deterministic, have no
runtime dependencies or network calls, and keep retracted findings visible with
the entry that superseded them.

## Two checkpoint schemas

`chronicle-entries-v1` is frozen. Its files, `2026-08.json` and `2026-09.json`,
are never edited (`tools/test-chronicle.mjs` pins their bytes), and its rules
never change: stored names never change (ADR 0002 principle 9).

`chronicle-entries-v2` holds `chronicle-entry-v2` entries, which differ from v1
in five fields:

| Field | v1 | v2 |
|---|---|---|
| `game` | absent; every entry is read as `fnaf2`, whose routes and rungs its vocabulary is | `fnaf1`, `fnaf2`, `fnaf3` or `fnaf4`, required |
| `night` | 1-7 | 1 to the last night the game's Rulebook names: 7, 7, 6 and 8 (`nightsOf`, `packages/source/src/clockwork/games.js`) |
| `plan` | 1-24 | any positive integer |
| `label` | `SOURCED`, `CALIBRATED`, `DEVICE_MEASURED`, `INFERRED`, `MODEL`, `UNKNOWN` | the same, plus the two claim levels [`../evidence/README.md`](../evidence/README.md) defines beside `DEVICE_MEASURED`: `MODEL_ONLY` and `FIXTURE` |
| `supersedes` | absent | `null`, or the id of the entry this one corrects |

`route` and `rung` stay FNaF 2's vocabularies (the strategy families and Plan
12's ladder), so a v2 entry of another game carries neither.

**Corrections.** A v2 entry whose `supersedes` names another entry corrects it.
The corrected entry is read as `superseded` by the correction wherever the
corpus is read (the pages, `npm run review`, the MCP resources), while its
frozen file still says `standing`; readers keep that as `storedStatus`. When
both entries are v2, both sides are written: the corrected entry's `status` and
`supersededBy` must name the correction. An entry can be corrected once.

Each v2 entry is derived from a committed evidence record
(`docs/evidence/*.json`, a run pack under `docs/evidence/runs/`,
`tools/recompile/results/*.json` or `docs/evidence/graph.json`) and cites it in
`sources` by path. It never quotes dump text, frames, or the handset serial.

## The Story

[`story.json`](story.json) (`chronicle-story-v1`) lists twelve chapters, each a
title and the ids of the chronicle entries it draws on. That is all that is
curated. `tools/chronicle-story.mjs` generates the rest of each chapter from
the entries' own fields: its dates run from the earliest to the latest of its
entries that still stand, "what it proved" is its standing milestones, facts
and lessons, "what it did not prove" is its refutations, retractions and
negatives, then any superseded entries, and "source" is every path its entries
cite. No chapter text is written by hand (ADR 0002 principle 4), so a
correction moves a chapter's dates by itself.

Each checkpoint contains curated findings rather than a live commit feed. The
generated pulse is derived from those finding dates, so later commits do not
change the page unless a curator adds or edits a checkpoint. The latest
checkpoint may also carry an `outlook` with `next` and `missing` items; the
generator renders that as the chronicle's final section, with the same source
trace discipline as every historical finding. Each outlook item says which
record's view it gives, and is that record's view on its date, not the current
state: status is a query (`npm run review`).
