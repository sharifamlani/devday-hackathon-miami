import type { Identifier, RaRecord } from "ra-core";

import { DATA_MODE } from "./config";
import type { ContactOverlay } from "./crmDonors";
import { request } from "./httpClient";
import { isPublicMode } from "./publicMode";
import { loadSnapshot } from "./snapshotClient";

/**
 * Where the Donors tab keeps its notes, tasks and tags (Atomic CRM's
 * contact_notes, tasks and tags) and what it adds to a donor (tags,
 * background, last seen), so they survive a reload:
 *
 * - local mode: the service (service/routes_crm.py, /crm/...), in donors.db.
 *   In public mode (the tunnel) the service refuses /crm/...: they are private
 *   staff notes, so the tab loads none and asks for none.
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
  /**
   * Where saved records end up; the UI says "Saved in this browser" for
   * "browser". "unavailable": snapshot mode in a browser whose storage is
   * off, where every save fails with a plain message.
   */
  readonly where: "server" | "browser" | "memory" | "unavailable";
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
  /** Saves only the given fields of what the tab adds to a donor. */
  saveOverlay(contactId: number, changes: ContactOverlay): Promise<void>;
  /** Calls back when another tab changed the saved records; returns an unsubscribe. */
  subscribe?(onChange: () => void): () => void;
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
export type StorageLike = Pick<Storage, "getItem" | "setItem"> &
  Partial<Pick<Storage, "removeItem">>;

interface StoredState {
  version: typeof STORAGE_VERSION;
  /** The snapshot these records belong to (meta.snapshot_id), or null. */
  snapshot_id: string | null;
  contact_notes: CrmRecord[];
  tasks: CrmRecord[];
  tags: CrmRecord[];
  overlays: Record<string, ContactOverlay>;
}

const freshState = (
  seedTags: readonly CrmRecord[],
  scope: string | null,
): StoredState => ({
  version: STORAGE_VERSION,
  snapshot_id: scope,
  contact_notes: [],
  tasks: [],
  tags: structuredClone([...seedTags]),
  overlays: {},
});

/**
 * What `storage` holds now. Records saved for another snapshot (or in an
 * older format) count as nothing; `stale` says such leftovers are there.
 */
const readState = (
  storage: StorageLike,
  seedTags: readonly CrmRecord[],
  scope: string | null,
): { state: StoredState; stale: boolean } => {
  const fresh = (stale: boolean) => ({
    state: freshState(seedTags, scope),
    stale,
  });
  let raw: string | null = null;
  try {
    raw = storage.getItem(CRM_STORAGE_KEY);
  } catch {
    // storage blocked: start empty, and saving will say so
  }
  if (!raw) return fresh(false);
  try {
    const parsed = JSON.parse(raw) as Partial<StoredState>;
    if (
      parsed.version !== STORAGE_VERSION ||
      (parsed.snapshot_id ?? null) !== scope
    ) {
      return fresh(true);
    }
    return {
      state: {
        version: STORAGE_VERSION,
        snapshot_id: scope,
        contact_notes: Array.isArray(parsed.contact_notes)
          ? parsed.contact_notes
          : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        overlays:
          parsed.overlays && typeof parsed.overlays === "object"
            ? parsed.overlays
            : {},
      },
      stale: false,
    };
  } catch {
    return fresh(true);
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

type StorageEvents = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export interface BrowserPersistenceOptions {
  /**
   * Which snapshot the records belong to (read once, on first use). Records
   * saved for a different snapshot are dropped, so private notes never land
   * on whoever has those donor ids in a newer snapshot.
   */
  scope?: () => Promise<string | null> | string | null;
  /** Where other tabs' `storage` events arrive; window by default. */
  events?: StorageEvents | null;
}

/**
 * Records kept in `storage` (this browser's localStorage), or only in memory
 * when `storage` is null. Every write reads the stored value again and
 * applies just its own change, so two open tabs don't overwrite each other.
 * A write that the browser refuses (storage full or blocked) throws, and
 * nothing changes.
 */
export const browserPersistence = (
  storage: StorageLike | null,
  seedTags: readonly CrmRecord[],
  options: BrowserPersistenceOptions = {},
): CrmPersistence => {
  let memory: StoredState | null = null;
  let scoped: Promise<string | null> | null = null;
  const scope = () =>
    (scoped ??= Promise.resolve()
      .then(() => options.scope?.() ?? null)
      .catch(() => null));

  /** The stored records as they are right now (memory: this object's copy). */
  const current = async (): Promise<StoredState> => {
    const id = await scope();
    if (!storage) return (memory ??= freshState(seedTags, id));
    return readState(storage, seedTags, id).state;
  };

  const commit = (next: StoredState) => {
    if (storage) {
      try {
        storage.setItem(CRM_STORAGE_KEY, JSON.stringify(next));
      } catch {
        throw new Error(
          "This browser couldn't save it (its storage is full or turned off).",
        );
      }
    } else {
      memory = next;
    }
  };

  const find = (
    s: StoredState,
    resource: CrmRecordResource,
    id: Identifier,
  ) => {
    const record = s[resource].find((r) => String(r.id) === String(id));
    if (!record) throw new Error(`That ${resourceLabel[resource]} is gone.`);
    return record;
  };

  const events =
    options.events !== undefined
      ? options.events
      : storage && typeof window !== "undefined"
        ? window
        : null;

  // Each write reads, changes and saves in one synchronous step after
  // `await current()`, so nothing from another tab lands in between.
  return {
    where: storage ? "browser" : "memory",
    load: async () => {
      let s: StoredState;
      if (storage) {
        const read = readState(storage, seedTags, await scope());
        if (read.stale) {
          try {
            storage.removeItem?.(CRM_STORAGE_KEY); // another snapshot's notes
          } catch {
            // blocked storage: nothing to clear
          }
        }
        s = read.state;
      } else {
        s = await current();
      }
      return {
        contact_notes: structuredClone(s.contact_notes),
        tasks: structuredClone(s.tasks),
        tags: structuredClone(s.tags),
        overlays: toOverlayMap(s.overlays),
      };
    },
    create: async (resource, data) => {
      const s = await current();
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
      const s = await current();
      const record: CrmRecord = {
        ...find(s, resource, id),
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
      const s = await current();
      find(s, resource, id);
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
    saveOverlay: async (contactId, changes) => {
      const s = await current();
      const key = String(contactId);
      commit({
        ...s,
        overlays: { ...s.overlays, [key]: { ...s.overlays[key], ...changes } },
      });
    },
    subscribe: events
      ? (onChange) => {
          const listener = (event: Event) => {
            const key = (event as StorageEvent).key;
            if (key === CRM_STORAGE_KEY || key === null) onChange();
          };
          events.addEventListener("storage", listener);
          return () => events.removeEventListener("storage", listener);
        }
      : undefined,
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
export const apiPersistence = (
  req: Requester = request,
  isPublic: () => Promise<boolean> = isPublicMode,
): CrmPersistence => {
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
      if (await isPublic())
        return { contact_notes: [], tasks: [], tags: [], overlays: new Map() };
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
    saveOverlay: async (contactId, changes) => {
      // Only what was edited: another tab may have changed the rest.
      const body: Record<string, unknown> = {};
      if (changes.tags !== undefined) body.tags = changes.tags;
      if (changes.background !== undefined)
        body.background = changes.background;
      if (changes.last_seen !== undefined) body.last_seen = changes.last_seen;
      await req(`/crm/contacts/${contactId}`, { method: "PATCH", body });
    },
  };
};

/* ---------- Storage turned off (snapshot mode) ---------- */

export const STORAGE_OFF_MESSAGE =
  "This browser can't save notes or tasks: its storage is turned off.";

/**
 * Snapshot mode in a browser that won't store anything (storage blocked or
 * full): reads start empty, every save fails with a plain message, and the
 * forms don't claim "Saved in this browser".
 */
export const unavailablePersistence = (
  seedTags: readonly CrmRecord[],
): CrmPersistence => {
  const refuse = async (): Promise<never> => {
    throw new Error(STORAGE_OFF_MESSAGE);
  };
  return {
    where: "unavailable",
    load: () => browserPersistence(null, seedTags).load(),
    create: refuse,
    update: refuse,
    remove: refuse,
    saveOverlay: refuse,
  };
};

/**
 * This browser's localStorage when it can actually store something (a probe
 * write succeeds), else null. Reading window.localStorage itself can throw
 * when storage is blocked.
 */
export const usableStorage = (
  get: () => StorageLike | null = () => window.localStorage,
): StorageLike | null => {
  try {
    const storage = get();
    if (!storage) return null;
    const probe = `${CRM_STORAGE_KEY}.probe`;
    storage.setItem(probe, "1");
    storage.removeItem?.(probe);
    return storage;
  } catch {
    return null;
  }
};

/** The deployed snapshot's identity; older snapshots fall back to their export time. */
export const snapshotScope = async (): Promise<string | null> => {
  const { meta } = await loadSnapshot();
  return meta.snapshot_id ?? meta.generated_at ?? null;
};

/** The service in local mode, this browser in snapshot mode. */
export const defaultPersistence = (
  seedTags: readonly CrmRecord[],
  mode = DATA_MODE,
  storage: StorageLike | null = mode === "local" ? null : usableStorage(),
): CrmPersistence => {
  if (mode === "local") return apiPersistence();
  return storage
    ? browserPersistence(storage, seedTags, { scope: snapshotScope })
    : unavailablePersistence(seedTags);
};

/** Whether the forms should say "Saved in this browser" (see SavedInBrowserHint). */
export const savedInBrowser = (
  mode = DATA_MODE,
  storage: StorageLike | null = mode === "local" ? null : usableStorage(),
) => mode !== "local" && storage !== null;

/** True when notes and tasks saved now stay only in this browser. */
export const SAVED_IN_BROWSER = savedInBrowser();
