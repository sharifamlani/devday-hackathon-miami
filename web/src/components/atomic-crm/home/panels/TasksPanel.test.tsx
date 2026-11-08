import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Task } from "../../providers/local/tasks";
import { dueLabel, TasksPanelView } from "./TasksPanel";

const task = (id: number, over: Partial<Task> = {}): Task => ({
  id,
  kind: "call",
  title: `Task ${id}`,
  why: `Because ${id}`,
  person_id: null,
  chips: [],
  due: "2026-11-08",
  time: null,
  done: false,
  source: "generator",
  ...over,
});

const view = (tasks: Task[]) =>
  renderToString(
    <TasksPanelView
      tasks={tasks}
      today="2026-11-08"
      live
      onWork={() => {}}
      onInfo={() => {}}
      onAdd={() => {}}
      onDone={() => {}}
    />,
  );

describe("TasksPanelView", () => {
  it("counts open tasks and groups them in folders", () => {
    const html = view([
      task(1),
      task(2, { kind: "review" }),
      task(3, { kind: "prep" }),
    ]);
    expect(html).toMatch(/Tasks · (<!-- -->)?3/);
    expect(html).toContain("Donor outreach");
    expect(html).toContain("Donor records");
    expect(html).toContain("Preparation");
  });

  it("labels overdue against the service's today, not the browser clock", () => {
    expect(dueLabel("2026-11-06", "2026-11-08")).toEqual({
      text: "Overdue · due Nov 6",
      overdue: true,
    });
    expect(dueLabel("2026-11-08", "2026-11-08")).toEqual({
      text: "Today",
      overdue: false,
    });
    expect(dueLabel(null, "2026-11-08").overdue).toBe(false);
  });

  it("renders the overdue label in the row", () => {
    expect(view([task(1, { due: "2026-11-06" })])).toContain(
      "Overdue · due Nov 6",
    );
  });

  it("says Nothing to do today when empty", () => {
    expect(view([])).toContain("Nothing to do today");
  });

  it("omits Done today when nothing is done, lists it when something is", () => {
    expect(view([task(1)])).not.toContain("Done today");
    expect(view([task(1), task(2, { done: true })])).toContain("Done today");
  });
});
