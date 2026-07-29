# Asset pack

Both apps read this directory. Nothing about the contents is hardcoded — swapping the
pack swaps the jumpscare, with no code change.

**The media files are gitignored on purpose.** They are copyrighted FNAF material;
keeping them out of the repository means a takedown notice costs a re-upload rather
than the repo. Reconstitute them locally by dropping in the source and running the
build step below.

## Files

| File | Tracked | Notes |
|---|---|---|
| `foxy-src.mp4` | no | **Source.** The raw greenscreen clip, as downloaded. Never consumed directly by either app. |
| `foxy.webm` | no | *Derived.* VP9 + alpha, Opus audio. Extension only. |
| `foxy.mp4` | no | *Derived.* VP9 keyed over black, AAC audio, in an MP4 container. Desktop only. |
| `foxy-icon.png` | no | **Source.** A still render, transparent background. Feeds both icon builds. |
| `foxy.ico` | no | *Derived.* Desktop tray icon, cropped to the head from a source still. |
| `pack.json` | yes | Manifest. |

Two derived formats because the targets genuinely differ:

- **Extension → `foxy.webm`.** MP4/H.264 cannot carry an alpha channel at all, and the
  extension overlay is transparent over the live page — Foxy lunges over whatever you
  were reading, which is the entire effect. (0.1.3 briefly shipped an opaque black
  backdrop; 0.1.4 took it back out. Verified transparent in Gecko, not just Chromium.)
  WebM/VP9 is also the safer codec bet in Firefox, whose H.264 support depends on OS
  decoders while VP9 is always available in-browser.
- **Desktop → `foxy.mp4`.** The desktop overlay is fullscreen black, so alpha buys
  nothing — but the codec still matters. The file is **VP9 in an MP4 container**, not
  H.264: H.264 is patent-encumbered, and Fedora and Arch ship VLC without its decoder,
  so an H.264 desktop scare is a silent black screen on those distros. VP9's decoder is
  royalty-free and ships in the base VLC everywhere, so the Avalonia app (libVLC) plays
  it on stock Ubuntu, Fedora and Arch with nothing extra. On Windows the Avalonia build
  bundles its own libVLC; the older WPF build decodes it via Media Foundation, which has
  VP9 inbox on Windows 11 (a free Store extension on Windows 10). The container stays
  `.mp4` and the codec tag is `vp09`, so the desktop code loads the same path unchanged.

## Building the derived assets

```powershell
node tools/build-assets.mjs
```

Requires `ffmpeg` on PATH. The script probes the source with `ffprobe` for dimensions
and duration, then runs both passes. Keying parameters are tunable, because greenscreen
quality varies and no single set of values works for every clip:

```powershell
node tools/build-assets.mjs --key 0x00FF00 --similarity 0.18 --blend 0.05
```

Under the hood, alpha pass:

```
ffmpeg -i foxy-src.mp4 \
  -vf "chromakey=0x00FF00:0.18:0.05,despill=type=green,format=yuva420p" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 2M \
  -c:a libopus -b:a 128k foxy.webm
```

`-auto-alt-ref 0` is mandatory, not stylistic — VP9 alt-ref frames silently destroy the
alpha channel, and the failure looks like "transparency randomly stopped working."

Opaque pass (`WxH` injected from `ffprobe`) — VP9 so it decodes on stock Fedora
and Arch, which ship VLC without an H.264 decoder:

```
ffmpeg -i foxy-src.mp4 -filter_complex \
  "[0:v]chromakey=0x00FF00:0.18:0.05,despill=type=green[fg]; \
   color=c=black:s=WxH[bg]; \
   [bg][fg]overlay=shortest=1,format=yuv420p[v]" \
  -map "[v]" -map "0:a?" -c:v libvpx-vp9 -b:v 0 -crf 30 -row-mt 1 \
  -c:a aac -b:a 192k foxy.mp4
```

`-b:v 0` is what puts libvpx into constant-quality (CRF) mode; without it the
`-crf` is only a ceiling and the file bloats.

### Checking the key

Bad keying shows up as a green fringe on Foxy's outline, worst against dark pages.
Raise `--similarity` to take more green, raise `--blend` to soften the edge. Inspect
`foxy.webm` over a white *and* a dark background before shipping — a fringe invisible on
one is obvious on the other.

### ⚠️ ffmpeg cannot verify its own alpha output

**ffmpeg encodes VP9 alpha but cannot decode it back.** Verified on ffmpeg 8.1.1:

- `ffprobe` reports the WebM's `pix_fmt` as `yuv420p`, not `yuva420p` — VP9 keeps the
  alpha plane in a separate Matroska layer, so the primary stream looks opaque.
- The `alpha_mode=1` stream tag *is* set, and is the flag browsers actually read. But it
  is set **with or without** `-auto-alt-ref 0`, so it does not prove the encode was
  correct.
- Decoding it back through `format=rgba,alphaextract` returns a fully opaque alpha plane
  (mean 255) even when the file is genuinely transparent. This is an ffmpeg decode
  limitation, **not** a bad encode.

So a green screen that keyed perfectly still looks broken to every ffmpeg-based check.
The build script asserts the `alpha_mode` flag because it catches a total failure to
request alpha, and claims nothing beyond that.

**Real verification is a browser.** Load the WebM over a coloured background, draw it to
a canvas, and read the pixels. Against the synthetic test clip this returns
`[0,0,0,0]` in the keyed-out corner and `[251,1,2,255]` on the preserved subject.

## `pack.json`

```json
{
  "name": "withered-foxy",
  "source": "foxy-src.mp4",
  "web": "foxy.webm",
  "desktop": "foxy.mp4",
  "chromakey": { "key": "0x00FF00", "similarity": 0.18, "blend": 0.05 }
}
```

Playback length comes from the video itself, not from config. The keying values live
here so a rebuild reproduces the tuned result rather than the defaults.

## The icons

Both icons are derived from `foxy-icon.png`, cropped to Foxy's head — a full-body render
is an unreadable smudge at 16px. Like the video, both outputs are gitignored and never
committed.

**Desktop tray:**

```powershell
pwsh tools/build-tray-icon.ps1 -Source "$HOME\Downloads\foxy.png"
```

Emits `assets/foxy.ico`, a multi-resolution icon (16–256px, PNG frames). The desktop
build copies it next to the exe; without it the tray falls back to a generic icon. The
default crop suits the Withered Foxy still in this pack — override with `-CropX/-CropY/
-CropSide` for a different image.

**Extension:**

```powershell
npm run icons     # also runs as the first half of npm run build
```

Emits `extension/src/icons/icon-{16,32,48,96,128}.png` via ffmpeg. Same idea, different
crop flags (`--crop-x/--crop-y/--crop-side`, `--source`), and `-pix_fmt rgba` throughout
because the source render is transparent outside the subject.

⚠️ **The extension icon is the most public artifact in the project** — it lands on the
store listing, in the toolbar, and in AMO's public API, the most-scanned placement there
is. So `tools/make-icons.mjs` falls back to **original art** whenever `foxy-icon.png` is
absent, and that fallback is what a clone of this repo builds and what a store build
should ship unless someone has decided otherwise on purpose. Dropping the pack image in
switches the icon to copyrighted frames locally; publishing that is a separate,
deliberate call.

## Swapping the pack

Drop in a different `foxy-src.mp4`, retune the key if needed, rebuild. The original-art
pack used for store builds works identically — same filenames, different bytes.
