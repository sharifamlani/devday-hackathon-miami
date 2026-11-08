import type {
  ContextRun,
  ContextRunSource,
  IngestResult,
} from "../providers/local/types";
import {
  GIVE_UP_MS,
  addFiles,
  backgroundLine,
  backgroundStarted,
  checklist,
  clock,
  contextOutcome,
  contextReducer,
  contextSummary,
  filesLine,
  filesStepAction,
  ingestSummary,
  offerCopy,
  plainError,
  progressFraction,
  readRefreshJob,
  receiptLine,
  skipReason,
  sourceRows,
  tabRows,
  type ContextPhase,
  type Receipt,
} from "./firstRun";
import { EMPTY_LINKS, type FilesSummary } from "./onboardingState";

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

  it("counts gifts without the declined charge and says it's on record (S1)", () => {
    const summary = ingestSummary(
      result({
        gifts: 131,
        duplicates: 9,
        raw: {
          people_added: 77,
          gifts_added: 132,
          gifts: 131,
          declined_on_record: 1,
          duplicate_suggestions: 9,
        },
      }),
      8,
    );
    expect(summary.gifts).toBe(131);
    expect(summary.declined).toBe(1);
    expect(filesLine(summary)).toBe(
      "77 people · 131 gifts (+1 declined charge on record) · 9 possible duplicates found",
    );
  });

  it("shows no declined note when there are no declined charges (S-neg)", () => {
    const summary = ingestSummary(
      result({
        gifts: 47,
        duplicates: 0,
        raw: { people_added: 12, gifts: 47, declined_on_record: 0 },
      }),
      2,
    );
    expect(filesLine(summary)).toBe("12 people · 47 gifts found");
  });

  it("keeps confirmed removals separate from possible duplicates", () => {
    const summary = ingestSummary(
      result({ donors: 18, duplicates: 7, raw: { duplicates_removed: 2 } }),
      1,
    );
    expect(summary.people).toBe(18);
    expect(summary.duplicates).toBe(7);
    expect(summary.duplicatesRemoved).toBe(2);
    expect(
      ingestSummary(result({ raw: { duplicate_suggestions: 7 } }), 1)
        .duplicatesRemoved,
    ).toBeUndefined();
    expect(
      ingestSummary(result({ raw: { duplicates_removed: -1 } }), 1)
        .duplicatesRemoved,
    ).toBeUndefined();
  });

  it("reads POST /ingest's own fields: people_added, by_tab, flagged_for_review", () => {
    // The shape service/ingest_adapter.py returns (the coordinator's live run).
    expect(
      ingestSummary(
        result({
          gifts: 132,
          duplicates: 10,
          raw: {
            people_added: 78,
            gifts_added: 132,
            by_tab: { giver: 41, neighbor: 21, community: 16 },
            flagged_for_review: [{ donor_id: 1 }, { donor_id: 2 }],
            duplicate_suggestions: 10,
          },
        }),
        8,
      ),
    ).toEqual({
      people: 78,
      gifts: 132,
      duplicates: 10,
      files: 8,
      byTab: { giver: 41, neighbor: 21, community: 16 },
      review: 2,
    });
    expect(ingestSummary(result({ donors: 12 }), 1).people).toBe(12);
    expect(ingestSummary(result({ raw: null }), 1)).toMatchObject({
      people: null,
      byTab: null,
      review: null,
    });
    // No people_added: the tab counts add up.
    expect(
      ingestSummary(result({ raw: { by_tab: { giver: 2, community: 1 } } }), 1),
    ).toMatchObject({
      people: 3,
      byTab: { giver: 2, neighbor: 0, community: 1 },
    });
  });

  it("says it in one line, and per tab for the receipt", () => {
    const summary: FilesSummary = {
      people: 68,
      gifts: 113,
      duplicates: 6,
      files: 7,
      byTab: { giver: 33, neighbor: 20, community: 15 },
      review: null,
    };
    expect(filesLine(summary)).toBe(
      "68 people · 113 gifts · 6 possible duplicates found",
    );
    expect(tabRows(summary)).toEqual([
      { tab: "giver", label: "Givers", count: 33 },
      { tab: "neighbor", label: "Neighbors", count: 20 },
      { tab: "community", label: "Community", count: 15 },
    ]);
    expect(tabRows({ ...summary, byTab: null })).toBeNull();
    expect(filesLine({ ...summary, people: 1, gifts: 1, duplicates: 0 })).toBe(
      "1 person · 1 gift found",
    );
    expect(
      filesLine({
        ...summary,
        people: null,
        gifts: null,
        duplicates: null,
        files: 2,
      }),
    ).toBe("2 files imported");
  });

  it("shows elapsed time as m:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(7_900)).toBe("0:07");
    expect(clock(92_000)).toBe("1:32");
    expect(clock(-5)).toBe("0:00");
  });
});

describe("step 1's main button", () => {
  const saved: FilesSummary = {
    people: 68,
    gifts: 113,
    duplicates: 6,
    files: 7,
    byTab: null,
    review: null,
  };

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
    source("website", "done", 4),
    source("news", "failed"),
    source("x", "saved_not_connected"),
  ],
  facts: [fact(1), fact(2), fact(3), fact(4)],
  profile: {
    name: "Bayside Youth Fund",
    website: "https://example.org/",
    socials: [],
    priorities: [],
    voice: [],
    updated_at: null,
  },
});

// What the coordinator saw live: the read timed out, nothing saved for this site.
const timedOut = run({
  status: "failed",
  served_from: "fallback",
  cached: true,
  detail: "website read took longer than 30 s",
  sources: [source("website", "failed"), source("news", "failed")],
});

describe("contextOutcome", () => {
  it("is done when any source was read, even if another failed", () => {
    expect(contextOutcome(goodRun)).toBe("done");
  });

  it("a timeout or model error (fallback) is slow, never done: it goes on in the background", () => {
    expect(contextOutcome(timedOut)).toBe("slow");
    expect(
      contextOutcome(run({ served_from: "fallback", facts: [fact(1)] })),
    ).toBe("slow");
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

const read = (fields: Partial<ReturnType<typeof backgroundStarted>>) => ({
  ...backgroundStarted({ started_at: "2026-11-08T15:00:00+00:00" }),
  ...fields,
});

describe("contextReducer", () => {
  const reading: ContextPhase = { phase: "reading" };

  it("success: reading → tasks → receipt (with a few facts) → welcome", () => {
    const tasks = contextReducer(reading, { type: "run_ok", run: goodRun });
    expect(tasks).toEqual({ phase: "tasks", run: goodRun });
    const receipt = contextReducer(tasks, {
      type: "tasks",
      result: { state: "made", created: 3 },
    });
    expect(receipt).toEqual({
      phase: "receipt",
      run: goodRun,
      receipt: {
        facts: 4,
        titles: ["Fact 1", "Fact 2", "Fact 3"],
        tasks: 3,
        tasksNote: null,
        orgName: "Bayside Youth Fund",
      },
    });
    expect(contextSummary(receipt)).toEqual({
      outcome: "done",
      items: 4,
      tasks: 3,
    });
    const welcome = contextReducer(receipt, { type: "welcome" });
    expect(welcome.phase).toBe("welcome");
    expect(contextSummary(welcome)?.outcome).toBe("done");
  });

  it("a missing task generator is skipped, never an error", () => {
    const receipt = contextReducer(
      { phase: "tasks", run: goodRun },
      {
        type: "tasks",
        result: { state: "skipped", reason: "Not available yet" },
      },
    );
    expect(receipt.phase).toBe("receipt");
    expect(contextSummary(receipt)?.tasks).toBeNull();
    // The checklist says why, instead of claiming tasks are ready.
    expect(checklist(EMPTY_LINKS, receipt).at(-1)).toMatchObject({
      tone: "quiet",
      text: "Not available yet",
    });
  });

  it("a timed-out run never lands as done: slow, then the background read decides", () => {
    const slow = contextReducer(reading, { type: "run_ok", run: timedOut });
    expect(slow).toEqual({ phase: "slow", run: timedOut });
    expect(contextSummary(slow)).toEqual({
      outcome: "background",
      items: 0,
      tasks: null,
    });
    // Still on the screen when it finishes: the receipt, from the job's facts.
    const done = contextReducer(slow, {
      type: "background_done",
      read: read({ status: "done", facts: 9, titles: ["New fact"] }),
    });
    expect(done).toMatchObject({
      phase: "receipt",
      run: null,
      receipt: { facts: 9, titles: ["New fact"], tasks: null },
    });
    // Or it fails: a plain error with Try again.
    expect(
      contextReducer(slow, {
        type: "background_failed",
        message: "We couldn't read your website this time.",
      }),
    ).toMatchObject({ phase: "error", run: timedOut });
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
    const receipt = contextReducer(
      { phase: "tasks", run: goodRun },
      { type: "tasks", result: { state: "made", created: 0 } },
    );
    expect(
      contextReducer(receipt, { type: "run_failed", message: "late" }),
    ).toBe(receipt);
    expect(
      contextReducer(reading, {
        type: "tasks",
        result: { state: "made", created: 1 },
      }),
    ).toBe(reading);
    expect(contextReducer(reading, { type: "retry" })).toBe(reading);
    expect(contextReducer(reading, { type: "welcome" })).toBe(reading);
    expect(
      contextReducer(receipt, {
        type: "background_done",
        read: read({ status: "done" }),
      }),
    ).toBe(receipt);
  });
});

describe("the checklist and the bar", () => {
  const links = {
    ...EMPTY_LINKS,
    website: "https://www.example.org/",
    x: "https://x.com/ex",
  };
  const view = (phase: ContextPhase) =>
    checklist(links, phase).map((r) => [r.key, r.tone, r.text]);

  it("while reading: website and news active, tasks pending, links saved or not added", () => {
    expect(view({ phase: "reading" })).toEqual([
      ["website", "active", "Reading example.org…"],
      ["news", "active", "Searching recent news…"],
      ["x", "quiet", "Saved for later"],
      ["linkedin", "quiet", "Not added"],
      ["instagram", "quiet", "Not added"],
      ["tasks", "pending", "After the read"],
    ]);
  });

  it("after the run: facts per source, problems named, tasks in progress then done", () => {
    expect(view({ phase: "tasks", run: goodRun }).slice(0, 2)).toEqual([
      ["website", "done", "4 facts"],
      ["news", "problem", "Couldn't read"],
    ]);
    expect(view({ phase: "tasks", run: goodRun }).at(-1)).toEqual([
      "tasks",
      "active",
      "Making your list…",
    ]);
    const receipt: Receipt = {
      facts: 4,
      titles: [],
      tasks: 0,
      orgName: null,
    };
    expect(view({ phase: "receipt", run: goodRun, receipt }).at(-1)).toEqual([
      "tasks",
      "done",
      "Up to date",
    ]);
  });

  it("slow: still reading in the background; a failed call stops every spinner", () => {
    expect(view({ phase: "slow", run: timedOut }).slice(0, 2)).toEqual([
      ["website", "active", "Still reading in the background…"],
      ["news", "active", "Still reading in the background…"],
    ]);
    expect(
      checklist(links, { phase: "error", run: null, message: "x" }).every(
        (r) => r.tone !== "active",
      ),
    ).toBe(true);
  });

  it("a source the run didn't report is never left spinning", () => {
    expect(
      sourceRows(links, run({ sources: [source("website", "done", 1)] }))[1],
    ).toMatchObject({ key: "news", tone: "quiet", text: "Not read" });
    const newsFact = { ...fact(3), source: "news" };
    expect(
      sourceRows(
        links,
        run({ sources: [source("website", "done", 1)], facts: [newsFact] }),
      )[1],
    ).toMatchObject({ tone: "done", text: "1 fact (saved earlier)" });
  });

  it("the bar fills against the service's 30 s wait and reaches the end only when done", () => {
    expect(progressFraction({ phase: "reading" }, 0)).toBeCloseTo(0.05);
    expect(progressFraction({ phase: "reading" }, 15_000)).toBeCloseTo(0.35);
    expect(progressFraction({ phase: "reading" }, 120_000)).toBeCloseTo(0.65);
    expect(progressFraction({ phase: "slow", run: timedOut }, 0)).toBe(0.7);
    expect(progressFraction({ phase: "tasks", run: goodRun }, 0)).toBe(0.85);
    expect(
      progressFraction(
        {
          phase: "receipt",
          run: goodRun,
          receipt: { facts: 1, titles: [], tasks: null, orgName: null },
        },
        0,
      ),
    ).toBe(1);
    expect(
      progressFraction({ phase: "error", run: null, message: "x" }, 0),
    ).toBeNull();
  });

  it("the receipt line", () => {
    const r = { titles: [], orgName: null };
    expect(receiptLine({ ...r, facts: 14, tasks: 3 })).toBe(
      "14 facts found about your organization · 3 new tasks",
    );
    expect(receiptLine({ ...r, facts: 0, tasks: null })).toBe(
      "No new facts this time",
    );
  });
});

describe("the background read (GET /context/refresh)", () => {
  const started = read({});
  const now = Date.parse("2026-11-08T15:01:00+00:00");

  it("keeps running while the service says refreshing", () => {
    expect(
      readRefreshJob(
        { status: "refreshing", started_at: "2026-11-08T15:00:00+00:00" },
        started,
        now,
      ),
    ).toEqual(started);
  });

  it("done: the new facts and a few of their titles", () => {
    expect(
      readRefreshJob(
        {
          status: "done",
          finished_at: "2026-11-08T15:02:10+00:00",
          changes: {
            facts: {
              added: 12,
              added_facts: ["a", "b", "c", "d"],
              failed_sources: ["news"],
            },
          },
        },
        started,
        now,
      ),
    ).toMatchObject({
      status: "done",
      facts: 12,
      titles: ["a", "b", "c"],
      finishedAt: "2026-11-08T15:02:10+00:00",
    });
  });

  it("done but nothing could be read, failed, gone, or far too slow: a plain failure", () => {
    const both = readRefreshJob(
      {
        status: "done",
        changes: { facts: { added: 0, failed_sources: ["website", "news"] } },
      },
      started,
      now,
    );
    expect(both).toMatchObject({
      status: "failed",
      detail: "We couldn't read your website this time.",
    });
    expect(
      readRefreshJob(
        {
          status: "failed",
          detail: "no website saved yet: run onboarding first",
        },
        started,
        now,
      ).detail,
    ).toContain("wasn't saved");
    expect(readRefreshJob({ status: "idle" }, started, now).status).toBe(
      "failed",
    );
    expect(
      readRefreshJob(
        { status: "refreshing", started_at: "2026-11-08T15:00:00+00:00" },
        started,
        Date.parse("2026-11-08T15:00:00+00:00") + GIVE_UP_MS + 1,
      ).status,
    ).toBe("failed");
  });

  it("one status line for the dashboard", () => {
    expect(backgroundLine(started)).toContain("Still reading");
    expect(backgroundLine(read({ status: "done", facts: 3 }))).toBe(
      "Your website is read: 3 facts saved.",
    );
    expect(backgroundLine(read({ status: "failed", detail: "Nope." }))).toBe(
      "Nope.",
    );
  });
});

describe("the dashboard card's copy", () => {
  it("says ready only after a real read", () => {
    expect(
      offerCopy({
        context: { outcome: "done", items: 4, tasks: 1 },
        background: null,
      }).title,
    ).toBe("Your desk is ready.");
    for (const outcome of ["background", "failed", "saved"] as const)
      expect(
        offerCopy({
          context: { outcome, items: 0, tasks: null },
          background: null,
        }).title,
      ).not.toContain("ready");
    expect(
      offerCopy({
        context: { outcome: "background", items: 0, tasks: null },
        background: read({}),
      }).body,
    ).toContain("still reading");
    // The background read finished: now it's ready.
    expect(
      offerCopy({
        context: { outcome: "background", items: 0, tasks: null },
        background: read({ status: "done", facts: 2 }),
      }).title,
    ).toBe("Your desk is ready.");
    expect(offerCopy({ context: null, background: null }).body).toContain(
      "wasn't read",
    );
  });

  it("the sample build talks about the sample desk, never an unread website", () => {
    const copy = offerCopy({ context: null, background: null }, true);
    expect(copy.title).toBe("This is the sample desk.");
    expect(copy.body).toContain("made up");
    expect(copy.body).not.toContain("website");
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
