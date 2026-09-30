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
| `tools/device/deathchart.mjs --night=N[,N...] [--runs=1200] [--cols=2] [--out=F.png]` | report | **What is killing a night**, as one SVG. The model gate counts every death and prints only its top four; on Night 2 that cut reads "Foxy, mostly" when Foxy is 58% and the office is 42%. This charts the whole census by the engine's own `kill()` reasons -- never a taxonomy invented here -- one pie plus its full detail table per night, colour fixed per character so two panels can be compared. Survival is printed with its Wilson interval, and each cause also carries its **median time of death** on the in-game clock -- `death-census.py`'s lesson, that faces without times ship the wrong cause. Writes a PNG via the same headless Chrome the `--browser` checks use, keeping the SVG source beside it; with no Chrome it says `UNKNOWN(...)` and exits 3 rather than leaving a PNG nobody wrote. A **simulator** census: it prices no screencap, dropped contact or desync, and the image says so and stamps its build. A new engine death cause with no slice fails `test-deathchart.mjs` rather than vanishing from the picture. |
| `tools/device/test-deathchart.mjs` | check | Mock regression for the death chart. Pins the three ways it could silently lose a death: an engine `kill()` reason with no slice (read off `packages/source/src/games/fnaf2/plant-model.js`, not a second list here), slices ordered by count rather than by character (which repaints Foxy between two panels meant to be compared), and a label overrunning its count column. Also pins that the image names its night, sample, bar and build, and that it says it is a simulator census. |
