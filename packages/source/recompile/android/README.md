# Chowdren → Android backend (route a)

Goal: build the desktop-only recompile (`../README.md`, `../mmfparser-chowdren-mobile.patch`)
for `arm64-v8a` Android and sideload it to the Moto g56 as an own-package research
APK. **Content-free** — no game assets, no owned CCN.

## Target device (read 2026-08-28)

Moto g56 5G (`bogota_gn`) — **Android 16 (API 36)**, `arm64-v8a` (abilist
`arm64-v8a,armeabi-v7a,armeabi`), **4 KB pages** (`getconf PAGE_SIZE` = 4096, no
16 KB-alignment concern), 176 GB free on `/data`.
`install_non_market_apps=1`, no Advanced Protection Mode, Play-Protect ADB
verification not forced. Build targets API 34 (`targetSdkVersion 34`, installs
fine on 16); minSdk 24.

## Feasibility spike — result (2026-08-28): GO

Build env: `fnaf2-android-build:local` — `--platform linux/amd64` (the NDK ships
only `linux-x86_64` host binaries; Docker's amd64 emulation on Apple Silicon runs
them), NDK r26d, SDK platform-34 / build-tools 34, `adb`, SDL2 2.30
`android-project`. Verified: `aarch64-linux-android34-clang++` cross-compiles a
valid Android `.so`.

Syntax-checked **20 translation units** (engine core + `renderplatform` +
`platform` + `fbo` + generated `events_*/objects*/frame*_1/lists/fonts`) for
`arm64-v8a` with `-DCHOWDREN_USE_GLES1` against NDK `<GLES/gl.h>` + the draft
`include_gl` shim below. **Total: 12 errors, all trivial:**

- `base/fileio.cpp`: missing `#include <iostream>` — **fixed in the patch**
- `base/overlap.cpp` errors were a probe artefact: it is `#include`d into
  `common.cpp` (as `gencol.cpp` is into `collision.cpp`), never a standalone TU,
  and compiles clean in context
- the `glslshader.h` `GLhandleARB` errors were also an artefact of probing with
  the *desktop* renderplatform — the Android renderplatform will not include it
  (FNaF 2 has no shaders; `glslshader.cpp` is already excluded by the
  `CMAKE_CROSSCOMPILING` path)
- **net: one real one-line engine fix; all generated FNaF 2 code compiles as-is.**

NDK sysroot provides `libGLESv1_CM.so` (real ES 1.1 driver iface), `libEGL.so`,
`libOpenSLES.so`, `liblog.so`, `libandroid.so`. Missing and needing an NDK
cross-build: `freetype` (official Android build exists), `libogg`/`libvorbis`
(tiny pure-C), OpenAL-soft (CMake Android support) — or replace audio with
`SDL_mixer` / OpenSLES.

## Progress

- **Full APK pipeline proven end to end (2026-08-28).** `fnaf2-android-build:local`
  container → SDL2 `android-project` with `testgles2` as the app
  (`org.fnaf2rebuild.hello`, arm64-only, minSdk 24 / target 34, in
  `fnaf2-android:/root/ws`) → `./gradlew assembleDebug` → `app-debug.apk` (2.3 MB)
  → `adb install` on the g56 = **Success** (no Play-Protect block) → launched,
  SDLActivity focused, **GLES rendering on the device** (screenshot: the
  spinning gradient quad). Every uncertain link verified: amd64-emulated NDK →
  working arm64 `.so`; Gradle/AGP; sideload accepted on Android 16; SDL2 GL
  context + swap on the g56's **PowerVR** GPU (`IMGSRV` in logcat, not Mali).
- **Engine:** compiles for arm64 Android with **one** fix — `fileio.cpp`
  `#include <iostream>` (in the patch).

## Remaining work

1. ~~`testgles2` APK on the g56~~ — done.
2. ~~`include_gl.h` Android branch~~ — done (in the patch; GLES1 + `*OES` remaps).
3. ~~Android platform layer~~ — done. `desktop/{platform,renderplatform,fbo}.cpp`
   compile as-is for GLES1 (the remaps cover them); the only real edits are in
   `platform.cpp` (`#ifdef CHOWDREN_IS_ANDROID`: fullscreen window, and
   `set_resources_dir()` extracts `Assets.dat` from the APK via `SDL_RWops` and
   `chdir`s to internal storage). `base/android/glesshader.cpp` is the new file: a
   no-op `BaseShader` (FNaF 2 has no shaders; fixed-function ES 1.1 draws
   directly) that still `#include`s `shadercommon.cpp` for the blend-mode logic.
4. ~~ogg/vorbis~~ built inline from `base/staticlibs/` (as on desktop). ~~freetype~~
   not a real dep — `FTTextureFont` is Chowdren's own atlas font, reads from
   `Assets.dat`. ~~OpenAL~~ — `openal-soft` 1.23.1 cross-built static
   (`/opt/openal-soft/build-android/libopenal.a`, OpenSL ES backend).
5. ~~FNaF 2 `gamesrc` → APK~~ — **`libmain.so` (24 MB) links clean**;
   `./gradlew assembleDebug` → `app-debug.apk` (129 MB with `Assets.dat`).
   Self-contained `app/jni/CMakeLists.txt` (does not use the desktop-tangled
   `base/CMakeLists.txt`); `-std=gnu++14` (bundled boost + `register`),
   `_LIBCPP_ENABLE_CXX17_REMOVED_*`, `GL_GLEXT_PROTOTYPES`. Source lists parsed
   from the converter's own `gamesrc/CMakeLists.txt` (27 events, 29 frames, 5
   objects) so stale `events_28/29.cpp` are not built.
6. ~~`adb install` + boot on the g56~~ — **done. The recompiled FNaF 2 renders
   its title screen on the phone** (2026-08-28): `OpenGL ES-CM 1.1`,
   `screen_fbo` `GL_FRAMEBUFFER_COMPLETE_OES`, no GL errors, frame 0 → 1, 60 fps,
   openal-soft audio playing. The one runtime fix was `glEnable(GL_TEXTURE_2D)`
   in `set_gl_state()` — the desktop path samples through `texture_shader` (a
   real GLSL program), so the ES 1.1 fixed pipeline needs texturing explicitly
   enabled or every textured draw is the flat vertex colour (white screen).
   `desktop/platform.cpp` also gained `redirect_stdio()` (SDL 2.30 no longer
   mirrors stdout to logcat) and one-shot GL/FBO diagnostics.
7. Next: image-bank decode (shared with the desktop build — sprites are
   placeholder boxes), minor letterbox centring, touch input, then a night frame
   vs. the sourced model.

## Build recipe

Container `fnaf2-android` (image `fnaf2-android-build:local`, `--platform
linux/amd64`), mounts `/work` → anaconda checkout, `/input` → recompile dir.
Gradle project scaffold at `fnaf2-android:/root/game` (symlinks `SDL` →
`/opt/SDL`, `chowdren` → `/work/Chowdren`, `gamesrc` → `/input/gamesrc`, `openal`
→ `/opt/openal-soft`; `Assets.dat` copied to `/root/game-assets/`). `app/jni/
CMakeLists.txt` is committed here as `game-CMakeLists.txt`.
`cd /root/game && ./gradlew assembleDebug`.

## 2026-09-27: rebuilt on the Linux host, as an APK Pedro plays

Pedro asked to play the recompiled game on the phone as its own APK. That is a
personal research build: installed only on his g56, never distributed, and his
explicit exception to CLAUDE.md's "no separate APKs; everything on the phone is
the Companion" rule. The Companion stays the only study tool on the phone.

The August route used a Docker image on the Mac. This one runs on the Linux host
with no Gradle and no container:
- NDK r26d (`android-ndk-r26d-linux.zip`, SHA-1 `fcdad75a...` as published),
  CMake 3.28.6, build-tools 36 and platform 36, under
  `~/.local/toolchains`.
- SDL2 2.30.9 (shared) and openal-soft 1.23.1 (static, OpenSL ES backend),
  cross-built for arm64, minSdk 24.
- `libmain.so` from `game-CMakeLists.txt`. The CMake file now reads the
  extension objects from the generated `EXTSRCS` (Kyso, INI), and links a
  prebuilt SDL2 and openal given as `SDL2_PREBUILT` / `OPENAL_LIB`.
- `build-apk.sh` compiles SDL's Java classes (javac, d8), links the manifest
  with aapt2, stores `Assets.dat` uncompressed, adds the two libraries, then
  zipaligns and signs with a local debug key. It refuses to write inside the
  repository, because the APK carries game art.

Runtime changes, in the patch, all under `CHOWDREN_IS_ANDROID`:
- **Play mode** is on (touch 0 through SDL's touch-to-mouse events).
- **Display:** the screen is stretched to fill (`EXACT_FIT`, the phone's
  Display Mode FULL), and the screen FBO filters linearly, as the phone's
  frames show (`../native-frame.py`).
- **Shaders:** `base/android/glesshader.cpp` is back in the patch. It was lost
  when the route was archived and restored.

Limits of this GL ES 1.1 target: no shaders. The office panorama (PANORAMA,
`perspective.frag`) draws flat, and ink effects draw as plain textures.
Multi-touch is not wired: one finger drives touch 0.

Built 2026-09-27 from binary-equivalent sources (the patch at `f86ff123`):
`libmain.so` 33 MB (32 event files, 29 frames, 10 extension objects),
`libSDL2.so` 6.2 MB, APK 131 MB (package `org.fnaf2rebuild.play`), with the
pinned assets `7163d628`.

## 2026-09-27 (evening): the GL ES 2.0 renderer

The ES 1.1 target has no shaders. Its Perspective pass copied the screen and
redrew it opaque, which painted the office and cameras black on the phone, so
it was skipped and they drew flat. The desktop build draws them through
`perspective.frag`, whose PANORAMA branch matches the retail runtime's
`panorama_ext_frag.fsh`. The Android build now runs that same shader pipeline on
GL ES 2.0.

[`gles2-renderer.patch`](gles2-renderer.patch) (Chowdren/base only, `git apply`
in the anaconda tree after `../mmfparser-chowdren-mobile.patch`; every change is
under `CHOWDREN_USE_GLES2`):
- `include_gl.h` includes `<GLES2/gl2.h>` for Android and for a desktop GLES2
  build, and `base/gles2shader.h`. That header maps the ARB shader-object
  names `desktop/glslshader.cpp` uses onto ES 2.0 core. Its
  `gles2_translate_shader()` rewrites each packed GLSL 1.20 shader (from
  `Assets.dat`, unchanged) as GLSL ES 1.00. It drops `#version`, puts
  `#version 100` first, feeds `gl_Vertex`, `gl_Color` and
  `gl_MultiTexCoord0/1` from the `in_pos`, `in_blend_color` and
  `in_tex_coord1/2` attributes (`shadercommon.h`, bound before linking), and
  carries `gl_FrontColor`/`gl_Color` in one varying. The fragment stage gets
  `precision highp float` where `GL_FRAGMENT_PRECISION_HIGH` is defined.
- `desktop/glslshader.cpp` compiles the translated source, and logs
  `GLES2 shader <id>: linked` (or `LINK FAILED`) once per shader it uses.
- `desktop/renderplatform.cpp` feeds the same client arrays as vertex
  attributes instead of `glVertexPointer` and the other fixed-function arrays.
- `Render::copy_rect` copies from the RGBA8 screen FBO into an RGB texture.
  ES 2.0 allows that (table 3.9), and the copy samples with alpha 1 as on the
  desktop. The storage is specified only when the rectangle's size changes.
- `harness.cpp` reads snapshots back as RGBA, the one readback ES 2.0
  guarantees. `desktop/platform.cpp` logs the GL and GLSL versions and the
  fragment stage's highp precision.
- `base/CMakeLists.txt`: `-DUSE_GLES2=ON` builds the desktop game on a GL ES 2.0
  context (Mesa's `libGLESv2`), the Android renderer run on the host.

`game-CMakeLists.txt` builds GLES2 by default (`CHOWDREN_USE_GLES2`,
`desktop/glslshader.cpp`, `GLESv2`); `-DCHOWDREN_GLES1=ON` keeps the ES 1.1
target. `build-apk.sh` declares `glEsVersion` 2.0 when `libmain.so` links
`libGLESv2.so`. The desktop GL build is untouched. Its translation units
preprocess to the same text with and without the patch (13 of 13 checked,
including generated event, frame and object files).

Host checks, no phone ([`../results/gles2-renderer-20260927.json`](../../../../tools/recompile/results/gles2-renderer-20260927.json),
`recompile-gles2-renderer-cd3b609ddfc79791`, MODEL_ONLY):
- [`gles2-shader-check.cpp`](gles2-shader-check.cpp) compiles and links all 37
  shader pairs as GLSL ES 1.00 on Mesa 18.3.6 (the buster container) and Mesa
  25.0.7 (the host), both llvmpipe, with empty logs. It then draws the
  Perspective PANORAMA branch over a generated 1024 x 768 texture at zoom 200.
  786,412 and 786,413 of 786,432 pixels take the row the retail formula gives;
  the rest are one row off at texel edges. No column moves. The edge column
  spans rows 100-667 and the centre column 0-767.
- The same sources built as desktop GL and as desktop GLES2 (`-DUSE_GLES2=ON`,
  an `OpenGL ES 3.0 Mesa 18.3.6` context) draw the Night 2 office at ticks 120
  and 250, and a camera feed at ticks 400 and 470, identically: 0 of 786,432
  pixels differ. Scaled to the phone's 2400 x 1080 by `../native-frame.py`, the
  meanAbs is 0 and the brightIoU 1.0. The GLES2 run links shaders 15 (texture),
  36 (perspective) and 7 (font).
- The no-input Night 2 replay (`../fixtures/night2-before.ini`,
  `../fixtures/continue.input`, seed 24850, 30,000 updates) was run on four
  binaries: the reference built from the same runtime and generated source
  without the patch (twice), the patched desktop GL build, and the patched
  GLES2 build. All four give the draw projection
  `685af985...`, the one `../results/night2-rebuild-036076d3.json` records for
  the pinned binary. Against the first reference run, each other run differs
  only in trace column 14 (global value 10), in 29,409 rows. The second run of
  the reference binary differs in the same place, so that column is run-to-run
  state and not the patch. A whole GLES2 night links only shaders 15, 36 and 7.
  The runtime's other effects are `LAYERCOLOR` and `SURFACESUBTRACT` (the
  texture shader with ES 2.0 core blending), `PIXELOUTLINE` (shader 22, or 8
  on text) and `SUBPX` (34). They compile and link, but no replay here reaches
  them.
- The ES 1.1 target (`-DCHOWDREN_GLES1=ON`) preprocesses to the same text with
  and without the patch (8 of 8 units, NDK clang).

The APK (`libmain.so` `3a38e268`, `Assets.dat` `d9cc45ff`, package
`org.fnaf2rebuild.play`, `glEsVersion` 2.0) is signed with the first APK's
debug key (certificate `7937d803...`), so it installs over an APK signed with
that key and keeps the save. It is held outside the repository and is not
installed. On the phone, check:
- logcat (`Chowdren`): `GL: OpenGL ES ...` with `screen_fbo status=0x8cd5`;
  `GLSL: ...` with a fragment highp precision above 0; and
  `GLES2 shader 15/36/7: linked`. A `LINK FAILED` or `Compile error` line
  names a shader the PowerVR compiler refused.
- The office is neither black nor flat. Its left and right edges are stretched
  vertically, and the centre column is not. A camera feed is warped the same
  way, with the map and text drawn on top.
- The frame rate holds at 60. The pass adds one 1024 x 768 copy and one
  full-screen draw per frame.
- The window fills the cutout edge.
## 2026-09-27 (later): sound, a stale Assets.dat, the cutout, the capture switch

**Wrong sounds on the phone were a stale `Assets.dat`.** After the sound fix
(`../README.md` §"Sound"), Pedro heard the jumpscare on menu blips, the
metal-vent crawl on the music-box wind and the 6 AM music on the poster honk.
`run-as org.fnaf2rebuild.play` showed `files/Assets.dat` at 119,915,861 bytes
(sha256 `7163d628`). That was the first install's copy, whose sound table follows
the old bank-index order, and it now sat under code that plays by handle.
`set_resources_dir()` measured the APK's copy with `SDL_RWFromFile("Assets.dat")`.
On Android SDL opens a relative path from internal storage first, so it compared
the extracted file with itself and never extracted again. The runtime
(`desktop/platform.cpp`, in the patch) now reads `assets/Assets.dat` through
`AAssetManager`. It keys the extracted copy by `Assets.dat.stamp` (the installed
APK's size and mtime, and the asset's length) and replaces the copy whole
(`.part`, then rename). On the phone, APK `755fde09`:
- the first launch logged `Extracting Assets.dat (123436353 bytes; stamp '134599332 1790553971 123436353', was '')`;
- `files/Assets.dat` became `d9cc45ff`;
- the save (`files/freddy2`, `b1e568d3`) was unchanged before and after.

With `debug.rebuild.audio_trace=1` the phone's play lines equal the host's.
The Options press plays asset 12 (blip3, `s0013`). The poster nose plays asset
41 (`s0042`, flagged uninterruptible) on channel 14. The office starts the same
loops.

**The cutout.** The g56 kept the window out of its 115 px camera cutout (window
2285x1080 at [115,0]). `build-apk.sh`'s theme sets
`windowLayoutInDisplayCutoutMode=shortEdges` (API 28+, `values-v28`). The
office then draws full-width from x = 0.

**The dark office (ES 1.1).** The Perspective object copied the framebuffer and
redrew it opaque with no shader, which painted everything under it black. Under
`CHOWDREN_USE_GLES1`, `PerspectiveObject::draw()` now returns at once. The
default build is now ES 2.0 (`gles2-renderer.patch`, applied to the snapshot of
`Chowdren/base` after the mobile patch). On the phone it logs
`GL: OpenGL ES 3.2 build 25.1`, and GLES2 shaders 15, 7 and 36 link with no
LINK FAILED or compile error. The office screenshot shows the curved panorama.

**The capture switch** (default OFF). openal-soft plays the whole mix through
one OpenSL ES player. `openal-soft-1.23.1-opensl-performance-mode.patch` (for
the 1.23.1 tarball, sha256 `796f4b89`) sets that player's
`SL_ANDROID_KEY_PERFORMANCE_MODE` from `ALSOFT_OPENSL_PERFORMANCE_MODE` before
Realize, and logs the requested and granted modes under the tag `openal`.
The runtime (`base/android/audio_route.h`) sets the variable from two system
properties, read when audio opens:

```sh
adb shell setprop debug.rebuild.audio_capture 1    # power-saving (deep buffer); 0 or unset: OFF
adb shell setprop debug.rebuild.audio_perf none    # or latency | latency-effects | power-saving (wins)
adb shell am force-stop org.fnaf2rebuild.play      # then relaunch; the properties are read at start
```

`dumpsys media.audio_flinger`, parsed with `af-tracks.py`, on the g56:
- **OFF:** the rebuild's track is fast track F1 on `AudioOut_1D`
  (`AUDIO_OUTPUT_FLAG_FAST`), as retail SoundPool cues are; openal logs the
  default mode (granted 2).
- **ON:** a normal track on `AudioOut_15` (`AUDIO_OUTPUT_FLAG_DEEP_BUFFER`),
  with `requested: power-saving (3), Success` and `granted: 3`.
- Whether a Companion `AudioPlaybackCapture` then records discrete cues is
  UNKNOWN (not run).

**Background.** Leaving the rebuild at its title in the background kept its
music playing over other apps. `platform.cpp` now pauses the whole OpenAL
device (`ALC_SOFT_pause_device`) on `SDL_APP_WILLENTERBACKGROUND` and resumes it
on `SDL_APP_DIDENTERFOREGROUND`. The events are caught by an event watch,
because SDL blocks the event pump while paused. On the host,
`CHOWDREN_BACKGROUND=<frame>:<tick>:<updates>` pushes the two events.

**Every game.** `build-lib.sh` cross-builds any converted game's `libmain.so`
(`--gles1` for the ES 1.1 target). `build-apk.sh --package org.fnaf<N>rebuild.play
--label ...` packages it, so the four games install side by side.

## FNaF 2 practice APK, first layer

`apply-practice-mod.py --gamesrc DIR` adds the first, read-only practice layer
to a **private copy** of FNaF 2's generated `gamesrc`. The office HUD shows the
raw camera, view, mask, danger, blackout, music-box and battery values. The
`practice-state.jsonl` file records those values every office update, the
rebuild harness clock and RNG state, and snapshots of each encounter actor's
position, animation/frame, direction and first two alterables. A separate
`practice-input.jsonl` records left-button down/up edges observed by the game
loop. On Android those edges represent the SDL button stream that the game
receives; neither log identifies the physical input device or proves that a
particular event changed game state. Both files are written to the app's
private working directory.

Build in a separate external workspace and package with a distinct ID, for
example `org.fnaf2practice.play`. The input CCN, assets, generated source,
libraries and APK stay outside Git. This is an initial Android practice port,
not Shooter25's original Windows executable; it does not yet include its
scenario toggles or reactive bot. Its state values are research readouts and
the game remains a recompiled runtime, not stock-game evidence.
