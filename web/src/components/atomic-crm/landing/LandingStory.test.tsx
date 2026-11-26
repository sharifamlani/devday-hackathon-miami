import { render } from "vitest-browser-react";

import snapshot from "../../../../public/snapshot.json";
import { KindredLanding } from "./KindredLanding";

const stubFetch = (body: unknown, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: ok ? 200 : 404 })),
  );

describe("Landing story (sections below the upload screen)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", window.location.pathname);
  });

  it("shows the problem, the demo, how it works and the closing call, in that order", async () => {
    stubFetch(snapshot);
    const screen = await render(<KindredLanding />);
    await expect.element(screen.getByRole("heading", { name: "Watch it work. Then try it yourself." })).toBeInTheDocument();
    const headings = Array.from(document.querySelectorAll("main h1, main h2")).map((h) => h.textContent?.trim());
    expect(headings).toEqual([
      "Know who needsto hear from you.",
      "Donors rarely say goodbye. They just stop giving.",
      "Watch it work. Then try it yourself.",
      "Turn messy files into a clean, organized CRM",
      "Bring your donor list.",
    ]);
    // The upload screen keeps exactly one "Try sample data" (the closing call doesn't repeat it).
    expect(screen.getByRole("button", { name: "Try sample data" }).elements()).toHaveLength(1);
  });

  it("header links scroll without changing the hash (the hash is the app's router)", async () => {
    stubFetch(snapshot);
    const screen = await render(<KindredLanding />);
    for (const name of ["Problem", "Demo", "How it works", "Try the demo"]) {
      await screen.getByRole("button", { name, exact: true }).click();
      expect(window.location.hash).toBe("");
    }
  });

  it("mounts the working demo on the sample snapshot", async () => {
    stubFetch(snapshot);
    const screen = await render(<KindredLanding />);
    await expect.element(screen.getByText("Here’s your day.")).toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: /Duplicates/ })).toBeInTheDocument();
    await screen.getByRole("button", { name: "Pause tour" }).click();
    await screen.getByRole("button", { name: /Duplicates/ }).click();
    await expect.element(screen.getByText("We found this donor twice")).toBeInTheDocument();
    await screen.getByRole("button", { name: "Merge ✓" }).click();
    await expect.element(screen.getByText(/^Merged\. Gift history moved to/)).toBeInTheDocument();
  });

  it("offers the sample workspace when the snapshot can't load", async () => {
    stubFetch({ error: "missing" }, false);
    const screen = await render(<KindredLanding />);
    await expect.element(screen.getByText("The demo couldn’t load here.")).toBeInTheDocument();
    await expect.element(screen.getByRole("link", { name: /Open the sample workspace/ })).toHaveAttribute("href", "#/dashboard");
  });
});
