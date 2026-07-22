# Asset pack

Both apps read this directory. Nothing about the contents is hardcoded — swapping the
pack swaps the jumpscare, with no code change.

**These files are gitignored on purpose.** They are copyrighted FNAF material; keeping
them out of the repository means a takedown notice costs a re-upload rather than the
repo. Reconstitute them locally.

## Expected files

| File | Format | Notes |
|---|---|---|
| `foxy.png` | PNG, RGBA | Withered Foxy. Anything from ~800px wide up; both apps scale to fit, preserving aspect ratio. |
| `scream.wav` | WAV, PCM 16-bit, 44.1kHz | WAV specifically — the desktop app uses `System.Media.SoundPlayer`, which is WAV-only and dependency-free. Keep it under ~2s. |
| `pack.json` | JSON | Manifest, tracked in git. See below. |

## `pack.json`

```json
{
  "name": "withered-foxy",
  "image": "foxy.png",
  "audio": "scream.wav",
  "durationMs": 1500
}
```

`durationMs` is the pack's suggested on-screen time; app config overrides it.

## Swapping the pack

Drop in a different `foxy.png` / `scream.wav`, update `pack.json`, rebuild. The
original-art pack used for store builds lives the same way — same filenames, different
bytes.
