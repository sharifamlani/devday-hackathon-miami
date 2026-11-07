import React from "react";
import { render } from "vitest-browser-react";
import { CoreAdminContext } from "ra-core";

import type { ChatMessage, SendResult } from "../providers/local/crmTypes";
import { ChatPanel } from "./ChatPanel";
import { batch } from "./fixtures";
import { STORAGE_KEY, resetStoreCache } from "./threadStore";

const reply: ChatMessage = {
  role: "assistant",
  text: "Two givers usually give on Give Miami Day. I drafted reminders.",
  steps: [
    { tool: "find_people", label: "Found people", summary: "2 lapsing givers", status: "done" },
    { tool: "draft_messages", label: "Drafted messages", summary: "4 drafts", status: "done" },
  ],
  batch,
  demo: true,
};

const makeProvider = () => {
  const approveSendBatch = vi.fn(
    async (): Promise<SendResult> => ({ sent: 3, skipped: 0, blocked: [], simulated: true }),
  );
  const chat = vi.fn(async () => reply);
  const provider = {
    getSourceLabel: async () => "Cached sample",
    getDonors: async () => [{ id: 1, give_miami_day_days_away: 11 }],
    getEvents: async () => [
      { id: 1, status: "upcoming" },
      { id: 2, status: "upcoming" },
      { id: 3, status: "upcoming" },
      { id: 4, status: "past" },
    ],
    getSendBatch: async () => batch,
    chat,
    approveSendBatch,
  };
  return { provider, chat, approveSendBatch };
};

const wrapperFor = (provider: object) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <CoreAdminContext dataProvider={provider as never}>{children}</CoreAdminContext>;
  };

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem("donor-desk.chat.open");
  resetStoreCache();
});

describe("ChatPanel", () => {
  it("greets proactively with API numbers and per-screen quick actions", async () => {
    const { provider } = makeProvider();
    const screen = await render(<ChatPanel context={{ screen: "home" }} selection={[]} />, {
      wrapper: wrapperFor(provider),
    });
    await expect
      .element(screen.getByText("Give Miami Day is in 11 days. Plan outreach for 3 upcoming events?"))
      .toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Plan outreach for 3 upcoming events" })).toBeVisible();
    await expect.element(screen.getByText("Cached sample")).toBeVisible();
  });

  it("shows tool steps and a batch card that enforces the approval rules, then a receipt", async () => {
    const { provider, chat, approveSendBatch } = makeProvider();
    const screen = await render(<ChatPanel context={{ screen: "giver" }} selection={[9]} />, {
      wrapper: wrapperFor(provider),
    });
    await screen.getByRole("button", { name: "Who should I call before Give Miami Day?" }).click();

    await expect.element(screen.getByText("2 lapsing givers")).toBeVisible();
    await expect.element(screen.getByText("4 drafts")).toBeVisible();
    expect(screen.container.querySelectorAll('[data-testid="tool-step"]')).toHaveLength(2);
    expect(chat).toHaveBeenCalledWith([], "Who should I call before Give Miami Day?", {
      screen: "giver",
      selection: [9],
    });
    await expect.element(screen.getByText("Demo run (cached sample)").first()).toBeVisible();

    // Flagged: disabled with its reason. ★: unticked, needs individual approval.
    await expect.element(screen.getByRole("checkbox", { name: "Person 4" })).toBeDisabled();
    await expect.element(screen.getByText(/Can't send: mentions a gift amount/)).toBeVisible();
    await expect.element(screen.getByRole("checkbox", { name: "Person 3" })).not.toBeChecked();
    await expect.element(screen.getByText(/Needs individual approval/)).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Send 2 approved" })).toBeEnabled();

    // No approver, no send.
    await screen.getByLabelText("Approved by (required)").fill("");
    await expect.element(screen.getByRole("button", { name: "Send 2 approved" })).toBeDisabled();
    await screen.getByLabelText("Approved by (required)").fill("Ana Ruiz");

    await screen.getByRole("checkbox", { name: "Person 3" }).click();
    await screen.getByRole("button", { name: "Send 3 approved" }).click();

    expect(approveSendBatch).toHaveBeenCalledWith("b1", "Ana Ruiz", [
      { id: 1, approve: true },
      { id: 2, approve: true },
      { id: 3, approve: true },
    ]);
    await expect.element(screen.getByText("Test mode: not actually sent")).toBeVisible();
    await expect.element(screen.getByText("3 messages approved by Ana Ruiz")).toBeVisible();
  });

  it("keeps past chats after a reload and reopens them from history", async () => {
    const { provider } = makeProvider();
    const first = await render(<ChatPanel context={{ screen: "giver" }} selection={[]} />, {
      wrapper: wrapperFor(provider),
    });
    await first.getByRole("button", { name: "Show givers who are lapsing" }).click();
    await expect.element(first.getByText("2 lapsing givers")).toBeVisible();
    resetStoreCache(); // a page reload: a fresh mount reading storage again
    await first.rerender(<ChatPanel key="reloaded" context={{ screen: "community" }} selection={[]} />);
    const second = first;
    // The last active thread is restored...
    await expect.element(second.getByText("2 lapsing givers")).toBeVisible();
    // ...and it is listed under past chats with its screen.
    await second.getByRole("button", { name: "New chat" }).click();
    await second.getByRole("button", { name: "Past chats" }).click();
    await expect.element(second.getByText("Show givers who are lapsing")).toBeVisible();
    await expect.element(second.getByText(/^Givers ·/)).toBeVisible();
    await second.getByText("Show givers who are lapsing").click();
    await expect.element(second.getByText("2 lapsing givers")).toBeVisible();
  });

  it("opens on the calendar's batch and reports when it's resolved", async () => {
    const { provider } = makeProvider();
    const onBatchResolved = vi.fn();
    const screen = await render(
      <ChatPanel
        context={{ screen: "calendar" }}
        selection={[]}
        openBatchId="b1"
        onBatchResolved={onBatchResolved}
        defaultOpen={false}
      />,
      { wrapper: wrapperFor(provider) },
    );
    await expect.element(screen.getByText("From the calendar")).toBeVisible();
    await screen.getByRole("button", { name: "Discard" }).click();
    expect(onBatchResolved).toHaveBeenCalledWith("b1");
    await expect.element(screen.getByText("Discarded: Give Miami Day reminders")).toBeVisible();
  });

  it("collapses to a rail and reopens", async () => {
    const { provider } = makeProvider();
    const screen = await render(<ChatPanel context={{ screen: "home" }} selection={[]} />, {
      wrapper: wrapperFor(provider),
    });
    await screen.getByRole("button", { name: "Close assistant" }).click();
    await expect.element(screen.getByRole("button", { name: "Open assistant" })).toBeVisible();
    await screen.getByRole("button", { name: "Open assistant" }).click();
    await expect.element(screen.getByRole("complementary", { name: "Assistant" })).toBeVisible();
  });
});
