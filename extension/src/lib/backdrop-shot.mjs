/**
 * A photograph of the page the user is looking at, for the scare tab to paint
 * behind Foxy so the scare is not a black rectangle.
 *
 * The scare tab exists because some pages will not take an injected overlay -
 * PDFs (pdf.js is privileged; executeScript returns "Missing host permission
 * for the tab"), about: pages, the new tab page, and addons.mozilla.org. Those
 * are exactly the pages where the effect used to collapse into a black screen,
 * because a tab of the extension's own has no page behind it to composite over.
 *
 * It does not need one. `tabs.captureVisibleTab` photographs a PDF tab
 * perfectly well - verified against the real pdf.js viewer - so the scare tab
 * can paint that photo exactly where the page was and key Foxy over it. It is
 * not transparency; it is indistinguishable from it for the second the scare
 * lasts.
 *
 * The photo has to arrive BEFORE the tab's first paint, or the user sees black,
 * then their page, then Foxy - a flicker worse than plain black. That rules out
 * storage and messaging, both async. The URL fragment is the only channel a
 * synchronous head script can read, which is what backdrop.js is. Measured: a
 * busy 1280x843 page is 153 KB at JPEG q60, URLs carry fragments past 2 MB,
 * and backdrop.js applies it in 0ms against a first animation frame at +90ms.
 *
 * Nothing here is stored or sent anywhere. The capture lives in the URL of a
 * tab that strips it on arrival and closes itself about a second later - and
 * only in Firefox, which never writes that URL into history. Chrome would. See
 * scare-tab.mjs, which decides.
 */

/**
 * Refuse anything past this rather than risk a URL the browser truncates - a
 * half-decoded JPEG would paint as garbage where plain black is fine. Well
 * above the ~157k chars a busy page measures, well under the 2M+ that worked.
 */
export const MAX_SHOT_CHARS = 1_000_000;

/** Enough quality to read as "my page", small enough not to test any limit. */
export const SHOT_QUALITY = 60;

/** Natural pixel size of a data URL, via the one API both MV3 backends have. */
async function measureBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return size;
}

/**
 * Build the fragment the scare tab carries, or '' to fall back to black.
 *
 * `iw`/`ih` are the photo's own size in device pixels and `ch` is the page's
 * height in CSS pixels, from the tab itself. The photo alone does not say
 * where the page is in it: Firefox photographs privileged about: pages onto a
 * canvas the size of the WINDOW, page at the top-left and black beyond. See
 * backdrop.js for how the two are put back together.
 *
 * The image goes LAST and raw. Base64 contains none of `#`, `%` or `&`, so it
 * survives a fragment untouched, and percent-encoding it would inflate every
 * `+`, `/` and `=` by three characters for nothing. backdrop.js splits on the
 * same marker rather than parsing the whole thing.
 *
 * Every failure here is answered with '' rather than an exception. A scare on a
 * black background is the behaviour this replaces; it is not worth losing one
 * over a screenshot.
 */
export async function backdropFragment(browser, page, { measure = measureBitmap } = {}) {
  try {
    if (!(page.height > 0)) return '';
    if (typeof browser.tabs?.captureVisibleTab !== 'function') return '';

    const shot = await browser.tabs.captureVisibleTab(page.windowId, {
      format: 'jpeg',
      quality: SHOT_QUALITY,
    });
    if (typeof shot !== 'string' || !shot.startsWith('data:image/')) return '';
    if (shot.length > MAX_SHOT_CHARS) return '';

    const size = await measure(shot);
    if (!(size?.width > 0) || !(size?.height > 0)) return '';

    return `#foxy&iw=${size.width}&ih=${size.height}&ch=${page.height}&bg=${shot}`;
  } catch {
    return '';
  }
}
