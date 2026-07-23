# The friend's machine: Arch, with the full `vlc` package installed - exactly
# what he did. Arch is rolling-release, so its libVLC is far newer than the
# 3.0.20 on Ubuntu/Fedora, which is the most likely reason it behaves
# differently there. Runs the SHIPPED tarball, not a source build.
FROM archlinux:latest

# vlc pulls the whole codec set, so a missing-plugin cause is off the table
# here, same as on the friend's box. icu + the base libs cover the bundled
# .NET runtime; ttf-dejavu is the font Avalonia needs to start; the rest is
# the headless X test harness.
RUN pacman -Syu --noconfirm --needed \
        vlc \
        icu \
        libx11 libxext libxrandr libxi libxcursor libxinerama libice libsm \
        libxss fontconfig freetype2 ttf-dejavu \
        xorg-server-xvfb openbox imagemagick \
        xorg-xdpyinfo xorg-xprop xorg-xwininfo \
    && pacman -Scc --noconfirm

COPY verify-package.sh /usr/local/bin/verify-package
RUN chmod +x /usr/local/bin/verify-package

ENTRYPOINT ["/usr/local/bin/verify-package"]
