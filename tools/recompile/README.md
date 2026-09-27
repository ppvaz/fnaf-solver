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
| `model-draw-trace.mjs` | The simulator's `Random(N)` draws frame by frame (draws so far, LCG state), in the shape the harness traces: two runs of one night and seed that spend the same draws every frame read the same stream, and the first frame where the counts part is where to look. Refuses a `@fnaf2-1020/core` resolved outside its own checkout (a worktree without `npm ci` loads the parent's model). MODEL_ONLY. |
| `compare-draw-trace.mjs` | Reads an external harness trace and emits a hash-bound, content-free comparison result. `MATCHED_PREFIX` never means full event/state equivalence. `--custom-night FILE` names the ten Custom Night dials (night 7 only; every dial required) and records them in the scope. |
| `sourced-model-options.json` | Explicit diagnostic variant enabling the model's existing sourced flags. It does not change core defaults or establish fidelity. |
| `sourced-rebuild-model-options.json` | The origin set plus `sourcedFootstepDraws`, `footstepCamMarkers`, `sourcedBoxCountdown`, `sourcedPuppetMoveOrder`, `sourcedHourTable`, and for Custom Night `sourcedParkedMarker`, `sourcedCustomDialOrder` and `sourcedCam8Cancel`: the options under which the model matches the rebuilt no-input Nights 1-6 and the uniform Custom Nights up to each night's terminal loop. Diagnostic; defaults unchanged. |
| `sourced-rebuild-model-options-20260927a.json` | The rebuild set as it stood before the Nights 6-7 options (`sourcedParkedMarker`, `sourcedCustomDialOrder`, `sourcedCam8Cancel`), byte for byte: the file `rebuild-options-census-20260927` scored (`tools/rebuild-options-census.mjs --options`). A snapshot, never edited; a census of the current set is a new record. |
| `sourced-rebuild-dropflag-model-options.json` | `sourced-rebuild-model-options.json` plus `sourcedDropFlagOrder` (the drop button's flag at g618/g619, after g262/g274/g612). The set the 2026-09-27 drop-flag replays ran under; the main set is unchanged. |
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
| `fixtures/night7-dials20-5x2.input` | The all-20 Custom Night navigation on the corrected 5 x 2 portrait grid (binary `036076d3` on): portraits 4-9 toggled, then Ready. A dump before Ready reads all ten dials at 20. |
| `schedule-to-input.mjs` | A committed winner binding's own tap schedule as harness input: the rows its gate replays, expanded once into harness contacts and the Sim queue (refused unless the queue equals `minus-toys-plan.mjs` `schedule()`), quantized to 60 Hz frames, on the office frame at tick = queue frame. Points are the device profile's control points through the FULL stretch. Lists same-tick edges. minus-toys only. |
| `compare-schedule-replay.mjs` | The replay comparison: binds the harness input to the winner's regenerated rows, drives the model with the same Sim queue under `--model-options`, and records both outcomes (6 AM or death, time; the rebuild's death reason is UNKNOWN unless the stream matched to the terminal loop), the first draw mismatch, every mismatch run, a gate-replay cross-check, and per-update monitor/mask ledgers from `# watch` lines. Provenance names the model files measured (`modelSourceSha256`). `recompile-schedule-replay-v1`, MODEL_ONLY. |
| `test-schedule-replay.mjs` | FIXTURE for both: stretch points, one expansion, pointers and same-tick edges, the Night 1 minimal binding, prefix/slip/split/death outcomes, ledger pairing, input binding. In `npm run test:unit`. |

| `compare-schedule-replay.mjs` | The replay comparison: binds the harness input to the winner's regenerated rows, drives the model with the same Sim queue under `--model-options`, and records both outcomes (6 AM or death, time), the first draw mismatch, every mismatch run, a gate-replay cross-check, and per-update monitor/mask ledgers from `# watch` lines. A death's reason is the rebuild's own when the trace carries `# counter` lines watching `being attacked by` (`ATTACKERS`: its value -> the character, from the office sheet's g556-574/g722/g731), else the model's only when the stream matched to the terminal loop, else UNKNOWN. `--counter-trace` reads the counters from another run of the same replay; `--baseline RECORD` records whether an earlier record of the same replay has the same draw projection. `recompile-schedule-replay-v1`, MODEL_ONLY. |
| `test-schedule-replay.mjs` | FIXTURE for both: stretch points, one expansion, pointers and same-tick edges, the Night 1 minimal binding, prefix/slip/split/death outcomes, the attacker read from `# counter` lines, ledger pairing, input binding. In `npm run test:unit`. |

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
That command writes git's own file order. Since `de14d55` the committed patch
keeps its file order instead: regenerate only the sections of files that
changed, in place (`git diff`, or `git diff --no-index` from a pristine archive
of `9b00bb4` to the tree file, with the `a/` and `b/` headers set to the repo
path), and append files new to the patch at the end. Unchanged sections then
regenerate byte for byte. Verify with `git apply --check` against a pristine
`9b00bb4` archive, and by applying it there and comparing the tree.

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

## Winner schedules replayed (2026-09-27, S2b)

Every earlier rebuild comparison ran without gameplay input. This one replays a
committed winner's own tap schedule into the pinned binary `036076d3` (patch
`7767945f`, the committed patch) and the same Sim queue into the model under
`sourced-rebuild-model-options.json`, seed 24850.

```sh
node tools/recompile/schedule-to-input.mjs --winner tools/device/campaign-night5-contact-final-winner.json \
  --night 5 --navigation tools/recompile/fixtures/continue.input --out <run>/run.input
# harness recipe above, plus CHOWDREN_STOP_FRAME=5 CHOWDREN_MAX_TICKS=30 (stop on 06-next day) and
# CHOWDREN_WATCH='flip panel button:0' (a second run with CHOWDREN_WATCH=mask:0 for the mask ledger)
node tools/recompile/compare-schedule-replay.mjs --trace <run>/trace --repeat-trace <run2>/trace \
  --input <run>/run.input --navigation tools/recompile/fixtures/continue.input \
  --winner tools/device/campaign-night5-contact-final-winner.json --night 5 --seed 24850 \
  --model-options tools/recompile/sourced-rebuild-model-options.json \
  --ledger monitor --ledger mask=<mask run>/trace --save ... --binary ... --out <result.json>
```

The schedule is the gate's: `build(knobs)` rows at the winner's epoch (k3:
2433 ms), each millisecond rounded to a 60 Hz frame. The model applies a press
queued at frame F before its tick F -> F+1, which is harness office update F.
A tap or hold is `down` at its press frame and `up` at its release. A camdrop
holds the camera-feed light and taps the monitor as a second pointer, as the
HID schedule sends it. The window points are the profile's control points
(`hid-mediaprojection`, 2400 x 1080) scaled by 1024/2400 and 768/1080. They
land inside the pinned binary's hitboxes, as its office instance dump shows:
white, red and drop buttons, the two flashlight hitboxes, the music-box and
camera hitboxes. Each run is repeated. The office draw projections are equal
in both runs, and equal again in the mask-watch run. The whole traces differ
only in global value 10, an object address, as on the frozen binary. On all
three nights the comparison model ends on the gate replay's frame, outcome and
LCG state.

| binding | rebuilt | model | draw stream | ledgers | evidence |
|---|---|---|---|---|---|
| Night 1 `minimal` | 6 AM, 25,201 office updates | 6 AM, frame 25,201 | equal on 10,199 of the 10,200 updates before tick 10200, then split | monitor 8/8 changes paired | `night1-minimal-replay-20260927.json`, `recompile-replay-f0625216de3bf868` |
| Night 5 `contact-final` | **death** after 23,423 (390.4 s) | 6 AM, frame 25,201 | equal on 615 of 617, split at tick 617 | monitor 160/160, mask 156/156 | `night5-contact-final-replay-20260927.json`, `recompile-replay-7d1bffe0e1ed98b5` |
| Night 7 `k3`, all dials 20 | 6 AM, 25,201 | 6 AM, frame 25,201 | equal on 606 of 613, split at tick 613 | monitor 172/172, mask 168/168 | `night7-k3-replay-20260927.json`, `recompile-replay-80f41ded17461661` |

All three are DIVERGENT: no replay is equivalent, and a 6 AM in both is an
outcome match, not a trace match. What differs, and where:

- **The split: view draws for a Toy held at A = 1** (tick 10200 on Night 1, 617
  on Night 5, 613 on Night 7). g366, g368 and g419 draw `Random(100)` each update
  that Toy Bonnie, Toy Chica or Toy Freddy has `A == 2`, `your view` overlaps
  it, and `viewing > 0` (generated events 294_3/296_3 and their g419 twin). A
  passed roll sets A = 1. g350-g356 promote it to 2 only once B = 0 (the
  camera-feed flash sets B = 400), Toy Freddy only once Toy Chica is off CAM 09,
  and Toy Chica only once Toy Bonnie is. The model's `drawViewed` keys on
  `u.pending`, which is true for a roll held at A = 1 as well. So with the
  monitor up and the marker on CAM 09, it draws once per update per held Toy,
  and the rebuild does not. The held Toys are Toy Bonnie on Night 1, Toy Freddy
  on Night 5, and all three on Night 7, each stunned: the model's `stunUntil`
  agrees with the rebuild's B, for example Toy Freddy at tick 600 with B = 42 and
  `stunUntil` 642. Harness watches show A = 1 in the rebuild (Night 1, Toy
  Bonnie from tick 10200; Night 5, Toy Freddy from 600). On Night 1 the model
  also spends a g468-g476 fade draw for 8 updates: it marks C = 10 at the roll,
  where the sheet writes C only at the promotion, and the watched C stays 0.
  No-input nights never raise the monitor, so they never reached these groups.
  The fix belongs in the model, as a default-off option keyed to the sheet's
  A == 2 and its C write. None is made here, and no default changed.
- **One-update slips that rejoin, at every monitor drop** (Night 1 tick 6953;
  Night 5 53, 242; Night 7 199, 286). The drop button's groups (g614/g618,
  generated events 540_3/541_3) set `drop everything`, and they run after the
  forcedown (g262, event 204_3) in the sheet. So a drop touched on update F
  lowers the monitor on F+1. The model sets the flag at the press, and
  `tickForcedown` performs it in that same tick. The drop's two draws land one
  update early in the model, and the streams are equal again on the next
  update. Mask removal goes through the same flag (541_3, then g274 as event
  210_3), and the mask ledger shows it: `2>3 +1` on every cycle.
- **Night 7 only: g781 one update late in the model** (374, 434, 494, 554,
  then a footstep draw split at 600). This follows the drop slip at 286, but
  the cause is not established.
- **Ledger offsets.** Every monitor and mask contact takes effect in both, with
  the same offsets on every cycle. Rebuilt minus model: raise start +0, fully
  up +1, drop start +1, fully down +2; mask on +0, fully on +1, off +1, fully
  off +1. The model's state machines finish the raise, the lowering and the
  mask-on one update sooner than `flip panel button` / `mask` value 0 does.
  Whether any rule reads that difference is not established. The draws stayed
  equal through all of them before the split. On Night 5 the first raise falls
  on office tick 0 (epoch 0), and the rebuild takes it one update late.
  Its last monitor change is the model's 161st, a raise at tick 23406 that the
  rebuild never made, 17 updates before it left the office.
- **The Night 5 death.** The streams split at 617, so after that the two sides
  play different random nights. This record's rebuilt reason is UNKNOWN: the
  harness could not watch a Counter, and `being attacked by` is one. Snaps of
  the drawn replay, kept outside the repository, show Balloon Boy standing in
  the office at tick 23380 and Withered Foxy's jumpscare at 23410. That drawn
  run has the headless run's office draw projection exactly. The rebuild now
  names the attacker itself: Withered Foxy (next section).

Same-tick edges: each night has one update where a release and a press
coincide (Night 1: wind up, CAM 09 down at 21582; Nights 5 and 7: wind up,
camdrop light down, at 230 and 274). The harness raises one new-touch trigger
per update, and whether those presses landed is not read separately.

Scope: one seed, three bindings, host rebuild only, MODEL_ONLY with
`rebuilt-runtime` fidelity. No phone claim, no promotion, no default changed.
Open:
- A sourced option for the A = 1 / A = 2 split in the view draws (g366/g368/g419,
  and the fades g468-g476, which the model also marks at the roll). Then
  replay again to the next difference.
- The drop and mask-off slip in the model's press timing.
- The per-cycle ledger against the phone's recording, which S2b needs. It needs
  k2's or k3's phone runs; no k2 or k3 video exists on this machine.
- A counter watch in the harness, so a record can carry the rebuild's attacker.

**The Toy view draws, sourced (2026-09-27, later).** `sourcedPromotedViewDraws`
(default off; `packages/core/test/promoted-view-draws.test.js`) keys g366/g368/g419
on the promoted state, value 0 == 2. It uses the existing g344-g358 promotion
test, independent of the footstep option, and writes the fade counter
(g344-g360, C = 10) at promotion, not at the roll. A move made without a
recorded promotion is promoted on its own loop.

`sourced-rebuild-model-options.json` now carries it. Every no-input night's
comparison is unchanged, because the option acts only while the monitor is up.
Re-scored on the same rebuild traces (`*-replay-promoted-20260927.json`):

| binding | persistent split before | after | matched before it | rejoining one-update runs |
|---|---|---|---|---|
| Night 1 `minimal` | tick 10200 | tick 25200, the night's last update | 24,897 | 5 |
| Night 5 `contact-final` | tick 617 | tick 9862 | 7,188 | 21 |
| Night 7 `k3` | tick 613 | tick 12280 | 1,010 | 25 |

The rejoining runs are mostly the drop and mask-off slip above. The new
persistent splits (Night 5 at 9862, Night 7 at 12280) are the next differences
to read. All three records stay DIVERGENT.

**Both input options together** (`sourcedPromotedViewDraws` and
`sourcedDropFlagOrder` in `sourced-rebuild-model-options.json`;
`*-replay-combined-20260927.json`):

| binding | first mismatch | persistent split | matched before it | runs |
|---|---|---|---|---|
| Night 1 `minimal` | 21714 | 25200, the last update | 24,899 | 3 |
| Night 5 `contact-final` | 1800 | 17675 | 7,201 | 8 |
| Night 7 `k3` | 600 | 3845 | 915 | 7 |

Night 7's first mismatch is the footstep draw one update early at tick 600,
which the drop-slip work also left open. After it, the streams no longer rejoin
the way they did with the drop slip in place. That draw is the next Night 7
target.

**The hall-light latch order.** Night 7's first mismatch (tick 600) was one
footstep draw spent a loop apart. In the rebuild, Withered Bonnie is promoted on
the roll's loop (value 0 = 2, value 2 = 9) but reaches hall stage 1 a loop later.
The counter watch shows `viewing hall light` at 1 from the light press at 590
through tick 599, and 0 at the end of 600.

g381 (CAM 07 to hall stage 1) needs that latch at 0. g488 (Every 1000 ms)
clears it and g489 re-sets it while lit, both after the moves g380-g383. So a
move on the boundary loop still sees 1. The model's hooked clock cleared its
latch at the top of the tick, before the rolls and moves.

`sourcedHallLatchOrder` (default off, `hall-latch-order.test.js`) defers the
reset, and the re-assert while a light is held, to just after the moves. It is
in the rebuild set now; the no-input ladder is unchanged.
`*-replay-latch-20260927.json`:

| binding | first mismatch | persistent split | matched before it | runs |
|---|---|---|---|---|
| Night 1 `minimal` | 21714 | 25200, the last update | 24,899 | 3 |
| Night 5 `contact-final` | 7200 (was 1800) | 17675 | 7,204 | 5 |
| Night 7 `k3` | 900 (was 600) | 20791 (was 3845) | 923 | 12 |

**Footstep value 2, and rolls before moves.** Two more differences, found the
same way (model draws and events against the rebuild's per-update draws, then
Counter and object watches):

- **Tick 900 (Night 7):** the rebuild draws Withered Freddy's footstep on the
  loop he is promoted, while he still stands on CAM 03, a `hear footsteps`
  marker. That is the adjudicated `sourcedFootstepValue2` rule: the cue fires on
  the first loop of value 2 > 0 on a marker. The rebuild set now carries it.
- **Tick 1200 (Night 7):** Mangle's roll passed in the rebuild and failed in the
  model on the same LCG state. Both hold her AI at 15: the sheet clamps it, and
  `cust_mangle AI` keeps the dial's 20. The model moved Withered Chica CAM 02 to
  CAM 06 inside the roll pass, spending her e324 `Random(4)` between Chica's
  roll and Golden Freddy's. Every later roll of that loop then read another
  value. The per-update counts and states were still equal, so only the
  downstream effect showed.

  The sheet rolls everyone (g333-g343) before any promotion (g344-g358) or move
  (g380 on). `sourcedRollsBeforeMoves` (default off,
  `rolls-before-moves.test.js`) runs the promotions and moves after g343.

Both are in the rebuild set, and every no-input night is unchanged
(`*-replay-rolls-20260927.json`):

| binding | first mismatch | persistent split | matched before it | runs |
|---|---|---|---|---|
| Night 1 `minimal` | 21714 | 25200, the last update | 24,899 | 3 |
| Night 5 `contact-final` | 7460 | 23233 | 11,427 | 28 |
| Night 7 `k3` | 1800 | 20086 | 2,598 | 15 |

**Watching a replay.** `CHOWDREN_REALTIME=1` paces the harness's fixed 60 Hz
steps at real time, so a person can watch a winner's schedule play in a window.
The updates, draws and trace are unchanged. The first such run was k3's Night 7
at 10/20, shown to Pedro from `pinned/41b3f426-7163d628`.

**Rendering replays off-screen, and the winner screen.** Four more harness
switches (in the patch):
- `CHOWDREN_RAWVIDEO=<path>` streams every `CHOWDREN_RAWVIDEO_EVERY`-th
  drawn frame (default 2, so 30 fps) as raw 1024 x 768 RGB, rows bottom-up, to a
  FIFO an encoder reads. It reads the screen FBO before the window blit, like
  the snapshots, so nothing else on the desktop can appear.
- `CHOWDREN_WINDOW=WxH+X+Y` makes a borderless window at an exact place;
  64 x 48 is enough when rendering.
- Under the harness vsync is off: a vsynced swap blocked whenever the
  compositor stopped presenting a covered window, and froze a watched replay.
- GNOME on Wayland gives `x11grab` an empty root window. Screen capture there
  goes through `org.gnome.Shell.Screencast` (one held D-Bus connection) and can
  catch whatever covers the area, so rendered footage uses `CHOWDREN_RAWVIDEO`.

Measured on the host with the agents loading it: headless 17x real time,
drawing with readback 3.4x, drawing with a live 640 x 288 encode 2.7x; three
renders at once about 0.5x each.

`winner-screen-rebuild-20260927.json`
(`recompile-winner-screen-aa95339c9f198cfb`) replays twelve committed winner
bindings' own schedules into the rebuild at seed 24850. 11 reach 6 AM (Nights
1-7, including k2, k3 and j on Night 7 at 10/20). `toys-n5` dies after 23,423
office updates, like `contact-final`. One seed; this is the rebuild, not the
phone.

**Font atlas.** Pedro saw lowercase n drawn as a filled square in the bold
preset names ("New and Shiny", "Cupcake Challenge", "Golden Freddy"). The bank's
glyph is sound. Chowdren's `FTTextureFont` checked for the end of a row after
writing a glyph, so one glyph per row could be written past the atlas's right
edge. It spilled into the next row and got texture coordinates past 1.0. In the
Roboto bold 43 face that glyph is n. The packer now wraps before placing a glyph,
and sizes the atlas with the padding counted (`font.cpp`, in the patch). Binary
`22610def` (same assets) draws the names correctly.

**Checked against the phone, no change needed.**
- The monitor button's chevrons point down in every state, as on the phone's
  office frame. `flip panel button` is one static image (289), and the events
  only move and hide it.
- The first raise opens CAM 09 on Nights 1-6 and CAM 07 on Night 7 (sheet
  g2-g4, g486-g487; the model's `initialCamera`). The rebuild's Night 7 raises
  open Main Hall. The phone frames that show CAM 11 come after the executor has
  tapped it to wind the box.

## The drop button's flag order (2026-09-27, S2b)

This closes the second open item above: the one-update drop and mask-off slip.
From the Office frame's event dump (`03-04-Office.txt`) and the pinned binary's
generated source:

- `drop everything` (counter 141) is read by g262 (event 204_3: `flip panel
  button` v0 2 -> 3, `mmonitorDown` shown, v1 = 1, `viewing` = 0) and g274
  (210_3: `mask` 2 -> 3, `mmaskOff` shown, v1 = 1), and cleared by g612 (539_3).
  It is written by g574, g614/g615, g618/g619, g624 and g718-g721.
- g618 (542_3): touch 5 over the drop button, `flip panel button` v0 == 2 and
  v1 == 0, `mask` == 0. g619 (543_3): touch 5 over the drop button, `mask` ==
  2, v1 == 0, `viewing` == 0, `in danger` == 0. Both sit in group 33, the touch
  folder, which g0 (1_3) activates when global value 8 == 1. Their mouse twins
  g614/g615 (540_3/541_3) sit in group 32, which is `Closed+Inactive` and which
  nothing activates. The section above named g614 and events 540_3/541_3. The
  groups that run are g618 and g619, events 542_3/543_3, with the same
  conditions.
- The drop button spans 0-1024 x 678-768 in the pinned binary's office instance
  dump, under the white (512-1024) and red (0-512) buttons. So the profile's
  monitor point (759, 708) and mask point (256, 708) both touch it, and a
  mask-off touch is g619's.

So a drop or mask-off touched on update F raises the flag after that update's
g262, g274 and g612 have run, and it is performed on F+1.
`sourcedDropFlagOrder` (default off; requires `sourcedDropLightOrder`) puts the
model there. A drop or mask-off press records a touch. g618/g619 read it on the
same update, after the blackout resolution and `tickBox`. The next tick's
`tickForcedown` then performs it. g619 refuses a mask-off while in danger (the
model's `blackout.active`) and flags the refused contact. v1 is not modelled.
For a one-shot tap, g618 and g619 read it as 0. The Sim queue carries no release
for a tap, so the model reads a touch only on its press update. The sheet
re-reads a finger that is still down. Contract:
`packages/core/test/drop-flag-order.test.js` (`test:contracts`), including
"off leaves the default unchanged".

The ledger offsets, derived from the dump for a touch read on update F. A
latch (g1, g6, g9, g10) sits at the top of the sheet. Its counter (g1015-g1022)
sits at the bottom, is 1 at the end of the loop its Active is shown, and grows
by 1 per loop.

| change | rebuilt (sheet) | model before | rebuilt minus model | cause | with the option |
|---|---|---|---|---|---|
| raise start | g257 on F | F | +0 | - | +0 |
| fully up | g1 (`>= 12`) on F+12 | F+11 | +1 | animation count | +1 |
| drop start | g618 on F, g262 on F+1 | F | +1 | flag order | +0 |
| fully down | g6 (`>= 22`) + g7 on F+23 | F+21 | +2 | flag order + animation count | +1 |
| mask on | g270 on F | F | +0 | - | +0 |
| fully on | g9 (`>= 12`) on F+12 | F+11 | +1 | animation count | +1 |
| mask off | g619 on F, g274 on F+1 | F | +1 | flag order | +0 |
| fully off | g10 (`>= 14`) + g11 on F+15 | F+14 | +1 | flag order | +0 |

The flag order explains drop start, mask off, fully off, and one of fully
down's two. The other +1s have a second cause. The model decrements an
animation's counter in the tick that starts it, so a constant N spends N - 1
updates in the moving state, while the sheet's latch fires N updates after the
show loop. `MASK_ANIM_OFF` = 15 therefore gives the sheet's 14 updates.
`MONITOR_ANIM_UP`, `MONITOR_ANIM_DOWN` and `MASK_ANIM_ON` (12, 22, 12) give one
update fewer than the sheet. This reverses `docs/android/ANDROID-GROUP-MAP.md`
cluster 3's verdict: counted in updates, the mask-off constant is the one that
agrees. Not encoded here. The draws never read the difference before the
splits.

The three replays, re-run over the same retained traces (`agent-schedule/`
`n1-minimal`, `n5-contact-final`, `n7-k3` with their `-r2` repeats and `-mask`
runs; trace hashes equal to the first records'). They use the recipe above with
`--model-options tools/recompile/sourced-rebuild-dropflag-model-options.json`.
A record now also names the model files it measured (`modelSourceSha256`).
`model-draw-trace.mjs` refuses a `@fnaf2-1020/core` that resolves outside its
own checkout: a worktree without `npm ci` loads the parent checkout's model, and
the first Night 1 run here measured the parent's unchanged model without saying
so.

| binding | first difference before -> after | matched before the persistent split | ledgers (rebuilt minus model) | evidence |
|---|---|---|---|---|
| Night 1 `minimal` | 6953 (drop slip) -> **10200**, the split | 10199 -> 10200, every update before it | monitor 8/8: raise +0, up +1, drop **+0**, down **+1**; 4 of 8 mismatched updates left | `night1-minimal-dropflag-replay-20260927.json`, `recompile-replay-89fce522a0465e58` |
| Night 5 `contact-final` | 53 (drop slip), 242 -> **617**, the split | 615 -> 617, every update before it | monitor 160/160 (drop **+0** x40, down **+1** x40; the tick-0 raise still +1/+2); mask 156/156 (off **+0**, fully off **+0**); mismatched updates 179 -> 99 and 117 -> 39 | `night5-contact-final-dropflag-replay-20260927.json`, `recompile-replay-0d63768eb9663543` |
| Night 7 `k3`, all dials 20 | 199 (drop slip), 286, 374, 434, 494, 554, 600 -> **600** | 606 -> 612 | monitor 172/172 (drop **+0**, down **+1**); mask 168/168 (off **+0**, fully off **+0**); mismatched updates 172 -> 86 and 126 -> 42 | `night7-k3-dropflag-replay-20260927.json`, `recompile-replay-191e76adc14cf1d7` |

Every per-drop slip is gone. So are Night 7's g781 slips at 374-554: they
followed the drop at 286 and leave with it. The outcomes do not change: Night 1
and Night 7 reach 6 AM on both sides, and on Night 5 the rebuild dies after
23,423 updates while the model reaches 6 AM. The gate replays agree under the
same options. What remains before each split:

- **Night 7, update 600.** The model spends one of its g695-g703 footstep draws
  on update 600, and the rebuild spends it on 601. The streams are equal again
  at 601. This is not the drop path, and the cause is not established.
- **The splits themselves** (10200, 617, 613): the Toy view draws at A = 1,
  the first open item above.

Scope: one seed, three bindings, host rebuild only, MODEL_ONLY with
`rebuilt-runtime` fidelity. No phone claim, no promotion, no default changed.
`sourced-rebuild-model-options.json` is unchanged. Open:
- The animation count (fully up, fully down, fully on +1), as its own option
  keyed to g1/g6/g9/g10 and g1015-g1022, if a rule turns out to read it.
- Night 5's first raise, on office tick 0, which the rebuild takes one update
  late.
- The Puppet's forcedown. g623 moves him onto the got-you box on update U. g574
  (earlier in the sheet) sees it on U+1 and writes the flag, and g612 clears it
  on that same update. g624 (`being attacked by` > 0, NotAlways) raises it
  again after g612, and g262 performs it on U+2. The model raises the flag at
  g623 and performs it on U+1, one update early. No replay here reaches it.
- Night 7's footstep draw at 600.

- ~~A counter watch in the harness, so a record can carry the rebuild's
  attacker.~~ Done, next section.

## The rebuild names its attacker (2026-09-27, S2b)

The harness gained a Counter watch, and the Night 5 replay now says who killed
it in the rebuild: **Withered Foxy**.

`CHOWDREN_WATCH_COUNTER=name,name,...` writes `# counters <spec>` once, then
after every event update `# counter <frame> <tick> <value>...`: the value of
each named Counter's first live instance, in the order named, or `-` where the
frame has none. Names may contain spaces, not commas. RTTI is off in the build,
so a name alone cannot say that an instance is a Counter. `Counter`'s
constructor records its object type id (`objects/counter.cpp`), and the watch
reads only instances of a recorded type. Nothing else reads the record. The
existing `# watch` and trace-row formats are unchanged, and runs without the
variable write the same trace as before. Values print with `%.17g`.

Binary `e616c431` (`pinned/e616c431-7163d628/`, the same `Assets.dat`) is
`22610def`, the lead session's font atlas fix, plus the watch. Only
`counter.cpp` and `run.cpp` (which includes `harness.cpp`) were recompiled. The
patch (57 files, `b95c854f`) keeps the committed file order. It appends
`base/font.cpp` for that fix, applies to a pristine `9b00bb4` archive
(`git apply --check` and GNU `patch`), and reproduces the tree. Only the
untracked `base/android/`, the generated `AndroidSans.dat` and the Cython
`.cpp` differ, as before. Its unchanged sections regenerate byte for byte.

```sh
# the Night 5 recipe above, on binary e616c431, plus
CHOWDREN_WATCH_COUNTER='being attacked by,in danger,got you stage,viewing,viewing hall light'
node tools/recompile/compare-schedule-replay.mjs ... (as above) \
  --baseline tools/recompile/results/night5-contact-final-replay-20260927.json \
  --out tools/recompile/results/night5-contact-final-replay-e616c431.json
```

The value table (`ATTACKERS` in `compare-schedule-replay.mjs`) is the office
sheet's writes of `being attacked by`: 1 Withered Freddy (g556/g560/g564),
2 Withered Bonnie (g557/g561/g565), 3 Withered Chica (g558/g562/g566),
4 Withered Foxy (g571-g573), 5 Toy Bonnie (g568, g722), 6 Toy Chica (g569),
7 Toy Freddy (g559/g563/g567), 8 Mangle (g731), 9 Puppet (g574), 12 Golden
Freddy (g570). Balloon Boy never writes it. The office's only jumps to
05-static (g588-g595) end the attack animation that g575-g587 show, force and
count while the counter is above 0.

Night 5 `contact-final`, `night5-contact-final-replay-e616c431.json`,
**`recompile-replay-232b3f74c48dc27a`**:

- **The watch changes nothing.** The office draw projection is `a3bbb988`,
  the same as `recompile-replay-7d1bffe0e1ed98b5` on `036076d3` (`baseline`),
  and the same again in the repeat, the mask-watch run and a fourth run. The
  alignments, mismatch runs, gate replay, model trace, and both ledgers (monitor
  160/160, mask 156/156, same offsets) equal the earlier record's. The counter
  series is identical in all four runs.
- **The attacker.** `being attacked by` is 0 through office update 23399 and 4
  from update 23400 to the last, 23422: **Withered Foxy** (`old foxy`). At the
  end of updates 23399 and 23400, `viewing`, `viewing hall light` and
  `in danger` all read 0. Of Foxy's three writers, that fits only g571, the
  Every 10 s check with the monitor down. g572 needs `viewing` > 0 and g573
  needs `viewing hall light` = 1. Balloon Boy was in the office (the earlier
  snaps), and he clears the hall light.
- **The exit is not the 40-update count.** The rebuild left the office 23
  updates after the write (390.0 s at the write, 390.4 s at the exit). A
  fourth run watching `attack animation:0` (trace sha256 `0f0ad9b1`, same draw
  projection) counts value 0 from 1 to 22, with global 5 = 1 on every update.
  So g588 (`>= 40`) did not end it. One of g589-g595, an attack animation
  finishing, did (g579 forces animation 15 for value 4, and g589 exits on it).
  The model kills Foxy on the 10 s check itself, with no animation, so its
  death frame lines up with the write, not with the rebuild's exit. A
  terminal-loop comparison of a Foxy death has to use the write.
- The model still wins this schedule. The streams split at 617, so the model
  never reaches this Foxy.

Scope: one seed, one binding, host rebuild, MODEL_ONLY with `rebuilt-runtime`
fidelity. No phone claim, no promotion, no default changed.
Open:
- Whether the phone's Foxy attack also ends on the animation (about 22 updates)
  rather than the 40-count. That needs the phone's frames or a dump reading of
  g576-g586, which the dump marks NoGood.
- The A = 1 / A = 2 view-draw option (above), then replay Night 5 again to see
  whether the model meets the same Foxy.

## The replay splits, one at a time (2026-09-27, S2b, continued)

Each difference below was read the same way: the model's draws for the update
(call sites), the rebuild's per-update draws, then a harness watch of the
object or Counter involved. The watches ran on `pinned/592c05e5-7163d628` from
the retained inputs and saves (`agent-splits/` outside the repository). Their
office draw projections equal the retained `036076d3` traces', so the records
below still score the retained traces and read the watched Counters through
`--counter-trace`.

**Promotion gates the move (`sourcedPromotedMoves`,
`packages/core/test/promoted-moves.test.js`).** Night 7 k3, tick 1800: the model
moved Mangle CAM 02 -> CAM 01 (g397) on her roll loop and drew her g703 footstep
there, and the rebuild did both a loop later. The watch (`new foxy` values 0-2,
Counters `decide path`, `viewing`, `viewing hall light`) shows value 0 = 1 at
the end of 1800 with the hall latch set, and the move at 1801 after g488 cleared
it. g358 promotes Mangle with `viewing` = 0 only while `viewing hall light` = 0,
on every hop. The model had that latch only on her CAM 07 and hall-stage hops,
through `canAdvance`. Under the option a move needs value 0 == 2, and the
promotion test (g344-g358) gates only the promotion. The moves (g374-g435) test
their own conditions (the latch, the final hops' `viewing`, `in danger` and
`office occupied`), never value 1 or the marker. So a promoted unit that is
flashed while its move waits on the latch still moves, as the sheet does.

| binding | first mismatch before -> after | record |
|---|---|---|
| Night 1 `minimal` | 21714 -> 21714 | `night1-minimal-replay-promotedmoves-20260927.json`, `recompile-replay-9676af3da04d2e69` |
| Night 5 `contact-final` | 7460 -> 7460 | `night5-contact-final-replay-promotedmoves-20260927.json`, `recompile-replay-abc975f06323ea4f` |
| Night 7 `k3` | 1800 -> **2044** | `night7-k3-replay-promotedmoves-20260927.json`, `recompile-replay-8439e5f8d6741573` |

The option is in `sourced-rebuild-model-options.json`. The dated snapshots are
unchanged. Scope: one seed, three bindings, host rebuild only, MODEL_ONLY with
`rebuilt-runtime` fidelity. No phone claim, no promotion, no default changed.

**Global value 5 from the timer (`sourcedValue5`, `packages/core/test/value5.test.js`).**
Night 7 tick 2044 and Night 5 tick 7460: the blackout flicker's first g517 draw
came one update earlier in the rebuild. A watch of `blackout` values 0-1 and the
`in danger` Counter shows the encounter start at 2025 (clock 1 at its end), and
the first `Random(50)` on 2044, with the clock at 20. g517 tests value 0 > 20
(`test_multivar` op 5), and g514 adds global value 5 per loop. g1236, the
office's last group (Always), sets value 5 to `Min(4, (TimerValue - global 0) /
D)` and then global 0 to TimerValue. The Android runtime reads D's Double token
as 32.32 fixed: 71582788266 / 2^32 = 16.666666666511446. The CTFAK dump prints
the IEEE reading, 16.66666603088379. Both are below 50/3, so at a steady 60 Hz
step value 5 is a hair above 1 and the clock passes 20 on the 20th loop. In the
rebuild, Toy Bonnie's watched value 1 on Night 1 drains by about 1 + 5e-8 per
loop (400 set, 0.999979 after 399 drains), which fits a float32(1/60) s step over
the 32.32 divisor. The model's rebuild set said `frameValue5` 1.

Under the option, value 5 on loop f is g1236's `Min(4, frameMs(f - 1) / D)`: the
previous loop's delta, as the sheet reads it. It replaces `frameValue5` and
refuses it alongside. In the rebuild set, `frameValue5` gives way to it. Only
strict comparisons at an integer can tell a hair above 1 from 1: here, g517's
`> 20`. The drains that clamp at 0 (value 1, value 2, `hall movement`, the
music button's hold) count the same loops either way. The no-input ladder
(`*-rebuild-036076d3.json`, the retained traces) re-scores unchanged: the same
status, compared updates and first mismatch on all nine nights.

| binding | first mismatch before -> after | record |
|---|---|---|
| Night 1 `minimal` | 21714 -> 21714 | `night1-minimal-replay-value5-20260927.json`, `recompile-replay-222cf9f47ef9cf69` |
| Night 5 `contact-final` | 7460 -> **7740** | `night5-contact-final-replay-value5-20260927.json`, `recompile-replay-215d53586e6cecef` |
| Night 7 `k3` | 2044 -> **2100** | `night7-k3-replay-value5-20260927.json`, `recompile-replay-1a13eb91f66cea4e` |

**Footsteps at the office opening (`sourcedOfficeFootsteps`,
`packages/core/test/office-footsteps.test.js`).** Night 7 tick 2100: one more
draw in the rebuild on a roll loop. The watched blackout flicker's `Random(50)`
and `decide path` place it: the flicker took the same LCG draw on both sides,
and `decide path` (g744) took the draw after the model's. So the extra draw sits
between g517 and g744. Instance dumps before and after update 2100
(`CHOWDREN_DUMP_FRAME/TICK`) show Withered Bonnie, standing on `in office` in
her encounter, go from value 0 = 0 to 2 with value 2 = 9. Her roll passed, g346
promoted her, and g696 drew her footstep ahead of Mangle's g703. `in office`
(668, 612) lies inside `hear footsteps` (x 538-802, y 458-609) for the
bottom/centre-hotspot sprites: W. Bonnie, Toy Bonnie and Mangle among the route
units (`docs/android/ANDROID-SOURCE-STATUS.md`). The dump puts W. Bonnie's box at
656,589-680,613. The model rolled no unit at the opening into a promotion, and
kept 122 off the footstep markers.

Under the option a passed roll at 122 promotes the unit where it stands (no
move group leaves 122), and those three draw their footstep there. So does an
arrival at 122 while value 2 is above 0. The option requires
`sourcedFootstepValue2` and `sourcedRollDraws`. The no-input ladder re-scores
unchanged. Night 1's last split (tick 25200) goes too: Night 1 now has no
persistent split, and only two runs that rejoin, 21714 and 23400.

| binding | first mismatch before -> after | record |
|---|---|---|
| Night 1 `minimal` | 21714 -> 21714 (no persistent split) | `night1-minimal-replay-officefootsteps-20260927.json`, `recompile-replay-77da9b5228c837fc` |
| Night 5 `contact-final` | 7740 -> 7740 | `night5-contact-final-replay-officefootsteps-20260927.json`, `recompile-replay-3999b92f7f3e9d55` |
| Night 7 `k3` | 2100 -> **2324** | `night7-k3-replay-officefootsteps-20260927.json`, `recompile-replay-ad22e514332da620` |

**The encounter ends on the clock (`sourcedBlackoutClockEnd`,
`packages/core/test/blackout-clock-end.test.js`).** Night 5 tick 7740: the
rebuild drew the g539 `Random(500)/night` repel one update before the model, and
every Night 7 encounter ended the same way (tick 2324, a one-update slip). The
watched clock reads 300 at the end of 2324, with `in danger` back to 0 on that
update. g537 (value 0 >= 300, NotAlways) sets `check and move`, and g538-g555
resolve on the same loop. g514 adds global value 5 from the loop `in danger`
rises, that loop included, so the clock reaches 300 on the encounter's 300th
loop. That is 299 frames after the model's start frame, where the model
resolved 300 frames after it. Under the option the resolution reads the g514
clock that `sourcedBlackoutDraws` keeps. It requires that option and `frameMs`.
The no-input ladder re-scores unchanged.

| binding | first mismatch before -> after | record |
|---|---|---|
| Night 1 `minimal` | 21714 -> 21714 | `night1-minimal-replay-blackoutend-20260927.json`, `recompile-replay-08f5e9dc54e9e100` |
| Night 5 `contact-final` | 7740 -> **7811** | `night5-contact-final-replay-blackoutend-20260927.json`, `recompile-replay-3eb3e4691cd3ce0f` |
| Night 7 `k3` | 2324 -> **3562** | `night7-k3-replay-blackoutend-20260927.json`, `recompile-replay-e9390ac2828cd9ac` |
