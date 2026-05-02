// background.js — service worker. Hardcoded HubSpot token. Orchestrates lookups.

importScripts("hubspotClient.js");

// === HARDCODED CREDENTIALS ===
// Rotate by editing these two values, bumping manifest.json version, rebuilding,
// and redistributing the .zip. Never share unmodified tokens externally.
const HUBSPOT_TOKEN = "__HUBSPOT_TOKEN__";
const HUBSPOT_PORTAL_ID = "2748825";
// ==============================

const client = self.OrtusHubSpot.createClient({ token: HUBSPOT_TOKEN });

let propertyCheckPromise = null; // memoised for service worker lifetime
function ensurePropertyCheck() {
  if (!propertyCheckPromise) {
    propertyCheckPromise = client.checkProperty("linkedin_membership_id");
  }
  return propertyCheckPromise;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function scrapeActiveTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !/linkedin\.com/.test(tab.url)) {
    return { error: "not_on_profile" };
  }
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PROFILE" });
    if (!reply || !reply.ok) return { error: "scrape_failed" };
    return reply.result;
  } catch (e) {
    return { error: "not_on_profile" }; // content script not injected
  }
}

function hubspotContactUrl(contactId) {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${contactId}`;
}

async function getProfileState() {
  const propCheck = await ensurePropertyCheck();
  if (propCheck.error)  return { state: mapClientErrorState(propCheck) };
  if (!propCheck.exists) return { state: "error_property" };

  const scrape = await scrapeActiveTab();
  if (scrape.error) return { state: mapScrapeErrorState(scrape.error) };

  const search = await client.searchByEmail(`${scrape.memberId}@linkedinmembership.id`);
  if (search.error === "duplicate") {
    return { state: "error_duplicate", scrape };
  }
  if (search.error) {
    return { state: mapClientErrorState(search), scrape };
  }
  if (search.found) {
    return {
      state: "found",
      scrape,
      contact: {
        id: search.contactId,
        url: hubspotContactUrl(search.contactId),
        properties: search.properties,
      },
    };
  }
  return { state: "not_found", scrape };
}

function mapScrapeErrorState(err) {
  if (err === "not_on_profile") return "not_on_profile";
  if (err === "no_member_id")    return "scrape_failed_id";
  if (err === "no_name")         return "scrape_failed_name";
  return "scrape_failed";
}

function mapClientErrorState(r) {
  if (r.error === "token")       return "error_token";
  if (r.error === "scope")       return "error_scope";
  if (r.error === "rate_limit")  return "error_rate_limit";
  if (r.error === "hubspot_5xx") return "error_hubspot";
  if (r.error === "network")     return "error_network";
  return "error_hubspot";
}

async function pushToHubSpot(scrape) {
  const r = await client.createContact(scrape);
  if (r.error) return { state: mapClientErrorState(r) };
  return {
    state: "success_pushed",
    contact: { id: r.contactId, url: hubspotContactUrl(r.contactId) },
    scrape,
  };
}

async function updateContact(contactId, scrape) {
  const r = await client.updateContact(contactId, scrape);
  if (r.error) return { state: mapClientErrorState(r) };
  return {
    state: "success_updated",
    contact: { id: r.contactId, url: hubspotContactUrl(r.contactId) },
    scrape,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "GET_PROFILE_STATE") {
        sendResponse(await getProfileState());
      } else if (msg.type === "PUSH_TO_HUBSPOT") {
        sendResponse(await pushToHubSpot(msg.scrape));
      } else if (msg.type === "UPDATE_CONTACT") {
        sendResponse(await updateContact(msg.contactId, msg.scrape));
      } else if (msg.type === "TEST_CONNECTION") {
        const propCheck = await client.checkProperty("linkedin_membership_id");
        sendResponse({ propertyExists: !!propCheck.exists, error: propCheck.error || null });
      } else if (msg.type === "RESET_CACHE") {
        propertyCheckPromise = null;
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: "unknown_message" });
      }
    } catch (e) {
      sendResponse({ state: "error_hubspot", detail: e.message });
    }
  })();
  return true; // keep message channel open for async response
});
