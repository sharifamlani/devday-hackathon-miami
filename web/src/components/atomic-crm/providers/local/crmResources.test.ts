import type { DataProvider } from "ra-core";

import type { RawDonorDetail, RawDonorRow } from "./crmDonors";
import {
  createCrmResources,
  isCrmResource,
  withDonorCrm,
  type DonorSource,
} from "./crmResources";

const AS_OF = "2026-11-08";

const row = (id: number, over: Partial<RawDonorRow> = {}): RawDonorRow => ({
  id,
  full_name: `Donor ${id}`,
  first_name: "Donor",
  last_name: String(id),
  org_name: null,
  donor_type: "individual",
  email: `donor${id}@example.com`,
  emails_all: [],
  phone: null,
  city: "Miami",
  state: "FL",
  fund_type: null,
  notes: null,
  score: 50,
  tier: "mid",
  is_star: false,
  is_sample: true,
  status: "on_track",
  why: {
    status: "on_track",
    reasons: [],
    as_of: AS_OF,
    gift_count: 2,
    lifetime_total: 500,
    last_gift: { date: "2026-10-01", amount: 250, channel: null },
  },
  score_as_of: AS_OF,
  ...over,
});

const rows: RawDonorRow[] = [
  row(1, { score: 90, status: "lapsing" }),
  row(2, { score: 30, org_name: "Harbor Bakery" }),
  row(3, {
    full_name: "Sunrise Foundation",
    first_name: null,
    last_name: null,
    org_name: "Sunrise Foundation",
    donor_type: "organization",
    score: 60,
  }),
];

const detailOf = (r: RawDonorRow): RawDonorDetail => ({
  ...r,
  gifts: [],
  research_facts: [],
  outreach_drafts: [],
  call_notes:
    r.id === 1
      ? [
          {
            id: "call-1",
            title: "Check-in",
            created_at: "2026-11-07T10:00:00Z",
            duration_sec: 90,
            destinations: [{ kind: "donor", id: "1", label: "Donor 1" }],
            transcript: [],
            notes: "",
            summary: [],
            next_steps: [],
          },
        ]
      : undefined,
});

const source = (list = rows): DonorSource => ({
  rows: async () => list,
  detail: async (id) => {
    const r = list.find((x) => x.id === id);
    if (!r) throw new Error("missing");
    return detailOf(r);
  },
  details: async (ids) =>
    new Map(
      list.filter((r) => ids.includes(r.id)).map((r) => [r.id, detailOf(r)]),
    ),
  asOf: async () => AS_OF,
});

const listAll = {
  pagination: { page: 1, perPage: 50 },
  sort: { field: "score", order: "DESC" as const },
  filter: {},
};

describe("createCrmResources: donors as contacts", () => {
  it("lists donors by priority with totals", async () => {
    const crm = createCrmResources(source());
    const { data, total } = await crm.getList("contacts", listAll);
    expect(total).toBe(3);
    expect(data.map((c) => c.id)).toEqual([1, 3, 2]);
    expect(data[0]).toMatchObject({
      status_tags: ["needs_call", "late"],
      email: "d•••@example.com",
    });
  });

  it("filters and pages like react-admin asks", async () => {
    const crm = createCrmResources(source());
    const late = await crm.getList("contacts", {
      ...listAll,
      filter: { status_tag: "late" },
    });
    expect(late.data.map((c) => c.id)).toEqual([1]);
    const page = await crm.getList("contacts_summary", {
      ...listAll,
      pagination: { page: 2, perPage: 2 },
    });
    expect(page).toMatchObject({ total: 3 });
    expect(page.data.map((c) => c.id)).toEqual([2]);
  });

  it("returns the profile with the service's call notes", async () => {
    const crm = createCrmResources(source());
    const { data } = await crm.getOne("contacts", { id: 1 });
    expect(data.server_call_notes.map((n: { id: string }) => n.id)).toEqual([
      "call-1",
    ]);
  });

  it("keeps tag edits in this tab and leaves other fields alone", async () => {
    const crm = createCrmResources(source());
    await crm.update("contacts", {
      id: 2,
      data: { tags: [1, 3], score: 999, status: undefined },
      previousData: {} as never,
    });
    const { data } = await crm.getOne("contacts", { id: 2 });
    expect(data.tags).toEqual([1, 3]);
    expect(data.score).toBe(30);
    const tagged = await crm.getList("contacts", {
      ...listAll,
      filter: { "tags@cs": "{3}" },
    });
    expect(tagged.data.map((c) => c.id)).toEqual([2]);
  });

  it("drops a deleted tag from every donor", async () => {
    const crm = createCrmResources(source());
    await crm.update("contacts", {
      id: 1,
      data: { tags: [2] },
      previousData: {} as never,
    });
    await crm.delete("tags", { id: 2, previousData: { id: 2 } });
    expect((await crm.getOne("contacts", { id: 1 })).data.tags).toEqual([]);
  });

  it("refuses to create or delete donors here", async () => {
    const crm = createCrmResources(source());
    await expect(crm.create("contacts", { data: {} })).rejects.toThrow(
      /Import donors/,
    );
    await expect(
      crm.delete("contacts", { id: 1, previousData: { id: 1 } }),
    ).rejects.toThrow();
  });

  it("follows the donor list as it changes (a merge removes a donor)", async () => {
    const live = [...rows];
    const crm = createCrmResources(source(live));
    live.splice(1, 1);
    const { data } = await crm.getMany("contacts", { ids: [1, 2] });
    expect(data.map((c) => c.id)).toEqual([1]);
  });
});

describe("createCrmResources: notes and tasks", () => {
  it("counts open tasks and dates notes on the donor record", async () => {
    const crm = createCrmResources(source());
    await crm.create("tasks", {
      data: {
        contact_id: 2,
        type: "call",
        text: "Call",
        due_date: "2026-11-09",
        sales_id: 0,
      },
    });
    await crm.create("contact_notes", {
      data: {
        contact_id: 2,
        text: "Met at the gala",
        date: "2026-11-07T18:00:00.000Z",
        sales_id: 0,
      },
    });
    const { data } = await crm.getOne("contacts", { id: 2 });
    expect(data.nb_tasks).toBe(1);
    expect(data.last_seen).toBe("2026-11-07T18:00:00.000Z");
    const notes = await crm.getManyReference("contact_notes", {
      target: "contact_id",
      id: 2,
      pagination: { page: 1, perPage: 25 },
      sort: { field: "date", order: "DESC" as const },
      filter: {},
    });
    expect(notes.data.map((n) => n.text)).toEqual(["Met at the gala"]);
  });

  it("a done thank-you task after the last gift tags the donor thanked", async () => {
    const crm = createCrmResources(source());
    const { data: task } = await crm.create("tasks", {
      data: {
        contact_id: 1,
        type: "thank-you",
        text: "Thank",
        due_date: "2026-11-08",
      },
    });
    expect(task.created_at).toBeTruthy();
    await crm.update("tasks", {
      id: task.id,
      data: { ...task, done_date: "2026-11-08T09:00:00.000Z" },
      previousData: task,
    });
    const { data } = await crm.getOne("contacts", { id: 1 });
    expect(data.status_tags).toEqual(["late", "thanked"]);
    expect(data.nb_tasks).toBe(0);
  });

  it("starts with fundraising tags and filters tasks Atomic-style", async () => {
    const crm = createCrmResources(source());
    const tags = await crm.getList("tags", {
      ...listAll,
      sort: { field: "name", order: "ASC" as const },
    });
    expect(tags.data.map((t) => t.name)).toContain("Board member");
    await crm.create("tasks", {
      data: { contact_id: 1, text: "Open", due_date: "2026-11-09" },
    });
    const open = await crm.getList("tasks", {
      ...listAll,
      sort: { field: "id", order: "ASC" as const },
      filter: { contact_id: 1, "done_date@is": null },
    });
    expect(open.total).toBe(1);
  });
});

describe("createCrmResources: organizations", () => {
  it("derives organizations and their people", async () => {
    const crm = createCrmResources(source());
    const { data } = await crm.getList("companies", {
      ...listAll,
      sort: { field: "name", order: "ASC" as const },
    });
    expect(data.map((o) => [o.name, o.kind])).toEqual([
      ["Harbor Bakery", "business"],
      ["Sunrise Foundation", "foundation"],
    ]);
    const people = await crm.getManyReference("contacts", {
      target: "company_id",
      id: data[0].id,
      pagination: { page: 1, perPage: 25 },
      sort: { field: "score", order: "DESC" as const },
      filter: {},
    });
    expect(people.data.map((c) => c.id)).toEqual([2]);
    await expect(
      crm.update("companies", { id: 3, data: {}, previousData: {} as never }),
    ).rejects.toThrow();
  });
});

describe("withDonorCrm", () => {
  it("routes CRM resources to the donor data and the rest to the base provider", async () => {
    const base = {
      getList: vi.fn(async () => ({ data: [{ id: 0 }], total: 1 })),
    } as unknown as DataProvider;
    const provider = withDonorCrm(base, source());
    await provider.getList("sales", listAll);
    expect(base.getList).toHaveBeenCalledWith("sales", listAll);
    const contacts = await provider.getList("contacts", listAll);
    expect(contacts.total).toBe(3);
    expect(base.getList).toHaveBeenCalledTimes(1);
    expect(isCrmResource("companies_summary")).toBe(true);
    expect(isCrmResource("deals")).toBe(false);
  });
});
