import { describe, expect, it, vi } from "vitest";

vi.mock("../providers/local/config", () => ({ API_URL: "http://localhost:8001", DATA_MODE: "local" }));

import { readLinkState } from "./PublicLinkMenuItem";

const api = (publicMode: unknown, link: unknown = { on: true }) =>
  vi.fn(async (url: string) =>
    new Response(JSON.stringify(String(url).endsWith("/public-mode") ? publicMode : link), { status: 200 }),
  ) as unknown as typeof fetch;

describe("readLinkState", () => {
  it("shows the switch on the laptop's own service (public mode off)", async () => {
    expect(await readLinkState(api({ enabled: false }, { on: false }))).toEqual({ on: false });
  });

  it("hides it on the public service, redacting or show-all", async () => {
    expect(await readLinkState(api({ enabled: true, redacted: true }))).toBeNull();
    expect(await readLinkState(api({ enabled: true, redacted: false }))).toBeNull();
  });

  it("hides it when the API is unreachable", async () => {
    expect(await readLinkState(vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBeNull();
  });
});
