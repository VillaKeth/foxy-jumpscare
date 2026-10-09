/*
 * Decide the overlay's backdrop BEFORE first paint.
 *
 * overlay.html loads in two situations that want opposite backgrounds:
 *
 *   In an iframe   - injected over a live page. Transparent, so Foxy lunges
 *                    over whatever you were reading. That is the effect.
 *   In a tab of    - the scare tab fire.mjs opens when the page in front of
 *   its own          the user will not take the injection. Nothing is behind
 *                    it, so "transparent" resolves to the browser's blank
 *                    canvas: white.
 *
 * This lived in overlay.js until it was found to be racy. overlay.js is a
 * deferred module at the end of the body, so it runs after parsing - leaving a
 * window in which the top-level case paints WHITE and then turns black. A
 * white flash immediately before a jumpscare is exactly what the
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
 * Black is the floor, not the goal. In Firefox, lib/scare-tab.mjs photographs
 * the page before opening the tab - PDFs and about: pages photograph fine even
 * though they refuse injection - and hands the shot over in the fragment, and
 * this paints it exactly where the page was, so Foxy composites over the
 * user's actual page instead of a rectangle. See lib/backdrop-shot.mjs. Black
 * is still set first and stays underneath: if anything about the fragment is
 * wrong, or there is none, the result is black rather than a white flash or a
 * broken image.
 */
if (window.parent === window) {
  document.documentElement.style.background = '#000';

  // ?scare&title=<page title>: this tab was opened as a scare, and wears the
  // title of the page it covers so the tab strip shows a duplicate rather than
  // a stranger. overlay.js reads foxyScareTab. Without the marker this is no
  // scare at all but a stray - restored by the session, reloaded, typed in -
  // and overlay.js keeps a stray silent.
  const query = new URLSearchParams(window.location.search);

  if (query.has('scare')) {
    window.foxyScareTab = true;
    document.title = query.get('title') || document.title;

    // #foxy&iw=..&ih=..&ch=..&bg=data:image/jpeg;base64,....
    //
    // Split rather than parsed: the payload is the rest of the string after the
    // marker, so no amount of base64 can be mistaken for another parameter, and
    // nothing has to be percent-decoded back.
    const hash = window.location.hash;
    const at = hash.indexOf('&bg=');

    if (hash.startsWith('#foxy&') && at > 0) {
      try {
        const fields = new URLSearchParams(hash.slice('#foxy&'.length, at));
        const data = hash.slice(at + '&bg='.length);
        const dpr = window.devicePixelRatio || 1;
        const width = Number(fields.get('iw')) / dpr;
        const height = Number(fields.get('ih')) / dpr;
        const pageHeight = Number(fields.get('ch'));

        if ([width, height, pageHeight].every((n) => Number.isFinite(n) && n > 0)
            && data.startsWith('data:image/')) {
          // 1:1 - the photo is device pixels of this same window, so dividing
          // by the pixel ratio puts every pixel back where it was. Not scaled to
          // fit: Firefox photographs privileged about: pages onto a canvas the
          // size of the WINDOW, page at the top-left and black past it, and
          // unscaled that padding simply falls off the edge.
          //
          // Placed by the page's height, not the photo's: the page area can
          // differ in height between tabs - the new tab page shows a bookmarks
          // bar this tab does not - and the content area grows and shrinks at
          // its top, so the bottom edge is where the two tabs agree. 100vh, not
          // a number, so it still holds if that bar comes or goes after this.
          document.documentElement.style.background =
            `#000 url("${data}") no-repeat 0 calc(100vh - ${pageHeight}px) / ${width}px ${height}px`;
        }
      } catch {
        // Keeps the black set above.
      }
    }

    // Painted; now the photo leaves the URL - out of the address bar, the
    // session history, and anything that would bring the scare back from them.
    window.history.replaceState(null, '', window.location.pathname);
  }
}
