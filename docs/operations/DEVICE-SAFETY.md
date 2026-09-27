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
