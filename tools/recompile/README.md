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
- **Build-296 object handles are stored XOR 28.** Every event names an object
  by the handle CTFAK's dump shows (btnNewGame 15, btnContinue 16, btn6thNight
  23, btnCustomNight 27, btnUnlocks 37); the parser read the item headers and
  instance references as 19, 12, 11, 7 and 57 -- each exactly XOR 28 -- so
  every event bound to the wrong object (the title's New Game click tested the
  `night number` counter, INI reads called `get_value_int` on Actives and
  segfaulted). `ObjectHeader.read` and the frame instance loader now
  unscramble for build >= 290, and the title's click binds `btnnewgameactive_15`.

Reached: boot, frame 0 -> 02-title, the title's events on the right objects,
a scripted `downobj 0 btnNewGame.Active` landing on the button. **Next
boundary:** New Game does not leave the title. Its event sets
`whereToGo.Active` value 0 = 1 (and `night number` = 1), but the converter
creates `whereToGo.Active` and `night number` only in 05-static's init, never
on 02-title, so the action is skipped as a "frame-absent object" and nothing
reads the transition. Either the title's instance list is attributed to the
wrong frame or these are global objects whose carry-over Chowdren does not
model; the dump's title sheet references `whereToGo` 46 times, so on the phone
it exists there. INI (33) stays the inert stub in `fnaf2-config.py` until
re-tested now that handles are unscrambled -- its mis-binding was the same
XOR. Then: reach 04-Office, and compare a no-input Night 1 at seed 24850 with
`model-draw-trace.mjs` (the model dies to the Puppet at frame 17680 after 1215
draws).
