import { describe, expect, it } from "vitest";

import { requestAddEvent, takeAddEventRequest } from "./calendarFocus";

describe("Add event request (small tile's +)", () => {
  it("is read once, then cleared", () => {
    expect(takeAddEventRequest()).toBe(false);
    requestAddEvent();
    expect(takeAddEventRequest()).toBe(true);
    expect(takeAddEventRequest()).toBe(false);
  });
});
