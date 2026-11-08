import { describe, expect, it, vi } from "vitest";

import { apiReachable, FALLBACK_FLAG, probeAndFlag } from "./apiProbe";
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
