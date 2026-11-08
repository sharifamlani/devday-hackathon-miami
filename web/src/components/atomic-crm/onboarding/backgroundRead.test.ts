import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextRun } from "../providers/local/types";
import { onboardingStore } from "./onboardingState";
import { readOrganizationInBackground } from "./backgroundRead";

const api = vi.hoisted(() => ({
  run: vi.fn(),
  source: vi.fn(),
  tasks: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../providers/local", () => ({
  DATA_MODE: "local",
  donorDeskMethods: { runContext: api.run },
}));
vi.mock("../providers/local/endpoint", () => ({
  sourceOf: api.source,
  call: api.refresh,
}));
vi.mock("../providers/local/tasks", () => ({ generateTasks: api.tasks }));

const links = {
  website: "https://example.org",
  x: "https://x.com/example",
  linkedin: "",
  instagram: "",
};
const run = (): ContextRun => ({
  status: "done",
  served_from: "live",
  cached: false,
  detail: null,
  sources: [
    {
      source: "website",
      label: "Website",
      state: "done",
      status_text: "done",
      fact_count: 0,
      detail: null,
    },
  ],
  profile: null,
  facts: [],
  finished_at: null,
});
beforeEach(() => {
  vi.resetAllMocks();
  onboardingStore.dispatch({ type: "reset" });
  api.source.mockResolvedValue("real");
  api.tasks.mockResolvedValue({ created: 3 });
});

describe("organization processing after leaving setup", () => {
  it("keeps saving and generating tasks after setup has completed", async () => {
    let resolve!: (value: ContextRun) => void;
    api.run.mockReturnValue(
      new Promise<ContextRun>((done) => {
        resolve = done;
      }),
    );
    const pending = readOrganizationInBackground(links);
    onboardingStore.dispatch({ type: "finish" }, { open: false });
    expect(onboardingStore.get().open).toBe(false);
    expect(onboardingStore.get().data.status).toBe("completed");
    resolve(run());
    await pending;
    expect(api.run).toHaveBeenCalledWith({
      website: links.website,
      x_url: links.x,
      linkedin_url: null,
      instagram_url: null,
    });
    expect(api.tasks).toHaveBeenCalledTimes(1);
    expect(onboardingStore.get().data.context).toEqual({
      outcome: "done",
      items: 0,
      tasks: 3,
    });
    expect(onboardingStore.get().data.linksSavedTo).toBe("live");
    expect(onboardingStore.get().open).toBe(false);
  });

  it("skips the task write when the endpoint is a read-only snapshot", async () => {
    api.run.mockResolvedValue(run());
    api.source.mockResolvedValue("snapshot");
    await readOrganizationInBackground(links);
    expect(api.tasks).not.toHaveBeenCalled();
    expect(onboardingStore.get().data.context?.tasks).toBeNull();
  });

  it("retains successful research if task generation fails", async () => {
    api.run.mockResolvedValue(run());
    api.tasks.mockRejectedValue(new Error("offline"));
    await readOrganizationInBackground(links);
    expect(onboardingStore.get().data.context?.outcome).toBe("done");
    expect(onboardingStore.get().data.background).toBeNull();
  });

  it("hands a slow live read to the existing refresh watcher", async () => {
    api.run.mockResolvedValue({ ...run(), served_from: "fallback" });
    api.refresh.mockResolvedValue({
      status: "running",
      started_at: "2026-11-08T20:00:00Z",
    });
    await readOrganizationInBackground(links);
    expect(api.refresh).toHaveBeenCalledWith(
      "Reading your website",
      "POST",
      "/context/refresh",
    );
    expect(onboardingStore.get().data.context?.outcome).toBe("background");
    expect(onboardingStore.get().data.background?.status).toBe("running");
    expect(api.tasks).not.toHaveBeenCalled();
  });

  it("records a research failure without reopening setup or rejecting", async () => {
    api.run.mockRejectedValue(new Error("Website unavailable"));
    await expect(readOrganizationInBackground(links)).resolves.toBeUndefined();
    expect(onboardingStore.get().data.context?.outcome).toBe("failed");
    expect(onboardingStore.get().data.background?.detail).toContain(
      "Website unavailable",
    );
    expect(onboardingStore.get().open).toBe(false);
  });
});
