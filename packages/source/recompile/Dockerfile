# Content-free toolchain, built on either a macOS Docker Desktop or Linux host.
# The pinned Python manifest includes linux/amd64 and linux/arm64.
FROM python:2.7-slim@sha256:6c1ffdff499e29ea663e6e67c9b6b9a3b401d554d2c9f061f9a45344e3992363 AS converter
RUN sed -i -e 's|deb.debian.org/debian|archive.debian.org/debian|g' \
    -e 's|security.debian.org/debian-security|archive.debian.org/debian-security|g' \
    -e '/buster-updates/d' /etc/apt/sources.list \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends build-essential libjpeg-dev zlib1g-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir Cython==0.29.37 Pillow==6.2.2
WORKDIR /work
CMD ["python"]

FROM converter AS runtime
RUN apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends cmake libsdl2-dev libopenal-dev \
       libgl1-mesa-dev xvfb mesa-utils \
    && rm -rf /var/lib/apt/lists/*
CMD ["bash"]
