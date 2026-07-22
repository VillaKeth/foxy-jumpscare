const DONE = 'foxy:overlay-done';
const video = document.getElementById('foxy');

let reported = false;

function done() {
  if (reported) return;
  reported = true;

  if (window.parent !== window) {
    // Normal path: the parent content script owns the iframe and removes it.
    parent.postMessage({ type: DONE }, '*');
  } else {
    // Standalone fallback window, used when no tab would accept injection.
    // Nothing owns it but itself.
    window.close();
  }
}

video.addEventListener('ended', done);
video.addEventListener('error', done);

// Autoplay can still be refused (no user gesture, extreme settings). Fall back
// to muted playback rather than showing nothing - a silent Foxy beats no Foxy.
//
// The outcome is logged because this is the one behaviour that differs most
// between Chrome and Firefox, and a silent jumpscare is otherwise indis-
// tinguishable from a working one in a screenshot.
video.play()
  .then(() => console.log('[foxy] playing with audio'))
  .catch(() => {
    video.muted = true;
    video.play()
      .then(() => console.warn('[foxy] autoplay blocked - playing muted'))
      .catch((err) => {
        console.warn('[foxy] playback refused entirely:', err?.message);
        done();
      });
  });
