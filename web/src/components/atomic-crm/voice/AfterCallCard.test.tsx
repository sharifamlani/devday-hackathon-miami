import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import type { AfterCallProposal, AfterCallResult } from "../providers/local/voice";

// The API is faked; nothing here reaches a service.
const api = vi.hoisted(() => ({
  propose: vi.fn<(id: string) => Promise<AfterCallProposal>>(),
  mutate: vi.fn(),
}));
vi.mock("../providers/local/voice", () => ({
  proposeAfterCall: (id: string) => api.propose(id),
  useAfterCall: () => ({ apply: { mutate: api.mutate } }),
}));

const { AfterCallCard } = await import("./AfterCallCard");
const { ApiError } = await import("../providers/local/httpClient");

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

  it("waits for the note to be saved: retries a 404, then shows the proposal", async () => {
    api.propose
      .mockRejectedValueOnce(new ApiError("not yet", 404, { detail: "no call note n1" }))
      .mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" retryMs={10} />);
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    expect(api.propose).toHaveBeenCalledTimes(2);
  });

  it("keeps waiting through a slow save (several 404s) before showing the proposal", async () => {
    const notYet = () => new ApiError("not yet", 404, { detail: "no call note n1" });
    for (let i = 0; i < 8; i += 1) api.propose.mockRejectedValueOnce(notYet());
    api.propose.mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" retryMs={5} />);
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    expect(api.propose).toHaveBeenCalledTimes(9);
  });

  it("shows an error with Try again when the agent can't read the call", async () => {
    api.propose.mockRejectedValueOnce(new Error("After-call actions isn’t available yet")).mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" />);
    await expect.element(screen.getByText("After-call actions isn’t available yet")).toBeVisible();
    await screen.getByRole("button", { name: "Try again" }).click();
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
  });
});
