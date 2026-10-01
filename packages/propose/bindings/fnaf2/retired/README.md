# Retired FNaF 2 bindings

A binding here is no longer one to run, and no gate, census or campaign scan
reads this directory (they list `bindings/<game>/*-winner.json`, one level).
It keeps its bytes because frozen evidence records pin it by path and sha256;
their readers follow it here through git's rename (`renamed-path.ts`).

| Binding | Retired | Why |
|---|---|---|
| `campaign-night1-minus7-winner.json` | 2026-09-30 | Pedro: "minus 7 at night 1? that dumb, remove it immediately. night 1 has a specifically baked minimal input schedule that should be the canonical one" (`campaign-night1-minimal-winner.json`). It stood MODEL_ONLY: no run pack names it. The 2026-09-19 phone win ran the earlier `campaign-night1-minus7-n1-first-winner.json`. |
