import { render } from "vitest-browser-react";

import { KindredLandingGate } from "./KindredLanding";

// Local mode: the bare URL shows the landing only while the app has no people.
const getDonors = vi.fn();
vi.mock("../providers/local", () => ({
  DATA_MODE: "local",
  donorDeskMethods: { getDonors: (...args: unknown[]) => getDonors(...args) },
}));

describe("KindredLandingGate (local mode)", () => {
  beforeEach(() => {
    getDonors.mockReset();
    window.location.hash = "";
  });
  afterEach(() => {
    window.location.hash = "";
  });

  it("shows the landing while the app is empty", async () => {
    getDonors.mockResolvedValue([]);
    const screen = await render(
      <KindredLandingGate>
        <p>the board</p>
      </KindredLandingGate>,
    );
    await expect.element(screen.getByRole("button", { name: "Try sample data" })).toBeVisible();
    await expect.element(screen.getByText("the board")).not.toBeInTheDocument();
  });

  it("goes straight to the board once there are people", async () => {
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await render(
      <KindredLandingGate>
        <p>the board</p>
      </KindredLandingGate>,
    );
    await expect.element(screen.getByText("the board")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Try sample data" })).not.toBeInTheDocument();
  });

  it("#/welcome always shows the landing", async () => {
    window.location.hash = "#/welcome";
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await render(
      <KindredLandingGate>
        <p>the board</p>
      </KindredLandingGate>,
    );
    await expect.element(screen.getByRole("button", { name: "Try sample data" })).toBeVisible();
  });
});
