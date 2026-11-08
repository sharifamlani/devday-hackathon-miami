import { describe, expect, it } from "vitest";

import { isActive, statusLabel, type PhoneStatus } from "../providers/local/phone";

const call = (status: PhoneStatus, detail: string | null = null) => ({
  status,
  detail,
  donor_name: "Rosa Martinez",
});

describe("phone call status", () => {
  it("names each step the way the dialog shows it", () => {
    expect(statusLabel(call("calling_you"))).toBe("Ringing your phone…");
    expect(statusLabel(call("calling_donor"))).toBe("Calling Rosa Martinez…");
    expect(statusLabel(call("connected"))).toBe("Connected · recording");
    expect(statusLabel(call("processing", "Transcribing"))).toBe("Transcribing…");
    expect(statusLabel(call("done"))).toBe("Saved to the call notes");
  });

  it("shows the service's reason when a call fails", () => {
    expect(statusLabel(call("failed", "Rosa Martinez didn't answer."))).toBe(
      "Rosa Martinez didn't answer.",
    );
    expect(statusLabel(call("failed"))).toBe("The call didn't go through.");
  });

  it("keeps polling only while the call is running or being processed", () => {
    expect(["calling_you", "calling_donor", "connected", "processing"].every((s) => isActive(s as PhoneStatus))).toBe(true);
    expect(isActive("done")).toBe(false);
    expect(isActive("failed")).toBe(false);
    expect(isActive(undefined)).toBe(false);
  });
});
