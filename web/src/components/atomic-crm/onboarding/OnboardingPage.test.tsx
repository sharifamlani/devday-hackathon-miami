import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { render } from "vitest-browser-react";

import { onboardingStore } from "./onboardingState";
import { OnboardingPage } from "./OnboardingPage";

// #/onboarding (docs/plans/user-journey.md §7.2): the organization card as its own page, not an overlay.
const getDonors = vi.fn();
vi.mock("../providers/local", async (orig) => ({
  ...(await orig<typeof import("../providers/local")>()),
  DATA_MODE: "local",
  donorDeskMethods: { getDonors: (...args: unknown[]) => getDonors(...args) },
  useOrgProfile: () => ({ data: undefined }),
}));
const readOrganization = vi.hoisted(() => vi.fn(async (_org?: unknown) => {}));
vi.mock("./backgroundRead", async (orig) => ({
  ...(await orig<typeof import("./backgroundRead")>()),
  readOrganizationInBackground: readOrganization,
}));
const openLanding = vi.hoisted(() => vi.fn());
vi.mock("../landing/KindredLanding", () => ({ openLanding }));

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
const imported = () =>
  onboardingStore.dispatch({
    type: "update",
    patch: { files: { people: 77, gifts: 131, duplicates: 9, files: 8, byTab: null, review: null } },
  });

describe("OnboardingPage (#/onboarding)", () => {
  beforeEach(() => {
    getDonors.mockReset();
    readOrganization.mockClear();
    openLanding.mockClear();
    window.localStorage.clear();
    onboardingStore.forget();
  });

  it("shows the organization card with the demo name and website prefilled", async () => {
    imported();
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await mount();
    await expect.element(screen.getByLabelText("Organization name")).toHaveValue("The Miami Foundation");
    await expect.element(screen.getByLabelText("Website")).toHaveValue("miamifoundation.org");
  });

  it("Continue starts the research in the background and opens #/dashboard", async () => {
    imported();
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await mount();
    await screen.getByRole("button", { name: "Continue" }).click();
    await expect.element(screen.getByTestId("where")).toHaveTextContent("/dashboard");
    expect(readOrganization).toHaveBeenCalledTimes(1);
    expect(readOrganization.mock.calls[0][0]).toMatchObject({
      name: "The Miami Foundation",
      website: expect.stringMatching(/^https:\/\/miamifoundation\.org\/?$/),
    });
    expect(onboardingStore.get().data.completedAt).not.toBeNull();
  });

  it("Finish later opens #/dashboard without starting the research", async () => {
    imported();
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await mount();
    await screen.getByRole("button", { name: "Finish later" }).first().click();
    await expect.element(screen.getByTestId("where")).toHaveTextContent("/dashboard");
    expect(readOrganization).not.toHaveBeenCalled();
  });

  it("with no import and no people, it sends you back to the landing", async () => {
    getDonors.mockResolvedValue([]);
    await mount();
    await vi.waitFor(() => expect(openLanding).toHaveBeenCalledWith({ replace: true }));
  });
});
