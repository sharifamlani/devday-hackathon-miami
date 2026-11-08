import { useId, useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DATA_MODE } from "../providers/local/config";
import { useCalendarFeed } from "../providers/local/calendarFeed";
import {
  useCreateTask,
  useTasks,
  useUpdateTask,
} from "../providers/local/tasks";
import { formatDayLong } from "../outreach/dates";

type Person = { id: number; name: string };
/** The home day panel edits the service's task/calendar feed, never a separate local plan. */
export const TaskDayPanel = ({
  date,
  onClose,
  donors,
}: {
  date: string | null;
  onClose: () => void;
  donors: Person[];
}) => (
  <Sheet
    open={date !== null}
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
  >
    <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
      {date && <TaskDayContent key={date} date={date} donors={donors} />}
    </SheetContent>
  </Sheet>
);

const TaskDayContent = ({
  date,
  donors,
}: {
  date: string;
  donors: Person[];
}) => {
  const tasks = useTasks({ from: date, to: date });
  const feed = useCalendarFeed(date, date);
  const create = useCreateTask();
  const update = useUpdateTask();
  const id = useId();
  const [title, setTitle] = useState("");
  const [person, setPerson] = useState("");
  const [time, setTime] = useState("");
  const [kind, setKind] = useState("call");
  const [message, setMessage] = useState("");
  const live = DATA_MODE === "local";
  const events = (feed.data ?? []).filter((item) => item.kind === "event");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!live || !title.trim()) return;
    try {
      await create.mutateAsync({
        title: title.trim(),
        due: date,
        time: time || null,
        person_id: person ? Number(person) : null,
        kind,
        source: "staff",
      });
      setTitle("");
      setMessage("Task saved to the calendar.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save the task.",
      );
    }
  };
  return (
    <>
      <SheetHeader>
        <SheetTitle>Day plan</SheetTitle>
        <SheetDescription>{formatDayLong(date)}</SheetDescription>
      </SheetHeader>
      <div className="space-y-6 px-4 pb-6">
        {!live && (
          <p className="rounded-xl bg-muted p-3 text-sm">
            This is a cached calendar. Adding or completing tasks needs the live
            donor service.
          </p>
        )}
        <section aria-label="Scheduled tasks">
          <h2 className="mb-3 font-semibold">Tasks</h2>
          {tasks.isPending ? (
            <p role="status">Loading tasks…</p>
          ) : tasks.error ? (
            <p role="alert" className="text-destructive">
              {tasks.error.message}
            </p>
          ) : !tasks.data?.length ? (
            <p className="text-sm text-muted-foreground">
              No tasks scheduled for this day.
            </p>
          ) : (
            <ul className="space-y-2">
              {tasks.data.map((task) => (
                <li
                  key={task.id}
                  className="flex items-start gap-2 rounded-xl bg-muted/60 p-3"
                >
                  <button
                    type="button"
                    aria-label={`${task.done ? "Reopen" : "Complete"} ${task.title}`}
                    aria-pressed={task.done}
                    disabled={!live || update.isPending}
                    className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border disabled:opacity-50"
                    onClick={() =>
                      update.mutate(
                        { id: task.id, done: !task.done },
                        {
                          onSuccess: () => setMessage("Task updated."),
                          onError: (error) => setMessage(error.message),
                        },
                      )
                    }
                  >
                    {task.done && <Check size={15} />}
                  </button>
                  <div className="min-w-0">
                    <p
                      className={
                        task.done
                          ? "text-sm line-through"
                          : "text-sm font-medium"
                      }
                    >
                      {task.title}
                    </p>
                    {task.time && (
                      <time className="text-xs text-muted-foreground">
                        {task.time}
                      </time>
                    )}
                    {task.why && (
                      <p className="text-xs text-muted-foreground">
                        {task.why}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        {(events.length > 0 || feed.error) && (
          <section aria-label="Events">
            <h2 className="mb-3 font-semibold">Events</h2>
            {feed.error ? (
              <p role="alert">{feed.error.message}</p>
            ) : (
              <ul className="space-y-2">
                {events.map((item, index) => (
                  <li
                    className="rounded-xl bg-muted/60 p-3 text-sm"
                    key={`${item.ref}-${index}`}
                  >
                    {item.title}
                    <p className="text-xs text-muted-foreground">
                      {item.time || "All day"}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <form onSubmit={submit} className="grid gap-3">
          <h2 className="font-semibold">Add a task</h2>
          <label htmlFor={`${id}-title`} className="text-sm">
            Task
          </label>
          <Input
            id={`${id}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Call a donor, prepare an event…"
            required
            disabled={!live}
          />
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              Type
              <select
                className="min-h-10 rounded-lg border border-input bg-background px-2"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
                disabled={!live}
              >
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="prep">Preparation</option>
                <option value="review">Review</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Time
              <Input
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                disabled={!live}
              />
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            Donor (optional)
            <select
              className="min-h-10 max-w-full rounded-lg border border-input bg-background px-2"
              value={person}
              onChange={(event) => setPerson(event.target.value)}
              disabled={!live}
            >
              <option value="">No donor linked</option>
              {donors.map((donor) => (
                <option key={donor.id} value={donor.id}>
                  {donor.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="submit"
            disabled={!live || create.isPending || !title.trim()}
            className="rounded-full"
          >
            <Plus size={16} />
            {create.isPending ? "Saving…" : "Add to calendar"}
          </Button>
        </form>
        <p role="status" aria-live="polite" className="text-sm">
          {message}
        </p>
      </div>
    </>
  );
};
