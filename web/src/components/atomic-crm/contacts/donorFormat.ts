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

/** Kindred badge colors (soft fill, dark text); tokens live in src/index.css. */
export const statusClass: Record<DonorStatus, string> = {
  lapsing: "bg-alert text-alert-foreground",
  due: "bg-warn text-warn-foreground",
  on_track: "bg-good text-good-foreground",
  lapsed: "bg-quiet text-quiet-foreground",
  no_gifts: "bg-quiet text-quiet-foreground",
};

export const scoreClass = (score: number) =>
  score >= 75
    ? "text-alert-foreground"
    : score >= 50
      ? "text-warn-foreground"
      : "text-muted-foreground";
