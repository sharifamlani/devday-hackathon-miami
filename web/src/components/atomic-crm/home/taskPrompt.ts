import type { HomeTask } from "./homeData";

/**
 * What a task click sends to the home agent. The service's instructions read
 * "Work on this task: … (task #N)" as "load the task and the person, then do
 * the next step" (service/chat_agent.py), so keep this exact shape.
 */
export const taskPrompt = (task: Pick<HomeTask, "id" | "title" | "why">): string => {
  const why = task.why?.trim();
  return `Work on this task: ${task.title.trim()} (task #${task.id}).${why ? ` Why: ${why.replace(/\.$/, "")}.` : ""}`;
};
