# Device tools

Two things are left at this path after the ADR 0002 moves (2026-09-30), and
both stay because something outside the tree names it:

- `tools/device/local-profile.json`, the untracked, gitignored local profile
  that holds this host's handset serial (ADR 0002, decision 8;
  `packages/play/bin/phone/local-profile.mjs`). A worktree without its own
  reads the main checkout's.
- the overnight window's forwarder below, because a host's installed systemd
  units name this path in `ExecStart`.

Everything else moved to the context that owns it: the committed winners and
the fact register to Propose's
[`bindings/`](../../packages/propose/bindings/); the runners, sensors, probes
and how a night is run to Play
([`packages/play/README.md`](../../packages/play/README.md)); the graders to
Review ([`packages/review/README.md`](../../packages/review/README.md)); the
death chart to the desktop app
([`apps/desktop/README.md`](../../apps/desktop/README.md)).

| Tool | Kind | Purpose and interface |
|---|---|---|
| `tools/device/overnight-window.py` | compatibility | Forwards every argument to `apps/lab/overnight-window.py` while a host's installed systemd units still name this path; removed once the units are re-rendered (`lab.overnight-window-path`). |
