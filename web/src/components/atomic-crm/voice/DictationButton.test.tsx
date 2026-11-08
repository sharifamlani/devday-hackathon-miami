import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { DictationHint } from "./DictationButton";

describe("DictationHint", () => {
  it("while listening, shows the words being recognized (even when the box already has text)", async () => {
    const screen = await render(<DictationHint error={null} listening interim="Who gave this quarter" />);
    await expect.element(screen.getByText("Listening… Who gave this quarter")).toBeVisible();
  });

  it("before the first word, says it is listening", async () => {
    const screen = await render(<DictationHint error={null} listening interim="" />);
    await expect.element(screen.getByText("Listening… speak, then pause.")).toBeVisible();
  });

  it("an error wins over the listening line", async () => {
    const screen = await render(<DictationHint error="Microphone access is blocked for this site." listening interim="x" />);
    await expect.element(screen.getByText("Microphone access is blocked for this site.")).toBeVisible();
    expect(screen.getByText("Listening…", { exact: false }).elements()).toHaveLength(0);
  });

  it("idle: nothing visible", async () => {
    const screen = await render(<DictationHint error={null} />);
    const el = screen.getByRole("status").element() as HTMLElement;
    expect(el.textContent).toBe("");
    expect(el.className).toContain("sr-only");
  });
});
