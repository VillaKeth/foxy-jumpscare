# The same verification on Fedora, i.e. a non-Debian distro with different
# package names and a different libvlc build.
#
# This exists to keep Platform/VlcNative.cs honest. The resolver looks for the
# SONAME libvlc.so.5; if that were a Debian-ism, video would silently fail for
# every Fedora/RHEL user and the Ubuntu run would never show it. (It is not:
# Fedora puts it at /usr/lib64/libvlc.so.5 and the resolver finds it.)
FROM fedora:41

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_NOLOGO=1

# vlc-libs is Fedora's libvlc5 equivalent and libXScrnSaver its libxss1.
#
# Two Fedora-specific traps, both measured here, neither of which exists on
# Debian/Ubuntu - where vlc-plugin-base alone covers everything:
#
#  - vlc-plugins-base is NOT optional. vlc-libs alone installs the library with
#    an empty plugin directory, and libVLC then fails to instantiate at all,
#    with a message blaming a missing NuGet package.
#  - vlc-plugin-ffmpeg is NOT optional either. Without it there is no
#    libavcodec_plugin.so, and playback dies with "Codec `h264' ... is not
#    supported" even though libvlc and its other plugins loaded fine. Fedora
#    splits it out because it is the plugin that pulls in ffmpeg.
#
# Both live in Fedora's own repositories, so no RPM Fusion is required.
RUN dnf install -y -q \
        dotnet-sdk-8.0 \
        vlc-libs vlc-plugins-base vlc-plugin-ffmpeg \
        libXScrnSaver \
        libX11 libXext libXrandr libXi libXcursor libXinerama \
        libICE libSM fontconfig freetype dejavu-sans-fonts \
        xorg-x11-server-Xvfb openbox ImageMagick \
        xdpyinfo xprop xwininfo \
    && dnf clean all

COPY verify-in-container.sh /usr/local/bin/verify
RUN chmod +x /usr/local/bin/verify

ENTRYPOINT ["/usr/local/bin/verify"]
