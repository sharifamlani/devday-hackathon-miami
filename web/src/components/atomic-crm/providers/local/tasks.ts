import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { call, qs } from "./endpoint";

/* plan.md §21.5: tasks (owner 3a, B11). */

export type TaskKind = "call" | "email" | "review" | "prep" | (string & {});

export interface Task {
  id: number;
  kind: TaskKind;
  title: string;
  why: string | null;
  person_id: number | null;
  chips: string[]; // "Lifetime $11,000", "Last gift Nov 2025", "Prefers phone"
  due: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
  done: boolean;
  source: string | null; // "generator" | "agent" | "staff"
  undo_token?: string | null; // writes may return one (POST /undo/{token})
}

export interface TaskFilter {
  due?: "today";
  from?: string;
  to?: string;
  person_id?: number;
}

export type TaskInput = Partial<Omit<Task, "id" | "undo_token">> & { title: string };

export const taskKeys = {
  all: ["donor-desk", "tasks"] as const,
  list: (filter: TaskFilter) => ["donor-desk", "tasks", filter] as const,
};

/* ---------- API ---------- */

export const getTasks = (filter: TaskFilter = {}) =>
  call<Task[]>("Tasks", "GET", `/tasks${qs({ ...filter })}`, { snapshotValue: [] });

export const createTask = (input: TaskInput) => call<Task>("Adding a task", "POST", "/tasks", { body: input });

export const updateTask = (id: number, patch: Partial<TaskInput>) =>
  call<Task>("Updating a task", "PATCH", `/tasks/${id}`, { body: patch });

export const completeTask = (id: number) => updateTask(id, { done: true });

export const deleteTask = (id: number) =>
  call<{ deleted?: boolean; undo_token?: string | null }>("Deleting a task", "DELETE", `/tasks/${id}`);

/** Idempotent: re-running adds nothing new. */
export const generateTasks = () => call<{ created: number }>("Task generator", "POST", "/tasks/generate");

export const undo = (token: string) =>
  call<{ undone: true }>("Undo", "POST", `/undo/${encodeURIComponent(token)}`);

/* ---------- Hooks ---------- */

export const useTasks = (filter: TaskFilter = {}) =>
  useQuery({ queryKey: taskKeys.list(filter), queryFn: () => getTasks(filter) });

/** Tasks change the calendar, the home counts and the task list together. */
const useRefreshTasks = () => {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: taskKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["donor-desk", "calendar"] }),
      queryClient.invalidateQueries({ queryKey: ["donor-desk", "home-summary"] }),
    ]);
};

export const useCreateTask = () => {
  const refresh = useRefreshTasks();
  return useMutation({ mutationFn: createTask, onSuccess: refresh });
};

export const useUpdateTask = () => {
  const refresh = useRefreshTasks();
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<TaskInput> & { id: number }) => updateTask(id, patch),
    onSuccess: refresh,
  });
};

export const useCompleteTask = () => {
  const refresh = useRefreshTasks();
  return useMutation({ mutationFn: completeTask, onSuccess: refresh });
};

export const useDeleteTask = () => {
  const refresh = useRefreshTasks();
  return useMutation({ mutationFn: deleteTask, onSuccess: refresh });
};

export const useGenerateTasks = () => {
  const refresh = useRefreshTasks();
  return useMutation({ mutationFn: generateTasks, onSuccess: refresh });
};

/** Undo any write that returned an undo token; refetches everything after. */
export const useUndo = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: undo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["donor-desk"] }),
  });
};
