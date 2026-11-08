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
import { request } from "./httpClient";
import { loadSnapshot } from "./snapshotClient";

/**
 * The Donors tab's react-admin resources, on the donor data instead of
 * Atomic CRM's FakeRest sample:
 *
 * - contacts: one record per donor (GET /donors, or the snapshot), read-only
 *   except tags, background and "last seen", which stay in this tab.
 * - companies: organizations that give (foundations, businesses,
 *   households), derived from the donors. Read-only.
 * - contact_notes, tasks, tags: Atomic CRM's notes, tasks and tags, kept in
 *   memory for this tab in both modes. The service has no notes or tasks
 *   routes yet, so nothing here is sent anywhere.
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

/**
 * Builds the resource handlers. `source` is injectable so tests can pass a
 * fixed donor list.
 */
export const createCrmResources = (
  source: DonorSource,
  seedTags = DEFAULT_TAGS,
) => {
  const overlays = new Map<number, ContactOverlay>();
  const store = withSupabaseFilterAdapter(
    fakeRestDataProvider(
      { contact_notes: [], tasks: [], tags: structuredClone(seedTags) },
      false,
      0,
    ),
  );

  const everything = async (resource: "contact_notes" | "tasks") =>
    (
      await store.getList(resource, {
        filter: {},
        pagination: { page: 1, perPage: 100_000 },
        sort: { field: "id", order: "ASC" },
      })
    ).data;

  /** Open tasks, newest note and newest done thank-you task, per donor. */
  const activity = async () => {
    const [notes, tasks] = await Promise.all([
      everything("contact_notes"),
      everything("tasks"),
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
    const [rows, asOf, per] = await Promise.all([
      source.rows(),
      source.asOf(),
      activity(),
    ]);
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
        overlay: overlays.get(row.id),
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
    const [{ contacts, organizations }, detail, asOf, per] = await Promise.all([
      build(false),
      source.detail(id),
      source.asOf(),
      activity(),
    ]);
    const listed = contacts.find((c) => c.id === id);
    const org = organizations.find((o) => o.id === listed?.company_id);
    const extras = extrasFromDetail(detail);
    const local = per.get(id);
    return {
      ...toDonorContact(detail, asOf, {
        companyId: org?.id ?? null,
        companyName: org?.name ?? null,
        overlay: overlays.get(id),
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

  const updateContact = async (id: number, data: Record<string, unknown>) => {
    const next: ContactOverlay = { ...overlays.get(id) };
    if (Array.isArray(data.tags)) next.tags = data.tags.map(Number);
    if (typeof data.last_seen === "string") next.last_seen = data.last_seen;
    if (typeof data.background === "string") next.background = data.background;
    overlays.set(id, next);
    return contactDetail(id);
  };

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
      return store.getList(name, params);
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
      return store.getOne(name, params);
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
      return store.getManyReference(name, params);
    },
    create: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts") {
        throw new Error("Add donors with Import donors.");
      }
      if (name === "companies") throw new Error(READ_ONLY_ORGS);
      const data =
        name === "tasks"
          ? { ...params.data, created_at: new Date().toISOString() }
          : params.data;
      return store.create(name, { ...params, data });
    },
    update: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts") {
        return {
          data: (await updateContact(Number(params.id), params.data)) as any,
        };
      }
      if (name === "companies") throw new Error(READ_ONLY_ORGS);
      return store.update(name, params);
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
      return store.updateMany(name, params);
    },
    delete: async (resource, params) => {
      const name = baseName(resource);
      if (name === "contacts" || name === "companies") {
        throw new Error("Donor records can't be removed from here.");
      }
      const result = await store.delete(name, params);
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
      return store.deleteMany(name, params);
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
): T => {
  const crm = createCrmResources(source);
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
