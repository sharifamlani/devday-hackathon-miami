import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

// What dictation is showing; the hook itself is tested in voice/useDictationInput.test.ts.
const dictation = vi.hoisted(() => ({ interim: "" }));
vi.mock("../voice/useDictationInput", () => ({
  useDictationInput: () => ({
    state: dictation.interim ? "listening" : "idle",
    interim: dictation.interim,
    error: null,
    available: true,
    toggle: () => {},
    cancel: () => {},
    halt: () => {},
  }),
}));

const { AskPrompt } = await import("./AskPrompt");

const prompt = () => (
  <AskPrompt value="" onChange={() => {}} onSubmit={() => {}} pending={false} placeholder="Who gave this quarter?" />
);

describe("AskPrompt while dictating", () => {
  it("hides the placeholder under the greyed interim words, so they don't run together", async () => {
    dictation.interim = "This is a test of the live";
    const screen = await render(prompt());
    const box = screen.getByRole("textbox").element() as HTMLTextAreaElement;
    expect(box.placeholder).toBe("");
    await expect.element(screen.getByText("This is a test of the live")).toBeVisible();
  });

  it("shows the placeholder again when nothing is being dictated", async () => {
    dictation.interim = "";
    const screen = await render(prompt());
    expect((screen.getByRole("textbox").element() as HTMLTextAreaElement).placeholder).toBe("Who gave this quarter?");
  });
});
