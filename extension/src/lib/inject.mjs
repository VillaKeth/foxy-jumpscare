export const SENTINEL_ID = 'foxy-jumpscare-overlay';
export const OVERLAY_MESSAGE = 'foxy:overlay-done';

/**
 * Runs inside the page, injected by chrome.scripting.executeScript.
 *
 * Two constraints shape this function, both learned the hard way:
 *
 *  1. It is serialised with toString() and re-created in the page, so it must
 *     be entirely self-contained. It cannot close over module scope - hence the
 *     duplicated literals rather than references to the exports above.
 *  2. It must take no document/window parameters. MV3 runs injected code in an
 *     isolated world governed by the *extension's* CSP, which has no
 *     'unsafe-eval', so a `new Function(...)` wrapper that would let us pass
 *     them in is silently neutered - it yields null rather than throwing.
 *     Reading the globals directly is the only approach that works.
 *
 * The overlay is an extension-origin iframe rather than a raw <video>, for
 * three reasons that each break injected elements on real sites:
 *   1. Strict page CSP blocks injected media outright.
 *   2. Content-script media inherits the page's autoplay policy, so audio is
 *      silently dropped on any page the user has not clicked.
 *   3. Host stylesheets reach injected nodes.
 * The iframe has its own origin and CSP, and is immune to all three.
 */
export function injectOverlayFn(iframeUrl, failsafeMs) {
  const SENTINEL = 'foxy-jumpscare-overlay';
  const DONE = 'foxy:overlay-done';

  if (document.getElementById(SENTINEL)) return 'already-present';

  const iframe = document.createElement('iframe');
  iframe.id = SENTINEL;
  iframe.src = iframeUrl;
  // Delegates autoplay to the cross-origin frame; without it, no audio.
  iframe.setAttribute('allow', 'autoplay');

  Object.assign(iframe.style, {
    position: 'fixed',
    inset: '0px',
    width: '100%',
    height: '100%',
    border: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
  });

  // The two declarations the effect actually depends on, both pinned with
  // inline !important rather than set as ordinary inline values.
  //
  // Transparent, so the page stays visible behind the keyed video - see the
  // note in overlay.html.
  //
  // `light dark` means "this frame renders correctly under either scheme",
  // and that is the whole point. Firefox gives a document an OPAQUE canvas
  // when the document does not support the colour scheme it is being shown
  // under - the backdrop exists so unstyled content stays readable. The
  // overlay has no content to make unreadable; it is one keyed video over
  // whatever is behind it. Declaring support for both schemes is what keeps
  // its canvas transparent no matter what the browser or the page prefers.
  //
  // This value was `normal` for one release and that was the bug. `normal`
  // declares the opposite - "does not support dark" - so on a browser set to
  // dark, which is the majority of this extension's users, Firefox painted
  // the light default canvas and the scare became a FULLSCREEN WHITE
  // rectangle with Foxy on it. Measured in a live profile on google.com:
  // white pixels went 0.3% -> 91.3% of the viewport mid-scare, with the frame
  // reporting `color-scheme: normal`, `background-color: rgba(0,0,0,0)` and
  // `prefers-color-scheme: dark`. Every computed value said transparent while
  // the screen was white, which is why this took a screen capture to find and
  // why verify:firefox now samples rendered pixels.
  //
  // !important, and not an ordinary inline value, because of Dark Reader - a
  // very common extension, and how a lot of people get dark mode on sites
  // that lack it. It publishes `color-scheme: dark !important`, which
  // outranks a plain inline value; the frame then inherits dark. An inline
  // !important declaration is the top of the author cascade and survives it.
  // Any other page-recolouring extension gets the same answer.
  iframe.style.setProperty('color-scheme', 'light dark', 'important');
  iframe.style.setProperty('background-color', 'transparent', 'important');

  let timer = null;
  let finished = false;

  const teardown = () => {
    if (finished) return;
    finished = true;
    window.removeEventListener('message', onMessage);
    if (timer !== null) window.clearTimeout(timer);
    iframe.remove();
  };

  function onMessage(event) {
    if (event && event.data && event.data.type === DONE) teardown();
  }

  window.addEventListener('message', onMessage);
  // Independent of the video: if it fails to decode, 'ended' never fires and
  // the overlay would sit in the DOM forever.
  timer = window.setTimeout(teardown, failsafeMs);

  document.documentElement.appendChild(iframe);
  return 'injected';
}
