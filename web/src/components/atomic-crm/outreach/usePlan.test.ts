import { describe, expect, it } from "vitest";

import type { Task } from "../providers/local/tasks";
import { planInputToTask, taskToPlanItem } from "./usePlan";

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 7,
  kind: "call",
  title: "Call Dana",
  why: "Gift failed",
  person_id: 4,
  chips: ["Lifetime $600"],
  due: "2026-11-10",
  time: null,
  done: false,
  source: "agent",
  ...overrides,
});

describe("the outreach plan as tasks", () => {
  it("reads a dated task as a plan item, keeping who made it", () => {
    expect(taskToPlanItem(task())).toMatchObject({
      id: "7",
      date: "2026-11-10",
      donor_id: 4,
      campaign_id: null,
      title: "Call Dana",
      detail: "Call",
      note: "Gift failed",
      chips: ["Lifetime $600"],
      done: false,
      source: "agent",
    });
    expect(taskToPlanItem(task({ source: "staff" }))?.source).toBe("staff");
    expect(taskToPlanItem(task({ source: "generator" }))?.source).toBe("agent");
  });

  it("leaves undated tasks off the calendar", () => {
    expect(taskToPlanItem(task({ due: null }))).toBeNull();
    expect(taskToPlanItem(task({ due: "soon" }))).toBeNull();
  });

  it("turns a plan input into a POST /tasks body", () => {
    expect(
      planInputToTask({
        date: "2026-11-10",
        donor_id: 4,
        label: "Dana",
        note: " thank her ",
        source: "agent",
      }),
    ).toEqual({
      kind: "call",
      title: "Contact Dana",
      why: "thank her",
      person_id: 4,
      due: "2026-11-10",
      source: "agent",
    });
    expect(
      planInputToTask({ date: "2026-11-10", campaign_id: 2, label: "Thanks" }),
    ).toMatchObject({
      kind: "review",
      title: "Review Thanks",
      person_id: null,
      source: "staff",
    });
  });
});
