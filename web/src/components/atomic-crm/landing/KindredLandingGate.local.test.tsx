import { render } from "vitest-browser-react";

import { onboardingStore } from "../onboarding/onboardingState";
import { KindredLandingGate, openLanding } from "./KindredLanding";

// Local mode (docs/plans/user-journey.md §3): the bare URL is always the landing; every hash route is the app.
const getDonors = vi.fn();
vi.mock("../providers/local", () => ({
  DATA_MODE: "local",
  donorDeskMethods: { getDonors: (...args: unknown[]) => getDonors(...args) },
}));

const Gate = () => (
  <KindredLandingGate>
    <p>the board</p>
  </KindredLandingGate>
);

describe("KindredLandingGate (local mode)", () => {
  beforeEach(() => {
    getDonors.mockReset();
    window.location.hash = "";
    window.localStorage.clear();
    onboardingStore.forget();
  });
  afterEach(() => {
    window.location.hash = "";
    window.localStorage.clear();
    onboardingStore.forget();
  });

  it("the bare URL shows the landing on an empty app, with no dashboard link", async () => {
    getDonors.mockResolvedValue([]);
    const screen = await render(<Gate />);
    await expect
      .element(screen.getByRole("button", { name: "Try sample data" }))
      .toBeVisible();
    await expect.element(screen.getByText("the board")).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("link", { name: /Open dashboard/ }))
      .not.toBeInTheDocument();
  });

  it("the bare URL still shows the landing once there are people, plus Open dashboard", async () => {
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await render(<Gate />);
    await expect
      .element(screen.getByRole("button", { name: "Try sample data" }))
      .toBeVisible();
    const link = screen.getByRole("link", { name: /Open dashboard/ });
    await expect.element(link).toBeVisible();
    await expect.element(link).toHaveAttribute("href", "#/dashboard");
    await expect.element(screen.getByText("the board")).not.toBeInTheDocument();
  });

  it("a hash route (#/onboarding, #/dashboard, #/contacts) shows the app", async () => {
    getDonors.mockResolvedValue([]);
    for (const hash of ["#/onboarding", "#/dashboard", "#/contacts"]) {
      window.location.hash = hash;
      const screen = await render(<Gate />);
      await expect.element(screen.getByText("the board")).toBeVisible();
      screen.unmount();
    }
  });

  it("#/welcome always shows the landing", async () => {
    window.location.hash = "#/welcome";
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await render(<Gate />);
    await expect
      .element(screen.getByRole("button", { name: "Try sample data" }))
      .toBeVisible();
  });

  it("openLanding() leaves the app for the bare URL's landing", async () => {
    getDonors.mockResolvedValue([]);
    window.location.hash = "#/dashboard";
    const screen = await render(<Gate />);
    await expect.element(screen.getByText("the board")).toBeVisible();
    openLanding();
    await expect
      .element(screen.getByRole("button", { name: "Try sample data" }))
      .toBeVisible();
    expect(window.location.hash).toBe("");
  });
});
