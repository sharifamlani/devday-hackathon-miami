import type {
  ImportedDonorRow,
  ImportedGift,
  ImportMapping,
} from "../providers/local/types";

/** Contract fields a CSV column can be mapped to, in display order. */
export const IMPORT_FIELDS = [
  { key: "full_name", label: "Full name" },
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "org_name", label: "Organization" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "amount", label: "Gift amount" },
  { key: "gift_date", label: "Gift date" },
  { key: "channel", label: "Channel" },
  { key: "fund_type", label: "Fund" },
  { key: "notes", label: "Notes" },
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number]["key"];

export type CsvRecord = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  records: CsvRecord[];
}

/** RFC-4180-ish: quoted fields, "" escapes, commas/newlines in quotes, CRLF, BOM. */
export const parseCsvRows = (input: string): string[][] => {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      field += ch;
    }
    i++;
  }
  if (field !== "" || row.length > 0) endRow();
  // Drop fully blank lines.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
};

/** First row is the header; duplicate or blank headers are made unique. */
export const parseCsv = (text: string): ParsedCsv => {
  const [rawHeaders = [], ...body] = parseCsvRows(text);
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((raw, index) => {
    const base = raw.trim() || `Column ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
  const records = body.map((cells) => {
    const record: CsvRecord = {};
    headers.forEach((header, index) => {
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });
  return { headers, records };
};

const normalizeHeader = (header: string) =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

const SYNONYMS: Record<ImportField, string[]> = {
  full_name: [
    "name",
    "fullname",
    "donor",
    "donorname",
    "contactname",
    "contact",
  ],
  first_name: ["firstname", "first", "givenname", "fname"],
  last_name: ["lastname", "last", "surname", "familyname", "lname"],
  org_name: [
    "organization",
    "organisation",
    "org",
    "orgname",
    "organizationname",
    "company",
    "companyname",
    "employer",
  ],
  email: ["email", "emailaddress", "mail", "emailaddr"],
  phone: [
    "phone",
    "phonenumber",
    "mobile",
    "cell",
    "cellphone",
    "telephone",
    "tel",
  ],
  city: ["city", "town"],
  state: ["state", "province", "stateprovince"],
  amount: [
    "amount",
    "gift",
    "giftamount",
    "donation",
    "donationamount",
    "total",
    "value",
  ],
  gift_date: [
    "date",
    "giftdate",
    "donationdate",
    "dateofgift",
    "receiveddate",
    "paymentdate",
  ],
  channel: ["source", "channel", "method", "paymentmethod", "giftsource"],
  fund_type: ["fund", "fundtype", "designation", "campaign", "appeal"],
  notes: ["notes", "note", "comments", "comment", "memo"],
};

/** Prefill the column mapper. Each header is used for at most one field. */
export const suggestMapping = (headers: string[]): ImportMapping => {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  for (const { key } of IMPORT_FIELDS) {
    const match = headers.find(
      (header) =>
        !used.has(header) && SYNONYMS[key].includes(normalizeHeader(header)),
    );
    mapping[key] = match ?? null;
    if (match) used.add(match);
  }
  return mapping;
};

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const isoDate = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
};

const expandYear = (year: string) => {
  const n = Number(year);
  if (year.length > 2) return n;
  return n <= 69 ? 2000 + n : 1900 + n;
};

const monthFromName = (name: string) =>
  MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

/** YYYY-MM-DD, M/D/YYYY, MM/DD/YY, "Nov 19, 2025", "19 Nov 2025" -> YYYY-MM-DD. */
export const normalizeDate = (value: string): string | null => {
  const text = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (m) return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (m) return isoDate(expandYear(m[3]), Number(m[1]), Number(m[2]));
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(text);
  if (m) {
    const month = monthFromName(m[1]);
    return month ? isoDate(Number(m[3]), month, Number(m[2])) : null;
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(text);
  if (m) {
    const month = monthFromName(m[2]);
    return month ? isoDate(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
};

/** "$1,250.00" -> 1250. Null when there is no usable number. */
export const normalizeAmount = (value: string): number | null => {
  const cleaned = value.replace(/[$\s,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
};

const clean = (value: string | undefined) => {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
};

export interface ToRowsResult {
  rows: ImportedDonorRow[];
  /** rows with neither a name nor an email */
  skipped: number;
}

/**
 * One CSV row becomes one donor with at most one gift. Rows without a
 * parseable amount and date keep the donor and get gifts: [].
 */
export const toRows = (
  fileName: string,
  records: CsvRecord[],
  mapping: ImportMapping,
): ToRowsResult => {
  const mappedHeaders = new Set(
    Object.values(mapping).filter((h): h is string => !!h),
  );
  const rows: ImportedDonorRow[] = [];
  let skipped = 0;

  records.forEach((record, index) => {
    const get = (field: ImportField) => {
      const header = mapping[field];
      return header ? clean(record[header]) : null;
    };
    const first = get("first_name");
    const last = get("last_name");
    const org = get("org_name");
    const explicitName = get("full_name");
    const email = get("email")?.toLowerCase() ?? null;

    const personName = [first, last].filter(Boolean).join(" ");
    const fullName = explicitName || personName || org || email;
    if (!fullName) {
      skipped += 1;
      return;
    }

    const amountText = get("amount");
    const dateText = get("gift_date");
    const amount = amountText ? normalizeAmount(amountText) : null;
    const date = dateText ? normalizeDate(dateText) : null;
    const gifts: ImportedGift[] =
      amount !== null && amount > 0 && date
        ? [
            {
              amount,
              gift_date: date,
              channel: get("channel"),
              fund_type: get("fund_type"),
            },
          ]
        : [];

    const noteParts: string[] = [];
    const mappedNotes = get("notes");
    if (mappedNotes) noteParts.push(mappedNotes);
    for (const [header, value] of Object.entries(record)) {
      if (!mappedHeaders.has(header) && value.trim() !== "") {
        noteParts.push(`${header}: ${value.trim()}`);
      }
    }

    rows.push({
      full_name: fullName,
      first_name: first,
      last_name: last,
      org_name: org,
      donor_type:
        org && !first && !last && !explicitName ? "organization" : "individual",
      email,
      phone: get("phone"),
      city: get("city"),
      state: get("state"),
      notes: noteParts.length > 0 ? noteParts.join("; ") : null,
      source_row: `${fileName}#${index + 2}`,
      gifts,
    });
  });

  return { rows, skipped };
};

const phoneKey = (phone: string | null) => {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits.slice(-10) : null;
};

/** Rows whose email or phone matches another row, or an existing donor email. */
export const countPossibleDuplicates = (
  rows: ImportedDonorRow[],
  existingEmails: Iterable<string | null | undefined> = [],
): number => {
  const existing = new Set<string>();
  for (const e of existingEmails) if (e) existing.add(e.toLowerCase());
  const counts = new Map<string, number>();
  const keysOf = (row: ImportedDonorRow) => {
    const keys: string[] = [];
    if (row.email) keys.push(`e:${row.email}`);
    const phone = phoneKey(row.phone);
    if (phone) keys.push(`p:${phone}`);
    return keys;
  };
  for (const row of rows) {
    for (const key of keysOf(row)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.filter(
    (row) =>
      (row.email && existing.has(row.email)) ||
      keysOf(row).some((key) => (counts.get(key) ?? 0) > 1),
  ).length;
};
