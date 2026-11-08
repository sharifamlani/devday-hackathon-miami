import type {
  ContextRun,
  ContextRunSource,
  IngestResult,
} from "../providers/local/types";
import {
  addFiles,
  contextOutcome,
  contextReducer,
  contextSummary,
  doneLine,
  filesLine,
  filesStepAction,
  ingestSummary,
  plainError,
  skipReason,
  sourceRows,
  tasksRow,
  type ContextPhase,
} from "./firstRun";
import { EMPTY_LINKS } from "./onboardingState";

const file = (name: string, size = 1200) => ({ name, size });

describe("which dropped files are imported", () => {
  it("takes the example files from data/sample_inputs/", () => {
    for (const name of [
      "give_miami_day_export_2022-2025.xlsx",
      "board_retreat_notes.md",
      "check_deposit_log_q3_2026.docx",
      "donors.CSV",
    ])
      expect(skipReason(file(name))).toBeNull();
  });

  it("keeps the answer key, the README and other files out, saying why", () => {
    expect(skipReason(file("answer_key.json"))).toContain("answer key");
    expect(skipReason(file("answer-key.xlsx"))).toContain("answer key");
    expect(skipReason(file("_README.md"))).toContain("describes");
    expect(skipReason(file("README.md"))).toContain("describes");
    expect(skipReason(file(".DS_Store"))).toContain("Hidden");
    expect(skipReason(file("photo.png"))).toContain(".xlsx");
    expect(skipReason(file("no_extension"))).toContain(".xlsx");
    expect(skipReason(file("big.xlsx", 10_000_001))).toBe("Over 10 MB.");
    expect(skipReason(file("empty.csv", 0))).toBe("This file is empty.");
  });

  it("adds new drops to the list and replaces same-name files", () => {
    const first = addFiles([], [file("a.xlsx", 10), file("answer_key.json")]);
    expect(first.files.map((f) => f.name)).toEqual(["a.xlsx"]);
    expect(first.skipped).toEqual([
      {
        name: "answer_key.json",
        reason: expect.stringContaining("answer key"),
      },
    ]);
    const second = addFiles(first.files, [file("a.xlsx", 20), file("b.md")]);
    expect(second.files).toEqual([file("a.xlsx", 20), file("b.md")]);
    expect(second.skipped).toEqual([]);
  });
});

describe("what ingest found", () => {
  const result = (fields: Partial<IngestResult>): IngestResult => ({
    donors: null,
    gifts: null,
    duplicates: null,
    message: null,
    raw: {},
    ...fields,
  });

  it("reads people_added when the shared parser has no donor count", () => {
    expect(
      ingestSummary(
        result({
          gifts: 113,
          duplicates: 6,
          raw: { people_added: 68, gifts_added: 113 },
        }),
        7,
      ),
    ).toEqual({ people: 68, gifts: 113, duplicates: 6, files: 7 });
    expect(ingestSummary(result({ donors: 12 }), 1).people).toBe(12);
    expect(ingestSummary(result({ raw: null }), 1).people).toBeNull();
  });

  it("says it in one line", () => {
    expect(filesLine({ people: 68, gifts: 113, duplicates: 6, files: 7 })).toBe(
      "68 people · 113 gifts · 6 possible duplicates found",
    );
    expect(filesLine({ people: 1, gifts: 1, duplicates: 0, files: 1 })).toBe(
      "1 person · 1 gift found",
    );
    expect(
      filesLine({ people: null, gifts: null, duplicates: null, files: 2 }),
    ).toBe("2 files imported");
  });
});

describe("step 1's main button", () => {
  const saved = { people: 68, gifts: 113, duplicates: 6, files: 7 };

  it("imports chosen files first", () => {
    expect(filesStepAction({ pending: 2, imported: null, existing: 0 })).toBe(
      "import",
    );
    expect(filesStepAction({ pending: 1, imported: saved, existing: 68 })).toBe(
      "import",
    );
  });

  it("a saved import lets you continue without uploading again", () => {
    // Coming back after "Finish later" or a reload, before the people list loads.
    expect(filesStepAction({ pending: 0, imported: saved, existing: 0 })).toBe(
      "continue",
    );
    expect(filesStepAction({ pending: 0, imported: null, existing: 12 })).toBe(
      "continue",
    );
  });

  it("asks for files when there is nothing yet", () => {
    expect(filesStepAction({ pending: 0, imported: null, existing: 0 })).toBe(
      "need_files",
    );
  });
});

/* ---------- Step 3 ---------- */

const source = (
  name: string,
  state: ContextRunSource["state"],
  fact_count = 0,
): ContextRunSource => ({
  source: name,
  label: { website: "Website", news: "News", x: "X" }[name] ?? name,
  state,
  status_text: state,
  fact_count,
  detail: state === "failed" ? "error: DNS: nowhere.example not found" : null,
});

const fact = (id: number) => ({
  id,
  source: "website",
  source_url: "https://example.org/",
  posted_at: "2026-10-01",
  fact: `Fact ${id}`,
  quote: null,
  priority: null,
});

const run = (fields: Partial<ContextRun>): ContextRun => ({
  status: "done",
  served_from: "live",
  cached: false,
  detail: null,
  sources: [],
  profile: null,
  facts: [],
  finished_at: null,
  ...fields,
});

const goodRun = run({
  sources: [
    source("website", "done", 2),
    source("news", "failed"),
    source("x", "saved_not_connected"),
  ],
  facts: [fact(1), fact(2)],
});

describe("contextOutcome", () => {
  it("is done when any source was read, even if another failed", () => {
    expect(contextOutcome(goodRun)).toBe("done");
  });

  it("is saved when the live read failed but this site's saved context came back", () => {
    expect(
      contextOutcome(run({ served_from: "fallback", facts: [fact(1)] })),
    ).toBe("saved");
    expect(contextOutcome(run({ served_from: "fallback" }))).toBe("failed");
  });

  it("is failed when nothing could be read", () => {
    expect(
      contextOutcome(
        run({
          status: "failed",
          sources: [source("website", "failed"), source("news", "failed")],
        }),
      ),
    ).toBe("failed");
  });
});

describe("contextReducer: the run starts on its own and lands on the dashboard", () => {
  const reading: ContextPhase = { phase: "reading" };

  it("reading → tasks → done", () => {
    const tasks = contextReducer(reading, { type: "run_ok", run: goodRun });
    expect(tasks).toEqual({ phase: "tasks", run: goodRun });
    const done = contextReducer(tasks, {
      type: "tasks",
      result: { state: "made", created: 3 },
    });
    expect(done).toEqual({
      phase: "done",
      run: goodRun,
      tasks: { state: "made", created: 3 },
    });
    expect(contextSummary(done)).toEqual({
      outcome: "done",
      items: 2,
      tasks: 3,
    });
  });

  it("a missing task generator is skipped, never an error", () => {
    const done = contextReducer(
      { phase: "tasks", run: goodRun },
      {
        type: "tasks",
        result: { state: "skipped", reason: "Not available yet" },
      },
    );
    expect(done.phase).toBe("done");
    expect(contextSummary(done)?.tasks).toBeNull();
    expect(tasksRow(done)).toMatchObject({
      tone: "quiet",
      text: "Not available yet",
    });
  });

  it("nothing read, or the call failed: a plain error, then retry", () => {
    const failedRun = run({
      status: "failed",
      sources: [source("website", "failed")],
    });
    const error = contextReducer(reading, { type: "run_ok", run: failedRun });
    expect(error).toMatchObject({
      phase: "error",
      message:
        "We couldn't read your website (DNS: nowhere.example not found).",
    });
    expect(contextSummary(error)).toEqual({
      outcome: "failed",
      items: 0,
      tasks: null,
    });
    const thrown = contextReducer(reading, {
      type: "run_failed",
      message: "Website research isn't available yet.",
    });
    expect(thrown).toEqual({
      phase: "error",
      run: null,
      message: "Website research isn't available yet.",
    });
    expect(contextReducer(thrown, { type: "retry" })).toEqual(reading);
  });

  it("ignores events that arrive out of order", () => {
    const done: ContextPhase = {
      phase: "done",
      run: goodRun,
      tasks: { state: "made", created: 0 },
    };
    expect(contextReducer(done, { type: "run_failed", message: "late" })).toBe(
      done,
    );
    expect(
      contextReducer(reading, {
        type: "tasks",
        result: { state: "made", created: 1 },
      }),
    ).toBe(reading);
  });
});

describe("the progress rows", () => {
  const links = {
    ...EMPTY_LINKS,
    website: "https://example.org/",
    x: "https://x.com/ex",
  };

  it("while reading: website and news in progress, links saved or not added", () => {
    expect(sourceRows(links, null)).toEqual([
      { key: "website", label: "Website", tone: "working", text: "Reading…" },
      { key: "news", label: "News", tone: "working", text: "Searching…" },
      { key: "x", label: "X", tone: "quiet", text: "Link saved" },
      { key: "linkedin", label: "LinkedIn", tone: "quiet", text: "Not added" },
      {
        key: "instagram",
        label: "Instagram",
        tone: "quiet",
        text: "Not added",
      },
    ]);
  });

  it("a failed call stops the spinners", () => {
    expect(
      sourceRows(links, null, true)
        .filter((r) => r.key === "website" || r.key === "news")
        .map((r) => [r.tone, r.text]),
    ).toEqual([
      ["quiet", "Not read"],
      ["quiet", "Not read"],
    ]);
  });

  it("after the run: items per source, problems named, nothing left spinning", () => {
    const rows = sourceRows(links, goodRun);
    expect(rows.map((r) => [r.key, r.tone, r.text])).toEqual([
      ["website", "done", "2 items"],
      ["news", "problem", "Couldn't read"],
      ["x", "quiet", "Link saved"],
      ["linkedin", "quiet", "Not added"],
      ["instagram", "quiet", "Not added"],
    ]);
    expect(
      sourceRows(links, run({ sources: [source("website", "done", 1)] }))[1],
    ).toMatchObject({ key: "news", tone: "quiet", text: "Not read" });
    // Saved news items the run didn't report as a source (the snapshot build).
    const newsFact = { ...fact(3), source: "news" };
    expect(
      sourceRows(
        links,
        run({ sources: [source("website", "done", 1)], facts: [newsFact] }),
      )[1],
    ).toMatchObject({ tone: "done", text: "1 item (saved earlier)" });
  });

  it("labels a requested cache read as saved earlier", () => {
    const cached = run({
      served_from: "cache",
      sources: [source("website", "done", 1)],
      facts: [fact(1)],
    });
    expect(sourceRows(links, cached)[0].text).toBe("1 item (saved earlier)");
  });

  it("the tasks row follows the phase", () => {
    expect(tasksRow({ phase: "reading" })).toBeNull();
    expect(tasksRow({ phase: "tasks", run: goodRun })).toMatchObject({
      tone: "working",
    });
    expect(
      tasksRow({
        phase: "done",
        run: goodRun,
        tasks: { state: "made", created: 0 },
      }),
    ).toMatchObject({ tone: "done", text: "Up to date" });
  });

  it("the finished line", () => {
    expect(doneLine({ outcome: "done", items: 14, tasks: 3 })).toBe(
      "14 items found about your organization · 3 new tasks",
    );
    expect(doneLine({ outcome: "done", items: 0, tasks: null })).toBe(
      "No items found yet",
    );
  });
});

describe("plainError", () => {
  it("turns a network failure into something to act on", () => {
    expect(plainError(new TypeError("Failed to fetch"), "x")).toContain(
      "couldn't reach the Donor Desk service",
    );
    expect(plainError(new Error("Upload isn't available yet."), "x")).toBe(
      "Upload isn't available yet.",
    );
    expect(plainError("weird", "Fallback.")).toBe("Fallback.");
  });
});
