import { describe, expect, it } from "vitest";

import {
  isPublicPreviewRefusal,
  PUBLIC_PREVIEW_MESSAGE,
  PUBLIC_PREVIEW_READ_MESSAGE,
} from "./publicPreview";

describe("public preview refusals", () => {
  it("recognises only the preview's own 403", () => {
    const body = { detail: "not available in the public preview" };
    expect(isPublicPreviewRefusal(403, body)).toBe(true);
    expect(isPublicPreviewRefusal(403, { detail: "Forbidden" })).toBe(false);
    expect(isPublicPreviewRefusal(404, body)).toBe(false);
    expect(isPublicPreviewRefusal(403, null)).toBe(false);
  });

  it("reads as a plain sentence, with no status code or route", () => {
    for (const message of [PUBLIC_PREVIEW_MESSAGE, PUBLIC_PREVIEW_READ_MESSAGE])
      expect(message).not.toMatch(/403|POST|GET|\//);
    expect(PUBLIC_PREVIEW_READ_MESSAGE).not.toContain("saved");
  });
});
