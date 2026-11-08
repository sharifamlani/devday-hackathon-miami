/**
 * One place for turning API date strings into Date objects.
 * - "YYYY-MM-DD" (date-only, e.g. all-day events) is a LOCAL calendar day. `new Date("2026-11-14")`
 *   is UTC midnight, which is the previous evening in Miami.
 * - "YYYY-MM-DD HH:MM:SS" (naive, e.g. SQLite CURRENT_TIMESTAMP) is UTC.
 * - Anything else (ISO with offset or Z, "YYYY-MM-DDTHH:MM") parses as the platform does.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const NAIVE_UTC = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/;

export const isDateOnly = (s: string): boolean => DATE_ONLY.test(s);

export const parseWhen = (s: string): Date => {
  if (DATE_ONLY.test(s)) return new Date(`${s}T00:00`);
  const naive = NAIVE_UTC.exec(s);
  if (naive) return new Date(`${naive[1]}T${naive[2]}Z`);
  return new Date(s);
};
