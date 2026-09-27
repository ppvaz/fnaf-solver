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
| `compare-draw-trace.mjs` | Reads an external harness trace and emits a hash-bound, content-free comparison result. `MATCHED_PREFIX` never means full event/state equivalence. `--custom-night FILE` names the ten Custom Night dials (night 7 only; every dial required) and records them in the scope. |
| `sourced-model-options.json` | Explicit diagnostic variant enabling the model's existing sourced flags. It does not change core defaults or establish fidelity. |
| `sourced-rebuild-model-options.json` | The origin set plus `sourcedFootstepDraws`, `footstepCamMarkers`, `sourcedBoxCountdown`, `sourcedPuppetMoveOrder`, `sourcedHourTable`, and for Custom Night `sourcedParkedMarker`, `sourcedCustomDialOrder` and `sourcedCam8Cancel`: the options under which the model matches the rebuilt no-input Nights 1-6 and the uniform Custom Nights up to each night's terminal loop. Diagnostic; defaults unchanged. |
| `sourced-rebuild-model-options-20260927a.json` | The rebuild set as it stood before the Nights 6-7 options (`sourcedParkedMarker`, `sourcedCustomDialOrder`, `sourcedCam8Cancel`), byte for byte: the file `rebuild-options-census-20260927` scored (`tools/rebuild-options-census.mjs --options`). A snapshot, never edited; a census of the current set is a new record. |
| `fixtures/night{2,3,4,5}-before.ini`, `fixtures/continue.input` | Saves holding only `level=N` (Continue loads `max(1, min(5, level))`) and the Continue tap, through its 16 x 16 touch zone at [64,528,80,544]. No game assets. |
| `fixtures/night6-before.ini`, `fixtures/night6.input` | A save with `beatgame=1` (the title's g1 shows 6th Night from it) and the tap on 6th Night's centre (its touch zone is [64,584,464,648] on the frozen binary). |
| `fixtures/night7-before.ini`, `fixtures/night7-{dials0,dials20,preset}.{input,json}`, `fixtures/night7-{dials0,dials20}-5x2.input` | A save with `beatgame=1` and `beat6=1` (Custom Night's g26/g50 gates), the title tap, portrait taps on the customize frame and Ready; each `.json` is the dial vector for `--custom-night`. The `-5x2` inputs tap the same dials on the corrected 5 x 2 grid (binaries from `4151d2a` on); the originals tap the frozen binary's stair-stepped grid. |
| `sourced-origin-model-options.json` | The same sourced flags plus the frame-time hook at 60 fps (`frameMs` 50/3, `frameValue5` 1) and `sourcedEveryOrigin`: every countdown loads on the loop it is first reached. `model-draw-trace.mjs` turns the two hook constants into per-frame functions. Diagnostic; defaults unchanged. |
| `make-android-fonts.py` | Writes Chowdren's font bank from Roboto TTFs held outside the repository at the font bank's pixel sizes (13-43, bold 43): the face Android substitutes for the game's Consolas and Tahoma, drawn at `|lfHeight|` px. Output `Chowdren/fonts/AndroidSans.dat`, next to the converter; no font data is committed. |
| `native-frame.py` | Scales harness snaps (1024 x 768) to the phone's 2400 x 1080 MediaProjection frame as Display Mode FULL does, with bilinear filtering as the phone's frames show, and prints per-rectangle distances to a phone frame. Frames stay outside the repository. |
| `game-config.py` | Chowdren `--config` for the other build-296 mobile CCNs (FNaF 1, 3, 4): the FNaF 2 config's overrides with extension identity resolved by item name (`Multiple Touch`, `Layer object`, `*.KYSO`, `Ini`...), since each game numbers its extension object types differently. |
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

**The whole office visit (later still).** Three more one-loop and geometry
differences, each read from the source before it was encoded, each a
default-off option (`packages/core/test/rebuild-order.test.js`):

- `footstepCamMarkers`: the CCN puts CAM 01-04 under `hear footsteps` -- its
  264 x 151 image is opaque at every pixel, every character is an opaque
  24 x 24 fine-collision sprite (hotspots paired Toy/Withered), and
  `CSpriteGen.spriteCol_TestSprite_All` tests hidden sprites (`SF_RAMBO`, no
  hidden check). This restores `fcbbd45`'s set, against full-06's audio
  reading (`8a7288b`). That reading was adjudicated later the same day
  ([`footstep-cam-markers-adjudication-20260927.json`](../../docs/evidence/footstep-cam-markers-adjudication-20260927.json)):
  its detector never read samples 25-29 in that capture, not even on the hall
  stages, and finds 0 of 60 footsteps injected on the roll phase at the
  capture's own channel-15 gain, so the set is sourced; value 2's window does
  not reconcile them, since Withered Chica's and Freddy's CAM 02/03/04 hops land
  in their promotion loop. The knob stays off until a comparison adopts it;
  `sourcedFootstepValue2` (default off) applies value 2's window and edge.
- `sourcedBoxCountdown`: g653-g660 drain through a gated Every 50 ms after the
  packed test (value 1 == 0, value 0 > 0), so the box empties 3000 loops after
  the first 2 AM reach, in whole units; a wind sets value 1 to 10 and g661
  drains it after the drain, so draining resumes ten loops after a wind. The
  rebuild spent g494/g495 a loop after the model.
- `sourcedPuppetMoveOrder`: g496 arms the Puppet's hop and g403-g411, earlier
  in the sheet, carry it out on the next loop; the model moved him the same
  frame. The rebuild's dump shows value 0 = 2 into tick 15841 and the Puppet in
  the office into tick 15842; g623's gated Every 1000 loads on arrival.

With all of them (`sourced-rebuild-model-options.json`), the model spends the
same draws with the same LCG state as the rebuilt runtime on **every one of the
16,592 office updates** of seed 24850's no-input Night 1, to the Puppet's
attack (`night1-rebuild-options-20260927.json`,
`recompile-draw-9ae2e0e8dbffdefb`). The comparator says INCOMPLETE because the
rebuild leaves the office 30 updates after g574 starts the attack (the
jumpscare, then the static frame) while the model counts its kill 40 frames
after it (`INSIDE_ATTACK_FRAMES`, which config.js says was cited to a different
mechanic): no rebuilt update is unmatched. Scope: one seed, one night, no
gameplay input, draws and LCG state only, `rebuilt-runtime` fidelity; not a
phone claim and not a default change.

**Nights 1-5 (still later).** `sourcedHourTable` runs hour 0's rows on the
first loop at g673-g684 (after g822, before g811) and adds the Golden Freddy
roll the dump makes there on nights 3 (g677, Random(1000)), 4 (g679) and 5
(g681, Random(100)); the rebuild spent it on office tick 0 of nights 4 and 5.
With it, seed 24850's no-input nights, reached through Continue from `level=N`
saves, match on every office update before the loop that ends the night:

| night | rebuilt office updates | result | evidence |
|---|---|---|---|
| 1 | 16,592 | every update matched; the model's kill (+40) outlasts the rebuild's exit (+30) | `night1-rebuild-options-20260927.json` |
| 2 | 5,852 | matched to the jump loop (tick 5851) | `night2-rebuild-options-20260927.json` |
| 3 | 3,023 | matched to the model's Foxy kill frame (tick 3000) | `night3-rebuild-options-20260927.json` |
| 4 | 2,423 | matched to the model's Foxy kill frame (tick 2400) | `night4-rebuild-options-20260927.json` |
| 5 | 2,552 | every update matched | `night5-rebuild-options-20260927.json` |
| 6 | 1,772 | every update matched; the model's Puppet kill (+40) outlasts the rebuild's exit (+30) | `night6-rebuild-options-20260927.json` |
| 7, all dials 0 | 3,023 | matched to the model's Foxy kill frame (tick 3000) | `night7-dials0-rebuild-options-20260927.json` |
| 7, all dials 20 | 1,223 | matched to the model's Foxy kill frame (tick 1200) | `night7-dials20-rebuild-options-20260927.json` |
| 7, default preset (negative) | 1,223 | DIVERGENT at tick 61 against the preset's own dials; matched to the Foxy kill frame against all 20: the rebuild's Ready copy, not the model | `night7-preset-rebuild-options-20260927.json`, `night7-preset-as-dials20-rebuild-options-20260927.json` |

`MATCHED_TO_TERMINAL_LOOP` is the comparator's name for a first mismatch that
falls on the model's death frame (the model's kill returns before the rest of
its frame) or on the last update of a visit the rebuild left (the jump to the
static frame); a harness stop at the tick limit never qualifies
(`test-compare-draw-trace.mjs`). What the loop that ends a night draws in the
runtime is not modelled. One Night 3 run was killed by the harness deadline at
office tick 353 while four runs shared the Docker VM; the same replay alone ran
to completion. Scope as above: one seed, no gameplay input, draws and LCG
state only. Nights 6 and 7 (rows 6 and 7 above) are in "Nights 6 and 7 on the
frozen binary" below: they ran on a later binary, with three more options.

**Title touch zones.** The mobile port's buttons are touched through
`olivier_btnTouchzone` Actives built at StartOfFrame (dump groups 58-61:
Foreach over qualifier 80; OnObjectLoop creates a zone at the button,
SetXScale(400/16), SetYScale(4); Options and Unlocks narrow to 320).
`OnObjectLoop` has no writer, and the default one reports object `(None, 2)`,
so `write_foreach` keyed the loop instance by `(None, 2)` while `CreateObject`
looked up its qualifier parent `(32848, 2)`: every iteration made a zone at
every button and scaled only the first -- 64 zones, most 16 x 16 at a button's
left end (the tiny Yes and Continue targets). The patch keys the loop by the
condition's own `(objectInfo, objectType)`: 8 zones, one per button, 400 x 64
and 320 x 64 (`title-touchzones-20260927.json`,
`recompile-zones-b941764a3c383d40`). The Night 1 replay on the fixed binary has
the committed record's draw projection byte for byte. The committed input
fixtures still tap the left-end points, which lie inside the full zones.
Groups 60/61 carry an undecoded parameter 69 before their overlap test, and
the 20 `OnObjectLoop (..., param68)` loops in the Custom Night customize frame
still reduce their packed test to its first value.

**Play mode.** `CHOWDREN_PLAY=1` without the harness mirrors the real left
mouse button into Multiple Touch slot 0 (the platform has already delivered it
to the mouse), so the monitor, lights, vents and mask answer a person. Off, and
under the harness, nothing changes. Known rendering gaps a player sees: text
objects sized and anchored differently, some colours (ink effects), an
unhidden sprite on the title, and the New Game confirmation's 16 x 16 touch
zone at the left of its 88 x 64 image.

## A playable rebuild (2026-09-27, evening)

Pedro played the rebuild and reported what a player sees; each report led to a
source-read fix, in the patch unless noted. Frames were captured with the new
`CHOWDREN_SNAP=frame:tick,...` (the drawn window as a PPM, written outside the
repository) and state with `CHOWDREN_WATCH=name:i,j` (one `# watch` trace line
per update: the frame's scroll, the object's x and alterables); instance dumps
now list ten alterable values. `CHOWDREN_PLAY=1` still mirrors the mouse into
touch 0 outside the harness.

- Office and camera feeds swirled: Chowdren's Perspective shader applied its
  sine-offset code to every effect. FNaF 2 uses PANORAMA (effect 0); the shader
  now draws it as the APK's `res/raw/panorama_ext_frag.fsh` does, with
  `fB = ZoomValue / height` from `CRunPerspective.displayRunObject`.
- Blue static, blue sprites: the high 16 bits of each Android image record are
  the pixel format (0 RGBA8888, 1 RGBA4444, 2 RGBA5551, 4 RGB565, 5 JPEG: 435 /
  215 / 2 / 97 / 33 records), not a counter; the loader read every 2-byte record
  as RGB565.
- A minigame sprite on the title and in the office: placeholder frames (handle
  0) were given the bank's first image; they get a fully transparent one
  (`fnaf2-config.py`).
- Tiny, misplaced text: every text was drawn with the one packed bitmap font at
  a Windows point size. The APK ships no fonts, so Android falls back to Roboto
  at `TextPaint.setTextSize(|lfHeight|)`; the text writer now asks for
  `|lfHeight|` and `get_fonts()` packs `AndroidSans` (`make-android-fonts.py`).
- "v 2.0.6" on the title: `RunningAs` was compiled as Always, so every
  platform branch ran (Initialize, title, Unlocks, Options). `CND_RUNNINGAS`
  reads parameter 67 as a short and holds for 3, Android.
- Touch zones and camera hitboxes: the foreach body ignored its instance
  (`OnObjectLoop` keyed `(None, 2)`), and action expressions naming the
  iterated object were converted outside the iteration (`should_skip` cached
  the text), so `SetXScale(110 / GetWidth)` read the first hitbox.
- Camera buttons: `NOT touch on object` was negated per instance; an extension
  condition returns one boolean that NOT inverts, so group 36 wiped the camera
  touch on the loop after it began.
- Office panning and camera auto-pan: `SetGlobalValueInt` (106 uses) had no
  writer and compiled to nothing, so the pan gate's reset of global 10 never
  happened; and layer scroll coefficients are `CFile.readAFloat`, a
  little-endian int32 / 65536, read as IEEE floats (1.0 became 9.2e-41), so no
  layer scrolled. Initial global values are made as `CRunApp.initGlobal` makes
  them: `CValue(int)` from the raw word, the type byte unused.

- Custom Night grid stair-stepped, Unlocks labels on top of "Locked": Fusion
  divides two integers as integers (`CValue.div`) and Chowdren stores every
  alterable as a double, so `value0 / 5` came out fractional and each portrait
  column dropped 54 px. `/` now compiles to `FusionDiv` (`mathhelper.h`), which
  divides integral values as integers, divides by 0 to 0, and stays a float
  division when either side is a double; a left operand with a double literal
  keeps the float path at conversion time (134 integer sites, 101 float).
- Level numbers under the portraits, two-line labels left-aligned:
  `CTextSurface.manualDrawText` translates the StaticLayout so that its bottom
  sits on the box bottom for DT_BOTTOM (its descent correction
  `min(ceil(descent/2 - 1), 0)` is 0 at every bank size); Chowdren added a
  line height instead of `height - lineHeight`, and a layout made for a
  multi-line text never received the paragraph alignment.

On the final binary the no-input Night 1 office rows (frame, tick, draws, LCG
state) are byte-identical to `night1-rebuild-options-20260927.json`'s trace; the
title-to-office navigation is 659 updates shorter. Rendering fidelity is judged
by eye against phone captures that stay on the local machine; no frame enters
the repository. Still open: `OnObjectLoop (..., param68)` on Custom Night, the
nested foreach the converter reports, and Android's exact line metrics.

## Nights 6 and 7 on the frozen binary (2026-09-27, later still)

These ran on `frozen-db070b6a` (the binary's sha256 starts `db070b6a`), built by
a parallel session from a converter state after this tree's patch `0f5c2a25`
(foreach instance keying, per-instance action expressions). That state is not
committed, so the records' `patchSha256` names this tree's patch, not the
binary's; `binarySha256` identifies the binary.

**Regression.** Nights 1-5, replayed on it with the committed fixtures,
reproduce each committed record's `drawTraceSha256`, alignments and model trace
exactly. The raw traces differ only in global value 10, a `FixedValue` (an
object address as a double). It also differs between two runs of this one
binary.

**Night 6.** The title's g1 loads `beatgame` into 6th Night's value 0; the tap
(g49) sets `whereToGo` 3 and `night number` 6, and the 200 ms timer jumps to
the what-day frame. The model's night-6 table already rolls g683's Golden
Freddy `Random(10)` at 12 AM, so no new option: every one of 1,772 office
updates matches (`recompile-draw-6db9bfab7146cf42`). The same trace against the
night-5 model diverges at tick 900, so the comparison tells the nights apart.

**Custom Night navigation.** The Custom Night tap (g50) needs `beat6`, jumps to
the customize frame (12), and the office reads the ten global `cust_*` counters
at g787. The customize frame builds ten dials in fastloop 2 and fills them from
the preset string; the default preset holds Withered Freddy, Bonnie, Chica and
Foxy at 20. A portrait tap toggles its dial between 0 and 20 (g23-g26), and
Ready (g62) runs the dial copy (Foreach loop 0: g130-g139) and schedules the
jump. The rebuild lays the dials out with float division (`value 0 / 5` is
integer division in Fusion), so the rows staircase and portrait 9 covers Ready's
centre; the inputs tap at measured points outside every other zone. Harness
dumps just before Ready read all ten dials at 0 and at 20.

**Three mechanisms**, each read from the dump and the CCN before encoding. Each
is a default-off option, tested in `packages/core/test/rebuild-order.test.js`.
With all three on, Nights 1-6 give byte-identical model traces.

- `sourcedParkedMarker` (first divergence at 0 dials: tick 1212, a g498
  Puppet-static draw at CAM 10). g486 (`night <> 7` -> CAM 09) and g487
  (`night == 7` -> CAM 10) run in the StartOfFrame list *before* g632 copies
  `night number` into `night`. `night` is frame-local (no global flag in the
  CCN) with initial value 0, so g486 parks `your view` on CAM 09 every night.
  The rebuild's dump puts it inside CAM 09's box on Custom Night. The model's
  `parkedCamera(7) = 10` (and `tools/sourcetest.mjs`'s g486-487 check) did not
  account for g632's order. It matters before the first raise (g4 still opens
  CAM 07): the g498 draws and the flash target.
- `sourcedCustomDialOrder` (at 20: tick 60, g781's first Golden Freddy hall
  roll a loop late). g787 copies the dials on the first loop, after g781, which
  is the one office group that tests an AI counter (`Golden Freddy AI > 0`)
  ahead of its `Every`. The AI counters are global objects with initial value 0
  that keep their value between office visits (only the office writes them), so
  on a fresh launch g781 fails on loop 1 and its countdown loads on loop 2. A
  session that played a night first carries that night's last AI levels into
  this loop instead; the option models the fresh launch.
- `sourcedCam8Cancel` (at 20: tick 300, Withered Chica's CAM 04 footstep draw).
  g380 (Withered Bonnie's hop off CAM 08) also writes `old freddy` and
  `old chica` value 0 = 0, and g385 (Chica's hop off CAM 08) writes Freddy's.
  The hops run after every roll and arming, so on Custom Night, where g345/g348
  drop the story nights' wait-for-CAM-08 gates, Bonnie's departure cancels a
  Chica armed on the same loop: the rebuild's dump shows her armed (C = 9) and
  still on CAM 08. Not modelled: a Bonnie departure from the pending path after
  Chica's five-second hop in the same frame (it needs the marker to leave
  CAM 08 on a roll frame).

With them, all-0 dials match to the model's Foxy kill at tick 3000
(`recompile-draw-e732e419e6910c59`) and all-20 dials to the Foxy kill at tick
1200 (`recompile-draw-b3de3d3499343af9`); the rebuild leaves the office 22
updates later, as on Nights 3 and 4.

**Negative: the rebuild's Ready copy.** The default preset's run diverges from
its own dials at tick 61 (g781 rolls, so Golden Freddy's AI is not 0;
`recompile-draw-b8f99ee631502b90`) and matches the all-20 model to its terminal
loop (`recompile-draw-af6a896d4227c3dc`). The generated events 89_12-98_12
(g130-g139) copy `foreach_instance_loop_0`'s value 1 without their packed
`param68` test, so every copy runs for every dial and each counter keeps the
last dial visited. This is the unconverted `OnObjectLoop (..., param68)` named
under "Title touch zones". Until it is converted, only uniform dial vectors
(all 0, all 20) are valid on this binary; the sheet, and the phone, copy each
dial to its own counter.

Scope: one seed, no gameplay input, draws and LCG state only,
`rebuilt-runtime` fidelity. Not a phone claim, and no default changed. Open:
non-uniform Custom Night dials (the converter's `param68` loops); the pending-path
cancel; Custom Night after an earlier night in the same session; whether the
CAM 09 parking holds on the phone (seed-exact before the first raise).

## The office encounter and the jumpscares (2026-09-27, night)

Pedro played Night 7 on the rebuild: no jumpscare drew, and the office never
darkened when an animatronic came in. Three fixes, each read from the source,
all in the patch:

- **Jumpscares (`Extensions.CRunKyso`).** The ten jumpscares (Withered
  Freddy .. Golden Freddy; the attack marker's animations 12-21 are image-368
  timing carriers) are Kyso flipbooks: extension data swidth, sheight, mode,
  flags, play_speed and (version 2) BackToFrame, then the image handles. They
  start with no image (mode 0, flags 0) and FNaF 2 drives them with LoadCustom,
  Play and PlayLoop. The converter had no writer, so the object drew nothing and
  its actions compiled to nothing. `writers/extensions/Kyso.py` and
  `base/objects/kyso.*` transcribe `handleRunObject`/`Animation`: the counter
  gains play_speed per loop and a frame advances each time it passes 100. FNaF 4
  uses the same extension.
- **Mixed Custom Night dials.** Build 296 packs an alterable test into
  `OnObjectLoop` (parameter 11, then 68). A loop body is a triggered group, whose
  first condition is dropped from the code, and the packed test went with it.
  `write_loop_variable_test` emits it against the loop's current instance, so
  g130-g139 copy each portrait's dial to its own counter. Non-uniform dial
  vectors are valid from here on. The dial fixtures above tap the frozen
  binary's stair-stepped grid; on this layout the portraits sit on a 5 x 2 grid
  at x = 128 + 192 k, y = 112 or 384.
- **The blackout overlay.** `blackout` draws image 368, 16 x 16 solid black, in
  graphic mode 4 with transparent colour (0, 0, 0). `CImage.getFormat` loads
  format 4 as `Bitmap.Config.RGB_565`, which has no alpha. The phone draws it
  opaque, and the office goes dark. The decoder left RGB565 records without
  alpha, so the colour key made every black pixel transparent, and the overlay's
  g520/g521 flicker toggled an invisible image. RGB565 records are now opaque.
  Android builds its collision masks in native code (`CMask.allocNative`), so
  whether they honour the key is not visible in the dex. The Night 1 office rows
  are the check. The change touches only `Assets.dat`: the reconversion
  regenerated identical sources, and the build compiled nothing.

Confirmed in the harness on binary `036076d3` (Kyso and the loop test; no
opaque RGB565), with a scripted monitor raise every 8 s on the Withered trio:
Withered Chica enters on tick 1530 (seed 91). The blackout counters run (v0
from 1501; 60 hidden and 119 shown ticks while 20 < v0 < 200), but the office
stays lit: that is what led to the image 368 fix. The Foxy, Puppet and Withered
Chica jumpscares draw, and Pedro saw Bonnie's. Once the sequence ends, the
animatronic leaves for the got-you box, and the kill waits for the next monitor
raise (g458-g461, g469). That is the sheet's rule, not a defect.

**Pinned, and the whole ladder replayed (2026-09-27, afternoon).** The opaque
build is binary `036076d3` with assets `7163d628`, copied to
`pinned/036076d3-7163d628/` outside the repository. A later conversion can
truncate `input/gamesrc/Assets.dat` (the stopped one did); the pinned copy is
safe from that. `play/` and the replays read it.

On seed 91's encounter the office now goes dark. Tick 1533 (v1 = 28) is black;
the ticks around it with v1 < 25 show Withered Chica; from v0 >= 100 the room is
mostly or fully black; and at tick 1900 it fades back with Chica gone.

Every no-input night replayed on the pinned pair (`*-rebuild-036076d3.json`)
matches its committed record: same alignments, same model, same office length.
Nights 1-7 are therefore unchanged by FusionDiv, Kyso, the loop test and opaque
RGB565. Night 1's draw projection differs only in the shorter navigation before
the office.

The dial fixtures moved to the 5 x 2 grid (`night7-dials{0,20}-5x2.input`); the
frozen-grid originals stay with their records. The one change is the default
preset: before the loop test it was DIVERGENT at tick 61 against its own dials.
It now matches them to the model's Foxy kill frame (tick 1200,
`recompile-draw-38990fb11a7d970f`). That is the first non-uniform Custom Night
on which the rebuild and the model agree.

**Native frames against the phone.** Scaled to 2400 x 1080
(`native-frame.py`), the rebuild's title (save `night6-before.ini`, ticks 120,
200 and 250) lands its five menu labels on the phone's MediaProjection title
frame with glyph-mask IoU 0.948-0.999 (`native-frame-title-t{120,200,250}-20260927.json`).
Where the random background agrees, the mean difference is 0.9/255 ("New Game",
tick 120) and 1.2/255 ("Continue"). The larger means come from the title's
random static bands passing behind a label. So the FULL stretch with bilinear
filtering reproduces the phone's glyphs. The background (static, face flicker)
has not been compared frame for frame: it needs a matched RNG state, not one
frame.

`MMFPARSER_ANDROID_MISSING_SOUND=silence` (opt-in) substitutes a 10 ms silent
WAV for an Android sound missing from `res/raw`. The other games are parked for
now:
- FNaF 4 parses with `game-config.py`. Its first conversion was stopped at 4%
  of image compression, to free memory for FNaF 2's build.
- FNaF 1 and 3 need more than the silent substitute: their sound banks run out
  of bytes before the declared count, and part of their audio sits in
  `assets/` under obfuscated names. That layout is not decoded yet.
