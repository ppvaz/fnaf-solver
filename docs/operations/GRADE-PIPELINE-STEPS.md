# grade-run.sh: what each video step feeds, what a frame trace can replace, and why the decode is shared

Written 2026-09-12 while the Night 5 repetition series ran. Ground truth: grade-run.sh
step list at HEAD, night-run.sh's verdict grep (`^(outcome|terminal|survival|
  clear|  death)`), and the frame-trace v3 columns (seq, image_ns, elapsed_ns,
callback_ns, interval_ns, grid_mean_luma, screen_identity, mask_luma,
monitor_luma, mask_downstroke, monitor_downstroke, grid_hex 20x9).

| step | decode | feeds the verdict? | trace v3 answers it? | proposal |
|---|---|---|---|---|
| survival (grade-night.py) | 4 fps, 1280x576 rgb24 | YES: `survival` line, the only run length | partly: screen_identity at 60 Hz gives night frames, but the trace starts after capture start and ends at the pull, and the terminal (static/gameover) is a lifecycle fact | keep on video; seed with the bundle's night-go and terminal bracket so it decodes the two ends at full rate and the middle at 4 fps (same predicate, fewer frames) |
| camera selections (camtrace.py) | GRADE_FPS (measured, 60), 1280x576 then crop 430x110 | no verdict line; report | NO: v3 carries no cameraSelected column (the native camera rule lives in the helper's live path only) | not superseded; supersedable when the trace gains the helper's `cameraSelected` fact |
| camera light actually flashing (sweepcheck.py) | GRADE_FPS 60, 1280x576 rgb24 AND a second gray decode | no verdict line; exit 3 on a dark sweep | YES in substance: the feed light brightens the whole camera view, and v3 carries `grid_mean_luma` per frame plus `screen_identity`; the sweep windows are the plan's camera taps | superseded once a trace reader exists (a few lines over grid_mean_luma at the scheduled sweep windows); until then: it is the single most expensive step (773 s) and its second decode is redundant with the first (gray is derivable from rgb) |
| keyframes (keyframes.py) | 2 fps gray small + 2 fps rgb tiles (two decodes) | no; a contact sheet for a human | no | keep; one decode instead of two |
| music box (windpct.py) | 12 fps, crop 320x80 | no verdict line; report | NO: the CAM 11 gauge is not in the 20x9 grid | keep |
| office / mask / camera intervals (grade-minus7.py) | 12 fps, 160x72 gray | no verdict line; report | YES: screen_identity + button strokes + mask/monitor luma at 60 Hz; tap-stall-audit --transitions already prints the same intervals per cycle | superseded when a trace covers the night |
| run timeline and terminal outcome (run-timeline.py + cause models) | 2 fps rgb24 at W x H, cause-model scan over every frame | YES: `outcome`, `terminal`, `clear`, `death` lines, the only step that can say `clear` | no (terminal is a lifecycle fact; cause is pixels) | keep, but seed it: the campaign's terminal bracket (`terminal.lastNightAt`..`terminalAt`, 1.2-1.8 s wide) is known before this step runs; decode that window at full rate for the cause models and the first-HUD window for the start, and only the coarse 2 fps pass for the middle. On final2 the 2 fps pass captured "nothing terminal" while the bracket was 1248 ms wide |
| campaign bundle, delivered phase, trace instruments, elegance, audio | none / trace only | bundle facts | n/a | unchanged |

Net: with trace v3 as it is, exactly ONE video step is superseded today (intervals,
44-112 s). The largest step (camera light, 189-773 s) becomes superseded with a
short trace reader; camera selections need a trace schema change. So the
structural fix is decode-once with concurrent consumers, not skipping.

## Decode-once, as built

- The full-resolution 60 fps branch cannot be materialised: 1280x576 rgb24 at
  60 fps is 2.2 MB/frame, 93 GB for a 700 s recording. And /tmp is tmpfs (3.9 G):
  nothing decoded may live there. Measured on final2 (232 s), one core, niced:
  decode-only 55 s, the sweepcheck branch 72 s, the camtrace branch 63 s; the
  pipeline ran nine such decodes.
- `packages/review/bin/grade/framesource.py` is the seam: every instrument's `decode()` asks
  it for frames with its own chain, verbatim; it spawns the same ffmpeg the
  instrument used to, or reads a fifo when `decode-once.py` offers one.
  Characterised on a 40 s clip of final2: all seven instruments' stdout, stderr,
  exit codes and the keyframes sheet byte-identical before and after.
- `packages/review/bin/grade/decode-once.py` is the rendezvous: the instruments run
  concurrently; each announces its spec beside a fresh fifo and blocks on it;
  one ffmpeg (`-filter_complex split`, one branch per announced spec) decodes the
  recording once into every fifo; a second, smaller decode serves the two
  instruments that read the recording twice (sweepcheck rgb then gray,
  keyframes small then tiles). ffmpeg blocks on the slowest reader, so memory
  stays at pipe-buffer size. grade-run.sh runs it as ONE step in place of the
  seven video steps; the outputs are replayed in the old order under their old
  headers with their own exit codes.
- Resource shape: consumers spread over `GRADE_CPUSET` (night-run.sh passes
  2-9) inside the `systemd-run --scope -p MemoryMax=3G -p MemoryHigh=2500M
  -p CPUQuota=800%` wrapper, each under the per-step `ulimit -v` and timeout;
  `GRADE_DECODE_CONCURRENCY` (default 7, from measured peaks of 95-116 MB per instrument) caps how many run at once, sized from
  measured peak RSS so the sum stays under MemoryHigh, where throttling starts.
