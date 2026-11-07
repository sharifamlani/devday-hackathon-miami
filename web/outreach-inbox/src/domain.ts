/** Browser-only demo domain. Dates are calendar dates, never browser-local instants. */
export const DEMO_TODAY = "2026-11-07";
export type Gift = {
  id: string;
  date: string;
  amount: number;
  source: string;
  refs: string[];
};
export type Donor = {
  id: string;
  name: string;
  email: string;
  gifts: Gift[];
  note?: string;
  priority?: boolean;
  call?: { seconds: number; reason: string };
  status?: "done" | "snoozed";
  outcome?: string;
};
export type ImportRow = {
  donor_id: string;
  name: string;
  email: string;
  gift_id: string;
  gift_date: string;
  amount: string;
  source: string;
  row: number;
};
export const REQUIRED = [
  "donor_id",
  "name",
  "email",
  "gift_id",
  "gift_date",
  "amount",
] as const;
export const FIELDS = [...REQUIRED, "source"] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<Field, string>;
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
const dayMs = 86400000;
const stamp = (s: string) => Date.parse(s + "T12:00:00Z");
const addDays = (date: string, days: number) =>
  new Date(stamp(date) + days * dayMs).toISOString().slice(0, 10);
export function validDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(stamp(s)) &&
    new Date(stamp(s)).toISOString().slice(0, 10) === s
  );
}
function nextMonth(s: string) {
  const d = new Date(stamp(s));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function cadence(donor: Donor, today = DEMO_TODAY) {
  const dates = [
    ...new Set(donor.gifts.filter((g) => g.date <= today).map((g) => g.date)),
  ].sort();
  if (dates.length < 3)
    return {
      label: "Needs more history",
      overdue: false,
      daysLate: 0,
      expected: null,
      graceEnd: null,
      evidence: dates,
    };
  const gaps = dates
    .slice(1)
    .map((d, i) => Math.round((stamp(d) - stamp(dates[i])) / dayMs))
    .sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const typical = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  const monthly = gaps.every((g) => g >= 28 && g <= 31);
  const expected = monthly
    ? nextMonth(dates.at(-1)!)
    : addDays(dates.at(-1)!, Math.round(typical));
  const daysLate = Math.max(
    0,
    Math.floor((stamp(today) - stamp(expected)) / dayMs),
  );
  return {
    label: monthly
      ? "Monthly supporter"
      : `Usually every ${Math.round(typical)} days`,
    overdue: today >= addDays(expected, 7),
    daysLate,
    expected,
    graceEnd: addDays(expected, 7),
    evidence: dates,
  };
}
/** RFC 4180-style CSV: handles BOM, CRLF, quoted newlines and escaped quotes. */
export function parseCSV(text: string): string[][] {
  if (text.length > 2_000_000)
    throw new Error("Choose a CSV smaller than 2 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
    closed = false;
  };
  const pushRow = () => {
    pushCell();
    if (row.some(Boolean)) rows.push(row);
    row = [];
  };
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
    } else if (c === '"') {
      if (cell || closed)
        throw new Error("Unexpected quote in CSV. Quote the entire field.");
      quoted = true;
    } else if (c === ",") pushCell();
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      pushRow();
    } else {
      if (closed && c.trim())
        throw new Error("Unexpected text after a quoted field.");
      if (!closed) cell += c;
    }
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field.");
  if (cell || row.length || closed) pushRow();
  if (rows.length < 2)
    throw new Error("Add a header row and at least one gift row.");
  if (rows.length > 5001)
    throw new Error("This demo supports up to 5,000 gift rows.");
  if (new Set(rows[0]).size !== rows[0].length || rows[0].some((h) => !h))
    throw new Error("Column headers must be unique and nonempty.");
  if (rows.some((r) => r.length !== rows[0].length))
    throw new Error(
      "Every row must have the same number of columns as the header.",
    );
  return rows;
}
export function defaultMapping(headers: string[]): Mapping {
  return Object.fromEntries(
    FIELDS.map((f) => [
      f,
      headers.find((h) => h.toLowerCase().replaceAll(" ", "_") === f) ?? "",
    ]),
  ) as Mapping;
}
export function validateImport(
  csv: string[][],
  mapping: Mapping,
): { rows: ImportRow[]; errors: string[] } {
  const errors: string[] = [];
  const selected = FIELDS.map((f) => mapping[f]).filter(Boolean);
  if (REQUIRED.some((f) => !mapping[f]))
    return { rows: [], errors: ["Map every required field before importing."] };
  if (new Set(selected).size !== selected.length)
    return { rows: [], errors: ["Map each CSV column to only one field."] };
  if (selected.some((h) => !csv[0].includes(h)))
    return { rows: [], errors: ["A mapped column is missing from this file."] };
  const rows = csv.slice(1).map((r, i) => {
    const value = (f: Field) => r[csv[0].indexOf(mapping[f])] ?? "";
    return {
      ...Object.fromEntries(FIELDS.map((f) => [f, value(f)])),
      row: i + 2,
    } as ImportRow;
  });
  const identities = new Map<string, string>();
  const giftKeys = new Map<string, string>();
  for (const row of rows) {
    const fail = (s: string) => errors.push(`Row ${row.row}: ${s}`);
    if (REQUIRED.some((f) => !row[f].trim()))
      fail("a required value is missing.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
      fail("check the email address.");
    if (!validDate(row.gift_date) || row.gift_date > DEMO_TODAY)
      fail(`use a valid YYYY-MM-DD gift date on or before ${DEMO_TODAY}.`);
    if (
      !/^\d+(\.\d{1,2})?$/.test(row.amount) ||
      !Number.isFinite(Number(row.amount)) ||
      Number(row.amount) <= 0 ||
      Number(row.amount) > 1e9
    )
      fail("amount must be positive USD with at most two decimal places.");
    const identity = `${row.name.toLowerCase()}|${row.email.toLowerCase()}`;
    if (
      identities.has(row.donor_id) &&
      identities.get(row.donor_id) !== identity
    )
      fail(
        "donor_id refers to conflicting names or emails. Use separate IDs and review a merge.",
      );
    identities.set(row.donor_id, identity);
    const giftKey = `${row.gift_date}|${Number(row.amount)}`;
    if (giftKeys.has(row.gift_id) && giftKeys.get(row.gift_id) !== giftKey)
      fail("gift_id has conflicting date or amount.");
    giftKeys.set(row.gift_id, giftKey);
  }
  return { rows, errors };
}
export function donorsFromRows(rows: ImportRow[], fileName: string): Donor[] {
  const donors = new Map<string, Donor>();
  for (const r of rows) {
    let donor = donors.get(r.donor_id);
    if (!donor) {
      donor = {
        id: r.donor_id,
        name: r.name,
        email: r.email.toLowerCase(),
        gifts: [],
      };
      donors.set(r.donor_id, donor);
    }
    donor.gifts = combineGifts(donor.gifts, [
      {
        id: r.gift_id,
        date: r.gift_date,
        amount: Number(r.amount),
        source: r.source || fileName,
        refs: [`${fileName} · row ${r.row}`],
      },
    ]);
  }
  return [...donors.values()];
}
export function combineGifts(a: Gift[], b: Gift[]): Gift[] {
  const map = new Map<string, Gift>();
  for (const g of [...a, ...b]) {
    const old = map.get(g.id);
    if (old && (old.date !== g.date || old.amount !== g.amount))
      throw new Error(
        `Transaction ${g.id} has conflicting gift details. Resolve it before merging.`,
      );
    map.set(
      g.id,
      old
        ? { ...old, refs: [...new Set([...old.refs, ...g.refs])] }
        : { ...g, refs: [...g.refs] },
    );
  }
  return [...map.values()].sort((x, y) => y.date.localeCompare(x.date));
}
export type Match = { key: string; a: Donor; b: Donor; reason: string };
const normalizedName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
export function duplicates(donors: Donor[]): Match[] {
  const result: Match[] = [];
  for (let i = 0; i < donors.length; i++)
    for (let j = i + 1; j < donors.length; j++) {
      const a = donors[i],
        b = donors[j];
      const sameEmail =
        a.email.trim().toLowerCase() === b.email.trim().toLowerCase();
      const sameName = normalizedName(a.name) === normalizedName(b.name);
      if (sameEmail || sameName)
        result.push({
          key: [a.id, b.id].sort().join("|"),
          a,
          b,
          reason: sameEmail
            ? "Same email address; name differs. A shared address can belong to different people."
            : "Same name; different email addresses. Confirm these are the same person.",
        });
    }
  return result;
}
export function mergeDonors(
  donors: Donor[],
  keepId: string,
  otherId: string,
): Donor[] {
  const keep = donors.find((d) => d.id === keepId),
    other = donors.find((d) => d.id === otherId);
  if (!keep || !other || keepId === otherId)
    throw new Error("Select two different donor records.");
  return donors
    .filter((d) => d.id !== otherId)
    .map((d) =>
      d.id === keepId
        ? {
            ...keep,
            gifts: combineGifts(keep.gifts, other.gifts),
            note: [keep.note, other.note].filter(Boolean).join(" · "),
            priority: keep.priority || other.priority,
            call: keep.call ?? other.call,
          }
        : d,
    );
}
