import { useState } from "react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import type { NoteDestination, NoteDestinationKind } from "./callNotes";
import {
  DestinationChips,
  groupBySection,
  type DestinationOption,
} from "./DestinationChips";
import { donorOptions } from "./destinationOptions";
import type { DonorSummary } from "../providers/local/types";

const OPTIONS: Record<NoteDestinationKind, DestinationOption[]> = {
  donor: [
    { id: "1", label: "Carmen Ibarra", detail: "Miami", section: "People" },
    {
      id: "2",
      label: "Veloria Bay Foundation",
      section: "Organizations",
      icon: "organization",
    },
  ],
  group: [
    { id: "attention", label: "Needs attention", detail: "17" },
    { id: "stars", label: "Star donors", detail: "none yet", disabled: true },
  ],
  project: [{ id: "9", label: "Thank you · Email" }],
};
const LOADING = { donor: false, group: false, project: false };

const Harness = ({ start = [] }: { start?: NoteDestination[] }) => {
  const [destinations, setDestinations] = useState(start);
  return (
    <DestinationChips
      destinations={destinations}
      onChange={setDestinations}
      options={OPTIONS}
      loading={LOADING}
    />
  );
};

describe("DestinationChips", () => {
  it("starts as four icon tiles with accessible names", async () => {
    const screen = await render(<Harness />);
    await expect
      .element(
        screen.getByRole("button", {
          name: "Today: this note is saved to today",
        }),
      )
      .toBeVisible();
    for (const name of ["Add to donor", "Add to group", "Add to project"])
      await expect
        .element(screen.getByRole("button", { name, exact: true }))
        .toBeVisible();
    // No names yet: the tiles are icon-only.
    await expect
      .element(screen.getByText("Carmen Ibarra"))
      .not.toBeInTheDocument();
  });

  it("picking a donor widens the tile to the name, with a remove button", async () => {
    const screen = await render(<Harness />);
    await screen.getByRole("button", { name: "Add to donor" }).click();
    await expect.element(page.getByText("People")).toBeVisible();
    await expect.element(page.getByText("Organizations")).toBeVisible();
    await page.getByRole("option", { name: /Carmen Ibarra/ }).click();

    const tile = screen.getByRole("button", {
      name: "Donor: Carmen Ibarra. Change",
    });
    await expect.element(tile).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Remove Carmen Ibarra" }))
      .toBeVisible();
    expect(
      tile.element().closest(".dest-tile")?.hasAttribute("data-filled"),
    ).toBe(true);

    await screen.getByRole("button", { name: "Remove Carmen Ibarra" }).click();
    await expect
      .element(screen.getByRole("button", { name: "Add to donor" }))
      .toBeVisible();
  });

  it("keyboard focus shows the Today tooltip, and focus rings sit inside the tile", async () => {
    const screen = await render(<Harness />);
    const today = screen.getByRole("button", {
      name: "Today: this note is saved to today",
    });
    await userEvent.tab(); // the first tab stop is the Today tile
    await expect.element(today).toHaveFocus();
    await expect.element(page.getByText("Saved to today")).toBeVisible();
    const add = screen.getByRole("button", { name: "Add to donor" });
    expect(add.element().className).toContain("-outline-offset-2");
  });

  it("a group with no one in it is shown but can't be picked", async () => {
    const screen = await render(<Harness />);
    await screen.getByRole("button", { name: "Add to group" }).click();
    const empty = page.getByRole("option", { name: /Star donors/ });
    await expect.element(empty).toHaveAttribute("aria-disabled", "true");
    await expect.element(page.getByText("none yet")).toBeVisible();
    await page.getByRole("option", { name: /Needs attention/ }).click();
    await expect
      .element(
        screen.getByRole("button", { name: "Group: Needs attention. Change" }),
      )
      .toBeVisible();
  });
});

describe("destination options", () => {
  const donor = (id: number, name: string, type: string): DonorSummary =>
    ({
      id,
      full_name: name,
      donor_type: type,
      city: null,
    }) as unknown as DonorSummary;

  it("puts people first and organizations after, each under a heading", () => {
    const options = donorOptions([
      donor(1, "Veloria Bay Foundation", "organization"),
      donor(2, "Carmen Ibarra", "individual"),
      donor(3, "Tamarind Quay Hardware, LLC", "organization"),
    ]);
    expect(groupBySection(options)).toEqual([
      {
        heading: "People",
        items: [expect.objectContaining({ label: "Carmen Ibarra" })],
      },
      {
        heading: "Organizations",
        items: [
          expect.objectContaining({
            label: "Veloria Bay Foundation",
            icon: "organization",
          }),
          expect.objectContaining({ label: "Tamarind Quay Hardware, LLC" }),
        ],
      },
    ]);
  });

  it("options without a section stay in one unlabeled group", () => {
    expect(groupBySection(OPTIONS.project)).toEqual([
      { heading: "", items: OPTIONS.project },
    ]);
  });
});
