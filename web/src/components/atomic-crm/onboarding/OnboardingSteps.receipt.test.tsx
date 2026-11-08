import { render } from "vitest-browser-react";

import type { FilesSummary } from "./onboardingState";
import { ContextReceipt, ImportReceipt } from "./OnboardingSteps";

// Step 1's receipt after uploading data/sample_inputs/ (8 files): the declined charge is on record, not a gift.
const base: FilesSummary = {
  people: 77,
  gifts: 131,
  duplicates: 9,
  files: 8,
  byTab: { giver: 40, neighbor: 22, community: 15 },
  review: null,
};

const renderReceipt = (summary: FilesSummary) =>
  render(
    <ImportReceipt summary={summary} fresh onReviewDuplicates={() => {}} onAddMore={() => {}} />,
  );

describe("ImportReceipt", () => {
  it("counts 131 gifts and names the declined charge kept on record (S1)", async () => {
    const screen = await renderReceipt({ ...base, declined: 1 });
    await expect
      .element(screen.getByText("77 people · 131 gifts (+1 declined charge on record) from 8 files"))
      .toBeVisible();
  });

  it("shows no declined note when there are no declined charges (S-neg)", async () => {
    const screen = await renderReceipt({ ...base, gifts: 47, people: 12, files: 2 });
    await expect.element(screen.getByText("12 people · 47 gifts from 2 files")).toBeVisible();
    await expect.element(screen.getByText(/declined/)).not.toBeInTheDocument();
  });
});

describe("ContextReceipt", () => {
  it("renders repeated facts without React's duplicate-key error (S3)", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fact = "The Miami Foundation has served Greater Miami since 1967.";
    const screen = await render(
      <ContextReceipt
        receipt={{ facts: 3, titles: [fact, fact, "Grants fund local nonprofits."], tasks: 4, orgName: null }}
      />,
    );
    await expect.element(screen.getByText("Grants fund local nonprofits.")).toBeVisible();
    expect(screen.getByText(fact).elements()).toHaveLength(2);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    errors.mockRestore();
  });
});
