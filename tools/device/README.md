# Device tools

What stays at this path after the ADR 0002 moves (2026-09-30): the committed
winners (`*-winner.json`, frozen, because every record names them here), the fact
register and its gates, the death chart, and a forwarder for installed units. The
runners, sensors and probes are Play's
([`packages/play/README.md`](../../packages/play/README.md)); the graders are
Review's ([`packages/review/README.md`](../../packages/review/README.md)). The
labels (**check**, **report**, **device action**) are defined in
[`../README.md`](../README.md); anything marked **device action** sends input to
the connected Android device, so confirm the device, focus, screen state and
selected night before running it. Captures and extracted game content are local
evidence, not repo assets.

## Running a night

Nights run through `packages/play/bin/phone/night-run.sh`, which drives `npm run
device:campaign`; `npm run device:campaign` without `--live` is the phone-free
dry run. The legacy shell route was archived on 2026-09-25
(`docs/ARCHIVED-ROUTES.md`).

**Every runner is dry unless it is given `--live --confirm-live`** (Pedro,
2026-09-29; ADR 0002): `night-run.sh`, `fnaf1-night-run.sh`,
`fnaf1-custom-run.sh`, `fnaf1-menu-probe.sh`, `fnaf3-run.sh`, `fnaf4-run.sh` and
`fnaf1-winner.mjs` alike. Without the pair a runner prints what it would run and
makes no adb call. Until that day `night-run.sh` went live unless `--dry-run` was
passed; the queue's night jobs now pass the pair themselves.

**The handset serial lives in an untracked local profile** (ADR 0002, decision
8): `--serial` where a tool takes it, else `FNAF_SERIAL`, else
`tools/device/local-profile.json` (gitignored), else a live run refuses and says
how to set it. Set it once per host with `node packages/play/bin/phone/local-profile.mjs set
<serial>` (`adb devices -l` lists it); a worktree without its own profile reads
the main checkout's. No tracked script carries a default, and
`tools/test-no-serial.mjs` (in `test:unit`) refuses any file outside the frozen
set and its allowlist that names one.

Seed-pin caveat (2026-09-27): wall-clock resets can occur between the seed
bracket's log calls, including when its endpoints appear to increase. Read a
pinned run with `office-seed-bracket.py --clock-pinned`; it reports `UNKNOWN`
and no candidates. A visible backwards step is refused even without that flag.
The five `night6-tw27` attempts retained this failure, not a verified twin.

`device-lock-exec.py` holds the exclusive lease through child cleanup. A nested
capture tool may borrow it only when its declared owner matches the live
ancestor and serial in the kernel-locked file; an unrelated agent cannot join
by copying the environment value. `night-run.sh` ignores repeated interrupts
during physical cleanup and restores signal handling before host analysis.
Since 2026-09-27 a live `night-run.sh` takes that lease itself (or trusts
`FNAF_LEASE_HELD=1` from a holder, as `fnaf4-run.sh` trusts `FNAF4_LEASE_HELD`),
and the lease files, the Companion queue and the overnight window's pending
restore live under the main checkout's `captures/cue-helper/`, seen from every
worktree (`companion_device_lock.state_dir()`; `CUE_HELPER_STATE_DIR` overrides).

| Tool | Kind | Purpose and interface |
|---|---|---|
| `tools/device/overnight-window.py` | compatibility | Forwards every argument to `apps/lab/overnight-window.py` while a host's installed systemd units still name this path; removed once the units are re-rendered (`lab.overnight-window-path`). |
| `npm run device:emit -- --winner winner.json --out artifacts/run-001` | compiler/check | Converts a `winner-v1` into an immutable `device-bundle-v1`: `manifest.json`, one `night-N.plan` per requested night, the resolved `profile.json`, and hashed transport-neutral `artifact.json` semantic blocks. It validates interpreter syntax, controls, contacts/timings, policy/night/profile identity, content hashes, and a bounded exact-engine replay before returning `READY`; the strategy registry contains `minus-toys`, `minus3`, and `minus7`. |
| `npm run device:campaign -- --guided [--json]` | guided preflight | Prints the single Custom Night calibration session: measured menu/dial points, readback boxes, and start control. It does not touch a phone. |
| `npm run device:campaign -- --live --confirm-live --bundle DIR --calibration FILE --qualification FILE` | supported-live gate | Runs closed ADB preflight plus campaign gates; it remains `HOLD` until a matching Night 6/7 bundle, measured Custom Night calibration, external `DEVICE_MEASURED` qualification, device-local executor, and positive lifecycle/save proof ports are composed. |


## Registers and charts

| Tool | Kind | Purpose and interface |
|---|---|---|
| `tools/device/fact-register.mjs [--json] [--out FILE] [--anchor-aim WINNER_HASH]` (`npm run device:facts`) | report | **Which producer answers each semantic fact, and on what evidence.** Registers the FACT rather than the file: for `maskOn`, `monitorUp`, screen identity and the night origin it lists every producer under `tools/device`, `apps/desktop/src` and `packages/play/src`, and what each actually looks at -- native button stroke, native explicit fact, fitted 20x9 grid anchor, or a grid-luma fallback. Facts whose authority the charter fixes are marked and never ranked. | `ANCHOR_AIMS` registers, per binding, where the anchored Night 5 release aims (233 ms for fnv1a-81b5e51c) next to the evidence that priced it; `--anchor-aim HASH` prints the aim or exits 3 with the reason, which is how night-run.sh decides whether to anchor at all.
| `tools/device/test-fact-register.mjs` | check | **An actuating module may not decide a fact on weaker evidence than the tree already provides.** `intersection-state-gate.mjs` consumes the helper's native button downstroke scores for `maskOn` and states "a missing stroke score is a refusal, never a luma fallback"; the executor answers the same question from the 20x9 grid and falls back to exactly that luma refutation, and every CORRECTED gate in the 2026-09-12T02-20 run decided on a frame whose screen the classifier could not identify. Both files had been in the tree for weeks and nothing compared them, because nothing was looking at facts. Fires only for producers under `packages/play/src/campaign`, the lane that presses buttons. Registered in `npm run test:unit`; red on 4 findings. Since 2026-09-15 it also refuses an `ANCHOR_AIMS` binding whose `winner.json` (hashed as stored) is not committed as `tools/device/*-winner.json`; the thirteen bindings registered before that date are a closed `UNTRACKED_WINNER_DEBT` list that may only shrink. |
| `tools/device/test-anchor-aim-band.mjs` | check | **An aim is not an epoch: multiply it out before trusting it.** The executor releases at `latched onset + aimMs + k*periodMs`, the latched onset LEADS the frame-trace onset, and the game acts an input latency later, so `effective = aimMs + k*periodMs + onsetBiasMs + inputLatency` and only `effective` is comparable to the epochs a census scored. Nothing multiplied those terms out: the aim lives in ANCHOR_AIMS and the band lives in an evidence file. Reconstructing a lost Night 6 aim on 2026-09-20 I omitted the -70 ms onset bias entirely and used the monitor-up press-to-effect figure (200-285 ms) instead of the binding's hall-lit input latency (47 ms, 1-82) -- wrong by about 250 ms, and invisible to every other gate. This reads each non-refuted entry's own evidence record and refuses an aim whose effective interval escapes its `winningBands`. Binding h is the worked example: 4870 - 70 + [47, 82] = [4847, 4882] inside [4766.67, 4916.67]. An entry whose evidence cannot re-derive the effective epoch is reported rather than silently trusted. Registered in `npm run test:unit`. |
| `tools/device/deathchart.mjs --night=N[,N...] [--runs=1200] [--cols=2] [--out=F.png]` | report | **What is killing a night**, as one SVG. The model gate counts every death and prints only its top four; on Night 2 that cut reads "Foxy, mostly" when Foxy is 58% and the office is 42%. This charts the whole census by the engine's own `kill()` reasons -- never a taxonomy invented here -- one pie plus its full detail table per night, colour fixed per character so two panels can be compared. Survival is printed with its Wilson interval, and each cause also carries its **median time of death** on the in-game clock -- `death-census.py`'s lesson, that faces without times ship the wrong cause. Writes a PNG via the same headless Chrome the `--browser` checks use, keeping the SVG source beside it; with no Chrome it says `UNKNOWN(...)` and exits 3 rather than leaving a PNG nobody wrote. A **simulator** census: it prices no screencap, dropped contact or desync, and the image says so and stamps its build. A new engine death cause with no slice fails `test-deathchart.mjs` rather than vanishing from the picture. |
| `tools/device/test-deathchart.mjs` | check | Mock regression for the death chart. Pins the three ways it could silently lose a death: an engine `kill()` reason with no slice (read off `packages/source/src/games/fnaf2/plant-model.js`, not a second list here), slices ordered by count rather than by character (which repaints Foxy between two panels meant to be compared), and a label overrunning its count column. Also pins that the image names its night, sample, bar and build, and that it says it is a simulator census. |
