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
  // note in overlay.html. 'normal' colour-scheme stops the host from handing
  // the frame a painted backdrop of its own.
  //
  // Ordinary inline values were not enough. Dark Reader - a very common
  // extension, and the way a lot of people get dark mode on sites that have
  // none - publishes `color-scheme: dark !important`, which outranks a plain
  // inline value. The frame's used scheme then resolves to dark while
  // overlay.html never opts into dark itself, and Firefox paints an opaque
  // light canvas behind the frame. The result is a FULLSCREEN WHITE backdrop
  // with Foxy on it, instead of the page. Measured on a real page with Dark
  // Reader in its default dynamic mode: computed colour-scheme on the frame
  // came back "dark" despite this code setting "normal", and every sampled
  // pixel of the viewport read rgb(255, 255, 255).
  //
  // An inline !important declaration is the top of the author cascade, so it
  // survives that. Any other page-recolouring extension gets the same answer.
  iframe.style.setProperty('color-scheme', 'normal', 'important');
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
