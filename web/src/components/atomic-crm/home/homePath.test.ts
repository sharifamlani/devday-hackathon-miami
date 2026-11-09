import { HOME, isHomePath } from "./homePath";

describe("homePath (docs/plans/user-journey.md §3)", () => {
  it("the dashboard lives at /dashboard", () => {
    expect(HOME).toBe("/dashboard");
  });

  it("home is /dashboard, or / and '' while the redirect to it runs", () => {
    expect(isHomePath("/dashboard")).toBe(true);
    expect(isHomePath("/")).toBe(true);
    expect(isHomePath("")).toBe(true);
  });

  it("other pages are not home", () => {
    expect(isHomePath("/contacts")).toBe(false);
    expect(isHomePath("/onboarding")).toBe(false);
    expect(isHomePath("/dashboard/extra")).toBe(false);
  });
});
