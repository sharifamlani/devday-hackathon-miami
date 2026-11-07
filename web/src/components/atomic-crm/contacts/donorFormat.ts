import type { DonorStatus, Tier } from "../providers/local/types";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const formatUsd = (amount: number | null | undefined) =>
  amount == null ? "—" : usd.format(amount);

// Gift dates are plain YYYY-MM-DD; read them as UTC so no timezone shifts
// "2025-12-01" into November.
const toUtcDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export const formatMonthYear = (iso: string | null | undefined) =>
  iso
    ? toUtcDate(iso).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

export const formatDay = (iso: string | null | undefined) =>
  iso
    ? toUtcDate(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : "—";

export const tierLabel: Record<Tier, string> = {
  big: "Big",
  mid: "Mid",
  small: "Small",
};

export const statusLabel: Record<DonorStatus, string> = {
  lapsing: "lapsing",
  due: "due",
  on_track: "on track",
  lapsed: "lapsed",
  no_gifts: "no gifts",
};

export const statusClass: Record<DonorStatus, string> = {
  lapsing: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  due: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  on_track: "bg-muted text-muted-foreground",
  lapsed: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  no_gifts: "bg-muted text-muted-foreground",
};

export const scoreClass = (score: number) =>
  score >= 75
    ? "text-red-700 dark:text-red-400"
    : score >= 50
      ? "text-amber-700 dark:text-amber-400"
      : "text-muted-foreground";
