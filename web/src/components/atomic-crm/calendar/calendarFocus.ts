import { parseWhen } from "../providers/local/parseWhen";

/** A date the next CalendarPage opens on (the home briefing's "Open calendar"); read once, then cleared. */
let pendingFocus: string | null = null;

export const focusCalendarOn = (isoDate: string) => {
  pendingFocus = isoDate;
};

/** CalendarPage's initial date: the pending focus, if any (and clears it). */
export const takeCalendarFocus = (): Date | null => {
  const iso = pendingFocus;
  pendingFocus = null;
  if (!iso) return null;
  const d = parseWhen(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
