#!/usr/bin/env python3
"""Turn a private copy of the Android rebuild runtime into a device timing instrument.

Everything is stamped on the phone's CLOCK_MONOTONIC, the clock the kernel's
input events, Android's MotionEvent and `getevent -lt` share, so the whole
chain from a HID report to the pixel that shows its effect is on one clock:

- ``calib-updates.jsonl``: one row per main-loop update in EVERY frame: loop
  start, end of the SDL event pump, end of events, end of the buffer swap
  (ns); the exact ``dt`` and ``timer_units`` the events ran with; the RNG draw
  count and state; the polled left button; and each frame load's seed.
- ``calib-input.jsonl``: every touch as Java saw it (the MotionEvent's own
  event time and the moment ``onTouch`` ran) and as native SDL queued it
  (finger and synthesized mouse events, with the update then running).
- Play-mode multi-touch: fingers after the first (which SDL makes the mouse)
  drive Multiple Touch pointers 1.., as the host harness's ``down 1`` rows do
  and the retail runtime's Multiple Touch does (``debug.rebuild.multitouch``).
- A logcat line (tag ``Calib``) at the end of each frame's first update, so an
  on-device trigger can start a schedule after a frame's load stall.
- A beacon: the update index as a 16-cell Gray code along the top 8 px of the
  1024 x 768 frame, so any capture (the Companion's REGION reads, a
  screenrecord, a camera) can say which update each captured frame shows.

``debug.rebuild.calib`` = 0 turns logging off and ``debug.rebuild.calib_beacon``
= 0 the beacon (both read once at start, default on). Game logic is not
touched, except that a second finger now reaches Multiple Touch: the other
hooks read state and the beacon draws after the frame.

Usage: apply-calib-mod.py --chowdren DIR --sdl DIR
  DIR are private copies (the runtime tree and the SDL2 source whose
  android-project Java build-apk.sh compiles), outside the repository.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

MARKER = "FNAF2_CALIB_V1"

CALIB_IMPL = r'''// FNAF2_CALIB_V1: device timing instrument (tools/recompile/android/apply-calib-mod.py).
// Included once, from run.cpp, before harness.cpp.
#ifndef CHOWDREN_CALIB_IMPL_H
#define CHOWDREN_CALIB_IMPL_H
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static inline long long calib_now_ns(clockid_t clock = CLOCK_MONOTONIC)
{
    struct timespec t;
    clock_gettime(clock, &t);
    return (long long)t.tv_sec * 1000000000LL + t.tv_nsec;
}

#ifdef CHOWDREN_IS_ANDROID
#include <jni.h>
#include <pthread.h>
#include <android/log.h>
#include <sys/system_properties.h>
#include "SDL.h"

static int calib_state = -1;            // -1 not yet read, 0 off, 1 on
static bool calib_beacon_on = false;
static FILE * calib_updates = NULL;
static FILE * calib_input = NULL;
static pthread_mutex_t calib_input_lock = PTHREAD_MUTEX_INITIALIZER;
static unsigned long long calib_update = 0;
static volatile unsigned long long calib_current_update = 0;
static int calib_frame = -1;
static unsigned long long calib_frame_update = 0;
static long long calib_t0 = 0, calib_tp = 0, calib_te = 0;
static bool calib_pending = false, calib_events_ran = false;
static char calib_row[512];

// Play-mode multi-touch. SDL turns only the first finger into the mouse
// (SDL_touch.c tracks one finger), and play mode mirrors the mouse into
// pointer 0. Every other finger is queued here by the event watch (the UI
// thread) and applied in order to pointers 1.. at the start of the next
// update's events, as the host harness applies its `down 1` rows; the retail
// Multiple Touch takes every finger. debug.rebuild.multitouch = 0 turns it off.
// harness.cpp's touch functions live in its anonymous namespace, so the hook
// passes them in.
typedef void (*CalibTouchNew)(int, float, float, bool);
typedef void (*CalibTouchEnd)(int, bool);
typedef void (*CalibTouchMove)(int, float, float, bool);
struct CalibFinger { int type; long long id; float x, y; };
static CalibFinger calib_fingers[128];
static int calib_finger_count = 0, calib_finger_lost = 0;
static bool calib_multitouch_on = false;
static long long calib_primary = -1;                  // the finger SDL made the mouse
static long long calib_pointer_finger[8] = {-1, -1, -1, -1, -1, -1, -1, -1};
static pthread_mutex_t calib_finger_lock = PTHREAD_MUTEX_INITIALIZER;

static int calib_prop(const char * name, int fallback)
{
    char value[PROP_VALUE_MAX];
    if (__system_property_get(name, value) <= 0)
        return fallback;
    return atoi(value);
}

static void calib_flush()
{
    if (calib_updates) fflush(calib_updates);
    pthread_mutex_lock(&calib_input_lock);
    if (calib_input) fflush(calib_input);
    pthread_mutex_unlock(&calib_input_lock);
}

static int calib_watch(void *, SDL_Event * e)
{
    const char * kind = NULL;
    float x = 0.0f, y = 0.0f;
    long long id = -1;
    bool release = false;
    switch (e->type) {
        case SDL_FINGERDOWN: kind = "fdown"; break;
        case SDL_FINGERUP: kind = "fup"; release = true; break;
        case SDL_FINGERMOTION: kind = "fmove"; break;
        case SDL_MOUSEBUTTONDOWN: kind = "mdown"; break;
        case SDL_MOUSEBUTTONUP: kind = "mup"; release = true; break;
        case SDL_APP_WILLENTERBACKGROUND:
        case SDL_APP_TERMINATING:
            calib_flush();
            return 1;
        default:
            return 1;
    }
    if (e->type == SDL_FINGERDOWN || e->type == SDL_FINGERUP || e->type == SDL_FINGERMOTION) {
        x = e->tfinger.x; y = e->tfinger.y; id = (long long)e->tfinger.fingerId;
        if (calib_multitouch_on) {
            pthread_mutex_lock(&calib_finger_lock);
            bool secondary = true;
            if (e->type == SDL_FINGERDOWN && calib_primary < 0) { calib_primary = id; secondary = false; }
            else if (id == calib_primary) {
                secondary = false;
                if (e->type == SDL_FINGERUP) calib_primary = -1;
            }
            if (secondary) {
                if (calib_finger_count < 128) calib_fingers[calib_finger_count++] = { (int)e->type, id, x, y };
                else calib_finger_lost++;
            }
            pthread_mutex_unlock(&calib_finger_lock);
        }
    } else {
        x = (float)e->button.x; y = (float)e->button.y; id = (long long)e->button.which;
    }
    const long long now = calib_now_ns();
    pthread_mutex_lock(&calib_input_lock);
    if (calib_input) {
        fprintf(calib_input,
            "{\"src\":\"sdl\",\"k\":\"%s\",\"t\":%lld,\"sdl_ms\":%u,\"u\":%llu,"
            "\"x\":%.4f,\"y\":%.4f,\"id\":%lld}\n",
            kind, now, (unsigned)e->common.timestamp, calib_current_update, x, y, id);
        if (release) fflush(calib_input);
    }
    pthread_mutex_unlock(&calib_input_lock);
    return 1;
}

extern "C" JNIEXPORT void JNICALL Java_org_libsdl_app_SDLActivity_nativeCalibTouch(
    JNIEnv *, jclass, jlong event_ns, jlong receipt_ns, jint action, jint pointers, jfloat x, jfloat y)
{
    if (calib_state != 1)
        return;
    const long long now = calib_now_ns();
    pthread_mutex_lock(&calib_input_lock);
    if (calib_input)
        fprintf(calib_input,
            "{\"src\":\"java\",\"a\":%d,\"ev\":%lld,\"rx\":%lld,\"t\":%lld,\"n\":%d,"
            "\"x\":%.1f,\"y\":%.1f,\"u\":%llu}\n",
            (int)action, (long long)event_ns, (long long)receipt_ns, now, (int)pointers,
            (double)x, (double)y, calib_current_update);
    pthread_mutex_unlock(&calib_input_lock);
}

static void calib_header(FILE * f, const char * schema)
{
    // The leading newline ends a row a killed process left cut.
    fprintf(f, "\n{\"schema\":\"%s\",\"session\":{\"mono_ns\":%lld,\"boot_ns\":%lld,"
        "\"real_ns\":%lld,\"sdl_ms\":%llu,\"beacon\":%d,\"multitouch\":%d}}\n", schema,
        calib_now_ns(), calib_now_ns(CLOCK_BOOTTIME), calib_now_ns(CLOCK_REALTIME),
        (unsigned long long)SDL_GetTicks64(), calib_beacon_on ? 1 : 0, calib_multitouch_on ? 1 : 0);
    fflush(f);
}

static void calib_init()
{
    if (calib_state >= 0)
        return;
    calib_state = calib_prop("debug.rebuild.calib", 1) != 0 ? 1 : 0;
    if (calib_state != 1)
        return;
    calib_beacon_on = calib_prop("debug.rebuild.calib_beacon", 1) != 0;
    calib_multitouch_on = calib_prop("debug.rebuild.multitouch", 1) != 0;
    calib_updates = fopen("calib-updates.jsonl", "a");
    if (calib_updates) {
        setvbuf(calib_updates, NULL, _IOFBF, 1 << 16);
        calib_header(calib_updates, "fnaf2-calib-updates-v1");
    }
    pthread_mutex_lock(&calib_input_lock);
    calib_input = fopen("calib-input.jsonl", "a");
    if (calib_input) calib_header(calib_input, "fnaf2-calib-input-v1");
    pthread_mutex_unlock(&calib_input_lock);
    SDL_AddEventWatch(calib_watch, NULL);
}

static void calib_write(long long swap_end)
{
    if (!calib_pending || !calib_updates)
        return;
    fprintf(calib_updates, "%s,\"ts\":%lld}\n", calib_row, swap_end);
    calib_pending = false;
    if ((calib_update % 60) == 0)
        fflush(calib_updates);
}

static void calib_loop_start()
{
    calib_init();
    if (calib_state != 1)
        return;
    calib_write(-1);   // an update that did not draw
    calib_t0 = calib_now_ns();
    calib_events_ran = false;
}

static void calib_after_poll()
{
    if (calib_state == 1) calib_tp = calib_now_ns();
}

static void calib_mark_events()
{
    calib_events_ran = true;
}

static void calib_after_update(int frame_index, double dt, int timer_units, bool mouse_down)
{
    if (calib_state != 1)
        return;
    calib_te = calib_now_ns();
    if (frame_index != calib_frame) {
        calib_frame = frame_index;
        calib_frame_update = 0;
    }
    calib_frame_update++;
    calib_update++;
    calib_current_update = calib_update;
    if (calib_frame_update == 1)
        __android_log_print(ANDROID_LOG_INFO, "Calib", "frame %d update 1 done u=%llu t=%lld",
                            frame_index, calib_update, calib_te);
    snprintf(calib_row, sizeof calib_row,
        "{\"u\":%llu,\"f\":%d,\"fu\":%llu,\"ev\":%d,\"t0\":%lld,\"tp\":%lld,\"te\":%lld,"
        "\"dt\":%.9f,\"tu\":%d,\"rd\":%u,\"rs\":%u,\"m\":%d",
        calib_update, frame_index, calib_frame_update, calib_events_ran ? 1 : 0,
        calib_t0, calib_tp, calib_te, dt, timer_units, fusion_draws, fusion_graine,
        mouse_down ? 1 : 0);
    calib_pending = true;
}

// Applied from harness_before_events (play mode), after pointer 0's mirror.
static void calib_play_fingers(CalibTouchNew new_touch, CalibTouchEnd end_touch, CalibTouchMove move_touch)
{
    if (!calib_multitouch_on)
        return;
    CalibFinger batch[128];
    int n = 0, lost = 0;
    pthread_mutex_lock(&calib_finger_lock);
    n = calib_finger_count;
    for (int i = 0; i < n; i++) batch[i] = calib_fingers[i];
    calib_finger_count = 0;
    lost = calib_finger_lost;
    calib_finger_lost = 0;
    pthread_mutex_unlock(&calib_finger_lock);
    for (int i = 0; i < n; i++) {
        const CalibFinger & f = batch[i];
        const float x = (float)(int)(f.x * 1024.0f), y = (float)(int)(f.y * 768.0f);
        int pointer = -1;
        for (int p = 1; p < 8; p++) if (calib_pointer_finger[p] == f.id) { pointer = p; break; }
        const char * kind = NULL;
        if (f.type == SDL_FINGERDOWN && pointer < 0) {
            for (int p = 1; p < 8; p++) if (calib_pointer_finger[p] < 0) { pointer = p; break; }
            if (pointer < 0) continue;
            calib_pointer_finger[pointer] = f.id;
            new_touch(pointer, x, y, false);
            kind = "new";
        } else if (f.type == SDL_FINGERUP && pointer > 0) {
            end_touch(pointer, false);
            calib_pointer_finger[pointer] = -1;
            kind = "end";
        } else if (f.type == SDL_FINGERMOTION && pointer > 0) {
            move_touch(pointer, x, y, false);
            kind = "move";
        }
        if (kind == NULL) continue;
        pthread_mutex_lock(&calib_input_lock);
        if (calib_input)
            fprintf(calib_input, "{\"src\":\"mt\",\"k\":\"%s\",\"p\":%d,\"t\":%lld,\"u\":%llu,"
                "\"x\":%.0f,\"y\":%.0f}\n", kind, pointer, calib_now_ns(), calib_update + 1, (double)x, (double)y);
        pthread_mutex_unlock(&calib_input_lock);
    }
    if (lost > 0) {
        pthread_mutex_lock(&calib_input_lock);
        if (calib_input) fprintf(calib_input, "{\"src\":\"mt\",\"k\":\"lost\",\"n\":%d,\"u\":%llu}\n", lost, calib_update + 1);
        pthread_mutex_unlock(&calib_input_lock);
    }
}

static void calib_after_swap()
{
    if (calib_state == 1) calib_write(calib_now_ns());
}

static void calib_seed(int frame_index, unsigned int seed)
{
    calib_init();
    if (calib_state != 1 || !calib_updates)
        return;
    fprintf(calib_updates, "{\"seed\":%u,\"f\":%d,\"t\":%lld,\"after_u\":%llu}\n",
        seed, frame_index, calib_now_ns(), calib_update);
}

// Drawn in frame space after the frame and its fade, before the swap.
#define CALIB_DRAW_BEACON() do { \
    if (calib_beacon_on) { \
        unsigned int calib_gray = (unsigned int)(calib_update ^ (calib_update >> 1)) & 0xFFFFu; \
        for (int calib_b = 0; calib_b < 16; calib_b++) { \
            bool calib_bit = ((calib_gray >> (15 - calib_b)) & 1u) != 0; \
            Render::draw_quad(calib_b * 64, 0, (calib_b + 1) * 64, 8, \
                calib_bit ? Color(255, 255, 255, 255) : Color(0, 0, 0, 255)); \
        } \
    } \
} while (0)

#else
static inline void calib_loop_start() {}
static inline void calib_after_poll() {}
static inline void calib_mark_events() {}
static inline void calib_after_update(int, double, int, bool) {}
static inline void calib_after_swap() {}
static inline void calib_seed(int, unsigned int) {}
typedef void (*CalibTouchNew)(int, float, float, bool);
typedef void (*CalibTouchEnd)(int, bool);
typedef void (*CalibTouchMove)(int, float, float, bool);
static inline void calib_play_fingers(CalibTouchNew, CalibTouchEnd, CalibTouchMove) {}
#define CALIB_DRAW_BEACON() do {} while (0)
#endif
#endif
'''

JAVA_NATIVE = '''    // FNAF2_CALIB_V1: MotionEvent timing for the calibration build (apply-calib-mod.py).
    public static native void nativeCalibTouch(long eventTimeNs, long receiptNs, int action,
                                               int pointers, float x, float y);
    static boolean calibTouchLinked = true;
    static void calibTouch(MotionEvent event) {
        if (!calibTouchLinked) return;
        long receipt = System.nanoTime();
        long eventNs = Build.VERSION.SDK_INT >= 34 ? event.getEventTimeNanos()
                                                   : event.getEventTime() * 1000000L;
        try {
            nativeCalibTouch(eventNs, receipt, event.getActionMasked(), event.getPointerCount(),
                             event.getX(0), event.getY(0));
        } catch (UnsatisfiedLinkError e) {
            calibTouchLinked = false;
        }
    }

'''


def replace_once(text: str, old: str, new: str, where: str) -> str:
    if text.count(old) != 1:
        raise SystemExit(f"{where}: expected exactly one anchor, found {text.count(old)}: {old[:60]!r}")
    return text.replace(old, new, 1)


def refuse_repo(path: Path) -> None:
    top = subprocess.run(["git", "-C", str(Path(__file__).parent), "rev-parse", "--show-toplevel"],
                         capture_output=True, text=True, check=True).stdout.strip()
    if Path(top) in path.resolve().parents or path.resolve() == Path(top):
        raise SystemExit(f"{path} is inside the repository; patch a private copy")


def patch_runtime(base: Path) -> None:
    (base / "calib_impl.h").write_text(CALIB_IMPL)
    run = base / "run.cpp"
    text = run.read_text()
    if MARKER in text:
        print(f"calibration layer already present: {run}")
    else:
        text = replace_once(text, '#include "harness.cpp"\n',
                            '#include "calib_impl.h" // FNAF2_CALIB_V1\n#include "harness.cpp"\n', "run.cpp")
        text = replace_once(text, "    keyboard.update();\n    mouse.update();\n",
                            "    calib_loop_start();\n    keyboard.update();\n    mouse.update();\n", "run.cpp")
        text = replace_once(text, "    platform_poll_events();\n\n    // player controls\n",
                            "    platform_poll_events();\n    calib_after_poll();\n\n    // player controls\n",
                            "run.cpp")
        text = replace_once(text, "        int ret = update_frame();\n",
                            "        int ret = update_frame();\n"
                            "        calib_after_update(frame->index, fps_limit.dt, timer_units,\n"
                            "                           mouse.is_pressed(SDL_BUTTON_LEFT));\n", "run.cpp")
        text = replace_once(text,
                            "    harness_after_draw(window_width, window_height);\n"
                            "    PROFILE_BEGIN(platform_swap_buffers);\n"
                            "    platform_swap_buffers();\n"
                            "    PROFILE_END();\n}\n",
                            "    CALIB_DRAW_BEACON();\n"
                            "    harness_after_draw(window_width, window_height);\n"
                            "    PROFILE_BEGIN(platform_swap_buffers);\n"
                            "    platform_swap_buffers();\n"
                            "    PROFILE_END();\n"
                            "    calib_after_swap();\n}\n", "run.cpp")
        run.write_text(text)
        print(f"calibration hooks in {run}")
    harness = base / "harness.cpp"
    text = harness.read_text()
    if MARKER not in text:
        text = replace_once(text, "    fusion_graine = seed;\n    fusion_draws = 0;\n",
                            "    fusion_graine = seed;\n    fusion_draws = 0;\n"
                            "    calib_seed(index, seed); // FNAF2_CALIB_V1\n", "harness.cpp")
        text = replace_once(text, "        h_play_down = down;\n        return;\n",
                            "        h_play_down = down;\n        calib_play_fingers(new_touch, end_touch, move_touch); // FNAF2_CALIB_V1\n        return;\n",
                            "harness.cpp")
        text = replace_once(text, "void harness_before_events(int frame_index)\n{\n",
                            "void harness_before_events(int frame_index)\n{\n"
                            "    calib_mark_events(); // FNAF2_CALIB_V1\n", "harness.cpp")
        harness.write_text(text)
        print(f"seed and events hooks in {harness}")


def patch_java(sdl: Path) -> None:
    java = sdl / "android-project/app/src/main/java/org/libsdl/app"
    activity = java / "SDLActivity.java"
    text = activity.read_text()
    if MARKER not in text:
        anchor = "    public static native void onNativeTouch(int touchDevId, int pointerFingerId,\n"
        text = replace_once(text, anchor, JAVA_NATIVE + anchor, "SDLActivity.java")
        if "import android.view.MotionEvent;" not in text:
            text = replace_once(text, "import android.os.Build;\n",
                                "import android.os.Build;\nimport android.view.MotionEvent;\n", "SDLActivity.java")
        activity.write_text(text)
        print(f"MotionEvent hook declared in {activity}")
    surface = java / "SDLSurface.java"
    text = surface.read_text()
    if MARKER not in text:
        text = replace_once(text,
                            "    public boolean onTouch(View v, MotionEvent event) {\n",
                            "    public boolean onTouch(View v, MotionEvent event) {\n"
                            "        SDLActivity.calibTouch(event); // FNAF2_CALIB_V1\n", "SDLSurface.java")
        surface.write_text(text)
        print(f"onTouch stamped in {surface}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--chowdren", required=True, type=Path, help="private runtime copy (has base/run.cpp)")
    parser.add_argument("--sdl", required=True, type=Path, help="private SDL2 source copy (has android-project/)")
    args = parser.parse_args()
    for path in (args.chowdren, args.sdl):
        refuse_repo(path)
    base = args.chowdren / "base"
    if not (base / "run.cpp").is_file():
        raise SystemExit(f"no base/run.cpp under {args.chowdren}")
    patch_runtime(base)
    patch_java(args.sdl)


if __name__ == "__main__":
    main()
