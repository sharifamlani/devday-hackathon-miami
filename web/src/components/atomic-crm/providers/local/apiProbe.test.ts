import { describe, expect, it, vi } from "vitest";

import { apiReachable, FALLBACK_FLAG, probeAndFlag, probePublicMode, PUBLIC_FLAG } from "./apiProbe";
import { resolveDataMode } from "./config";

const ok = (async () => ({ ok: true })) as unknown as typeof fetch;
const refused = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;
const hangs = ((_url: string, init?: RequestInit) =>
  new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;

describe("api startup probe", () => {
  it("is reachable when /health answers", async () => {
    expect(await apiReachable("http://x/", 50, ok)).toBe(true);
  });
  it("is unreachable when the connection fails", async () => {
    expect(await apiReachable("http://127.0.0.1:1", 50, refused)).toBe(false);
  });
  it("is unreachable when the request hangs past the timeout", async () => {
    expect(await apiReachable("http://x", 30, hangs)).toBe(false);
  });
  it("is unreachable on a non-2xx", async () => {
    const f = (async () => ({ ok: false })) as unknown as typeof fetch;
    expect(await apiReachable("http://x", 50, f)).toBe(false);
  });
  it("flags the page for fallback when local mode cannot reach the API", async () => {
    const target: Record<string, unknown> = {};
    expect(await probeAndFlag("local", "http://dead", target, refused, 50)).toBe(true);
    expect(target[FALLBACK_FLAG]).toBe(true);
  });
  it("does not flag when the API answers, and never probes in snapshot mode", async () => {
    const target: Record<string, unknown> = {};
    const spy = vi.fn(ok);
    expect(await probeAndFlag("local", "http://up", target, spy, 50)).toBe(false);
    expect(await probeAndFlag("snapshot", "http://up", target, spy, 50)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(target[FALLBACK_FLAG]).toBeUndefined();
  });
  it("resolves data mode to snapshot when the API is unreachable", () => {
    expect(resolveDataMode("local", true)).toBe("snapshot");
    expect(resolveDataMode("live", true)).toBe("snapshot");
    expect(resolveDataMode("local", false)).toBe("local");
    expect(resolveDataMode(undefined, false)).toBe("snapshot");
  });
});

describe("public-mode startup check", () => {
  const answer = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("flags the page whenever GET /public-mode says enabled: true, redacted or not", async () => {
    const on: Record<string, unknown> = {};
    expect(await probePublicMode("local", "http://up/", on, answer(200, { enabled: true }), 50)).toBe(true);
    expect(on[PUBLIC_FLAG]).toBe(true);
    const showAll: Record<string, unknown> = {}; // PUBLIC_SHOW_ALL: unredacted reads, writes still refused
    expect(await probePublicMode("local", "http://up", showAll, answer(200, { enabled: true, redacted: false }), 50)).toBe(true);
    expect(showAll[PUBLIC_FLAG]).toBe(true);
    const off: Record<string, unknown> = {};
    expect(await probePublicMode("local", "http://up", off, answer(200, { enabled: false }), 50)).toBe(false);
    expect(off[PUBLIC_FLAG]).toBeUndefined();
  });

  it("treats an unreadable answer as not public, and never asks in snapshot mode", async () => {
    const target: Record<string, unknown> = {};
    expect(await probePublicMode("local", "http://x", target, answer(404, {}), 50)).toBe(false);
    expect(await probePublicMode("local", "http://x", target, refused, 50)).toBe(false);
    expect(await probePublicMode("local", "http://x", target, hangs, 30)).toBe(false);
    const spy = answer(200, { enabled: true });
    expect(await probePublicMode("snapshot", "http://x", target, spy, 50)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    expect(target[PUBLIC_FLAG]).toBeUndefined();
  });

  it("asks the /public-mode route", async () => {
    const spy = answer(200, { enabled: true });
    await probePublicMode("live", "http://up/", {}, spy, 50);
    expect(String((spy as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toBe("http://up/public-mode");
  });
});
