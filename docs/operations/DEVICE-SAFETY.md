# Device operation safety

Use a versioned profile and `DeviceControlService`. Profiles resolve adapter
capabilities, geometry, timing, calibration, target build, and safety limits;
the resolved profile and hash are retained in the session manifest.

Dry-run is the default and uses fixture transports. Live mode requires an
explicit `--live --confirm-live`, a non-fixture profile, an exclusive lease,
bounded action count/duration, preflight, externally evidenced
`qualification-v1`, mandatory abort/release methods, and sensor→detector
observation in the execution loop. The service owns semantic-to-physical
mapping, temporal/deadline checks, emergency release/abort, telemetry, and
cleanup. Agent-facing interfaces may call this service only with semantic
bounded commands; they may not execute arbitrary shell or invent coordinates.

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
  `screen_brightness_mode`, `airplane_mode_on` and `zen_mode`, then writes that
  record to disk before it sets stay-awake to 7 (AC, USB or wireless). At the end
  the first four are put back if anything moved them, and read back.
  Airplane mode and Do Not Disturb are only read. Their owners are system
  services: a raw write would desynchronise them, and it would re-enter a DND
  schedule that ended at 07:00. So a drift in them is reported, never reversed.
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
  python3 tools/device/overnight-window.py preflight --serial SERIAL      # read-only: FIT, or why not
  python3 tools/device/overnight-window.py units --serial SERIAL --out ~/.config/systemd/user
  systemctl --user daemon-reload
  systemctl --user enable --now fnaf2-overnight-window.timer             # opens at 01:30 every night
  systemctl --user start fnaf2-overnight-window.service                  # or: arm now, at bedtime
  loginctl enable-linger "$USER"                                         # only if logged out overnight
  ```

  The units run the main checkout. The host must be awake at the window start:
  the timer does not wake it, and a start it missed is not made up later.

### Night jobs (Pedro, 2026-09-27: "Yes, play nights")

Asked whether overnight windows may play full nights unattended on his phone,
Pedro answered "Yes, play nights". A night job is the queue's one
game-playing word:

```sh
tools/device/cue-helper-queue.sh enqueue night --game fnaf2 \
  --winner tools/device/campaign-night7-k3-winner.json --night 7 [--label k3a] [--audio]
```

- **What it can name.** It names one night of a committed winner file, and
  nothing else. The runner is fixed by the winner's schema:
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
