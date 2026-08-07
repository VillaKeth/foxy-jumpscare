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
 */
if (window.parent === window) {
  document.documentElement.style.background = '#000';
}
