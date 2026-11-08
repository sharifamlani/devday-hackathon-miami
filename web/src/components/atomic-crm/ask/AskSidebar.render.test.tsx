import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";

import { AskPanel } from "./AskPanel";

// The donor drawer reads through react-admin's data hooks, which need the
// full <Admin> context; this test is about the sidebar shell, not the drawer.
vi.mock("../contacts/DonorDrawer", () => ({ DonorDrawer: () => null }));

// The FakeRest auth provider (imported via providers/local) writes to
// localStorage on import; Node has none, the browser project does.
vi.hoisted(() => {
  if (typeof globalThis.localStorage === "undefined") {
    const data = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
        clear: () => data.clear(),
      },
    });
  }
});
import { AskSessionProvider } from "./AskSession";
import {
  AskSidebar,
  AskSidebarTrigger,
  LiveTranscriptTrigger,
} from "./AskSidebar";
import { AskSessionContext, type AskSession } from "./askSessionContext";

// Render-only smoke test (no DOM needed): the shell, both Ask variants and
// the trigger mount without throwing and expose their accessible names.
const wrap = (node: ReactNode) =>
  renderToString(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <AskSessionProvider>{node}</AskSessionProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

// The data hooks need the ra-core admin context; this test is about the shell.
vi.mock("../providers/local/hooks", () => ({
  useAsk: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useDonor: () => ({ data: undefined, isPending: false, error: null }),
}));

describe("Ask sidebar render", () => {
  it("renders the top-bar trigger with its state", () => {
    const html = wrap(<AskSidebarTrigger />);
    expect(html).toContain('aria-label="Open Ask sidebar"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="ask-sidebar"');
  });

  it("renders nothing for the trigger outside a session", () => {
    expect(renderToString(<AskSidebarTrigger />)).toBe("");
  });

  it("renders the docked panel and the overlay dialog", () => {
    const docked = wrap(<AskSidebar docked />);
    expect(docked).toContain('role="complementary"');
    expect(docked).toContain("Ask Donor Desk");
    expect(docked).toContain('aria-label="Expand to full page"');
    expect(docked).toContain('aria-pressed="false"');
    expect(docked).toContain('aria-label="Close Ask sidebar"');
    // No ChatPanel module in this repo yet: no tabs.
    expect(docked).not.toContain('role="tablist"');

    const overlay = wrap(<AskSidebar docked={false} />);
    expect(overlay).toContain('role="dialog"');
    expect(overlay).toContain('aria-modal="true"');
  });

  it("renders the live-transcript trigger", () => {
    const html = wrap(<LiveTranscriptTrigger />);
    expect(html).toContain('aria-label="Live transcript"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="ask-sidebar"');
    expect(renderToString(<LiveTranscriptTrigger />)).toBe("");
  });

  it("renders the voice mode header, expanded", () => {
    const session = {
      sidebarOpen: true,
      openedByUser: false,
      paneMode: "voice",
      paneExpanded: true,
      setPaneExpanded: vi.fn(),
      closeSidebar: vi.fn(),
    } as unknown as AskSession;
    const html = renderToString(
      <MemoryRouter>
        <AskSessionContext.Provider value={session}>
          <AskSidebar docked />
          <LiveTranscriptTrigger />
        </AskSessionContext.Provider>
      </MemoryRouter>,
    );
    expect(html).toContain("Live transcript");
    expect(html).not.toContain("Ask Donor Desk");
    expect(html).toContain('aria-label="Shrink to sidebar"');
    expect(html).toContain('aria-label="Close live transcript"');
    expect(html).toContain('aria-expanded="true"');
  });

  it("shows a Chat tab when a chat slot is passed", () => {
    const html = wrap(<AskSidebar docked chatSlot={<p>Chat goes here</p>} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain(">Chat<");
    expect(html).toContain('aria-selected="true"');
  });

  it("renders the full page variant", () => {
    const html = wrap(<AskPanel variant="page" />);
    expect(html).toContain("What would you like to know about your donors?");
    expect(html).toContain("Example questions");
  });
});
