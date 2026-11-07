import { describe, expect, it } from "vitest";
import {
  cadence,
  combineGifts,
  defaultMapping,
  donorsFromRows,
  duplicates,
  mergeDonors,
  parseCSV,
  validateImport,
  validDate,
} from "../src/domain";
import type { Donor, Gift } from "../src/domain";
import { sampleDonors, SAMPLE_CSV } from "../src/sample";
const gift = (id: string, date: string, amount = 100): Gift => ({
  id,
  date,
  amount,
  source: "test",
  refs: [`test.csv · ${id}`],
});
const donor = (dates: string[]): Donor => ({
  id: "d",
  name: "Fictional Donor",
  email: "sample@example.org",
  gifts: dates.map((d, i) => gift(String(i), d)),
});
describe("CSV staging and validation", () => {
  it("handles BOM, CRLF, quoted commas, escaped quotes and quoted newlines", () => {
    expect(
      parseCSV('\uFEFFname,note\r\n"Doe, Jules","line one\nline ""two"""\r\n'),
    ).toEqual([
      ["name", "note"],
      ["Doe, Jules", 'line one\nline "two"'],
    ]);
  });
  it.each([
    "a,a\n1,2",
    "a,b\n1",
    'a\n"unfinished',
    'a\n"closed"bad',
    'a\nb"ad',
  ])("rejects malformed CSV %s", (text) =>
    expect(() => parseCSV(text)).toThrow(),
  );
  it("previews and imports the complete fictional sample", () => {
    const csv = parseCSV(SAMPLE_CSV);
    const result = validateImport(csv, defaultMapping(csv[0]));
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(18);
    expect(donorsFromRows(result.rows, "test.csv")).toHaveLength(8);
  });
  it("rejects impossible dates, future gifts, missing values and invalid amounts before mutation", () => {
    const csv = parseCSV(
      SAMPLE_CSV.replace("2026-09-30,100", "2026-02-30,-100"),
    );
    const result = validateImport(csv, defaultMapping(csv[0]));
    expect(result.errors.join()).toContain("valid YYYY-MM-DD");
    expect(result.errors.join()).toContain("positive USD");
    expect(validDate("2026-02-29")).toBe(false);
    expect(validDate("2024-02-29")).toBe(true);
    const future = parseCSV(SAMPLE_CSV.replace("2026-09-30", "2027-10-01"));
    expect(
      validateImport(future, defaultMapping(future[0])).errors,
    ).not.toHaveLength(0);
  });
  it("requires unique column mappings and consistent donor IDs", () => {
    const csv = parseCSV(SAMPLE_CSV);
    const mapping = defaultMapping(csv[0]);
    expect(
      validateImport(csv, { ...mapping, email: "name" }).errors,
    ).not.toHaveLength(0);
    csv[2][1] = "Someone Else";
    expect(validateImport(csv, mapping).errors.join()).toContain(
      "conflicting names",
    );
  });
  it("retains every source reference for a repeated identical transaction ID", () => {
    const csv = parseCSV(SAMPLE_CSV);
    csv.push(csv[1]);
    const result = validateImport(csv, defaultMapping(csv[0]));
    const ds = donorsFromRows(result.rows, "fixture.csv");
    const rosa = ds.find((d) => d.id === "rosa")!;
    expect(rosa.gifts).toHaveLength(3);
    expect(rosa.gifts.find((g) => g.id === "R-104")!.refs).toHaveLength(2);
  });
  it("rejects conflicting transaction amounts even across donor records", () => {
    const csv = parseCSV(SAMPLE_CSV);
    const copy = [...csv[1]];
    copy[0] = "other";
    copy[5] = "999";
    csv.push(copy);
    expect(validateImport(csv, defaultMapping(csv[0])).errors.join()).toContain(
      "conflicting date or amount",
    );
  });
});
describe("human identity review and gift preservation", () => {
  it("suggests Rosa only, without mutating records", () => {
    const ds = sampleDonors();
    const matches = duplicates(ds);
    expect(matches).toHaveLength(1);
    expect(ds).toHaveLength(8);
    expect(matches[0].reason).toContain("shared address");
  });
  it("merges after an explicit decision and preserves unique gifts, totals, and source rows", () => {
    const ds = sampleDonors();
    const before = ds.flatMap((d) => d.gifts).reduce((s, g) => s + g.amount, 0);
    const merged = mergeDonors(ds, "rosa", "rosa-alt");
    expect(merged).toHaveLength(7);
    const rosa = merged.find((d) => d.id === "rosa")!;
    expect(rosa.gifts).toHaveLength(4);
    expect(rosa.gifts.reduce((s, g) => s + g.amount, 0)).toBe(400);
    expect(
      merged.flatMap((d) => d.gifts).reduce((s, g) => s + g.amount, 0),
    ).toBe(before);
    expect(rosa.gifts.flatMap((g) => g.refs)).toHaveLength(4);
    expect(ds).toHaveLength(8);
  });
  it("counts identical transaction IDs once and retains both provenance references", () => {
    const a = gift("same", "2026-01-01");
    const b = { ...a, refs: ["other.csv · row 2"] };
    const result = combineGifts([a], [b]);
    expect(result).toHaveLength(1);
    expect(result[0].refs).toHaveLength(2);
  });
  it("keeps two real transactions sharing the same date and amount", () => {
    expect(
      combineGifts([gift("one", "2026-01-01")], [gift("two", "2026-01-01")]),
    ).toHaveLength(2);
  });
  it("rejects conflicting IDs rather than silently dropping a gift", () => {
    expect(() =>
      combineGifts(
        [gift("one", "2026-01-01")],
        [gift("one", "2026-01-01", 200)],
      ),
    ).toThrow("conflicting");
  });
});
describe("explainable personal cadence", () => {
  it("flags Rosa exactly at the seven-day grace boundary", () => {
    const rosa = sampleDonors().find((d) => d.id === "rosa")!;
    expect(cadence(rosa, "2026-11-05").overdue).toBe(false);
    expect(cadence(rosa)).toMatchObject({
      expected: "2026-10-30",
      graceEnd: "2026-11-06",
      overdue: true,
      daysLate: 8,
    });
    expect(cadence(rosa, "2026-11-06").overdue).toBe(true);
  });
  it("requires three historical dates, excluding future gifts", () => {
    expect(
      cadence(donor(["2026-09-01", "2026-10-01", "2027-01-01"])).expected,
    ).toBeNull();
  });
  it("handles month-end clamping across February", () => {
    expect(
      cadence(donor(["2025-11-30", "2025-12-31", "2026-01-31"]), "2026-02-01")
        .expected,
    ).toBe("2026-02-28");
  });
  it("does not label a December annual gift missed in November", () => {
    expect(
      cadence(donor(["2023-12-15", "2024-12-15", "2025-12-15"])),
    ).toMatchObject({ overdue: false });
  });
  it("uses median spacing and disregards a duplicate gift date", () => {
    const d = donor(["2026-01-01", "2026-01-11", "2026-01-21", "2026-01-21"]);
    expect(cadence(d).expected).toBe("2026-01-31");
  });
});
