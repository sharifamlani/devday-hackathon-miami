import { useEffect, useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { EVENT_KINDS, fieldErrors, eventErrorMessage } from "../../providers/local/events";
import { focusRing } from "../tile";
import {
  formToInput,
  validateEventForm,
  type EventFormValues,
} from "./eventsModel";

const field =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The add / edit event dialog. `onSave` rejects with the API error so 422s show as field errors. */
export const EventForm = ({
  open,
  initial,
  editing,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  initial: EventFormValues;
  editing: boolean;
  onClose: () => void;
  onSave: (input: ReturnType<typeof formToInput>) => Promise<unknown>;
  onDelete?: () => Promise<unknown>;
}) => {
  const id = useId();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setValues(initial);
      setErrors({});
    }
  }, [open, initial]);
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validateEventForm(values);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      await onSave(formToInput(values));
      onClose();
    } catch (error) {
      const api = fieldErrors(error);
      setErrors(Object.keys(api).length ? api : { form: eventErrorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const err = (key: string) =>
    errors[key] ? (
      <p id={`${id}-${key}-err`} role="alert" className="mt-1 text-xs text-destructive">
        {errors[key]}
      </p>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogTitle>{editing ? "Edit event" : "Add event"}</DialogTitle>
        <DialogDescription>
          Organization events only. Calls and reviews go on the to-do list.
        </DialogDescription>
        <form onSubmit={submit} noValidate className="grid gap-3" aria-label={editing ? "Edit event" : "Add event"}>
          <div>
            <label htmlFor={`${id}-title`} className="text-sm font-medium">Title *</label>
            <input
              id={`${id}-title`}
              className={field}
              value={values.title}
              onChange={(e) => set("title", e.target.value)}
              aria-invalid={Boolean(errors.title)}
              aria-describedby={errors.title ? `${id}-title-err` : undefined}
            />
            {err("title")}
          </div>
          <div>
            <label htmlFor={`${id}-date`} className="text-sm font-medium">Date *</label>
            <input
              id={`${id}-date`}
              type="date"
              className={field}
              value={values.date}
              onChange={(e) => set("date", e.target.value)}
              aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? `${id}-date-err` : undefined}
            />
            {err("date")}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.allDay}
              onChange={(e) => set("allDay", e.target.checked)}
            />
            All day
          </label>
          {!values.allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${id}-start`} className="text-sm font-medium">Start</label>
                <input
                  id={`${id}-start`}
                  type="time"
                  className={field}
                  value={values.start}
                  onChange={(e) => set("start", e.target.value)}
                  aria-invalid={Boolean(errors.start)}
                />
                {err("start")}
              </div>
              <div>
                <label htmlFor={`${id}-end`} className="text-sm font-medium">End</label>
                <input
                  id={`${id}-end`}
                  type="time"
                  className={field}
                  value={values.end}
                  onChange={(e) => set("end", e.target.value)}
                  aria-invalid={Boolean(errors.end)}
                />
                {err("end")}
              </div>
            </div>
          )}
          <div>
            <label htmlFor={`${id}-place`} className="text-sm font-medium">Place</label>
            <input
              id={`${id}-place`}
              className={field}
              value={values.place}
              onChange={(e) => set("place", e.target.value)}
            />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Type</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {EVENT_KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  aria-pressed={values.kind === k.value}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    values.kind === k.value
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background",
                    focusRing,
                  )}
                  onClick={() => set("kind", values.kind === k.value ? "" : k.value)}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor={`${id}-notes`} className="text-sm font-medium">Notes</label>
            <textarea
              id={`${id}-notes`}
              className={cn(field, "min-h-16")}
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
          {err("form")}
          <div className="flex items-center justify-between gap-2 pt-1">
            {editing && onDelete ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onDelete();
                    onClose();
                  } catch (error) {
                    setErrors({ form: eventErrorMessage(error) });
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Delete
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>Save event</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
