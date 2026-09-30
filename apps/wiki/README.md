# `apps/wiki`

The generators of the project's published pages. Their output stays in
[`docs/portal/`](../../docs/portal/), which Pages serves: `chronicle.html` and
`story.html` are generated from the frozen entries under
[`docs/chronicle/`](../../docs/chronicle/README.md), never written by hand. The
chronicle's schema and reader belong to Review (`@sixam/review/chronicle-schema`),
because the lab's registers read the same records; a source path a frozen entry
names is linked where the file lives now (`@sixam/review/renamed-path`, ADR 0002
principle 9).

A plain folder, not a workspace: it has no `package.json`, so npm's `apps/*`
glob skips it. Commands: `npm run chronicle`, `npm run chronicle:harvest` and
`npm run test:chronicle`.

## Scripts

Entry points and checks that lived in `tools/` until the ADR 0002 layout
moved them here, with the description their tool index gave them.

| Script | Kind | What it does |
|---|---|---|
| `chronicle.js` | generator | `npm run chronicle`. Builds the deterministic, interactive `docs/portal/chronicle.html` from the curated checkpoint corpus (v1 and v2 checkpoints, with a game filter and each correction shown on the entry it supersedes), and `docs/portal/story.html` through `chronicle-story.js`; the pages are narrative presentations of findings, not a live commit explorer. CI's catalog step diffs both. |
| `chronicle-story.js` | module | The Story page: reads `docs/chronicle/story.json` (`chronicle-story-v1`: twelve chapter titles, each with the chronicle entry ids it draws on) and generates every chapter's dates (earliest to latest standing entry), what it proved, what it did not, and its sources from the entries' own fields; no chapter text is written by hand (ADR 0002 principle 4). `checkStory` refuses an unknown id, an id in two chapters, or a chapter with no standing entry. |
| `chronicle-harvest.js --since COMMIT [--until COMMIT] [--json]` | report | Proposes source-linked candidates from a commit range and dated comments for human/LLM curation. It never writes the corpus or treats a candidate as evidence. |
| `test/chronicle.test.js` | check | `npm run test:chronicle`, in `test:unit`. Verifies corpus vocabulary, source reachability, deterministic generation of both pages, the final outlook section, and harvester shape without device access or claim promotion; pins the frozen v1 checkpoints' bytes; exercises each v2 rule against fixtures (FNaF 4 Night 8 passes, FNaF 2 Night 8 fails, v1 keeps plans 1-24 and its labels, a correction of nothing or a second correction is refused); and checks every story chapter's dates against its standing entries. |
