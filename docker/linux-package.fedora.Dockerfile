# A recipient's Fedora machine, STOCK: vlc-libs + vlc-plugins-base and nothing
# else - specifically NOT vlc-plugin-ffmpeg. That omission is the whole point.
#
# With the old H.264 asset this image rendered 0 frames ("Codec `h264' ... is
# not supported"); with the VP9 asset it renders the scare in full, because
# libvpx ships in the base plugin set. It is the proof that a Fedora user needs
# no extra codec package. Runs the SHIPPED tarball, not a source build.
FROM fedora:41

RUN dnf install -y -q \
        vlc-libs vlc-plugins-base \
        libicu openssl-libs zlib krb5-libs \
        libXScrnSaver libX11 libXext libXrandr libXi libXcursor libXinerama \
        libICE libSM fontconfig freetype dejavu-sans-fonts \
        xorg-x11-server-Xvfb openbox ImageMagick xdpyinfo xprop xwininfo \
    && dnf clean all

COPY verify-package.sh /usr/local/bin/verify-package
RUN chmod +x /usr/local/bin/verify-package

ENTRYPOINT ["/usr/local/bin/verify-package"]
