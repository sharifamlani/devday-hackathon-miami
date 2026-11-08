import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeWorkspace,
  crmSubview,
  openWorkspace,
  parseWorkspace,
  resetWorkspaceStateForTest,
  serializeWorkspace,
  toggleWorkspace,
} from "./workspaceView";

vi.mock("react-dom", async (orig) => ({
  ...(await orig<typeof import("react-dom")>()),
  flushSync: (fn: () => void) => fn(),
}));

const vtMock = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("./zoomTransition", () => ({
  waitForCommit: () => Promise.resolve(),
  runZoomTransition: (o: { kind: string; update: () => void }) => {
    vtMock.calls.push(o.kind);
    o.update();
    return { mechanism: "view-transition" };
  },
}));

describe("parse/serialize", () => {
  it("parses views and aliases donors to crm", () => {
    expect(parseWorkspace("?workspace=calendar")).toBe("calendar");
    expect(parseWorkspace("?workspace=donors")).toBe("crm");
    expect(parseWorkspace("?workspace=crm")).toBe("crm");
    expect(parseWorkspace("?workspace=organizations")).toBe("crm");
    expect(crmSubview("?workspace=organizations")).toBe("organizations");
    expect(crmSubview("?workspace=crm")).toBe("donors");
    expect(parseWorkspace("?workspace=bogus")).toBeNull();
    expect(parseWorkspace("")).toBeNull();
  });
  it("serializes, preserving other params", () => {
    expect(serializeWorkspace("", "tasks")).toBe("?workspace=tasks");
    expect(serializeWorkspace("?a=1&workspace=crm", null)).toBe("?a=1");
    expect(serializeWorkspace("?workspace=crm", null)).toBe("");
  });
});

describe("actions", () => {
  const nav = {
    push: vi.fn(),
    replace: vi.fn(),
    closeReplace: vi.fn(),
    back: vi.fn(),
  };
  beforeEach(() => {
    vtMock.calls.length = 0;
    Object.values(nav).forEach((f) => f.mockClear());
    resetWorkspaceStateForTest(nav, null, false);
  });
  it("open pushes, switch replaces, close replaces when not zoomed", () => {
    expect(openWorkspace("calendar")).toBe(true);
    expect(nav.push).toHaveBeenCalledWith("calendar");
    resetWorkspaceStateForTest(nav, "calendar", true);
    openWorkspace("crm");
    expect(nav.replace).toHaveBeenCalledWith("crm");
    resetWorkspaceStateForTest(nav, "crm", false);
    closeWorkspace();
    expect(nav.closeReplace).toHaveBeenCalled();
    expect(vtMock.calls).toEqual(["open", "switch", "close"]);
  });
  it("close uses history back when opened in-app", () => {
    resetWorkspaceStateForTest(nav, "tasks", true);
    closeWorkspace();
    expect(nav.back).toHaveBeenCalled();
  });
  it("same-view open is a no-op; toggle flips on pending target", () => {
    resetWorkspaceStateForTest(nav, "tasks", true);
    expect(openWorkspace("tasks")).toBe(false);
    resetWorkspaceStateForTest(nav, null, false);
    toggleWorkspace("impact");
    expect(vtMock.calls).toEqual(["open"]);
  });
});
