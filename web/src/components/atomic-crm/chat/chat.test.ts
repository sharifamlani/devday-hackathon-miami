import type { ThreadMessage } from "@assistant-ui/react";

import type { ChatMessage, SendBatch, SendItem } from "../providers/local/crmTypes";
import {
  approvedCount,
  canSend,
  channelCounts,
  defaultSelection,
  perItemFor,
  toggleItem,
} from "./batchRules";
import { makeChatAdapter, metaOf, toContent, toHistory } from "./chatAdapter";
import { greetingText, quickActions } from "./greeting";
import {
  STORAGE_KEY,
  allReceipts,
  createThread,
  getStore,
  historyAdapterFor,
  listThreads,
  resetStoreCache,
  saveReceipt,
} from "./threadStore";

const item = (id: number, over: Partial<SendItem> = {}): SendItem => ({
  id,
  person_id: id,
  name: `Person ${id}`,
  tab: "giver",
  channel: "email",
  to: `p${id}@example.org`,
  subject: "Hello",
  body: "Body",
  facts_used: [],
  needs_individual_approval: false,
  approval_reason: null,
  flags: [],
  status: "draft",
  ...over,
});

export const batch: SendBatch = {
  id: "b1",
  title: "Give Miami Day reminders",
  items: [
    item(1),
    item(2, { channel: "text" }),
    item(3, { needs_individual_approval: true, approval_reason: "★ Shack Society" }),
    item(4, { flags: ["mentions a gift amount"] }),
    item(5, { status: "sent" }),
  ],
  bulk_approvable: 2,
  needs_individual_approval: 1,
  flagged: 1,
};

describe("batch rules", () => {
  it("ticks only bulk-approvable items by default", () => {
    expect([...defaultSelection(batch)].sort()).toEqual([1, 2]);
  });

  it("never lets a flagged item be ticked", () => {
    const next = toggleItem(batch, defaultSelection(batch), 4);
    expect(next.has(4)).toBe(false);
  });

  it("sends org/★ items only when ticked one by one", () => {
    let selected = defaultSelection(batch);
    expect(perItemFor(batch, selected)).toEqual([
      { id: 1, approve: true },
      { id: 2, approve: true },
      { id: 3, approve: false },
    ]);
    selected = toggleItem(batch, selected, 3);
    expect(perItemFor(batch, selected)).toContainEqual({ id: 3, approve: true });
    expect(approvedCount(batch, selected)).toBe(3);
  });

  it("leaves flagged and already-sent items out of the decisions", () => {
    const ids = perItemFor(batch, new Set([1, 2, 3, 4, 5])).map((d) => d.id);
    expect(ids).toEqual([1, 2, 3]);
  });

  it("requires a named approver and at least one item", () => {
    expect(canSend(batch, defaultSelection(batch), "  ")).toBe(false);
    expect(canSend(batch, new Set(), "Ana")).toBe(false);
    expect(canSend(batch, defaultSelection(batch), "Ana")).toBe(true);
  });

  it("counts channels over open items", () => {
    expect(channelCounts(batch)).toEqual({ email: 3, text: 1 });
  });
});

describe("greeting", () => {
  it("uses the API's day count and the event count", () => {
    expect(
      greetingText({ screen: "home", giveMiamiDayDaysAway: 11, upcomingEvents: 3, selectionCount: 0 }),
    ).toBe("Give Miami Day is in 11 days. Plan outreach for 3 upcoming events?");
  });

  it("never invents a day count", () => {
    expect(
      greetingText({ screen: "home", giveMiamiDayDaysAway: null, upcomingEvents: null, selectionCount: 0 }),
    ).toBe("Hi! What should we work on?");
  });

  it("offers per-screen chips, with no donation ask on Community", () => {
    const community = quickActions({ screen: "community", giveMiamiDayDaysAway: 11, upcomingEvents: 3, selectionCount: 0 });
    expect(community.join(" ")).not.toMatch(/\b(give|donat|support us)/i);
    const giver = quickActions({ screen: "giver", giveMiamiDayDaysAway: 11, upcomingEvents: 3, selectionCount: 2 });
    expect(giver[0]).toBe("Draft a note to the 2 selected persons");
  });
});

describe("chat adapter", () => {
  const reply: ChatMessage = {
    role: "assistant",
    text: "Here are 2 people to call.",
    steps: [{ tool: "find_people", label: "Found people", summary: "2 lapsing", status: "done" }],
    batch,
    demo: true,
  };

  it("renders each step as a tool call, then the text", () => {
    const parts = toContent(reply);
    expect(parts[0]).toMatchObject({ type: "tool-call", toolName: "find_people", result: { summary: "2 lapsing" } });
    expect(parts[1]).toEqual({ type: "text", text: "Here are 2 people to call." });
  });

  it("posts the history, the text and the screen context with selection", async () => {
    const chat = vi.fn().mockResolvedValue(reply);
    const adapter = makeChatAdapter(chat, () => ({ screen: "giver", selection: [7] }));
    const msg = (role: "user" | "assistant", text: string) =>
      ({ id: text, role, content: [{ type: "text", text }], createdAt: new Date() }) as unknown as ThreadMessage;
    const result = (await adapter.run({
      messages: [msg("user", "hi"), msg("assistant", "hello"), msg("user", "who lapsed?")],
    } as never)) as { metadata: { custom: Record<string, unknown> } };
    expect(chat).toHaveBeenCalledWith(
      [
        { role: "user", text: "hi", steps: [], batch: null, demo: false },
        { role: "assistant", text: "hello", steps: [], batch: null, demo: false },
      ],
      "who lapsed?",
      { screen: "giver", selection: [7] },
    );
    expect(metaOf(result.metadata.custom)).toEqual({ batch, demo: true, error: null });
  });

  it("turns a 503 into an inline error instead of throwing", async () => {
    const adapter = makeChatAdapter(
      vi.fn().mockRejectedValue(new Error("The chat agent isn't available yet: 503")),
      () => ({ screen: "home" }),
    );
    const result = (await adapter.run({ messages: [] } as never)) as { metadata: { custom: Record<string, unknown> } };
    expect(metaOf(result.metadata.custom).error).toBe("The chat agent isn't available yet: 503");
  });

  it("skips empty turns in the history", () => {
    const empty = { id: "x", role: "assistant", content: [], createdAt: new Date() } as unknown as ThreadMessage;
    expect(toHistory([empty])).toEqual([]);
  });
});

describe("thread history (localStorage)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    resetStoreCache();
  });

  it("persists messages per thread and reloads them with Dates", async () => {
    const id = createThread("giver");
    const adapter = historyAdapterFor(id);
    const message = {
      id: "m1",
      role: "user",
      content: [{ type: "text", text: "Who should I call before Give Miami Day?" }],
      createdAt: new Date("2026-11-07T12:00:00Z"),
    } as unknown as ThreadMessage;
    await adapter.append({ message, parentId: null });

    resetStoreCache(); // as after a reload
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(raw.threads[0].id).toBe(id);
    const loaded = await historyAdapterFor(id).load();
    expect(loaded.headId).toBe("m1");
    expect(loaded.messages[0].message.createdAt).toBeInstanceOf(Date);
    expect(listThreads()[0]).toMatchObject({ id, screen: "giver", title: "Who should I call before Give Miami Day?" });
  });

  it("lists only threads with messages, newest first, and keeps receipts", async () => {
    const a = createThread("giver");
    createThread("community"); // empty: hidden
    await historyAdapterFor(a).append({
      message: { id: "m", role: "user", content: [{ type: "text", text: "hi" }], createdAt: new Date() } as unknown as ThreadMessage,
      parentId: null,
    });
    expect(listThreads().map((t) => t.id)).toEqual([a]);
    saveReceipt(a, {
      batchId: "b1", title: "t", outcome: "sent", sent: 2, skipped: 0, blocked: [],
      simulated: true, approvedBy: "Ana", at: new Date().toISOString(),
    });
    expect(allReceipts()[0]).toMatchObject({ batchId: "b1", sent: 2 });
    expect(getStore().activeId).not.toBe(a); // the newest created thread is active
  });
});
