const { createClient } = require("../hubspotClient.js");

function mockFetch(responses) {
  const calls = [];
  global.fetch = jest.fn((url, opts) => {
    calls.push({ url, opts });
    const next = responses.shift();
    if (!next) throw new Error("no more mocked responses");
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    });
  });
  return calls;
}

describe("searchByEmail", () => {
  test("returns {found:false} when search yields no contacts", async () => {
    const calls = mockFetch([{ status: 200, body: { results: [] } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.found).toBe(false);
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/search");
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer pat-test");
  });

  test("returns {found:true, contactId, properties} when search yields one", async () => {
    const calls = mockFetch([{ status: 200, body: {
      results: [{ id: "1234", properties: { firstname: "Antonio", lastname: "Varlese", company: "Ortus Club" } }]
    }}]);
    const client = createClient({ token: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.found).toBe(true);
    expect(result.contactId).toBe("1234");
    expect(result.properties.firstname).toBe("Antonio");
  });

  test("returns {error:'duplicate'} when search yields multiple", async () => {
    mockFetch([{ status: 200, body: {
      results: [{ id: "1" }, { id: "2" }]
    }}]);
    const client = createClient({ token: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.error).toBe("duplicate");
  });
});

describe("createContact", () => {
  test("POSTs to /crm/v3/objects/contacts with all six properties", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "5555" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.createContact({
      firstName: "Antonio", lastName: "Varlese",
      company: "Ortus Club", jobTitle: "Founder",
      memberId: "98750243",
    });
    expect(result.contactId).toBe("5555");
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
    expect(calls[0].opts.method).toBe("POST");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.firstname).toBe("Antonio");
    expect(body.properties.lastname).toBe("Varlese");
    expect(body.properties.company).toBe("Ortus Club");
    expect(body.properties.jobtitle).toBe("Founder");
    expect(body.properties.email).toBe("98750243@linkedinmembership.id");
    expect(body.properties.linkedin_membership_id).toBe("98750243");
  });

  test("omits empty optional fields from payload", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "5556" } }]);
    const client = createClient({ token: "pat-test" });
    await client.createContact({
      firstName: "Mariana", lastName: "",
      company: "", jobTitle: "",
      memberId: "48201192",
    });
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts");
    expect(calls[0].opts.method).toBe("POST");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.firstname).toBe("Mariana");
    expect(body.properties.lastname).toBeUndefined();
    expect(body.properties.company).toBeUndefined();
    expect(body.properties.jobtitle).toBeUndefined();
    expect(body.properties.email).toBe("48201192@linkedinmembership.id");
    expect(body.properties.linkedin_membership_id).toBe("48201192");
  });

  test("returns {error:'unknown'} when 201 response has no body id", async () => {
    mockFetch([{ status: 201, body: null }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.createContact({
      firstName: "Test", lastName: "User",
      company: "", jobTitle: "",
      memberId: "12345",
    });
    expect(result.error).toBe("unknown");
    expect(result.contactId).toBeUndefined();
  });

  test("includes linkedinbio when scrape provides linkedinBio URL", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "9001" } }]);
    const client = createClient({ token: "pat-test" });
    await client.createContact({
      firstName: "Lev", lastName: "Yatsemyrskyi",
      company: "Nasdaq",
      jobTitle: "Director of Client Integrations",
      memberId: "1797602",
      linkedinBio: "https://www.linkedin.com/in/lev-yatsemyrskyi-a71a0a256",
    });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.linkedinbio).toBe("https://www.linkedin.com/in/lev-yatsemyrskyi-a71a0a256");
    expect(body.properties.linkedin_bio).toBeUndefined(); // wrong-name guard
  });

  test("omits linkedinbio when scrape has no URL (independent / sparse profile)", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "9002" } }]);
    const client = createClient({ token: "pat-test" });
    await client.createContact({
      firstName: "Mariana", lastName: "De Luca",
      company: "", jobTitle: "Independent",
      memberId: "48201192",
      linkedinBio: "",
    });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.linkedinbio).toBeUndefined();
  });
});

describe("updateContact", () => {
  test("PATCHes /crm/v3/objects/contacts/{id} with populated fields", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "5555" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.updateContact("5555", {
      firstName: "Antonio", lastName: "Varlese",
      company: "Ortus Club", jobTitle: "CEO",
      memberId: "98750243",
    });
    expect(result.contactId).toBe("5555");
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/5555");
    expect(calls[0].opts.method).toBe("PATCH");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.jobtitle).toBe("CEO");
  });

  test("omits empty optional fields so HubSpot does not blank existing data", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "5555" } }]);
    const client = createClient({ token: "pat-test" });
    await client.updateContact("5555", {
      firstName: "Antonio", lastName: "",
      company: "", jobTitle: "",
      memberId: "98750243",
    });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.lastname).toBeUndefined();
    expect(body.properties.company).toBeUndefined();
    expect(body.properties.jobtitle).toBeUndefined();
  });
});

describe("checkProperty", () => {
  test("returns {exists:true} when GET returns 200", async () => {
    mockFetch([{ status: 200, body: { name: "linkedin_membership_id" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.checkProperty("linkedin_membership_id");
    expect(result.exists).toBe(true);
  });

  test("returns {exists:false} when GET returns 404", async () => {
    mockFetch([{ status: 404, body: { message: "Property not found" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.checkProperty("linkedin_membership_id");
    expect(result.exists).toBe(false);
  });
});

describe("error mapping", () => {
  test("401 returns {error:'token'}", async () => {
    mockFetch([{ status: 401, body: { message: "bad token" } }]);
    const client = createClient({ token: "pat-bad" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("token");
  });
  test("403 returns {error:'scope', detail}", async () => {
    mockFetch([{ status: 403, body: { message: "missing scope" } }]);
    const client = createClient({ token: "pat-bad" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("scope");
    expect(r.detail.message).toBe("missing scope");
  });
  test("429 returns {error:'rate_limit'}", async () => {
    mockFetch([{ status: 429, body: {} }]);
    const client = createClient({ token: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("rate_limit");
  });
  test("500 returns {error:'hubspot_5xx'}", async () => {
    mockFetch([{ status: 500, body: { message: "server" } }]);
    const client = createClient({ token: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("hubspot_5xx");
  });
  test("network failure returns {error:'network'}", async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const client = createClient({ token: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("network");
  });
});
