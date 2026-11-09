import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MemoryRouter, useLocation } from "react-router";
import {
  DICTATION_TOGGLE_EVENT,
  hotkeyFor,
  useWorkspaceHotkeys,
} from "./useWorkspaceHotkeys";

const toggle = vi.hoisted(() => vi.fn());
vi.mock("./workspaceView", async (orig) => ({
  ...(await orig<typeof import("./workspaceView")>()),
  toggleWorkspace: toggle,
}));

const mods = { altKey: false, ctrlKey: false, shiftKey: false, metaKey: false };

const Probe = () => {
  useWorkspaceHotkeys();
  const loc = useLocation();
  return (
    <>
      <i data-loc={loc.pathname + loc.search} />
      <textarea data-testid="composer" data-hotkeys="composer" />
      <input data-testid="search" />
      <div data-zoom-source="tasks" />
    </>
  );
};
const mount = async (path = "/") =>
  await render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>,
  );
const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};

describe("hotkeyFor", () => {
  it("maps physical keys with exact modifiers (S1)", () => {
    expect(hotkeyFor({ ...mods, altKey: true, code: "KeyC" })).toEqual({ view: "calendar" });
    expect(hotkeyFor({ ...mods, altKey: true, code: "KeyT" })).toEqual({ view: "tasks" });
    expect(hotkeyFor({ ...mods, altKey: true, code: "KeyM" })).toEqual({ view: "crm" });
    expect(hotkeyFor({ ...mods, ctrlKey: true, code: "KeyI" })).toEqual({ view: "impact" });
    expect(hotkeyFor({ ...mods, altKey: true, code: "KeyV" })).toEqual({ dictation: true });
  });
  it("ignores other modifier combos", () => {
    expect(hotkeyFor({ ...mods, altKey: true, ctrlKey: true, code: "KeyC" })).toBeNull();
    expect(hotkeyFor({ ...mods, altKey: true, shiftKey: true, code: "KeyC" })).toBeNull();
    expect(hotkeyFor({ ...mods, altKey: true, metaKey: true, code: "KeyC" })).toBeNull();
    expect(hotkeyFor({ ...mods, code: "KeyC" })).toBeNull();
    expect(hotkeyFor({ ...mods, ctrlKey: true, code: "KeyC" })).toBeNull();
    expect(hotkeyFor({ ...mods, altKey: true, code: "KeyI" })).toBeNull();
  });
});

describe("useWorkspaceHotkeys", () => {
  beforeEach(() => toggle.mockClear());

  it("S1/S5: Alt+C opens calendar even when Option types ç", async () => {
    await mount();
    const e = press({ key: "ç", code: "KeyC", altKey: true });
    expect(toggle).toHaveBeenCalledWith("calendar", null);
    expect(e.defaultPrevented).toBe(true);
  });

  it("at #/dashboard (home's own URL) Alt+C toggles the calendar in place, like at /", async () => {
    await mount("/dashboard");
    const e = press({ key: "ç", code: "KeyC", altKey: true });
    expect(toggle).toHaveBeenCalledWith("calendar", null);
    expect(e.defaultPrevented).toBe(true);
  });

  it("S1: passes the tile element so the zoom starts there (when visible)", async () => {
    await mount();
    press({ key: "t", code: "KeyT", altKey: true });
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(toggle.mock.calls[0][0]).toBe("tasks");
  });

  it("S3: works from the composer and is prevented so nothing is typed", async () => {
    const { container } = await mount();
    const e = press({ key: "†", code: "KeyT", altKey: true }, container.querySelector("textarea")!);
    expect(toggle).toHaveBeenCalledWith("tasks", expect.anything());
    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves other text fields alone: Option+C types ç in a plain input", async () => {
    const { container } = await mount();
    const e = press({ key: "ç", code: "KeyC", altKey: true }, container.querySelector('[data-testid="search"]')!);
    expect(toggle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("S4: Alt+V dispatches the dictation toggle", async () => {
    await mount();
    const spy = vi.fn();
    window.addEventListener(DICTATION_TOGGLE_EVENT, spy);
    press({ key: "√", code: "KeyV", altKey: true });
    window.removeEventListener(DICTATION_TOGGLE_EVENT, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("does nothing with other modifiers and leaves defaults alone", async () => {
    await mount();
    const e = press({ code: "KeyC", altKey: true, ctrlKey: true });
    press({ code: "KeyC", altKey: true, shiftKey: true });
    press({ code: "KeyC" });
    expect(toggle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("S-neg: does nothing while a modal dialog is open", async () => {
    await mount();
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    document.body.append(dlg);
    const e = press({ code: "KeyC", altKey: true });
    dlg.remove();
    expect(toggle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("S-neg: off Home it navigates to the dashboard URL instead of toggling", async () => {
    await mount("/contacts");
    const e = press({ code: "KeyC", altKey: true });
    expect(toggle).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
    await expect
      .poll(() => document.querySelector("[data-loc]")?.getAttribute("data-loc"))
      .toBe("/dashboard?workspace=calendar");
  });
});
