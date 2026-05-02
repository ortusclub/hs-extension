// hubspotClient.js — works in service worker (global) and Node tests (CommonJS).

(function (root) {
  const HUBSPOT_BASE = "https://api.hubapi.com";

  function createClient({ token }) {
    async function hsFetch(path, opts = {}) {
      let res;
      try {
        res = await fetch(HUBSPOT_BASE + path, {
          ...opts,
          headers: {
            ...(opts.headers || {}),
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
      } catch (e) {
        return { status: 0, ok: false, body: null, networkError: true };
      }
      const body = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, body };
    }

    async function searchByEmail(email) {
      const r = await hsFetch("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
          properties: ["firstname", "lastname", "company", "jobtitle", "email", "linkedin_membership_id", "linkedinbio", "createdate"],
          limit: 2,
        }),
      });
      if (!r.ok) return mapHttpError(r);
      const results = r.body.results || [];
      if (results.length === 0) return { found: false };
      if (results.length > 1)  return { error: "duplicate" };
      return { found: true, contactId: results[0].id, properties: results[0].properties || {} };
    }

    function mapHttpError(r) {
      if (r.networkError)  return { error: "network" };
      if (r.status === 401) return { error: "token" };
      if (r.status === 403) return { error: "scope", detail: r.body };
      if (r.status === 429) return { error: "rate_limit" };
      if (r.status >= 500)  return { error: "hubspot_5xx", detail: r.body };
      return { error: "unknown", detail: r.body };
    }

    function syntheticEmail(memberId) {
      return `${memberId}@linkedinmembership.id`;
    }

    function buildProperties(input) {
      const props = {
        firstname: input.firstName,
        email: syntheticEmail(input.memberId),
        linkedin_membership_id: input.memberId,
      };
      if (input.lastName)     props.lastname     = input.lastName;
      if (input.company)      props.company      = input.company;
      if (input.jobTitle)     props.jobtitle     = input.jobTitle;
      if (input.linkedinBio)  props.linkedinbio  = input.linkedinBio;
      return props;
    }

    async function createContact(input) {
      const r = await hsFetch("/crm/v3/objects/contacts", {
        method: "POST",
        body: JSON.stringify({ properties: buildProperties(input) }),
      });
      if (!r.ok) return mapHttpError(r);
      if (!r.body || !r.body.id) return { error: "unknown", detail: r.body };
      return { contactId: r.body.id };
    }

    async function updateContact(contactId, input) {
      const r = await hsFetch(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: buildProperties(input) }),
      });
      if (!r.ok) return mapHttpError(r);
      if (!r.body || !r.body.id) return { error: "unknown", detail: r.body };
      return { contactId: r.body.id };
    }

    async function checkProperty(internalName) {
      const r = await hsFetch(`/crm/v3/properties/contacts/${encodeURIComponent(internalName)}`);
      if (r.status === 404) return { exists: false };
      if (!r.ok) return mapHttpError(r);
      return { exists: true };
    }

    return { searchByEmail, createContact, updateContact, checkProperty };
  }

  const api = { createClient };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusHubSpot = api;
})(typeof self !== "undefined" ? self : globalThis);
