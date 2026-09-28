#!/bin/bash
# build-lib.sh: cross-build one converted game's libmain.so for arm64-v8a with the
# NDK, from game-CMakeLists.txt (host side, no phone). Personal research builds,
# never distributed; see build-apk.sh.
#
#   tools/recompile/android/build-lib.sh --gamesrc DIR --chowdren DIR --sdl-src DIR \
#       --sdl-lib DIR --openal-src DIR --openal-lib FILE --work DIR [--jobs N] [--gles1]
#
# --gamesrc is the converter's output (its CMakeLists.txt names the sources),
# --chowdren the Chowdren tree whose base/ the game was converted against
# (the anaconda tree's Chowdren/), --sdl-src/--sdl-lib the SDL2 source and its
# prebuilt libSDL2.so directory, --openal-src/--openal-lib openal-soft's source
# (headers) and the static libopenal.a built with the OpenSL ES backend. The
# work directory gets game/ (the CMake project: this CMakeLists.txt and links)
# and build/ (libmain.so). It must lie outside the repository: the build
# carries the generated game. Runs niced with -j2 unless --jobs says otherwise.
# --gles1 builds the GL ES 1.1 target (game-CMakeLists.txt's CHOWDREN_GLES1)
# in place of the default ES 2.0 one.
set -euo pipefail

GAMESRC= CHOWDREN= SDL_SRC= SDL_LIB= OPENAL_SRC= OPENAL_LIB= WORK= JOBS=2 GLES1=OFF
while [[ $# -gt 0 ]]; do
    case "$1" in
        --gamesrc) GAMESRC=$2; shift 2 ;;
        --chowdren) CHOWDREN=$2; shift 2 ;;
        --sdl-src) SDL_SRC=$2; shift 2 ;;
        --sdl-lib) SDL_LIB=$2; shift 2 ;;
        --openal-src) OPENAL_SRC=$2; shift 2 ;;
        --openal-lib) OPENAL_LIB=$2; shift 2 ;;
        --work) WORK=$2; shift 2 ;;
        --jobs) JOBS=$2; shift 2 ;;
        --gles1) GLES1=ON; shift ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
done
for v in GAMESRC CHOWDREN SDL_SRC SDL_LIB OPENAL_SRC OPENAL_LIB WORK; do
    [[ -n "${!v}" ]] || { echo "missing --$(echo $v | tr A-Z_ a-z-)" >&2; exit 2; }
done
HERE="$(cd "$(dirname "$0")" && pwd)"
case "$(realpath -m "$WORK")/" in
    "$(git -C "$HERE" rev-parse --show-toplevel)"/*)
        echo "refusing to build inside the repository: the build carries the generated game" >&2; exit 2 ;;
esac
for f in "$GAMESRC/CMakeLists.txt" "$CHOWDREN/base/run.cpp" "$SDL_SRC/include/SDL.h" "$SDL_LIB/libSDL2.so" \
         "$OPENAL_SRC/include/AL/al.h" "$OPENAL_LIB"; do
    [[ -e "$f" ]] || { echo "missing: $f" >&2; exit 1; }
done
NDK="${ANDROID_NDK_ROOT:-$HOME/.local/toolchains/android-sdk/ndk/26.3.11579264}"
CMAKE="${CMAKE:-$HOME/.local/toolchains/cmake-3.28.6-linux-x86_64/bin/cmake}"
[[ -x "$CMAKE" && -f "$NDK/build/cmake/android.toolchain.cmake" ]] || { echo "missing cmake or NDK" >&2; exit 1; }

mkdir -p "$WORK/game" "$WORK/build"
cp "$HERE/game-CMakeLists.txt" "$WORK/game/CMakeLists.txt"
ln -sfn "$(realpath "$CHOWDREN")" "$WORK/game/chowdren"
ln -sfn "$(realpath "$GAMESRC")" "$WORK/game/gamesrc"
ln -sfn "$(realpath "$SDL_SRC")" "$WORK/game/SDL"
ln -sfn "$(realpath "$OPENAL_SRC")" "$WORK/game/openal"

"$CMAKE" -S "$WORK/game" -B "$WORK/build" -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI=arm64-v8a -DANDROID_PLATFORM=android-24 -DANDROID_STL=c++_static -DCMAKE_BUILD_TYPE=Release \
    -DSDL2_PREBUILT="$(realpath "$SDL_LIB")" -DOPENAL_LIB="$(realpath "$OPENAL_LIB")" -DCHOWDREN_GLES1="$GLES1" > "$WORK/build/cmake.log" 2>&1
nice -n 19 "$CMAKE" --build "$WORK/build" -j "$JOBS" > "$WORK/build/make.log" 2>&1
LIB="$WORK/build/libmain.so"
[[ -f "$LIB" ]] || { echo "no libmain.so; see $WORK/build/make.log" >&2; exit 1; }
# openal-soft is linked statically (hidden symbols): alcOpenDevice must be
# defined in libmain.so's symbol table, and its OpenSL ES backend must import
# slCreateEngine from libOpenSLES.so.
NM="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-nm"
READELF="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf"
# (Whole listings in variables: grep -q closing a pipe early fails it under pipefail.)
SYMS=$("$NM" "$LIB")
IMPORTS=$("$NM" -D --undefined-only "$LIB")
NEEDED=$("$READELF" -d "$LIB")
grep -q -E ' [tT] alcOpenDevice$' <<<"$SYMS" || { echo "libmain.so lacks alcOpenDevice" >&2; exit 1; }
grep -q ' slCreateEngine$' <<<"$IMPORTS" || { echo "libmain.so does not import slCreateEngine" >&2; exit 1; }
grep -q 'libOpenSLES.so' <<<"$NEEDED" || { echo "libmain.so does not need libOpenSLES.so" >&2; exit 1; }
echo "$LIB $(stat -c %s "$LIB") bytes, sha256 $(sha256sum "$LIB" | cut -c1-16); openal static with OpenSL ES"
