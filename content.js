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

// Track the last scraped profile slug so we can detect SPA navigation between
// profiles. LinkedIn's SPA leaves the previous profile's hydration JSON in the
// DOM, so without this the scraper can return the previously-viewed profile's
// memberId for the new URL. Only waits when the slug actually changed — first
// scrape on any tab uses the existing forceLazyLoad path with no extra wait.
let lastScrapedSlug = "";

function currentProfileSlug() {
  const m = /\/in\/([^/?#]+)/i.exec(location.pathname);
  return m ? m[1] : "";
}

function canonicalProfileSlug() {
  const link = document.querySelector('link[rel="canonical"]');
  if (!link) return "";
  const m = /\/in\/([^/?#]+)/i.exec(link.getAttribute("href") || "");
  return m ? m[1] : "";
}

async function waitForSlugInHydration(slug) {
  const slugs = [slug, canonicalProfileSlug()].filter(Boolean);
  const patterns = slugs.map(s => {
    const esc = s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`"publicIdentifier"\\s*:\\s*"${esc}"`, "i");
  });
  await waitFor(() => {
    const html = document.documentElement.innerHTML;
    return patterns.some(re => re.test(html));
  }, { maxMs: 5000, intervalMs: 100 });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "SCRAPE_PROFILE") {
    (async () => {
      try {
        const onProfile = /\/in\//.test(location.pathname);
        if (onProfile || /\/sales\/lead\//.test(location.pathname)) {
          await forceLazyLoad();
        }
        if (onProfile) {
          const slug = currentProfileSlug();
          if (lastScrapedSlug && slug && lastScrapedSlug !== slug) {
            await waitForSlugInHydration(slug);
          }
          if (slug) lastScrapedSlug = slug;
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
