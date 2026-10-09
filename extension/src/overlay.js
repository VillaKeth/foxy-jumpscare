const DONE = 'foxy:overlay-done';
// Same string as CLOSE_SCARE_TAB in lib/scare-tab.mjs, which the background
// listens with. Not imported: every copy of this page in every open tab would
// load that module, and the screenshot code behind it, for one string.
const CLOSE_SCARE_TAB = 'foxy:close-scare-tab';
const video = document.getElementById('foxy');

// The black backdrop for a tab of its own is NOT set here. It has to beat the
// stylesheet to first paint, and this file is a deferred module at the end of
// the body, so it cannot. It lives in a synchronous script at the top of
// overlay.html - see the note there before moving it back.

// Absolute ceiling on how long the overlay may live, armed before playback so
// it holds even if the video never decodes. A clip broken badly enough raises
// neither 'ended' nor 'error', and the scare tab - unlike the injected iframe,
// which the parent content script independently times out - has nothing but
// itself and a background backstop to close it.
const HARD_STOP_MS = 8000;

const framed = window.parent !== window;

// A tab of its own that backdrop.js did not mark as a scare tab is a stray:
// brought back from Recently Closed (Chrome cannot keep it out), reloaded
// mid-scare after its URL was stripped, restored after a crash, or typed in.
// It must not scream. A replay out of nowhere, minutes later, is the one
// scare nobody should get.
const stray = !framed && window.foxyScareTab !== true;

let reported = false;
let failsafe = null;

function done() {
  if (reported) return;
  reported = true;
  if (failsafe !== null) clearTimeout(failsafe);

  if (framed) {
    // Normal path: the parent content script owns the iframe and removes it.
    parent.postMessage({ type: DONE }, '*');
    return;
  }

  // A tab of its own. The background closes it, and hands the user back to
  // the page that opened it - see lib/scare-tab.mjs. Closing from here would
  // skip both, and a page may not be allowed to close a tab it did not open.
  // window.close() is the last resort, for a background that cannot be reached.
  Promise.resolve()
    .then(() => chrome.runtime.sendMessage({ type: CLOSE_SCARE_TAB }))
    .catch(() => window.close());
}

if (stray) {
  done();
} else {
  failsafe = setTimeout(done, HARD_STOP_MS);

  // Once the real length is known, tighten the failsafe to duration + 1.5s so
  // a clip that decodes but never fires 'ended' still tears down promptly
  // instead of waiting out the full hard stop.
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      clearTimeout(failsafe);
      failsafe = setTimeout(done, video.duration * 1000 + 1500);
    }
  });

  video.addEventListener('ended', done);
  video.addEventListener('error', done);

  // A copy in a background tab, there only in case the user switches to it
  // mid-scare. The scream is already playing from the tab they were on - see
  // fire.mjs - and a second one from here would be one more voice in a chorus.
  if (new URLSearchParams(location.search).has('muted')) video.muted = true;

  // Autoplay can still be refused (no user gesture, extreme settings). Fall
  // back to muted playback rather than showing nothing - a silent Foxy beats
  // no Foxy.
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
}
