import { useState } from "react";
import { ChevronDown, Folder, Info, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { parseWhen } from "../../providers/local/parseWhen";
import {
  useCompleteTask,
  useUndo,
  type Task,
} from "../../providers/local/tasks";
import { tasksFromApi, type HomeTask } from "../homeData";
import { focusRing } from "../tile";
import "./tasks-panel.css";
import { PUBLIC_READ_ONLY } from "../../providers/local/config";

/** The tile's folders: Donor outreach, Donor records, Preparation. */
export const taskGroups = (tasks: HomeTask[]) =>
  [
    {
      id: "outreach",
      title: "Donor outreach",
      items: tasks.filter((t) => t.kind === "call" || t.kind === "email"),
    },
    {
      id: "records",
      title: "Donor records",
      items: tasks.filter((t) => t.kind === "review"),
    },
    {
      id: "prep",
      title: "Preparation",
      items: tasks.filter((t) => !["call", "email", "review"].includes(t.kind)),
    },
  ].filter((g) => g.items.length > 0);

/** "Today", or "Overdue · due Nov 6" when the due date is before the service's as-of today. */
export const dueLabel = (due: string | null, today: string) => {
  if (due && parseWhen(due).getTime() < parseWhen(today).getTime()) {
    const day = parseWhen(due).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return { text: `Overdue · due ${day}`, overdue: true };
  }
  return { text: "Today", overdue: false };
};

interface ViewProps {
  tasks: Task[];
  today: string;
  live: boolean;
  isPending?: boolean;
  onWork: (task: HomeTask) => void;
  onInfo: (key: string) => void;
  onAdd: () => void;
  onDone?: (task: HomeTask) => void;
  /** Set right after a tick that returned an undo token. */
  undo?: { title: string; run: () => void } | null;
}

export const TasksPanelView = ({
  tasks,
  today,
  live,
  isPending = false,
  onWork,
  onInfo,
  onAdd,
  onDone,
  undo,
}: ViewProps) => {
  const open = tasksFromApi(tasks);
  const dueById = new Map(tasks.map((t) => [t.id, t.due]));
  const doneToday = tasks.filter((t) => t.done);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [doneOpen, setDoneOpen] = useState(false);
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="tasks-panel">
      <div className="tasks-panel-head">
        <h3>Tasks · {open.length}</h3>
        {!PUBLIC_READ_ONLY && (
          <button
            type="button"
            onClick={onAdd}
            className={cn("tasks-panel-add", focusRing)}
          >
            <Plus className="size-4" aria-hidden="true" /> Add
          </button>
        )}
      </div>
      {undo && (
        <p className="tasks-panel-undo" role="status">
          Marked done: {undo.title}.{" "}
          <button type="button" onClick={undo.run} className={focusRing}>
            Undo
          </button>
        </p>
      )}
      {isPending ? (
        <p className="tasks-panel-empty">Loading tasks…</p>
      ) : open.length === 0 ? (
        <p className="tasks-panel-empty">Nothing to do today</p>
      ) : (
        taskGroups(open).map((group) => {
          const expanded = !closed.has(group.id);
          return (
            <section key={group.id} className="tasks-panel-group">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => toggle(group.id)}
                className={cn("tasks-panel-folder", focusRing)}
              >
                <ChevronDown
                  className={cn("size-4", !expanded && "-rotate-90")}
                  aria-hidden="true"
                />
                <Folder className="size-4" aria-hidden="true" />
                <span className="flex-1 text-left">{group.title}</span>
                <span>{group.items.length}</span>
              </button>
              <ul hidden={!expanded}>
                {group.items.map((task) => {
                  const due = dueLabel(dueById.get(task.id) ?? null, today);
                  return (
                    <li key={task.key} className="tasks-panel-row">
                      <input
                        type="checkbox"
                        aria-label={`Mark done: ${task.title}`}
                        disabled={!onDone}
                        checked={false}
                        onChange={() => onDone?.(task)}
                      />
                      <button
                        type="button"
                        onClick={() => onWork(task)}
                        title={live ? "Hand to the agent" : "Open details"}
                        className={cn("tasks-panel-main", focusRing)}
                      >
                        <span className="tasks-panel-title">{task.title}</span>
                        {task.why && (
                          <span className="tasks-panel-why">{task.why}</span>
                        )}
                      </button>
                      <span
                        className={cn(
                          "tasks-panel-due",
                          due.overdue && "is-overdue",
                        )}
                      >
                        {due.text}
                      </span>
                      <button
                        type="button"
                        aria-label={`Task details: ${task.title}`}
                        title="Task details"
                        onClick={() => onInfo(task.key)}
                        className={cn("tasks-panel-info", focusRing)}
                      >
                        <Info className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
      {doneToday.length > 0 && (
        <section className="tasks-panel-group">
          <button
            type="button"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((v) => !v)}
            className={cn("tasks-panel-folder", focusRing)}
          >
            <ChevronDown
              className={cn("size-4", !doneOpen && "-rotate-90")}
              aria-hidden="true"
            />
            <span className="flex-1 text-left">
              Done today ({doneToday.length})
            </span>
          </button>
          <ul hidden={!doneOpen}>
            {doneToday.map((t) => (
              <li key={t.id} className="tasks-panel-row is-done">
                <input
                  type="checkbox"
                  checked
                  disabled
                  readOnly
                  aria-label={`Done: ${t.title}`}
                />
                <span className="tasks-panel-main">
                  <span className="tasks-panel-title">{t.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

/** Tick, with an Undo when the service returned a token. */
export const TasksPanel = ({
  tasks,
  ...rest
}: Omit<ViewProps, "onDone" | "undo">) => {
  const complete = useCompleteTask();
  const undoMutation = useUndo();
  const [undo, setUndo] = useState<{ title: string; token: string } | null>(
    null,
  );
  return (
    <TasksPanelView
      {...rest}
      tasks={tasks}
      onDone={
        PUBLIC_READ_ONLY
          ? undefined
          : (task) =>
              complete.mutate(task.id, {
                onSuccess: (done) =>
                  setUndo(
                    done?.undo_token
                      ? { title: task.title, token: done.undo_token }
                      : null,
                  ),
              })
      }
      undo={
        undo
          ? {
              title: undo.title,
              run: () =>
                undoMutation.mutate(undo.token, {
                  onSuccess: () => setUndo(null),
                }),
            }
          : null
      }
    />
  );
};
