// content.js — runs on every linkedin.com page; replies to SCRAPE_PROFILE messages.

function isProfilePageReady() {
  // Three signals that together mean React finished hydrating the profile:
  //   1. Experience section's stable anchor exists (lazy-mounted on scroll).
  //   2. <h1> with the profile name is rendered.
  //   3. At least one urn:li:member: appears in the live DOM — this only shows
  //      up once the hydration JSON code blocks are injected. The slug alone
  //      isn't enough because LinkedIn writes the slug into <link rel="canonical">
  //      and og:url meta tags at initial page-load, before hydration.
  const hasExperience = !!document.querySelector(
    'section[data-view-name="profile-card"] > div#experience'
  );
  if (!hasExperience) return false;

  const hasName = !!document.querySelector('main h1') || !!document.querySelector('h1');
  if (!hasName) return false;

  if (!document.documentElement.innerHTML.includes('urn:li:member:')) return false;
  return true;
}

async function waitFor(predicate, { maxMs = 8000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (predicate()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return predicate();
}

async function forceLazyLoad() {
  // LinkedIn lazy-mounts the Experience section on scroll. Trigger the mount,
  // then poll for the readiness predicate (not a fixed delay).
  const originalY = window.scrollY;
  try {
    window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: "instant" });
  } catch (e) {
    window.scrollTo(0, document.body.scrollHeight);
  }
  await waitFor(isProfilePageReady, { maxMs: 8000, intervalMs: 100 });
  try {
    window.scrollTo({ top: originalY, left: 0, behavior: "instant" });
  } catch (e) {
    window.scrollTo(0, originalY);
  }
  await new Promise(r => setTimeout(r, 80));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "SCRAPE_PROFILE") {
    (async () => {
      try {
        if (/\/in\//.test(location.pathname) || /\/sales\/lead\//.test(location.pathname)) {
          await forceLazyLoad();
        }
        const result = window.OrtusScraper.scrapeProfile(document, location.href);
        sendResponse({ ok: true, result });
      } catch (e) {
        sendResponse({ ok: false, error: e.message || String(e) });
      }
    })();
    return true;
  }
});
