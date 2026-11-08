import { describe, expect, it, vi } from "vitest";

import { readPublicMode } from "./publicMode";

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("readPublicMode", () => {
  it("is true only when GET /public-mode says enabled: true", async () => {
    expect(await readPublicMode(answer(200, { enabled: true }))).toBe(true);
    expect(await readPublicMode(answer(200, { enabled: false }))).toBe(false);
  });

  it("treats an unreadable answer as not public, so local mode keeps its probes", async () => {
    expect(await readPublicMode(answer(404, { detail: "Not Found" }))).toBe(false);
    expect(await readPublicMode(vi.fn(async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBe(false);
  });

  it("asks the /public-mode route", async () => {
    const f = answer(200, { enabled: true });
    await readPublicMode(f);
    expect(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toMatch(/\/public-mode$/);
  });
});
