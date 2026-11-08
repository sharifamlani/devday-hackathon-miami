import { undoneSummary } from "./AgentCards";
import type { AgentStep } from "./agentChat";

const step = (over: Partial<AgentStep>): AgentStep => ({
  tool: "create_task",
  args: {},
  summary: "Call Priya Raman",
  status: "done",
  undo_token: "t1",
  ...over,
});

describe("undoneSummary", () => {
  it("is quiet until something is undone", () => {
    expect(undoneSummary([step({})])).toEqual({ any: false, all: false, labels: [] });
  });

  it("marks the whole reply when every change was undone", () => {
    const s = undoneSummary([step({ undone: true }), step({ tool: "get_person", undo_token: null })]);
    expect(s).toEqual({ any: true, all: true, labels: ["Create task (Call Priya Raman)"] });
  });

  it("names only the undone changes when some remain", () => {
    const s = undoneSummary([
      step({ undone: true }),
      step({ tool: "add_calendar_item", summary: "3 thank-you calls", undo_token: "t2" }),
    ]);
    expect(s.any && !s.all).toBe(true);
    expect(s.labels).toEqual(["Create task (Call Priya Raman)"]);
  });
});
