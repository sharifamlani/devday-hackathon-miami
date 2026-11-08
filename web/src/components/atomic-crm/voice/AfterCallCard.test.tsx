import { StrictMode } from "react";
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

const { AfterCallCard, confidentMatch, forgetProposals, withMatchedDonor } = await import("./AfterCallCard");

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
  forgetProposals(); // one proposal per note is cached across mounts
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

describe("one proposal per note (each /actions is a model call)", () => {
  it("StrictMode's double mount asks the agent once", async () => {
    api.propose.mockResolvedValue(ROSA);
    const screen = await render(
      <StrictMode>
        <AfterCallCard noteId="n1" />
      </StrictMode>,
    );
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    expect(api.propose).toHaveBeenCalledOnce();
  });

  it("a second card for the same note reuses the proposal", async () => {
    api.propose.mockResolvedValue(ROSA);
    const first = await render(<AfterCallCard noteId="n1" />);
    await expect.element(first.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    const second = await render(<AfterCallCard noteId="n1" />);
    await expect.element(second.getByText("Text Rosa a secure link to update her card", { exact: false }).nth(1)).toBeVisible(); // the second card on the page
    expect(api.propose).toHaveBeenCalledOnce();
  });
});

describe("pre-filling the note's donor from the agent's match", () => {
  const rosa = ROSA.person!;

  it("confident only when the match agrees with who the call was with", () => {
    expect(confidentMatch(rosa, "Rosa Delgado")).toBe(true);
    expect(confidentMatch(rosa, "rosa")).toBe(true); // the demo's first-name contact
    expect(confidentMatch(rosa, "James Carter")).toBe(false);
    expect(confidentMatch(rosa, null)).toBe(false); // no contact name: don't guess
    expect(confidentMatch(null, "Rosa Delgado")).toBe(false);
  });

  it("adds the donor destination only if none is set", () => {
    expect(withMatchedDonor([], rosa)).toEqual([{ kind: "donor", id: "1", label: "Rosa Delgado" }]);
    const chosen = [{ kind: "donor" as const, id: "9", label: "Someone else" }];
    expect(withMatchedDonor(chosen, rosa)).toBe(chosen);
    const group = [{ kind: "group" as const, id: "g1", label: "Lapsed" }];
    expect(withMatchedDonor(group, rosa)).toEqual([...group, { kind: "donor", id: "1", label: "Rosa Delgado" }]);
  });

  it("tells the pane about a confident match, and stays quiet otherwise", async () => {
    api.propose.mockResolvedValue(ROSA);
    const matched = vi.fn();
    const a = await render(<AfterCallCard noteId="n1" contactName="Rosa Delgado" onMatchedPerson={matched} />);
    await expect.element(a.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    expect(matched).toHaveBeenCalledWith(ROSA.person);

    forgetProposals();
    const unmatched = vi.fn();
    const b = await render(<AfterCallCard noteId="n2" contactName="James Carter" onMatchedPerson={unmatched} />);
    await expect.element(b.getByText("Text Rosa a secure link to update her card", { exact: false }).first()).toBeVisible();
    expect(unmatched).not.toHaveBeenCalled();
  });
});

describe("a late or duplicate /actions response never undoes the person's choices (IT lane bug)", () => {
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  const ROSA_REWORDED: AfterCallProposal = {
    steps: [],
    actions: [
      { id: "b1", type: "create_task", label: "Send Rosa a card-update link", payload: {} },
      { id: "b2", type: "rsvp_event", label: "Beach Cleanup: Rosa yes", payload: {} },
      { id: "b3", type: "add_context_note", label: "Card changed in October", payload: {} },
    ],
    person: ROSA.person,
  };

  it("S1: one /actions request per card under StrictMode, even when the first is slow", async () => {
    const slow = deferred<AfterCallProposal>();
    api.propose.mockReturnValue(slow.promise);
    const screen = await render(
      <StrictMode>
        <AfterCallCard noteId="n1" />
      </StrictMode>,
    );
    await new Promise((r) => setTimeout(r, 50));
    slow.resolve(ROSA);
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    expect(api.propose).toHaveBeenCalledOnce();
  });

  it("S2: untick, then a delayed duplicate response arrives: the untick is kept and Apply sends only the ticked", async () => {
    // Two requests really go out: the cache is cleared and a re-render with a changed effect
    // input starts a newer request while the first is still in flight.
    const first = deferred<AfterCallProposal>();
    const second = deferred<AfterCallProposal>();
    let calls = 0;
    api.propose.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });
    api.mutate.mockImplementation((vars, opts) => opts.onSuccess(applied(vars.actionIds)));
    const screen = await render(<AfterCallCard noteId="n1" retryMs={1} />);
    await expect.poll(() => calls).toBe(1);
    forgetProposals(); // as if the cache weren't there: a real second request
    await screen.rerender(<AfterCallCard noteId="n1" retryMs={2} />);
    await expect.poll(() => calls).toBe(2); // the duplicate really went out
    second.resolve(ROSA); // the newer request answers first
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    await screen.getByRole("checkbox").nth(2).click(); // the person unticks the context note
    first.resolve(ROSA_REWORDED); // the stale, differently worded answer lands late
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.getByText("Send Rosa a card-update link", { exact: false }).elements()).toHaveLength(0);
    expect((screen.getByRole("checkbox").elements() as HTMLInputElement[]).map((b) => b.checked)).toEqual([true, true, false]);
    await screen.getByRole("button", { name: "Apply selected" }).click();
    expect(api.mutate.mock.calls[0][0]).toEqual({ callNoteId: "n1", actionIds: ["a1", "a2"] });
  });

  it("once the person has edited, nothing re-asks the agent or resets their card", async () => {
    api.propose.mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" retryMs={1} />);
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    await screen.getByRole("checkbox").nth(0).click(); // edited
    forgetProposals();
    await screen.rerender(<AfterCallCard noteId="n1" retryMs={2} />); // something that would start a newer request
    await new Promise((r) => setTimeout(r, 100));
    expect(api.propose).toHaveBeenCalledOnce(); // no second model call
    expect((screen.getByRole("checkbox").elements() as HTMLInputElement[]).map((b) => b.checked)).toEqual([false, true, true]);
  });

  it("after Discard the checkboxes are gone, not just disabled", async () => {
    api.propose.mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" />);
    await screen.getByRole("button", { name: "Discard" }).click();
    await expect.element(screen.getByText("Discarded. Nothing was saved.")).toBeVisible();
    expect(screen.getByRole("checkbox").elements()).toHaveLength(0);
  });

  it("doesn't repeat the summary's steps above the actions", async () => {
    api.propose.mockResolvedValue(ROSA);
    const screen = await render(<AfterCallCard noteId="n1" />);
    await expect.element(screen.getByText("Text Rosa a secure link to update her card", { exact: false })).toBeVisible();
    expect(screen.getByText("Matched the Beach Cleanup on Sat Nov 21").elements()).toHaveLength(0);
  });
});

