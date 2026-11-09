import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { render } from "vitest-browser-react";

import { OnboardingGate } from "./OnboardingGate";
import { onboardingStore } from "./onboardingState";

// docs/plans/user-journey.md §3: setup never opens over the dashboard; an empty app's dashboard goes to the landing.
const getDonors = vi.fn();
vi.mock("../providers/local", async (orig) => ({
  ...(await orig<typeof import("../providers/local")>()),
  DATA_MODE: "local",
  donorDeskMethods: { getDonors: (...args: unknown[]) => getDonors(...args) },
}));
const openLanding = vi.hoisted(() => vi.fn());
vi.mock("../landing/KindredLanding", () => ({ openLanding }));

const mount = (path: string) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <OnboardingGate />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("OnboardingGate", () => {
  beforeEach(() => {
    getDonors.mockReset();
    openLanding.mockClear();
    window.localStorage.clear();
    onboardingStore.forget();
  });

  it("an empty app's dashboard sends you to the landing, with no setup overlay", async () => {
    getDonors.mockResolvedValue([]);
    const screen = await mount("/dashboard");
    await vi.waitFor(() => expect(openLanding).toHaveBeenCalled());
    await expect
      .element(screen.getByRole("dialog", { name: "Set up Gatherly" }))
      .not.toBeInTheDocument();
  });

  it("a new browser on a filled service adopts setup as done and opens no overlay", async () => {
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await mount("/dashboard");
    await vi.waitFor(() => expect(onboardingStore.get().data.completedAt).not.toBeNull());
    expect(openLanding).not.toHaveBeenCalled();
    await expect
      .element(screen.getByRole("dialog", { name: "Set up Gatherly" }))
      .not.toBeInTheDocument();
  });

  it("other pages of an empty app are left alone (deep links still open)", async () => {
    getDonors.mockResolvedValue([]);
    await mount("/contacts");
    await new Promise((r) => setTimeout(r, 300));
    expect(openLanding).not.toHaveBeenCalled();
  });
});
