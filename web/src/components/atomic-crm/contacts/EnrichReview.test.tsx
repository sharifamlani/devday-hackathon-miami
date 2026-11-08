import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { EnrichPreview } from "../providers/local/interests";
import type { DonorDetail } from "../providers/local/types";
import { ENRICH_COPY, EnrichProposal, type EnrichReviewState } from "./EnrichReview";

vi.mock("../providers/local/interests", async (importActual) => ({
  ...(await importActual<typeof import("../providers/local/interests")>()),
  useInterestTags: () => ({ data: [] }), // no network in a component test
}));

const NAME_ONLY =
  "Only the name matched: the city, state and website on the pages found don't match this donor's record, so nothing was suggested.";

/** EnrichProposal with a finished dry run that found nothing (the state the panel shows after Enrich). */
const renderProposal = (proposal: Partial<EnrichPreview>) => {
  const review = {
    donor: { id: 74, full_name: "Whitaker Family Charitable Fund", donor_type: "organization" } as DonorDetail,
    preview: { isPending: false, isError: false, error: null },
    accept: { isError: false, error: null },
    proposal: { facts: [], interests: [], contact: {}, ...proposal },
    found: false,
    facts: new Set<string>(),
    tags: new Set<string>(),
    saved: null,
  } as unknown as EnrichReviewState;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <EnrichProposal review={review} />
    </QueryClientProvider>,
  );
};

describe("EnrichProposal: an ambiguous result", () => {
  it("shows the service's own note, even when the model returned an empty identity basis", async () => {
    // Live, the model itself answered "ambiguous" with basis [] for Whitaker; the note is the service's reason
    const screen = await renderProposal({ identity_match: "ambiguous", identity_basis: [], notes: NAME_ONLY });
    await expect.element(screen.getByText(NAME_ONLY)).toBeVisible();
    expect(screen.container.textContent).not.toContain(ENRICH_COPY.ambiguous);
  });

  it("shows the service's note for a name-only match", async () => {
    const screen = await renderProposal({ identity_match: "ambiguous", identity_basis: ["name"], notes: NAME_ONLY });
    await expect.element(screen.getByText(NAME_ONLY)).toBeVisible();
  });

  it("falls back to the generic copy when the service gave no note", async () => {
    const screen = await renderProposal({ identity_match: "ambiguous", identity_basis: [], notes: null });
    await expect.element(screen.getByText(ENRICH_COPY.ambiguous)).toBeVisible();
  });

  it("keeps the 'no public information' copy for an organization nothing was found about", async () => {
    const screen = await renderProposal({ identity_match: "not_found", notes: null });
    await expect.element(screen.getByText(ENRICH_COPY.noInfo)).toBeVisible();
  });
});
