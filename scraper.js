// scraper.js — works in Chrome content script (global) and Node tests (CommonJS).

(function (root) {
  const PROFILE_RE  = /^https?:\/\/([a-z]+\.)?linkedin\.com\/in\/[^/]+\/?/i;
  const SALESNAV_RE = /^https?:\/\/([a-z]+\.)?linkedin\.com\/sales\/lead\//i;

  function detectPageType(url) {
    if (PROFILE_RE.test(url))  return "profile";
    if (SALESNAV_RE.test(url)) return "salesnav";
    return "unknown";
  }

  function scrapeProfile(doc, url) {
    const pageType = detectPageType(url);
    if (pageType === "unknown") return { error: "not_on_profile" };

    if (pageType === "profile") return scrapeRegular(doc, url);
    if (pageType === "salesnav") return scrapeSalesNav(doc, url);
    return { error: "not_on_profile" };
  }

  function scrapeRegular(doc, url) {
    const html = doc.documentElement.outerHTML;
    const slug = extractSlug(url);
    // Vanity URL slugs sometimes don't match the canonical publicIdentifier in
    // hydration data. Read the canonical link as a fallback identifier.
    const canonicalSlug = readCanonicalSlug(doc);
    const memberId = extractMemberId(html, slug, canonicalSlug);
    const { firstName, lastName } = extractName(doc);
    const { jobTitle, company } = extractRoleAndCompany(doc);
    const linkedinBio = slug ? `https://www.linkedin.com/in/${slug}` : "";

    if (!memberId)  return { error: "no_member_id" };
    if (!firstName) return { error: "no_name" };

    return { pageType: "profile", firstName, lastName, company, jobTitle, memberId, linkedinBio };
  }

  function readCanonicalSlug(doc) {
    const link = doc.querySelector('link[rel="canonical"]');
    if (!link) return "";
    const href = link.getAttribute("href") || "";
    const m = /\/in\/([^/?#]+)/i.exec(href);
    return m ? m[1] : "";
  }

  function extractSlug(url) {
    const m = /\/in\/([^/?#]+)/i.exec(url);
    return m ? m[1] : "";
  }

  function scrapeSalesNav(doc, url) {
    const html = doc.documentElement.outerHTML;
    const memberId = extractMemberId(html, null);

    const nameEl    = doc.querySelector('[data-anonymize="person-name"]');
    const titleEl   = doc.querySelector('[data-anonymize="title"]');
    const companyEl = doc.querySelector('[data-anonymize="company-name"]');

    let firstName = "", lastName = "";
    if (nameEl) {
      const text = nameEl.textContent.trim().replace(/\s+/g, " ");
      const space = text.indexOf(" ");
      firstName = space === -1 ? text : text.slice(0, space);
      lastName  = space === -1 ? ""   : text.slice(space + 1);
    } else {
      const m = /"firstName":"([^"]*)","lastName":"([^"]*)"/.exec(html);
      if (m) { firstName = m[1]; lastName = m[2]; }
    }

    let jobTitle = titleEl ? titleEl.textContent.trim() : "";
    if (!jobTitle) {
      const m = /"role":"([^"]*)"/.exec(html);
      if (m) jobTitle = m[1];
    }

    let company = companyEl ? companyEl.textContent.trim().replace(/\s+/g, " ") : "";
    if (!company) {
      const m = /"companyName":"([^"]*)"/.exec(html);
      if (m) company = m[1];
    }

    // SalesNav: the embedded JSON often includes a publicIdentifier we can use.
    let linkedinBio = "";
    const slugMatch = /"publicIdentifier":"([^"]+)"/.exec(html);
    if (slugMatch) linkedinBio = `https://www.linkedin.com/in/${slugMatch[1]}`;

    if (!memberId)  return { error: "no_member_id" };
    if (!firstName) return { error: "no_name" };

    return { pageType: "salesnav", firstName, lastName, company, jobTitle, memberId, linkedinBio };
  }

  function extractMemberId(html, slug, canonicalSlug) {
    // Strategy 1: anchor to a slug — try URL slug first, then the canonical slug
    // from <link rel="canonical">. Vanity URLs sometimes don't match the
    // hydration data's publicIdentifier exactly.
    const slugs = [slug, canonicalSlug].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);
    for (const sl of slugs) {
      const slugEsc = sl.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const reForward = new RegExp(
        `"publicIdentifier"\\s*:\\s*"${slugEsc}"[\\s\\S]{0,2000}?"objectUrn"\\s*:\\s*"urn:li:member:(\\d+)"`,
        "i"
      );
      const f = reForward.exec(html);
      if (f) return f[1];

      const reReverse = new RegExp(
        `"objectUrn"\\s*:\\s*"urn:li:member:(\\d+)"[\\s\\S]{0,2000}?"publicIdentifier"\\s*:\\s*"${slugEsc}"`,
        "i"
      );
      const r = reReverse.exec(html);
      if (r) return r[1];

      const reMemberKey = new RegExp(
        `"publicIdentifier"\\s*:\\s*"${slugEsc}"[\\s\\S]{0,2000}?"memberId"\\s*:\\s*"?(\\d+)"?`,
        "i"
      );
      const k = reMemberKey.exec(html);
      if (k) return k[1];
    }

    // Strategy 2: anchor to the Profile $type marker. LinkedIn's main Profile
    // hydration object has both "$type":"...identity.profile.Profile" and the
    // owner's objectUrn close together. This catches profiles where the slug
    // doesn't match the publicIdentifier (vanity URLs, redirected slugs).
    const profileFwd = /"\$type"\s*:\s*"[^"]*\.identity\.profile\.Profile"[\s\S]{0,3000}?"objectUrn"\s*:\s*"urn:li:member:(\d+)"/i.exec(html);
    if (profileFwd) return profileFwd[1];
    const profileRev = /"objectUrn"\s*:\s*"urn:li:member:(\d+)"[\s\S]{0,3000}?"\$type"\s*:\s*"[^"]*\.identity\.profile\.Profile"/i.exec(html);
    if (profileRev) return profileRev[1];

    // Strategy 3: only one member URN on the entire page → unambiguous, use it.
    // This is the SalesNav path and the path for minimal test fixtures.
    const all = html.match(/"objectUrn":"urn:li:member:(\d+)"/g) || [];
    const unique = Array.from(new Set(all.map(s => /(\d+)/.exec(s)[1])));
    if (unique.length === 1) return unique[0];

    // Strategy 4: bare memberId fallback (only safe when single occurrence too).
    const allKeys = html.match(/"memberId"\s*:\s*"?\d+"?/g) || [];
    const uniqueKeys = Array.from(new Set(allKeys.map(s => /(\d+)/.exec(s)[1])));
    if (uniqueKeys.length === 1) return uniqueKeys[0];

    return null;
  }

  function extractName(doc) {
    const h1 = doc.querySelector("h1.top-card-layout__title")
            || doc.querySelector("main h1")
            || doc.querySelector("h1");
    if (!h1) return { firstName: "", lastName: "" };
    const text = h1.textContent.trim().replace(/\s+/g, " ");
    if (!text) return { firstName: "", lastName: "" };
    const space = text.indexOf(" ");
    if (space === -1) return { firstName: text, lastName: "" };
    return { firstName: text.slice(0, space), lastName: text.slice(space + 1) };
  }

  function extractRoleAndCompany(doc) {
    // ONE PATH: the structured Experience-section walk, anchored by
    // section[data-view-name="profile-card"] whose first child is <div id="experience">.
    // No cascading fallbacks — they were the source of "guessed wrong" output.
    // If the section isn't there or doesn't yield a value, we return empty and
    // surface that as a "missing field" warning in the popup, not a wrong guess.
    return extractFromExperienceSectionStructured(doc);
  }

  function findExperienceSection(doc) {
    // Stable LinkedIn anchor: a <section data-view-name="profile-card"> whose first
    // child div has id="experience". Confirmed against real DOMs (ruth-dom.html).
    const sections = doc.querySelectorAll('section[data-view-name="profile-card"]');
    for (const sec of sections) {
      if (sec.children[0] && sec.children[0].id === "experience") return sec;
    }
    // Looser fallback: any section that contains <div id="experience">.
    const anchor = doc.querySelector('div#experience');
    if (anchor) return anchor.closest('section');
    return null;
  }

  function decodeHtmlEntities(s) {
    if (!s || s.indexOf("&") === -1) return s || "";
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");
  }

  function cleanRoleText(text) {
    if (!text) return "";
    let t = text.replace(/\s+/g, " ").trim();
    t = deDupHalves(t);
    // Strip trailing date range like "(Mar 2025 - Present · 1 yr 2 mos)".
    t = t.replace(/\s*\([^)]*\d{4}[^)]*\)\s*$/, "").trim();
    // Some sources hand us pre-escaped text ("McKinsey &amp; Company"). Normalize
    // to literal characters so the popup's HTML escaping doesn't double-encode.
    t = decodeHtmlEntities(t);
    return t;
  }

  function readCurrentCompanyHint(doc) {
    const btn = doc.querySelector('button[aria-label^="Current company"]');
    if (!btn) return "";
    const label = btn.getAttribute("aria-label") || "";
    let m = /Current company:\s*(.+?)\.\s*Click to skip/i.exec(label);
    if (!m) m = /Current company:\s*(.+?)$/i.exec(label);
    return m ? m[1].trim() : "";
  }

  function extractFromExperienceSectionStructured(doc) {
    const section = findExperienceSection(doc);
    if (!section) return { jobTitle: "", company: "" };

    const ul = section.querySelector('ul');
    if (!ul) return { jobTitle: "", company: "" };

    const topLis = Array.from(ul.children).filter(c => c.tagName === "LI");
    if (topLis.length === 0) return { jobTitle: "", company: "" };

    // Resolve company FIRST from the top-card aria-label "Current company: X" —
    // LinkedIn's own ground truth for which entry is the primary job. This both
    // anchors which <li> we read (Ruth has an Economic Club entry that started
    // AFTER Fiserv) and gives us the company name to filter out from .t-bold
    // candidates when choosing the role title.
    const hint = readCurrentCompanyHint(doc);
    let liToUse = topLis[0];
    if (hint) {
      const hintLower = hint.toLowerCase();
      const matched = topLis.find(li => (li.textContent || "").toLowerCase().includes(hintLower));
      if (matched) liToUse = matched;
    }

    let company = decodeHtmlEntities(hint);
    if (!company) {
      // Fallback: read the "Company · Full-time" subtitle off the chosen <li>.
      const subtitleEl = liToUse.querySelector('span.t-14.t-normal > span[aria-hidden="true"]');
      const subtitle = cleanRoleText(subtitleEl && subtitleEl.textContent);
      company = subtitle.split(/\s*[·•]\s*/)[0].trim();
    }

    // Stacked-roles pattern: top-level <li> contains a nested <ul><li> per role.
    // First nested <li> is the most recent sub-role.
    const nestedUl = liToUse.querySelector('ul');
    const nestedLis = nestedUl
      ? Array.from(nestedUl.children).filter(c => c.tagName === "LI"
          && c.querySelector('div.t-bold span[aria-hidden="true"]'))
      : [];

    if (nestedLis.length > 0) {
      const roleEl = nestedLis[0].querySelector('div.t-bold span[aria-hidden="true"]');
      return {
        jobTitle: cleanRoleText(roleEl && roleEl.textContent),
        company,
      };
    }

    // Single role: pick the first .t-bold span whose text is NOT the company name.
    // The data-field marker is unreliable here — on some profiles the data-field
    // anchor wraps the entire entry (including the role title), so we can't use
    // it to distinguish. Filtering by company-text is robust across all variants.
    const tBoldSpans = Array.from(liToUse.querySelectorAll('div.t-bold span[aria-hidden="true"]'));
    const companyLower = (company || "").toLowerCase();
    const roleEl = tBoldSpans.find(el => {
      const t = cleanRoleText(el.textContent || "").toLowerCase();
      return t && t !== companyLower;
    }) || tBoldSpans[0];

    return {
      jobTitle: cleanRoleText(roleEl && roleEl.textContent),
      company,
    };
  }

  function deDupHalves(text) {
    // LinkedIn renders the same string in BOTH aria-hidden AND visually-hidden spans
    // inside the same parent, so .textContent reads as "FooFoo". Collapse to "Foo".
    if (text.length < 4 || text.length % 2 !== 0) return text;
    const half = text.length / 2;
    if (text.substring(0, half) === text.substring(half)) return text.substring(0, half);
    return text;
  }

  const api = { detectPageType, scrapeProfile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusScraper = api;
})(typeof window !== "undefined" ? window : globalThis);
