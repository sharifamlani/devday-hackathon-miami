/**
 * Calendar-day helpers for the outreach plan. Every date here is a plain local
 * calendar day ("YYYY-MM-DD"); nothing carries a time or a timezone, so a day
 * planned in Miami stays the same day wherever the tab is opened.
 */

export const toIsoDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export const isIsoDate = (value: unknown): value is string =>
  typeof value === "string" && ISO_DAY.test(value);

/** Local midnight of a YYYY-MM-DD day (also accepts a longer ISO string). */
export const fromIsoDate = (iso: string): Date => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (iso: string, days: number): string => {
  const date = fromIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
};

export const addMonths = (
  month: { year: number; month: number },
  delta: number,
) => {
  const date = new Date(month.year, month.month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
};

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number =>
  Math.round(
    (fromIsoDate(to).getTime() - fromIsoDate(from).getTime()) / 86_400_000,
  );

/** 0 = Monday ... 6 = Sunday (the grids start on Monday). */
export const mondayIndex = (iso: string): number =>
  (fromIsoDate(iso).getDay() + 6) % 7;

export const isWorkday = (iso: string): boolean => mondayIndex(iso) < 5;

/** `iso` itself when it is a weekday, otherwise the following Monday. */
export const onOrNextWorkday = (iso: string): string => {
  let day = iso;
  while (!isWorkday(day)) day = addDays(day, 1);
  return day;
};

/** The weekday `count` working days after `iso` (0 = the same or next workday). */
export const addWorkdays = (iso: string, count: number): string => {
  let day = onOrNextWorkday(iso);
  for (let i = 0; i < count; i += 1) day = onOrNextWorkday(addDays(day, 1));
  return day;
};

/** The weekday before `iso` (skips back over a weekend). */
export const previousWorkday = (iso: string): string => {
  let day = addDays(iso, -1);
  while (!isWorkday(day)) day = addDays(day, -1);
  return day;
};

/**
 * Give Miami Day is the Thursday one week before Thanksgiving, i.e. the third
 * Thursday of November (Nov 19 in 2026, Nov 20 in 2025). Prefer the date the
 * service reports (targets.give_miami_day.date); this is the fallback.
 */
export const giveMiamiDayFor = (year: number): string => {
  const first = new Date(year, 10, 1);
  const firstThursday = 1 + ((4 - first.getDay() + 7) % 7);
  return toIsoDate(new Date(year, 10, firstThursday + 14));
};

export const formatDayLong = (iso: string): string =>
  fromIsoDate(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export const formatDayShort = (iso: string): string =>
  fromIsoDate(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

export const formatMonthTitle = (month: { year: number; month: number }) =>
  new Date(month.year, month.month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
