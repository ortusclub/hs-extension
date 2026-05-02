const { detectPageType, scrapeProfile } = require("../scraper.js");

describe("detectPageType", () => {
  test("returns 'profile' for /in/<slug>", () => {
    expect(detectPageType("https://www.linkedin.com/in/antonio-varlese/")).toBe("profile");
  });
  test("returns 'salesnav' for /sales/lead", () => {
    expect(detectPageType("https://www.linkedin.com/sales/lead/ACoAAB123,NAME_SEARCH/")).toBe("salesnav");
  });
  test("returns 'unknown' for feed", () => {
    expect(detectPageType("https://www.linkedin.com/feed/")).toBe("unknown");
  });
  test("returns 'unknown' for non-linkedin", () => {
    expect(detectPageType("https://example.com/")).toBe("unknown");
  });
});

const fs = require("fs");
const path = require("path");

function loadFixture(name) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
  document.documentElement.innerHTML = html;
  return document;
}

afterEach(() => {
  document.documentElement.innerHTML = "<head></head><body></body>";
});

describe("scrapeProfile - regular profile", () => {
  test("extracts firstName and lastName from h1", () => {
    const doc = loadFixture("profile-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.firstName).toBe("Antonio");
    expect(result.lastName).toBe("Varlese");
    expect(result.pageType).toBe("profile");
  });

  test("extracts numeric memberId from urn:li:member regex", () => {
    const doc = loadFixture("profile-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.memberId).toBe("98750243");
  });

  test("returns empty role/company when no Experience section is present (no guessing)", () => {
    const doc = loadFixture("profile-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.firstName).toBe("Antonio");
    expect(result.jobTitle).toBe("");
    expect(result.company).toBe("");
  });
});

describe("scrapeProfile - sales navigator", () => {
  test("extracts all six fields from a salesnav page", () => {
    const doc = loadFixture("salesnav-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/sales/lead/ACoAAB,NAME_SEARCH/");
    expect(result.pageType).toBe("salesnav");
    expect(result.firstName).toBe("Antonio");
    expect(result.lastName).toBe("Varlese");
    expect(result.jobTitle).toBe("Founder");
    expect(result.company).toBe("Ortus Club");
    expect(result.memberId).toBe("98750243");
  });
});

describe("scrapeProfile - failure modes", () => {
  test("hard-fails with no_member_id when member id absent", () => {
    const doc = loadFixture("profile-no-memberid.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.error).toBe("no_member_id");
  });

  test("soft-fails on missing job title (still returns full record)", () => {
    const doc = loadFixture("profile-no-title.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Antonio");
    expect(result.lastName).toBe("Varlese");
    expect(result.memberId).toBe("98750243");
    expect(result.jobTitle).toBe("");
    expect(result.company).toBe("");
  });

  test("returns not_on_profile for unrelated URLs", () => {
    document.documentElement.innerHTML = "<html><body></body></html>";
    const result = scrapeProfile(document, "https://example.com/");
    expect(result.error).toBe("not_on_profile");
  });
});

describe("scrapeProfile - experience-based role/company", () => {
  test("extracts company and current role from Experience section, not headline", () => {
    const doc = loadFixture("profile-with-experience.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/lev-yatsemyrskyi/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Lev");
    expect(result.lastName).toBe("Yatsemyrskyi");
    expect(result.company).toBe("Nasdaq");
    expect(result.jobTitle).toBe("Director of Client Integrations and AI Functionality | Technical Product Manager");
    expect(result.jobTitle).not.toMatch(/Global Head Of/);
  });

  test("REAL DOM: Lev — picks role title (longest .t-bold under company link in <li>), not the company name or headline", () => {
    const doc = loadFixture("profile-real-lev.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/lev-yatsemyrskyi-a71a0a256/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Lev");
    expect(result.lastName).toBe("Yatsemyrskyi");
    expect(result.company).toBe("Nasdaq");
    expect(result.jobTitle).toBe("Director of Client Integrations and AI Functionality | Technical Product Manager");
    expect(result.jobTitle).not.toMatch(/Global Head Of/);
    expect(result.jobTitle).not.toMatch(/^Nasdaq$/);
    expect(result.jobTitle).not.toMatch(/Senior Integration Engineer/); // not the older role
    // LinkedIn profile URL must be set from the slug (no trailing slash)
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/lev-yatsemyrskyi-a71a0a256");
  });

  test("REAL DOM: Sunny — preserves '.com' in 'Indeed.com' and ignores newsletter decoy", () => {
    const doc = loadFixture("profile-real-sunny.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/huijuan-sunny-zhu/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Huijuan");
    expect(result.company).toBe("Indeed.com");
    expect(result.jobTitle).toBe("Head of Data & Analytics, Strategy & Operation");
    expect(result.jobTitle).not.toMatch(/Pulse/);     // newsletter decoy must be ignored
    expect(result.jobTitle).not.toMatch(/Director of Data Science/); // older role excluded
  });

  test("REAL DOM: Raji (verbatim from real LinkedIn) — picks first role-anchor without data-field", () => {
    const doc = loadFixture("profile-real-raji.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/rajikumarphd/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Raji");
    expect(result.lastName).toBe("Kumar");
    expect(result.company).toBe("Lockton");
    expect(result.jobTitle).toBe("Vice President, Strategy & Operations");
    // Must NOT pick the headline ("0→1 Builder ...")
    expect(result.jobTitle).not.toMatch(/0→1 Builder/);
    expect(result.jobTitle).not.toMatch(/Enterprise Strategy/);
    // Must NOT pick the company name (which is in the data-field-marked anchor)
    expect(result.jobTitle).not.toBe("Lockton");
    // Must NOT pick the older roles
    expect(result.jobTitle).not.toMatch(/Engagement and Analytics/);
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/rajikumarphd");
  });

  test("REAL DOM: Mohammed — multiple roles at same company, must pick FIRST (most recent), not longest", () => {
    const doc = loadFixture("profile-real-mohammed.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/mohammed-shaik-hussain-ali/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Mohammed");
    expect(result.company).toBe("Oracle");
    // First role in document order = current role
    expect(result.jobTitle).toBe("Director of Engineering");
    // Must NOT pick the older role even though its text is longer
    expect(result.jobTitle).not.toBe("Senior Engineering Manager");
    // Must NOT pick the company name (which is in a non-leaf li)
    expect(result.jobTitle).not.toBe("Oracle");
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/mohammed-shaik-hussain-ali");
  });

  test("ignores top-card education /company/ link; only picks role from inside the Experience section", () => {
    // Top card has an Education link to Cornell (LinkedIn sometimes uses /company/ for schools).
    // Without scoping, scraper would pick "Cornell University" as the job title.
    document.documentElement.innerHTML = `
      <body>
        <h1>Santosh Kumar Yamsani</h1>
        <button aria-label="Current company: BNY. Click to skip to experience card" type="button">
          <div>BNY</div>
        </button>
        <a href="https://www.linkedin.com/company/cornell-university/" aria-label="Education: Cornell University">
          <span class="t-bold"><span aria-hidden="true">Cornell University</span></span>
        </a>
        <section>
          <div id="experience" class="pv-profile-card__anchor"></div>
          <ul>
            <li>
              <a data-field="experience_company_logo" href="https://www.linkedin.com/company/bny/"></a>
              <a data-field="experience_company_logo" href="https://www.linkedin.com/company/bny/">
                <div class="t-bold"><span aria-hidden="true">BNY</span></div>
              </a>
              <a href="https://www.linkedin.com/company/bny/">
                <div class="t-bold"><span aria-hidden="true">Global Head of Enterprise Core &amp; Platform Engineering</span></div>
              </a>
            </li>
          </ul>
        </section>
        <code>{"objectUrn":"urn:li:member:777","publicIdentifier":"santosh-kumar-yamsani-8a75755"}</code>
      </body>
    `;
    const result = scrapeProfile(document, "https://www.linkedin.com/in/santosh-kumar-yamsani-8a75755/");
    expect(result.firstName).toBe("Santosh");
    expect(result.company).toBe("BNY");
    expect(result.jobTitle).toBe("Global Head of Enterprise Core & Platform Engineering");
    expect(result.jobTitle).not.toMatch(/Cornell/i);
  });

  test("REAL DOM: Ruth — stacked roles under one company, current title sits in second non-data-field anchor under Fiserv", () => {
    const doc = loadFixture("ruth-dom.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/ruthahubbard/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Ruth");
    expect(result.lastName).toBe("Hubbard");
    expect(result.company).toBe("Fiserv");
    expect(result.jobTitle).toBe("Director, Data Product Strategy & Partnerships, Data Commerce Solutions");
    // Headline must NOT leak in (no " at " separator, but guard against future drift)
    expect(result.jobTitle).not.toMatch(/Turning Transaction Data/);
    // Older roles at JPMorgan/Google must not be picked as current
    expect(result.jobTitle).not.toMatch(/JPMorgan|Google|YouTube/i);
    expect(result.company).not.toMatch(/JPMorgan|Google|YouTube/i);
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/ruthahubbard");
  });

  test("REAL DOM: Independent profile — no experience section, returns empty role/company (warning chip surfaces it)", () => {
    const doc = loadFixture("profile-real-no-current.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/mariana-de-luca/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Mariana");
    expect(result.jobTitle).toBe("");
    expect(result.company).toBe("");
  });

  test("REAL DOM: Santosh — single role with data-field anchor wrapping the entire entry, picks role not company", () => {
    const doc = loadFixture("real-santosh.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/santosh-kumar-yamsani-8a75755/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Santosh");
    expect(result.lastName).toBe("Kumar Yamsani");
    expect(result.company).toBe("BNY");
    expect(result.jobTitle).toBe("Global Head of Enterprise Core & Platform Engineering");
    // Headline must NOT leak in (his headline is a tagline with multiple "|" separators)
    expect(result.jobTitle).not.toMatch(/Chief Technology Officer/);
    expect(result.jobTitle).not.toMatch(/IIT-BHU/);
    // Cornell from the top-card education link must NOT be picked
    expect(result.jobTitle).not.toMatch(/Cornell/i);
    expect(result.company).not.toMatch(/Cornell/i);
    expect(result.linkedinBio).toBe("https://www.linkedin.com/in/santosh-kumar-yamsani-8a75755");
  });
});

describe("scrapeProfile - viewer vs target disambiguation", () => {
  test("picks the profile being viewed, not the logged-in viewer", () => {
    const doc = loadFixture("profile-viewer-vs-target.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/jason-bell-mba-66684611/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Jason");
    expect(result.lastName).toBe("Bell");
    expect(result.memberId).toBe("99999999"); // Jason's, NOT 420107047 (viewer Antonio)
    expect(result.memberId).not.toBe("420107047");
    expect(result.memberId).not.toBe("111111111"); // not a sidebar lead
  });

  test("falls back to single-URN heuristic when no slug match", () => {
    document.documentElement.innerHTML = `
      <h1>Solo Profile</h1>
      <div class="text-body-medium">Founder at Acme</div>
      <code>{"objectUrn":"urn:li:member:55555555"}</code>
    `;
    const result = scrapeProfile(document, "https://www.linkedin.com/in/some-slug-with-no-match/");
    expect(result.memberId).toBe("55555555");
  });

  test("returns no_member_id when slug doesn't match and multiple URNs exist", () => {
    document.documentElement.innerHTML = `
      <h1>Ambiguous</h1>
      <code>{"objectUrn":"urn:li:member:111","publicIdentifier":"alice"}</code>
      <code>{"objectUrn":"urn:li:member:222","publicIdentifier":"bob"}</code>
    `;
    const result = scrapeProfile(document, "https://www.linkedin.com/in/charlie/");
    expect(result.error).toBe("no_member_id");
  });
});
