# In-engine recompile toolchain

Toolchain for the faithful-recompile route of [Plan 17](../../plans/17-in-apk-bot.md)
(route 5): convert the owned FNaF 2 Android CCN through open-source Chowdren into
a separately-packaged research binary, then inject the pilot in generated C++.
The evidence contract and phase gates are in
[`docs/in-engine/IN-ENGINE-PILOT-RECOMPILE.md`](../../docs/in-engine/IN-ENGINE-PILOT-RECOMPILE.md).

**Everything here is content-free toolchain code** — a patch against open-source
Chowdren, a converter config, and two probe scripts. The owned `application.ccn`,
the APK, `res/raw` audio, `Assets.dat`, `image_cache/`, and all generated C++
**never enter the repository**. Run against copies held in an external experiment
directory (`/private/tmp/fnaf2-recompile.*` on the dev machine).

## Files

| File | What it is |
|---|---|
| `mmfparser-chowdren-mobile.patch` | Content-free source patch (`.py` / `.pyx` / Chowdren runtime `.h`/`.cpp`, including the 2026-09-27 deterministic harness `base/harness.{h,cpp}` and the `MultipleTouch` writer) forward-porting `fnmwolf/Anaconda`'s bundled `mmfparser` + Chowdren to the build-296 mobile CCN: image/font/sound/music banks, object and movement records, the Pillow `frombytes` fix, raw-payload capture for undecoded codes, and the arm64 `size_t`/`uint64_t` overload fix. |
| `fnaf2-config.py` | Chowdren `--config`: `get_missing_image` for placeholder image handle `(0,0)`, and an `init()` hook that synthesizes `game.extensions` entries from the frame items (`Layer` → native writer; `Multiple Touch` / `Android object` / `AndroidPlus` / `iOS Plus Object` → generic `ObjectWriter` stub). |
| `probe-unknown-params.py` | Dumps every event parameter whose code is past `parameterLoaders`, with the ACE it attaches to and its raw bytes. Requires the `Parameter.read` capture patch. |
| `probe-onloop.py` | Prints every `OnLoop` condition and its parameter loader — the probe that showed mobile loops are numeric `Short` indices, not name expressions. |
| `model-draw-trace.mjs` | The simulator's `Random(N)` draws frame by frame (draws so far, LCG state), in the shape the harness traces: two runs of one night and seed that spend the same draws every frame read the same stream, and the first frame where the counts part is where to look. MODEL_ONLY. |
| `compare-draw-trace.mjs` | Reads an external harness trace and emits a hash-bound, content-free comparison result. `MATCHED_PREFIX` never means full event/state equivalence. |
| `sourced-model-options.json` | Explicit diagnostic variant enabling the model's existing sourced flags. It does not change core defaults or establish fidelity. |
| `sourced-origin-model-options.json` | The same sourced flags plus the frame-time hook at 60 fps (`frameMs` 50/3, `frameValue5` 1) and `sourcedEveryOrigin`: every countdown loads on the loop it is first reached. `model-draw-trace.mjs` turns the two hook constants into per-frame functions. Diagnostic; defaults unchanged. |
| `run-harness.sh` | Container wrapper with GL readiness checking and a process deadline that escalates to kill. Run from the external gamesrc directory. |
| `test-mobile-parser.py`, `test-compare-draw-trace.mjs` | Synthetic parser and result-classification regressions; FIXTURE only. |
| `test-child-events.py`, `fixtures/child-events.cpp` | Emit and compile synthetic nested events with the patched converter; exercise parent gating, nested/sibling selections, and one-shot timer dispatch. FIXTURE only; Python2.7 and a C++ compiler required. |
| `diagnose-child-events.mjs`, `test-child-diagnosis.mjs` | Content-free, hash-bound reader for the retained debugger and child-census measurements. |
| `probes/*.gdb`, `run-debug-probe.sh` | Checkpoint-bound debugger probes, used inside the bounded harness wrapper. Generated function IDs are not portable between patch checkpoints. |
| `fixtures/night1-newgame.input`, `fixtures/night1-before.ini` | Exact host-only navigation and initial save used by the retained runs, matching their provenance hashes. No game assets. |

## Environment

Pinned base: **`fnmwolf/Anaconda` at `9b00bb4227cc3ddd6f7baefe06120368bd7226e9`**
(caps at Fusion build 293; build 296 is what the patch adds).

```sh
# 1. Clone the pinned base into an external dir
git clone https://github.com/fnmwolf/Anaconda anaconda && cd anaconda
git checkout 9b00bb4227cc3ddd6f7baefe06120368bd7226e9

# 2. Apply the mobile patch
git apply /path/to/repo/tools/recompile/mmfparser-chowdren-mobile.patch

# 3. Build the Cython image (see IN-ENGINE-PILOT-RECOMPILE.md
#    "Public toolchain recheck" for the Debian-archive apt fix)
docker build ...   # -> fnaf2-chowdren-phase1:local

# 4. Rebuild the .so modules after any .pyx edit
docker run --rm -v "$PWD:/work" -w /work fnaf2-chowdren-phase1:local \
    bash -lc 'pip install "Cython<3" >/dev/null; python build.py build_ext --inplace'

# 5. Convert (assets cached in <gamesrc> after the first run)
docker run --rm -e MMFPARSER_ANDROID_RAW_DIR=/input/android-res-raw \
    -v "$PWD:/work" -v "$EXTERNAL_INPUT:/input" -w /work/Chowdren \
    fnaf2-chowdren-phase1:local \
    python -u -m chowdren.run --config /input/fnaf2-config.py \
        /input/application.ccn /input/gamesrc
```

## State (2026-08-28)

Parse ✓ · assets ✓ · `write_objects` ✓ · event/frame C++ emission ✓ (29 real
frames) · arm64 link ✓ · **boots to the 02-title screen, real images ✓**. Still
`rebuilt-runtime` only: inert compatibility paths remain, title-screen layout and
blend effects are off, and it does not reach gameplay. The patch carries
(NebulaFD-sourced or confirmed against captured bytes):

- parameter loaders 67–72: `67`/`70` → `Int`, `68` → `ParameterVariables`,
  `69` → `ParameterChildEvent`, `71` → `Bug`, `72` → `Zone`; names + inert
  `convert_parameter` cases
- frame chunk `0x334C` (13132) = `FrameHandle`; `ChunkList.read` end-of-data
  guard (4 truncated `olivier_DEBUG_*` / `_GLOBALS` stub frames — real game is
  frames 0–28)
- `static_loop_name()` — mobile fastloops are numeric (`Short` index), so
  `write_loops` / `write_foreach` / `StartLoop` / `StopLoop` / `SetLoopIndex` /
  `Foreach` key on `loop_<index>`
- new system ACEs: cond `-42`/`-43` → `Always`, action `43` → `EmptyAction`
  (Fusion 2.5+ structural markers; `CHILDEVENT` object-scope list dropped)
- `GroupPointer` build-≥284 layout (int ID, `tell − 12` base; `Group` base
  `tell − 36`); `containers` also keyed by group id with a `pointer == 0`
  fallback in `Activate`/`DeactivateGroup` / `GroupActivated`
- Chowdren stubs: `RunningAs` → `Always`, `SetGlobalValueDouble` →
  `global_values->set`
- unknown mobile extensions become inert, instance-bearing `FrameObject`
  placeholders; static backdrops receive generated BackMagic-style lists;
  undefined frame-local instances/actions are omitted, unbound object actions
  are omitted, and malformed/unknown expressions carry an explicit numeric
  fallback (their containing comparisons become `false`) solely for build probes
- arm64 desktop portability: the duplicate `size_t` / `uint64_t`
  `number_to_string` overload is disambiguated in `base/stringcommon.h`
- the runtime accepts a `FlatObjectList` default-instance lookup when a mobile
  event references a static backdrop
- **absent single-object ACEs** (a Global object placed only on a later frame, a
  dead cross-frame reference): `write_frame` tracks `frame_startup_handles`;
  `get_object` routes reads through a type default instance
  (`default_active/counter/text_instance`, new `Default{Counter,Text}` +
  `base/frameobject.h::default_instance`), and a single-object *action* on one is
  skipped as the Fusion no-op it is
- **`JumpToFrame` / `NextFrame` / timer actions no longer dropped:** the
  "unbound action omitted" guard fires only when the action *names* an object
  with no FrameItems definition, not on pure system actions
- **every object gets `create_alterables()`** (`Counter.use_alterables = True`
  plus an unconditional `create_alterables()` in `ObjectWriter.load_alterables`),
  so a build-296 event reading `.alterables` on a Counter or extension stub does
  not hit NULL
- **`Media::play_id` guards `INVALID_ASSET_ID`** — an unresolved mobile Play
  Sample plays silence instead of indexing `sounds[]` out of bounds
- **image-bank handle mask** (`imagebank.pyx`): the mobile `ImageItem` record's
  opening 4-byte field is `handle | (section_counter << 16)` (counter observed
  0–5); taken whole it scattered ~350 images to `0x1xxxx`–`0x5xxxx` and their
  objects fell through to `get_missing_image`. `readInt() & 0xFFFF` → 782 distinct
  handles, 0 collisions, object-side missing-image count **723 → 18** (the 18 are
  the genuine `(0,0)` placeholder). Real title images now render.

The completed run's derived unsupported inventory is printed at the end of the
converter output (not committed): Android/iOS/In-App, INI, Multiple Touch,
Perspective, KYSO, Calculate Text Rect, several system ACEs and unmatched
fastloops remain. The Phase-3 arm64 CMake probe now completes and links the
external desktop target after compatibility handling for empty qualifiers,
numeric loop indices, static-backdrop traversal, receiver-free `Never`, and
unsupported-expression actions.

**Boots to the FNaF 2 title screen 2026-08-28.** Under real Xvfb + llvmpipe with
`ALSOFT_DRIVERS=null`, run with CWD at the `gamesrc` dir (the binary opens
`./Assets.dat`), the linked binary renders an SDL/GL window, initializes audio,
boots frame 0 → frame 1, and runs the 02-title event logic — title text, the
`12:00 AM` clock, the WARNING block, the camera-map layout, menu buttons — stable
45 s+. With the image-bank handle mask (2026-08-28) the real title images render —
the animated TV static, camera-map thumbnails, `CAM` buttons — though the
letterbox is anchored not centred, the stacked title text overlaps the clock, and
the static/map draw at full opacity where the game overlays them faint. It does
not yet advance to gameplay. Fidelity class `rebuilt-runtime`. Fixes this slice:
absent single-object ACEs routed to a type default / skipped as Fusion no-ops
(`frame_startup_handles`, `Default{Counter,Text}`), the blanket "unbound action
omitted" guard narrowed so `JumpToFrame` and other pure system actions emit,
`Counter.use_alterables = True` + `load_alterables` always calls
`create_alterables()`, `Media::play_id` guards `INVALID_ASSET_ID`, and the
image-bank handle mask. Full notes: `IN-ENGINE-PILOT-RECOMPILE.md` §"Phase 3 —
boots to the FNaF 2 title screen" and §"Phase 3b — the image bank was decoding,
the handles were wrong".

Run recipe (external Debian-buster arm64 container, `fnaf2-chowdren-phase1:local`
+ `cmake libsdl2-dev libopenal-dev libgl1-mesa-dev gdb xvfb mesa-utils`, mounts
`<anaconda>:/work` and `<external>:/input`):

```sh
cd /input/gamesrc     # CWD must hold Assets.dat
LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER=llvmpipe ALSOFT_DRIVERS=null \
  xvfb-run -s "-screen 0 1280x720x24" ./build-linux/Chowdren
```

Regenerate this patch after landing more (keeps `Chowdren/base` runtime `.cpp`,
drops the Cython-generated `mmfparser/**/*.cpp`):
`cd <anaconda> && git diff -- '*.py' '*.pyx' '*.pxd' '*.h' 'Chowdren/base' ':(exclude)build/*' > tools/recompile/mmfparser-chowdren-mobile.patch`

## State (2026-09-27): restored, deterministic harness, handles unscrambled

Restored from `archive/2026-09-24` for ROADMAP S2b and rebuilt on the x86-64
machine: patch applied to the pinned base, Cython modules built in a
`python:2.7-slim` (buster) container, the CCN converted with the host's conda
`py27` (the converter needs more memory than the 2 GB Docker Desktop VM gives;
the container kills it), and the game compiled and run in the container with
`cmake libsdl2-dev libopenal-dev libgl1-mesa-dev xvfb` added. `xvfb-run` hangs
in that container waiting for Xvfb's readiness signal; start `Xvfb :77` by
hand and set `DISPLAY`. Build without `NDEBUG` (object names are kept only in
debug-name builds; the harness taps objects by name) and with `make -j4` (the
VM runs out of memory at `-j10`).

What this slice added, all in the patch:

- **The harness** (`base/harness.{h,cpp}`, off unless `CHOWDREN_HARNESS=1`):
  Fusion's `CRun.random` for every event-sheet `Random(N)` and pick-one
  (always, harness or not -- Chowdren's `cross_rand` is a different LCG), each
  frame load reseeded from `CHOWDREN_SEED` instead of the clock, a fixed 1/60 s
  step with no sleep, touches replayed from `CHOWDREN_INPUT`
  (`<frame> <tick> down|move|up <pointer> [x y]`, or `downobj <pointer> <name>`
  to touch the centre of a named instance), a per-update trace to
  `CHOWDREN_TRACE` (frame, update, draws, graine, the global values),
  `CHOWDREN_DUMP_FRAME/TICK` to list live instances, and `CHOWDREN_STOP_FRAME` /
  `CHOWDREN_MAX_TICKS`.
- **Multiple Touch** as a writer, from the Android runtime's own
  `Extensions/CRunMultipleTouch` switch tables (read from `classes.dex`):
  conditions 0-10 and expressions 0-16, touch slots reused first-free, the first
  touch driving the mouse (the title's buttons are `ObjectClicked`).
- **`Every` is Fusion's `CND_EVERY2`** (from `classes.dex`): the first
  evaluation loads the countdown and is false; later ones subtract the frame's
  timer delta (1/3 ms units, 50 per 1/60 s frame under the harness) and fire at
  <= 0. Chowdren's float accumulation fired one evaluation early.
- **Build-296 object handles are scrambled twice, as the APK's runtime reads
  them** (`docs/android/ANDROID-SOURCE-STATUS.md`, from the dex): the item
  header is `handle ^ 28` (`COI.loadHeader`) and a placed instance's object is
  `readAShort() ^ 48` (`CLO.load`), both landing on the handle every event names
  (the one CTFAK's dump shows). The parser read both raw and joined them raw, so
  most instances were created as the wrong object and every event bound to the
  wrong one (btnNewGame 15 read as 19; the title's New Game click tested the
  `night number` counter; INI reads segfaulted on Actives). `ObjectHeader.read`
  now applies ^ 28 and the frame instance loader ^ 48 for build >= 290: actions
  the converter skipped as "on a frame-absent object" fell from 1,645 to 111,
  instances with no item definition from 4 to 0, the title now places
  `whereToGo.Active`, and INI (33) binds to the Ini objects, so it runs as
  `kcini` again.

The continuation also moved startup-handle discovery before fastloop and
generated-event emission (frame-absent action omissions then fell to zero),
decoded Android Double tokens as signed fixed 32.32 instead of IEEE bits,
and emitted Multiple Touch trigger predicates ahead of ordinary event rows.
The latter uses Chowdren's existing generated-group ordering; equivalence to
Android's immediate event dispatch remains unverified.

**Reached 04-Office through title input, 2026-09-27.** Seed 24850 traversed
frames `0 -> 1 -> 8 -> 2 -> 7 -> 3`, then ran 18,000 office updates without
gameplay input and exited normally. Mobile New Game needs a Yes confirmation.
An independent run from the retained pre-run save reproduced the complete
frame/tick/draw-count/RNG-state projection across all 19,937 updates. The raw
global-value traces differed in 48 office rows, so this is RNG repeatability,
not full-state determinism; both hashes remain in the results.
The rebuilt Yes hit region was only 16 pixels wide despite its wider visual
button; a second input at the measured hit region advanced. Qualifier/foreach
creation and selection remain a fidelity gap (the generated loop creates
duplicate hit regions and scales only one). Input and raw instance dumps stay
in the external experiment directory.

The generated records under [`results/`](results/) retain the negative:

- `night1-default-20260927.json`: first draw-stream mismatch at office tick 6,
  rebuilt 3 draws/state 10695 versus model 1/state 63455. The default model
  disables cosmetic RNG draws, so this is an expected boundary.
- `night1-sourced-20260927.json`: the explicitly declared sourced variant
  diverges at initialization: rebuilt tick 0 has 1 draw, model frame 0 has 0
  and frame 1 has 2. Neither the default nor the variant is trace-equivalent.

The model trace now counts constructor draws; its previous 1,215-draw Night 1
terminal omitted one initialization draw. The default model still dies to the
Puppet at frame 17,680, now correctly counted as 1,216 draws. Fixing the
instrument does not change model behavior.

The harness now has an unconditional `CHOWDREN_MAX_TOTAL_TICKS` limit (default
60,000). Input rows fire on the first matching frame visit reaching their tick;
frame indices are identities and can decrease during navigation. Six inherited
runs had outlived their host `timeout` because it did not kill container
children and their target-frame stop never fired. They were stopped by exact
container identity; the latest external logs were retained. Use unique output
paths and the wrapper's `CHOWDREN_TIMEOUT_SECONDS` deadline (default 120 s).

Comparison and fixture commands:

```sh
PYTHONPATH=<patched-anaconda> <python2.7> tools/recompile/test-mobile-parser.py
node tools/recompile/test-compare-draw-trace.mjs
node tools/recompile/compare-draw-trace.mjs --trace <external-trace> \
  --night 1 --seed 24850 --frame 3 --frames 18000 --input <external-input> \
  --binary <external-binary> --save <external-pre-run-save> --out <result.json>
# Add --repeat-trace <external-repeat> to check RNG-projection repeatability.
# Repeat with --model-options tools/recompile/sourced-model-options.json
```

The result preserves both tick-to-model offsets 0 and 1, source/input hashes,
navigation update counts, and the first mismatch. Raw global values, game
source and assets are omitted. The patch was applied successfully to a fresh
archive of the pinned upstream revision; parser fixtures passed 13 checks,
the regenerated desktop target linked, and comparison fixtures passed. S2b
still needs encounter/state equivalence and resolution of the initialization,
extension, and object-selection gaps. All results remain MODEL_ONLY with
`rebuilt-runtime` fidelity; none is a phone result or promotion edge.

## Child events and the first divergence (2026-09-27 continuation)

The earlier 18,000-office-update runs are preserved as negatives, **not evidence
of faithful navigation**. Debugger watchpoints showed `viewing` start at 0 and
change to 9 then 1 during the first update, without the required parent gates.
That suppressed the `viewing == 0` Random(1000) draw and caused the sourced
variant's initialization mismatch. The old default tick-6 mismatch separately
comes from the two cosmetic Every(100 ms) draws that defaults disable.

The APK runtime's child-list path establishes action 43, flags 0x40/0x8000,
end condition -42, and selection-restoring condition -43/parameter 69. The patch
now partitions nested lists, invokes children after successful parent actions,
and keeps nested snapshots so one child's filtering cannot narrow its sibling.
It does not re-evaluate parent conditions. The synthetic fixture compiles real
converter-emitted event bodies and runs the actual snapshot stack; malformed
boundaries and unsupported triggered children are rejected.

That correction exposed an unsupported title timer: source group 78 schedules
an event after 200 ms; group 79's OnTimerEvent owns transition children 80–85.
The child-only checkpoint `2bf1c66` retains a 4,000-update title stop as
`night1-child-timer-blocked-20260927.json` (`TARGET_NOT_REACHED`). Its preceding
parent `9db9aed` reproduces the earlier flattened implementation.

The current patch implements source-defined one-shot timer dispatch before
ordinary events. Rebuilding and replaying the same input/save now reaches the
office in 1,949 navigation updates, including 12 more title updates for 200 ms,
then stops after 64 office updates (2,013 total). Watchpoints show `viewing == 0`
at loops 0 and 63, no intervening writes, and the random-image guard firing only
once. The generated results retain the new boundary:

- `night1-child-timer-default-20260927.json`: divergent at tick 0 (rebuilt 2 draws,
  default 1). Production defaults are unchanged.
- `night1-child-timer-sourced-20260927.json`: initialization now matches; the
  first 5 office updates match the declared sourced model with offset 1. The next
  mismatch is tick 5/model frame 6: rebuilt 2 draws/state 30314 versus model 4/state 45890.
  The rebuilt Every(100 ms) draws occur at tick 6. No whole-night equivalence.
- `child-event-diagnosis-20260927.json`: generated debugger/census/source-hash
  record, with the child-only navigation negative, both new comparisons, and
  the next timer-phase test. Raw owned data remain external.

Run the new fixtures with the patched external toolchain:

```sh
PYTHONPATH=<anaconda>:<anaconda>/Chowdren <python2.7> tools/recompile/test-child-events.py
node tools/recompile/test-child-diagnosis.mjs
```

For the short replay, copy `fixtures/night1-before.ini` to `freddy2` in an
isolated external directory containing an `Assets.dat` symlink. Use the existing
harness recipe with seed 24850, `fixtures/night1-newgame.input`, stop-frame 3,
max-ticks 64, and max-total-ticks 4000. For debugger reproduction, use
`CHOWDREN_BINARY=/recompile/run-debug-probe.sh`, set `CHOWDREN_DEBUG_BINARY` to
the rebuilt executable and `CHOWDREN_GDB_SCRIPT` to a matching `probes/*.gdb`.
The `child-before-*` scripts target `9db9aed`; `child-timer-viewing.gdb` targets
the current patch. Stop the old RNG probe after 8 office updates and the old
viewing probe after 2; all probes still have the unconditional harness deadline.
Generated function IDs require the same source hash/config and patch checkpoint.

The correction does not establish repeat timers, dynamic/non-ASCII timer names,
deleted-object selection override, qualifier/foreach semantics, immediate touch
dispatch, unsupported extensions, or full-state equivalence. Next: verify the
sourced model's Every first-evaluation clock, without tuning production defaults.

## The countdown origin and the packed flag test (2026-09-27, later)

**Countdown origin (model side).** `classes.dex` settles the first `Every`
evaluation: `CRun.initRunLoop` runs no events; the first `f_GameLoop` runs the
StartOfFrame list once (`CEventProgram.compute_TimerEvents`, which then zeroes
the list pointer) and then the first always pass, where every `CND_EVERY2` is
first reached and loads (`eva2` 7..46, returns false). So g822's draw and every
ungated countdown's load share one loop, and Every 100 ms first fires on the
seventh. The model's frame-origin rule (`32e3cf6`) counted its countdowns as
loaded on a frame 0 it never plays, one loop early; it was chosen to match the
model's own `f % N` timers, not measured. `sourcedEveryOrigin` (default off,
requires the frame-time hook) loads a frame-1 reach on frame 1
(`packages/core/test/every-origin.test.js`). On the retained child-timer
binary (`3d680796`) it moves the first divergence from office tick 5 to tick
11100 (`night1-flagfallback-origin-20260927.json`, `recompile-draw-f1cd6c2a6a970199`).

**Packed flag test (rebuild side).** Tick 11100 is a footstep draw the model
spends for Toy Chica's hop onto hall stage 1, which the rebuild never made:
in the rebuild neither Toy ever left CAM 09, though the roll set `new chica`
value 0 to 1. Build 296 packs the 5 s promotion test (value 0 == 1 and value 1
== 0) into `FlagOn`'s one parameter, code 68 (`PARAM_MULTIPLEVAR`);
`CND_EXTFLAGSET.eva2` then filters the selection with
`PARAM_MULTIPLEVAR.evaluateNoGlobal`: `(flags & flagMasks) == flagValues` and
each packed alterable comparison by `CRun.compareTo` (0 ==, 1 !=, 2 <=, 3 <,
4 >=, 5 >; `CValue.greater` is `>=`). The converter emitted the first compared
value as a flag index, so group 354 tested flag 1. The patch now writes
`alterables->test_multivar(...)` for every such `FlagOn` (75 generated sites;
none of the 178 dumped uses is negated) and reads a packed double as build 296's
32.32 fixed point. The 20 `OnObjectLoop (..., param68)` uses are not converted
yet. The rebuilt night now plays through: 16,592 office updates, the static,
game over and the title.

On the rebuilt binary (`fe1cb39d`, patch `0f5c2a25`) with the origin, the first
office divergence is tick 9600 (`night1-multivar-origin-20260927.json`,
`recompile-draw-0149431085444dda`); without it, still tick 5
(`night1-multivar-sourced-20260927.json`, `recompile-draw-3e01dae547254838`).
Tick 9600 is Toy Bonnie's hop onto CAM 03, where the rebuild draws a footstep
and the model does not. The model narrowed footsteps to the hall stages
(`8a7288b`) because full-06's audio had no footstep sample on any Withered hop
onto CAM 01-04, while the sheet's groups 695-703 are identical for every
character and 704-708 play a sample on every draw. The overlap is each sprite's
own image box against `hear footsteps`; the rebuild gives every character a
24 x 24 box, and whether those boxes are the APK's images is not established.
The phone outranks the rebuild: next, read the character sprites' image sizes
and hotspots from the CCN image bank, then decide per character. No
equivalence claim; MODEL_ONLY with `rebuilt-runtime` fidelity throughout.

**Play mode.** `CHOWDREN_PLAY=1` without the harness mirrors the real left
mouse button into Multiple Touch slot 0 (the platform has already delivered it
to the mouse), so the monitor, lights, vents and mask answer a person. Off, and
under the harness, nothing changes. Known rendering gaps a player sees: text
objects sized and anchored differently, some colours (ink effects), an
unhidden sprite on the title, and the New Game confirmation's 16 x 16 touch
zone at the left of its 88 x 64 image.
