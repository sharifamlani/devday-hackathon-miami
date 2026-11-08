import type { DataProvider } from "ra-core";

import type { RawDonorDetail, RawDonorRow } from "./crmDonors";
import {
  browserPersistence,
  type CrmPersistence,
  type StorageLike,
} from "./crmPersistence";
import {
  DEFAULT_TAGS,
  createCrmResources,
  overlayChanges,
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

describe("createCrmResources: saved notes, tasks and tags", () => {
  const storage = (): StorageLike => {
    const items = new Map<string, string>();
    return {
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => {
        items.set(k, v);
      },
    };
  };
  const opened = (s: StorageLike) =>
    createCrmResources(source(), {
      persistence: browserPersistence(s, DEFAULT_TAGS),
    });

  it("a reload (a new provider on the same storage) shows what was saved", async () => {
    const s = storage();
    const before = opened(s);
    await before.create("contact_notes", {
      data: {
        contact_id: 2,
        text: "Met at the gala",
        date: "2026-11-07T18:00:00.000Z",
        sales_id: 0,
      },
    });
    const { data: task } = await before.create("tasks", {
      data: {
        contact_id: 2,
        text: "Call",
        due_date: "2026-11-09",
        sales_id: 0,
      },
    });
    await before.update("contacts", {
      id: 2,
      data: { tags: [1, 4], background: "Bakery owner" },
      previousData: {} as never,
    });
    await before.delete("tags", { id: 4, previousData: { id: 4 } });

    const after = opened(s);
    const { data } = await after.getOne("contacts", { id: 2 });
    expect(data).toMatchObject({ tags: [1], background: "Bakery owner" });
    expect(data.nb_tasks).toBe(1);
    const notes = await after.getManyReference("contact_notes", {
      target: "contact_id",
      id: 2,
      pagination: { page: 1, perPage: 25 },
      sort: { field: "date", order: "DESC" as const },
      filter: {},
    });
    expect(notes.data.map((n) => n.text)).toEqual(["Met at the gala"]);
    const tasks = await after.getList("tasks", {
      ...listAll,
      filter: { sales_id: 0, "done_date@is": null },
    });
    expect(tasks.data.map((t) => t.id)).toEqual([task.id]);
    const tags = await after.getList("tags", listAll);
    expect(tags.data.map((t) => t.id)).not.toContain(4);
  });

  it("shows a change only once it is saved", async () => {
    const failing: CrmPersistence = {
      ...browserPersistence(null, DEFAULT_TAGS),
      create: async () => {
        throw new Error("Service down");
      },
    };
    const crm = createCrmResources(source(), { persistence: failing });
    await expect(
      crm.create("tasks", {
        data: { contact_id: 1, text: "x", due_date: "2026-11-09" },
      }),
    ).rejects.toThrow("Service down");
    expect((await crm.getList("tasks", listAll)).total).toBe(0);
  });

  it("keeps the donor list up when notes can't be read, and reads again later", async () => {
    let fail = true;
    const inner = browserPersistence(null, DEFAULT_TAGS);
    const flaky: CrmPersistence = {
      ...inner,
      load: async () => {
        if (fail) throw new Error("Service down");
        return inner.load();
      },
    };
    const crm = createCrmResources(source(), { persistence: flaky });
    expect((await crm.getList("contacts", listAll)).total).toBe(3);
    await expect(crm.getList("contact_notes", listAll)).rejects.toThrow(
      "Service down",
    );
    fail = false;
    expect((await crm.getList("contact_notes", listAll)).total).toBe(0);
  });

  it("withDonorCrm saves through the persistence it is given", async () => {
    const s = storage();
    const base = { getList: vi.fn() } as unknown as DataProvider;
    const provider = withDonorCrm(
      base,
      source(),
      browserPersistence(s, DEFAULT_TAGS),
    );
    await provider.create("tags", {
      data: { name: "Gala host", color: "#fad2e1" },
    });
    const reloaded = withDonorCrm(
      base,
      source(),
      browserPersistence(s, DEFAULT_TAGS),
    );
    const { data } = await reloaded.getList("tags", listAll);
    expect(data.map((t) => t.name)).toContain("Gala host");
  });
});

describe("createCrmResources: records another tab saved (local mode)", () => {
  const T0 = new Date("2026-11-07T18:00:00Z").getTime();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Stands in for the service: every call reads the shared storage again. */
  const service = (shared: StorageLike): CrmPersistence => {
    const db = () => browserPersistence(shared, DEFAULT_TAGS);
    return {
      where: "server",
      load: () => db().load(),
      create: (r, d) => db().create(r, d),
      update: (r, id, d) => db().update(r, id, d),
      remove: (r, id) => db().remove(r, id),
      saveOverlay: (id, o) => db().saveOverlay(id, o),
    };
  };
  const sharedStorage = (): StorageLike => {
    const items = new Map<string, string>();
    return {
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => {
        items.set(k, v);
      },
    };
  };
  const note = (text: string) => ({
    data: { contact_id: 2, text, date: "2026-11-07T18:00:00.000Z" },
  });

  it("reads the service again once its copy is stale", async () => {
    const shared = sharedStorage();
    const tabA = createCrmResources(source(), {
      persistence: service(shared),
      staleMs: 20_000,
    });
    const tabB = createCrmResources(source(), {
      persistence: service(shared),
      staleMs: 20_000,
    });
    expect((await tabB.getList("contact_notes", listAll)).total).toBe(0);
    await tabA.create("contact_notes", note("From tab A"));
    vi.setSystemTime(T0 + 5_000);
    expect((await tabB.getList("contact_notes", listAll)).total).toBe(0);
    vi.setSystemTime(T0 + 25_000);
    const fresh = await tabB.getList("contact_notes", listAll);
    expect(fresh.data.map((n) => n.text)).toEqual(["From tab A"]);
    expect((await tabB.getOne("contacts", { id: 2 })).data.last_seen).toBe(
      "2026-11-07T18:00:00.000Z",
    );
  });

  it("keeps a change saved while a fresh read was in flight", async () => {
    const records = {
      contact_notes: [] as any[],
      tasks: [] as any[],
      tags: [] as any[],
    };
    let releaseCreate!: () => void;
    let releaseLoad!: () => void;
    let slowLoad = false;
    const gated: CrmPersistence = {
      where: "server",
      load: async () => {
        const snapshot = structuredClone({ ...records, overlays: new Map() });
        if (slowLoad) await new Promise<void>((r) => (releaseLoad = r));
        return snapshot; // read before the create landed
      },
      create: async (_r, data) => {
        await new Promise<void>((r) => (releaseCreate = r));
        const saved = { ...data, id: 1 };
        records.contact_notes.push(saved);
        return saved;
      },
      update: async () => {
        throw new Error("unused");
      },
      remove: async () => {},
      saveOverlay: async () => {},
    };
    const crm = createCrmResources(source(), {
      persistence: gated,
      staleMs: 20_000,
    });
    await crm.getList("contact_notes", listAll);
    const creating = crm.create("contact_notes", note("Mine"));
    await vi.waitFor(() => expect(releaseCreate).toBeTypeOf("function"));
    vi.setSystemTime(T0 + 25_000);
    slowLoad = true;
    const listing = crm.getList("contact_notes", listAll);
    await vi.waitFor(() => expect(releaseLoad).toBeTypeOf("function"));
    releaseCreate();
    await creating;
    releaseLoad();
    expect((await listing).data.map((n) => n.text)).toEqual(["Mine"]);
  });

  it("answers from the last copy when a fresh read fails", async () => {
    const shared = sharedStorage();
    const inner = service(shared);
    let down = false;
    const crm = createCrmResources(source(), {
      persistence: {
        ...inner,
        load: async () => {
          if (down) throw new Error("Service down");
          return inner.load();
        },
      },
      staleMs: 20_000,
    });
    await crm.create("contact_notes", note("Saved"));
    down = true;
    vi.setSystemTime(T0 + 25_000);
    expect((await crm.getList("contact_notes", listAll)).total).toBe(1);
  });

  it("never re-reads this browser's own storage", async () => {
    const shared = sharedStorage();
    const load = vi.fn(browserPersistence(shared, DEFAULT_TAGS).load);
    const crm = createCrmResources(source(), {
      persistence: { ...browserPersistence(shared, DEFAULT_TAGS), load },
      staleMs: 1,
    });
    await crm.getList("tasks", listAll);
    vi.setSystemTime(T0 + 60_000);
    await crm.getList("tasks", listAll);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe("createCrmResources: donor edits from two tabs", () => {
  it("overlayChanges keeps only the fields that changed", () => {
    expect(
      overlayChanges(
        { tags: [1, 2], background: "New", last_seen: "x", score: 9 },
        { tags: [1, 2], background: "Old", last_seen: "x" },
      ),
    ).toEqual({ background: "New" });
    expect(overlayChanges({ tags: ["3"] })).toEqual({ tags: [3] });
    expect(overlayChanges({ status: "warm" }, {})).toEqual({});
  });

  it("editing only the background doesn't send the cached tags", async () => {
    const saved: unknown[] = [];
    const inner = browserPersistence(null, DEFAULT_TAGS);
    const crm = createCrmResources(source(), {
      persistence: {
        ...inner,
        where: "server",
        saveOverlay: async (id, changes) => {
          saved.push([id, changes]);
          return inner.saveOverlay(id, changes);
        },
      },
    });
    await crm.update("contacts", {
      id: 2,
      data: { tags: [1] },
      previousData: {} as never,
    });
    const { data: record } = await crm.getOne("contacts", { id: 2 });
    await crm.update("contacts", {
      id: 2,
      data: { ...record, background: "Bakery owner" }, // the whole form
      previousData: record,
    });
    expect(saved).toEqual([
      [2, { tags: [1] }],
      [2, { background: "Bakery owner" }],
    ]);
    expect((await crm.getOne("contacts", { id: 2 })).data).toMatchObject({
      tags: [1],
      background: "Bakery owner",
    });
  });

  it("a storage event from another tab makes the next read fresh", async () => {
    const items = new Map<string, string>();
    const shared: StorageLike = {
      getItem: (k) => items.get(k) ?? null,
      setItem: (k, v) => {
        items.set(k, v);
      },
    };
    const events = new EventTarget();
    const tabA = createCrmResources(source(), {
      persistence: browserPersistence(shared, DEFAULT_TAGS, { events: null }),
    });
    const tabB = createCrmResources(source(), {
      persistence: browserPersistence(shared, DEFAULT_TAGS, { events }),
    });
    expect((await tabB.getList("contact_notes", listAll)).total).toBe(0);
    await tabA.create("contact_notes", {
      data: { contact_id: 1, text: "From A", date: "2026-11-07T18:00:00.000Z" },
    });
    expect((await tabB.getList("contact_notes", listAll)).total).toBe(0);
    events.dispatchEvent(
      Object.assign(new Event("storage"), { key: "donor-desk.crm.v1" }),
    );
    const { data } = await tabB.getList("contact_notes", listAll);
    expect(data.map((n) => n.text)).toEqual(["From A"]);
  });
});
