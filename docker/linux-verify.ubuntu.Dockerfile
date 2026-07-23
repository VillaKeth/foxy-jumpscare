# Clean-room Linux verification for the Avalonia app, on Ubuntu 24.04.
#
# The point of a container here is that it is EMPTY: a developer box slowly
# accumulates -dev packages and X utilities that hide missing dependencies.
# Whatever is installed below is the real, complete runtime dependency list
# for a Linux user - if the app runs here, it runs on a stock desktop.
#
# The image is the toolchain only. Source is mounted at run time, so editing
# code does not invalidate the layer cache.
FROM mcr.microsoft.com/dotnet/sdk:8.0-noble

ENV DEBIAN_FRONTEND=noninteractive \
    DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

# --- what a real user needs -------------------------------------------------
# libvlc5 + vlc-plugin-base : decoding. NOT libvlc-dev; the unversioned
#                             libvlc.so symlink lives there, and relying on it
#                             is exactly the bug VlcNative.cs works around.
# libxss1                   : XScreenSaver, for idle detection.
# libx11/ice/sm/fontconfig  : Avalonia's X11 backend.
# fonts-dejavu-core         : Avalonia throws at startup with no font at all.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
        libvlc5 vlc-plugin-base \
        libxss1 \
        libx11-6 libxext6 libxrandr2 libxi6 libxcursor1 libxinerama1 \
        libice6 libsm6 libfontconfig1 libfreetype6 \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# --- test harness only, not a user requirement ------------------------------
# Xvfb is a headless X server that (unlike WSLg's Xwayland) has MIT-SCREEN-SAVER.
# openbox is a window manager: _NET_WM_STATE_FULLSCREEN needs one to be honoured.
# imagemagick takes the screenshots.
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
        xvfb openbox imagemagick x11-utils \
    && rm -rf /var/lib/apt/lists/*

COPY verify-in-container.sh /usr/local/bin/verify
RUN chmod +x /usr/local/bin/verify

ENTRYPOINT ["/usr/local/bin/verify"]
