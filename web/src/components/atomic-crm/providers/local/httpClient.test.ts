import { localApiMethods } from "./httpClient";

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe("localApiMethods.getIcp: 'not built yet'", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps PR #15's 404 to null", async () => {
    vi.stubGlobal(
      "fetch",
      respond(404, { detail: "no ideal donor profile yet: run the pipeline or POST /icp/run" }),
    );
    expect(await localApiMethods.getIcp()).toBeNull();
  });

  it("maps 200 null to null (the no-console-error form)", async () => {
    vi.stubGlobal("fetch", respond(200, null));
    expect(await localApiMethods.getIcp()).toBeNull();
  });

  it("still throws on other errors", async () => {
    vi.stubGlobal("fetch", respond(500, { detail: "boom" }));
    await expect(localApiMethods.getIcp()).rejects.toThrow("500");
  });
});

describe("localApiMethods outreach timeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("explains a 504 agent_timeout with a cached draft", async () => {
    vi.stubGlobal(
      "fetch",
      respond(504, { error: "agent_timeout", detail: "x", cached_draft: { id: 9 } }),
    );
    await expect(localApiMethods.draftProspectOutreach(1)).rejects.toThrow(
      "Draft took too long, showing the last saved draft.",
    );
  });
});
