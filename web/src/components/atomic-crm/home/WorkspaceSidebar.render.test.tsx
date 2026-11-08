import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi, describe, it, expect } from "vitest";

vi.hoisted(() => {
  const data = new Map<string, string>();
  if (typeof globalThis.localStorage === "undefined")
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value),
        removeItem: (key: string) => data.delete(key),
        clear: () => data.clear(),
      },
    });
});
// The API contract suites exercise data; this suite exercises shell access even when data is empty.
vi.mock("../providers/local/hooks", () => ({
  useAsk: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
  useTargets: () => ({ data: undefined, isPending: false, error: null }),
  useDonors: () => ({ data: [], isPending: false, error: null }),
  useCampaigns: () => ({ data: [], isPending: false, error: null }),
}));
vi.mock("../providers/local/homeFeed", () => {
  const query = (data: unknown) => ({ data, isPending: false, error: null });
  return {
    // homeData.ts imports attentionTag; the attention list here is empty, so a minimal stand-in is enough.
    attentionTag: (badge: string) => ({ label: badge, tone: "quiet" }),
    useHomeData: () => ({
      summary: query(null),
      attention: query([]),
      tasks: query([]),
      calendar: query([]),
      artifacts: query([]),
      sources: {},
    }),
  };
});
vi.mock("../providers/local/tasks", () => ({
  useCompleteTask: () => ({ mutate: vi.fn() }),
}));
// Keep this test about navigation access; dialogs and account identity have their own suites.
vi.mock("@/components/admin/user-menu", () => ({
  UserMenu: () => <button aria-label="Account menu" />,
}));
vi.mock("../contacts/DonorDrawer", () => ({ DonorDrawer: () => null }));
vi.mock("../import/ImportDonorsDialog", () => ({
  ImportDonorsDialog: () => null,
}));
vi.mock("./FindDonorDialog", () => ({ FindDonorDialog: () => null }));
vi.mock("./TaskDayPanel", () => ({ TaskDayPanel: () => null }));
import { AskSessionProvider } from "../ask/AskSession";
import { OverviewContext } from "./overviewContext";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const renderSidebar = (open: boolean) =>
  renderToString(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AskSessionProvider>
          <OverviewContext.Provider value={{ open, toggle: () => {} }}>
            <WorkspaceSidebar />
          </OverviewContext.Provider>
        </AskSessionProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe("Workspace access", () => {
  it("keeps every workspace tool available when the full sidebar is collapsed", () => {
    const html = renderSidebar(false);
    for (const label of [
      "Overview",
      "Calendar",
      "Tasks",
      "CRM",
      "Projects",
      "Files &amp; drafts",
    ])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain('aria-label="Expand workspace sidebar"');
    expect(html).not.toContain('class="desk-sidebar-content"');
    expect(html).toContain('aria-label="Home chat"');
  });
  it("includes projects and CRM navigation in the expanded sidebar", () => {
    const html = renderSidebar(true);
    expect(html).toContain('aria-label="Collapse workspace sidebar"');
    expect(html).toContain('id="home-workspace-overview"');
    expect(html).toContain('href="/?workspace=donors"');
    expect(html).toContain('href="/?workspace=organizations"');
    expect(html).toContain('href="/?workspace=calendar"');
    expect(html).toContain("Filter projects");
  });
});
