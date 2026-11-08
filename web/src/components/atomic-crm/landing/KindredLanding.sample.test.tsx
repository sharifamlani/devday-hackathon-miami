import { render } from "vitest-browser-react";

import { onboardingStore } from "../onboarding/onboardingState";
import { KindredLanding } from "./KindredLanding";
import { loadSampleManifest } from "./sampleFiles";

const manifest = {
  files: [
    { name: "give_miami_day_export_2022-2025.xlsx", bytes: 9869 },
    { name: "board_retreat_notes.md", bytes: 2106 },
    { name: "answer_key.json", bytes: 1 }, // must never be offered
  ],
};

// Default test env: VITE_DATA_MODE unset, so snapshot mode (the Vercel build).
describe("Try sample data (snapshot mode)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(manifest))),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("pre-loads the sample files and waits for Go instead of entering the CRM", async () => {
    const screen = await render(<KindredLanding />);
    await screen.getByRole("button", { name: "Try sample data" }).click();

    await expect.element(screen.getByText("Sample files, ready to go.")).toBeVisible();
    await expect.element(screen.getByText("give_miami_day_export_2022-2025.xlsx")).toBeVisible();
    await expect.element(screen.getByText("board_retreat_notes.md")).toBeVisible();
    await expect.element(screen.getByText("answer_key.json")).not.toBeInTheDocument();
    await expect.element(screen.getByText("Let the agent sort them")).toBeVisible();
    await expect.element(screen.getByRole("link", { name: "Open the CRM" })).not.toBeInTheDocument();
  });

  it("Go says it's a cached sample run and offers the CRM", async () => {
    const screen = await render(<KindredLanding />);
    await screen.getByRole("button", { name: "Try sample data" }).click();
    await screen.getByRole("button", { name: "Go" }).click();

    await expect.element(screen.getByText("Sample run (cached)")).toBeVisible();
    await expect
      .element(screen.getByText(/built from the 8 example files in data.sample_inputs/))
      .toBeVisible();
    await expect
      .element(screen.getByRole("link", { name: "Open the CRM" }))
      .toHaveAttribute("href", "#/");
  });

  it("Open the CRM skips setup: the dashboard opens with the tour offered, not step 1", async () => {
    window.localStorage.clear();
    onboardingStore.forget();
    const screen = await render(<KindredLanding />);
    await screen.getByRole("button", { name: "Try sample data" }).click();
    await screen.getByRole("button", { name: "Go" }).click();
    await screen.getByRole("link", { name: "Open the CRM" }).click();

    const { data } = onboardingStore.get();
    expect(data.status).toBe("completed");
    expect(data.completedAt).not.toBeNull();
    expect(data.tourOffer).toBe("pending");
  });
});

describe("loadSampleManifest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("drops anything that looks like an answer key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(manifest))));
    expect((await loadSampleManifest()).map((f) => f.name)).toEqual([
      "give_miami_day_export_2022-2025.xlsx",
      "board_retreat_notes.md",
    ]);
  });
});
