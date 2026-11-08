import type { DataProvider } from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import { withSupabaseFilterAdapter } from "../fakerest/internal/supabaseAdapter";
import type { CallNote } from "../../voice/callNotes";
import { DATA_MODE } from "./config";
import {
  deriveOrganizations,
  extrasFromDetail,
  filterDonors,
  filterOrganizations,
  paginate,
  parseApiCallNotes,
  sortDonors,
  sortOrganizations,
  toDonorContact,
  type ContactOverlay,
  type DonorContact,
  type DonorOrganization,
  type RawDonorDetail,
  type RawDonorRow,
  type SortOrder,
} from "./crmDonors";
import {
  browserPersistence,
  defaultPersistence,
  durableAttachments,
  type CrmPersistence,
  type CrmRecordResource,
} from "./crmPersistence";
import { request } from "./httpClient";
import { loadSnapshot } from "./snapshotClient";

/**
 * The Donors tab's react-admin resources, on the donor data instead of
 * Atomic CRM's FakeRest sample:
 *
 * - contacts: one record per donor (GET /donors, or the snapshot), read-only
 *   except tags, background and "last seen" (saved like the notes, below).
 * - companies: organizations that give (foundations, businesses,
 *   households), derived from the donors. Read-only.
 * - contact_notes, tasks, tags: Atomic CRM's notes, tasks and tags, plus the
 *   tags, background and "last seen" this tab adds to a donor. Saved through
 *   crmPersistence.ts: the service (/crm/...) in local mode, this browser's
 *   localStorage in snapshot mode. They are loaded once into an in-memory
 *   FakeRest store, which answers react-admin's filters; every change is
 *   saved first and only then shown.
 */

export const CRM_RESOURCES = new Set([
  "contacts",
  "companies",
  "contact_notes",
  "tasks",
  "tags",
]);

const baseName = (resource: string) => resource.replace(/_summary$/, "");

export const isCrmResource = (resource: string) =>
  CRM_RESOURCES.has(baseName(resource));

/** Where the donors come from: the live API or the snapshot. */
export interface DonorSource {
  rows(): Promise<RawDonorRow[]>;
  detail(id: number): Promise<RawDonorDetail>;
  /** Details for list extras (drafts, thank-yous); null when too costly. */
  details(ids: number[]): Promise<Map<number, RawDonorDetail> | null>;
  /** The date status tags are computed against. */
  asOf(): Promise<string>;
}

const today = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const snapshotSource: DonorSource = {
  rows: async () => (await loadSnapshot()).donors as RawDonorRow[],
  detail: async (id) => {
    const detail = (await loadSnapshot()).donor_details[String(id)];
    if (!detail) throw new Error(`Donor ${id} is not in the snapshot`);
    return detail as RawDonorDetail;
  },
  details: async (ids) => {
    const all = (await loadSnapshot()).donor_details;
    return new Map(
      ids
        .filter((id) => all[String(id)])
        .map((id) => [id, all[String(id)] as RawDonorDetail]),
    );
  },
  asOf: async () => (await loadSnapshot()).meta.as_of ?? today(),
};

/** Above this many donors the live list skips the per-donor detail reads. */
export const LIVE_DETAIL_LIMIT = 60;
const DETAIL_TTL_MS = 15_000;
const detailCache = new Map<
  number,
  { at: number; value: Promise<RawDonorDetail> }
>();

const cachedDetail = (id: number) => {
  const hit = detailCache.get(id);
  if (hit && Date.now() - hit.at < DETAIL_TTL_MS) return hit.value;
  const value = request<RawDonorDetail>(`/donors/${id}`);
  detailCache.set(id, { at: Date.now(), value });
  value.catch(() => detailCache.delete(id));
  return value;
};

export const liveSource: DonorSource = {
  rows: () => request<RawDonorRow[]>("/donors"),
  // The show page always reads fresh: enrichment and merges change it.
  detail: (id) => {
    detailCache.delete(id);
    return cachedDetail(id);
  },
  details: async (ids) => {
    if (ids.length > LIVE_DETAIL_LIMIT) return null;
    const settled = await Promise.allSettled(ids.map(cachedDetail));
    return new Map(
      settled.flatMap((result, i) =>
        result.status === "fulfilled"
          ? [[ids[i], result.value] as [number, RawDonorDetail]]
          : [],
      ),
    );
  },
  asOf: async () => today(),
};

/** Fundraising tags to start with; staff add their own. None are assigned. */
export const DEFAULT_TAGS = [
  { id: 1, name: "Board member", color: "#c5dedd" },
  { id: 2, name: "Volunteer", color: "#dbe7e4" },
  { id: 3, name: "Event guest", color: "#fde2e4" },
  { id: 4, name: "Monthly giver", color: "#d6e2e9" },
  { id: 5, name: "Major gift prospect", color: "#fff1e6" },
  { id: 6, name: "Legacy society", color: "#eddcd2" },
];

/** A donor profile: the list record plus what only GET /donors/{id} has. */
export type DonorContactDetail = DonorContact & {
  server_call_notes: CallNote[];
};

type ListParams = {
  filter?: Record<string, unknown>;
  sort?: { field: string; order: string };
  pagination?: { page: number; perPage: number };
};

const READ_ONLY_ORGS =
  "Organizations come from the donor records. Edit the donor record instead.";

export interface CrmResourceOptions {
  /** Where notes, tasks and tags are saved; in memory only when omitted. */
  persistence?: CrmPersistence;
  /** The tags an empty in-memory store starts with. */
  seedTags?: typeof DEFAULT_TAGS;
  /**
   * How long records read from the service count as fresh. Past it, the next
   * read (react-admin refetches on focus and on mount) reads them again, so
   * another tab's notes show up. Browser and memory storage never go stale.
   */
  staleMs?: number;
}

/** See CrmResourceOptions.staleMs. */
export const SERVER_STALE_MS = 20_000;

/**
 * The overlay fields an update actually edits: present in `data` and, when
 * react-admin passes the record as it was, different from it.
 */
export const overlayChanges = (
  data: Record<string, unknown>,
  previous?: Record<string, unknown>,
): ContactOverlay => {
  const edited = (key: string, value: unknown) =>
    !previous ||
    !(key in previous) ||
    JSON.stringify(previous[key]) !== JSON.stringify(value);
  const changes: ContactOverlay = {};
  if (Array.isArray(data.tags)) {
    const tags = data.tags.map(Number);
    if (edited("tags", tags)) changes.tags = tags;
  }
  if (typeof data.last_seen === "string" && edited("last_seen", data.last_seen))
    changes.last_seen = data.last_seen;
  if (
    typeof data.background === "string" &&
    edited("background", data.background)
  )
    changes.background = data.background;
  return changes;
};

const isRecordResource = (name: string): name is CrmRecordResource =>
  name === "contact_notes" || name === "tasks" || name === "tags";

/**
 * Builds the resource handlers. `source` and `persistence` are injectable so
 * tests can pass a fixed donor list and their own storage.
 */
export const createCrmResources = (
  source: DonorSource,
  options: CrmResourceOptions = {},
) => {
  const persistence =
    options.persistence ??
    browserPersistence(null, options.seedTags ?? DEFAULT_TAGS);

  const staleMs =
    persistence.where === "server"
      ? (options.staleMs ?? SERVER_STALE_MS)
      : Number.POSITIVE_INFINITY;

  type Loaded = {
    store: ReturnType<typeof withSupabaseFilterAdapter>;
    overlays: Map<number, ContactOverlay>;
  };
  /** The records last read, and when. */
  let current: { loaded: Loaded; at: number } | null = null;
  let reading: Promise<Loaded> | null = null;
  /** Counts saved writes, so a read that raced one doesn't hide it. */
  let writes = 0;
  /** Another tab changed the saved records: read them again next time. */
  let changedElsewhere = false;
  persistence.subscribe?.(() => {
    changedElsewhere = true;
  });

  const read = (): Promise<Loaded> => {
    if (reading) return reading;
    const writesBefore = writes;
    changedElsewhere = false;
    const attempt = persistence
      .load()
      .then((records): Loaded => {
        const loaded: Loaded = {
          store: withSupabaseFilterAdapter(
            fakeRestDataProvider(
              structuredClone({
                contact_notes: records.contact_notes,
                tasks: records.tasks,
                tags: records.tags,
              }),
              false,
              0,
            ),
          ),
          overlays: records.overlays,
        };
        if (current && writes !== writesBefore) {
          // A change was saved while this read was in flight and may be
          // missing from it: keep the copy that has it, read again next time.
          current = { loaded: current.loaded, at: 0 };
          return current.loaded;
        }
        current = { loaded, at: Date.now() };
        return loaded;
      })
      .finally(() => {
        if (reading === attempt) reading = null;
      });
    reading = attempt;
    return attempt;
  };

  /**
   * The saved records: read on first use, and again once the service copy is
   * stale. If a fresh read fails, the last copy still answers; a first read
   * that fails is tried again next time.
   */
  const ready = async (): Promise<Loaded> => {
    if (current && !changedElsewhere && Date.now() - current.at < staleMs) {
      return current.loaded;
    }
    if (!current) return read();
    const last = current.loaded;
    return read().catch(() => last);
  };
  /** After a write is saved: count it, then return the copy to update. */
  const afterWrite = async () => {
    writes += 1;
    return current?.loaded ?? (await ready());
  };
  /** Adds or replaces one saved record in the in-memory copy. */
  /** Whether the in-memory copy has this record (a list query: no console error). */
  const has = async (
    store: Loaded["store"],
    name: CrmRecordResource,
    id: unknown,
  ) =>
    (
      await store.getList(name, {
        filter: { id },
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      })
    ).total! > 0;
  const put = async (
    store: Loaded["store"],
    name: CrmRecordResource,
    saved: Record<string, any>,
  ) =>
    (await has(store, name, saved.id))
      ? store.update(name, { id: saved.id, data: saved, previousData: saved })
      : store.create(name, { data: saved });
  /** The donor list still shows when notes and tasks can't be read. */
  const readyOrNull = () => ready().catch(() => null);

  const everything = async (
    store: Loaded["store"],
    resource: "contact_notes" | "tasks",
  ) =>
    (
      await store.getList(resource, {
        filter: {},
        pagination: { page: 1, perPage: 100_000 },
        sort: { field: "id", order: "ASC" },
      })
    ).data;

  /** Open tasks, newest note and newest done thank-you task, per donor. */
  const activity = async (loaded: Loaded | null) => {
    if (!loaded) {
      return new Map<
        number,
        { open: number; note: string | null; thanked: string | null }
      >();
    }
    const [notes, tasks] = await Promise.all([
      everything(loaded.store, "contact_notes"),
      everything(loaded.store, "tasks"),
    ]);
    const per = new Map<
      number,
      { open: number; note: string | null; thanked: string | null }
    >();
    const entry = (id: number) => {
      if (!per.has(id)) per.set(id, { open: 0, note: null, thanked: null });
      return per.get(id)!;
    };
    for (const note of notes) {
      const e = entry(Number(note.contact_id));
      if (!e.note || note.date > e.note) e.note = note.date;
    }
    for (const task of tasks) {
      const e = entry(Number(task.contact_id));
      if (!task.done_date) e.open += 1;
      else if (
        task.type === "thank-you" &&
        (!e.thanked || task.done_date > e.thanked)
      ) {
        e.thanked = task.done_date;
      }
    }
    return per;
  };

  const latest = (...values: (string | null | undefined)[]) =>
    values
      .filter((v): v is string => !!v)
      .sort()
      .at(-1) ?? null;

  const build = async (
    withDetails: boolean,
  ): Promise<{
    contacts: DonorContact[];
    organizations: DonorOrganization[];
  }> => {
    const [rows, asOf, loaded] = await Promise.all([
      source.rows(),
      source.asOf(),
      readyOrNull(),
    ]);
    const per = await activity(loaded);
    const overlays = loaded?.overlays;
    const { organizations, orgOf } = deriveOrganizations(rows);
    const orgName = new Map(organizations.map((o) => [o.id, o.name]));
    const details = withDetails
      ? await source.details(rows.map((r) => r.id))
      : null;
    const contacts = rows.map((row) => {
      const fromDetail = details?.get(row.id);
      const extras = fromDetail ? extrasFromDetail(fromDetail) : {};
      const local = per.get(row.id);
      const companyId = orgOf.get(row.id) ?? null;
      return toDonorContact(row, asOf, {
        companyId,
        companyName:
          companyId != null ? (orgName.get(companyId) ?? null) : null,
        overlay: overlays?.get(row.id),
        extras: {
          ...extras,
          thanked_at: latest(extras.thanked_at, local?.thanked),
          open_tasks: local?.open ?? 0,
          newest_note: local?.note ?? null,
        },
      });
    });
    return { contacts, organizations };
  };

  const contactDetail = async (id: number): Promise<DonorContactDetail> => {
    const [{ contacts, organizations }, detail, asOf, loaded] =
      await Promise.all([
        build(false),
        source.detail(id),
        source.asOf(),
        readyOrNull(),
      ]);
    const per = await activity(loaded);
    const listed = contacts.find((c) => c.id === id);
    const org = organizations.find((o) => o.id === listed?.company_id);
    const extras = extrasFromDetail(detail);
    const local = per.get(id);
    return {
      ...toDonorContact(detail, asOf, {
        companyId: org?.id ?? null,
        companyName: org?.name ?? null,
        overlay: loaded?.overlays.get(id),
        extras: {
          ...extras,
          thanked_at: latest(extras.thanked_at, local?.thanked),
          open_tasks: local?.open ?? 0,
          newest_note: local?.note ?? null,
        },
      }),
      server_call_notes: parseApiCallNotes(detail.call_notes),
    };
  };

  const listContacts = async ({ filter, sort, pagination }: ListParams) => {
    const { contacts } = await build(true);
    const filtered = sortDonors(
      filterDonors(contacts, filter),
      sort?.field,
      (sort?.order as SortOrder) ?? "DESC",
    );
    return { data: paginate(filtered, pagination), total: filtered.length };
  };

  const listOrganizations = async ({
    filter,
    sort,
    pagination,
  }: ListParams) => {
    const { organizations } = await build(false);
    const filtered = sortOrganizations(
      filterOrganizations(organizations, filter),
      sort?.field,
      (sort?.order as SortOrder) ?? "ASC",
    );
    return { data: paginate(filtered, pagination), total: filtered.length };
  };

  const updateContact = async (
    id: number,
    data: Record<string, unknown>,
    previous?: Record<string, unknown>,
  ) => {
    await ready();
    const changes = overlayChanges(data, previous);
    if (Object.keys(changes).length) {
      // Only the edited fields: another tab may have changed the others.
      await persistence.saveOverlay(id, changes);
      const { overlays } = await afterWrite();
      overlays.set(id, { ...overlays.get(id), ...changes });
    }
    return contactDetail(id);
  };

  /** What gets saved for a new or changed record. */
  const toSave = async (name: CrmRecordResource, data: Record<string, any>) =>
    name === "contact_notes" && data.attachments !== undefined
      ? { ...data, attachments: await durableAttachments(data.attachments) }
      : data;

  // react-admin's DataProvider is loosely typed by resource; these handlers
  // return the shapes ra-core expects for each call.
  const handlers: Pick<
    DataProvider,
    | "getList"
    | "getOne"
    | "getMany"
    | "getManyReference"
    | "create"
    | "update"
    | "updateMany"
    | "delete"
    | "deleteMany"
  > = {
    getList: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts") return (await listContacts(params)) as any;
      if (name === "companies") return (await listOrganizations(params)) as any;
      return (await ready()).store.getList(name, params);
    },
    getOne: async (resource, params) => {
      const name = baseName(resource);
      const id = Number(params.id);
      if (name === "contacts")
        return { data: (await contactDetail(id)) as any };
      if (name === "companies") {
        const { organizations } = await build(false);
        const org = organizations.find((o) => o.id === id);
        if (!org) throw new Error(`Organization ${id} is not in the list`);
        return { data: org as any };
      }
      return (await ready()).store.getOne(name, params);
    },
    getMany: async (resource, params) => {
      const name = baseName(resource);
      const ids = params.ids.map(Number);
      if (name === "contacts" || name === "companies") {
        const all =
          name === "contacts"
            ? (await build(false)).contacts
            : (await build(false)).organizations;
        // Like PostgREST, unknown ids (a merged donor) are left out.
        return {
          data: all.filter((r) => ids.includes(r.id)) as any,
        };
      }
      const { store } = await ready();
      if (name === "tags") {
        const { data } = await store.getList(name, {
          filter: {},
          pagination: { page: 1, perPage: 10_000 },
          sort: { field: "id", order: "ASC" },
        });
        return { data: data.filter((t) => ids.includes(Number(t.id))) };
      }
      return store.getMany(name, params);
    },
    getManyReference: async (resource, params) => {
      const name = baseName(resource);
      const filter = { ...params.filter, [params.target]: params.id };
      if (name === "contacts") {
        return (await listContacts({ ...params, filter })) as any;
      }
      if (name === "companies") {
        return (await listOrganizations({ ...params, filter })) as any;
      }
      return (await ready()).store.getManyReference(name, params);
    },
    create: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts") {
        throw new Error("Add donors with Import donors.");
      }
      if (name === "companies") throw new Error(READ_ONLY_ORGS);
      if (!isRecordResource(name)) throw new Error(`Unknown list ${name}`);
      await ready();
      const saved = await persistence.create(
        name,
        await toSave(name, params.data),
      );
      return put((await afterWrite()).store, name, saved);
    },
    update: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts") {
        return {
          data: (await updateContact(
            Number(params.id),
            params.data,
            params.previousData,
          )) as any,
        };
      }
      if (name === "companies") throw new Error(READ_ONLY_ORGS);
      if (!isRecordResource(name)) throw new Error(`Unknown list ${name}`);
      await ready();
      const saved = await persistence.update(
        name,
        params.id,
        await toSave(name, params.data),
      );
      return put((await afterWrite()).store, name, saved);
    },
    updateMany: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts") {
        for (const id of params.ids) {
          await updateContact(Number(id), params.data);
        }
        return { data: params.ids };
      }
      if (name === "companies") throw new Error(READ_ONLY_ORGS);
      if (!isRecordResource(name)) throw new Error(`Unknown list ${name}`);
      await ready();
      const data = await toSave(name, params.data);
      for (const id of params.ids) {
        const saved = await persistence.update(name, id, data);
        await put((await afterWrite()).store, name, saved);
      }
      return { data: params.ids };
    },
    delete: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts" || name === "companies") {
        throw new Error("Donor records can't be removed from here.");
      }
      if (!isRecordResource(name)) throw new Error(`Unknown list ${name}`);
      await ready();
      // The saved copy drops the tag from every donor (the service cascades).
      await persistence.remove(name, params.id);
      const { store, overlays } = await afterWrite();
      // Already gone from a copy read after the delete was saved: fine.
      const result = (await has(store, name, params.id))
        ? await store.delete(name, params)
        : { data: params.previousData as any };
      if (name === "tags") {
        const tagId = Number(params.id);
        for (const [id, overlay] of overlays) {
          if (overlay.tags?.includes(tagId)) {
            overlays.set(id, {
              ...overlay,
              tags: overlay.tags.filter((t) => t !== tagId),
            });
          }
        }
      }
      return result;
    },
    deleteMany: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts" || name === "companies") {
        throw new Error("Donor records can't be removed from here.");
      }
      for (const id of params.ids) {
        await handlers.delete(resource, { id, previousData: { id } as any });
      }
      return { data: params.ids };
    },
  };

  return handlers;
};

/**
 * Sends the CRM resources to the donor-backed handlers and everything else
 * (sales, configuration, the hidden deals screens) to `base`.
 */
export const withDonorCrm = <T extends DataProvider>(
  base: T,
  source: DonorSource = DATA_MODE === "local" ? liveSource : snapshotSource,
  persistence: CrmPersistence = defaultPersistence(DEFAULT_TAGS),
): T => {
  const crm = createCrmResources(source, { persistence });
  const route =
    <K extends keyof typeof crm>(method: K) =>
    (resource: string, params: unknown) =>
      isCrmResource(resource)
        ? (crm[method] as (r: string, p: unknown) => Promise<unknown>)(
            resource,
            params,
          )
        : (base[method] as (r: string, p: unknown) => Promise<unknown>)(
            resource,
            params,
          );
  return {
    ...base,
    getList: route("getList"),
    getOne: route("getOne"),
    getMany: route("getMany"),
    getManyReference: route("getManyReference"),
    create: route("create"),
    update: route("update"),
    updateMany: route("updateMany"),
    delete: route("delete"),
    deleteMany: route("deleteMany"),
  } as T;
};
