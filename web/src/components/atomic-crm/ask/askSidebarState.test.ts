import {
  SIDEBAR_STORAGE_KEY,
  fullPageHref,
  readSidebarOpen,
  writeSidebarOpen,
} from "./askSidebarState";

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
};

const throwingStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("Ask sidebar state", () => {
  it("remembers open/closed for the tab", () => {
    const storage = memoryStorage();
    expect(readSidebarOpen(storage)).toBe(false);
    writeSidebarOpen(true, storage);
    expect(storage.data.get(SIDEBAR_STORAGE_KEY)).toBe("open");
    expect(readSidebarOpen(storage)).toBe(true);
    writeSidebarOpen(false, storage);
    expect(readSidebarOpen(storage)).toBe(false);
  });

  it("starts closed and never throws when storage is blocked or missing", () => {
    expect(readSidebarOpen(throwingStorage)).toBe(false);
    expect(() => writeSidebarOpen(true, throwingStorage)).not.toThrow();
    expect(readSidebarOpen(null)).toBe(false);
    expect(() => writeSidebarOpen(true, null)).not.toThrow();
  });

  it("carries the question to the full page", () => {
    expect(fullPageHref("")).toBe("/ask");
    expect(fullPageHref("   ")).toBe("/ask");
    expect(fullPageHref(" Who gave in Q4? & why ")).toBe(
      "/ask?q=Who%20gave%20in%20Q4%3F%20%26%20why",
    );
  });
});
