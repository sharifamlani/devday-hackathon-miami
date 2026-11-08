import { render } from "vitest-browser-react";

import { KindredLandingGate } from "./KindredLanding";

describe("KindredLandingGate", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("shows the landing at the bare URL", async () => {
    const screen = await render(
      <KindredLandingGate>
        <p>the dashboard</p>
      </KindredLandingGate>,
    );

    await expect
      .element(screen.getByRole("button", { name: "Get started" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("the dashboard"))
      .not.toBeInTheDocument();
  });

  it("shows the dashboard after onboarding hash routes", async () => {
    window.location.hash = "#/?onboarding=1";
    const screen = await render(
      <KindredLandingGate>
        <p>the dashboard</p>
      </KindredLandingGate>,
    );

    await expect.element(screen.getByText("the dashboard")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Get started" }))
      .not.toBeInTheDocument();
  });

  it("keeps the welcome route on the landing", async () => {
    window.location.hash = "#/welcome";
    const screen = await render(
      <KindredLandingGate>
        <p>the dashboard</p>
      </KindredLandingGate>,
    );

    await expect
      .element(screen.getByRole("button", { name: "Get started" }))
      .toBeVisible();
    await expect
      .element(screen.getByText("the dashboard"))
      .not.toBeInTheDocument();
  });
});
