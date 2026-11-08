import { describe, expect, it } from "vitest";

import { isDateOnly, parseWhen } from "./parseWhen";

describe("parseWhen", () => {
  it("parses a date-only string as a local day", () => {
    const d = parseWhen("2026-11-19");
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 19, 0]);
    expect(isDateOnly("2026-11-19")).toBe(true);
  });

  it("leaves a local datetime unchanged", () => {
    const d = parseWhen("2026-11-15T08:00");
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([15, 8, 0]);
    expect(isDateOnly("2026-11-15T08:00")).toBe(false);
  });

  it("treats a naive space-separated timestamp as UTC", () => {
    expect(parseWhen("2026-11-08 04:22:38").toISOString()).toBe("2026-11-08T04:22:38.000Z");
  });

  it("keeps explicit offsets", () => {
    expect(parseWhen("2026-11-08T04:22:38Z").toISOString()).toBe("2026-11-08T04:22:38.000Z");
  });
});
