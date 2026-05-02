# Ortus Club · HubSpot Sync (Chrome Extension)

Lookup or push the LinkedIn profile you're viewing into Ortus Club's HubSpot.

## How it works

1. Open a LinkedIn profile (regular `linkedin.com/in/<slug>` or Sales Navigator).
2. Click the extension's toolbar icon.
3. The popup scrapes name, company, job title, and the numeric LinkedIn member ID, then searches HubSpot for `<memberId>@linkedinmembership.id`.
4. If absent → **Push to HubSpot**. If present → **Update / Skip**.

## Install (developer mode)

1. `chrome://extensions` → enable **Developer mode** (top right).
2. Click **Load unpacked** → select this folder.
3. Pin the extension to the toolbar.

## Ship a new build

```bash
zip -r "HS-Sync-v0.1.0.zip" \
  manifest.json background.js content.js scraper.js hubspotClient.js \
  popup.html popup.js icons/
```

Distribute the zip only to trusted operators. The HubSpot token is hardcoded inside `background.js`.

## Token rotation

The HubSpot Private App token lives at the top of `background.js`:

```js
const HUBSPOT_TOKEN = "pat-na1-...";
const HUBSPOT_PORTAL_ID = "...";
```

To rotate:

1. In HubSpot, rotate the Private App token. Confirm scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`.
2. Paste the new token into `background.js`.
3. Bump `version` in `manifest.json`.
4. Rebuild the zip with the command above.
5. Re-distribute to operators (each operator reloads via `chrome://extensions`).

## Manual smoke test

After installing:

- [ ] **Settings tab** shows ✓ for "API token valid" and "Custom property `linkedin_membership_id`".
- [ ] On a non-LinkedIn tab, popup says *"Open a LinkedIn profile to begin."*
- [ ] On a regular `linkedin.com/in/<slug>` profile that is **not** in HubSpot, popup shows the dossier and a **Push to HubSpot** CTA.
- [ ] Click *Push to HubSpot* → popup transitions to *Pushed ✓* with a *View in HubSpot* link. Clicking the link opens the contact, with `firstname`, `lastname`, `company`, `jobtitle`, `email`, and `linkedin_membership_id` set.
- [ ] Reopen the popup on the same profile → it shows *Already in HubSpot* with **Update** and **Skip**.
- [ ] Click *Update* → *Updated ✓*. The contact in HubSpot reflects the latest scraped values.
- [ ] Repeat on a Sales Navigator profile (`linkedin.com/sales/lead/...`) — same outcomes.
- [ ] On a profile where job title is unparseable, popup shows the *Pushing without job title* warning chip and the push still succeeds.

## Tests

Unit tests cover the scraper (against fixture HTML) and the HubSpot client (with mocked `fetch`). They do not hit real HubSpot.

```bash
npm install
npm test
```

## Architecture

See `docs/superpowers/specs/2026-04-30-hubspot-linkedin-sync-design.md`.
