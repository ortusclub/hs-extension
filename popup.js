// popup.js — pure renderer. Sends GET_PROFILE_STATE on open; renders whatever comes back.

const $ = (id) => document.getElementById(id);

const els = {
  dossier:   $("dossier"),
  eyebrow:   $("eyebrow"),
  headline:  $("headline"),
  role:      $("role"),
  metaLine:  $("metaLine"),
  sinceLine: $("sinceLine"),
  warning:   $("warningChip"),
  warningTx: $("warningText"),
  errLine:   $("errLine"),
  actions:   $("actions"),
  liveBadge: $("liveBadge"),
  liveText:  $("liveBadgeText"),
  tabProfile: $("tab-profile"),
  tabSettings: $("tab-settings"),
  panelSettings: $("panel-settings"),
  testBtn:   $("testConnectionBtn"),
  resetBtn:  $("resetCacheBtn"),
  tokenIcon: $("tokenIcon"),
  tokenStatus: $("tokenStatus"),
  propIcon:  $("propIcon"),
  propStatus: $("propStatus"),
};

let lastScrape = null;
let lastContactId = null;

function setBadge(state, text) {
  els.liveBadge.dataset.state = state;
  els.liveText.textContent = text;
}

function clearBody() {
  els.dossier.classList.remove("standby");
  els.eyebrow.className = "eyebrow";
  [els.role, els.metaLine, els.sinceLine, els.warning, els.errLine, els.actions]
    .forEach(el => { el.hidden = true; el.innerHTML = ""; });
  els.actions.innerHTML = "";
}

function setEyebrow(text, kind = "") {
  els.eyebrow.className = "eyebrow " + kind;
  els.eyebrow.textContent = text;
}

function dossierName(first, last) {
  els.headline.innerHTML = last
    ? `${escape(first)} <em>${escape(last)}</em>`
    : escape(first);
}

function escape(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderRole(jobTitle, company) {
  if (!jobTitle && !company) { els.role.hidden = true; return; }
  els.role.hidden = false;
  els.role.innerHTML = jobTitle && company
    ? `${escape(jobTitle)}<span class="sep">·</span>${escape(company)}`
    : escape(jobTitle || company);
}

function renderMeta(memberId) {
  els.metaLine.hidden = false;
  els.metaLine.innerHTML = `<b>id</b>&nbsp;&nbsp;${escape(memberId)}@linkedinmembership.id`;
}

function renderWarnings(scrape) {
  const missing = [];
  if (!scrape.jobTitle) missing.push("job title");
  if (!scrape.company)  missing.push("company");
  if (!scrape.lastName) missing.push("last name");
  if (missing.length === 0) return;
  els.warning.hidden = false;
  els.warningTx.textContent = `Pushing without ${missing.join(", ")}`;
}

function ctaPrimary(label, onClick) {
  const b = document.createElement("button");
  b.className = "cta";
  b.innerHTML = `<span>${escape(label)}</span>
    <span class="icon-pod">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
    </span>`;
  b.addEventListener("click", onClick);
  return b;
}

function ctaGhost(label, onClick) {
  const b = document.createElement("button");
  b.className = "ghost";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function setError(eyebrow, headline, detail) {
  clearBody();
  setEyebrow(eyebrow, "error");
  els.headline.textContent = headline;
  els.dossier.classList.add("standby");
  if (detail) {
    els.errLine.hidden = false;
    els.errLine.textContent = detail;
  }
}

function render(payload) {
  clearBody();
  const s = payload.state;
  switch (s) {
    case "not_on_profile":
      setBadge("standby", "Standby");
      setEyebrow("Open a profile", "muted");
      els.headline.textContent = "Open a LinkedIn profile to begin.";
      els.dossier.classList.add("standby");
      return;

    case "scraping":
    case "checking":
      setBadge("default", "Checking");
      setEyebrow("Reading profile");
      els.headline.innerHTML = `<span class="shimmer-headline" style="display:inline-block;width:70%;height:26px;"></span>`;
      return;

    case "not_found": {
      setBadge("default", "Connected");
      setEyebrow("Not in HubSpot");
      lastScrape = payload.scrape;
      dossierName(payload.scrape.firstName, payload.scrape.lastName);
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      renderMeta(payload.scrape.memberId);
      renderWarnings(payload.scrape);
      els.actions.hidden = false;
      els.actions.appendChild(ctaPrimary("Push to HubSpot", onPushClick));
      return;
    }

    case "found": {
      setBadge("default", "Connected");
      setEyebrow("Already in HubSpot", "ok");
      lastScrape = payload.scrape;
      lastContactId = payload.contact.id;
      dossierName(payload.scrape.firstName, payload.scrape.lastName);
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      const since = payload.contact.properties.createdate
        ? new Date(payload.contact.properties.createdate).toLocaleString("en-US", { month: "short", year: "numeric" })
        : null;
      els.sinceLine.hidden = false;
      els.sinceLine.innerHTML = since
        ? `Added <a href="${escape(payload.contact.url)}" target="_blank">in HubSpot since ${since}</a>`
        : `<a href="${escape(payload.contact.url)}" target="_blank">View in HubSpot ›</a>`;
      els.actions.hidden = false;
      els.actions.appendChild(ctaPrimary("Update", onUpdateClick));
      els.actions.appendChild(ctaGhost("Skip", () => window.close()));
      return;
    }

    case "success_pushed":
      setBadge("default", "Connected");
      setEyebrow("Pushed", "ok");
      els.headline.innerHTML = `${escape(payload.scrape.firstName)} <em>${escape(payload.scrape.lastName || "")}</em> added to HubSpot.`;
      els.sinceLine.hidden = false;
      els.sinceLine.innerHTML = `<a href="${escape(payload.contact.url)}" target="_blank">View in HubSpot ›</a>`;
      return;

    case "success_updated":
      setBadge("default", "Connected");
      setEyebrow("Updated", "ok");
      els.headline.innerHTML = `${escape(payload.scrape.firstName)} <em>${escape(payload.scrape.lastName || "")}</em> updated.`;
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      els.sinceLine.hidden = false;
      els.sinceLine.innerHTML = `<a href="${escape(payload.contact.url)}" target="_blank">View in HubSpot ›</a>`;
      return;

    case "scrape_failed_id":
      setBadge("default", "Connected");
      return setError("Couldn't read the profile",
        "Couldn't read the LinkedIn ID for this profile.",
        "LinkedIn may have updated the page structure. Reload the profile and try again.");

    case "scrape_failed_name":
    case "scrape_failed":
      setBadge("default", "Connected");
      return setError("Couldn't read the profile",
        "Couldn't read the name for this profile.",
        "Reload the profile and try again.");

    case "error_token":
      setBadge("error", "Auth error");
      return setError("HubSpot rejected the token",
        "Token may have been rotated.",
        "401 · Antonio needs to ship an updated build with a fresh token.");

    case "error_unconfigured":
      setBadge("error", "Install error");
      return setError("This GitHub build is not configured",
        "Install the packaged version from Google Sheets.",
        "The public GitHub ZIP does not include the private HubSpot token.");

    case "error_scope":
      setBadge("error", "Scope error");
      return setError("HubSpot scope missing",
        "Token is missing required scopes.",
        "Required: contacts.read, contacts.write, schemas.contacts.read.");

    case "error_property":
      setBadge("error", "Setup");
      return setError("Custom property missing",
        "HubSpot is missing the linkedin_membership_id property.",
        "SalesNav scraper should have created it. Ask Antonio.");

    case "error_network":
      setBadge("error", "Offline");
      return setError("Network error",
        "Couldn't reach HubSpot.",
        "Check your connection and click Retry.");

    case "error_rate_limit":
      setBadge("error", "Throttled");
      return setError("HubSpot is throttling",
        "Wait a moment and try again.",
        "429 · Try in 10 seconds.");

    case "error_hubspot":
      setBadge("error", "HubSpot error");
      return setError("HubSpot is having a moment",
        "Please try again.",
        "500 · Click Retry to try again.");

    case "error_duplicate":
      setBadge("error", "Duplicate");
      return setError("Duplicate contacts in HubSpot",
        "Multiple contacts share this LinkedIn ID.",
        "Open HubSpot to dedupe before pushing again.");

    default:
      setBadge("error", "Unknown");
      return setError("Unexpected state", `state: ${s}`, "");
  }
}

async function loadState() {
  render({ state: "scraping" });
  const r = await chrome.runtime.sendMessage({ type: "GET_PROFILE_STATE" });
  render(r);
}

async function onPushClick() {
  if (!lastScrape) return;
  render({ state: "checking" });
  const r = await chrome.runtime.sendMessage({ type: "PUSH_TO_HUBSPOT", scrape: lastScrape });
  render(r);
}

async function onUpdateClick() {
  if (!lastScrape || !lastContactId) return;
  render({ state: "checking" });
  const r = await chrome.runtime.sendMessage({
    type: "UPDATE_CONTACT", contactId: lastContactId, scrape: lastScrape
  });
  render(r);
}

// ── Tabs ──
function showTab(name) {
  const isProfile = name === "profile";
  els.tabProfile.setAttribute("aria-selected", String(isProfile));
  els.tabSettings.setAttribute("aria-selected", String(!isProfile));
  els.dossier.hidden = !isProfile;
  els.panelSettings.hidden = isProfile;
  if (!isProfile) refreshSettings();
}
els.tabProfile.addEventListener("click", () => showTab("profile"));
els.tabSettings.addEventListener("click", () => showTab("settings"));

// ── Settings panel ──
async function refreshSettings() {
  els.tokenStatus.textContent = "Checking";
  els.propStatus.textContent = "Checking";
  els.tokenIcon.className = "check-icon";
  els.propIcon.className = "check-icon";
  els.tokenIcon.textContent = "…";
  els.propIcon.textContent = "…";

  const r = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
  const tokenOk = !r.error || r.error === null;
  els.tokenIcon.className = "check-icon " + (tokenOk ? "ok" : "err");
  els.tokenIcon.textContent = tokenOk ? "✓" : "!";
  els.tokenStatus.className = "check-status " + (tokenOk ? "ok" : "err");
  els.tokenStatus.textContent = tokenOk ? "Connected" : "Token rejected";

  els.propIcon.className = "check-icon " + (r.propertyExists ? "ok" : "err");
  els.propIcon.textContent = r.propertyExists ? "✓" : "!";
  els.propStatus.className = "check-status " + (r.propertyExists ? "ok" : "err");
  els.propStatus.textContent = r.propertyExists ? "Found" : "Missing";
}

els.testBtn.addEventListener("click", refreshSettings);
els.resetBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "RESET_CACHE" });
  refreshSettings();
});

// Show the actual manifest version in the footer so reloads are visible at a glance.
document.addEventListener("DOMContentLoaded", () => {
  try {
    const v = chrome.runtime.getManifest().version;
    const labels = document.querySelectorAll(".footer span");
    if (labels.length >= 2) labels[labels.length - 1].textContent = `v${v}`;
  } catch (e) { /* ignore */ }
  loadState();
});
