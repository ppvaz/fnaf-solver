# Retired FNaF 2 bindings

A binding here is no longer one to run: no census, campaign or MODEL_ONLY scan
reads this directory (they list `bindings/<game>/*-winner.json`, one level).
Custody still does (`custodyWinnerFiles` in `evidence-pack.ts`, and the
`winner-hashes.json` register marks these rows `retired`), so a run pack that
ran one keeps `winnerCommitted` and its promotion. A binding keeps its bytes
because frozen evidence records pin it by path and sha256; their readers follow
it here through git's rename (`renamed-path.ts`).

| Binding | Retired | Why |
|---|---|---|
| `campaign-night1-minus7-winner.json` | 2026-09-30 | Pedro: "minus 7 at night 1? that dumb, remove it immediately. night 1 has a specifically baked minimal input schedule that should be the canonical one" (`campaign-night1-minimal-winner.json`). It stood MODEL_ONLY: no run pack names it. The 2026-09-19 phone win ran the earlier `campaign-night1-minus7-n1-first-winner.json`. |
| `campaign-night1-minus7-n1-first-winner.json` | 2026-09-30 | Pedro: "yes retire". The binding the 2026-09-19 phone 6 AM ran (`night1-minus7-n1-first-20260919T215533Z`, promoted); the promotion stands on custody. Night 1 runs `campaign-night1-minimal-winner.json`. `mechanic-constraints.test.js` reads it as the one glitchless fixture. |
