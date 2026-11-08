import { render } from "vitest-browser-react";

import { KindredLanding } from "./KindredLanding";

describe("landing page demo journey", () => {
  beforeEach(() => {
    window.location.hash = "";
  });

  it("starts the journey with onboarding instead of opening the dashboard", async () => {
    const screen = await render(<KindredLanding />);

    await expect
      .element(screen.getByRole("heading", { name: /less time on tasks/i }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Get started" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: /try sample data/i }))
      .not.toBeInTheDocument();

    await screen.getByRole("button", { name: "Get started" }).click();
    expect(window.location.hash).toBe("#/?onboarding=1");
  });
});
