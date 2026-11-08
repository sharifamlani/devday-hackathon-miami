import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CoreAdminContext } from "ra-core";

import type { CrmEvent, CrmEventDetail } from "../providers/local/crmTypes";
import { CalendarPage } from "./CalendarPage";

// Fixtures: the Miami Foundation's three Give Miami events (dates per its site).
const EVENTS: CrmEvent[] = [
  ev(1, "Early giving opens", "2026-11-14T09:00:00", "Online", 12, 9),
  ev(
    2,
    "Give Miami 5K",
    "2026-11-15T07:30:00",
    "Maurice A. Ferré Park",
    30,
    20,
  ),
  ev(3, "Give Miami Day", "2026-11-19T00:00:00", "Everywhere in Miami", 80, 50),
];

function ev(
  id: number,
  title: string,
  starts_at: string,
  place: string,
  audience_count: number,
  drafts_ready: number,
): CrmEvent {
  return {
    id,
    title,
    starts_at,
    ends_at: null,
    place,
    audience: "Givers, Neighbors",
    status: "upcoming",
    kind: null,
    rationale: null,
    batch_id: null,
    source: "miamifoundation.org",
    source_url: `https://miamifoundation.org/events/${id}`,
    audience_count,
    drafts_ready,
  };
}

const detail = (e: CrmEvent): CrmEventDetail => ({
  ...e,
  recipients: [
    { person_id: 1, name: "Ana", tab: "giver", reason: "gave in 2025" },
    { person_id: 2, name: "Ben", tab: "giver", reason: null },
    { person_id: 3, name: "Cy", tab: "neighbor", reason: null },
  ],
  drafts: [
    {
      id: 1,
      person_id: 1,
      name: "Ana",
      tab: "giver",
      channel: "email",
      to: null,
      subject: `Join us: ${e.title}`,
      body: "Hi Ana, we would love to see you there.",
      facts_used: [],
      needs_individual_approval: false,
      approval_reason: null,
      flags: [],
      status: "draft",
    },
  ],
});

const mount = (events: CrmEvent[], planEventOutreach = vi.fn()) => {
  const dataProvider = {
    getEvents: async () => events,
    getEvent: async (id: number) => detail(events.find((e) => e.id === id)!),
    getContextStatus: async () => ({
      last_refreshed_at: null,
      new_events: null,
      new_facts: null,
      change_summary: null,
      refreshing: false,
      label: "Context updated today 7:00 AM",
    }),
    planEventOutreach,
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoreAdminContext dataProvider={dataProvider as never}>
        <CalendarPage />
      </CoreAdminContext>
    </QueryClientProvider>,
  );
};

describe("CalendarPage", () => {
  it("lists the three Foundation events with counts, drafts and a source link", async () => {
    const screen = await mount(EVENTS);

    await expect
      .element(screen.getByRole("button", { name: "Give Miami 5K" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("Maurice A. Ferré Park"))
      .toBeVisible();
    await expect.element(screen.getByText("20 drafts ready")).toBeVisible();
    await expect
      .element(screen.getByText("Context updated today 7:00 AM"))
      .toBeVisible();
    expect(screen.getByRole("link", { name: "Source" }).all()).toHaveLength(3);
  });

  it("filters by family chip; events without event_kind default to Events", async () => {
    const withKind = [
      { ...EVENTS[0], event_kind: "giving_day" },
      EVENTS[1],
      { ...EVENTS[2], event_kind: "thank_you_window" },
    ];
    const screen = await mount(withKind as CrmEvent[]);
    await expect
      .element(screen.getByRole("button", { name: "Give Miami 5K" }))
      .toBeVisible();

    await screen
      .getByRole("button", { name: "Fundraising", exact: true })
      .click();
    expect(
      screen.getByRole("button", { name: "Early giving opens" }).all(),
    ).toHaveLength(0);
    await expect
      .element(screen.getByRole("button", { name: "Give Miami 5K" }))
      .toBeVisible();
  });

  it("shows the empty state when there are no events", async () => {
    const screen = await mount([]);
    await expect
      .element(
        screen.getByText("No upcoming events found yet. Run context refresh."),
      )
      .toBeVisible();
  });

  it("Review calls planEventOutreach and shows the batch id", async () => {
    const plan = vi.fn().mockResolvedValue({ batch_id: "batch-42" });
    const screen = await mount(EVENTS, plan);

    await screen.getByRole("button", { name: "Give Miami 5K" }).click();
    await expect
      .element(screen.getByText("Sample invite (1 drafts ready)"))
      .toBeVisible();
    await screen.getByRole("button", { name: "Review" }).click();

    await expect.element(screen.getByText("batch-42")).toBeVisible();
    expect(plan).toHaveBeenCalledWith(2);
  });
});
