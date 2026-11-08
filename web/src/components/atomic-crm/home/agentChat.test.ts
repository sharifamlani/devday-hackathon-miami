import { afterEach, describe, expect, it, vi } from "vitest";

import { WAITING_PREFIX, agentChatMessages, decide, resetAgentChat, scopesOf, sendToAgent, type AgentStep } from "./agentChat";

const reply = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));

const paused = {
  reply: `${WAITING_PREFIX}Send 1 email to Maria Delgado.`,
  steps: [],
  approvals: [{ call_id: "c1", tool: "send", args: { batch_id: 7 }, summary: "Send 1 email to Maria Delgado" }],
  run_id: "run-1",
};

describe("agent chat: deciding an approval card", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAgentChat();
  });

  it("drops the stale 'Waiting for you' line once the person decides", async () => {
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockImplementationOnce(() => reply(paused))
      .mockImplementationOnce(() => reply({ reply: "Sent (dry run).", steps: [], approvals: [], run_id: null }));

    await sendToAgent("thank Maria", () => {});
    expect(agentChatMessages()[1]).toMatchObject({ role: "assistant", text: paused.reply });

    await decide(1, { c1: true }, () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, card, after] = agentChatMessages();
    expect(card).toMatchObject({ text: "", decided: true, decisions: { c1: true } });
    expect(after).toMatchObject({ role: "assistant", text: "Sent (dry run)." });
  });

  it("keeps the agent's own words above the card", async () => {
    vi.spyOn(window, "fetch")
      .mockImplementationOnce(() => reply({ ...paused, reply: "I drafted a thank-you for Maria." }))
      .mockImplementationOnce(() => reply({ reply: "Done.", steps: [], approvals: [], run_id: null }));

    await sendToAgent("thank Maria", () => {});
    await decide(1, { c1: false }, () => {});
    expect(agentChatMessages()[1]).toMatchObject({ text: "I drafted a thank-you for Maria.", decided: true });
  });
});

describe("agent chat: two cards pending", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAgentChat();
  });

  const A = { call_id: "cA", tool: "send", args: { batch_id: 1 }, summary: "Send 1 email to Maria Delgado" };
  const B = { call_id: "cB", tool: "send", args: { batch_id: 2 }, summary: "Send check-in email to Marcus Bell" };
  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

  it.each([true, false])("deciding A (approve=%s) leaves B pending, and B still works (S1, S-neg)", async (approveA) => {
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockImplementationOnce(() =>
        reply({ reply: `${WAITING_PREFIX}A; B.`, steps: [], approvals: [A, B], run_id: "run-1" }),
      )
      // The service decides only A and pauses on B again under a new run id.
      .mockImplementationOnce(() =>
        reply({
          reply: `${WAITING_PREFIX}B.`,
          steps: [
            { tool: "send", args: A.args, summary: approveA ? "sent 1 (dry run)" : "declined", status: "done", undo_token: null, call_id: "cA" },
            { tool: "send", args: B.args, summary: "waiting for your approval to send", status: "awaiting_approval", undo_token: null, call_id: "cB" },
          ],
          approvals: [B],
          run_id: "run-2",
        }),
      )
      .mockImplementationOnce(() => reply({ reply: "Both handled.", steps: [], approvals: [], run_id: null }));

    await sendToAgent("send both", () => {});
    await decide(1, { cA: approveA }, () => {});

    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({
      run_id: "run-1",
      approved_by: expect.any(String),
      approvals: [{ call_id: "cA", approve: approveA }],     // B isn't sent, so it isn't declined
    });
    const cards = agentChatMessages()[1] as Extract<ReturnType<typeof agentChatMessages>[number], { role: "assistant" }>;
    expect(cards.decisions).toEqual({ cA: approveA });
    expect(cards.decided).toBe(false);                         // B is still waiting on this message
    expect(cards.runId).toBe("run-2");                         // ...and now answers to the paused run
    const middle = agentChatMessages()[2] as typeof cards;
    expect(middle.approvals).toEqual([]);                      // B's card isn't shown twice
    expect(middle.steps.map((s) => s.call_id)).toEqual(["cA"]);

    await decide(1, { cB: true }, () => {});
    expect(bodyOf(fetchMock.mock.calls[2])).toMatchObject({ run_id: "run-2", approvals: [{ call_id: "cB", approve: true }] });
    const after = agentChatMessages()[1] as typeof cards;
    expect(after.decisions).toEqual({ cA: approveA, cB: true });
    expect(after.decided).toBe(true);
    expect(after.text).toBe("");
  });
});

describe("agent chat: what refetches after a turn", () => {
  const step = (tool: string, extra: Partial<AgentStep> = {}): AgentStep => ({
    tool, args: {}, summary: null, status: "done", undo_token: null, ...extra,
  });

  it("refreshes Files & drafts after a draft even though drafts carry no undo token", () => {
    expect(scopesOf([step("draft_email")])).toContain("artifacts");
    expect(scopesOf([step("draft_sms")])).toContain("artifacts");
  });

  it("refreshes after a send resumed from an approval card (no token)", () => {
    expect(scopesOf([step("send")])).toEqual(expect.arrayContaining(["campaigns", "artifacts"]));
  });

  it("refetches nothing for read-only or failed steps", () => {
    expect(scopesOf([step("find_people")])).toEqual([]);
    expect(scopesOf([step("draft_email", { status: "error" })])).toEqual([]);
  });
});
