import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";

import { parseDonorRow } from "../providers/local/parse";
import { parsePerson } from "../providers/local/crmParse";
import type { ApiDonorRow } from "../providers/local/apiTypes";
import { AutoMergeFlag, sourceContacts } from "./AutoMergeFlag";
import { isNonGiver, TAB_ONE } from "./personTab";

const html = (autoMerged?: boolean) =>
  renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <AutoMergeFlag
        personId={7}
        name="Elizabeth Fontaine"
        autoMerged={autoMerged}
        mergedFrom={2}
      />
    </QueryClientProvider>,
  );

const row = (extra: Partial<ApiDonorRow>): ApiDonorRow => ({
  id: 7,
  full_name: "Elizabeth Fontaine",
  first_name: "Elizabeth",
  last_name: "Fontaine",
  org_name: null,
  donor_type: "individual",
  email: null,
  emails_all: [],
  phone: null,
  city: null,
  state: null,
  fund_type: null,
  notes: null,
  score: 50,
  tier: "small",
  is_star: false,
  status: "active",
  why: null,
  score_as_of: null,
  ...extra,
});

describe("automatic-merge flag (#125)", () => {
  it("shows the amber ! only for a person merged automatically", () => {
    expect(html(true)).toContain('aria-label="Merged automatically, review"');
    expect(html(false)).toBe("");
    expect(html(undefined)).toBe(""); // older API without auto_merged: hidden
  });

  it("reads auto_merged and merged_from from donor and person payloads", () => {
    expect(
      parseDonorRow(
        row({ auto_merged: true, merged_from: 3, contact_type: "neighbor" }),
      ),
    ).toMatchObject({
      auto_merged: true,
      merged_from: 3,
      contact_type: "neighbor",
    });
    expect(parseDonorRow(row({}))).toMatchObject({
      auto_merged: false,
      merged_from: 0,
      contact_type: null,
    });
    expect(
      parsePerson(
        { id: 1, full_name: "Liz F.", auto_merged: true, merged_from: 2 },
        "giver",
      ),
    ).toMatchObject({
      auto_merged: true,
      merged_from: 2,
    });
  });

  it("labels neighbors and community members by tab, not as donors", () => {
    expect(isNonGiver("neighbor") && TAB_ONE.neighbor).toBe("Neighbor");
    expect(isNonGiver("community") && TAB_ONE.community).toBe(
      "Community member",
    );
    expect(isNonGiver("giver")).toBe(false);
    expect(isNonGiver(null)).toBe(false);
  });

  it("lists both the email and the phone of a source record", () => {
    const src = { email: "liz.f@example.com", phone: "305-555-0104" };
    expect(sourceContacts(src, "local")).toEqual([
      "liz.f@example.com",
      "(305) 555-0104",
    ]);
    expect(sourceContacts(src, "snapshot")).toEqual([
      "liz.f@example.com",
      "(305) 555-0104",
    ]);
    expect(sourceContacts({ email: null, phone: "305-555-0104" }, "local")).toEqual([
      "(305) 555-0104",
    ]);
    expect(sourceContacts({ email: null, phone: null }, "local")).toEqual([]);
  });
});
