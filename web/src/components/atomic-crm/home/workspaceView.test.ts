import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeWorkspace,
  commitWorkspaceForTest,
  crmSubview,
  handleWorkspaceEscape,
  type WorkspaceView,
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
  getLastSource: () => null,
  notifyCommitted: () => {},
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
  it("close always replaces, even when opened in-app", () => {
    resetWorkspaceStateForTest(nav, "tasks", true);
    closeWorkspace();
    expect(nav.closeReplace).toHaveBeenCalled();
  });
  it("same-view open is a no-op; toggle flips on pending target", () => {
    resetWorkspaceStateForTest(nav, "tasks", true);
    expect(openWorkspace("tasks")).toBe(false);
    resetWorkspaceStateForTest(nav, null, false);
    toggleWorkspace("impact");
    expect(vtMock.calls).toEqual(["open"]);
  });
});

describe("rapid toggles never strand the panel", () => {
  /** A router whose commit lands later than the navigation, like react-router's transition. */
  function asyncRouter() {
    let url: WorkspaceView | null = null;
    const pending: Array<() => void> = [];
    const queue = () => pending.push(() => commitWorkspaceForTest(url));
    const nav = {
      push: (v: WorkspaceView) => {
        url = v;
        queue();
      },
      replace: (v: WorkspaceView) => {
        url = v;
        queue();
      },
      closeReplace: () => {
        url = null;
        queue();
      },
    };
    const flush = async () => {
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
        while (pending.length) {
          pending.shift()!();
          await Promise.resolve();
          await Promise.resolve();
        }
      }
    };
    return { nav, flush, url: () => url };
  }

  it("double toggle 10x without awaiting ends closed every time", async () => {
    const r = asyncRouter();
    resetWorkspaceStateForTest(r.nav, null, false);
    for (let i = 0; i < 10; i++) {
      toggleWorkspace("tasks");
      toggleWorkspace("tasks");
      await r.flush();
      expect(r.url()).toBeNull();
    }
    // never stuck: a later open still works and Esc/close can close it
    expect(openWorkspace("crm")).toBe(true);
    await r.flush();
    expect(r.url()).toBe("crm");
    expect(closeWorkspace()).toBe(true);
    await r.flush();
    expect(r.url()).toBeNull();
  });
  it("double toggle 10x awaiting each commit also ends closed", async () => {
    const r = asyncRouter();
    resetWorkspaceStateForTest(r.nav, null, false);
    for (let i = 0; i < 10; i++) {
      toggleWorkspace("tasks");
      await r.flush();
      expect(r.url()).toBe("tasks");
      toggleWorkspace("tasks");
      await r.flush();
      expect(r.url()).toBeNull();
    }
  });
  it("odd and mixed bursts settle on the last request", async () => {
    const r = asyncRouter();
    resetWorkspaceStateForTest(r.nav, null, false);
    for (let i = 0; i < 10; i++) {
      toggleWorkspace("tasks");
      toggleWorkspace("tasks");
      toggleWorkspace("calendar");
      await r.flush();
      expect(r.url()).toBe("calendar");
      closeWorkspace();
      await r.flush();
      expect(r.url()).toBeNull();
    }
  });
  it("Esc right after an open (before it commits) closes", async () => {
    const r = asyncRouter();
    resetWorkspaceStateForTest(r.nav, null, false);
    openWorkspace("impact");
    handleWorkspaceEscape({ key: "Escape", defaultPrevented: false });
    await r.flush();
    expect(r.url()).toBeNull();
  });
});
