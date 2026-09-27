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
