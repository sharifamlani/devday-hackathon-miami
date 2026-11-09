import { MemoryRouter, useLocation } from "react-router";
import { render } from "vitest-browser-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { onboardingStore } from "./onboardingState";
import {
  RestartOnboardingDialog,
  RestartOnboardingMenuItem,
} from "./RestartOnboardingMenuItem";

// docs/plans/user-journey.md §11: restart from the account menu without importing twice.
const getDonors = vi.fn();
vi.mock("../providers/local", async (orig) => ({
  ...(await orig<typeof import("../providers/local")>()),
  DATA_MODE: "local",
  donorDeskMethods: { getDonors: (...args: unknown[]) => getDonors(...args) },
}));
const openLanding = vi.hoisted(() => vi.fn());
vi.mock("../landing/KindredLanding", () => ({ openLanding }));

const Where = () => <p data-testid="where">{useLocation().pathname}</p>;
const mount = () =>
  render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <DropdownMenu>
        <DropdownMenuTrigger>Account menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <RestartOnboardingMenuItem />
        </DropdownMenuContent>
      </DropdownMenu>
      <RestartOnboardingDialog />
      <Where />
    </MemoryRouter>,
  );
const openMenuAndRestart = async (screen: Awaited<ReturnType<typeof mount>>) => {
  await screen.getByRole("button", { name: "Account menu" }).click();
  await screen.getByRole("menuitem", { name: "Restart onboarding" }).click();
};

describe("Restart onboarding (account menu)", () => {
  beforeEach(() => {
    getDonors.mockReset();
    openLanding.mockClear();
    window.localStorage.clear();
    onboardingStore.forget();
    onboardingStore.dispatch({ type: "finish" });
  });

  it("with people already in, asks first; Skip upload opens #/onboarding", async () => {
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await mount();
    await openMenuAndRestart(screen);
    await expect.element(screen.getByRole("dialog", { name: "Start setup again?" })).toBeVisible();
    await screen.getByRole("button", { name: "Skip upload" }).click();
    await expect.element(screen.getByTestId("where")).toHaveTextContent("/onboarding");
    expect(openLanding).not.toHaveBeenCalled();
  });

  it("Start over goes back to the landing", async () => {
    getDonors.mockResolvedValue([{ id: 1 }]);
    const screen = await mount();
    await openMenuAndRestart(screen);
    await screen.getByRole("button", { name: "Start over" }).click();
    expect(openLanding).toHaveBeenCalledTimes(1);
  });

  it("on an empty app it goes straight to the landing, no question", async () => {
    getDonors.mockResolvedValue([]);
    const screen = await mount();
    await screen.getByRole("button", { name: "Account menu" }).click();
    // wait until the menu item knows the service is empty
    await vi.waitFor(() => expect(getDonors).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 100));
    await screen.getByRole("menuitem", { name: "Restart onboarding" }).click();
    expect(openLanding).toHaveBeenCalledTimes(1);
    await expect
      .element(screen.getByRole("dialog", { name: "Start setup again?" }))
      .not.toBeInTheDocument();
  });
});
