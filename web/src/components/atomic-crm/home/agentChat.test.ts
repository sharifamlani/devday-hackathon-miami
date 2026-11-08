import { afterEach, describe, expect, it, vi } from "vitest";

import { WAITING_PREFIX, agentChatMessages, decide, resetAgentChat, sendToAgent } from "./agentChat";

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
