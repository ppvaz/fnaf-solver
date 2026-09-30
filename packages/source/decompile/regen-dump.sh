#!/usr/bin/env bash
# Regenerate the Android event-sheet dump from an extracted application.ccn.
#
# The CCN and the dump are game content: they live OUTSIDE the repo and are
# never committed. Point DUMP_DIR at a scratch directory you own.
#
#   packages/source/decompile/regen-dump.sh /path/to/application.ccn [outfile]
#
# CTFAK is .NET 6 and this host has no dotnet, so it runs in the SDK image.
# CTFAK_SRC must be a CTFAK checkout built with EventTextDumper (see
# docs/android/SOURCE-DUMP-GUIDE.md); the dumper writes the file named by CTFAK_EVENT_DUMP.
set -euo pipefail

CCN=${1:?usage: regen-dump.sh <application.ccn> [outfile]}
OUT=${2:-${DUMP_DIR:-/private/tmp/fnaf2-android-dump}/events-android.txt}
CTFAK_SRC=${CTFAK_SRC:-/private/tmp/ctfak-shooter}
IMAGE=${CTFAK_IMAGE:-mcr.microsoft.com/dotnet/sdk:6.0-bookworm-slim}

CLI="$CTFAK_SRC/Interface/CTFAK.Cli/bin/Release/net6.0/CTFAK.Cli.dll"
[ -f "$CLI" ] || { echo "no CTFAK build at $CLI (see docs/android/SOURCE-DUMP-GUIDE.md)" >&2; exit 1; }

# One mount root keeps the container paths identical to the host paths, so the
# -path argument and CTFAK_EVENT_DUMP can be passed through unchanged.
mkdir -p "$(dirname "$OUT")"
# CTFAK_IMAGE_DIR + CTFAK_IMAGE_HANDLES (comma-separated image handles) also
# write those images as PNG; that needs GDI+, i.e. an image built from
# packages/source/decompile/ctfak-gdiplus.Dockerfile passed as CTFAK_IMAGE.
docker run --rm -v /private/tmp:/private/tmp -w /private/tmp \
  -e CTFAK_EVENT_DUMP="$OUT" -e CTFAK_IMAGE_DIR -e CTFAK_IMAGE_HANDLES "$IMAGE" \
  dotnet "$CLI" -path "$CCN" -parameters "" -forcetype ccn \
  -tool "Event Text Dumper" -closeonfinish

echo "wrote $OUT"
