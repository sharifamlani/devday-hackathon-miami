import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { AfterCallProposal, AfterCallResult } from "../providers/local/voice";

// The API is faked; nothing here reaches a service.
const api = vi.hoisted(() => ({
  propose: vi.fn<(id: string) => Promise<AfterCallProposal>>(),
  mutate: vi.fn(),
  savedIds: vi.fn<() => string[]>(),
}));
vi.mock("../providers/local/calls", () => ({
  listServerCallNotes: async () => api.savedIds().map((id) => ({ id })),
}));
vi.mock("../providers/local/voice", () => ({
  proposeAfterCall: (id: string) => api.propose(id),
  useAfterCall: () => ({ apply: { mutate: api.mutate } }),
}));

const { AfterCallCard } = await import("./AfterCallCard");

const ROSA: AfterCallProposal = {
  steps: ["Read the call", "Matched the Beach Cleanup on Sat Nov 21"],
  actions: [
    { id: "a1", type: "create_task", label: "Text Rosa a secure link to update her card", payload: {}, evidence: "I got a new card" },
    { id: "a2", type: "rsvp_event", label: "Rosa attending Beach Cleanup (Sat Nov 21)", payload: {}, evidence: "put me down for the beach cleanup on the 21st" },
    { id: "a3", type: "add_context_note", label: "Prefers phone; new card since October", payload: {} },
  ],
  person: { id: 1, full_name: "Rosa Delgado", first_name: "Rosa" },
};

const applied = (ids: string[]): AfterCallResult => ({
  applied: ids.map((id) => ({ id, type: "x", ref: 1 })),
  skipped: [],
});

beforeEach(() => {
  api.propose.mockReset();
  api.mutate.mockReset();
  api.savedIds.mockReset();
  api.savedIds.mockReturnValue(["n1"]); // the note is already saved unless a test says otherwise
});

describe("AfterCallCard", () => {
  it("S1: lists the proposed actions for the person, all ticked, and writes nothing yet", async () => {
    api.propose.mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" contactName="Rosa Delgado" />);
    await expect.element(screen.getByText("Agent · from your call with Rosa")).toBeVisible();
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    const boxes = screen.getByRole("checkbox").elements() as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(api.propose).toHaveBeenCalledWith("n1");
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it("S2: Apply selected writes only the ticked actions and shows a ✓ for each", async () => {
    api.propose.mockResolvedValue(ROSA);
    api.mutate.mockImplementation((vars, opts) => opts.onSuccess(applied(vars.actionIds)));
    const screen = await render(<AfterCallCard noteId="n1" />);
    await screen.getByRole("checkbox").nth(2).click(); // untick the context note
    await screen.getByRole("button", { name: "Apply selected" }).click();
    expect(api.mutate).toHaveBeenCalledOnce();
    expect(api.mutate.mock.calls[0][0]).toEqual({ callNoteId: "n1", actionIds: ["a1", "a2"] });
    await expect.element(screen.getByText("Applied 2 of 3. Tasks and the calendar are updated.")).toBeVisible();
    expect(screen.getByLabelText("Applied").elements()).toHaveLength(2);
    expect((screen.getByRole("checkbox").elements() as HTMLInputElement[]).every((b) => b.disabled)).toBe(true);
  });

  it("S3: Discard writes nothing", async () => {
    api.propose.mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" />);
    await screen.getByRole("button", { name: "Discard" }).click();
    await expect.element(screen.getByText("Discarded. Nothing was saved.")).toBeVisible();
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it("S-neg: a call with nothing actionable says so and offers no Apply", async () => {
    api.propose.mockResolvedValue({ steps: ["Review the call notes."], actions: [] });
    const screen = await render(<AfterCallCard noteId="n1" />);
    await expect.element(screen.getByText("Nothing to do from this call.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Apply selected" }).elements()).toHaveLength(0);
    expect(api.mutate).not.toHaveBeenCalled();
  });

  it("waits on GET /calls (no 404s) until the note is saved, then proposes once", async () => {
    let polls = 0;
    api.savedIds.mockImplementation(() => (++polls < 5 ? [] : ["n1"]));
    api.propose.mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" retryMs={5} />);
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    expect(polls).toBe(5);
    expect(api.propose).toHaveBeenCalledOnce();
  });

  it("a note that never gets saved: a clear error, /actions never called", async () => {
    api.savedIds.mockReturnValue([]);
    const screen = await render(<AfterCallCard noteId="n1" retryMs={1} />);
    await expect.element(screen.getByText("This call isn’t saved yet. Try again in a moment.")).toBeVisible();
    expect(api.propose).not.toHaveBeenCalled();
  });

  it("shows an error with Try again when the agent can't read the call", async () => {
    api.propose.mockRejectedValueOnce(new Error("After-call actions isn’t available yet")).mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" />);
    await expect.element(screen.getByText("After-call actions isn’t available yet")).toBeVisible();
    await screen.getByRole("button", { name: "Try again" }).click();
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
  });
});
