import { afterEach, describe, expect, it, vi } from "vitest";

import { WAITING_PREFIX, agentChatMessages, applyStreamLine, decide, resetAgentChat, sendToAgent } from "./agentChat";

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

const stream = (lines: string[], status = 200) =>
  Promise.resolve(new Response(lines.join("\n") + "\n", { status, headers: { "content-type": "text/plain; charset=utf-8" } }));

const taskLines = [
  'b:{"toolCallId": "t1", "toolName": "create_task"}',
  'c:{"toolCallId": "t1", "argsTextDelta": "{\\"kind\\":\\"call\\",\\"title\\":\\"Call Priya\\"}"}',
  'a:{"toolCallId": "t1", "result": {"tool": "create_task", "summary": "task #1 saved: Call Priya", "status": "done", "undo_token": "u1"}}',
  '0:"Added "',
  '0:"the task."',
];

describe("agent chat: streaming replies", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAgentChat();
  });

  it("builds the reply from the stream: tool cards with args, result and Undo, then the text", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockImplementationOnce(() => stream(taskLines));
    const refetch = vi.fn();
    await sendToAgent("add a task to call Priya", refetch);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/chat\/stream$/);
    const reply = agentChatMessages()[1];
    expect(reply).toMatchObject({ role: "assistant", text: "Added the task." });
    if (reply.role !== "assistant") throw new Error("no reply");
    expect(reply.streaming).toBeUndefined();
    expect(reply.steps).toEqual([
      expect.objectContaining({ tool: "create_task", args: { kind: "call", title: "Call Priya" },
        summary: "task #1 saved: Call Priya", status: "done", undo_token: "u1", call_id: "t1" }),
    ]);
    expect(refetch).toHaveBeenCalled();
  });

  it("a tool card shows as running until its result arrives", () => {
    const empty = { role: "assistant" as const, text: "", steps: [], approvals: [], runId: null };
    const started = applyStreamLine(empty, taskLines[0], new Map());
    expect(started.steps[0]).toMatchObject({ tool: "create_task", status: "running", summary: null });
  });

  it("a paused run shows its approval cards and the waiting line", async () => {
    vi.spyOn(window, "fetch").mockImplementationOnce(() =>
      stream([
        'b:{"toolCallId": "s1", "toolName": "send"}',
        'a:{"toolCallId": "s1", "result": {"tool": "send", "status": "awaiting_approval", "summary": "waiting for your approval to send", "run_id": "r9"}}',
        '2:[{"type": "approvals", "run_id": "r9", "approvals": [{"call_id": "s1", "tool": "send", "args": {"batch_id": 3}, "summary": "Send 2 emails"}]}]',
      ]),
    );
    await sendToAgent("send it", () => {});
    expect(agentChatMessages()[1]).toMatchObject({
      runId: "r9",
      approvals: [{ call_id: "s1", summary: "Send 2 emails" }],
      text: `${WAITING_PREFIX}Send 2 emails.`,
    });
  });

  it("falls back to POST /chat when the stream can't start", async () => {
    const fetchMock = vi
      .spyOn(window, "fetch")
      .mockImplementationOnce(() => stream(["boom"], 500))
      .mockImplementationOnce(() => reply({ reply: "Here you go.", steps: [], approvals: [], run_id: null }));
    await sendToAgent("hi", () => {});
    expect(String(fetchMock.mock.calls[1][0])).toMatch(/\/chat$/);
    expect(agentChatMessages()[1]).toMatchObject({ role: "assistant", text: "Here you go." });
  });

  it("an error after a tool ran is shown, not retried (a retry could repeat the write)", async () => {
    const fetchMock = vi.spyOn(window, "fetch").mockImplementationOnce(() => stream([taskLines[0], taskLines[2], '3:"model timed out"']));
    await sendToAgent("add a task", () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(agentChatMessages()[1]).toMatchObject({ steps: [expect.objectContaining({ status: "done" })] });
  });
});

describe("agent chat: a stream that fails part-way", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAgentChat();
  });

  it("an error frame leaves no card spinning, and the finished write still refreshes the screens", async () => {
    vi.spyOn(window, "fetch").mockImplementationOnce(() =>
      stream([taskLines[0], 'b:{"toolCallId": "t2", "toolName": "get_tasks"}', taskLines[2], '3:"model timed out"']),
    );
    const refetch = vi.fn();
    await sendToAgent("add a task", refetch);
    const reply = agentChatMessages()[1];
    if (reply.role !== "assistant") throw new Error("no reply");
    expect(reply.steps.filter((s) => s.status === "running")).toHaveLength(0);
    expect(reply.steps.find((s) => s.call_id === "t2")).toMatchObject({ status: "error", summary: "no result" });
    expect(reply.streaming).toBeUndefined();
    expect(refetch).toHaveBeenCalled();                 // create_task finished before the error
  });

  it("a dropped connection after a tool also finalizes the cards", async () => {
    let reads = 0;
    const body = new ReadableStream({
      pull(controller) {
        // first read: a tool starts; second read: the connection drops
        if (reads++ === 0) controller.enqueue(new TextEncoder().encode(`${taskLines[0]}
`));
        else controller.error(new Error("connection reset"));
      },
    });
    vi.spyOn(window, "fetch").mockImplementationOnce(() =>
      Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/plain" } })),
    );
    const fetchMock = vi.mocked(window.fetch);
    await sendToAgent("add a task", () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);          // a tool started: no retry through POST /chat
    const reply = agentChatMessages()[1];
    if (reply.role !== "assistant") throw new Error("no reply");
    expect(reply.steps).toEqual([expect.objectContaining({ call_id: "t1", status: "error", summary: "no result" })]);
    expect(reply.streaming).toBeUndefined();
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
