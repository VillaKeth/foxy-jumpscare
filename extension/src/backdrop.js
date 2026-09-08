/*
 * Decide the overlay's backdrop BEFORE first paint.
 *
 * overlay.html loads in two situations that want opposite backgrounds:
 *
 *   In an iframe      - injected over a live page. Transparent, so Foxy lunges
 *                       over whatever you were reading. That is the effect.
 *   In its own window - the fallback fire.mjs uses when no tab would take the
 *                       injection. Nothing is behind it, so "transparent"
 *                       resolves to the browser's blank canvas: white.
 *
 * This lived in overlay.js until it was found to be racy. overlay.js is a
 * deferred module at the end of the body, so it runs after parsing - leaving a
 * window in which the standalone case paints WHITE and then turns black. A
 * fullscreen white flash immediately before a jumpscare is exactly what the
 * photosensitivity warning exists to prevent. The e2e test caught it
 * intermittently, most readily right after a rebuild, when first load is
 * slowest and the window is widest.
 *
 * Three properties matter here and all three are load-bearing:
 *
 *   - Its own FILE, not an inline <script>. MV3's extension_pages CSP is
 *     script-src 'self' with no 'unsafe-inline', so an inline script is
 *     blocked outright and the backdrop silently never applies.
 *   - Classic script, NOT type="module". Modules are deferred; that deferral
 *     is the whole bug.
 *   - In <head>, ABOVE the stylesheet, with no defer/async, so it executes
 *     before the body is parsed and before anything is painted.
 *
 * document.documentElement already exists when a head script runs, so this is
 * safe there.
 *
 * Black is the floor, not the goal. When fire.mjs manages to photograph the
 * page first - PDFs and about: pages photograph fine even though they refuse
 * injection - it hands the shot over in the fragment and this paints it where
 * the page was, so the scare composites over the user's actual screen instead
 * of replacing it with a rectangle. See lib/backdrop-shot.mjs. Black is still
 * set first and stays underneath: if anything about the fragment is wrong, the
 * result is the old behaviour rather than a white flash or a broken image.
 */
if (window.parent === window) {
  document.documentElement.style.background = '#000';

  // #foxy&x=..&y=..&w=..&h=..&bg=data:image/jpeg;base64,....
  //
  // Split rather than parsed: the payload is the rest of the string after the
  // marker, so no amount of base64 can be mistaken for another parameter, and
  // nothing has to be percent-decoded back.
  const hash = window.location.hash;
  const at = hash.indexOf('&bg=');

  if (hash.startsWith('#foxy&') && at > 0) {
    try {
      const fields = new URLSearchParams(hash.slice('#foxy&'.length, at));
      const box = ['x', 'y', 'w', 'h'].map((k) => Number(fields.get(k)));
      const data = hash.slice(at + '&bg='.length);

      if (box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
          && data.startsWith('data:image/')) {
        const [x, y, w, h] = box;
        // Positioned in screen coordinates, which the window's own coordinates
        // are once it is fullscreen at the origin. Black still fills whatever
        // the photo does not cover - where the tab strip and taskbar were.
        document.documentElement.style.background =
          `#000 url("${data}") no-repeat ${x}px ${y}px / ${w}px ${h}px`;
      }
    } catch {
      // Keeps the black set above.
    }
  }
}
