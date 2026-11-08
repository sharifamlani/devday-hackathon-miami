import type { ApiContextRun } from "./apiTypes";
import { localApiMethods } from "./httpClient";
import { snapshotMethods } from "./snapshotClient";
import { parseContext, parseContextRun, parseOrgProfile } from "./parse";

// 90's POST /context/run response (PR #21), trimmed.
const run: ApiContextRun = {
  state: "done",
  cached: false,
  detail: null,
  started_at: "2026-11-07T23:00:00Z",
  finished_at: "2026-11-07T23:00:20Z",
  sources: {
    instagram: { status: "not provided", facts: 0, detail: null },
    x: { status: "saved, not connected", facts: 0, detail: "https://x.com/tidepath-example" },
    website: { status: "done", facts: 2, detail: null },
    news: { status: "blocked", facts: 0, detail: "captcha" },
    linkedin: { status: "saved, not connected", facts: 0, detail: "https://linkedin.com/company/x" },
  },
  profile: {
    name: "Tidepath",
    website: "https://tidepath.example.org",
    x_url: "https://x.com/tidepath-example",
    linkedin_url: "https://linkedin.com/company/x",
    instagram_url: "",
    priorities: '["Empower Youth & Families", "Build Climate & Disaster Resilience"]',
    voice: ["upbeat", "civic"],
  },
  facts: [
    { id: 1, source: "website", url: "https://tidepath.example.org/a", posted_at: "2026-08-31", fact: "Older fact" },
    { id: 2, source: "website", url: "https://tidepath.example.org/b", posted_at: "2026-09-15", fact: "Newer fact", quote: "q" },
    { id: 3, source: "website", url: "", posted_at: "2026-10-01", fact: "No URL: dropped" },
  ],
  saved: { org_profile_id: 1, context_ids: [1, 2], replaced_sources: ["website"] },
};

describe("parseContextRun", () => {
  it("orders sources website, news, then socials, and maps each status", () => {
    const parsed = parseContextRun(run);
    expect(parsed.sources.map((s) => [s.source, s.state, s.fact_count])).toEqual([
      ["website", "done", 2],
      ["news", "blocked", 0],
      ["x", "saved_not_connected", 0],
      ["linkedin", "saved_not_connected", 0],
      ["instagram", "not_provided", 0],
    ]);
    expect(parsed.sources[2]).toMatchObject({
      label: "X",
      status_text: "saved, not connected",
      detail: "https://x.com/tidepath-example",
    });
    expect(parsed.status).toBe("done");
    expect(parsed.cached).toBe(false);
    expect(parsed.served_from).toBe("live"); // no served_from + cached:false
  });

  it("reads served_from, and treats only 'fallback' as cached", () => {
    expect(parseContextRun({ ...run, served_from: "cache", cached: false })).toMatchObject({
      served_from: "cache",
      cached: false,
    });
    expect(parseContextRun({ ...run, served_from: "fallback", cached: true })).toMatchObject({
      served_from: "fallback",
      cached: true,
    });
    // An older build without served_from: cached:true meant fallback.
    expect(parseContextRun({ ...run, cached: true }).served_from).toBe("fallback");
  });

  it("keeps sourced facts only, newest first", () => {
    expect(parseContextRun(run).facts.map((f) => f.fact)).toEqual(["Newer fact", "Older fact"]);
  });

  it("marks socials 'saved, not connected' and skips empty ones", () => {
    const profile = parseOrgProfile(run.profile!);
    expect(profile.socials.map((s) => [s.label, s.status])).toEqual([
      ["X", "saved, not connected"],
      ["LinkedIn", "saved, not connected"],
    ]);
    expect(profile.priorities).toEqual([
      "Empower Youth & Families",
      "Build Climate & Disaster Resilience",
    ]);
  });

  it("reads voice phrases from build_context's {phrases, urls}", () => {
    const profile = parseOrgProfile({
      ...run.profile!,
      voice: { phrases: ["All of us, together."], urls: ["https://tidepath.example.org/"] },
    });
    expect(profile.voice).toEqual(["All of us, together."]);
  });

  it("parses GET /context as a bare list or as {profile, facts}", () => {
    expect(parseContext(run.facts!).facts).toHaveLength(2);
    expect(parseContext({ org_profile: run.profile, org_context: run.facts }).profile?.name).toBe(
      "Tidepath",
    );
  });
});

describe("localApiMethods onboarding calls", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uploads every file as multipart under 'files'", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ donors_added: 12, gifts_added: 47 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await localApiMethods.uploadFiles([
      new File(["a,b"], "donors.csv"),
      new File(["# notes"], "notes.md"),
    ]);
    expect(result).toMatchObject({ donors: 12, gifts: 47 });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const form = init.body as FormData;
    expect(form.getAll("files").map((f) => (f as File).name)).toEqual(["donors.csv", "notes.md"]);
    expect(init.headers).toBeUndefined(); // the browser sets the multipart boundary
  });

  it("explains a missing ingest service", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(localApiMethods.uploadFiles([new File(["x"], "a.csv")])).rejects.toThrow(
      "Upload isn't available yet",
    );
  });

  it("explains a missing context service", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(localApiMethods.runContext({ website: "https://a.org" })).rejects.toThrow(
      "Website research isn't available yet",
    );
  });

  it("rejects a missing or blank website before any request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      localApiMethods.runContext({ website: null, x_url: "https://x.com/a" }),
    ).rejects.toThrow("Add your website to continue");
    await expect(localApiMethods.runContext({ website: "   " })).rejects.toThrow(
      "Add your website to continue",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends empty social fields as null", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(run), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await localApiMethods.runContext({ website: "https://a.org", x_url: "" });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      website: "https://a.org",
      x_url: null,
      linkedin_url: null,
      instagram_url: null,
      refresh: false,
    });
  });

  it("treats a 404 org profile as not set up yet", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
    expect(await localApiMethods.getOrgProfile()).toBeNull();
  });
});

describe("snapshotMethods.runContext", () => {
  it("applies the same website rule as live", async () => {
    await expect(snapshotMethods.runContext({ website: "" })).rejects.toThrow(
      "Add your website to continue",
    );
  });
});
