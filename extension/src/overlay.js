const DONE = 'foxy:overlay-done';
const video = document.getElementById('foxy');

let reported = false;

function done() {
  if (reported) return;
  reported = true;
  // The parent content script owns the iframe and does the removal.
  parent.postMessage({ type: DONE }, '*');
}

video.addEventListener('ended', done);
video.addEventListener('error', done);

// Autoplay can still be refused (no user gesture, extreme settings). Fall back
// to muted playback rather than showing nothing - a silent Foxy beats no Foxy.
video.play().catch(() => {
  video.muted = true;
  video.play().catch(done);
});
