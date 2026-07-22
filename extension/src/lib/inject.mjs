export const SENTINEL_ID = 'foxy-jumpscare-overlay';
export const OVERLAY_MESSAGE = 'foxy:overlay-done';

/**
 * Runs inside the page. Takes doc/win explicitly so it is testable in node;
 * the service worker supplies `document` and `window` when it injects this.
 *
 * The literals below are duplicated rather than referencing the exports on
 * purpose: this function is serialised with toString() and re-created inside
 * the page, where module scope does not exist. Closing over anything would
 * throw a ReferenceError at the far end.
 *
 * An extension-origin iframe rather than a raw <video>, for three reasons that
 * each break injected elements on real sites:
 *   1. Strict page CSP blocks injected media outright.
 *   2. Content-script media inherits the page's autoplay policy, so audio is
 *      silently dropped on any page the user has not clicked.
 *   3. Host stylesheets reach injected nodes.
 * The iframe has its own origin and CSP, and is immune to all three.
 */
export function injectOverlayFn(doc, win, iframeUrl, failsafeMs) {
  const SENTINEL = 'foxy-jumpscare-overlay';
  const DONE = 'foxy:overlay-done';

  if (doc.getElementById(SENTINEL)) return 'already-present';

  const iframe = doc.createElement('iframe');
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
    background: 'transparent',
    colorScheme: 'normal',
  });

  let timer = null;
  let done = false;

  const teardown = () => {
    if (done) return;
    done = true;
    win.removeEventListener('message', onMessage);
    if (timer !== null) win.clearTimeout(timer);
    iframe.remove();
  };

  function onMessage(event) {
    if (event && event.data && event.data.type === DONE) teardown();
  }

  win.addEventListener('message', onMessage);
  // Independent of the video: if it fails to decode, 'ended' never fires and
  // the user would be left with a permanent invisible overlay swallowing
  // nothing but still present in the DOM.
  timer = win.setTimeout(teardown, failsafeMs);

  doc.documentElement.appendChild(iframe);
  return 'injected';
}
