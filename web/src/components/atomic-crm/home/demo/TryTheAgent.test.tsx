import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { render } from "vitest-browser-react";

import snapshotJson from "../../../../../public/snapshot.json";
import { applyMotionPreference } from "@/lib/motion";
import { AskSessionProvider } from "../../ask/AskSession";
import { AgentThread } from "../HomeChat";
import { OPEN_DONOR_EVENT, resetDemoRuns } from "./demoRun";
import { TryTheAgent } from "./TryTheAgent";

// The public build: the thread is the sample thread, and the runs read the snapshot it serves.
vi.mock("../../providers/local/snapshotClient", async (orig) => ({
  ...(await orig<object>()),
  loadSnapshot: async () => snapshotJson,
}));

const Home = () => (
  <MemoryRouter>
    <QueryClientProvider client={new QueryClient()}>
      <AskSessionProvider>
        <AgentThread intro={<TryTheAgent />} />
      </AskSessionProvider>
    </QueryClientProvider>
  </MemoryRouter>
);

describe("Try the agent (public build)", () => {
  beforeEach(() => {
    resetDemoRuns();
    applyMotionPreference("reduce"); // the whole run at once
  });
  afterEach(() => applyMotionPreference("system"));

  it("shows the four rows with a Sample run tag", async () => {
    const screen = await render(<Home />);
    await expect.element(screen.getByText("Try the agent")).toBeVisible();
    await expect.element(screen.getByText("Sample run", { exact: true })).toBeVisible();
    for (const id of ["lookup", "catch_up", "batch_email", "call"])
      await expect.element(screen.getByTestId(`try-${id}`)).toBeVisible();
  });

  it("1 · Find: steps, then the lookup card; Save adds the saved step", async () => {
    const screen = await render(<Home />);
    await screen.getByTestId("try-lookup").click();
    await expect.element(screen.getByTestId("lookup-card")).toBeVisible();
    await expect.element(screen.getByTestId("sample-note")).toBeVisible();
    await expect.element(screen.getByText("Search your records")).toBeVisible();
    await expect.element(screen.getByText("Lookup: Bernard Okoye")).toBeVisible();
    await screen.getByRole("button", { name: "Save to profile" }).click();
    await expect.element(screen.getByText(/Saved 3 findings to Bernard’s profile/)).toBeVisible();
  });

  it("2 · Brief me: the catch-up card with the declined charge", async () => {
    const screen = await render(<Home />);
    await screen.getByTestId("try-catch_up").click();
    await expect.element(screen.getByText("Catch-up: Hye-jin Park")).toBeVisible();
    await expect.element(screen.getByText("Not a gift: $40 charge on Oct 10 was declined.")).toBeVisible();
    await expect.element(screen.getByText(/\$480 across 7 gifts/).first()).toBeVisible();
    // Open profile asks Home for the donor drawer.
    const opened = new Promise<number>((resolve) =>
      window.addEventListener(OPEN_DONOR_EVENT, (e) => resolve((e as CustomEvent<number>).detail), { once: true }),
    );
    await screen.getByRole("button", { name: "Open profile" }).click();
    expect(await opened).toBe(60);
  });

  it("3 · Draft emails: email prep, 4 previews behind Send; Send says nothing was sent", async () => {
    const screen = await render(<Home />);
    await screen.getByTestId("try-batch_email").click();
    await expect.element(screen.getByTestId("email-prep")).toBeVisible();
    await expect.element(screen.getByTestId("agent-approval")).toBeVisible();
    expect(screen.getByTestId("send-preview").elements()).toHaveLength(4);
    await screen.getByRole("button", { name: "Send" }).click();
    await expect.element(screen.getByText("Queued 4 emails (sample: nothing was sent)")).toBeVisible();
    await expect.element(screen.getByTestId("agent-approval")).toHaveAttribute("data-decision", "approved");
  });

  it("4 · Call: call sheet, the sample call, then the after-call notes and the log step", async () => {
    const screen = await render(<Home />);
    await screen.getByTestId("try-call").click();
    await expect.element(screen.getByText("Call sheet: Rafael Quintero")).toBeVisible();
    await screen.getByTestId("call-sheet").getByRole("button", { name: "Call" }).click();
    await expect.element(screen.getByTestId("demo-call")).toHaveAttribute("data-phase", "ringing");
    await expect.element(screen.getByText("Sample call: no phone was dialed")).toBeVisible();
    await screen.getByRole("button", { name: "Hang up" }).click();
    await expect.element(screen.getByTestId("after-call")).toBeVisible();
    await expect.element(screen.getByText(/Logged the call and 2 next steps to Rafael’s profile/)).toBeVisible();
  });

  it("runs stack in the thread in the order they were played, and the rows stay", async () => {
    const screen = await render(<Home />);
    await screen.getByTestId("try-call").click();
    await expect.element(screen.getByTestId("call-sheet")).toBeVisible();
    await screen.getByTestId("try-lookup").click();
    await expect.element(screen.getByTestId("lookup-card")).toBeVisible();
    const runs = screen.getByTestId("demo-run").elements();
    expect(runs).toHaveLength(2);
    expect(runs[0].textContent).toContain("Call Rafael Quintero");
    expect(runs[1].textContent).toContain("Look up Bernard Okoye");
    await expect.element(screen.getByTestId("try-batch_email")).toBeVisible();
  });
});
