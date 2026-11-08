import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CoreAdminContext } from "ra-core";
import { useLocation } from "react-router";

import type * as Config from "../../providers/local/config";
import type { CrmEvent } from "../../providers/local/crmTypes";
import { runMock, type Method } from "../../providers/local/endpoint";
import "../../providers/local/mocks";
import { resetMockTasks } from "../../providers/local/mocks";
import { CalendarV3 } from "./CalendarV3";

vi.mock("../../providers/local/config", async (importOriginal) => ({
  ...(await importOriginal<typeof Config>()),
  DATA_MODE: "local",
}));

const seen: { method: string; path: string; body: unknown }[] = [];
const GALA: CrmEvent = {
  id: 9, title: "Donor Gala", starts_at: "2026-11-13T18:00:00", ends_at: null, place: null, audience: null,
  status: "upcoming", kind: null, rationale: null, batch_id: null, source: "website", source_url: null,
  audience_count: 25, drafts_ready: null,
};

beforeEach(() => {
  seen.length = 0;
  resetMockTasks();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET") as Method;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({ method, path: `${url.pathname}${url.search}`, body });
    return new Response(JSON.stringify(runMock(method, `${url.pathname}${url.search}`, body)), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;

const mount = (events: CrmEvent[] = [GALA]) => {
  const dataProvider = {
    getEvents: async () => events,
    getTargets: async () => ({}),
    planEventOutreach: vi.fn(async () => ({ batch_id: "42" })),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoreAdminContext dataProvider={dataProvider as never}>
        <CalendarV3 today="2026-11-08" />
        <Where />
      </CoreAdminContext>
    </QueryClientProvider>,
  );
};

describe("CalendarV3 (live, against the contract mocks)", () => {
  it("adds an event through the form, shows it, validates, and a suggestion posts a TASK", async () => {
    const ui = await mount();
    await expect.element(ui.getByText(/early giving opens/).first()).toBeVisible();
    expect(seen.some((s) => s.path.includes("kind=event"))).toBe(true);

    await ui.getByRole("button", { name: "Add event" }).click();
    await ui.getByRole("button", { name: "Save event" }).click();
    await expect.element(ui.getByText("Give the event a title.")).toBeVisible(); // field error, nothing sent
    expect(seen.some((s) => s.method === "POST")).toBe(false);

    await ui.getByLabelText("Title *").fill("Board coffee");
    await ui.getByLabelText("Date *").fill("2026-11-12");
    await ui.getByLabelText("All day").click();
    await ui.getByLabelText("Start").fill("08:00");
    await ui.getByLabelText("Place").fill("Coral Room");
    await ui.getByRole("button", { name: "Save event" }).click();
    await expect.element(ui.getByText("Board coffee").first()).toBeVisible();
    await expect.element(ui.getByText(/Coral Room · added by you/)).toBeVisible();
    expect(seen.find((s) => s.method === "POST" && s.path === "/events")?.body).toMatchObject({
      title: "Board coffee", starts_at: "2026-11-12T08:00", place: "Coral Room",
    });

    await ui.getByRole("button", { name: "Add to to-do" }).click();
    await expect.element(ui.getByText("Added to to-do ✓")).toBeVisible();
    expect(seen.find((s) => s.path === "/tasks")).toMatchObject({
      method: "POST",
      body: { title: "Invite 25 people to Donor Gala", kind: "email", due: "2026-11-12" },
    });
    expect(seen.some((s) => s.method === "POST" && s.path === "/events" && JSON.stringify(s.body).includes("Invite"))).toBe(false);
  });

  it("details offer Review invites, then Open batch navigates to /campaigns/<id>", async () => {
    const ui = await mount([{ ...GALA, id: 3, drafts_ready: 4 }]);
    await ui.getByRole("button", { name: /Details for/ }).click();
    await ui.getByRole("button", { name: "Review invites" }).click();
    await ui.getByRole("button", { name: "Open batch" }).click();
    await expect.element(ui.getByTestId("where")).toHaveTextContent("/campaigns/42");
  });
});
