import type { Identifier, RaRecord } from "ra-core";

import { DATA_MODE } from "./config";
import type { ContactOverlay } from "./crmDonors";
import { request } from "./httpClient";

/**
 * Where the Donors tab keeps its notes, tasks and tags (Atomic CRM's
 * contact_notes, tasks and tags) and what it adds to a donor (tags,
 * background, last seen), so they survive a reload:
 *
 * - local mode: the service (service/routes_crm.py, /crm/...), in donors.db.
 * - snapshot mode (Vercel, no API): this browser's localStorage, under one
 *   versioned key. Nothing leaves the browser, and the snapshot export never
 *   carries these records: they are private staff notes.
 *
 * crmResources.ts loads everything once into its in-memory FakeRest store
 * (which answers react-admin's filters) and writes every change here first.
 */

export type CrmRecordResource = "contact_notes" | "tasks" | "tags";
export type CrmRecord = RaRecord & Record<string, unknown>;

export interface CrmRecords {
  contact_notes: CrmRecord[];
  tasks: CrmRecord[];
  tags: CrmRecord[];
  overlays: Map<number, ContactOverlay>;
}

export interface CrmPersistence {
  /** Where saved records end up; the UI says "Saved in this browser" for "browser". */
  readonly where: "server" | "browser" | "memory";
  load(): Promise<CrmRecords>;
  /** Saves a new record and returns it with its id. */
  create(
    resource: CrmRecordResource,
    data: Record<string, unknown>,
  ): Promise<CrmRecord>;
  /** Saves the given fields and returns the whole record. */
  update(
    resource: CrmRecordResource,
    id: Identifier,
    data: Record<string, unknown>,
  ): Promise<CrmRecord>;
  remove(resource: CrmRecordResource, id: Identifier): Promise<void>;
  saveOverlay(contactId: number, overlay: ContactOverlay): Promise<void>;
}

/** The fields each resource keeps; anything else react-admin sends is computed or ignored. */
export const CRM_FIELDS: Record<CrmRecordResource, readonly string[]> = {
  contact_notes: [
    "contact_id",
    "text",
    "date",
    "status",
    "sales_id",
    "attachments",
  ],
  tasks: ["contact_id", "type", "text", "due_date", "done_date", "sales_id"],
  tags: ["name", "color"],
};

/** Only the stored fields that `data` has (an update sends what changed). */
export const pickFields = (
  resource: CrmRecordResource,
  data: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    CRM_FIELDS[resource]
      .filter((field) => data[field] !== undefined)
      .map((field) => [field, data[field]]),
  );

/* ---------- Attachments ---------- */

export const MAX_ATTACHMENT_BYTES = 512 * 1024;

export interface StoredAttachment {
  src: string;
  title: string;
  type: string | null;
}

const blobToDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
};

/**
 * Note attachments in a form that survives a reload. A file picked in the
 * note form arrives as { rawFile, src: "blob:..." }; the blob: URL dies with
 * the page, so the file is stored as a data: URL instead (512 KB at most).
 * Attachments that are already data: or https: URLs are kept as they are.
 */
export const durableAttachments = async (
  raw: unknown,
  read: (blob: Blob) => Promise<string> = blobToDataUrl,
): Promise<StoredAttachment[]> => {
  if (!Array.isArray(raw)) return [];
  const out: StoredAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { src, title, type, rawFile } = item as {
      src?: unknown;
      title?: unknown;
      type?: unknown;
      rawFile?: unknown;
    };
    const name = typeof title === "string" && title ? title : "Attachment";
    if (rawFile instanceof Blob) {
      if (rawFile.size > MAX_ATTACHMENT_BYTES) {
        throw new Error(
          `${name} is too big to keep with the note. Attach files up to 500 KB.`,
        );
      }
      out.push({
        src: await read(rawFile),
        title: name,
        type: (typeof type === "string" && type) || rawFile.type || null,
      });
    } else if (typeof src === "string" && /^(data:|https?:\/\/)/.test(src)) {
      out.push({
        src,
        title: name,
        type: typeof type === "string" ? type : null,
      });
    } else {
      throw new Error(`${name} can't be saved: attach the file again.`);
    }
  }
  return out;
};

/* ---------- This browser (snapshot mode) ---------- */

export const CRM_STORAGE_KEY = "donor-desk.crm.v1";
const STORAGE_VERSION = 1;

/** The part of the Web Storage API this file uses (tests pass a Map-backed one). */
export type StorageLike = Pick<Storage, "getItem" | "setItem">;

interface StoredState {
  version: typeof STORAGE_VERSION;
  contact_notes: CrmRecord[];
  tasks: CrmRecord[];
  tags: CrmRecord[];
  overlays: Record<string, ContactOverlay>;
}

const freshState = (seedTags: readonly CrmRecord[]): StoredState => ({
  version: STORAGE_VERSION,
  contact_notes: [],
  tasks: [],
  tags: structuredClone([...seedTags]),
  overlays: {},
});

const readState = (
  storage: StorageLike | null,
  seedTags: readonly CrmRecord[],
): StoredState => {
  if (!storage) return freshState(seedTags);
  let raw: string | null = null;
  try {
    raw = storage.getItem(CRM_STORAGE_KEY);
  } catch {
    // storage blocked: start empty, and saving will say so
  }
  if (!raw) return freshState(seedTags);
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (parsed.version !== STORAGE_VERSION) return freshState(seedTags);
    return {
      version: STORAGE_VERSION,
      contact_notes: Array.isArray(parsed.contact_notes)
        ? parsed.contact_notes
        : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      overlays:
        parsed.overlays && typeof parsed.overlays === "object"
          ? parsed.overlays
          : {},
    };
  } catch {
    return freshState(seedTags);
  }
};

const nextId = (records: CrmRecord[]) =>
  records.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;

const now = () => new Date().toISOString();

const toOverlayMap = (
  overlays: Record<string, ContactOverlay>,
): Map<number, ContactOverlay> =>
  new Map(
    Object.entries(overlays).map(([id, overlay]) => [
      Number(id),
      structuredClone(overlay),
    ]),
  );

/**
 * Records kept in `storage` (this browser's localStorage), or only in memory
 * when `storage` is null. A write that the browser refuses (storage full or
 * blocked) throws, and nothing changes.
 */
export const browserPersistence = (
  storage: StorageLike | null,
  seedTags: readonly CrmRecord[],
): CrmPersistence => {
  let state: StoredState | null = null;
  const current = () => (state ??= readState(storage, seedTags));

  const commit = (next: StoredState) => {
    if (storage) {
      try {
        storage.setItem(CRM_STORAGE_KEY, JSON.stringify(next));
      } catch {
        throw new Error(
          "This browser couldn't save it (its storage is full or turned off).",
        );
      }
    }
    state = next;
  };

  const find = (resource: CrmRecordResource, id: Identifier) => {
    const record = current()[resource].find((r) => String(r.id) === String(id));
    if (!record) throw new Error(`That ${resourceLabel[resource]} is gone.`);
    return record;
  };

  return {
    where: storage ? "browser" : "memory",
    load: async () => {
      const s = current();
      return {
        contact_notes: structuredClone(s.contact_notes),
        tasks: structuredClone(s.tasks),
        tags: structuredClone(s.tags),
        overlays: toOverlayMap(s.overlays),
      };
    },
    create: async (resource, data) => {
      const s = current();
      const stamped = resource === "tags" ? {} : { created_at: now() };
      const record: CrmRecord = {
        ...pickFields(resource, data),
        ...stamped,
        id: nextId(s[resource]),
      };
      commit({ ...s, [resource]: [...s[resource], record] });
      return structuredClone(record);
    },
    update: async (resource, id, data) => {
      const s = current();
      const record: CrmRecord = {
        ...find(resource, id),
        ...pickFields(resource, data),
      };
      commit({
        ...s,
        [resource]: s[resource].map((r) =>
          String(r.id) === String(id) ? record : r,
        ),
      });
      return structuredClone(record);
    },
    remove: async (resource, id) => {
      const s = current();
      find(resource, id);
      const next: StoredState = {
        ...s,
        [resource]: s[resource].filter((r) => String(r.id) !== String(id)),
      };
      if (resource === "tags") {
        next.overlays = Object.fromEntries(
          Object.entries(s.overlays).map(([cid, overlay]) => [
            cid,
            overlay.tags
              ? {
                  ...overlay,
                  tags: overlay.tags.filter((t) => String(t) !== String(id)),
                }
              : overlay,
          ]),
        );
      }
      commit(next);
    },
    saveOverlay: async (contactId, overlay) => {
      const s = current();
      commit({
        ...s,
        overlays: { ...s.overlays, [String(contactId)]: { ...overlay } },
      });
    },
  };
};

const resourceLabel: Record<CrmRecordResource, string> = {
  contact_notes: "note",
  tasks: "task",
  tags: "tag",
};

/* ---------- The service (local mode) ---------- */

type Requester = <T>(
  path: string,
  init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown },
) => Promise<T>;

interface ApiOverlay {
  contact_id: number;
  tags: number[];
  background: string | null;
  last_seen: string | null;
}

/** GET /crm/contacts rows as the overlays toDonorContact reads. */
export const overlayFromApi = (row: ApiOverlay): ContactOverlay => {
  const overlay: ContactOverlay = { tags: (row.tags ?? []).map(Number) };
  if (row.background != null) overlay.background = row.background;
  if (row.last_seen != null) overlay.last_seen = row.last_seen;
  return overlay;
};

/** The page size used to read every record; the service allows up to 1000. */
export const API_PAGE_SIZE = 1000;

/** Records saved in donors.db through service/routes_crm.py. */
export const apiPersistence = (req: Requester = request): CrmPersistence => {
  const all = async (resource: CrmRecordResource) => {
    const out: CrmRecord[] = [];
    for (let page = 1; ; page += 1) {
      const { data, total } = await req<{ data: CrmRecord[]; total: number }>(
        `/crm/${resource}?sort=id&order=ASC&page=${page}&per_page=${API_PAGE_SIZE}`,
      );
      out.push(...data);
      if (!data.length || out.length >= total) return out;
    }
  };
  return {
    where: "server",
    load: async () => {
      const [contact_notes, tasks, tags, overlays] = await Promise.all([
        all("contact_notes"),
        all("tasks"),
        all("tags"),
        req<ApiOverlay[]>("/crm/contacts"),
      ]);
      return {
        contact_notes,
        tasks,
        tags,
        overlays: new Map(
          overlays.map((row) => [Number(row.contact_id), overlayFromApi(row)]),
        ),
      };
    },
    create: (resource, data) =>
      req<CrmRecord>(`/crm/${resource}`, {
        method: "POST",
        body: pickFields(resource, data),
      }),
    update: (resource, id, data) =>
      req<CrmRecord>(`/crm/${resource}/${encodeURIComponent(String(id))}`, {
        method: "PATCH",
        body: pickFields(resource, data),
      }),
    remove: async (resource, id) => {
      await req(`/crm/${resource}/${encodeURIComponent(String(id))}`, {
        method: "DELETE",
      });
    },
    saveOverlay: async (contactId, overlay) => {
      const body: Record<string, unknown> = {};
      if (overlay.tags) body.tags = overlay.tags;
      if (overlay.background !== undefined)
        body.background = overlay.background;
      if (overlay.last_seen !== undefined) body.last_seen = overlay.last_seen;
      await req(`/crm/contacts/${contactId}`, { method: "PATCH", body });
    },
  };
};

const browserStorage = (): StorageLike | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** The service in local mode, this browser in snapshot mode. */
export const defaultPersistence = (
  seedTags: readonly CrmRecord[],
  mode = DATA_MODE,
): CrmPersistence =>
  mode === "local"
    ? apiPersistence()
    : browserPersistence(browserStorage(), seedTags);

/** True when notes and tasks saved now stay only in this browser. */
export const SAVED_IN_BROWSER = DATA_MODE !== "local";
