# The .NET 6 SDK image plus libgdiplus, so EventTextDumper can write PNGs
# (System.Drawing on Linux). Build once:
#   docker build -t fnaf2-ctfak-gdiplus:local -f packages/source/decompile/ctfak-gdiplus.Dockerfile packages/source/decompile
# then run packages/source/decompile/regen-dump.sh with CTFAK_IMAGE=fnaf2-ctfak-gdiplus:local.
FROM mcr.microsoft.com/dotnet/sdk:6.0-bookworm-slim
RUN apt-get update -qq && apt-get install -y -qq libgdiplus > /dev/null && rm -rf /var/lib/apt/lists/*
