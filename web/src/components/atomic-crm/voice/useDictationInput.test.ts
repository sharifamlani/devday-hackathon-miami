import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "vitest-browser-react";

import type { TranscriptionStatus } from "../providers/local/dictation";

// A stand-in for 80's useDictation: the test sets what the server has said.
const fake = vi.hoisted(() => ({
  status: "idle" as TranscriptionStatus,
  interim: "",
  final: "",
  error: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("../providers/local/dictation", () => ({
  useDictation: () => ({ ...fake, listening: fake.status === "listening", mock: false }),
}));

const { joinText, useDictationInput } = await import("./useDictationInput");

const box = (initial: string) =>
  renderHook(() => {
    const [value, setValue] = useState(initial);
    return { value, setValue, d: useDictationInput(value, setValue) };
  });

beforeEach(() => {
  Object.assign(fake, { status: "idle", interim: "", final: "", error: null });
  fake.start.mockReset();
  fake.stop.mockReset();
  fake.reset.mockReset();
});

describe("joinText", () => {
  it("joins with exactly one space", () => {
    expect(joinText("", "Who gave")).toBe("Who gave");
    expect(joinText("Hi ", " there")).toBe("Hi there");
    expect(joinText("Hi", "  ")).toBe("Hi");
  });
});

describe("useDictationInput", () => {
  it("fills the box with finals as they arrive and shows interim words apart", async () => {
    const h = await box("");
    h.result.current.d.toggle();
    expect(fake.start).toHaveBeenCalledOnce();

    Object.assign(fake, { status: "listening", interim: "Who gave" });
    await h.rerender();
    expect(h.result.current.d.state).toBe("listening");
    expect(h.result.current.d.interim).toBe("Who gave");
    expect(h.result.current.value).toBe(""); // interim words are shown, not typed in

    Object.assign(fake, { interim: "", final: "Who gave this quarter?" });
    await h.rerender();
    await h.rerender();
    expect(h.result.current.value).toBe("Who gave this quarter?");

    h.result.current.d.toggle(); // press again: stop
    expect(fake.stop).toHaveBeenCalledOnce();
  });

  it("keeps what the person typed while dictating", async () => {
    const h = await box("Draft:");
    h.result.current.d.toggle();
    Object.assign(fake, { status: "listening", final: "thank Rosa" });
    await h.rerender();
    await h.rerender();
    expect(h.result.current.value).toBe("Draft: thank Rosa");
    h.result.current.setValue(h.result.current.value + " today,");
    Object.assign(fake, { final: "thank Rosa and James" });
    await h.rerender();
    await h.rerender();
    expect(h.result.current.value).toBe("Draft: thank Rosa today, and James");
  });

  it("Escape cancels and puts back the text from before", async () => {
    const h = await box("Before.");
    h.result.current.d.toggle();
    Object.assign(fake, { status: "listening", final: "spoken words" });
    await h.rerender();
    await h.rerender();
    expect(h.result.current.value).toBe("Before. spoken words");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await h.rerender();
    expect(h.result.current.value).toBe("Before.");
    expect(fake.reset).toHaveBeenCalled();
  });

  it("halt (the box was sent) drops words still on their way", async () => {
    const h = await box("");
    h.result.current.d.toggle();
    Object.assign(fake, { status: "listening" });
    await h.rerender();
    h.result.current.d.halt();
    h.result.current.setValue(""); // the prompt cleared after sending
    Object.assign(fake, { final: "late words" });
    await h.rerender();
    await h.rerender();
    expect(h.result.current.value).toBe("");
  });

  it("reports an error state with its reason", async () => {
    const h = await box("");
    Object.assign(fake, { status: "error", error: "The transcription connection failed." });
    await h.rerender();
    expect(h.result.current.d.state).toBe("error");
    expect(h.result.current.d.error).toMatch(/connection failed/);
  });
});
