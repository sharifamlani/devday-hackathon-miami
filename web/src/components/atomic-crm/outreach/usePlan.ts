import { useCallback, useMemo } from "react";

import { DATA_MODE } from "../providers/local/config";
import {
  useCreateTask,
  useDeleteTask,
  useTasks,
  useUpdateTask,
  type Task,
} from "../providers/local/tasks";
import { isIsoDate } from "./dates";
import {
  useLocalOutreachPlan,
  type NewPlanItem,
  type OutreachPlanItem,
} from "./outreachPlan";

/**
 * The outreach plan as real tasks (GET/POST/PATCH/DELETE /tasks): staff and
 * the agent see and edit the same items, and the calendar, home counts and
 * task list refetch together (providers/local/tasks.ts). Snapshot builds have
 * no service, so they keep the browser-local plan.
 */

const KIND_LABEL: Record<string, string> = {
  call: "Call",
  email: "Email",
  review: "Review",
  prep: "Prep",
  other: "Task",
};

/** A dated task as a plan item; undated tasks are not on the calendar. */
export const taskToPlanItem = (task: Task): OutreachPlanItem | null => {
  const date = task.due?.slice(0, 10) ?? "";
  if (!isIsoDate(date)) return null;
  return {
    id: String(task.id),
    date,
    donor_id: task.person_id,
    campaign_id: null,
    label: task.title,
    title: task.title,
    detail: KIND_LABEL[task.kind] ?? "Task",
    chips: task.chips ?? [],
    note: task.why ?? "",
    done: task.done,
    // The generator's tasks are the service's suggestions, like the agent's.
    source: task.source === "staff" ? "staff" : "agent",
    created_at: "",
  };
};

/** What POST /tasks takes for a plan item staff or a recommendation added. */
export const planInputToTask = (input: NewPlanItem) => {
  const campaign = input.campaign_id != null;
  return {
    kind: campaign ? ("review" as const) : ("call" as const),
    title: `${campaign ? "Review" : "Contact"} ${input.label}`,
    why: input.note?.trim() || null,
    person_id: input.donor_id ?? null,
    due: input.date,
    source: input.source === "agent" ? ("agent" as const) : ("staff" as const),
  };
};

const alreadyPlanned = (items: OutreachPlanItem[], input: NewPlanItem) =>
  items.some(
    (item) =>
      item.date === input.date &&
      (input.donor_id != null
        ? item.donor_id === input.donor_id
        : item.title === `Review ${input.label}`),
  );

const useTaskOutreachPlan = () => {
  const tasks = useTasks();
  const create = useCreateTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();

  const items = useMemo(
    () =>
      (tasks.data ?? []).flatMap((task) => {
        const item = taskToPlanItem(task);
        return item ? [item] : [];
      }),
    [tasks.data],
  );

  const add = useCallback(
    (input: NewPlanItem) => {
      if (!isIsoDate(input.date)) return false;
      if ((input.donor_id == null) === (input.campaign_id == null))
        return false;
      if (alreadyPlanned(items, input)) return false;
      create.mutate(planInputToTask(input));
      return true;
    },
    [items, create],
  );
  const updateItem = useCallback(
    (
      id: string,
      patch: Partial<Pick<OutreachPlanItem, "note" | "done" | "date">>,
    ) =>
      update.mutate({
        id: Number(id),
        ...(patch.note !== undefined ? { why: patch.note || null } : {}),
        ...(patch.done !== undefined ? { done: patch.done } : {}),
        ...(patch.date ? { due: patch.date } : {}),
      }),
    [update],
  );
  const removeItem = useCallback(
    (id: string) => remove.mutate(Number(id)),
    [remove],
  );

  return { items, saved: true, add, update: updateItem, remove: removeItem };
};

/** The viewer's plan: real tasks in live mode, the browser-local plan in the snapshot build. */
export const useOutreachPlan =
  DATA_MODE === "local" ? useTaskOutreachPlan : useLocalOutreachPlan;
