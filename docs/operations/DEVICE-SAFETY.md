# Device operation safety

One path plays a FNaF 2 night on the phone: the campaign executor. A night is a
committed winner (`tools/device/campaign-night<N>-<name>-winner.json`) that
`npm run device:emit` compiles into a bundle, and `npm run device:campaign --
--bundle DIR --nights N --profile hid-mediaprojection` runs it.
`tools/device/night-run.sh` (`npm run night -- fnaf2`) wraps that one command
with recording, grading, packing and the reset to the title. The fixture
service path, its adapter layer and the artifact lane never played a
night and were retired on 2026-09-25 (`6d78c7e`, `903ffab`;
[archived routes](../ARCHIVED-ROUTES.md)).

- **Dry run by default.** Without `--live --confirm-live`, `device:campaign`
  validates the campaign chain, the bundle and the proof gates and opens no
  transport. CI runs that dry run over the committed Night 7 winner.
  `night-run.sh --dry-run` prints the command and touches no phone. The CLI
  refuses `--live` without `--confirm-live`, and `tools/architecture-test.js`
  holds that gate and refuses a second live command in the CLI.
- **A resolved, hashed profile.** The profile comes from
  `apps/device/profiles/` (`device-profile-v1`; the files stay at that path
  because retained records cite it with their sha256). The bundle binds its id and
  sha256, and the CLI refuses a bundle compiled for another profile.
- **Preflight before any press.** The ADB preflight checks the target build,
  the Cue Helper and `/system/bin/hid`. The campaign preflight
  (`campaign-preflight.js`) must then read READY: one compiled artifact bound
  per night, the 6 AM and save proof ports, a `DEVICE_MEASURED`
  `qualification-v1` bound to the bundle's winner and model hashes, the Custom
  Night calibration for Night 7, and the device-local scheduler. HOLD or
  UNKNOWN plays nothing, and FAIL exits nonzero.
- **An exclusive lease.** A live `night-run.sh` takes the serial lease before
  its first adb call, or trusts `FNAF_LEASE_HELD=1` from the holder (an
  overnight window's night job, below).
- **Named ways to press, one way to see.** Only the device runners that
  `architecture-test.js` names compose the HID transport: the FNaF 2 campaign
  ports, the FNaF 1, 3 and 4 runners and the one-step explorer, each behind its
  own lease and `--confirm-live`. A new composer has to be named there in the
  diff that adds it. Frames come from the Companion's Cue Helper (`REGION`,
  `SNAP`).
- **Fail-safe release.** An interrupt releases the HID process before Node
  exits. The composition's cleanup force-stops and relaunches the game and
  verifies the title. `night-run.sh`'s exit trap stops the recording, pulls
  what was captured, and drives the game back to an observed title.
- **Retained telemetry.** Each campaign writes its evidence directory and
  `result.json`, and `night-run.sh` packs it (`npm run evidence -- pack`).
- **Agents.** The agent-facing surface is the Cue Helper MCP
  (`apps/desktop/src/mcp.js`, served by `apps/desktop/src/companion-mcp.mjs`):
  `cue.setup` and the device-work queue
  (`cue.queue.enqueue`, `list`, `run`), a closed vocabulary with no raw
  coordinates, HID input or shell.

**Every night runner is dry unless told otherwise (Pedro, 2026-09-29; ADR
0002).** `night-run.sh`, `fnaf1-night-run.sh`, `fnaf1-custom-run.sh`,
`fnaf1-menu-probe.sh`, `fnaf3-run.sh`, `fnaf4-run.sh` and `fnaf1-winner.mjs`
(and `npm run night`, which passes its arguments through) run live only with
`--live --confirm-live`. Without the pair they print what they would run and
make no adb call, take no lease and need no serial. Until that day
`night-run.sh` went live unless `--dry-run` was passed. A live FNaF 2 night is:

```sh
tools/device/night-run.sh --live --confirm-live --label NAME --bundle DIR --night N
```

**The handset serial lives on the host, never in the repository (ADR 0002,
decision 8).** A runner takes `--serial` where it has one, else `FNAF_SERIAL`,
else the untracked local profile `tools/device/local-profile.json`
(`device-local-profile-v1`, gitignored; a worktree reads the main checkout's),
and a live run with none of them refuses before it touches anything. Set it once
per host:

```sh
node tools/device/local-profile.mjs set <serial>    # adb devices -l lists it
```

No tracked script carries a default, and `tools/test-no-serial.mjs` (in `npm
run test:unit`) refuses any file outside the frozen set and its allowlist that
names one. Frozen evidence keeps the serial it was written with.

**A death stops the presses, not the observer (2026-09-27).** Once a night has
been observed, the device-local executor halts actuation on the first `static`
read: no further schedule, gate, correction or arm line is written, the shared
HID process is closed through its owner (closing is what kills its
already-buffered stream; a release report only appends), and a device-local
shell is killed. The lifecycle observer keeps reading, and the run ends on a
Game Over or 6 AM read, a title read or three exit votes, the expiry of
`STATIC_TERMINAL_WAIT_MS` from that static (a static exit), or the existing
deadlines and external stops. A later `night` read neither resumes the schedule
nor restarts the window. Before this, the schedule kept pressing through the
post-death screens: it skipped Game Over into Custom Night
(`night7-corner2-bbfoxy-r02-20260927T193022Z`) and opened the in-app store
(`night7-n7-420-minimal-m3-p1b-20260927T195732Z`), and k3's left vent light
lies on the title's New Game. The rule, why no confirmation read is required,
and its numbers are in `docs/evidence/post-night-static-halt-20260927.json`
(`tools/device/post-night-static.mjs`). The halt, the stop and every
post-halt read gap over the 2418 ms observer bound are evented
(`lifecycle.actuation-halted`, `lifecycle.actuation-stopped`,
`lifecycle.observe-gap`). Not covered: a death whose post-death screens are
never read as static, such as a minigame read as unknown from its start.

`SENT` proves a transport write. It does not prove that the game accepted the
input. `UNKNOWN`, unsupported, uncalibrated, transport-failed, rejected, and
unverified states remain distinct in results.

## Venue identity (Pedro, 2026-09-29)

On 2026-09-27 the Play Store reinstalled FNaF 2 at 01:34, inside the overnight
window, and reset the save. The build check could not see it, because the
reinstalled build was still `2.0.7+26`. So every preflight now records what the
phone is (ADR 0002, decision 1 and principle 12), and it refuses when that has
moved from what the run is bound to.

- **What is recorded.** The `venue-identity-v1` record holds the following:
  - the game package, `versionName` and `versionCode`;
  - `firstInstallTime` and `lastUpdateTime`, from `dumpsys package`, together
    with the phone's time zone, because dumpsys prints both as local wall-clock
    strings;
  - `ro.build.fingerprint` and `ro.build.version.security_patch`;
  - the Companion's version;
  - `handsetHash`, the first 16 hex of sha256 over the serial.

  The raw serial is never written into the record, and the validator refuses a
  record that carries one. A field that cannot be read is `null` with its
  reason. `AdbDeviceBridge.preflight` reads the record with four more fixed
  read-only queries and writes it into `device-preflight-v2`, which is v1 plus
  `venue`, a `venue-check-v1`. It also adds a `venue-identity` check. The
  campaign result keeps the venue in its preflight event (`campaignVenue()`),
  and a live campaign prints it next to its gates.
- **What binds it.** Two records can bind a run to a venue:
  - a `qualification-v2`, which is a v1 plus `venue`, the identity the
    qualification was measured on;
  - a `venue-binding-v1` that names the run's profile or winner, passed with
    `--venue-binding FILE`.

  No committed profile, winner or qualification is bound yet, so today preflight
  records the identity and says so, and does not refuse:

  ```text
  PASS    venue-identity: unbound: the observed venue identity is recorded; no profile, winner or qualification binds one, so drift is not checked
  venue UNBOUND: the observed venue identity is recorded; no profile, winner or qualification binds one, so drift is not checked
  ```

- **Drift refuses.** A change in any of these from any binding is a `FAIL`
  with reason `venue-identity-drift`:
  - the package, `versionName` or `versionCode`;
  - `firstInstallTime` or `lastUpdateTime`;
  - the fingerprint or the security patch;
  - the handset hash.

  The message names each field, from what to what, and gives the remedy:
  re-qualify on the observed venue, or roll the game back to the bound build and
  keep Play auto-update off. An OS update cannot be rolled back, so re-qualifying
  is the only remedy for it. A bound field that cannot be read holds the run
  (`HOLD`) and does not pass it. A Companion or time-zone change is reported and
  not refused.
- **Drift demotes the qualification.** The campaign preflight's
  `qualification-venue` check reports a `qualification-v2` whose venue drifted
  as `CANDIDATE`, demoted from `QUALIFIED`, and refuses. Nothing persists that
  demotion: it is derived again at every preflight. A `qualification-v1` is
  still read, and it is reported as unbound.
- **Binding is a deliberate act.** Bind the identity that the qualifying run's
  own preflight recorded (`bindQualificationVenue`, or a `venue-binding-v1`
  over it). Never bind the identity observed after a drift: that would bless
  the change the refusal exists to catch.

## Overnight windows (Pedro, 2026-09-27)

The phone stops being the bottleneck through overnight windows. The phone is
Pedro's own, and he uses it for everything else in his life. Queued jobs run on
it overnight, on the charger with stay-awake on, and only inside a scheduled
window. Everything the window changes is recorded before it changes it and
restored at the end, however the window ends.
`tools/device/overnight-window.py` is the runner; its row in
[`tools/device/README.md`](../../tools/device/README.md) has the full contract.

- **Default window: 01:30-07:00 local.** `--start` and `--end` (or
  `FNAF_WINDOW_START` and `FNAF_WINDOW_END`) change it. It may be armed up to 4 h
  early (`--max-arm-lead`). An armed window keeps the phone awake from the
  moment it is armed and starts jobs only at the window start.
- **The lock screen is Pedro's.** The window never changes lock-screen security
  (`locksettings`), never unlocks, never wakes the phone and never taps. It
  assumes the phone is left unlocked on the charger, on the home screen, and
  kept awake from then on. A phone that is locked or asleep is waited for up to
  `--lock-wait` (600 s). After that the window ends `LOCKED`, and every pending
  job gets a `windowNote` that `cue.queue.list` shows. Nothing is changed.
- **In use means stop.** An active call, or a foreground app other than the
  launcher, the Companion or a target game, refuses the window (`IN_USE`). The
  same check runs between jobs, so picking the phone up ends the window.
- **Power.** The phone must be plugged in, at or above the floor (50 %,
  `--battery-floor`) and below 45 C, at the start and between jobs.
- **What it changes, and what it only reads.** It records
  `stay_on_while_plugged_in`, `screen_off_timeout`, `screen_brightness`,
  `screen_brightness_mode`, `heads_up_notifications_enabled`, `zen_mode` and
  `airplane_mode_on`, then writes that record to disk before it sets stay-awake
  to 7 (AC, USB or wireless). At the end the first five are put back if anything
  moved them, and read back. Airplane mode is only read: its owner is the radio
  stack, a raw write would desynchronise it, so a drift is reported, never
  reversed.
- **Do Not Disturb (Pedro, 2026-09-29, ADR 0002 decision 2).** At window open,
  after stay-awake, it turns heads-up notifications off
  (`heads_up_notifications_enabled` 0) and Do Not Disturb on, and reads both
  back. DND goes through NotificationManager's own `cmd notification set_dnd
  priority` (zen_mode 1), never a raw `settings put`, which would desynchronise
  the service. It is `priority`, not `on`: `on` is total silence and would also
  silence an alarm set inside the window, while `priority` keeps the owner's own
  priority policy. At the end the prior value is restored and read back
  (`set_dnd off`). If either cannot be set, or does not read back, the window
  ends `DND` (exit 75) before any job, and everything it changed is restored.
  A DND the window finds already on (the owner's schedule) is left on and never
  turned off, so a schedule that ends at 07:00 is not re-entered by a
  "restore". Whether this handset's SystemUI honours the heads-up setting is
  not yet measured on the phone: the window proves the write and its read-back,
  not the absence of a banner.
- **Deadlines.** A job starts only if it can finish (360 s, the queue's
  `JOB_TIMEOUT_S`) before the stop instant. The stop instant is the window end
  minus the stop graces and the restore budget. At the stop instant the queue
  child gets SIGINT, then SIGTERM after 150 s, then SIGKILL after 20 s. A stopped
  job goes back to PENDING. Both the wall clock and the monotonic clock are
  checked, so a host that suspends overnight cannot run a job into the morning.
- **Fail-safe.** A signal or a job failure ends the window through the same
  restore. A second interrupt cannot cut that restore short, because every
  subprocess the runner starts runs in its own session. The record of what to
  restore survives a SIGKILL: the next window, `restore --live --confirm-live`,
  or the unit's `ExecStopPost=` puts those settings back first. The lease is
  released last. Telemetry stays local, in
  `artifacts/overnight-windows/<id>/` (`window.json`, `events.jsonl`,
  `queue.log`). It names foreground packages and is never committed.
- **Installing it is Pedro's step.** Nothing here installs a timer:

  ```sh
  node tools/device/local-profile.mjs set <serial>                       # once per host (untracked)
  python3 tools/device/overnight-window.py preflight                     # read-only: FIT, or why not
  python3 tools/device/overnight-window.py units --out ~/.config/systemd/user
  systemctl --user daemon-reload
  systemctl --user enable --now fnaf2-overnight-window.timer             # opens at 01:30 every night
  systemctl --user start fnaf2-overnight-window.service                  # or: arm now, at bedtime
  loginctl enable-linger "$USER"                                         # only if logged out overnight
  ```

  The units run the main checkout, and name the phone in their own
  `Environment=FNAF_SERIAL=` line, which lives in `~/.config`, never in the
  repository. The host must be awake at the window start: the timer does not
  wake it, and a start it missed is not made up later.

### Night jobs (Pedro, 2026-09-27: "Yes, play nights")

Asked whether overnight windows may play full nights unattended on his phone,
Pedro answered "Yes, play nights". A night job is the queue's one
game-playing word:

```sh
tools/device/companion-queue.sh enqueue night --game fnaf2 \
  --winner tools/device/campaign-night7-k3-winner.json --night 7 [--label k3a] [--audio]
```

- **What it can name.** It names one night of a committed winner file, and
  nothing else. The runner is fixed by the winner's schema, and the job passes
  it `--live --confirm-live` itself, since every runner is dry without them:
  - `night-run.sh` for FNaF 2, with the bundle emitted fresh;
  - `fnaf1-winner.mjs` for a FNaF 1 route winner;
  - `fnaf4-run.sh --mode loop` for FNaF 4.

  The job is checked when it is queued and again when it starts, and it
  refuses at start if any of these moved since it was queued:
  - the winner is the committed file, byte for byte;
  - the night is the winner's own;
  - for FNaF 2, the freshly emitted plan hashes as it did.

  The job's budget is the sum of every step's bound plus the night's own
  length, taken from the plan's `#observe-until` or the route winner's
  `stopAfterMs`. A window starts a night only if that budget fits before its
  stop instant.
- **Only the window plays nights.** Its queue child alone passes `--nights`.
  `cue.queue.run` from an agent drains setups and checks, and reports the nights
  it left waiting.
- **The title is observed, never assumed.** Before the night, the Cue Helper
  SNAPs a native frame and `title-observe.py` reads it with the game's model.
  The job refuses unless the title offers the declared night:
  - Custom Night for 7;
  - 6th Night for 6;
  - the digit under Continue for 1-5.

  Two cases cannot be read yet, so they refuse (`TITLE_UNREADABLE` or
  `TITLE_MISMATCH`) and never press anything: FNaF 4 has no title model, and
  the FNaF 2 title model has no Continue digit reader.
- **Every safeguard of a hand-run night still applies.**
  - The runner runs under the window's lease, with its lease-held marker.
  - It is in the queue's process group, so the window's stop reaches it.
  - The executor's post-night static halt (669447b) is in force: a job refuses
    on a checkout without it.
  - Audio is linked (`bt-audio-link.sh --ensure`) where the runner reads it.
- **After any end or abort (mistake register 6).** The job observes the title
  again. If it does not read, it force-stops the game, relaunches it and
  observes again. A night killed before it could do that is recovered by the
  window itself (`night-job.py title --recover`). A night that is interrupted
  or killed ends FAILED, and it is never replayed.
- **Results.** A night played to 6 AM or to a death is a job DONE. Its record
  is in `artifacts/night-jobs/<job>/job.json`, with the binding's hashes and
  the title reads. In the morning, after the lease, the window packs each run
  (`npm run evidence -- pack <run>`, if `night-run.sh` did not already) or names
  the FNaF 4 run record. It then appends one line per window to
  `artifacts/overnight-windows/summary.log`.
- **One lease, one queue, for every checkout.** A live `night-run.sh` now takes
  the serial lease itself, or trusts `FNAF_LEASE_HELD=1` from a holder. The
  lease files, the queue and the pending restore live under the main checkout's
  `captures/cue-helper/`, and every worktree resolves the same path there.
