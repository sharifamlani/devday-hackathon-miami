import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CoreAdminContext } from "ra-core";

import type * as Config from "../providers/local/config";
import type { CrmEvent } from "../providers/local/crmTypes";
import { CalendarPage } from "./CalendarPage";

// "Refresh now" only shows against the live service.
vi.mock("../providers/local/config", async (importOriginal) => ({
  ...(await importOriginal<typeof Config>()),
  DATA_MODE: "local",
}));

const EARLY: CrmEvent = {
  id: 1,
  title: "Give Miami Day — Early Giving opens",
  starts_at: "2026-11-14T09:00:00",
  ends_at: null,
  place: "Online",
  audience: "Givers",
  status: "upcoming",
  kind: null,
  rationale: null,
  batch_id: null,
  source: "miamifoundation.org",
  source_url: "https://miamifoundation.org/events/1",
  audience_count: 12,
  drafts_ready: 9,
};
const DAY: CrmEvent = {
  ...EARLY,
  id: 2,
  title: "Give Miami Day",
  starts_at: "2026-11-19T00:00:00",
  source_url: "https://miamifoundation.org/events/2",
};

const mount = (refreshContext: () => Promise<unknown>) => {
  let events = [EARLY];
  const dataProvider = {
    getEvents: vi.fn(async () => events),
    getContextStatus: async () => ({ refreshing: false, label: "Context updated today 5:30 AM" }),
    refreshContext: vi.fn(async () => {
      const status = await refreshContext();
      events = [EARLY, DAY]; // the pass found a new event
      return status;
    }),
  };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = render(
    <QueryClientProvider client={queryClient}>
      <CoreAdminContext dataProvider={dataProvider as never}>
        <CalendarPage />
      </CoreAdminContext>
    </QueryClientProvider>,
  );
  return { screen, dataProvider };
};

describe("CalendarPage Refresh now", () => {
  it("shows Refreshing… while the pass runs, then the new event without a reload", async () => {
    let finish: (v: unknown) => void = () => {};
    const { screen, dataProvider } = mount(() => new Promise((resolve) => (finish = resolve)));
    const ui = await screen;

    await expect.element(ui.getByText("Give Miami Day — Early Giving opens").first()).toBeVisible();
    await ui.getByRole("button", { name: "Refresh now" }).click();
    await expect.element(ui.getByRole("button", { name: "Refreshing…" })).toBeDisabled();

    const loads = dataProvider.getEvents.mock.calls.length;
    finish({ refreshing: false, label: "Context updated today 5:45 AM" });
    await expect.element(ui.getByRole("button", { name: "Refresh now" })).toBeEnabled();
    await expect.element(ui.getByText("Give Miami Day", { exact: true }).first()).toBeVisible();
    expect(dataProvider.getEvents.mock.calls.length).toBeGreaterThan(loads);
  });

  it("starts one pass on a fast double-click", async () => {
    let finish: (v: unknown) => void = () => {};
    const { screen, dataProvider } = mount(() => new Promise((resolve) => (finish = resolve)));
    const ui = await screen;

    await expect.element(ui.getByText("Give Miami Day — Early Giving opens").first()).toBeVisible();
    const button = ui.getByRole("button", { name: "Refresh now" }).element() as HTMLButtonElement;
    button.click();
    button.click(); // same tick: React hasn't disabled it yet
    await expect.element(ui.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    expect(dataProvider.refreshContext).toHaveBeenCalledTimes(1);
    finish({ refreshing: false, label: "Context updated today 5:45 AM" });
    await expect.element(ui.getByRole("button", { name: "Refresh now" })).toBeEnabled();
  });

  it("says which sources a finished pass couldn't read, instead of plain success", async () => {
    const { screen } = mount(async () => ({ refreshing: false, label: "x", unread_sources: ["website", "news"] }));
    const ui = await screen;

    await ui.getByRole("button", { name: "Refresh now" }).click();
    await expect
      .element(ui.getByText("Some sources couldn’t be read: website, news."))
      .toBeVisible();
  });

  it("shows a refused pass's reason from the answer (no thrown error, so no console error)", async () => {
    const { screen } = mount(async () => ({
      refreshing: false,
      label: "x",
      refresh_error: "The refresh failed: no website saved yet: run onboarding first.",
    }));
    const ui = await screen;

    await ui.getByRole("button", { name: "Refresh now" }).click();
    await expect
      .element(ui.getByRole("alert"))
      .toHaveTextContent("The refresh failed: no website saved yet: run onboarding first.");
    await expect.element(ui.getByRole("button", { name: "Refresh now" })).toBeEnabled();
  });

  it("says why a failed pass failed, and keeps the events on screen", async () => {
    const { screen } = mount(() => Promise.reject(new Error("The refresh failed: site unreachable.")));
    const ui = await screen;

    await expect.element(ui.getByText("Give Miami Day — Early Giving opens").first()).toBeVisible();
    await ui.getByRole("button", { name: "Refresh now" }).click();
    await expect.element(ui.getByRole("alert")).toHaveTextContent("The refresh failed: site unreachable.");
    await expect.element(ui.getByText("Give Miami Day — Early Giving opens").first()).toBeVisible();
  });
});
