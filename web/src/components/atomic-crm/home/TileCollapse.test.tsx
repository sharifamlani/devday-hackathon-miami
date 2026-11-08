import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { Q4ProgressTile, TasksTile } from "./HomeCards";
import type { DonationTarget } from "../providers/local/types";
import { resetTileCollapseForTest, TILE_COLLAPSE_KEY } from "./collapseState";
import type { HomeTask } from "./homeData";

const task = (id: number, title: string): HomeTask => ({
  key: `task-${id}`,
  id,
  kind: "call",
  title,
  why: null,
  donorId: null,
  chips: [],
  source: null,
});

const Tasks = () => (
  <MemoryRouter>
    <TasksTile
      tasks={[task(1, "Call Rafael Quintero"), task(2, "Call Hye-jin Park")]}
      hasData
      selectedKey={null}
      onSelect={() => {}}
      onPlan={() => {}}
      isPending={false}
    />
  </MemoryRouter>
);

afterEach(() => {
  window.localStorage.clear();
  resetTileCollapseForTest();
});

describe("collapsible overview tiles", () => {
  it("the chevron folds Tasks to its title row and shows a one-line summary", async () => {
    const screen = await render(<Tasks />);
    const toggle = screen.getByRole("button", { name: "Collapse Tasks" });
    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .element(screen.getByText("Call Rafael Quintero"))
      .toBeVisible();

    await toggle.click();
    const expand = screen.getByRole("button", { name: "Expand Tasks" });
    await expect.element(expand).toHaveAttribute("aria-expanded", "false");
    await expect.element(screen.getByText("2 today")).toBeVisible();
    // The folded body is inert: its rows can't be focused or clicked.
    const body = document.getElementById(
      expand.element().getAttribute("aria-controls") ?? "",
    );
    expect(body?.hasAttribute("inert")).toBe(true);
    expect(body?.closest("section")?.hasAttribute("data-collapsed")).toBe(true);
    // The title link still opens the Tasks panel.
    await expect
      .element(screen.getByRole("link", { name: "Open all tasks" }))
      .toBeVisible();

    await expand.click();
    await expect
      .element(screen.getByRole("button", { name: "Collapse Tasks" }))
      .toBeVisible();
    expect(body?.hasAttribute("inert")).toBe(false);
  });

  it("remembers each tile's state in this browser", async () => {
    const first = await render(<Tasks />);
    await first.getByRole("button", { name: "Collapse Tasks" }).click();
    expect(
      JSON.parse(window.localStorage.getItem(TILE_COLLAPSE_KEY) ?? "{}"),
    ).toEqual({
      tasks: true,
    });
    first.unmount();
    resetTileCollapseForTest();

    const again = await render(<Tasks />);
    await expect
      .element(again.getByRole("button", { name: "Expand Tasks" }))
      .toBeVisible();
  });

  it("a folded quarter tile keeps the sample-goal qualification", async () => {
    const screen = await render(
      <MemoryRouter>
        <Q4ProgressTile
          target={
            { label: "Q4 2026", raised: 98_800 } as unknown as DonationTarget
          }
          goal={150_000}
          goalIsSample
          isPending={false}
        />
      </MemoryRouter>,
    );
    await screen
      .getByRole("button", { name: "Collapse quarter progress" })
      .click();
    await expect
      .element(screen.getByText(/66% · \$98\.8k · sample goal/))
      .toBeVisible();
  });
});
