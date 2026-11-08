import {
  CRM_STORAGE_KEY,
  MAX_ATTACHMENT_BYTES,
  STORAGE_OFF_MESSAGE,
  apiPersistence,
  browserPersistence,
  defaultPersistence,
  durableAttachments,
  overlayFromApi,
  pickFields,
  savedInBrowser,
  usableStorage,
  type StorageLike,
} from "./crmPersistence";

const TAGS = [
  { id: 1, name: "Board member", color: "#c5dedd" },
  { id: 2, name: "Volunteer", color: "#dbe7e4" },
];

const memoryStorage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  const storage: StorageLike & { items: Map<string, string> } = {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
  return storage;
};

describe("browserPersistence (snapshot mode)", () => {
  it("keeps notes, tasks, tags and donor tags across a reload", async () => {
    const storage = memoryStorage();
    const first = browserPersistence(storage, TAGS);
    expect(first.where).toBe("browser");
    const note = await first.create("contact_notes", {
      contact_id: 2,
      text: "Met at the gala",
      date: "2026-11-07T18:00:00.000Z",
      nb_tasks: 9, // computed by the screens: not stored
    });
    const task = await first.create("tasks", {
      contact_id: 2,
      type: "call",
      text: "Call back",
      due_date: "2026-11-09",
    });
    await first.update("tasks", task.id, { done_date: "2026-11-08" });
    const tag = await first.create("tags", {
      name: "Gala host",
      color: "#fad2e1",
    });
    await first.saveOverlay(2, { tags: [1, Number(tag.id)], background: "x" });

    expect(note).toMatchObject({ id: 1, text: "Met at the gala" });
    expect(note).not.toHaveProperty("nb_tasks");
    expect(tag.id).toBe(3);
    expect([...storage.items.keys()]).toEqual([CRM_STORAGE_KEY]);

    const reloaded = await browserPersistence(storage, TAGS).load();
    expect(reloaded.contact_notes.map((n) => n.text)).toEqual([
      "Met at the gala",
    ]);
    expect(reloaded.tasks[0]).toMatchObject({
      done_date: "2026-11-08",
      text: "Call back",
    });
    expect(reloaded.tasks[0].created_at).toBeTruthy();
    expect(reloaded.tags.map((t) => t.name)).toEqual([
      "Board member",
      "Volunteer",
      "Gala host",
    ]);
    expect(reloaded.overlays.get(2)).toEqual({ tags: [1, 3], background: "x" });
  });

  it("takes a deleted tag off every donor in the saved copy", async () => {
    const storage = memoryStorage();
    const store = browserPersistence(storage, TAGS);
    await store.saveOverlay(4, { tags: [1, 2] });
    await store.remove("tags", 2);
    const reloaded = await browserPersistence(storage, TAGS).load();
    expect(reloaded.tags.map((t) => t.id)).toEqual([1]);
    expect(reloaded.overlays.get(4)?.tags).toEqual([1]);
  });

  it("starts fresh, with the seed tags, from a missing, old or broken key", async () => {
    for (const raw of [
      undefined,
      JSON.stringify({ version: 0, contact_notes: [{ id: 1 }] }),
      "{not json",
    ]) {
      const storage = memoryStorage(
        raw === undefined ? {} : { [CRM_STORAGE_KEY]: raw },
      );
      const loaded = await browserPersistence(storage, TAGS).load();
      expect(loaded.contact_notes).toEqual([]);
      expect(loaded.tags).toEqual(TAGS);
    }
  });

  it("says so when the browser won't save, and changes nothing", async () => {
    const storage = memoryStorage();
    const store = browserPersistence(storage, TAGS);
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    await expect(
      store.create("contact_notes", { contact_id: 1, text: "x", date: "d" }),
    ).rejects.toThrow(/couldn't save/);
    expect((await store.load()).contact_notes).toEqual([]);
  });

  it("without storage keeps records in memory only", async () => {
    const store = browserPersistence(null, TAGS);
    expect(store.where).toBe("memory");
    await store.create("tasks", { contact_id: 1, text: "t", due_date: "d" });
    expect((await store.load()).tasks).toHaveLength(1);
    expect((await browserPersistence(null, TAGS).load()).tasks).toEqual([]);
  });
});

describe("apiPersistence (local mode)", () => {
  const fakeRequest = (pages: Record<string, unknown> = {}) => {
    const calls: {
      path: string;
      init?: { method?: string; body?: unknown };
    }[] = [];
    const req = async <T>(
      path: string,
      init?: { method?: string; body?: unknown },
    ): Promise<T> => {
      calls.push({ path, init });
      if (path in pages) return pages[path] as T;
      if (path.startsWith("/crm/contacts") && !init?.method) return [] as T;
      if (!init?.method) return { data: [], total: 0 } as T;
      return { id: 7, ...(init.body as object) } as T;
    };
    return { req, calls };
  };

  it("reads every page of every resource and the donor overlays", async () => {
    const page = (resource: string, n: number) =>
      `/crm/${resource}?sort=id&order=ASC&page=${n}&per_page=1000`;
    const { req, calls } = fakeRequest({
      [page("contact_notes", 1)]: { data: [{ id: 1 }, { id: 2 }], total: 3 },
      [page("contact_notes", 2)]: { data: [{ id: 3 }], total: 3 },
      [page("tags", 1)]: { data: [{ id: 1, name: "Board member" }], total: 1 },
      "/crm/contacts": [
        { contact_id: 5, tags: [1], background: null, last_seen: "2026-11-07" },
      ],
    });
    const loaded = await apiPersistence(req).load();
    expect(loaded.contact_notes.map((n) => n.id)).toEqual([1, 2, 3]);
    expect(loaded.tags).toHaveLength(1);
    expect(loaded.overlays.get(5)).toEqual({
      tags: [1],
      last_seen: "2026-11-07",
    });
    expect(calls.map((c) => c.path)).toContain(page("contact_notes", 2));
    expect(calls.map((c) => c.path)).not.toContain(page("tags", 2));
  });

  it("sends only the stored fields, to the right routes", async () => {
    const { req, calls } = fakeRequest();
    const api = apiPersistence(req);
    expect(api.where).toBe("server");
    const saved = await api.create("tasks", {
      contact_id: 2,
      text: "Call",
      due_date: "2026-11-09",
      type: "call",
      id: 99,
      created_at: "ignored",
    });
    expect(saved.id).toBe(7);
    await api.update("tasks", 7, { id: 7, done_date: null, text: "Done" });
    await api.remove("contact_notes", 3);
    await api.saveOverlay(2, { tags: [1], last_seen: "2026-11-07" });
    expect(calls).toEqual([
      {
        path: "/crm/tasks",
        init: {
          method: "POST",
          body: {
            contact_id: 2,
            type: "call",
            text: "Call",
            due_date: "2026-11-09",
          },
        },
      },
      {
        path: "/crm/tasks/7",
        init: { method: "PATCH", body: { text: "Done", done_date: null } },
      },
      { path: "/crm/contact_notes/3", init: { method: "DELETE" } },
      {
        path: "/crm/contacts/2",
        init: { method: "PATCH", body: { tags: [1], last_seen: "2026-11-07" } },
      },
    ]);
  });

  it("maps a service overlay row", () => {
    expect(
      overlayFromApi({
        contact_id: 1,
        tags: [2],
        background: "Met at the gala",
        last_seen: null,
      }),
    ).toEqual({ tags: [2], background: "Met at the gala" });
  });
});

describe("defaultPersistence and storage that is turned off", () => {
  const throwing = () => {
    throw new Error("SecurityError");
  };

  it("uses the service in local mode and this browser in snapshot mode", () => {
    expect(defaultPersistence(TAGS, "local").where).toBe("server");
    expect(defaultPersistence(TAGS, "snapshot", memoryStorage()).where).toBe(
      "browser",
    );
    // No window in node: nothing can be stored.
    expect(defaultPersistence(TAGS, "snapshot").where).toBe("unavailable");
  });

  it("finds storage unusable when reading it or writing to it throws", () => {
    expect(usableStorage(throwing)).toBeNull();
    const full = memoryStorage();
    full.setItem = throwing;
    expect(usableStorage(() => full)).toBeNull();
    const fine = memoryStorage();
    expect(usableStorage(() => fine)).toBe(fine);
  });

  it("refuses every save with a plain message, and reads start empty", async () => {
    const store = defaultPersistence(TAGS, "snapshot", null);
    expect((await store.load()).tags).toEqual(TAGS);
    await expect(
      store.create("contact_notes", { contact_id: 1, text: "x", date: "d" }),
    ).rejects.toThrow(STORAGE_OFF_MESSAGE);
    await expect(store.update("tasks", 1, { text: "x" })).rejects.toThrow(
      STORAGE_OFF_MESSAGE,
    );
    await expect(store.remove("tags", 1)).rejects.toThrow(STORAGE_OFF_MESSAGE);
    await expect(store.saveOverlay(1, { tags: [1] })).rejects.toThrow(
      STORAGE_OFF_MESSAGE,
    );
  });

  it('says "Saved in this browser" only when this browser can store them', () => {
    expect(savedInBrowser("snapshot", memoryStorage())).toBe(true);
    expect(savedInBrowser("snapshot", null)).toBe(false);
    expect(savedInBrowser("local", memoryStorage())).toBe(false);
  });
});

describe("pickFields", () => {
  it("keeps the stored fields that are present", () => {
    expect(
      pickFields("contact_notes", {
        id: 1,
        text: "t",
        status: undefined,
        attachments: [],
        contact: { name: "x" },
      }),
    ).toEqual({ text: "t", attachments: [] });
  });
});

describe("durableAttachments", () => {
  it("stores a picked file as a data: URL and keeps durable URLs", async () => {
    const rawFile = new Blob(["hi"], { type: "text/plain" });
    const out = await durableAttachments([
      { rawFile, src: "blob:http://localhost/1", title: "hi.txt" },
      {
        src: "https://example.com/a.pdf",
        title: "a.pdf",
        type: "application/pdf",
      },
    ]);
    expect(out).toEqual([
      {
        src: "data:text/plain;base64,aGk=",
        title: "hi.txt",
        type: "text/plain",
      },
      {
        src: "https://example.com/a.pdf",
        title: "a.pdf",
        type: "application/pdf",
      },
    ]);
    expect(await durableAttachments(null)).toEqual([]);
  });

  it("refuses files that can't be kept", async () => {
    await expect(
      durableAttachments([
        { src: "blob:http://localhost/1", title: "lost.png" },
      ]),
    ).rejects.toThrow(/attach the file again/);
    const big = new Blob([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)]);
    await expect(
      durableAttachments([{ rawFile: big, title: "big.zip" }]),
    ).rejects.toThrow(/500 KB/);
  });
});
