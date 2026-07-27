const DONE = 'foxy:overlay-done';
const video = document.getElementById('foxy');

// Absolute ceiling on how long the overlay may live, armed before playback so
// it holds even if the video never decodes. A clip broken badly enough raises
// neither 'ended' nor 'error', and the standalone fallback window - unlike the
// injected iframe, which the parent content script independently times out -
// has nothing but itself to close it. Without this it would sit fullscreen
// until killed by hand, the one failure the overlay is never allowed to have.
const HARD_STOP_MS = 8000;

let reported = false;
let failsafe = null;

function done() {
  if (reported) return;
  reported = true;
  if (failsafe !== null) clearTimeout(failsafe);

  if (window.parent !== window) {
    // Normal path: the parent content script owns the iframe and removes it.
    parent.postMessage({ type: DONE }, '*');
  } else {
    // Standalone fallback window, used when no tab would accept injection.
    // Nothing owns it but itself.
    window.close();
  }
}

failsafe = setTimeout(done, HARD_STOP_MS);

// Once the real length is known, tighten the failsafe to duration + 1.5s so a
// clip that decodes but never fires 'ended' still tears down promptly instead
// of waiting out the full hard stop.
video.addEventListener('loadedmetadata', () => {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    clearTimeout(failsafe);
    failsafe = setTimeout(done, video.duration * 1000 + 1500);
  }
});

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
