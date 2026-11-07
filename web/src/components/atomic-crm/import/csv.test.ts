import { describe, expect, it } from "vitest";
import {
  countPossibleDuplicates,
  normalizeAmount,
  normalizeDate,
  parseCsv,
  parseCsvRows,
  suggestMapping,
  toRows,
} from "./csv";

describe("parseCsvRows", () => {
  it("handles quotes, escaped quotes, commas and newlines in quotes", () => {
    const rows = parseCsvRows('a,b\n"x, y","say ""hi""\nline2"\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nline2'],
    ]);
  });
  it("handles CRLF, BOM, missing trailing newline and blank lines", () => {
    expect(parseCsvRows("﻿a,b\r\n1,2\r\n\r\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });
  it("keeps empty fields", () => {
    expect(parseCsvRows("a,,c\n,,\n1,,")).toEqual([
      ["a", "", "c"],
      ["1", "", ""],
    ]);
  });
});

describe("parseCsv", () => {
  it("builds records and dedupes headers", () => {
    const { headers, records } = parseCsv("Name,Name,\nA,B,C\nD");
    expect(headers).toEqual(["Name", "Name (2)", "Column 3"]);
    expect(records[1]).toEqual({ Name: "D", "Name (2)": "", "Column 3": "" });
  });
});

describe("suggestMapping", () => {
  it("maps synonyms case/space-insensitively", () => {
    const m = suggestMapping([
      "Donor Name",
      "E-mail",
      "Amount ($)",
      "Donation Date",
      "Method",
      "Company",
      "Zip",
    ]);
    expect(m.full_name).toBe("Donor Name");
    expect(m.email).toBe("E-mail");
    expect(m.amount).toBe("Amount ($)");
    expect(m.gift_date).toBe("Donation Date");
    expect(m.channel).toBe("Method");
    expect(m.org_name).toBe("Company");
    expect(Object.values(m)).not.toContain("Zip");
    expect(m.phone).toBeNull();
  });
  it("uses a header only once", () => {
    const m = suggestMapping(["Gift", "Date"]);
    expect(m.amount).toBe("Gift");
    expect(m.gift_date).toBe("Date");
  });
});

describe("normalizeDate", () => {
  it.each([
    ["2025-11-19", "2025-11-19"],
    ["11/19/2025", "2025-11-19"],
    ["1/5/25", "2025-01-05"],
    ["11/19/99", "1999-11-19"],
    ["Nov 19, 2025", "2025-11-19"],
    ["19 Nov 2025", "2025-11-19"],
    ["November 3 2024", "2024-11-03"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDate(input)).toBe(expected);
  });
  it("rejects invalid dates", () => {
    expect(normalizeDate("13/45/2025")).toBeNull();
    expect(normalizeDate("2025-02-30")).toBeNull();
    expect(normalizeDate("soon")).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});

describe("normalizeAmount", () => {
  it("strips currency formatting", () => {
    expect(normalizeAmount("$1,250.00")).toBe(1250);
    expect(normalizeAmount(" 75 ")).toBe(75);
    expect(normalizeAmount("12.5")).toBe(12.5);
  });
  it("returns null for junk", () => {
    expect(normalizeAmount("")).toBeNull();
    expect(normalizeAmount("n/a")).toBeNull();
  });
});

describe("toRows", () => {
  const mapping = suggestMapping([
    "First Name",
    "Last Name",
    "Email",
    "Amount",
    "Date",
    "Zip",
  ]);
  it("builds donors with at most one gift and unmapped notes", () => {
    const { rows, skipped } = toRows(
      "gifts.csv",
      [
        {
          "First Name": "Ana",
          "Last Name": "Diaz",
          Email: "ANA@Example.com",
          Amount: "$50",
          Date: "11/19/2025",
          Zip: "33101",
        },
        {
          "First Name": "Bo",
          "Last Name": "Li",
          Email: "",
          Amount: "",
          Date: "",
          Zip: "",
        },
        {
          "First Name": "",
          "Last Name": "",
          Email: "",
          Amount: "5",
          Date: "2025-01-01",
          Zip: "1",
        },
      ],
      mapping,
    );
    expect(skipped).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      full_name: "Ana Diaz",
      email: "ana@example.com",
      donor_type: "individual",
      notes: "Zip: 33101",
      source_row: "gifts.csv#2",
      gifts: [{ amount: 50, gift_date: "2025-11-19" }],
    });
    expect(rows[1].gifts).toEqual([]);
    expect(rows[1].source_row).toBe("gifts.csv#3");
    expect(rows[1].notes).toBeNull();
  });
  it("treats organization-only rows as organizations", () => {
    const { rows } = toRows(
      "o.csv",
      [{ Company: "Acme Fund" }],
      suggestMapping(["Company"]),
    );
    expect(rows[0]).toMatchObject({
      full_name: "Acme Fund",
      donor_type: "organization",
      org_name: "Acme Fund",
    });
  });
  it("falls back to the email when there is no name", () => {
    const { rows } = toRows(
      "e.csv",
      [{ Email: "x@y.org" }],
      suggestMapping(["Email"]),
    );
    expect(rows[0].full_name).toBe("x@y.org");
  });
});

describe("countPossibleDuplicates", () => {
  it("counts shared emails, phones and existing donors", () => {
    const base = {
      first_name: null,
      last_name: null,
      org_name: null,
      donor_type: "individual" as const,
      city: null,
      state: null,
      notes: null,
      gifts: [],
    };
    const rows = [
      {
        ...base,
        full_name: "A",
        email: "a@x.org",
        phone: null,
        source_row: "f#2",
      },
      {
        ...base,
        full_name: "A2",
        email: "a@x.org",
        phone: null,
        source_row: "f#3",
      },
      {
        ...base,
        full_name: "B",
        email: null,
        phone: "(305) 555-0100",
        source_row: "f#4",
      },
      {
        ...base,
        full_name: "B2",
        email: null,
        phone: "305-555-0100",
        source_row: "f#5",
      },
      {
        ...base,
        full_name: "C",
        email: "c@x.org",
        phone: null,
        source_row: "f#6",
      },
      {
        ...base,
        full_name: "D",
        email: "d@x.org",
        phone: null,
        source_row: "f#7",
      },
    ];
    expect(countPossibleDuplicates(rows, ["D@x.org"])).toBe(5);
  });
});
