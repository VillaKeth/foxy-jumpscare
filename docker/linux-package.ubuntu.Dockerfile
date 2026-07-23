# A recipient's machine: stock Ubuntu with NO .NET of any kind.
#
# The verification images build from source and so have the SDK, which would
# hide a self-contained package that quietly depends on a shared runtime.
# This image exists to prove the tarball runs on a machine that has never had
# .NET installed - the actual claim made to anyone we send it to.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Exactly what INSTALL.txt asks the recipient to install, and nothing else.
#   libvlc5, vlc-plugin-base : the one manual step, since libVLC is not bundled
#   libicu74, libssl3, ...   : what the bundled .NET runtime itself needs
#   libx11 & friends, a font : Avalonia's X11 backend
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
        libvlc5 vlc-plugin-base \
        libicu74 libssl3 ca-certificates tzdata zlib1g \
        libxss1 \
        libx11-6 libxext6 libxrandr2 libxi6 libxcursor1 libxinerama1 \
        libice6 libsm6 libfontconfig1 libfreetype6 fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Test harness only - a headless X server with MIT-SCREEN-SAVER and a real
# window manager, plus screenshots.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
        xvfb openbox imagemagick x11-utils \
    && rm -rf /var/lib/apt/lists/*

COPY verify-package.sh /usr/local/bin/verify-package
RUN chmod +x /usr/local/bin/verify-package

ENTRYPOINT ["/usr/local/bin/verify-package"]
