import { render } from "vitest-browser-react";

import { KindredLanding } from "./KindredLanding";

describe("landing page in local mode", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("routes Get started into the onboarding flow", async () => {
    const screen = await render(<KindredLanding />);

    await expect
      .element(screen.getByRole("button", { name: "Get started" }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Get started" }).click();

    expect(window.location.hash).toBe("#/?onboarding=1");
  });

  it("keeps file upload off the landing page so it happens in onboarding", async () => {
    const screen = await render(<KindredLanding />);

    await expect
      .element(screen.getByRole("button", { name: "Upload files" }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: /try sample data/i }))
      .not.toBeInTheDocument();
  });
});
