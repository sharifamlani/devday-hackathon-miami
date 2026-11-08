import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiDonorDetail, ApiDonorRow, ApiSnapshot } from "./apiTypes";
import { parseDonorDetail, parseMergeResult } from "./parse";
import { __resetSnapshotForTests, snapshotMethods } from "./snapshotClient";
import type { ImportedDonorRow } from "./types";

const AS_OF = "2026-11-08";

const detail = (
  id: number,
  name: string,
  email: string | null,
  gifts: [number, string, number][], // [gift id, date, amount]
  phone: string | null = null,
): ApiDonorDetail => ({
  id,
  full_name: name,
  first_name: null,
  last_name: null,
  org_name: null,
  donor_type: "individual",
  email,
  emails_all: email ? [email] : [],
  phone,
  city: "Miami",
  state: "FL",
  fund_type: null,
  notes: null,
  score: 50,
  tier: "mid",
  is_star: false,
  is_sample: false,
  status: "on_track",
  why: {
    status: "on_track",
    reasons: [],
    as_of: AS_OF,
    gift_count: gifts.length,
  },
  score_as_of: AS_OF,
  gifts: gifts.map(([gid, date, amount]) => ({
    id: gid,
    donor_id: id,
    amount,
    gift_date: date,
    channel: null,
    fund_type: null,
  })),
  research_facts: [],
  outreach_drafts: [],
});

const row = (d: ApiDonorDetail): ApiDonorRow => {
  const { gifts: _g, research_facts: _r, outreach_drafts: _o, ...rest } = d;
  return rest;
};

const makeSnapshot = (): ApiSnapshot => {
  const a = detail(1, "Ana Diaz", "ana@example.org", [[1, "2025-05-01", 100]], "(305) 555-0101");
  const b = detail(2, "Ana M Diaz", "ana.diaz@example.org", [[2, "2024-03-01", 250]]);
  const c = detail(3, "Carl Cho", "carl@example.org", [[3, "2023-01-01", 40]]);
  const d = detail(4, "Dee Doe", "dee@example.org", []);
  return {
    meta: {
      as_of: AS_OF,
      generated_at: "2026-11-07T00:00:00Z",
      label: "Cached sample",
      donor_count: 4,
      source: "test",
    },
    donors: [a, b, c, d].map(row),
    donor_details: { "1": a, "2": b, "3": c, "4": d },
    duplicates: [
      {
        id: 10,
        donor_a_id: 1,
        donor_b_id: 2,
        reasons: ["similar name"],
        confidence: 0.8,
        status: "pending",
        donor_a: row(a),
        donor_b: row(b),
        donor_a_gift_count: 1,
        donor_b_gift_count: 1,
      },
      {
        id: 11,
        donor_a_id: 2,
        donor_b_id: 3,
        reasons: ["same city"],
        confidence: 0.5,
        status: "pending",
        donor_a: row(b),
        donor_b: row(c),
        donor_a_gift_count: 1,
        donor_b_gift_count: 1,
      },
    ],
  };
};

const imported = (over: Partial<ImportedDonorRow>): ImportedDonorRow => ({
  full_name: "New Person",
  first_name: null,
  last_name: null,
  org_name: null,
  donor_type: "individual",
  email: null,
  phone: null,
  city: null,
  state: null,
  notes: null,
  source_row: "list.csv#2",
  gifts: [],
  ...over,
});

const methods = snapshotMethods;

beforeEach(() => {
  __resetSnapshotForTests(); // a fresh snapshot (and merge log) per test
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(makeSnapshot()), { status: 200 })),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("parse: merges", () => {
  it("defaults to [] when the server predates the merge log", () => {
    expect(parseDonorDetail(detail(1, "A", null, [])).merges).toEqual([]);
  });

  it("parses defensively and sorts newest first", () => {
    const parsed = parseDonorDetail({
      ...detail(1, "A", null, []),
      merges: [
        { id: 1, kept_id: 1, merged_id: 2, merged_name: "B", merged_at: "t1" },
        {
          id: 2,
          kept_id: 1,
          merged_id: 3,
          merged_name: "C",
          merged_email: "c@x.org",
          merged_emails: null,
          gifts_moved: 2,
          merged_at: "t2",
          can_undo: true,
        },
      ],
    });
    expect(parsed.merges.map((m) => m.id)).toEqual([2, 1]);
    expect(parsed.merges[0]).toMatchObject({
      merged_emails: ["c@x.org"],
      gifts_moved: 2,
      can_undo: true,
      undone_at: null,
    });
    expect(parsed.merges[1]).toMatchObject({ can_undo: false, gifts_moved: 0, merged_emails: [] });
  });

  it("reads merge_id, null when missing", () => {
    expect(parseMergeResult({ kept_donor_id: 1, removed_donor_id: 2, merge_id: 7 }).merge_id).toBe(7);
    expect(parseMergeResult({ kept_donor_id: 1, removed_donor_id: 2 }).merge_id).toBeNull();
  });
});

describe("snapshot merge + undo", () => {
  it("logs the merge on the kept donor with can_undo", async () => {
    const result = await methods.mergeDuplicate(10, 1);
    expect(result).toMatchObject({ kept_id: 1, merged_id: 2, merge_id: 1 });
    const kept = await methods.getDonor(1);
    expect(kept.gifts).toHaveLength(2);
    expect(kept.merges).toHaveLength(1);
    expect(kept.merges[0]).toMatchObject({
      id: 1,
      kept_id: 1,
      merged_id: 2,
      merged_name: "Ana M Diaz",
      merged_email: "ana.diaz@example.org",
      gifts_moved: 1,
      can_undo: true,
      undone_at: null,
    });
    expect((await methods.getDonors()).map((d) => d.id)).not.toContain(2);
    await expect(methods.getDonor(2)).rejects.toThrow();
    expect((await methods.getDuplicates()).map((p) => p.id)).toEqual([]);
  });

  it("restores both donors, gifts and duplicate pairs exactly", async () => {
    const donorsBefore = await methods.getDonors();
    const keptBefore = await methods.getDonor(1);
    const mergedBefore = await methods.getDonor(2);
    const pairsBefore = await methods.getDuplicates();

    const { merge_id } = await methods.mergeDuplicate(10, 1);
    const undone = await methods.undoMerge(merge_id!);
    expect(undone).toEqual({ kept_id: 1, restored_id: 2 });

    expect(await methods.getDonors()).toEqual(donorsBefore);
    expect(await methods.getDuplicates()).toEqual(pairsBefore);
    expect(await methods.getDonor(2)).toEqual(mergedBefore);
    const keptAfter = await methods.getDonor(1);
    expect(keptAfter.gifts).toEqual(keptBefore.gifts);
    expect(keptAfter.merges[0]).toMatchObject({ can_undo: false });
    expect(keptAfter.merges[0].undone_at).toBeTruthy();
  });

  it("rejects unknown, already-undone and not-newest merges", async () => {
    await expect(methods.undoMerge(99)).rejects.toThrow(/not found/);
    const first = await methods.mergeDuplicate(10, 1); // 1 keeps 2
    // pair 11 (2 vs 3) went away with donor 2; build a second merge on donor 1.
    await methods.undoMerge(first.merge_id!);
    await expect(methods.undoMerge(first.merge_id!)).rejects.toThrow(/already undone/);

    const m1 = await methods.mergeDuplicate(10, 1);
    const imp = await methods.importDonors({
      files: [],
      mapping: {},
      rows: [imported({ full_name: "Ana Again", email: "ANA@example.org" })],
    });
    expect(imp.duplicates).toBe(1);
    const newPair = (await methods.getDuplicates())[0];
    const m2 = await methods.mergeDuplicate(newPair.id, 1);
    expect((await methods.getDonor(1)).merges.map((m) => [m.id, m.can_undo])).toEqual([
      [m2.merge_id, true],
      [m1.merge_id, false],
      [first.merge_id, false], // the earlier, already-undone merge stays in history
    ]);
    await expect(methods.undoMerge(m1.merge_id!)).rejects.toThrow(/newer merge/);
    await methods.undoMerge(m2.merge_id!);
    await methods.undoMerge(m1.merge_id!);
    expect((await methods.getDonors()).map((d) => d.id)).toContain(2);
  });
});

describe("snapshot import", () => {
  it("adds donors above the current max id with computed tier and status", async () => {
    const result = await methods.importDonors({
      files: [],
      mapping: {},
      rows: [
        imported({
          full_name: "Big Giver",
          gifts: [
            { amount: 60000, gift_date: "2026-06-01", channel: "Check", fund_type: "General" },
            { amount: 50000, gift_date: "2025-06-01", channel: null, fund_type: null },
          ],
        }),
        imported({
          full_name: "Old Mid",
          gifts: [{ amount: 12000, gift_date: "2024-01-01", channel: null, fund_type: null }],
        }),
        imported({ full_name: "Nobody" }),
      ],
    });
    expect(result).toEqual({
      donors: 3,
      gifts: 3,
      duplicates: 0,
      message: "Imported 3 donors and 3 gifts into this tab (sample mode)",
      raw: null,
    });
    const list = await methods.getDonors();
    const [big, mid, none] = list.slice(4);
    expect([big.id, mid.id, none.id]).toEqual([5, 6, 7]);
    expect(big).toMatchObject({ tier: "big", status: "on_track", score: 0, is_star: false, is_sample: false });
    expect(big.total_given).toBe(110000);
    expect(big.why_short).toBe("Imported · not scored yet (scoring runs on the live service)");
    expect(mid).toMatchObject({ tier: "mid", status: "lapsed" });
    expect(none).toMatchObject({ tier: "small", status: "no_gifts", gift_count: 0 });
    const d = await methods.getDonor(5);
    expect(d.gifts.map((g) => g.amount)).toEqual([60000, 50000]);
    expect(new Set(d.gifts.map((g) => g.id)).size).toBe(2);
  });

  it("flags duplicates by email (case-insensitive) and phone (last 10 digits)", async () => {
    const result = await methods.importDonors({
      files: [],
      mapping: {},
      rows: [
        imported({ full_name: "A", email: "CARL@example.org" }),
        imported({ full_name: "B", phone: "+1 305.555.0101" }),
        imported({ full_name: "C", email: "carl@example.org", phone: "3055550101" }),
      ],
    });
    // A~Carl, B~Ana, C~Carl, C~Ana, C~A (email), C~B (phone)
    expect(result.duplicates).toBe(6);
    const pairs = await methods.getDuplicates();
    const reasonsFor = (a: number, b: number) =>
      pairs.find((p) => p.donors[0].id === a && p.donors[1].id === b)?.reasons;
    expect(reasonsFor(3, 5)).toEqual(["same email: carl@example.org"]);
    expect(reasonsFor(1, 6)).toEqual(["same phone: +1 305.555.0101"]);
    expect(reasonsFor(5, 7)).toEqual(["same email: carl@example.org"]);
    expect(pairs.find((p) => p.donors[1].id === 7 && p.donors[0].id === 6)?.reasons[0]).toMatch(/^same phone/);
    expect(pairs.filter((p) => p.confidence === 0.9)).toHaveLength(6);
    expect(new Set(pairs.map((p) => p.id)).size).toBe(pairs.length);
  });
});
